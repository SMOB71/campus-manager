import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import cron from "node-cron";
import * as XLSX from "xlsx";
import { systemFor, modelFor, PROMPTS, EMAIL_MODEL, VISIT_VARIANTS, SYNTHESE_RESEAU, CHAT_ASSISTANT } from "./lib/prompts.js";
import { issueCookie, clearCookie, sessionUserId, issueCsrf, csrfValid } from "./lib/auth.js";
import * as userstore from "./lib/userstore.js";
import { generateDailyBrief } from "./lib/brief.js";
import { testImap, sendMail } from "./lib/mailbox.js";
import { sendDeadlineAlert, sendWeeklyDigest } from "./lib/alerts.js";
import * as authstore from "./lib/authstore.js";
import { encryptionEnabled, encryptBuffer, decryptBuffer } from "./lib/crypto-store.js";
import { extractText } from "./lib/extract.js";
import { toMarkdown, toHtml, toDocx } from "./lib/export.js";
import * as store from "./lib/store.js";
import { QUALIOPI_REFERENCE, QUALIOPI_STATUSES, conformityRate, computeControlDates } from "./lib/qualiopi.js";
import { marginOf, healthScore, schoolYearRange, extractPnlPostes, OPENING_LOTS, buildOpeningTasks, buildOpeningBudget } from "./lib/calc.js";
import { validateBody } from "./lib/validators.js";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;
const APP_PASSWORD = process.env.APP_PASSWORD || "";

const briefCfg = {
  gmailUser: process.env.GMAIL_USER || "",
  gmailPass: process.env.GMAIL_APP_PASSWORD || "",
  briefTo: process.env.BRIEF_TO || process.env.GMAIL_USER || "",
  icalUrl: process.env.ICAL_URL || "",
  hours: Number(process.env.BRIEF_HOURS || 24),
  max: Number(process.env.BRIEF_MAX || 40),
  cron: process.env.BRIEF_CRON || "30 7 * * *",
  model: EMAIL_MODEL,
};

// Alerte echeances d'actions (quotidien 8h par defaut ; hebdo = "0 8 * * 1")
const alertCfg = {
  to: process.env.ALERT_TO || "",
  cron: process.env.ALERT_CRON || "0 8 * * *",
  horizonDays: Number(process.env.ALERT_HORIZON_DAYS || 7),
  alwaysSend: process.env.ALERT_ALWAYS === "true",
};
const mailConfigured = !!(process.env.MAIL_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));

if (!process.env.OPENAI_API_KEY) console.warn("[warn] OPENAI_API_KEY manquante");
if (!process.env.SESSION_SECRET) console.warn("[warn] SESSION_SECRET manquante");
if (!APP_PASSWORD) console.warn("[warn] APP_PASSWORD manquante — login impossible");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chiffrement au repos (AES-256-GCM) : migration transparente au démarrage.
// En production, DATA_KEY est OBLIGATOIRE (données perso, finances, Qualiopi, décisions…).
if (encryptionEnabled) {
  const m = store.migrateEncryption();
  authstore.migrateEncryption();
  userstore.migrateEncryption();
  console.log(`[crypto] chiffrement au repos ACTIF${m.migrated ? ` — ${m.migrated} fichier(s) migré(s)` : ""}`);
} else if (process.env.NODE_ENV === "production") {
  console.error("[crypto] REFUS DE DÉMARRAGE : DATA_KEY absente en production — les données seraient stockées en clair.");
  process.exit(1);
} else {
  console.warn("[crypto] DATA_KEY absente — données stockées EN CLAIR (autorisé hors production uniquement)");
}

// Compte admin initial (DO) : email = ADMIN_EMAIL ou GMAIL_USER, mot de passe = APP_PASSWORD.
const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_USER || "";
if (userstore.countUsers() === 0) {
  const seeded = userstore.seedAdmin({ email: adminEmail, password: process.env.APP_PASSWORD });
  if (seeded) console.log(`[users] compte admin initial créé : ${seeded.email}`);
  else console.warn("[users] impossible de créer l'admin (ADMIN_EMAIL/GMAIL_USER + APP_PASSWORD requis)");
}
// Uploads : mémoire, 20 Mo max, allowlist d'extensions.
// Deux périmètres : IMPORT (données à parser) strict ; GED (preuves Qualiopi) large + images/scans.
const IMPORT_EXT = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md"]);
const DOC_EXT = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".odt", ".ods", ".ppt", ".pptx"]);
function makeUpload(extSet) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const name = file.originalname || "";
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      // Refuse doubles extensions suspectes (ex. "facture.pdf.exe") et extensions hors liste.
      if (!extSet.has(ext) || /\.(exe|sh|bat|cmd|js|php|html?|svg|zip)\./i.test(name)) {
        return cb(new Error("type de fichier non autorisé"));
      }
      cb(null, true);
    },
  });
}
const uploadImport = makeUpload(IMPORT_EXT);
const uploadDocMw = makeUpload(DOC_EXT);
// Wrapper : transforme l'erreur de filtre/limite en 400 JSON propre (au lieu d'une 500 HTML).
function uploadWrap(mw, label) {
  return (req, res, next) => mw.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === "type de fichier non autorisé" ? `Type de fichier non autorisé (${label}).` : "Fichier trop volumineux (max 20 Mo)." });
    next();
  });
}
const uploadOne = uploadWrap(uploadImport, "PDF, Word, Excel, CSV, texte");
const uploadDoc = uploadWrap(uploadDocMw, "PDF, Office, image, scan");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // derrière le reverse-proxy nginx (req.hostname pour WebAuthn RP ID)
// En-tetes de securite
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use((req, res, next) => { res.on("finish", () => console.log(new Date().toISOString(), req.method, req.url, "->", res.statusCode)); next(); });
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());

// --- Protection CSRF (double-submit) : toute mutation exige X-CSRF-Token == cookie ac_csrf ---
// Exemptés : lecture (GET/HEAD/OPTIONS) et routes pré-auth (pas encore de session/token).
const CSRF_EXEMPT = new Set(["/api/login", "/api/forgot", "/api/reset", "/api/webauthn/login/options", "/api/webauthn/login/verify"]);
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (CSRF_EXEMPT.has(req.path)) return next();
  if (!csrfValid(req)) return res.status(403).json({ error: "Requête refusée (jeton de sécurité invalide). Recharge la page." });
  next();
});

// --- Validation métier globale : borne les champs numériques connus sur toute mutation ---
// validateBody ne vérifie que les champs présents ayant une règle (no-op sinon) → sûr en global.
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const v = validateBody(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
  }
  next();
});

// --- Auth & rôles ---
function requireAuth(req, res, next) {
  const uid = sessionUserId(req);
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const user = userstore.getUserFull(uid);
  if (!user || user.active === false) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "réservé à l'administrateur" });
  next();
}
// null = admin (accès total) ; sinon liste blanche de campusIds
function allowedCampusIds(req) { return req.user?.role === "admin" ? null : (req.user?.campusIds || []); }
function canCampus(req, campusId) { const a = allowedCampusIds(req); return a === null || a.includes(campusId); }
function assertCampus(req, res, campusId) {
  if (canCampus(req, campusId)) return true;
  res.status(403).json({ error: "accès non autorisé à ce campus" });
  return false;
}
// filtre une liste d'objets ayant campusId selon le périmètre
function scopeByCampus(req, items) {
  const a = allowedCampusIds(req);
  return a === null ? items : items.filter((x) => x.campusId && a.includes(x.campusId));
}
// journal d'audit (traçabilité mutations) — best-effort, ne doit jamais casser une requête
function logAudit(req, action, target, detail) {
  try { store.addAudit({ userId: req.user?.id, userName: req.user?.name || req.user?.email || "", action, target, detail }); } catch { /* ignore */ }
}

// --- Auth (multi-utilisateurs) ---
const loginFails = new Map(); // ip -> { count, until }
function throttled(ip) { const f = loginFails.get(ip); return f && f.until > Date.now(); }
function recordFail(ip) {
  const f = loginFails.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) { f.until = Date.now() + 30000; f.count = 0; }
  loginFails.set(ip, f);
}
const clientIp = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "?";
const resetCodes = new Map(); // email -> { code, exp }

app.post("/api/login", (req, res) => {
  const ip = clientIp(req);
  if (throttled(ip)) return res.status(429).json({ error: "Trop de tentatives. Réessaie dans 30 secondes." });
  const { email, password } = req.body || {};
  const user = email ? userstore.getUserByEmail(email) : null;
  if (!user || !userstore.verifyUserPassword(user, password || "")) {
    recordFail(ip);
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }
  if (user.active === false) { recordFail(ip); return res.status(403).json({ error: "Compte désactivé. Contacte l'administrateur." }); }
  loginFails.delete(ip);
  issueCookie(res, user.id);
  issueCsrf(req, res);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { clearCookie(res); res.json({ ok: true }); });

// Changer son propre mot de passe (connecté)
app.post("/api/change-password", requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!userstore.verifyUserPassword(req.user, current || "")) return res.status(400).json({ error: "Mot de passe actuel incorrect" });
  if (!next || String(next).length < 8) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères" });
  userstore.setUserPasswordById(req.user.id, next);
  res.json({ ok: true });
});

// --- Face ID / passkey (WebAuthn) ---
const waChal = new Map(); // token -> { challenge, ts } (TTL 5 min)
const rpIdOf = (req) => process.env.RP_ID || req.hostname;
function pruneChal() { const now = Date.now(); for (const [k, v] of waChal) if (now - v.ts > 5 * 60 * 1000) waChal.delete(k); }
app.get("/api/webauthn/credentials", requireAuth, (req, res) => res.json(userstore.listCredentials(req.user.id)));
app.delete("/api/webauthn/credentials/:id", requireAuth, (req, res) => { userstore.deleteCredential(req.user.id, req.params.id); logAudit(req, "delete", "passkey", req.params.id.slice(0, 8)); res.json({ ok: true }); });
app.post("/api/webauthn/register/options", requireAuth, async (req, res) => {
  pruneChal();
  const rpID = rpIdOf(req);
  const creds = userstore.getUserCredentials(req.user.id);
  const options = await generateRegistrationOptions({
    rpName: "Campus Manager", rpID, userID: req.user.id, userName: req.user.email, userDisplayName: req.user.name || req.user.email,
    attestationType: "none",
    excludeCredentials: creds.map((c) => ({ id: isoBase64URL.toBuffer(c.id), type: "public-key", transports: c.transports || undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred", authenticatorAttachment: "platform" },
  });
  waChal.set("reg:" + req.user.id, { challenge: options.challenge, ts: Date.now() });
  res.json(options);
});
app.post("/api/webauthn/register/verify", requireAuth, async (req, res) => {
  const rpID = rpIdOf(req), origin = `https://${rpID}`;
  const rec = waChal.get("reg:" + req.user.id);
  if (!rec) return res.status(400).json({ error: "session expirée, réessaie" });
  try {
    const v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge: rec.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: "vérification échouée" });
    const { credentialID, credentialPublicKey, counter } = v.registrationInfo;
    userstore.addCredential(req.user.id, { id: isoBase64URL.fromBuffer(credentialID), publicKey: isoBase64URL.fromBuffer(credentialPublicKey), counter, transports: req.body.response?.response?.transports || [], deviceName: req.body.deviceName || "Cet appareil" });
    waChal.delete("reg:" + req.user.id);
    logAudit(req, "create", "passkey", req.body.deviceName || "");
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/webauthn/login/options", async (req, res) => {
  pruneChal();
  const rpID = rpIdOf(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" }); // usernameless (resident key)
  const waid = crypto.randomBytes(16).toString("hex");
  waChal.set("auth:" + waid, { challenge: options.challenge, ts: Date.now() });
  res.json({ options, waid });
});
app.post("/api/webauthn/login/verify", async (req, res) => {
  const rpID = rpIdOf(req), origin = `https://${rpID}`;
  const { response, waid } = req.body || {};
  const rec = waChal.get("auth:" + waid);
  if (!rec) return res.status(400).json({ error: "session expirée" });
  const user = userstore.findUserByCredential(response?.id);
  const cred = user && (user.credentials || []).find((c) => c.id === response.id);
  if (!user || user.active === false || !cred) return res.status(400).json({ error: "clé non reconnue" });
  try {
    const v = await verifyAuthenticationResponse({ response, expectedChallenge: rec.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false, authenticator: { credentialID: isoBase64URL.toBuffer(cred.id), credentialPublicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter } });
    if (!v.verified) return res.status(400).json({ error: "authentification échouée" });
    userstore.updateCredentialCounter(user.id, cred.id, v.authenticationInfo.newCounter);
    waChal.delete("auth:" + waid);
    issueCookie(res, user.id);
    issueCsrf(req, res);
    res.json({ ok: true, user: userstore.getUser(user.id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Mot de passe oublié : code envoyé à l'email du compte
app.post("/api/forgot", async (req, res) => {
  const ip = clientIp(req);
  if (throttled(ip)) return res.status(429).json({ error: "Trop de tentatives, patiente un peu." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = email ? userstore.getUserByEmail(email) : null;
  // réponse identique que le compte existe ou non (anti-énumération), sauf config manquante
  if (!mailConfigured) return res.status(400).json({ error: "L'envoi d'email n'est pas configuré sur le serveur." });
  if (user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    resetCodes.set(email, { code, exp: Date.now() + 15 * 60 * 1000 });
    try {
      await sendMail({ to: user.email, subject: "Campus Manager — code de réinitialisation", html: `<div style="font-family:Arial,sans-serif;color:#0D1B2A;"><p>Ton code de réinitialisation (valable 15 minutes) :</p><p style="font-size:26px;font-weight:800;letter-spacing:6px;color:#0B6E5F;">${code}</p><p style="color:#5A6672;font-size:13px;">Si tu n'es pas à l'origine de cette demande, ignore ce message.</p></div>` });
    } catch (e) { console.error("[forgot]", e?.message || e); }
  }
  res.json({ ok: true, hint: "Si un compte existe pour cet email, un code vient d'être envoyé." });
});

app.post("/api/reset", (req, res) => {
  const ip = clientIp(req);
  if (throttled(ip)) return res.status(429).json({ error: "Trop de tentatives, patiente un peu." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { code, password } = req.body || {};
  const entry = resetCodes.get(email);
  if (!entry || entry.exp < Date.now() || entry.code !== String(code || "")) { recordFail(ip); return res.status(400).json({ error: "Code invalide ou expiré" }); }
  if (!password || String(password).length < 8) return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  const user = userstore.getUserByEmail(email);
  if (!user) return res.status(400).json({ error: "Compte introuvable" });
  userstore.setUserPasswordById(user.id, password);
  resetCodes.delete(email);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const uid = sessionUserId(req);
  const user = uid ? userstore.getUser(uid) : null;
  if (user) issueCsrf(req, res); // garantit le cookie CSRF pour les sessions déjà ouvertes
  res.json({
    authed: !!user,
    user: user ? { id: user.id, name: user.name, email: user.email, role: user.role, campusIds: user.campusIds } : null,
    tasks: Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, { label: v.label, structured: !!v.structured }])),
    visitVariants: Object.entries(VISIT_VARIANTS).map(([key, v]) => ({ key, label: v.label })),
  });
});

// --- Gestion des utilisateurs (admin) ---
app.get("/api/users", requireAuth, requireAdmin, (req, res) => res.json(userstore.listUsers()));
app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
  try { const u = userstore.addUser(req.body || {}); logAudit(req, "create", "user", u.email || u.name || ""); res.json(u); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  try {
    const before = userstore.getUser(req.params.id);
    const u = userstore.updateUser(req.params.id, req.body || {});
    if (!u) return res.status(404).json({ error: "introuvable" });
    const ch = [];
    if (before && before.role !== u.role) ch.push(`rôle ${before.role}→${u.role}`);
    if (before && before.active !== u.active) ch.push(u.active ? "réactivé" : "désactivé");
    if (before && JSON.stringify(before.campusIds || []) !== JSON.stringify(u.campusIds || [])) ch.push(`campus (${(u.campusIds || []).length})`);
    if (req.body?.password) ch.push("mot de passe réinitialisé");
    logAudit(req, "update", "user", `${u.email}${ch.length ? " — " + ch.join(", ") : ""}`);
    res.json(u);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Impossible de supprimer son propre compte" });
  const gone = userstore.listUsers().find((u) => u.id === req.params.id);
  userstore.deleteUser(req.params.id); logAudit(req, "delete", "user", gone?.email || req.params.id); res.json({ ok: true });
});

// --- Campus ---
app.get("/api/campuses", requireAuth, (req, res) => {
  const a = allowedCampusIds(req);
  res.json(store.listCampuses().filter((c) => a === null || a.includes(c.id)));
});
app.post("/api/campuses", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.name || !String(req.body.name).trim()) return res.status(400).json({ error: "nom requis" });
  const c = store.addCampus(req.body); logAudit(req, "create", "campus", c.name);
  res.json(c);
});
// Garde de cloisonnement pour toute route ciblant un campus précis
const campusGuard = [requireAuth, (req, res, next) => { if (!assertCampus(req, res, req.params.id)) return; next(); }];
app.patch("/api/campuses/:id", campusGuard, (req, res) => {
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const c = store.updateCampus(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "campus", c.name);
  res.json(c);
});
app.delete("/api/campuses/:id", requireAuth, requireAdmin, (req, res) => { const c = store.listCampuses().find((x) => x.id === req.params.id); store.deleteCampus(req.params.id); logAudit(req, "delete", "campus", c?.name || req.params.id); res.json({ ok: true }); });
app.post("/api/campuses/:id/contacts", campusGuard, (req, res) => {
  const c = store.addContact(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "campus introuvable" });
  res.json(c);
});
app.delete("/api/campuses/:id/contacts/:cid", campusGuard, (req, res) => { store.deleteContact(req.params.id, req.params.cid); res.json({ ok: true }); });
app.patch("/api/campuses/:id/objectives", campusGuard, (req, res) => {
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const r = store.updateCampusPart(req.params.id, "objectives", req.body || {}, ["students", "revenue", "margin"]);
  if (!r) return res.status(404).json({ error: "introuvable" }); res.json(r);
});
app.patch("/api/campuses/:id/admissions", campusGuard, (req, res) => {
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const r = store.updateCampusPart(req.params.id, "admissions", req.body || {}, ["objectif", "candidatures", "entretiens", "admis", "inscrits"]);
  if (!r) return res.status(404).json({ error: "introuvable" }); res.json(r);
});
app.patch("/api/campuses/:id/director-review", campusGuard, (req, res) => {
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const r = store.updateCampusPart(req.params.id, "directorReview", req.body || {}, ["confidence"]);
  if (!r) return res.status(404).json({ error: "introuvable" }); res.json(r);
});
// Mémoire opérationnelle d'un campus : événements chronologiques toutes sources confondues.
app.get("/api/campuses/:id/timeline", campusGuard, (req, res) => {
  const cid = req.params.id;
  const ev = [];
  const push = (date, type, label) => { if (date && label) ev.push({ date: String(date).slice(0, 10), type, label }); };
  for (const d of store.listDeliverables({ campusId: cid })) push(d.createdAt, "livrable", d.title);
  for (const v of store.listVisits().filter((x) => x.campusId === cid)) push(v.date, "visite", `Visite${v.type ? " — " + v.type : ""}`);
  for (const i of store.listIncidents({ campusId: cid })) push(i.date, i.kind === "reclamation" ? "reclamation" : "incident", `${i.severity ? i.severity + " — " : ""}${i.title}`);
  for (const a of store.listActions({ campusId: cid })) { push(a.createdAt, "action", `Action ouverte : ${a.title}`); if (a.status === "done") push(a.updatedAt || a.createdAt, "action-done", `Action clôturée : ${a.title}`); }
  for (const d of store.listDecisions().filter((x) => x.campusId === cid)) push(d.decidedAt, "decision", `Décision : ${d.title}`);
  for (const r of store.listReviews(cid)) push(r.month + "-01", "revue", `Revue mensuelle (${r.month})`);
  for (const e of store.listEvents(cid)) push(e.date, "evenement", `${(e.type || "").toUpperCase()}${e.title ? " : " + e.title : ""}`);
  const q = store.getQualiopi(cid);
  if (q?.lastAudit) push(q.lastAudit, "qualiopi", "Audit Qualiopi");
  ev.sort((a, b) => b.date.localeCompare(a.date));
  res.json(ev.slice(0, 200));
});
app.patch("/api/campuses/:id/filieres", campusGuard, (req, res) => {
  const r = store.setFilieres(req.params.id, req.body?.filieres || []);
  if (r === null) return res.status(404).json({ error: "introuvable" }); res.json(r);
});

// --- Incidents & réclamations ---
app.get("/api/incidents", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listIncidents({ campusId: req.query.campusId, kind: req.query.kind, status: req.query.status }))));
app.post("/api/incidents", requireAuth, (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "titre requis" });
  if (allowedCampusIds(req) !== null && !assertCampus(req, res, req.body.campusId)) return;
  const inc = store.addIncident(req.body); logAudit(req, "create", "incident", inc.title);
  res.json(inc);
});
app.patch("/api/incidents/:id", requireAuth, (req, res) => {
  const cur = store.listIncidents().find((x) => x.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, cur.campusId)) return;
  const upd = store.updateIncident(req.params.id, req.body || {});
  if (req.body?.status && req.body.status !== cur.status) logAudit(req, "update", "incident", `${cur.title} → ${req.body.status}`);
  res.json(upd);
});
app.delete("/api/incidents/:id", requireAuth, (req, res) => {
  const cur = store.listIncidents().find((x) => x.id === req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  store.deleteIncident(req.params.id); res.json({ ok: true });
});

// --- Cockpit : ce qui mérite l'attention aujourd'hui ---
app.get("/api/attention", requireAuth, (req, res) => {
  const rows = buildNetworkRows(req);
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const actions = scopeByCampus(req, store.listActions());
  const overdueActions = actions.filter((a) => a.status !== "done" && a.dueDate && a.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueSoon = actions.filter((a) => a.status !== "done" && a.dueDate && a.dueDate >= today && a.dueDate <= in14).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const atRisk = rows.filter((r) => (r.occupancy != null && r.occupancy < 70) || (r.qualiopi != null && r.qualiopi < 80) || r.overdue > 0)
    .map((r) => ({ name: r.name, city: r.city, reasons: [r.occupancy != null && r.occupancy < 70 ? `Remplissage ${r.occupancy} %` : "", r.qualiopi != null && r.qualiopi < 80 ? `Qualiopi ${r.qualiopi} %` : "", r.overdue > 0 ? `${r.overdue} action(s) en retard` : ""].filter(Boolean) }));
  res.json({
    overdueActions: overdueActions.slice(0, 10).map((a) => ({ title: a.mesures || a.title, campus: a.campusName || "", dueDate: a.dueDate, owner: a.owner || "" })),
    dueSoon: dueSoon.slice(0, 10).map((a) => ({ title: a.mesures || a.title, campus: a.campusName || "", dueDate: a.dueDate, owner: a.owner || "" })),
    atRisk,
    openIncidents: store.listIncidents({ status: "open" }).length,
  });
});

// Calendrier consolidé : tout ce qui a une date sur le réseau
app.get("/api/calendar", requireAuth, (req, res) => {
  const allow = allowedCampusIds(req);
  const campuses = store.listCampuses().filter((c) => allow === null || allow.includes(c.id));
  const byId = Object.fromEntries(campuses.map((c) => [c.id, c.name]));
  const today = new Date().toISOString().slice(0, 10);
  const events = [];
  for (const a of scopeByCampus(req, store.listActions())) {
    if (a.status !== "done" && a.dueDate) {
      events.push({ date: a.dueDate, type: a.category === "qualiopi" ? "controle" : "action", label: a.title, owner: a.owner || "", campus: a.campusName || (a.campusId ? byId[a.campusId] : "") || "", overdue: a.dueDate < today });
    }
  }
  for (const c of campuses) {
    const q = c.qualiopi || {};
    if (q.nextSurveillance) events.push({ date: q.nextSurveillance, type: "controle", label: "Audit de surveillance Qualiopi", campus: c.name, overdue: q.nextSurveillance < today });
    if (q.renewalDate) events.push({ date: q.renewalDate, type: "controle", label: "Renouvellement Qualiopi", campus: c.name, overdue: q.renewalDate < today });
  }
  // dé-doublonnage (même date + libellé + campus)
  const seen = new Set();
  const dedup = events.filter((e) => { const k = `${e.date}|${e.label}|${e.campus}`; if (seen.has(k)) return false; seen.add(k); return true; });
  dedup.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  res.json(dedup);
});

// Suivi des directeurs
app.get("/api/directors", requireAuth, (req, res) => {
  const allow = allowedCampusIds(req);
  res.json(store.listCampuses().filter((c) => allow === null || allow.includes(c.id)).map((c) => {
    const dir = (c.contacts || []).find((k) => k.category === "direction");
    return {
      campusId: c.id, campusName: c.name, city: c.city || "",
      director: dir ? [dir.firstName, dir.lastName].filter(Boolean).join(" ") : "",
      email: dir?.email || "", phone: dir?.phone || "",
      review: c.directorReview || null,
    };
  }));
});

// --- Historique livrables ---
app.get("/api/deliverables", requireAuth, (req, res) => {
  res.json(scopeByCampus(req, store.listDeliverables({ campusId: req.query.campusId, task: req.query.task })));
});
app.get("/api/deliverables/:id", requireAuth, (req, res) => {
  const d = store.getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, d.campusId)) return;
  res.json(d);
});
app.delete("/api/deliverables/:id", requireAuth, (req, res) => {
  const d = store.getDeliverable(req.params.id);
  if (d && !assertCampus(req, res, d.campusId)) return;
  store.deleteDeliverable(req.params.id); res.json({ ok: true });
});

// --- Export ---
app.get("/api/deliverables/:id/export", requireAuth, async (req, res) => {
  const d = store.getDeliverable(req.params.id);
  if (!d) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, d.campusId)) return;
  const fmt = req.query.format || "md";
  const safe = (d.title || "livrable").replace(/[^\w\-À-ÿ ]+/g, "").slice(0, 60).trim() || "livrable";
  try {
    if (fmt === "md") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safe}.md"`);
      return res.send(toMarkdown(d));
    }
    if (fmt === "print") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(toHtml(d));
    }
    if (fmt === "docx") {
      const buf = await toDocx(d);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safe}.docx"`);
      return res.send(Buffer.from(buf));
    }
    res.status(400).json({ error: "format inconnu" });
  } catch (e) {
    console.error("[export]", e?.message || e);
    res.status(500).json({ error: "export impossible" });
  }
});

// --- Import fichier (Excel/PDF/texte) ---
app.post("/api/upload", requireAuth, uploadOne, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "aucun fichier" });
  try {
    const text = await extractText(req.file.buffer, req.file.originalname);
    res.json({ filename: req.file.originalname, chars: text.length, text: text.slice(0, 200000) });
  } catch (e) {
    console.error("[upload]", e?.message || e);
    res.status(400).json({ error: "extraction impossible : " + (e?.message || "") });
  }
});

// --- Plans d'action ---
app.get("/api/actions", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listActions({ status: req.query.status, campusId: req.query.campusId }))));
app.post("/api/actions", requireAuth, (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "intitulé requis" });
  if (allowedCampusIds(req) !== null && !assertCampus(req, res, req.body.campusId)) return;
  const a = store.addAction(req.body); logAudit(req, "create", "action", a.title);
  res.json(a);
});
app.patch("/api/actions/:id", requireAuth, (req, res) => {
  const cur = store.listActions().find((x) => x.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, cur.campusId)) return;
  const updated = store.updateAction(req.params.id, req.body || {});
  if (req.body?.status && req.body.status !== cur.status) logAudit(req, "update", "action", `${cur.title} → ${req.body.status}`);
  res.json(updated);
});
app.delete("/api/actions/:id", requireAuth, (req, res) => {
  const cur = store.listActions().find((x) => x.id === req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  store.deleteAction(req.params.id); res.json({ ok: true });
});

// --- Qualiopi ---
app.get("/api/qualiopi/reference", requireAuth, (req, res) => res.json({ reference: QUALIOPI_REFERENCE, statuses: QUALIOPI_STATUSES }));
app.get("/api/campuses/:id/qualiopi", campusGuard, (req, res) => {
  const q = store.getQualiopi(req.params.id);
  if (!q) return res.status(404).json({ error: "campus introuvable" });
  res.json({ ...q, conformity: conformityRate(q.indicators || {}), control: computeControlDates(q.lastAudit) });
});
app.post("/api/campuses/:id/qualiopi/schedule", campusGuard, (req, res) => {
  const campus = store.listCampuses().find((c) => c.id === req.params.id);
  if (!campus) return res.status(404).json({ error: "campus introuvable" });
  const q = store.getQualiopi(req.params.id);
  const control = computeControlDates(q?.lastAudit);
  if (!control) return res.status(400).json({ error: "renseigne d'abord la date du dernier audit" });
  const existing = store.listActions({ campusId: campus.id });
  let created = 0;
  for (const cp of control.checkpoints) {
    if (existing.some((a) => a.title === cp.label && a.campusId === campus.id)) continue;
    store.addAction({ title: cp.label, dueDate: cp.dueDate, campusId: campus.id, campusName: campus.name, category: "qualiopi" });
    created++;
  }
  res.json({ ok: true, created });
});
app.patch("/api/campuses/:id/qualiopi", campusGuard, (req, res) => {
  const q = store.updateQualiopi(req.params.id, req.body || {});
  if (!q) return res.status(404).json({ error: "campus introuvable" });
  logAudit(req, "update", "qualiopi", store.listCampuses().find((c) => c.id === req.params.id)?.name || req.params.id);
  res.json({ ...q, conformity: conformityRate(q.indicators || {}) });
});

// --- Visites (cadence) ---
app.get("/api/visits", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listVisits(req.query.campusId))));
app.post("/api/visits", requireAuth, (req, res) => {
  if (!req.body?.campusId) return res.status(400).json({ error: "campus requis" });
  if (!assertCampus(req, res, req.body.campusId)) return;
  res.json(store.addVisit(req.body));
});
app.delete("/api/visits/:id", requireAuth, (req, res) => {
  const cur = store.listVisits().find((x) => x.id === req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  store.deleteVisit(req.params.id); res.json({ ok: true });
});

// --- KPI mensuels ---
app.get("/api/kpi", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listKpi(req.query.campusId))));
app.post("/api/kpi", requireAuth, (req, res) => {
  if (!req.body?.campusId || !req.body?.month) return res.status(400).json({ error: "campus et mois requis" });
  if (!assertCampus(req, res, req.body.campusId)) return;
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  res.json(store.addKpi(req.body));
});
app.delete("/api/kpi/:id", requireAuth, (req, res) => {
  const cur = store.listKpi().find((x) => x.id === req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  store.deleteKpi(req.params.id); res.json({ ok: true });
});

// Digest hebdo (test manuel)
app.post("/api/weekly-test", requireAuth, requireAdmin, async (req, res) => {
  if (!alertCfg.to || !mailConfigured) return res.status(400).json({ ok: false, error: "Email non configuré (ALERT_TO + MAIL_HOST ou GMAIL_*)" });
  try { res.json({ ok: true, ...(await sendWeeklyDigest({ ...alertCfg, alwaysSend: true })) }); }
  catch (e) { console.error("[weekly]", e?.message || e); res.status(500).json({ ok: false, error: e?.message || "envoi impossible" }); }
});

// --- Vue réseau consolidée ---
function buildNetworkRows(req) {
  const a = allowedCampusIds(req);
  const campuses = store.listCampuses().filter((c) => a === null || a.includes(c.id));
  const actions = store.listActions();
  const incidents = store.listIncidents({ status: "open" });
  const lastVisits = store.lastVisitByCampus();
  const today = new Date().toISOString().slice(0, 10);
  const monthsSince = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / (30 * 864e5)) : null);
  return campuses.map((c) => {
    const q = c.qualiopi ? conformityRate(c.qualiopi.indicators || {}) : null;
    const openActions = actions.filter((a) => a.campusId === c.id && a.status !== "done").length;
    const overdue = actions.filter((a) => a.campusId === c.id && a.status !== "done" && a.dueDate && a.dueDate < today).length;
    const openIncidents = incidents.filter((i) => i.campusId === c.id).length;
    const lv = lastVisits[c.id];
    const cadence = c.visitCadenceMonths || 6;
    const director = (c.contacts || []).find((k) => k.category === "direction");
    const k = store.latestKpi(c.id) || {};
    const filSum = (key) => (c.filieres && c.filieres.length ? (c.filieres.reduce((s, f) => s + (f[key] || 0), 0) || null) : null);
    // Source unique effectif : filières → fiche campus → dernier KPI mensuel.
    const students = filSum("effectif") ?? c.students ?? k.students ?? null;
    const capacity = filSum("capacite") ?? c.capacity ?? null;
    const occupancy = capacity && students ? Math.round((students / capacity) * 100) : (k.occupancy ?? null);
    const visitDue = lv?.date ? monthsSince(lv.date) >= cadence : true;
    const h = healthScore({ occupancy, qualiopi: q, overdue, visitDue, satisfaction: k.satisfaction, openIncidents });
    return {
      id: c.id, name: c.name, city: c.city || "", students, capacity, occupancy,
      qualiopi: q, openActions, overdue, openIncidents,
      satisfaction: k.satisfaction ?? null, insertionRate: k.insertionRate ?? null, health: h.score, healthDetail: h.detail, healthInsufficient: h.insufficient,
      director: director ? [director.firstName, director.lastName].filter(Boolean).join(" ") : "",
      lastVisit: lv?.date || null, monthsSinceVisit: monthsSince(lv?.date), cadence, visitDue,
      objectives: c.objectives || null, admissions: c.admissions || null,
    };
  });
}
app.get("/api/network", requireAuth, (req, res) => res.json(buildNetworkRows(req)));

// Resume des KPI financiers depuis le dernier P&L d'un campus
function kpiSummary(content) {
  const m = (content || "").match(/```json\s*([\s\S]*?)```/);
  if (!m) return "";
  try { const d = JSON.parse(m[1]); if (Array.isArray(d.kpis)) return d.kpis.map((k) => `${k.label}: ${k.value}`).join(" · "); } catch { /* ignore */ }
  return "";
}

// Signature des données réseau : change dès qu'une donnée pertinente évolue.
function networkSignature() {
  const campuses = store.listCampuses().map((c) => ({ id: c.id, n: c.name, s: c.students, cap: c.capacity, city: c.city, q: c.qualiopi?.indicators || null, la: c.qualiopi?.lastAudit || "", ct: (c.contacts || []).length }));
  const actions = store.listActions().map((a) => ({ id: a.id, st: a.status, dd: a.dueDate, c: a.campusId }));
  const visits = store.listVisits().map((v) => ({ id: v.id, d: v.date, c: v.campusId }));
  const kpi = store.listKpi().map((k) => `${k.id}:${k.createdAt}`);
  const pnls = store.listCampuses().map((c) => { const p = store.latestDeliverable(c.id, "pnl"); return p ? `${c.id}:${p.id}:${p.createdAt}` : c.id; });
  return crypto.createHash("sha256").update(JSON.stringify({ campuses, actions, visits, kpi, pnls })).digest("hex");
}

// --- Pack CODIR / synthèse réseau (streaming + sauvegarde) ---
app.post("/api/network/synthese", requireAuth, requireAdmin, async (req, res) => {
  const rows = buildNetworkRows(req);
  if (!rows.length) return res.status(400).json({ error: "Aucun campus à consolider" });
  const force = req.body?.force === true;
  const sig = networkSignature();
  if (!force) {
    const last = store.latestDeliverable(null, "synthese_reseau");
    if (last && last.signature === sig) {
      return res.json({ upToDate: true, id: last.id, createdAt: last.createdAt, title: last.title });
    }
  }
  const lines = rows.map((r) => {
    const pnl = store.latestDeliverable(r.id, "pnl");
    const fin = pnl ? kpiSummary(pnl.content) : "";
    return `- ${r.name}${r.city ? ` (${r.city})` : ""} : sante ${r.health != null ? r.health + "/100" : "?"} ; ${r.students ?? "?"} etudiants / ${r.capacity ?? "?"} places${r.occupancy != null ? ` (${r.occupancy}%)` : ""} ; Qualiopi ${r.qualiopi != null ? r.qualiopi + "%" : "non renseigne"} ; ${r.openActions} actions ouvertes dont ${r.overdue} en retard ; ${r.openIncidents || 0} incident(s) ouvert(s) ; derniere visite ${r.lastVisit || "jamais"} ; directeur ${r.director || "-"}${fin ? ` ; dernier P&L -> ${fin}` : " ; P&L: aucun"}`;
  });
  const totS = rows.reduce((s, r) => s + (r.students || 0), 0);
  const totC = rows.reduce((s, r) => s + (r.capacity || 0), 0);
  // Finance consolidée
  let totRev = 0, totBud = 0, totMargin = 0, hasFin = false;
  const finLines = rows.map((r) => {
    const hist = store.listKpi(r.id); const k = hist[hist.length - 1] || {};
    if (k.revenue == null) return null;
    hasFin = true; const marge = marginOf(k);
    totRev += k.revenue; totBud += k.revenueBudget || 0; totMargin += marge || 0;
    return `- ${r.name} : CA ${k.revenue}EUR${k.revenueBudget ? ` (budget ${k.revenueBudget}, ecart ${Math.round(((k.revenue - k.revenueBudget) / k.revenueBudget) * 100)}%)` : ""}${marge != null ? ` ; marge ${marge}EUR` : ""}`;
  }).filter(Boolean);
  const finBlock = hasFin ? `\n\nFinance (dernier mois) :\n${finLines.join("\n")}\nTotal reseau : CA ${totRev}EUR${totBud ? ` / budget ${totBud}EUR (ecart ${Math.round(((totRev - totBud) / totBud) * 100)}%)` : ""} ; marge ${totMargin}EUR${totRev ? ` (${Math.round((totMargin / totRev) * 100)}%)` : ""}.` : "";
  // OKR réseau
  const okr = store.listNetworkObjectives();
  const okrBlock = okr.length ? `\n\nObjectifs reseau (OKR) :\n${okr.map((o) => `- ${o.titre}${o.cible ? ` (cible ${o.cible})` : ""}${o.echeance ? ` [${o.echeance}]` : ""}` + (o.resultats || []).map((kr) => `\n    · ${kr.libelle}${kr.avancement != null ? ` : ${kr.avancement}%` : ""}`).join("")).join("\n")}` : "";
  const dataBlock = `Reseau : ${rows.length} campus.\n${lines.join("\n")}\n\nTotaux effectifs : ${totS} etudiants / ${totC} places${totC ? ` (remplissage moyen ${Math.round((totS / totC) * 100)}%)` : ""}.${finBlock}${okrBlock}`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  let full = "";
  try {
    const stream = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 9000, stream: true,
      messages: [{ role: "system", content: SYNTHESE_RESEAU }, { role: "user", content: `Date : ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}\n\nDonnees consolidees :\n${dataBlock}` }],
    });
    for await (const chunk of stream) { const d = chunk.choices?.[0]?.delta?.content; if (d) { full += d; res.write(d); } }
    if (full.trim()) {
      const d = store.addDeliverable({ task: "synthese_reseau", title: `Synthèse réseau — ${new Date().toLocaleDateString("fr-FR")}`, content: full, model: PROMPTS.pnl.model, signature: sig });
      res.write(`\n<!--deliverable:${d.id}-->`);
    }
    res.end();
  } catch (err) {
    console.error("[synthese]", err?.message || err);
    if (!res.headersSent) res.status(500);
    res.write(`\n\n[ERREUR] ${err?.message || "generation impossible"}`); res.end();
  }
});

// --- Fiche 360° d'un campus ---
app.get("/api/campus360/:id", campusGuard, (req, res) => {
  const campus = store.listCampuses().find((c) => c.id === req.params.id);
  if (!campus) return res.status(404).json({ error: "campus introuvable" });
  const today = new Date().toISOString().slice(0, 10);
  const actions = store.listActions({ campusId: campus.id });
  res.json({
    campus,
    row: buildNetworkRows(req).find((r) => r.id === campus.id),
    qualiopi: campus.qualiopi ? { conformity: conformityRate(campus.qualiopi.indicators || {}), lastAudit: campus.qualiopi.lastAudit || "", nextSurveillance: campus.qualiopi.nextSurveillance || "", renewalDate: campus.qualiopi.renewalDate || "" } : null,
    actions: { open: actions.filter((a) => a.status !== "done"), overdue: actions.filter((a) => a.status !== "done" && a.dueDate && a.dueDate < today) },
    deliverables: store.listDeliverables({ campusId: campus.id }).slice(0, 6),
    kpi: store.listKpi(campus.id),
    visits: store.listVisits(campus.id).slice(0, 5),
  });
});

// --- Assistant chat (persona DO senior, zéro hallucination, contexte réseau scopé) ---
app.post("/api/chat", requireAuth, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
  if (!messages.length) return res.status(400).json({ error: "message vide" });
  const rows = buildNetworkRows(req);
  let ctx = "Aucun campus renseigné pour l'instant dans l'outil.";
  if (rows.length) {
    const lignes = rows.map((r) => {
      const hist = store.listKpi(r.id); const k = hist[hist.length - 1] || {};
      const marge = marginOf(k);
      const fin = k.revenue != null ? ` ; CA ${k.revenue}€${k.revenueBudget ? ` (budget ${k.revenueBudget}€, écart ${Math.round(((k.revenue - k.revenueBudget) / k.revenueBudget) * 100)}%)` : ""}${marge != null ? `, marge ${marge}€` : ""}` : "";
      const perf = k.satisfaction != null || k.insertionRate != null ? ` ; satisfaction ${k.satisfaction ?? "?"}/10, insertion ${k.insertionRate != null ? k.insertionRate + "%" : "?"}` : "";
      const alt = store.listPartners(r.id); const nAlt = alt.reduce((s, p) => s + (p.alternants || 0), 0);
      const ent = alt.length ? ` ; ${alt.length} entreprise(s) partenaire(s), ${nAlt} alternant(s)` : "";
      return `- ${r.name}${r.city ? ` (${r.city})` : ""} : santé ${r.health ?? "?"}/100 ; ${r.students ?? "?"} étudiants${r.capacity ? `/${r.capacity} places` : ""}${r.occupancy != null ? ` (${r.occupancy}%)` : ""} ; Qualiopi ${r.qualiopi != null ? r.qualiopi + "%" : "non renseigné"} ; ${r.openActions} actions ouvertes dont ${r.overdue} en retard${r.openIncidents ? ` ; ${r.openIncidents} incident(s)` : ""}${r.director ? ` ; directeur ${r.director}` : ""}${fin}${perf}${ent}`;
    });
    const okr = store.listNetworkObjectives();
    const okrTxt = okr.length ? "\n\nObjectifs réseau (OKR) :\n" + okr.map((o) => `- ${o.titre}${o.cible ? ` (cible ${o.cible})` : ""}${o.echeance ? ` — échéance ${o.echeance}` : ""}` + (o.resultats || []).map((kr) => `\n    · ${kr.libelle}${kr.avancement != null ? ` : ${kr.avancement}%` : ""}`).join("")).join("\n") : "";
    const today2 = new Date().toISOString().slice(0, 10);
    const ouv = store.listOpenings();
    const ouvTxt = ouv.length ? "\n\nOuvertures de campus (rétroplanning) :\n" + ouv.map((o) => {
      const t = o.tasks || []; const done = t.filter((x) => x.status === "done").length;
      const late = t.filter((x) => x.status !== "done" && x.dueDate && x.dueDate < today2).length;
      return `- ${o.name}${o.city ? ` (${o.city})` : ""} : statut ${o.status}${o.targetDate ? `, rentrée ${o.targetDate}` : ""} ; avancement ${t.length ? Math.round(done / t.length * 100) : 0}% (${done}/${t.length})${late ? ` ; ${late} tâche(s) en retard` : ""}`;
    }).join("\n") : "";
    const scen = store.listScenarios();
    const scenTxt = scen.length ? "\n\nScénarios de prospective (EBIT) : " + scen.map((s) => `${s.name} (objectif ${s.target}€)`).join(", ") : "";
    ctx = "Contexte réseau (données réelles — n'invente rien au-delà) :\n" + lignes.join("\n") + okrTxt + ouvTxt + scenTxt;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const stream = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 5000, stream: true,
      messages: [
        { role: "system", content: `${CHAT_ASSISTANT}\n\n${ctx}` },
        ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 6000) })),
      ],
    });
    for await (const chunk of stream) { const d = chunk.choices?.[0]?.delta?.content; if (d) res.write(d); }
    res.end();
  } catch (e) {
    console.error("[chat]", e?.message || e);
    if (!res.headersSent) res.status(500);
    res.write(`\n[ERREUR] ${e?.message || "réponse impossible"}`); res.end();
  }
});

// --- Tableau de bord ---
app.get("/api/stats", requireAuth, (req, res) => {
  const a = allowedCampusIds(req);
  if (a === null) return res.json(store.stats());
  const today = new Date().toISOString().slice(0, 10);
  const actions = scopeByCampus(req, store.listActions());
  res.json({
    campuses: store.listCampuses().filter((c) => a.includes(c.id)).length,
    deliverables: scopeByCampus(req, store.listDeliverables()).length,
    actionsOpen: actions.filter((x) => x.status !== "done").length,
    actionsOverdue: actions.filter((x) => x.status !== "done" && x.dueDate && x.dueDate < today).length,
  });
});

// --- Generation (streaming + sauvegarde historique) ---
app.post("/api/generate", requireAuth, async (req, res) => {
  const { task, input, contexte, campusId, title, variant } = req.body || {};
  if (!task || !PROMPTS[task]) return res.status(400).json({ error: "tache inconnue" });
  if (campusId && !assertCampus(req, res, campusId)) return;

  const isProposal = task === "ordre_du_jour" && variant && VISIT_VARIANTS[variant];
  if ((!input || !String(input).trim()) && !isProposal) return res.status(400).json({ error: "aucune donnee fournie" });

  // Garde anti-régénération pour les P&L : si les mêmes données ont déjà été
  // analysées pour ce campus, on ne régénère pas (sauf force).
  const force = req.body?.force === true;
  let pnlSig = null;
  if (task === "pnl" && campusId) {
    pnlSig = crypto.createHash("sha256").update(JSON.stringify({ campusId, input: (input || "").trim(), contexte: (contexte || "").trim() })).digest("hex");
    if (!force) {
      const last = store.latestDeliverable(campusId, "pnl");
      if (last && last.signature === pnlSig) {
        return res.json({ upToDate: true, id: last.id, createdAt: last.createdAt, title: last.title });
      }
    }
  }

  const campus = campusId ? store.listCampuses().find((c) => c.id === campusId) : null;
  const contacts = (campus?.contacts || []).filter((k) => k.firstName || k.lastName || k.role);
  const CAT_LABELS = { direction: "Direction", administratif: "Équipe administrative", professeur: "Professeurs", autre: "Autres interlocuteurs" };
  const line = (k) => `- ${[k.firstName, k.lastName].filter(Boolean).join(" ")}${k.role ? " — " + k.role : ""}${k.email ? ` <${k.email}>` : ""}${k.phone ? ` ${k.phone}` : ""}`;
  const contactsBlock = contacts.length
    ? `Interlocuteurs du campus (utilise-les comme participants par defaut, selon la pertinence du sujet) :\n` +
      ["direction", "administratif", "professeur", "autre"].map((cat) => {
        const grp = contacts.filter((k) => (k.category || "autre") === cat);
        return grp.length ? `${CAT_LABELS[cat]} :\n` + grp.map(line).join("\n") : "";
      }).filter(Boolean).join("\n")
    : "";

  // Consigne specifique au type de visite (ordre du jour)
  let system = systemFor(task);
  if (isProposal) {
    system += `\n\n## Type de visite demande\n${VISIT_VARIANTS[variant].guidance}\n\nPROPOSE un ordre du jour complet, concret et DIRECTEMENT EXPLOITABLE (deroule horaire avec horaires et durees proposes), incluant les temps relationnels/conviviaux avec le directeur de campus et l'equipe. Ne sature PAS le document de [A PRECISER] : seuls la date reelle et d'eventuels noms non fournis peuvent porter la mention "a definir" (une seule fois chacun). Horaires, sequences et durees sont proposes concretement, pas marques comme manquants. Reste chaleureux et pret a envoyer.`;
  }

  const obj = campus?.objectives || {};
  const objLine = [obj.students ? `effectif cible ${obj.students}` : "", obj.revenue ? `CA cible ${obj.revenue} €` : "", obj.margin ? `marge cible ${obj.margin} €` : ""].filter(Boolean).join(", ");
  const campusHeader = campus ? [
    `Campus concerné : ${campus.name}`,
    [campus.city, campus.region].filter(Boolean).length ? `Localisation : ${[campus.city, campus.region].filter(Boolean).join(", ")}` : "",
    campus.network ? `Réseau / groupe : ${campus.network}` : "",
    campus.address ? `Adresse (= lieu par défaut) : ${campus.address}` : "",
    campus.filieres?.length
      ? `Offre de formation par filière (initial = scolarité payée par l'étudiant ; alternance = financement OPCO/entreprise, nécessite un employeur) :\n${campus.filieres.map((f) => `  - ${f.type ? f.type + " " : ""}${f.nom}${f.niveau ? " (" + f.niveau + ")" : ""} [${f.modalite || "initial"}] : ${f.effectif ?? "?"} étudiants${f.capacite ? `/${f.capacite} places` : ""}${f.frais ? `, ${f.frais} €/an` : ""}`).join("\n")}` +
        (() => { const tot = campus.filieres.reduce((s, f) => s + (f.effectif || 0), 0); const alt = campus.filieres.filter((f) => f.modalite === "alternance").reduce((s, f) => s + (f.effectif || 0), 0); return tot ? `\n  Mix : ${Math.round((alt / tot) * 100)} % en alternance.` : ""; })()
      : (campus.students ? `Nombre d'étudiants : ${campus.students}` : ""),
    campus.capacity && !campus.filieres?.length ? `Capacité : ${campus.capacity} places${campus.students ? ` (remplissage ${Math.round((campus.students / campus.capacity) * 100)} %)` : ""}` : "",
    objLine ? `Objectifs (cibles) : ${objLine} — calcule les écarts réalisé vs cible.` : "",
    campus.email ? `Email campus : ${campus.email}` : "",
    campus.phone ? `Téléphone campus : ${campus.phone}` : "",
  ].filter(Boolean).join("\n") : "";

  // Pour un ordre du jour de visite : injecter le dernier compte rendu + les actions
  // non soldees du campus, pour que la visite parte du suivi.
  let suiviBlock = "";
  if (task === "ordre_du_jour" && campus) {
    const lastCR = store.latestDeliverable(campus.id, "compte_rendu");
    const openActions = store.listActions({ campusId: campus.id }).filter((a) => a.status !== "done");
    const parts = [];
    if (lastCR) {
      const content = (lastCR.content || "").replace(/```json[\s\S]*?```/g, "").trim();
      parts.push(`Dernier compte rendu du campus (${new Date(lastCR.createdAt).toLocaleDateString("fr-FR")}) — a passer en revue pour VALIDER ce qui a ete mis en place :\n${content.slice(0, 3500)}`);
    }
    if (openActions.length) {
      parts.push(`Actions non soldees pour ce campus (verifier le statut lors de la visite) :\n` + openActions.map((a) => `- [${a.status}] ${a.mesures || a.title}${a.owner ? " (resp. " + a.owner + ")" : ""}${a.dueDate ? ", echeance " + a.dueDate : ""}`).join("\n"));
    }
    if (parts.length) suiviBlock = "=== Suivi depuis la derniere visite ===\n" + parts.join("\n\n");
  }

  const userContent = [
    campusHeader,
    contactsBlock,
    suiviBlock,
    contexte ? `Contexte fourni par le directeur :\n${contexte}` : "",
    (input && input.trim()) ? `Données / notes à traiter :\n${input}` : (isProposal ? "Aucune note fournie — propose la trame standard de ce type de visite." : ""),
  ].filter(Boolean).join("\n\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  let full = "";
  try {
    const stream = await openai.chat.completions.create({
      model: modelFor(task),
      max_completion_tokens: 12000,
      stream: true,
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { full += delta; res.write(delta); }
    }
    if (full.trim()) {
      const vlabel = isProposal ? ` (${VISIT_VARIANTS[variant].label})` : "";
      const d = store.addDeliverable({
        task, title: (title && title.trim()) || `${PROMPTS[task].label}${vlabel}${campus ? " — " + campus.name : ""}`,
        campusId: campus?.id || null, campusName: campus?.name || null, content: full, model: modelFor(task), signature: pnlSig,
      });
      res.write(`\n<!--deliverable:${d.id}-->`);
      // Un P&L généré alimente automatiquement la ventilation finance du campus.
      if (task === "pnl" && campus) {
        const postes = extractPnlPostes(full);
        if (postes) { const r = seedFinanceFromPostes(campus.id, postes); logAudit(req, "seed", "finance", `P&L → ${campus.name} ${r.month} (${r.applied} poste(s))`); }
      }
    }
    res.end();
  } catch (err) {
    console.error("[generate]", err?.message || err);
    if (!res.headersSent) res.status(500);
    res.write(`\n\n[ERREUR] ${err?.message || "generation impossible"}`);
    res.end();
  }
});

// --- Brief email (Phase 2) ---
app.post("/api/test-imap", requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await testImap({ user: briefCfg.gmailUser, pass: briefCfg.gmailPass })); }
  catch (e) { res.status(400).json({ ok: false, error: e?.message || "connexion IMAP impossible" }); }
});
app.post("/api/daily-brief", requireAuth, requireAdmin, async (req, res) => {
  try {
    const send = req.body?.send !== false;
    const r = await generateDailyBrief(openai, { ...briefCfg, send, priorities: store.listPrioritySenders(), muted: store.listMutedSenders() });
    const saved = store.saveBrief(r);
    res.json({ ok: true, count: r.count, agenda: r.agenda, md: r.md, sent: send, createdAt: saved.createdAt });
  } catch (e) {
    console.error("[brief]", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "brief impossible" });
  }
});
app.get("/api/brief/latest", requireAuth, requireAdmin, (req, res) => res.json(store.latestBrief() || {}));

// --- Expéditeurs email prioritaires (éditable) ---
app.get("/api/email/priorities", requireAuth, requireAdmin, (req, res) => res.json(store.listPrioritySenders()));
app.post("/api/email/priorities", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.email || !String(req.body.email).includes("@")) return res.status(400).json({ error: "email valide requis" });
  const r = store.addPrioritySender(req.body);
  logAudit(req, "create", "email-priority", req.body.email);
  res.json(r);
});
app.delete("/api/email/priorities/:id", requireAuth, requireAdmin, (req, res) => { store.deletePrioritySender(req.params.id); res.json({ ok: true }); });
app.get("/api/email/muted", requireAuth, requireAdmin, (req, res) => res.json(store.listMutedSenders()));
app.post("/api/email/muted", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.email || !String(req.body.email).includes("@")) return res.status(400).json({ error: "email valide requis" });
  const r = store.addMutedSender(req.body);
  logAudit(req, "create", "email-muted", req.body.email);
  res.json(r);
});
app.delete("/api/email/muted/:id", requireAuth, requireAdmin, (req, res) => { store.deleteMutedSender(req.params.id); res.json({ ok: true }); });

// --- Alerte echeances (test manuel) ---
app.post("/api/alert-test", requireAuth, requireAdmin, async (req, res) => {
  if (!alertCfg.to) return res.status(400).json({ ok: false, error: "ALERT_TO non configuré" });
  if (!mailConfigured) return res.status(400).json({ ok: false, error: "Aucun envoi email configuré (MAIL_HOST ou GMAIL_*)" });
  try {
    const r = await sendDeadlineAlert({ ...alertCfg, alwaysSend: true });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("[alert]", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "envoi impossible" });
  }
});

// ===== Finance consolidée (budget vs réalisé) =====
// Applique une ventilation P&L dans le store finance (setKpiPostes recalcule chaque agrégat).
function seedFinanceFromPostes(campusId, postes) {
  const month = postes.month || new Date().toISOString().slice(0, 7);
  let applied = 0;
  for (const poste of ["revenue", "payroll", "charges"]) {
    if (postes[poste] && postes[poste].length) { store.setKpiPostes(campusId, month, poste, postes[poste]); applied++; }
  }
  return { month, applied };
}
// Seed manuel : (re)ventiler la finance d'un campus depuis son dernier P&L généré.
app.post("/api/campuses/:id/seed-finance-from-pnl", campusGuard, (req, res) => {
  const pnl = store.latestDeliverable(req.params.id, "pnl");
  if (!pnl) return res.status(404).json({ error: "aucun P&L généré pour ce campus" });
  const postes = extractPnlPostes(pnl.content);
  if (!postes) return res.status(400).json({ error: "ce P&L ne contient pas de ventilation chiffrée des postes" });
  const r = seedFinanceFromPostes(req.params.id, postes);
  logAudit(req, "seed", "finance", `P&L → ${store.listCampuses().find((c) => c.id === req.params.id)?.name || ""} ${r.month} (${r.applied} poste(s))`);
  res.json({ ok: true, ...r });
});
app.get("/api/finance", requireAuth, (req, res) => {
  const rows = buildNetworkRows(req).map((r) => {
    const hist = store.listKpi(r.id); // trié par mois croissant
    const k = hist[hist.length - 1] || {}, prev = hist[hist.length - 2] || null;
    const revenue = k.revenue ?? null, budget = k.revenueBudget ?? null;
    const payroll = k.payroll ?? null, charges = k.charges ?? null;
    const ecart = revenue != null && budget ? Math.round(((revenue - budget) / budget) * 100) : null;
    const margin = marginOf(k);
    const marginPct = revenue ? Math.round((margin / revenue) * 100) : null;
    const costPerStudent = r.students && (payroll != null || charges != null) ? Math.round(((payroll || 0) + (charges || 0)) / r.students) : null;
    const revenueDelta = prev && prev.revenue != null && revenue != null ? revenue - prev.revenue : null;
    const marginDelta = prev && marginOf(prev) != null && margin != null ? margin - marginOf(prev) : null;
    return { id: r.id, name: r.name, city: r.city, month: k.month || null, students: r.students, revenue, budget, ecart, payroll, charges, margin, marginPct, costPerStudent, revenueDelta, marginDelta };
  });
  res.json(rows);
});

// ===== Détail d'un poste financier (sous-lignes) =====
app.patch("/api/kpi/postes", requireAuth, (req, res) => {
  const { campusId, month, poste, lines } = req.body || {};
  if (!campusId || !month || !poste) return res.status(400).json({ error: "campusId, month, poste requis" });
  if (!assertCampus(req, res, campusId)) return;
  const k = store.setKpiPostes(campusId, month, poste, lines);
  if (!k) return res.status(400).json({ error: "poste invalide (revenue|payroll|charges)" });
  logAudit(req, "update", "finance", `${poste} ${month} — ${(Array.isArray(lines) ? lines.length : 0)} ligne(s)`);
  res.json(k);
});

// ===== Finance annuelle (cumul année scolaire sept→août + projection) =====
app.get("/api/finance/annual", requireAuth, (req, res) => {
  const sy = schoolYearRange();
  const rows = buildNetworkRows(req).map((r) => {
    const hist = store.listKpi(r.id).filter((k) => k.month && k.month >= sy.from && k.month <= sy.to);
    const sum = (f) => hist.reduce((s, k) => s + (k[f] || 0), 0);
    const withRev = hist.filter((k) => k.revenue != null).length;
    const revenue = sum("revenue"), budget = sum("revenueBudget"), payroll = sum("payroll"), charges = sum("charges");
    const margin = revenue - payroll - charges;
    const ecart = budget ? Math.round(((revenue - budget) / budget) * 100) : null;
    const marginPct = revenue ? Math.round((margin / revenue) * 100) : null;
    const projection = withRev ? Math.round((revenue / withRev) * 12) : null;
    const costPerStudent = r.students && (payroll || charges) ? Math.round((payroll + charges) / r.students) : null;
    return { id: r.id, name: r.name, city: r.city, students: r.students, months: withRev, revenue, budget, ecart, payroll, charges, margin, marginPct, projection, costPerStudent };
  });
  res.json({ schoolYear: sy.label, rows });
});

// ===== Export XLSX des tableaux (Réseau / Finance / Insertion) =====
function sendXlsx(res, sheet, rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
}
app.get("/api/export/:kind", requireAuth, (req, res) => {
  const kind = req.params.kind;
  const net = buildNetworkRows(req);
  if (kind === "network") {
    return sendXlsx(res, "Réseau", net.map((r) => ({ Campus: r.name, Ville: r.city, "Santé/100": r.health ?? "", Directeur: r.director, Effectif: r.students ?? "", Capacité: r.capacity ?? "", "Remplissage %": r.occupancy ?? "", "Qualiopi %": r.qualiopi ?? "", "Actions ouvertes": r.openActions, "En retard": r.overdue, Incidents: r.openIncidents, "Dernière visite": r.lastVisit || "jamais" })), "campus-reseau.xlsx");
  }
  if (kind === "finance") {
    return sendXlsx(res, "Finance", net.map((r) => { const hist = store.listKpi(r.id); const k = hist[hist.length - 1] || {}; const margin = marginOf(k); return { Campus: r.name, Mois: k.month || "", "CA réel €": k.revenue ?? "", "Budget €": k.revenueBudget ?? "", "Écart %": k.revenue != null && k.revenueBudget ? Math.round(((k.revenue - k.revenueBudget) / k.revenueBudget) * 100) : "", "Masse salariale €": k.payroll ?? "", "Charges €": k.charges ?? "", "Marge €": margin ?? "", "Coût/étudiant €": r.students && (k.payroll != null || k.charges != null) ? Math.round(((k.payroll || 0) + (k.charges || 0)) / r.students) : "" }; }), "finance.xlsx");
  }
  if (kind === "insertion") {
    return sendXlsx(res, "Insertion", net.map((r) => { const k = store.latestKpi(r.id) || {}; return { Campus: r.name, Mois: k.month || "", "Satisfaction /10": k.satisfaction ?? "", "Réussite %": k.successRate ?? "", "Insertion 6 mois %": k.insertionRate ?? "" }; }), "insertion-satisfaction.xlsx");
  }
  res.status(404).json({ error: "export inconnu" });
});

// ===== Performance : insertion & satisfaction (réseau) =====
app.get("/api/performance", requireAuth, (req, res) => {
  res.json(buildNetworkRows(req).map((r) => {
    const hist = store.listKpi(r.id);
    const k = hist[hist.length - 1] || {}, prev = hist[hist.length - 2] || {};
    const delta = (key) => (k[key] != null && prev[key] != null ? Math.round((k[key] - prev[key]) * 10) / 10 : null);
    return { id: r.id, name: r.name, city: r.city, month: k.month || null, students: r.students,
      satisfaction: k.satisfaction ?? null, successRate: k.successRate ?? null, insertionRate: k.insertionRate ?? null,
      satisfactionDelta: delta("satisfaction"), successDelta: delta("successRate"), insertionDelta: delta("insertionRate") };
  }));
});

// ===== Entreprises partenaires & alternance =====
app.get("/api/partners", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listPartners(req.query.campusId))));
app.post("/api/partners", requireAuth, (req, res) => {
  if (!req.body?.campusId || (allowedCampusIds(req) !== null && !assertCampus(req, res, req.body.campusId))) return res.status(400).json({ error: "campus requis" });
  const p = store.addPartner({ ...req.body, campusName: store.listCampuses().find((c) => c.id === req.body.campusId)?.name });
  logAudit(req, "create", "partner", p.name);
  res.json(p);
});
app.patch("/api/partners/:id", requireAuth, (req, res) => {
  const cur = store.listPartners().find((p) => p.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, cur.campusId)) return;
  const upd = store.updatePartner(req.params.id, req.body); logAudit(req, "update", "partner", cur.name);
  res.json(upd);
});
app.delete("/api/partners/:id", requireAuth, (req, res) => {
  const cur = store.listPartners().find((p) => p.id === req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  store.deletePartner(req.params.id); logAudit(req, "delete", "partner", cur?.name || req.params.id);
  res.json({ ok: true });
});

// ===== Objectifs réseau (OKR) =====
app.get("/api/network/objectives", requireAuth, (req, res) => res.json(store.listNetworkObjectives()));
app.put("/api/network/objectives", requireAuth, requireAdmin, (req, res) => {
  const list = store.setNetworkObjectives(req.body?.objectives || []);
  logAudit(req, "update", "network-objectives", `${list.length} objectif(s)`);
  res.json(list);
});

// ===== GED : documents par campus (binaire chiffré sur disque) =====
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DOCS_DIR = path.join(DATA_DIR, "docs");
app.get("/api/documents", requireAuth, (req, res) => res.json(scopeByCampus(req, store.listDocuments(req.query.campusId, req.query.indicator))));
app.post("/api/campuses/:id/documents", campusGuard, uploadDoc, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "fichier manquant" });
  try {
    if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
    const fname = crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(path.join(DOCS_DIR, fname), encryptBuffer(req.file.buffer));
    const campus = store.listCampuses().find((c) => c.id === req.params.id);
    const doc = store.addDocument({ campusId: req.params.id, campusName: campus?.name, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype, category: req.body.category, indicator: req.body.indicator, file: fname });
    logAudit(req, "upload", "document", doc.name);
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/documents/:id/download", requireAuth, (req, res) => {
  const doc = store.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, doc.campusId)) return;
  try {
    const buf = decryptBuffer(fs.readFileSync(path.join(DOCS_DIR, doc.file)));
    res.setHeader("Content-Type", doc.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: "fichier illisible : " + e.message }); }
});
app.delete("/api/documents/:id", requireAuth, (req, res) => {
  const doc = store.getDocument(req.params.id);
  if (!doc) return res.json({ ok: true });
  if (!assertCampus(req, res, doc.campusId)) return;
  store.deleteDocument(req.params.id);
  try { if (doc.file) fs.unlinkSync(path.join(DOCS_DIR, doc.file)); } catch { /* ignore */ }
  logAudit(req, "delete", "document", doc.name);
  res.json({ ok: true });
});

// ===== Centre de notifications (agrégat proactif) =====
app.get("/api/notifications", requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = buildNetworkRows(req);
  const th = thresholds();
  const notifs = [];
  for (const a of scopeByCampus(req, store.listActions())) {
    if (a.status !== "done" && a.dueDate && a.dueDate < today) notifs.push({ type: "action", severity: "high", campusId: a.campusId, campus: a.campusName || "", label: `Action en retard : ${a.title}`, date: a.dueDate });
  }
  for (const r of rows) if (r.visitDue) notifs.push({ type: "visite", severity: "medium", campusId: r.id, campus: r.name, label: `Visite à planifier (cadence ${r.cadence} mois)`, date: r.lastVisit });
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) {
    const ctrl = c.qualiopi?.lastAudit ? computeControlDates(c.qualiopi.lastAudit) : null;
    if (!ctrl) continue;
    for (const [lbl, d] of [["de surveillance", ctrl.surveillance], ["de renouvellement", ctrl.renewal]]) {
      if (!d) continue;
      const months = Math.round((new Date(d) - new Date()) / (30 * 864e5));
      if (months <= th.qualiopiMonths) notifs.push({ type: "qualiopi", severity: months < 0 ? "high" : "medium", campusId: c.id, campus: c.name, label: `Audit ${lbl} Qualiopi ${months < 0 ? "dépassé" : "dans " + months + " mois"}`, date: d });
    }
  }
  for (const i of scopeByCampus(req, store.listIncidents({ status: "open" }))) {
    if (["eleve", "critique"].includes(i.severity)) notifs.push({ type: "incident", severity: i.severity === "critique" ? "high" : "medium", campusId: i.campusId, campus: i.campusName || "", label: `${i.kind === "reclamation" ? "Réclamation" : "Incident"} ${i.severity} : ${i.title}`, date: i.date });
  }
  for (const r of rows) {
    const ad = r.admissions;
    if (ad?.objectif) { const pct = Math.round(((ad.inscrits || 0) / ad.objectif) * 100); if (pct < th.admissionsWarn) notifs.push({ type: "admissions", severity: pct < th.admissionsCrit ? "high" : "medium", campusId: r.id, campus: r.name, label: `Recrutement à ${pct}% de l'objectif`, date: null }); }
    if (r.occupancy != null && r.occupancy < th.occupancy) notifs.push({ type: "remplissage", severity: r.occupancy < th.occupancy - 15 ? "high" : "medium", campusId: r.id, campus: r.name, label: `Remplissage à ${r.occupancy}% (seuil ${th.occupancy}%)`, date: null });
    if (r.satisfaction != null && r.satisfaction < th.satisfaction) notifs.push({ type: "satisfaction", severity: r.satisfaction < th.satisfaction - 1 ? "high" : "medium", campusId: r.id, campus: r.name, label: `Satisfaction à ${r.satisfaction}/10 (seuil ${th.satisfaction})`, date: null });
    const k = store.latestKpi(r.id) || {};
    if (k.revenue) { const m = marginOf(k); if (m != null) { const mpct = Math.round((m / k.revenue) * 100); if (mpct < th.marginPct) notifs.push({ type: "marge", severity: mpct < th.marginPct - 5 ? "high" : "medium", campusId: r.id, campus: r.name, label: `Marge à ${mpct}% (seuil ${th.marginPct}%)`, date: null }); } }
  }
  // Décisions CODIR en retard + revues mensuelles à faire (admin — données réseau)
  if (req.user?.role === "admin") {
    for (const d of store.listDecisions()) {
      if (d.status === "open" && d.dueDate && d.dueDate < today) notifs.push({ type: "decision", severity: "high", campusId: d.campusId, campus: d.campusName || "", label: `Décision en retard : ${d.title}`, date: d.dueDate });
    }
    const lastReview = store.lastReviewByCampus();
    for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) {
      const r = lastReview[c.id];
      const monthsSince = r?.month ? Math.round((new Date() - new Date(r.month + "-01")) / (30 * 864e5)) : null;
      if (monthsSince == null || monthsSince >= 2) notifs.push({ type: "revue", severity: "low", campusId: c.id, campus: c.name, label: monthsSince == null ? "Revue mensuelle jamais réalisée" : `Revue mensuelle à faire (${monthsSince} mois)`, date: null });
    }
  }
  // Rétroplanning d'ouverture : tâches en retard (admin uniquement — données réseau)
  if (req.user?.role === "admin") {
    for (const o of store.listOpenings()) {
      if (["ouvert", "abandonne"].includes(o.status)) continue;
      for (const t of (o.tasks || [])) {
        if (t.status !== "done" && t.dueDate && t.dueDate < today) notifs.push({ type: "ouverture", severity: t.critical ? "high" : "medium", campusId: null, openingId: o.id, campus: o.name, label: `Ouverture ${o.name} — en retard : ${t.title}`, date: t.dueDate });
      }
    }
  }
  const sev = { high: 0, medium: 1, low: 2 };
  notifs.sort((a, b) => (sev[a.severity] - sev[b.severity]) || (b.date || "").localeCompare(a.date || ""));
  res.json(notifs);
});

// ===== Heatmap réseau + alertes de dérive (tendances KPI) =====
function kpiHistory(cid) {
  return store.listKpi(cid).slice().sort((a, b) => (a.month || "").localeCompare(b.month || ""));
}
const marginPctOf = (k) => (k && k.revenue ? Math.round((marginOf(k) / k.revenue) * 100) : null);
// tendance sur les 2 derniers points d'une série (seuil ~3 %)
function seriesTrend(hist, fn) {
  const pts = hist.map(fn).filter((v) => v != null && Number.isFinite(v));
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const thr = Math.max(Math.abs(a) * 0.03, 0.5);
  return b > a + thr ? "up" : b < a - thr ? "down" : "flat";
}
// nombre de baisses consécutives en fin de série
function decliningStreak(hist, fn) {
  const pts = hist.map(fn).filter((v) => v != null && Number.isFinite(v));
  let n = 0;
  for (let i = pts.length - 1; i > 0; i--) { if (pts[i] < pts[i - 1]) n++; else break; }
  return n;
}
app.get("/api/heatmap", requireAuth, requireAdmin, (req, res) => {
  const rows = buildNetworkRows(req);
  const campById = Object.fromEntries(store.listCampuses().map((c) => [c.id, c]));
  const cell = (status, value, trend) => ({ status, value, trend: trend || null });
  const band = (v, good, warn) => (v == null ? "na" : v >= good ? "good" : v >= warn ? "warn" : "bad");
  const out = rows.map((r) => {
    const c = campById[r.id] || {};
    const k = store.latestKpi(r.id) || {};
    const hist = kpiHistory(r.id);
    const mpct = marginPctOf(k);
    const adPct = r.admissions?.objectif ? Math.round(((r.admissions.inscrits || 0) / r.admissions.objectif) * 100) : null;
    const conf = c.directorReview?.confidence ?? null;
    return {
      campusId: r.id, campus: r.name, health: r.health,
      cells: {
        finance: cell(mpct == null ? "na" : mpct >= 5 ? "good" : mpct >= 0 ? "warn" : "bad", mpct == null ? "—" : mpct + "%", seriesTrend(hist, marginPctOf)),
        remplissage: cell(band(r.occupancy, 80, 70), r.occupancy != null ? r.occupancy + "%" : "—", seriesTrend(hist, (x) => x.occupancy)),
        admissions: cell(adPct == null ? "na" : adPct >= 90 ? "good" : adPct >= 75 ? "warn" : "bad", adPct == null ? "—" : adPct + "%"),
        qualiopi: cell(band(r.qualiopi, 90, 70), r.qualiopi != null ? r.qualiopi + "%" : "—"),
        actions: cell(!r.overdue ? "good" : r.overdue <= 2 ? "warn" : "bad", String(r.overdue || 0)),
        incidents: cell(!r.openIncidents ? "good" : r.openIncidents <= 1 ? "warn" : "bad", String(r.openIncidents || 0)),
        satisfaction: cell(band(r.satisfaction, 8, 7), r.satisfaction != null ? r.satisfaction + "/10" : "—", seriesTrend(hist, (x) => x.satisfaction)),
        insertion: cell(band(r.insertionRate, 80, 60), r.insertionRate != null ? r.insertionRate + "%" : "—"),
        visites: cell(r.visitDue ? "bad" : "good", r.visitDue ? "à planifier" : "à jour"),
        direction: cell(conf == null ? "na" : conf >= 70 ? "good" : conf >= 40 ? "warn" : "bad", conf == null ? "—" : conf + "%"),
      },
    };
  });
  // Alertes de dérive (tendances) — au-delà des seuils fixes
  const drifts = [];
  for (const r of rows) {
    const hist = kpiHistory(r.id);
    const mStreak = decliningStreak(hist, marginPctOf);
    if (mStreak >= 2) drifts.push({ campusId: r.id, campus: r.name, type: "marge", label: `Marge en baisse depuis ${mStreak} mois`, severity: "high" });
    const oStreak = decliningStreak(hist, (x) => x.occupancy);
    if (oStreak >= 2) drifts.push({ campusId: r.id, campus: r.name, type: "remplissage", label: `Remplissage en dégradation depuis ${oStreak} mois`, severity: "medium" });
    const sStreak = decliningStreak(hist, (x) => x.satisfaction);
    if (sStreak >= 2) drifts.push({ campusId: r.id, campus: r.name, type: "satisfaction", label: `Satisfaction en baisse depuis ${sStreak} mois`, severity: "medium" });
    if (r.openIncidents >= 2) drifts.push({ campusId: r.id, campus: r.name, type: "incidents", label: `${r.openIncidents} incidents/réclamations ouverts (récurrence)`, severity: "high" });
    const adPct = r.admissions?.objectif ? Math.round(((r.admissions.inscrits || 0) / r.admissions.objectif) * 100) : null;
    if (adPct != null && adPct < 70) drifts.push({ campusId: r.id, campus: r.name, type: "admissions", label: `Admissions sous trajectoire (${adPct}% de l'objectif)`, severity: adPct < 50 ? "high" : "medium" });
  }
  const lastReview = store.lastReviewByCampus();
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) {
    const rv = lastReview[c.id];
    const months = rv?.month ? Math.round((new Date() - new Date(rv.month + "-01")) / (30 * 864e5)) : null;
    if (months == null || months >= 2) drifts.push({ campusId: c.id, campus: c.name, type: "revue", label: months == null ? "Aucune revue mensuelle réalisée" : `Pas de revue depuis ${months} mois`, severity: "low" });
  }
  const sev = { high: 0, medium: 1, low: 2 };
  drifts.sort((a, b) => sev[a.severity] - sev[b.severity]);
  res.json({ rows: out, drifts });
});

// ===== Priorisation automatique des actions =====
app.get("/api/actions/prioritized", requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const healthById = Object.fromEntries(buildNetworkRows(req).map((r) => [r.id, r.health]));
  const open = scopeByCampus(req, store.listActions()).filter((a) => a.status !== "done");
  const scored = open.map((a) => {
    let score = 10; const reasons = [];
    if (a.dueDate && a.dueDate < today) { const days = Math.round((new Date(today) - new Date(a.dueDate)) / 864e5); score += Math.min(45, 15 + days); reasons.push(`en retard de ${days} j`); }
    else if (a.dueDate) { const days = Math.round((new Date(a.dueDate) - new Date(today)) / 864e5); if (days <= 7) { score += 15; reasons.push(`échéance dans ${days} j`); } }
    const h = healthById[a.campusId];
    if (h != null && h < 50) { score += 25; reasons.push("campus à risque"); } else if (h != null && h < 70) { score += 12; reasons.push("campus fragile"); }
    if (a.category === "qualiopi") { score += 15; reasons.push("enjeu Qualiopi"); }
    if (/finance|marge|budget|\bca\b/i.test(`${a.category} ${a.title}`)) { score += 10; reasons.push("enjeu financier"); }
    if (!a.owner) { score += 8; reasons.push("sans responsable"); }
    const ageDays = a.createdAt ? Math.round((Date.now() - new Date(a.createdAt)) / 864e5) : 0;
    if (ageDays > 30) { score += 10; reasons.push(`ouverte depuis ${ageDays} j`); }
    if (a.priority === "critical" || a.priority === "high") { score += 10; reasons.push("priorité haute"); }
    return { ...a, score: Math.min(100, score), reasons };
  }).sort((a, b) => b.score - a.score);
  res.json(scored);
});

// ===== Scénarios de prospective (EBIT) =====
app.get("/api/scenarios", requireAuth, requireAdmin, (req, res) => res.json(store.listScenarios()));
app.post("/api/scenarios", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: "nom requis" });
  const s = store.addScenario(req.body || {});
  logAudit(req, "create", "scenario", s.name);
  res.json(s);
});
app.delete("/api/scenarios/:id", requireAuth, requireAdmin, (req, res) => {
  const s = store.listScenarios().find((x) => x.id === req.params.id);
  store.deleteScenario(req.params.id);
  logAudit(req, "delete", "scenario", s?.name || req.params.id);
  res.json({ ok: true });
});

// ===== Ouvertures de campus (rétroplanning) — modèle/logique dans lib/calc.js =====
app.get("/api/openings/meta", requireAuth, (req, res) => res.json({ lots: OPENING_LOTS }));
app.get("/api/openings", requireAuth, requireAdmin, (req, res) => res.json(store.listOpenings()));
app.get("/api/openings/:id", requireAuth, requireAdmin, (req, res) => { const o = store.getOpening(req.params.id); if (!o) return res.status(404).json({ error: "introuvable" }); res.json(o); });
app.post("/api/openings", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.name || !String(req.body.name).trim()) return res.status(400).json({ error: "nom requis" });
  const o = store.addOpening(req.body);
  if (req.body.seed !== false && o.targetDate) store.setOpeningTasks(o.id, buildOpeningTasks(o.targetDate));
  logAudit(req, "create", "opening", o.name);
  res.json(store.getOpening(o.id));
});
app.patch("/api/openings/:id", requireAuth, requireAdmin, (req, res) => {
  const before = store.getOpening(req.params.id);
  const o = store.updateOpening(req.params.id, req.body || {});
  if (!o) return res.status(404).json({ error: "introuvable" });
  // Recalcul des dates à partir des offsets si la date de rentrée change (option recompute).
  if (req.body?.recompute && o.targetDate && before) {
    const base = new Date(o.targetDate);
    if (!isNaN(base.getTime())) {
      const tasks = (o.tasks || []).map((t) => {
        if (t.offset == null) return t;
        const d = new Date(base); d.setDate(d.getDate() - t.offset);
        return { ...t, dueDate: d.toISOString().slice(0, 10) };
      });
      store.setOpeningTasks(o.id, tasks);
    }
  }
  // Passage à « Ouvert » → crée automatiquement la fiche campus (une seule fois).
  let converted = null;
  if (req.body?.status === "ouvert" && !before?.campusId) converted = convertOpeningToCampus(req, store.getOpening(o.id));
  logAudit(req, "update", "opening", o.name);
  res.json({ ...store.getOpening(o.id), converted });
});
app.delete("/api/openings/:id", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  store.deleteOpening(req.params.id);
  logAudit(req, "delete", "opening", o?.name || req.params.id);
  res.json({ ok: true });
});
app.post("/api/openings/:id/seed", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  if (!o.targetDate) return res.status(400).json({ error: "renseigne d'abord la date de rentrée" });
  const merge = req.body?.merge === true;
  const seeded = buildOpeningTasks(o.targetDate);
  store.setOpeningTasks(o.id, merge ? [...(o.tasks || []), ...seeded] : seeded);
  logAudit(req, "seed", "opening", `${o.name} — rétroplanning type`);
  res.json(store.getOpening(o.id));
});
app.post("/api/openings/:id/tasks", requireAuth, requireAdmin, (req, res) => {
  const t = store.addOpeningTask(req.params.id, req.body || {});
  if (!t) return res.status(404).json({ error: "ouverture introuvable" });
  res.json(t);
});
app.patch("/api/openings/:id/tasks/:tid", requireAuth, requireAdmin, (req, res) => {
  const t = store.updateOpeningTask(req.params.id, req.params.tid, req.body || {});
  if (!t) return res.status(404).json({ error: "introuvable" });
  res.json(t);
});
app.delete("/api/openings/:id/tasks/:tid", requireAuth, requireAdmin, (req, res) => { store.deleteOpeningTask(req.params.id, req.params.tid); res.json({ ok: true }); });

// Budget d'ouverture ventilé par lot (budgété / engagé / réalisé) — buildOpeningBudget dans lib/calc.js
app.patch("/api/openings/:id/budget", requireAuth, requireAdmin, (req, res) => {
  const b = store.setOpeningBudget(req.params.id, req.body?.lines || []);
  if (b == null) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "opening", `budget ${store.getOpening(req.params.id)?.name || ""}`);
  res.json(b);
});
app.post("/api/openings/:id/budget/seed", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  if (!o.budget) return res.status(400).json({ error: "renseigne d'abord le budget d'ouverture total (Modifier le projet)" });
  store.setOpeningBudget(o.id, buildOpeningBudget(o.budget));
  res.json(store.getOpening(o.id));
});
// Conversion d'un projet en fiche campus
function convertOpeningToCampus(req, o) {
  if (o.campusId) return { already: true, campusId: o.campusId };
  const c = store.addCampus({ name: o.name, city: o.city, region: o.region, address: o.address });
  store.setOpeningCampus(o.id, c.id);
  logAudit(req, "create", "campus", `${c.name} (depuis ouverture)`);
  return { campusId: c.id };
}
app.post("/api/openings/:id/convert", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  const r = convertOpeningToCampus(req, o);
  if (o.status !== "ouvert") store.updateOpening(o.id, { status: "ouvert" });
  res.json({ ok: true, ...r });
});
const OPENING_STATUS_LBL = { todo: "À faire", doing: "En cours", done: "Fait", blocked: "Bloqué" };
function buildOpeningHtml(o) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const tasks = (o.tasks || []).slice();
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  const critLeft = tasks.filter((t) => t.critical && t.status !== "done").length;
  const today = new Date().toISOString().slice(0, 10);
  const late = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today).length;
  let daysToOpen = null;
  if (o.targetDate) { const d = Math.round((new Date(o.targetDate) - new Date()) / 864e5); daysToOpen = d; }
  const badge = (s) => `<span class="badge ${s === "done" ? "b-good" : s === "blocked" ? "b-bad" : s === "doing" ? "b-warn" : "b-todo"}">${OPENING_STATUS_LBL[s] || s}</span>`;
  const kpi = (v, l, tone) => `<div class="k${tone ? " k-" + tone : ""}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const lotSections = OPENING_LOTS.map((lot) => {
    const items = tasks.filter((t) => t.lot === lot.k).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    if (!items.length) return "";
    const dn = items.filter((t) => t.status === "done").length;
    return `<h2>${esc(lot.l)} <span class="muted" style="font-family:inherit;font-size:12px;font-weight:400;">— ${dn}/${items.length}</span></h2>
    <table><thead><tr><th>Tâche</th><th style="text-align:center">Échéance</th><th>Responsable</th><th style="text-align:center">Statut</th><th style="text-align:center">Critique</th></tr></thead><tbody>${items.map((t) => {
      const lateT = t.status !== "done" && t.dueDate && t.dueDate < today;
      return `<tr><td>${esc(t.title)}</td><td class="c${lateT ? " neg" : ""}">${t.dueDate ? (lateT ? "⏰ " : "") + esc(t.dueDate) : "—"}</td><td>${esc(t.owner || "—")}</td><td class="c">${badge(t.status)}</td><td class="c">${t.critical ? "●" : ""}</td></tr>`;
    }).join("")}</tbody></table>`;
  }).join("");
  const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const meta = [o.city, o.targetDate ? "Rentrée " + o.targetDate : null, o.status].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rétroplanning — ${esc(o.name)}</title>
<style>
  :root{--teal:#0B6E5F;--ink:#0D1B2A;--sand:#E2DACD;--muted:#5A6672;--teal-soft:#EAF3EF;--coral:#FF6A4D;--danger:#C94B33;--paper:#FBF9F5;}
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);margin:0;background:var(--paper);font-size:14px;line-height:1.55;}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:flex-end;max-width:900px;margin:0 auto;padding:16px 0 8px;}
  .toolbar button{background:var(--teal);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 2px 10px rgba(11,110,95,.28);}
  .sheet{max-width:900px;margin:0 auto 40px;background:#fff;padding:40px 48px 56px;box-shadow:0 1px 40px rgba(13,27,42,.08);}
  .letterhead{display:flex;align-items:center;justify-content:space-between;gap:16px;}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand .wm b{display:block;font-size:15px;font-weight:800;color:var(--ink);}
  .brand .wm span{display:block;font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);font-weight:600;}
  .doctype{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-align:right;}
  .rule{height:2px;background:linear-gradient(90deg,var(--teal) 0 64px,var(--sand) 64px);margin:18px 0 24px;border:0;}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);font-weight:700;margin:0 0 8px;}
  .eyebrow::before{content:"";width:22px;height:3px;background:var(--coral);border-radius:2px;}
  h1{font-family:Georgia,serif;font-size:28px;line-height:1.15;margin:0 0 6px;color:var(--ink);}
  .sub{color:var(--muted);font-size:13px;margin-bottom:8px;}
  h2{font-family:Georgia,serif;color:var(--teal);font-size:17px;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--sand);display:flex;align-items:baseline;gap:9px;}
  h2::before{content:"";width:10px;height:10px;background:var(--coral);border-radius:2px;flex:0 0 auto;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 4px;}
  .k{border:1px solid var(--sand);border-radius:12px;padding:14px 16px;} .k .v{font-size:22px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;} .k .l{font-size:11.5px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:.6px;}
  .k-good{background:var(--teal-soft);border-color:#cfe6df;} .k-good .v{color:var(--teal);} .k-bad{background:#FBEDEA;border-color:#f2cfc7;} .k-bad .v{color:var(--danger);}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0;border:1px solid var(--sand);border-radius:10px;overflow:hidden;}
  thead th{background:var(--teal);color:#fff;font-weight:600;text-align:left;padding:8px 10px;font-size:11.5px;}
  tbody td{padding:7px 10px;border-top:1px solid var(--sand);vertical-align:middle;} tbody tr:nth-child(even){background:#F7FAF9;}
  td.c{text-align:center;} .muted{color:var(--muted);} .neg{color:var(--danger);font-weight:600;}
  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-weight:700;font-size:11px;color:#fff;}
  .b-good{background:var(--teal);} .b-warn{background:#C98A2E;} .b-bad{background:var(--danger);} .b-todo{background:var(--muted);}
  .foot{margin-top:34px;color:var(--muted);font-size:11px;border-top:1px solid var(--sand);padding-top:12px;display:flex;justify-content:space-between;gap:12px;}
  @page{margin:14mm 12mm 16mm;}
  @media print{body{background:#fff;} .toolbar{display:none;} .sheet{box-shadow:none;max-width:none;margin:0;padding:0;} h2,tr{break-inside:avoid;} thead{display:table-header-group;}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="sheet">
    <div class="letterhead">
      <div class="brand"><svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="2" width="26" height="26" rx="7" fill="#0D1B2A"/><rect x="36" y="2" width="26" height="26" rx="7" fill="#0B6E5F"/><rect x="2" y="36" width="26" height="26" rx="7" fill="#0B6E5F"/><circle cx="49" cy="49" r="13" fill="#FF6A4D"/></svg><div class="wm"><b>Campus Manager</b><span>Pilotage réseau</span></div></div>
      <div class="doctype">Ouverture · Rétroplanning</div>
    </div>
    <hr class="rule">
    <div class="eyebrow">Rétroplanning d'ouverture</div>
    <h1>${esc(o.name)}</h1>
    <div class="sub">${esc(meta)}</div>
    <div class="kpis">
      ${kpi(pct + " %", "Avancement", pct >= 66 ? "good" : "")}
      ${kpi(done + "/" + tasks.length, "Tâches faites")}
      ${kpi(critLeft, "Critiques restantes", critLeft ? "bad" : "good")}
      ${kpi(late, "En retard", late ? "bad" : "good")}
    </div>
    ${daysToOpen != null ? `<div class="sub">${daysToOpen >= 0 ? "J−" + daysToOpen + " avant la rentrée" : "Rentrée passée depuis " + (-daysToOpen) + " j"}</div>` : ""}
    ${lotSections || '<p class="muted">Aucune tâche.</p>'}
    <div class="foot"><span>Campus Manager — document confidentiel · ● = chemin critique</span><span>Généré le ${now}</span></div>
  </div>
</body></html>`;
}
app.get("/api/openings/:id/export", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  if (req.query.format === "print") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(buildOpeningHtml(o));
  }
  const rows = (o.tasks || []).slice().sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).map((t) => ({
    Lot: OPENING_LOTS.find((l) => l.k === t.lot)?.l || t.lot, "Tâche": t.title, "Échéance": t.dueDate || "", Responsable: t.owner || "", Statut: OPENING_STATUS_LBL[t.status] || t.status, "Chemin critique": t.critical ? "Oui" : "",
  }));
  sendXlsx(res, "Rétroplanning", rows, `retroplanning-${String(o.name || "campus").replace(/[^a-z0-9]+/gi, "-")}.xlsx`);
});

// ===== Journal d'audit (admin) =====
app.get("/api/audit", requireAuth, requireAdmin, (req, res) => res.json(store.listAudit(Number(req.query.limit) || 300)));

// ===== Sauvegardes / Restauration (admin) =====
app.get("/api/backups", requireAuth, requireAdmin, (req, res) => res.json(store.listBackupsMeta()));
app.post("/api/backups", requireAuth, requireAdmin, (req, res) => { const name = store.backupNow(); logAudit(req, "create", "backup", name); res.json({ ok: true, name }); });
app.post("/api/backups/restore", requireAuth, requireAdmin, (req, res) => {
  const r = store.restoreBackup(req.body?.name || "");
  if (r.error) return res.status(400).json(r);
  logAudit(req, "restore", "backup", req.body.name);
  res.json(r);
});

// ===== Rapport de pilotage réseau (HTML imprimable → PDF, déterministe) =====
function buildReportHtml(rows) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const money = (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " €");
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
  const totStud = rows.reduce((s, r) => s + (r.students || 0), 0);
  const totCap = rows.reduce((s, r) => s + (r.capacity || 0), 0);
  const health = rows.filter((r) => r.health != null).map((r) => r.health);
  let totRev = 0, totMargin = 0;
  const finBy = {};
  rows.forEach((r) => { const k = store.latestKpi(r.id) || {}; finBy[r.id] = k; if (k.revenue != null) { totRev += k.revenue; totMargin += marginOf(k) || 0; } });
  const sat = rows.filter((r) => r.satisfaction != null).map((r) => r.satisfaction * 10);
  const ins = rows.filter((r) => r.insertionRate != null).map((r) => r.insertionRate);
  const qual = rows.filter((r) => r.qualiopi != null).map((r) => r.qualiopi);
  const openings = store.listOpenings().filter((o) => !["ouvert", "abandonne"].includes(o.status));
  const kpi = (v, l, tone) => `<div class="k${tone ? " k-" + tone : ""}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const hb = (v) => (v == null ? `<span class="badge">—</span>` : `<span class="badge ${v >= 75 ? "b-good" : v >= 50 ? "b-warn" : "b-bad"}">${v}</span>`);
  const signed = (v) => (v == null ? "—" : `<span class="${v < 0 ? "neg" : "pos"}">${money(v)}</span>`);
  const stat = health.length ? avg(health) : null;
  const rowsHtml = rows.slice().sort((a, b) => (a.health ?? 101) - (b.health ?? 101)).map((r) => {
    const k = finBy[r.id];
    return `<tr>
      <td><b>${esc(r.name)}</b>${r.city ? `<br><span class="muted">${esc(r.city)}</span>` : ""}</td>
      <td class="c">${hb(r.health)}</td>
      <td class="c">${r.students ?? "—"}${r.capacity ? `<span class="muted">/${r.capacity}</span>` : ""}</td>
      <td class="c">${r.occupancy != null ? r.occupancy + " %" : "—"}</td>
      <td class="c">${r.qualiopi != null ? r.qualiopi + " %" : "—"}</td>
      <td class="c num">${k.revenue != null ? money(k.revenue) : "—"}</td>
      <td class="c num">${signed(marginOf(k))}</td>
      <td class="c">${r.satisfaction != null ? r.satisfaction + "/10" : "—"}</td>
      <td class="c">${r.insertionRate != null ? r.insertionRate + " %" : "—"}</td>
      <td class="c">${r.openActions}${r.overdue ? ` <span class="neg">(${r.overdue}⚠)</span>` : ""}</td>
    </tr>`;
  }).join("");
  const openHtml = openings.length ? `<h2>Ouvertures en cours</h2><table><thead><tr><th>Projet</th><th>Rentrée</th><th>Statut</th><th>Avancement</th></tr></thead><tbody>${openings.map((o) => {
    const t = o.tasks || []; const done = t.filter((x) => x.status === "done").length; const pct = t.length ? Math.round(done / t.length * 100) : 0;
    return `<tr><td><b>${esc(o.name)}</b>${o.city ? ` <span class="muted">${esc(o.city)}</span>` : ""}</td><td class="c">${o.targetDate || "—"}</td><td class="c">${esc(o.status)}</td><td class="c"><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div><span class="muted">${pct}% · ${done}/${t.length}</span></td></tr>`;
  }).join("")}</tbody></table>` : "";
  const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const marginTone = totMargin < 0 ? "bad" : "good";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de pilotage réseau — ${now}</title>
<style>
  :root{--teal:#0B6E5F;--ink:#0D1B2A;--sand:#E2DACD;--muted:#5A6672;--teal-soft:#EAF3EF;--coral:#FF6A4D;--danger:#C94B33;--paper:#FBF9F5;}
  *{box-sizing:border-box}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);margin:0;background:var(--paper);font-size:14px;line-height:1.55;}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:flex-end;max-width:900px;margin:0 auto;padding:16px 0 8px;}
  .toolbar button{background:var(--teal);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 2px 10px rgba(11,110,95,.28);}
  .toolbar button:hover{background:#095648}
  .sheet{max-width:900px;margin:0 auto 40px;background:#fff;padding:40px 48px 56px;box-shadow:0 1px 40px rgba(13,27,42,.08);}
  .letterhead{display:flex;align-items:center;justify-content:space-between;gap:16px;}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand .wm b{display:block;font-size:15px;font-weight:800;color:var(--ink);}
  .brand .wm span{display:block;font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);font-weight:600;}
  .doctype{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-align:right;}
  .rule{height:2px;background:linear-gradient(90deg,var(--teal) 0 64px,var(--sand) 64px);margin:18px 0 24px;border:0;}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);font-weight:700;margin:0 0 8px;}
  .eyebrow::before{content:"";width:22px;height:3px;background:var(--coral);border-radius:2px;}
  h1{font-family:Georgia,serif;font-size:28px;line-height:1.15;margin:0 0 6px;color:var(--ink);}
  .sub{color:var(--muted);font-size:13px;margin-bottom:8px;}
  h2{font-family:Georgia,serif;color:var(--teal);font-size:18px;margin:30px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--sand);display:flex;align-items:baseline;gap:9px;}
  h2::before{content:"";width:10px;height:10px;background:var(--coral);border-radius:2px;flex:0 0 auto;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 4px;}
  .k{border:1px solid var(--sand);border-radius:12px;padding:14px 16px;background:#fff;}
  .k .v{font-size:22px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.3px;}
  .k .l{font-size:11.5px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:.6px;}
  .k-good{background:var(--teal-soft);border-color:#cfe6df;} .k-good .v{color:var(--teal);}
  .k-bad{background:#FBEDEA;border-color:#f2cfc7;} .k-bad .v{color:var(--danger);}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0;border:1px solid var(--sand);border-radius:10px;overflow:hidden;}
  thead th{background:var(--teal);color:#fff;font-weight:600;text-align:left;padding:9px 10px;font-size:11.5px;letter-spacing:.3px;}
  tbody td{padding:8px 10px;border-top:1px solid var(--sand);vertical-align:middle;}
  tbody tr:nth-child(even){background:#F7FAF9;}
  td.c{text-align:center;} td.num{text-align:right;font-variant-numeric:tabular-nums;} .muted{color:var(--muted);}
  .neg{color:var(--danger);font-weight:600;} .pos{color:var(--ink);}
  .badge{display:inline-block;min-width:30px;padding:2px 8px;border-radius:20px;font-weight:700;font-size:12px;color:#fff;background:var(--muted);}
  .b-good{background:var(--teal);} .b-warn{background:#C98A2E;} .b-bad{background:var(--danger);}
  .bar-wrap{height:6px;background:var(--sand);border-radius:4px;overflow:hidden;margin:0 auto 3px;max-width:120px;}
  .bar-fill{height:100%;background:var(--teal);}
  .foot{margin-top:34px;color:var(--muted);font-size:11px;border-top:1px solid var(--sand);padding-top:12px;display:flex;justify-content:space-between;gap:12px;}
  @page{margin:14mm 12mm 16mm;}
  @media print{body{background:#fff;} .toolbar{display:none;} .sheet{box-shadow:none;max-width:none;margin:0;padding:0;} h2,tr{break-inside:avoid;} thead{display:table-header-group;}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="sheet">
    <div class="letterhead">
      <div class="brand"><svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="2" width="26" height="26" rx="7" fill="#0D1B2A"/><rect x="36" y="2" width="26" height="26" rx="7" fill="#0B6E5F"/><rect x="2" y="36" width="26" height="26" rx="7" fill="#0B6E5F"/><circle cx="49" cy="49" r="13" fill="#FF6A4D"/></svg><div class="wm"><b>Campus Manager</b><span>Pilotage réseau</span></div></div>
      <div class="doctype">Board pack · Réseau</div>
    </div>
    <hr class="rule">
    <div class="eyebrow">Rapport de pilotage</div>
    <h1>Synthèse réseau</h1>
    <div class="sub">${now} · ${rows.length} campus</div>
    <h2>Indicateurs clés</h2>
    <div class="kpis">
      ${kpi(stat != null ? stat + "/100" : "—", "Santé moyenne")}
      ${kpi(totStud.toLocaleString("fr-FR"), "Effectif total")}
      ${kpi(totCap ? Math.round(totStud / totCap * 100) + " %" : "—", "Remplissage")}
      ${kpi(qual.length ? avg(qual) + " %" : "—", "Qualiopi moyen")}
      ${kpi(money(totRev), "CA (dernier mois)", "good")}
      ${kpi(money(totMargin), "Marge réseau", marginTone)}
      ${kpi(sat.length ? (avg(sat) / 10) + "/10" : "—", "Satisfaction")}
      ${kpi(ins.length ? avg(ins) + " %" : "—", "Insertion")}
    </div>
    <h2>Campus <span class="muted" style="font-family:inherit;font-size:12px;font-weight:400;">— triés par santé croissante</span></h2>
    <table><thead><tr><th>Campus</th><th style="text-align:center">Santé</th><th style="text-align:center">Effectif</th><th style="text-align:center">Rempl.</th><th style="text-align:center">Qualiopi</th><th style="text-align:right">CA</th><th style="text-align:right">Marge</th><th style="text-align:center">Satisf.</th><th style="text-align:center">Insert.</th><th style="text-align:center">Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    ${openHtml}
    <div class="foot"><span>Campus Manager — document confidentiel · chiffres = dernier mois renseigné par campus</span><span>Généré le ${now}</span></div>
  </div>
</body></html>`;
}
app.get("/api/report", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildReportHtml(buildNetworkRows(req)));
});

// Rows réseau vues « admin » (tous campus) — pour le board pack automatique.
function adminNetworkRows() {
  return buildNetworkRows({ user: { role: "admin" } });
}

// ===== Registre de décisions (CODIR) =====
app.get("/api/decisions", requireAuth, requireAdmin, (req, res) => res.json(store.listDecisions()));
app.post("/api/decisions", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.title || !String(req.body.title).trim()) return res.status(400).json({ error: "titre requis" });
  const d = store.addDecision(req.body || {});
  logAudit(req, "create", "decision", d.title);
  res.json(d);
});
app.patch("/api/decisions/:id", requireAuth, requireAdmin, (req, res) => {
  const d = store.updateDecision(req.params.id, req.body || {});
  if (!d) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "decision", d.title);
  res.json(d);
});
app.delete("/api/decisions/:id", requireAuth, requireAdmin, (req, res) => {
  const d = store.listDecisions().find((x) => x.id === req.params.id);
  store.deleteDecision(req.params.id);
  logAudit(req, "delete", "decision", d?.title || req.params.id);
  res.json({ ok: true });
});

// ===== Revues mensuelles par campus =====
// Snapshot instantané d'un campus (KPI + finance + actions + incidents) pour figer une revue.
function campusSnapshot(req, campusId) {
  const rows = buildNetworkRows(req);
  const r = rows.find((x) => x.id === campusId);
  if (!r) return null;
  const k = store.latestKpi(campusId) || {};
  const openActions = scopeByCampus(req, store.listActions()).filter((a) => a.campusId === campusId && a.status !== "done");
  const openIncidents = scopeByCampus(req, store.listIncidents({ status: "open" })).filter((i) => i.campusId === campusId);
  return {
    health: r.health ?? null, students: r.students ?? null, capacity: r.capacity ?? null,
    occupancy: r.occupancy ?? null, qualiopi: r.qualiopi ?? null, satisfaction: r.satisfaction ?? null,
    insertionRate: r.insertionRate ?? null, revenue: k.revenue ?? null, margin: marginOf(k),
    openActions: openActions.length, overdueActions: openActions.filter((a) => a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10)).length,
    openIncidents: openIncidents.length,
  };
}
app.get("/api/reviews", requireAuth, (req, res) => {
  const cid = req.query.campusId || null;
  if (cid && !canCampus(req, cid)) return res.status(403).json({ error: "hors périmètre" });
  let list = store.listReviews(cid);
  if (!cid) list = list.filter((r) => !r.campusId || canCampus(req, r.campusId));
  res.json(list);
});
app.get("/api/reviews/cadence", requireAuth, requireAdmin, (req, res) => {
  const last = store.lastReviewByCampus();
  const today = new Date();
  const rows = store.listCampuses().filter((c) => canCampus(req, c.id)).map((c) => {
    const r = last[c.id];
    const monthsSince = r?.month ? Math.round((today - new Date(r.month + "-01")) / (30 * 864e5)) : null;
    return { campusId: c.id, campus: c.name, lastMonth: r?.month || null, monthsSince, due: monthsSince == null || monthsSince >= 1 };
  });
  res.json(rows);
});
app.get("/api/reviews/snapshot/:campusId", requireAuth, requireAdmin, (req, res) => {
  if (!canCampus(req, req.params.campusId)) return res.status(403).json({ error: "hors périmètre" });
  const snap = campusSnapshot(req, req.params.campusId);
  if (!snap) return res.status(404).json({ error: "campus introuvable" });
  res.json(snap);
});
app.post("/api/reviews", requireAuth, requireAdmin, (req, res) => {
  const cid = req.body?.campusId;
  if (!cid || !canCampus(req, cid)) return res.status(400).json({ error: "campus requis / hors périmètre" });
  const campus = store.listCampuses().find((c) => c.id === cid);
  const snapshot = req.body.snapshot || campusSnapshot(req, cid);
  const r = store.addReview({ ...req.body, campusName: campus?.name || null, snapshot });
  logAudit(req, "create", "review", `${campus?.name || cid} — ${r.month}`);
  res.json(r);
});
app.delete("/api/reviews/:id", requireAuth, requireAdmin, (req, res) => {
  const r = store.listReviews().find((x) => x.id === req.params.id);
  store.deleteReview(req.params.id);
  logAudit(req, "delete", "review", r ? `${r.campusName} — ${r.month}` : req.params.id);
  res.json({ ok: true });
});

// ===== JPO & événements de recrutement =====
app.get("/api/events", requireAuth, (req, res) => {
  const cid = req.query.campusId || null;
  if (cid && !canCampus(req, cid)) return res.status(403).json({ error: "hors périmètre" });
  let list = store.listEvents(cid);
  if (!cid) list = list.filter((e) => !e.campusId || canCampus(req, e.campusId));
  res.json(list);
});
app.post("/api/events", requireAuth, (req, res) => {
  const cid = req.body?.campusId;
  if (!cid || !assertCampus(req, res, cid)) return;
  const v = validateBody(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const campus = store.listCampuses().find((c) => c.id === cid);
  const e = store.addEvent({ ...req.body, campusName: campus?.name || null });
  logAudit(req, "create", "event", `${e.type} — ${e.title}`);
  res.json(e);
});
app.patch("/api/events/:id", requireAuth, (req, res) => {
  const cur = store.listEvents().find((x) => x.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, cur.campusId)) return;
  const e = store.updateEvent(req.params.id, req.body || {});
  logAudit(req, "update", "event", `${e.type} — ${e.title}`);
  res.json(e);
});
app.delete("/api/events/:id", requireAuth, (req, res) => {
  const cur = store.listEvents().find((x) => x.id === req.params.id);
  if (!cur) return res.json({ ok: true });
  if (!assertCampus(req, res, cur.campusId)) return;
  store.deleteEvent(req.params.id);
  logAudit(req, "delete", "event", `${cur.type} — ${cur.title}`);
  res.json({ ok: true });
});

// ===== Paramètres (seuils d'alerte + board pack) =====
const DEFAULT_THRESHOLDS = { occupancy: 70, qualiopiMonths: 3, admissionsWarn: 80, admissionsCrit: 60, satisfaction: 7, marginPct: 0 };
function thresholds() { return { ...DEFAULT_THRESHOLDS, ...(store.getSettings().thresholds || {}) }; }
app.get("/api/settings", requireAuth, requireAdmin, (req, res) => {
  const s = store.getSettings();
  res.json({ thresholds: { ...DEFAULT_THRESHOLDS, ...(s.thresholds || {}) }, board: s.board || { enabled: false, recipients: "" } });
});
app.put("/api/settings", requireAuth, requireAdmin, (req, res) => {
  const patch = {};
  if (req.body?.thresholds) { const t = {}; for (const k of Object.keys(DEFAULT_THRESHOLDS)) if (req.body.thresholds[k] != null && req.body.thresholds[k] !== "") t[k] = Number(req.body.thresholds[k]); patch.thresholds = t; }
  if (req.body?.board) patch.board = { enabled: !!req.body.board.enabled, recipients: String(req.body.board.recipients || "").trim() };
  const s = store.updateSettings(patch);
  logAudit(req, "update", "settings", "seuils / board pack");
  res.json(s);
});

// ===== RGPD : registre des traitements, export & rétention =====
const DEFAULT_RGPD_REGISTER = [
  { data: "Comptes utilisateurs (nom, email)", purpose: "Gestion des accès et authentification", basis: "Intérêt légitime", retention: "Durée du compte + 12 mois" },
  { data: "Données campus & indicateurs financiers", purpose: "Pilotage opérationnel du réseau", basis: "Intérêt légitime", retention: "Durée d'exploitation" },
  { data: "Documents & preuves Qualiopi", purpose: "Conformité réglementaire (certification)", basis: "Obligation légale", retention: "3 ans après l'audit" },
  { data: "Emails traités & briefs du matin", purpose: "Assistance opérationnelle", basis: "Intérêt légitime", retention: "14 derniers briefs" },
  { data: "Incidents & réclamations", purpose: "Suivi qualité et sécurité", basis: "Intérêt légitime", retention: "3 ans" },
  { data: "Décisions CODIR", purpose: "Gouvernance et traçabilité des arbitrages", basis: "Intérêt légitime", retention: "5 ans" },
  { data: "Journal d'audit (actions utilisateurs)", purpose: "Traçabilité et sécurité", basis: "Intérêt légitime / obligation", retention: "12 mois" },
];
function rgpdConfig() {
  const s = store.getSettings().rgpd || {};
  return { register: Array.isArray(s.register) && s.register.length ? s.register : DEFAULT_RGPD_REGISTER, retentionMonths: s.retentionMonths || 12 };
}
app.get("/api/rgpd", requireAuth, requireAdmin, (req, res) => res.json(rgpdConfig()));
app.put("/api/rgpd", requireAuth, requireAdmin, (req, res) => {
  const rgpd = {};
  if (Array.isArray(req.body?.register)) rgpd.register = req.body.register.slice(0, 50).map((r) => ({ data: String(r.data || "").slice(0, 300), purpose: String(r.purpose || "").slice(0, 300), basis: String(r.basis || "").slice(0, 120), retention: String(r.retention || "").slice(0, 120) }));
  if (req.body?.retentionMonths != null) rgpd.retentionMonths = Math.max(1, Math.min(120, Number(req.body.retentionMonths) || 12));
  store.updateSettings({ rgpd: { ...(store.getSettings().rgpd || {}), ...rgpd } });
  logAudit(req, "update", "rgpd", "registre des traitements");
  res.json(rgpdConfig());
});
// Droit d'accès / portabilité : export des données personnelles d'un utilisateur (JSON).
app.get("/api/users/:id/export", requireAuth, requireAdmin, (req, res) => {
  const u = userstore.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "utilisateur introuvable" });
  const audit = store.listAudit(2000).filter((a) => a.userId === u.id);
  const credentials = (userstore.listCredentials(u.id) || []).map((c) => ({ id: c.id, deviceName: c.deviceName, createdAt: c.createdAt }));
  const payload = {
    exportedAt: new Date().toISOString(),
    profile: { id: u.id, name: u.name, email: u.email, role: u.role, campusIds: u.campusIds, active: u.active, createdAt: u.createdAt },
    passkeys: credentials,
    auditTrail: audit,
    note: "Export RGPD — données personnelles associées à ce compte dans Campus Manager.",
  };
  logAudit(req, "export", "rgpd-user", u.email);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="export-donnees-${u.email.replace(/[^a-z0-9]+/gi, "-")}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});
// Rétention : purge du journal d'audit au-delà de la durée configurée.
app.post("/api/rgpd/purge", requireAuth, requireAdmin, (req, res) => {
  const months = rgpdConfig().retentionMonths;
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  const removed = store.purgeAuditBefore(cutoff.toISOString());
  logAudit(req, "purge", "rgpd-audit", `${removed} entrée(s) > ${months} mois`);
  res.json({ ok: true, removed, months });
});

// ===== Board pack mensuel (rapport réseau envoyé par email) =====
async function sendBoardPack(recipients) {
  const to = (recipients || store.getSettings().board?.recipients || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!to.length) throw new Error("aucun destinataire configuré");
  if (!mailConfigured) throw new Error("envoi email non configuré");
  const html = buildReportHtml(adminNetworkRows());
  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  await sendMail({ to: to.join(", "), subject: `Board pack réseau — ${monthLabel}`, html });
  return { sent: true, recipients: to.length };
}
app.post("/api/board/send", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await sendBoardPack(req.body?.recipients);
    logAudit(req, "send", "board-pack", `${r.recipients} destinataire(s)`);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e?.message || "échec envoi" }); }
});

// --- Static ---
// CSP stricte pour le document applicatif (script-src 'self' : plus aucun inline).
const CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
].join("; ");
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, fp) => {
    res.setHeader("Cache-Control", fp.endsWith(".html") ? "no-store" : "no-cache");
    if (fp.endsWith(".html")) res.setHeader("Content-Security-Policy", CSP);
  },
}));
app.use("/vendor/marked.js", express.static(path.join(__dirname, "node_modules/marked/marked.min.js")));
app.use("/vendor/webauthn.js", express.static(path.join(__dirname, "node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js")));
app.use("/vendor/purify.js", express.static(path.join(__dirname, "node_modules/dompurify/dist/purify.min.js")));
app.get("/health", (req, res) => res.json({ ok: true }));

// --- Planificateur brief ---
if (briefCfg.gmailUser && briefCfg.gmailPass && cron.validate(briefCfg.cron)) {
  cron.schedule(briefCfg.cron, () => {
    generateDailyBrief(openai, { ...briefCfg, priorities: store.listPrioritySenders(), muted: store.listMutedSenders() })
      .then((r) => { store.saveBrief(r); console.log(`[brief] envoye : ${r.count} emails, ${r.agenda} rdv`); })
      .catch((e) => console.error("[brief] echec :", e?.message || e));
  }, { timezone: "Europe/Paris" });
  console.log(`[brief] planifie (${briefCfg.cron}, Europe/Paris) -> ${briefCfg.briefTo}`);
} else {
  console.log("[brief] Gmail non configure — routine du matin inactive");
}

// --- Planificateur alerte echeances ---
if (alertCfg.to && mailConfigured && cron.validate(alertCfg.cron)) {
  cron.schedule(alertCfg.cron, () => {
    sendDeadlineAlert(alertCfg)
      .then((r) => console.log(r.sent ? `[alert] envoyee : ${r.overdue} retard, ${r.soon} a venir` : "[alert] rien a signaler"))
      .catch((e) => console.error("[alert] echec :", e?.message || e));
  }, { timezone: "Europe/Paris" });
  console.log(`[alert] echeances planifiees (${alertCfg.cron}, Europe/Paris) -> ${alertCfg.to}`);
} else {
  console.log("[alert] echeances inactives (ALERT_TO + envoi email requis)");
}

// Digest hebdo réseau (lundi 8h par défaut)
const weeklyCron = process.env.WEEKLY_DIGEST_CRON || "0 8 * * 1";
if (alertCfg.to && mailConfigured && process.env.WEEKLY_DIGEST !== "off" && cron.validate(weeklyCron)) {
  cron.schedule(weeklyCron, () => {
    sendWeeklyDigest(alertCfg)
      .then((r) => console.log(r.sent ? `[weekly] envoye : ${r.campuses} campus, ${r.overdue} retards` : "[weekly] rien a signaler"))
      .catch((e) => console.error("[weekly] echec :", e?.message || e));
  }, { timezone: "Europe/Paris" });
  console.log(`[weekly] digest reseau planifie (${weeklyCron}, Europe/Paris) -> ${alertCfg.to}`);
}

// Board pack mensuel (1er du mois 7h) — si activé dans les paramètres.
const boardCron = process.env.BOARD_PACK_CRON || "0 7 1 * *";
if (mailConfigured && cron.validate(boardCron)) {
  cron.schedule(boardCron, () => {
    const cfg = store.getSettings().board;
    if (!cfg?.enabled || !cfg.recipients) return;
    sendBoardPack(cfg.recipients)
      .then((r) => console.log(`[board] envoye : ${r.recipients} destinataire(s)`))
      .catch((e) => console.error("[board] echec :", e?.message || e));
  }, { timezone: "Europe/Paris" });
  console.log(`[board] board pack planifie (${boardCron}, Europe/Paris)`);
}

app.listen(PORT, () => {
  console.log(`assistant-campus V2 sur http://127.0.0.1:${PORT}`);
  console.log("routage :", Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, v.model])));
});

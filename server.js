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
import { systemFor, modelFor, PROMPTS, EMAIL_MODEL, VISIT_VARIANTS, SYNTHESE_RESEAU, CHAT_ASSISTANT, RECOVERY_PLAN, RECLAMATION_REPLY, REVIEW_NOTES, CODIR_AGENDA, COPIL_AGENDA, CURRICULUM_IMPORT, TEACHING_ASSIGNMENTS } from "./lib/prompts.js";
import { issueCookie, clearCookie, sessionUserId, issueCsrf, csrfValid } from "./lib/auth.js";
import * as userstore from "./lib/userstore.js";
import { generateDailyBrief } from "./lib/brief.js";
import { testImap, sendMail } from "./lib/mailbox.js";
import { sendDeadlineAlert, sendWeeklyDigest } from "./lib/alerts.js";
import * as authstore from "./lib/authstore.js";
import { encryptionEnabled, encryptBuffer, decryptBuffer } from "./lib/crypto-store.js";
import { extractText } from "./lib/extract.js";
import { toMarkdown, toHtml, toDocx } from "./lib/export.js";
import * as sessionstore from "./lib/sessionstore.js";
import * as attendancestore from "./lib/attendancestore.js";
import { sheetStats, periodStats, effectiveEntries, STATUS_LABEL, ATTENDANCE_STATUSES } from "./lib/attendance.js";
import { validateContract, contractAlerts, minimumWage, isValidSiret, RUPTURE_LABEL, RUPTURE_MODES, SMIC_MENSUEL_DEFAUT } from "./lib/contracts.js";
import { learnerReport, ranking, classStats, mention, blockReport, certificationSummary } from "./lib/grades.js";
import { buildCerfa, TYPE_EMPLOYEUR, EMPLOYEUR_SPECIFIQUE, NATIONALITE, REGIME_SOCIAL, SITUATION_AVANT_CONTRAT, DEROGATION, TYPE_CONTRAT } from "./lib/cerfa.js";
import { FUNDING_MODES, buildSchedule, amountDue, prorataTemporis, computeTotals, balance, compareWithLegacy, daysBetween } from "./lib/billing.js";
import { buildSifa, buildBpf, toCsv, SIFA_COLUMNS, BPF_FINANCEURS, sifaObservationDate } from "./lib/declarations.js";
import { licenceState, quotaReport, canWrite, PLANS, MODULES } from "./lib/licence.js";
import * as stripe from "./lib/stripe.js";
import { generateToken, hashToken, tokenMatches, expiryFor, accessState, makeRateLimiter, PORTAL_KINDS, KIND_LABEL } from "./lib/portal.js";
import { ageAt as ageAtDate } from "./lib/contracts.js";
import { RETENTION_POLICY, RETENTION_KEYS, policyView, cutoffDate, retentionMonths } from "./lib/retention.js";
import { conflictsFor, hasHardBlock, coverage, serviceOf, equity, expandWeekly, hoursOf, SERVICE_LIMITS } from "./lib/schedule.js";
import { generateWeek, DEFAULT_OPTIONS as GEN_DEFAULTS } from "./lib/generator.js";
import { buildScheduleHtml, buildIcs, buildScheduleEmail } from "./lib/scheduleview.js";
import * as store from "./lib/store.js";
import { QUALIOPI_REFERENCE, QUALIOPI_STATUSES, QUALIOPI_GLOSSARY, conformityRate, computeControlDates } from "./lib/qualiopi.js";
import { marginOf, healthScore, schoolYearRange, extractPnlPostes, OPENING_LOTS, buildOpeningTasks, buildOpeningBudget } from "./lib/calc.js";
import { validateBody } from "./lib/validators.js";
import { testConnection as siTestConnection, syncCampus as siSyncCampus, parseFrDate } from "./lib/si.js";
import { testConnection as sfTestConnection, fetchCandidates as sfFetchCandidates } from "./lib/salesforce.js";
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

// SOUS-TRAITANCE IA — l'assistance envoie des contenus souvent nominatifs à un
// fournisseur tiers, potentiellement hors UE. Un établissement doit pouvoir la
// refuser sans perdre le reste de l'application : l'interrupteur est ici, et il
// est vérifié à l'entrée de chaque route qui appelle le modèle.
function iaActive() {
  const s = store.getSettings();
  return s.iaDesactivee !== true && !!process.env.OPENAI_API_KEY;
}
function requireIA(req, res, next) {
  if (!iaActive()) {
    return res.status(403).json({ error: "L'assistance IA est désactivée sur cette instance.", code: "ia_desactivee" });
  }
  next();
}

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
// --- Webhook Stripe ---
// Monté AVANT express.json() et servi en corps BRUT : la signature Stripe porte
// sur les octets reçus. Re-sérialiser du JSON parsé change les espaces et rend
// toute signature invalide — panne silencieuse, et impossible à diagnostiquer
// depuis les logs Stripe qui n'affichent qu'un « 400 ».
//
// Il est délibérément HORS de la protection CSRF et de l'authentification : son
// authentification À LUI, c'est la signature HMAC, qui est plus forte qu'une
// session. Aucune autre route ne bénéficie de cette exemption.
app.post("/api/stripe/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const brut = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const v = stripe.verifySignature({ payload: brut, header: req.get("stripe-signature"), secret });
  if (!v.ok) {
    console.warn(new Date().toISOString(), "webhook Stripe refusé :", v.error);
    return res.status(400).json({ error: v.error });
  }
  let evenement;
  try { evenement = JSON.parse(brut); } catch { return res.status(400).json({ error: "corps illisible" }); }

  const courant = store.getSettings().licence || {};
  const r = stripe.applyEvent(courant, evenement, { correspondance: stripe.correspondanceDepuisEnv() });
  if (r.applique) {
    store.updateSettings({ licence: r.etat });
    try {
      store.addAudit({ userName: "Stripe", action: "update", target: "licence",
        detail: `${evenement.type} → ${r.etat.statutLibelle}${r.etat.plan ? ` (${r.etat.plan})` : ""}, valide jusqu'au ${r.etat.validUntil || "?"}` });
    } catch { /* le journal ne doit jamais faire échouer un webhook */ }
    console.log(new Date().toISOString(), "licence mise à jour par Stripe :", evenement.type, r.etat.statutLibelle);
  } else {
    console.log(new Date().toISOString(), "webhook Stripe sans effet :", r.motif);
  }
  // 2xx dans tous les cas où la signature est bonne : un événement qu'on ignore
  // et auquel on répondrait par une erreur serait réémis indéfiniment.
  res.json({ recu: true, applique: r.applique, motif: r.motif || null });
});

app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());

// --- Protection CSRF (double-submit) : toute mutation exige X-CSRF-Token == cookie ac_csrf ---
// Exemptés : lecture (GET/HEAD/OPTIONS) et routes pré-auth (pas encore de session/token).
const CSRF_EXEMPT = new Set(["/api/login", "/api/forgot", "/api/reset", "/api/webauthn/login/options", "/api/webauthn/login/verify"]);
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (CSRF_EXEMPT.has(req.path)) return next();
  // Le portail s'authentifie par en-tête Authorization (jamais par cookie) : une
  // page tierce ne peut pas positionner cet en-tête, donc pas de risque CSRF.
  if (req.path.startsWith("/api/portal/")) return next();
  if (!csrfValid(req)) return res.status(403).json({ error: "Requête refusée (jeton de sécurité invalide). Recharge la page." });
  next();
});

// --- Validation métier globale : borne les champs numériques connus sur toute mutation ---
// validateBody ne vérifie que les champs présents ayant une règle (no-op sinon) → sûr en global.
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const v = validateBody(req.body, req.path);
    if (!v.ok) return res.status(400).json({ error: v.error });
  }
  next();
});

// --- Licence de l'instance ---
// Le plan par DÉFAUT est le plus large. Contre-intuitif pour un SaaS, mais une
// instance déjà en service dont le .env ne porte pas de plan ne doit pas se
// retrouver bridée du jour au lendemain par une simple mise à jour du code : ce
// serait une panne fonctionnelle silencieuse chez un client qui paie. Les
// instances provisionnées reçoivent, elles, un plan explicite (scripts/provision.mjs).
const LICENCE = {
  plan: process.env.LICENCE_PLAN || "groupe",
  client: process.env.LICENCE_CLIENT || "",
  validUntil: process.env.LICENCE_VALID_UNTIL || null,
  suspendue: process.env.LICENCE_SUSPENDUE === "1",
};
// L'état persisté (posé par le webhook Stripe) l'emporte sur le .env : c'est lui
// qui suit l'abonnement réel. Le .env reste la valeur de départ d'une instance
// qui n'a pas encore reçu d'événement.
function licenceEffective() {
  let persiste = {};
  try { persiste = store.getSettings().licence || {}; } catch { /* store indisponible */ }
  return {
    plan: persiste.plan || LICENCE.plan,
    client: LICENCE.client,
    validUntil: persiste.validUntil ?? LICENCE.validUntil,
    suspendue: persiste.suspendue ?? LICENCE.suspendue,
    statutStripe: persiste.statutStripe || null,
    statutLibelle: persiste.statutLibelle || null,
    resiliationProgrammee: persiste.resiliationProgrammee || false,
    majLe: persiste.majLe || null,
  };
}
function licenceUsage() {
  try {
    return {
      campus: store.listCampuses().length,
      apprenants: store.listLearners({}).length,
      utilisateurs: userstore.listUsers().length,
    };
  } catch { return {}; }
}

// Écritures exemptées : sans elles, une instance en lecture seule deviendrait
// inaccessible — donc ses données inatteignables, ce que la licence ne doit
// JAMAIS provoquer (voir lib/licence.js).
const LICENCE_EXEMPT = new Set([
  "/api/login", "/api/logout", "/api/forgot", "/api/reset",
  "/api/webauthn/login/options", "/api/webauthn/login/verify",
]);
app.use((req, res, next) => {
  // Toute lecture passe, toujours : consultation et exports sont des GET, et
  // ils restent ouverts quel que soit l'état de la licence.
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (LICENCE_EXEMPT.has(req.path)) return next();
  const etat = licenceState(licenceEffective());
  if (!etat.lectureSeule) return next();
  // 423 Locked : la ressource existe et reste lisible, seule l'écriture est fermée.
  return res.status(423).json({ error: etat.alerte, code: "licence_lecture_seule" });
});

// Places restantes sur une ressource. null = illimité.
function quotaRestant(ressource) {
  const eff = licenceEffective();
  const q = quotaReport({ plan: licenceState(eff).plan, usage: licenceUsage() }).find((x) => x.cle === ressource);
  return q ? q.restant : null;
}
// Motif de refus, ou null si l'écriture est permise.
function quotaMotif(ressource) {
  const v = canWrite({ ...licenceEffective(), usage: licenceUsage(), ressource });
  return v.ok ? null : v.error;
}
// Garde de quota, posée au point de création. Renvoie true si la requête a déjà
// reçu sa réponse — l'appelant n'a qu'à sortir.
function quotaBloque(req, res, ressource) {
  const v = canWrite({ ...licenceEffective(), usage: licenceUsage(), ressource });
  if (v.ok) return false;
  res.status(v.code === "licence_lecture_seule" ? 423 : 402).json({ error: v.error, code: v.code });
  return true;
}

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
// Campus obligatoire ET autorisé. Écrit pour qu'AUCUN chemin ne sorte sans
// réponse : `!id || !assertCampus(...)` court-circuitait assertCampus quand l'id
// manquait, et la requête restait pendante jusqu'au timeout du client.
function requireCampus(req, res, campusId) {
  if (!campusId) { res.status(400).json({ error: "campusId requis" }); return false; }
  return assertCampus(req, res, campusId);
}
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
// Derrière UN proxy de confiance (nginx APPEND l'IP réelle via $proxy_add_x_forwarded_for) :
// l'entrée la plus à DROITE est celle ajoutée par nginx = vraie IP client. Le leftmost est
// fourni par le client → spoofable : le lire annulerait le throttle anti-bruteforce.
const clientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const parts = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.ip || "?";
};
const resetCodes = new Map(); // email -> { code, exp }

app.post("/api/login", (req, res) => {
  const ip = clientIp(req);
  const { email, password } = req.body || {};
  // Throttle par IP ET par email : bloque le bruteforce simple ET le distribué (rotation d'IP sur un compte).
  const emailKey = email ? "e:" + String(email).toLowerCase() : null;
  if (throttled(ip) || (emailKey && throttled(emailKey))) return res.status(429).json({ error: "Trop de tentatives. Réessaie dans 30 secondes." });
  const user = email ? userstore.getUserByEmail(email) : null;
  if (!user || !userstore.verifyUserPassword(user, password || "")) {
    recordFail(ip); if (emailKey) recordFail(emailKey);
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }
  if (user.active === false) { recordFail(ip); if (emailKey) recordFail(emailKey); return res.status(403).json({ error: "Compte désactivé. Contacte l'administrateur." }); }
  loginFails.delete(ip); if (emailKey) loginFails.delete(emailKey);
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
  if (quotaBloque(req, res, "utilisateurs")) return;
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
  if (quotaBloque(req, res, "campus")) return;
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
// Brouillon de réponse à une réclamation (IA) — ne sauvegarde rien, renvoie le corps du message à relire/envoyer.
app.post("/api/incidents/:id/reply-draft", requireAuth, requireIA, async (req, res) => {
  const inc = store.listIncidents().find((x) => x.id === req.params.id);
  if (!inc) return res.status(404).json({ error: "réclamation introuvable" });
  if (!assertCampus(req, res, inc.campusId)) return;
  const ctx = [
    `Campus : ${inc.campusName || "[À PRÉCISER]"}`,
    `Objet : ${inc.title || ""}`,
    `Catégorie : ${inc.category || "—"} · gravité : ${inc.severity || "—"}`,
    inc.description ? `Détail : ${inc.description}` : "",
  ].filter(Boolean).join("\n");
  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 1200,
      messages: [{ role: "system", content: RECLAMATION_REPLY }, { role: "user", content: `Réclamation reçue :\n${ctx}` }],
    });
    res.json({ draft: resp.choices?.[0]?.message?.content || "", truncated: resp.choices?.[0]?.finish_reason === "length" });
  } catch (e) {
    console.error("[reply-draft]", e?.message || e);
    res.status(500).json({ error: "génération impossible" });
  }
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
      res.setHeader("Content-Security-Policy", CSP);   // défense-en-profondeur sur la route HTML dynamique
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
app.get("/api/qualiopi/reference", requireAuth, (req, res) => res.json({ reference: QUALIOPI_REFERENCE, statuses: QUALIOPI_STATUSES, glossary: QUALIOPI_GLOSSARY }));
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
app.post("/api/network/synthese", requireAuth, requireAdmin, requireIA, async (req, res) => {
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
    let finishReason = null;
    for await (const chunk of stream) { const ch = chunk.choices?.[0]; if (ch?.delta?.content) { full += ch.delta.content; res.write(ch.delta.content); } if (ch?.finish_reason) finishReason = ch.finish_reason; }
    if (finishReason === "length") res.write("\n\n⚠️ **[SYNTHÈSE TRONQUÉE]** — limite de longueur atteinte.");
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
app.post("/api/chat", requireAuth, requireIA, async (req, res) => {
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
    let finishReason = null;
    for await (const chunk of stream) { const ch = chunk.choices?.[0]; if (ch?.delta?.content) res.write(ch.delta.content); if (ch?.finish_reason) finishReason = ch.finish_reason; }
    if (finishReason === "length") res.write("\n\n⚠️ _[réponse tronquée — pose une question plus ciblée]_");
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
app.post("/api/generate", requireAuth, requireIA, async (req, res) => {
  const { task, input, contexte, campusId, title, variant } = req.body || {};
  if (!task || !PROMPTS[task]) return res.status(400).json({ error: "tache inconnue" });
  if (campusId && !assertCampus(req, res, campusId)) return;

  const isProposal = task === "ordre_du_jour" && variant && VISIT_VARIANTS[variant];
  if ((!input || !String(input).trim()) && !isProposal) return res.status(400).json({ error: "aucune donnee fournie" });
  // Borne dure sur l'entrée envoyée au modèle (coût/contexte). Refus explicite plutôt que
  // troncature silencieuse (qui perdrait des lignes de P&L → chiffres faux).
  const MAX_INPUT = 200000;
  if (input && String(input).length > MAX_INPUT) return res.status(400).json({ error: `Données trop volumineuses (${String(input).length} caractères, max ${MAX_INPUT}). Réduis ou découpe l'analyse.` });

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
    let finishReason = null;
    for await (const chunk of stream) {
      const ch = chunk.choices?.[0];
      if (ch?.delta?.content) { full += ch.delta.content; res.write(ch.delta.content); }
      if (ch?.finish_reason) finishReason = ch.finish_reason;
    }
    // Garde anti-troncature : si le modèle a coupé sur la limite de longueur, le bloc
    // chiffré final (JSON P&L) est justement ce qui saute → livrable NON fiable. On le
    // signale et on REFUSE l'extraction finance (cf. plus bas).
    const truncated = finishReason === "length";
    if (truncated) res.write("\n\n⚠️ **[LIVRABLE TRONQUÉ]** — limite de longueur atteinte. Ne pas exploiter les chiffres tels quels ; relance en réduisant ou en découpant les données.\n<!--truncated-->");
    if (full.trim()) {
      const vlabel = isProposal ? ` (${VISIT_VARIANTS[variant].label})` : "";
      const d = store.addDeliverable({
        task, title: (title && title.trim()) || `${PROMPTS[task].label}${vlabel}${campus ? " — " + campus.name : ""}`,
        campusId: campus?.id || null, campusName: campus?.name || null, content: full, model: modelFor(task), signature: pnlSig,
      });
      res.write(`\n<!--deliverable:${d.id}-->`);
      // Zéro-hallucination : un P&L généré NE seed PLUS automatiquement la finance.
      // Les chiffres extraits par le modèle sont stockés en PROPOSITION à valider par le
      // directeur (Valider/Ignorer côté UI) → ils n'entrent en finance/board pack qu'après
      // confirmation humaine explicite. (Avant : auto-seed → chiffres non validés au conseil.)
      if (task === "pnl" && campus && !truncated) {
        const postes = extractPnlPostes(full);
        if (postes) {
          const month = postes.month || new Date().toISOString().slice(0, 7);
          store.setFinanceProposal(campus.id, { postes, month, deliverableId: d.id });
          logAudit(req, "propose", "finance", `P&L → ${campus.name} ${month} : ventilation extraite, EN ATTENTE de validation`);
        }
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

// --- Proposition de ventilation finance (chiffres extraits par l'IA, À VALIDER) ---
// Flux zéro-hallucination : la génération d'un P&L crée une proposition ; ces endpoints
// permettent de la relire, la VALIDER (→ intégrée en finance) ou l'IGNORER.
app.get("/api/campuses/:id/finance-proposal", campusGuard, (req, res) => {
  const p = store.getFinanceProposal(req.params.id);
  if (!p) return res.json({ pending: false });
  const sum = (arr) => (Array.isArray(arr) ? arr.reduce((s, l) => s + (Number(l.amount) || 0), 0) : 0);
  const po = p.postes || {};
  res.json({
    pending: true, month: p.month, createdAt: p.createdAt, deliverableId: p.deliverableId,
    summary: {
      revenue: { n: (po.revenue || []).length, total: sum(po.revenue) },
      payroll: { n: (po.payroll || []).length, total: sum(po.payroll) },
      charges: { n: (po.charges || []).length, total: sum(po.charges) },
    },
  });
});
app.post("/api/campuses/:id/finance-proposal/confirm", campusGuard, (req, res) => {
  const p = store.getFinanceProposal(req.params.id);
  if (!p || !p.postes) return res.status(404).json({ error: "aucune proposition en attente" });
  const r = seedFinanceFromPostes(req.params.id, p.postes);
  store.clearFinanceProposal(req.params.id);
  logAudit(req, "validate", "finance", `Ventilation P&L VALIDÉE → ${store.listCampuses().find((c) => c.id === req.params.id)?.name || ""} ${r.month} (${r.applied} poste(s))`);
  res.json({ ok: true, ...r });
});
app.post("/api/campuses/:id/finance-proposal/discard", campusGuard, (req, res) => {
  store.clearFinanceProposal(req.params.id);
  logAudit(req, "discard", "finance", "Ventilation P&L IGNORÉE (chiffres IA non intégrés)");
  res.json({ ok: true });
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
  if (kind === "learners") {
    const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
    const enr = new Map();
    for (const e of store.listEnrollments({})) if (!enr.has(e.learnerId)) enr.set(e.learnerId, e);
    const rows = scopeByCampus(req, store.listLearners({})).map((l) => {
      const e = enr.get(l.id);
      return { Campus: store.listCampuses().find((c) => c.id === l.campusId)?.name || "", Nom: l.nom, "Prénom": l.prenom,
        "Civilité": l.civilite, "Né(e) le": l.dateNaissance, INE: l.ine, Email: l.email, "Téléphone": l.telephone,
        RQTH: l.rqth ? "oui" : "", "Année": e?.schoolYear || "", Classe: e ? (classes.get(e.classId) || "") : "", Statut: e?.statut || "" };
    });
    return sendXlsx(res, "Apprenants", rows, "apprenants.xlsx");
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
// ===== Candidatures (funnel admissions) + connecteur Salesforce =====
function candidateGuard(req, res) {
  const c = store.getCandidate(req.params.id);
  if (!c) { res.status(404).json({ error: "candidature introuvable" }); return null; }
  if (c.campusId && !assertCampus(req, res, c.campusId)) return null;
  return c;
}

app.get("/api/candidates", requireAuth, (req, res) => {
  const { campusId, stage, q } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listCandidates({ campusId, stage, q });
  if (!campusId) items = items.filter((c) => !c.campusId ? req.user?.role === "admin" : canCampus(req, c.campusId));
  const names = new Map(store.listCampuses().map((c) => [c.id, c.name]));
  res.json(items.map((c) => ({ ...c, campusName: names.get(c.campusId) || null })));
});

app.post("/api/candidates", requireAuth, (req, res) => {
  const { campusId, nom, prenom } = req.body || {};
  if (!String(nom || "").trim() || !String(prenom || "").trim()) return res.status(400).json({ error: "nom et prénom requis" });
  if (campusId && !assertCampus(req, res, campusId)) return;
  if (!campusId && req.user?.role !== "admin") return res.status(400).json({ error: "campus requis" });
  const c = store.addCandidate({ ...req.body, source: "manuel" });
  logAudit(req, "create", "candidature", `${c.prenom} ${c.nom}`);
  res.json(c);
});

app.patch("/api/candidates/:id", requireAuth, (req, res) => {
  const c = candidateGuard(req, res);
  if (!c) return;
  if (req.body?.campusId && req.body.campusId !== c.campusId && !assertCampus(req, res, req.body.campusId)) return;
  const upd = store.updateCandidate(c.id, req.body || {});
  logAudit(req, "update", "candidature", `${upd.prenom} ${upd.nom} (${upd.stage})`);
  res.json(upd);
});

app.delete("/api/candidates/:id", requireAuth, (req, res) => {
  const c = candidateGuard(req, res);
  if (!c) return;
  store.deleteCandidate(c.id);
  logAudit(req, "delete", "candidature", `${c.prenom} ${c.nom}`);
  res.json({ ok: true });
});

// Conversion admis → dossier apprenant (sans re-saisie)
app.post("/api/candidates/:id/convert", requireAuth, (req, res) => {
  const c = candidateGuard(req, res);
  if (!c) return;
  // Une conversion qui RATTACHE un dossier existant ne consomme pas de place :
  // seule la création d'un nouveau dossier compte. C'est le store qui sait
  // lequel des deux cas s'applique, on lui passe donc l'interdiction plutôt que
  // de dupliquer ici sa logique de rapprochement.
  const motifQuota = quotaMotif("apprenants");
  const r = store.convertCandidate(c.id, {
    classId: req.body?.classId, schoolYear: req.body?.schoolYear,
    interdireCreation: !!motifQuota,
  });
  if (!r) return res.status(404).json({ error: "candidature introuvable" });
  if (r.quotaAtteint) return res.status(402).json({ error: motifQuota, code: "quota_atteint" });
  if (r.error) return res.status(409).json(r);
  logAudit(req, "create", "apprenant", `${r.learner.prenom} ${r.learner.nom} (conversion candidature${r.learnerCreated ? "" : " — dossier existant lié"})`);
  res.json(r);
});

function sfConfig() {
  const sf = store.getSettings().salesforce || {};
  return sf.instanceUrl && sf.clientId && sf.clientSecret ? sf : null;
}

async function syncSalesforce() {
  const cfg = sfConfig();
  if (!cfg || cfg.enabled === false) return null;
  const campuses = store.listCampuses();
  try {
    const rows = await sfFetchCandidates({ ...cfg, fields: Object.fromEntries(Object.entries(sfParsedFields(cfg)).filter(([, v]) => v)) }, campuses);
    const report = { created: 0, updated: 0, sansCampus: 0, total: rows.length };
    for (const row of rows) {
      if (!row.sfId) continue;
      if (!row.campusId) {
        report.sansCampus++;
        // Créé quand même (perdre le prospect serait pire), mais listé pour
        // affectation : sans campus, il échappe au cloisonnement par campus.
        report.aAffecter = report.aAffecter || [];
        if (report.aAffecter.length < 50) report.aAffecter.push(`${row.prenom} ${row.nom}`.trim() || row.sfId);
      }
      const r = store.upsertCandidateFromSf(row, { org: cfg.instanceUrl, baseLegale: cfg.baseLegale || "" });
      report[r.action === "created" ? "created" : "updated"]++;
    }
    store.updateSettings({ salesforce: { ...cfg, lastSync: new Date().toISOString(), lastError: null } });
    return report;
  } catch (e) {
    store.updateSettings({ salesforce: { ...cfg, lastError: { message: e.message, at: new Date().toISOString() } } });
    throw e;
  }
}
// fieldsText « cle = ChampSF » → objet fields du client
function sfParsedFields(cfg) {
  const out = {};
  for (const line of String(cfg.fieldsText || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

app.post("/api/salesforce/test", requireAuth, requireAdmin, async (req, res) => {
  const cfg = sfConfig();
  if (!cfg) return res.status(400).json({ error: "connecteur non configuré (URL + client id + secret requis)" });
  try { res.json(await sfTestConnection(cfg)); } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post("/api/salesforce/sync", requireAuth, requireAdmin, async (req, res) => {
  if (!sfConfig()) return res.status(400).json({ error: "connecteur non configuré (URL + client id + secret requis)" });
  try {
    const report = await syncSalesforce();
    logAudit(req, "seed", "salesforce", `sync : ${report.created} créées, ${report.updated} mises à jour, ${report.sansCampus} sans campus`);
    res.json(report);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ===== Apprenants & inscriptions (ERP Bloc 1) =====
// Cloisonnement : un directeur ne voit que les apprenants de ses campus.
function learnerGuard(req, res) {
  const l = store.getLearner(req.params.id);
  if (!l) { res.status(404).json({ error: "apprenant introuvable" }); return null; }
  if (!assertCampus(req, res, l.campusId)) return null;
  return l;
}

app.get("/api/learners", requireAuth, (req, res) => {
  const { campusId, q } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listLearners({ campusId, q });
  if (!campusId) items = scopeByCampus(req, items);
  // Inscription en cours jointe pour l'affichage liste (classe + statut)
  const enr = store.listEnrollments({});
  const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
  const byLearner = new Map();
  for (const e of enr) if (!byLearner.has(e.learnerId)) byLearner.set(e.learnerId, e);
  // Le RQTH est une donnée de santé (art. 9 RGPD) : elle n'a rien à faire dans une
  // liste consultée par tout le campus. Elle reste sur la FICHE, accessible aux
  // seuls profils qui en ont besoin, et sa consultation y est tracée.
  res.json(items.map((l) => {
    const e = byLearner.get(l.id) || null;
    const { rqth, notes, repLegalNom, repLegalTel, repLegalEmail, ...publiques } = l;
    return { ...publiques, enrollment: e ? { ...e, className: classes.get(e.classId) || null } : null };
  }));
});

app.post("/api/learners", requireAuth, (req, res) => {
  const { campusId, nom, prenom } = req.body || {};
  if (!requireCampus(req, res, campusId)) return;
  if (!String(nom || "").trim() || !String(prenom || "").trim()) return res.status(400).json({ error: "nom et prénom requis" });
  if (quotaBloque(req, res, "apprenants")) return;
  const l = store.addLearner(req.body);
  logAudit(req, "create", "apprenant", `${l.prenom} ${l.nom}`);
  res.json(l);
});

app.get("/api/learners/:id", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
  // Accès à la donnée de santé : réservé aux profils qui en ont l'usage
  // (direction, référent handicap), et journalisé — l'art. 9 impose de savoir
  // qui a consulté quoi.
  const peutVoirSante = req.user?.role === "admin" || req.user?.role === "directeur";
  const { rqth, ...sansSante } = l;
  if (peutVoirSante && rqth) logAudit(req, "read", "donnee-sante", `consultation RQTH — ${l.prenom} ${l.nom}`);
  res.json({
    ...(peutVoirSante ? l : sansSante),
    enrollments: store.listEnrollments({ learnerId: l.id }).map((e) => ({ ...e, className: classes.get(e.classId) || null })),
    documents: store.listDocuments(l.campusId, null, l.id),
    timeline: store.learnerTimeline(l.id),
  });
});

app.patch("/api/learners/:id", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  if (req.body?.campusId && req.body.campusId !== l.campusId && !assertCampus(req, res, req.body.campusId)) return;
  const upd = store.updateLearner(l.id, req.body || {});
  logAudit(req, "update", "apprenant", `${upd.prenom} ${upd.nom}`);
  res.json(upd);
});

// Droit à l'effacement : la suppression doit ATTEINDRE les fichiers, pas seulement
// les enregistrements. Les images de signature et les pièces du dossier vivent sur
// disque et survivraient à une suppression en base.
app.delete("/api/learners/:id", requireAuth, requireAdmin, (req, res) => {
  const l = store.getLearner(req.params.id);
  if (!l) return res.json({ ok: true });
  if (!assertCampus(req, res, l.campusId)) return;
  const r = store.deleteLearner(l.id);
  let fichiers = 0;
  for (const d of r.documentIds || []) {
    if (!d.file) continue;
    try { fs.unlinkSync(path.join(DOCS_DIR, d.file)); fichiers++; } catch { /* déjà absent */ }
  }
  const signatures = attendancestore.deleteSignaturesOfLearner(l.id);
  attendancestore.removeLearnerFromOpenSheets(l.id);
  logAudit(req, "delete", "apprenant", `${l.prenom} ${l.nom} — effacement RGPD : ${r.contractIds.length} contrat(s), ${fichiers} document(s), ${signatures} signature(s)`);
  res.json({ ok: true, contrats: r.contractIds.length, documents: fichiers, signatures });
});

// Autorisations parentales : horodatées, nominatives, à portée explicite.
app.put("/api/learners/:id/consent", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const { scope, accorde, par, note } = req.body || {};
  if (!String(par || "").trim()) return res.status(400).json({ error: "nom du signataire requis — une autorisation anonyme n'en est pas une" });
  const r = store.setConsent(l.id, { scope, accorde, par, note });
  if (r?.error) return res.status(400).json(r);
  logAudit(req, "update", "consentement", `${scope} ${accorde ? "accordé" : "refusé"} pour ${l.prenom} ${l.nom} (par ${par})`);
  res.json({ consentements: r.consentements });
});

app.post("/api/learners/:id/enrollments", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  if (!String(req.body?.schoolYear || "").trim()) return res.status(400).json({ error: "année scolaire requise (ex. 2026-2027)" });
  const e = store.addEnrollment({ ...req.body, learnerId: l.id, campusId: l.campusId });
  if (e?.error) return res.status(409).json(e);
  logAudit(req, "create", "inscription", `${l.prenom} ${l.nom} — ${e.schoolYear}`);
  res.json(e);
});

app.patch("/api/learners/:id/enrollments/:eid", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const e = store.updateEnrollment(req.params.eid, req.body || {});
  if (!e) return res.status(404).json({ error: "inscription introuvable" });
  logAudit(req, "update", "inscription", `${l.prenom} ${l.nom} — ${e.schoolYear} (${e.statut})`);
  res.json(e);
});

app.delete("/api/learners/:id/enrollments/:eid", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  store.deleteEnrollment(req.params.eid);
  res.json({ ok: true });
});

app.post("/api/learners/:id/documents", requireAuth, uploadDoc, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  if (!req.file) return res.status(400).json({ error: "fichier manquant" });
  const fname = crypto.randomUUID();
  fs.writeFileSync(path.join(DOCS_DIR, fname), encryptBuffer(req.file.buffer));
  const doc = store.addDocument({
    campusId: l.campusId, campusName: store.listCampuses().find((c) => c.id === l.campusId)?.name || null,
    name: req.file.originalname, size: req.file.size, mime: req.file.mimetype,
    category: req.body?.category || "apprenant", learnerId: l.id, file: fname,
  });
  logAudit(req, "upload", "document", `${doc.name} (apprenant ${l.prenom} ${l.nom})`);
  res.json(doc);
});

// Import en masse (CSV/XLSX) : peuple un campus à la rentrée en une fois.
// En-têtes reconnues (insensibles casse/accents) : nom, prenom, civilite, date_naissance,
// lieu_naissance, ine, email, telephone, adresse, rqth, rep_legal_nom, rep_legal_tel,
// rep_legal_email, classe, annee_scolaire. Doublon = même INE ou même nom+prénom+naissance.
app.post("/api/campuses/:id/learners/import", campusGuard, uploadOne, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "fichier manquant" });
  let rows;
  try {
    // raw:true à la lecture = le CSV garde ses chaînes telles quelles (pas de
    // conversion auto des dates en séries) ; les .xlsx gardent leurs cellules typées.
    const wb = XLSX.read(req.file.buffer, { type: "buffer", raw: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  } catch { return res.status(400).json({ error: "fichier illisible (CSV ou Excel attendu)" }); }
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const get = (row, ...keys) => {
    for (const k of Object.keys(row)) if (keys.includes(norm(k))) return String(row[k]).trim();
    return "";
  };
  const cid = req.params.id;
  const existing = store.listLearners({ campusId: cid });
  const byIne = new Map(existing.filter((l) => l.ine).map((l) => [l.ine, l]));
  const byIdent = new Set(existing.map((l) => `${l.nom}|${l.prenom}|${l.dateNaissance}`.toLowerCase()));
  const classes = store.listClasses({ campusId: cid });
  const findClass = (name) => classes.find((k) => norm(k.name) === norm(name)) || null;
  const report = { created: 0, enrolled: 0, skipped: [] };
  // Le plafond du plan s'applique aussi ici — c'est même LE chemin par lequel on
  // dépasse : un fichier de 5 000 lignes sur un plan à 300 places. On importe
  // jusqu'au plafond et on NOMME les lignes refusées ligne à ligne, plutôt que
  // de tronquer en silence (un rapport qui dit « 300 créés » sur 5 000 lignes se
  // lit comme un succès) ou de tout refuser (un fichier de 50 lignes à 299/300
  // ne passerait jamais).
  let placesRestantes = quotaRestant("apprenants");
  rows.forEach((row, i) => {
    const ligne = i + 2; // 1 = en-têtes
    const nom = get(row, "nom"), prenom = get(row, "prenom");
    if (!nom || !prenom) { report.skipped.push({ ligne, motif: "nom ou prénom manquant" }); return; }
    const ine = get(row, "ine").toUpperCase();
    // Date : format FR/ISO en texte, ou série Excel (cellule date d'un .xlsx)
    const rawDdn = get(row, "datenaissance", "ddn", "nele", "neele");
    const ddn = parseFrDate(rawDdn) || (/^\d{4,5}$/.test(rawDdn) ? new Date((Number(rawDdn) - 25569) * 864e5).toISOString().slice(0, 10) : rawDdn);
    if (ine && byIne.has(ine)) { report.skipped.push({ ligne, motif: `doublon INE ${ine}` }); return; }
    if (byIdent.has(`${nom}|${prenom}|${ddn || ""}`.toLowerCase())) { report.skipped.push({ ligne, motif: "doublon nom+prénom+naissance" }); return; }
    if (placesRestantes !== null && placesRestantes <= 0) {
      report.plafondAtteint = true;
      report.skipped.push({ ligne, motif: "plafond du plan atteint" });
      return;
    }
    const l = store.addLearner({
      campusId: cid, nom, prenom, civilite: get(row, "civilite"),
      dateNaissance: ddn || "", lieuNaissance: get(row, "lieunaissance"), ine,
      email: get(row, "email"), telephone: get(row, "telephone", "tel"), adresse: get(row, "adresse"),
      rqth: ["1", "oui", "true", "x"].includes(get(row, "rqth").toLowerCase()),
      repLegalNom: get(row, "replegalnom"), repLegalTel: get(row, "replegaltel"), repLegalEmail: get(row, "replegalemail"),
    });
    if (l.ine) byIne.set(l.ine, l);
    byIdent.add(`${l.nom}|${l.prenom}|${l.dateNaissance}`.toLowerCase());
    if (placesRestantes !== null) placesRestantes--;
    report.created++;
    const classe = findClass(get(row, "classe"));
    const year = get(row, "anneescolaire", "annee");
    if (year) {
      const e = store.addEnrollment({ learnerId: l.id, campusId: cid, classId: classe?.id || null, schoolYear: year });
      if (e && !e.error) report.enrolled++;
    }
  });
  logAudit(req, "seed", "apprenants", `import ${req.file.originalname} : ${report.created} créés, ${report.enrolled} inscrits, ${report.skipped.length} ignorés`);
  res.json(report);
});

// ===== Connecteur SI campus (ERP de gestion) =====
// Le jeton est créé côté campus dans le module « prestataires webservices REST »
// du SI ; il n'est jamais renvoyé au client (tokenMask).
async function syncSiCampus(c) {
  const cfg = store.getSiConfig(c.id);
  if (!cfg || cfg.enabled === false) return null;
  try {
    const summary = await siSyncCampus(cfg, { windowDays: 30 });
    store.setSiSnapshot(c.id, summary);
    // KPI auto-alimentés (merge par campus+mois : n'écrase que ces champs)
    const month = new Date().toISOString().slice(0, 7);
    const kpi = { campusId: c.id, month };
    if (summary.effectif != null) kpi.students = summary.effectif;
    if (summary.contrats?.actifs != null) kpi.alternants = summary.contrats.actifs;
    if (kpi.students != null || kpi.alternants != null) store.addKpi(kpi);
    return { ok: true, summary };
  } catch (e) {
    store.setSiError(c.id, e.message);
    return { ok: false, error: e.message };
  }
}

app.get("/api/si/overview", requireAuth, (req, res) => {
  const rows = store.listCampuses().filter((c) => canCampus(req, c.id)).map((c) => {
    const snap = store.getSiSnapshot(c.id);
    return {
      campusId: c.id, campus: c.name, config: store.maskSiConfig(c.id),
      syncedAt: snap?.syncedAt || null, lastError: snap?.lastError || null,
      summary: snap?.summary || null, history: snap?.history || [],
    };
  });
  res.json(rows);
});

app.put("/api/campuses/:id/si/config", requireAuth, requireAdmin, (req, res) => {
  const { baseUrl, token, codesSite, enabled } = req.body || {};
  if (baseUrl && !/^https?:\/\//.test(String(baseUrl))) return res.status(400).json({ error: "URL du SI invalide (http(s) attendu)" });
  const cfg = store.setSiConfig(req.params.id, { baseUrl, token, codesSite, enabled });
  if (!cfg) return res.status(404).json({ error: "campus inconnu" });
  logAudit(req, "update", "si", `config connecteur SI (${req.params.id})`);
  res.json(store.maskSiConfig(req.params.id));
});

app.post("/api/campuses/:id/si/test", requireAuth, requireAdmin, async (req, res) => {
  const cfg = store.getSiConfig(req.params.id);
  if (!cfg) return res.status(400).json({ error: "connecteur non configuré (URL + jeton requis)" });
  try { res.json(await siTestConnection(cfg)); } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post("/api/campuses/:id/si/sync", requireAuth, requireAdmin, async (req, res) => {
  const c = store.listCampuses().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "campus inconnu" });
  if (!store.getSiConfig(c.id)) return res.status(400).json({ error: "connecteur non configuré (URL + jeton requis)" });
  const r = await syncSiCampus(c);
  if (!r?.ok) return res.status(502).json({ error: r?.error || "synchronisation impossible" });
  logAudit(req, "seed", "si", `sync SI ${c.name}`);
  res.json({ ok: true, summary: r.summary });
});

app.post("/api/si/sync", requireAuth, requireAdmin, async (req, res) => {
  const results = [];
  for (const c of store.listCampuses()) {
    if (!store.getSiConfig(c.id)) continue;
    const r = await syncSiCampus(c);
    if (r) results.push({ campusId: c.id, campus: c.name, ok: r.ok, error: r.error || null });
  }
  logAudit(req, "seed", "si", `sync SI réseau (${results.length} campus)`);
  res.json({ results });
});

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
  // Contrats d'alternance : ruptures en cours, fins de période d'essai et de contrat
  // Index construits UNE fois : la version précédente reconstruisait et triait la
  // liste des campus, et balayait tous les apprenants, pour CHAQUE alerte.
  const contrats = scopeByCampus(req, store.listContracts({}));
  if (contrats.length) {
    const nomCampus = new Map(store.listCampuses().map((x) => [x.id, x.name]));
    const nomApprenant = new Map(store.listLearners({}).map((l) => [l.id, `${l.prenom} ${l.nom}`]));
    for (const c of contrats) {
      const who = nomApprenant.get(c.learnerId) || "apprenant";
      for (const al of contractAlerts(c, today)) {
        notifs.push({ type: al.type === "rupture" ? "rupture_contrat" : "contrat", severity: al.severity,
          campusId: c.campusId, campus: nomCampus.get(c.campusId) || "",
          label: `${who} — ${al.label}`, date: al.date, contractId: c.id });
      }
    }
  }
  // Signaux du SI campus : ruptures de contrat en cours, absentéisme, synchro en échec
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) {
    const snap = store.getSiSnapshot(c.id);
    if (!snap) continue;
    const s = snap.summary;
    const nR = s?.contrats?.rupturesEnCours?.length || 0;
    if (nR) notifs.push({ type: "rupture", severity: "high", campusId: c.id, campus: c.name, label: `${nR} rupture${nR > 1 ? "s" : ""} de contrat en cours (SI)`, date: null });
    const ar = s?.assiduite?.absentRate;
    if (ar != null && ar > th.absenteeism) notifs.push({ type: "absenteisme", severity: ar > th.absenteeism + 5 ? "high" : "medium", campusId: c.id, campus: c.name, label: `Absentéisme à ${ar}% (seuil ${th.absenteeism}%)`, date: null });
    if (snap.lastError && (!snap.syncedAt || snap.lastError.at > snap.syncedAt)) notifs.push({ type: "si", severity: "low", campusId: c.id, campus: c.name, label: "Synchro SI en échec", date: (snap.lastError.at || "").slice(0, 10) || null });
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
  if (req.body?.status === "ouvert" && !before?.campusId) {
    converted = convertOpeningToCampus(req, store.getOpening(o.id));
    // Le projet reste passé à « ouvert » : refuser la bascule entière pour un
    // plafond serait disproportionné. On dit simplement que la fiche campus
    // n'a pas été créée, et pourquoi.
    if (converted?.error) converted = { error: converted.error, code: converted.code };
  }
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

// --- Livrables attendus d'une action (suivi sans fichier, fichier optionnel) ---
app.post("/api/openings/:id/tasks/:tid/outputs", requireAuth, requireAdmin, (req, res) => {
  const out = store.addTaskOutput(req.params.id, req.params.tid, req.body || {});
  if (!out) return res.status(404).json({ error: "action introuvable" });
  logAudit(req, "create", "opening", `livrable « ${out.label} »`);
  res.json(out);
});
app.patch("/api/openings/:id/tasks/:tid/outputs/:oid", requireAuth, requireAdmin, (req, res) => {
  const out = store.updateTaskOutput(req.params.id, req.params.tid, req.params.oid, req.body || {});
  if (!out) return res.status(404).json({ error: "introuvable" });
  res.json(out);
});
app.delete("/api/openings/:id/tasks/:tid/outputs/:oid", requireAuth, requireAdmin, (req, res) => {
  store.deleteTaskOutput(req.params.id, req.params.tid, req.params.oid);
  res.json({ ok: true });
});
// Dépôt du fichier d'un livrable : réutilise la GED (binaire chiffré sur disque), le
// livrable ne garde que l'identifiant du document.
app.post("/api/openings/:id/tasks/:tid/outputs/:oid/document", requireAuth, requireAdmin, uploadDoc, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "fichier manquant" });
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "ouverture introuvable" });
  try {
    if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
    const fname = crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(path.join(DOCS_DIR, fname), encryptBuffer(req.file.buffer));
    const doc = store.addDocument({
      campusId: o.campusId || null, campusName: o.name,
      name: req.file.originalname, size: req.file.size, mime: req.file.mimetype,
      category: "ouverture", file: fname,
    });
    const out = store.updateTaskOutput(req.params.id, req.params.tid, req.params.oid, { documentId: doc.id, status: "produced" });
    if (!out) return res.status(404).json({ error: "livrable introuvable" });
    logAudit(req, "upload", "document", `${doc.name} (ouverture ${o.name})`);
    res.json({ output: out, document: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Checklist d'une action : les étapes du « comment » ---
app.post("/api/openings/:id/tasks/:tid/steps", requireAuth, requireAdmin, (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "intitulé requis" });
  const s = store.addTaskStep(req.params.id, req.params.tid, { text });
  if (!s) return res.status(404).json({ error: "action introuvable" });
  res.json(s);
});
app.patch("/api/openings/:id/tasks/:tid/steps/:sid", requireAuth, requireAdmin, (req, res) => {
  const s = store.updateTaskStep(req.params.id, req.params.tid, req.params.sid, req.body || {});
  if (!s) return res.status(404).json({ error: "introuvable" });
  res.json(s);
});
app.delete("/api/openings/:id/tasks/:tid/steps/:sid", requireAuth, requireAdmin, (req, res) => {
  store.deleteTaskStep(req.params.id, req.params.tid, req.params.sid);
  res.json({ ok: true });
});

// --- Échanges sur une action ---
app.post("/api/openings/:id/tasks/:tid/comments", requireAuth, requireAdmin, (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "message vide" });
  const c = store.addTaskComment(req.params.id, req.params.tid, { by: req.user?.name || req.user?.email || "", text });
  if (!c) return res.status(404).json({ error: "action introuvable" });
  res.json(c);
});
app.delete("/api/openings/:id/tasks/:tid/comments/:cid", requireAuth, requireAdmin, (req, res) => {
  store.deleteTaskComment(req.params.id, req.params.tid, req.params.cid);
  res.json({ ok: true });
});

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
  // Un projet d'ouverture qui bascule en « ouvert » crée un campus : le plafond
  // du plan s'y applique comme sur la création directe.
  const motif = quotaMotif("campus");
  if (motif) return { error: motif, code: "quota_atteint" };
  const c = store.addCampus({ name: o.name, city: o.city, region: o.region, address: o.address });
  store.setOpeningCampus(o.id, c.id);
  logAudit(req, "create", "campus", `${c.name} (depuis ouverture)`);
  return { campusId: c.id };
}
app.post("/api/openings/:id/convert", requireAuth, requireAdmin, (req, res) => {
  const o = store.getOpening(req.params.id);
  if (!o) return res.status(404).json({ error: "introuvable" });
  const r = convertOpeningToCampus(req, o);
  if (r.error) return res.status(402).json(r);
  if (o.status !== "ouvert") store.updateOpening(o.id, { status: "ouvert" });
  res.json({ ok: true, ...r });
});
// ===== Comités de pilotage (ouverture / campus / réseau) =====
app.get("/api/committees", requireAuth, requireAdmin, (req, res) => {
  const { scope, scopeId } = req.query;
  res.json(store.listCommittees({ scope, scopeId: scopeId === undefined ? undefined : scopeId || null }));
});
app.get("/api/committees/:id", requireAuth, requireAdmin, (req, res) => {
  const c = store.getCommittee(req.params.id);
  if (!c) return res.status(404).json({ error: "introuvable" });
  res.json(c);
});
app.post("/api/committees", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: "nom requis" });
  const c = store.addCommittee(req.body);
  logAudit(req, "create", "committee", c.name);
  res.json(c);
});
app.patch("/api/committees/:id", requireAuth, requireAdmin, (req, res) => {
  const c = store.updateCommittee(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "committee", c.name);
  res.json(c);
});
app.delete("/api/committees/:id", requireAuth, requireAdmin, (req, res) => {
  const c = store.getCommittee(req.params.id);
  store.deleteCommittee(req.params.id);
  if (c) logAudit(req, "delete", "committee", c.name);
  res.json({ ok: true });
});

app.post("/api/committees/:id/sessions", requireAuth, requireAdmin, (req, res) => {
  const s = store.addSession(req.params.id, req.body || {});
  if (!s) return res.status(404).json({ error: "comité introuvable" });
  res.json(s);
});
app.patch("/api/committees/:id/sessions/:sid", requireAuth, requireAdmin, (req, res) => {
  const s = store.updateSession(req.params.id, req.params.sid, req.body || {});
  if (!s) return res.status(404).json({ error: "introuvable" });
  res.json(s);
});
app.delete("/api/committees/:id/sessions/:sid", requireAuth, requireAdmin, (req, res) => {
  store.deleteSession(req.params.id, req.params.sid);
  res.json({ ok: true });
});

// Crée une action d'ouverture depuis une séance et garde le lien dans les deux sens.
app.post("/api/committees/:id/sessions/:sid/tasks", requireAuth, requireAdmin, (req, res) => {
  const c = store.getCommittee(req.params.id);
  if (!c) return res.status(404).json({ error: "comité introuvable" });
  if (c.scope !== "opening" || !c.scopeId) {
    return res.status(400).json({ error: "ce comité n'est pas rattaché à une ouverture" });
  }
  if (!String(req.body?.title || "").trim()) return res.status(400).json({ error: "intitulé requis" });
  const t = store.addOpeningTask(c.scopeId, { ...(req.body || {}), committeeId: c.id, sessionId: req.params.sid });
  if (!t) return res.status(404).json({ error: "ouverture introuvable" });
  store.linkSessionTask(c.id, req.params.sid, t.id);
  logAudit(req, "create", "opening", `action « ${t.title} » (COPIL ${c.name})`);
  res.json(t);
});

// Ordre du jour assisté : nourri des retards, des livrables non produits et des décisions
// non soldées de la séance précédente. Même motif que /api/codir/agenda-draft.
app.post("/api/committees/:id/sessions/:sid/agenda-draft", requireAuth, requireAdmin, requireIA, async (req, res) => {
  const c = store.getCommittee(req.params.id);
  if (!c) return res.status(404).json({ error: "comité introuvable" });
  const sessions = (c.sessions || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const idx = sessions.findIndex((s) => s.id === req.params.sid);
  const prev = idx > 0 ? sessions[idx - 1] : null;
  const today = new Date().toISOString().slice(0, 10);

  const lines = [`Comité : ${c.name}${c.cadence ? ` (${c.cadence})` : ""}`];
  if (c.members?.length) lines.push(`Membres : ${c.members.map((m) => `${m.name}${m.role ? ` — ${m.role}` : ""}`).join(", ")}`);

  if (c.scope === "opening" && c.scopeId) {
    const o = store.getOpening(c.scopeId);
    if (o) {
      const tasks = o.tasks || [];
      const late = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today);
      const done = tasks.filter((t) => t.status === "done").length;
      lines.push(`Projet : ${o.name}${o.city ? ` (${o.city})` : ""} — rentrée ${o.targetDate || "non datée"} — avancement ${tasks.length ? Math.round((done / tasks.length) * 100) : 0} %`);
      if (late.length) lines.push(`Actions en retard (${late.length}) :\n` + late.slice(0, 15).map((t) => `- ${t.title} (${t.dueDate}${t.owner ? `, ${t.owner}` : ""})`).join("\n"));
      const pending = tasks.flatMap((t) => (t.outputs || []).filter((o2) => o2.status !== "validated").map((o2) => `- ${o2.label} [${o2.status}] — action « ${t.title} »`));
      if (pending.length) lines.push(`Livrables non validés (${pending.length}) :\n` + pending.slice(0, 15).join("\n"));
    }
  }
  if (prev) {
    lines.push(`Séance précédente du ${prev.date || "?"} :`);
    if (prev.resolutions?.length) lines.push("Décisions prises :\n" + prev.resolutions.map((r) => `- ${r.text}${r.owner ? ` (${r.owner}` : ""}${r.dueDate ? `, ${r.dueDate})` : r.owner ? ")" : ""}`).join("\n"));
    if (prev.minutes) lines.push(`Compte rendu précédent :\n${prev.minutes.slice(0, 2000)}`);
  }

  try {
    const resp = await openai.chat.completions.create({
      model: modelFor("ordre_du_jour"),
      messages: [{ role: "system", content: COPIL_AGENDA }, { role: "user", content: lines.join("\n\n") }],
      max_completion_tokens: 2500,
    });
    res.json({ draft: resp.choices?.[0]?.message?.content || "", truncated: resp.choices?.[0]?.finish_reason === "length" });
  } catch (e) {
    console.error("[copil-agenda]", e?.message || e);
    res.status(500).json({ error: "génération impossible" });
  }
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

// ===== Plans de redressement campus (30/60/90 jours) =====
app.get("/api/recoveries", requireAuth, requireAdmin, (req, res) => {
  res.json(store.listRecoveries().filter((r) => !r.campusId || canCampus(req, r.campusId)));
});
app.post("/api/recoveries", requireAuth, requireAdmin, (req, res) => {
  const cid = req.body?.campusId;
  if (!cid || !canCampus(req, cid)) return res.status(400).json({ error: "campus requis / hors périmètre" });
  const campus = store.listCampuses().find((c) => c.id === cid);
  const r = store.addRecovery({ ...req.body, campusName: campus?.name || null });
  logAudit(req, "create", "recovery", campus?.name || cid);
  res.json(r);
});
// Brouillon de plan de redressement PRÉ-REMPLI par l'IA depuis les signaux réels du campus
// (dimensions dégradées + dérives + actions en retard). Ne sauvegarde RIEN : renvoie un
// brouillon que le directeur relit/édite avant création. Transforme le cockpit de constat en décision.
app.post("/api/campuses/:id/recovery-draft", campusGuard, requireIA, async (req, res) => {
  const campus = store.listCampuses().find((c) => c.id === req.params.id);
  if (!campus) return res.status(404).json({ error: "campus introuvable" });
  const row = buildNetworkRows(req).find((r) => r.id === campus.id) || {};
  const today = new Date().toISOString().slice(0, 10);
  const overdue = store.listActions({ campusId: campus.id }).filter((a) => a.status !== "done" && a.dueDate && a.dueDate < today);
  const hist = kpiHistory(campus.id);
  const drifts = [];
  const mS = decliningStreak(hist, marginPctOf); if (mS >= 2) drifts.push(`marge en baisse depuis ${mS} mois`);
  const oS = decliningStreak(hist, (x) => x.occupancy); if (oS >= 2) drifts.push(`remplissage en dégradation depuis ${oS} mois`);
  const sS = decliningStreak(hist, (x) => x.satisfaction); if (sS >= 2) drifts.push(`satisfaction en baisse depuis ${sS} mois`);
  const adPct = row.admissions?.objectif ? Math.round(((row.admissions.inscrits || 0) / row.admissions.objectif) * 100) : null;
  if (adPct != null && adPct < 70) drifts.push(`admissions à ${adPct}% de l'objectif`);
  const failing = (row.healthDetail || []).filter((d) => d.score < 60).map((d) => `${d.label} (${d.score}/100)`);
  const val = (v, s) => (v != null ? v + s : "[DONNEE MANQUANTE]");
  const signals = [
    `Campus : ${campus.name}${campus.city ? " (" + campus.city + ")" : ""}`,
    `Score de santé : ${val(row.health, "/100")}`,
    failing.length ? `Dimensions dégradées : ${failing.join(", ")}` : "",
    `Remplissage ${val(row.occupancy, "%")} · Qualiopi ${val(row.qualiopi, "%")} · satisfaction ${val(row.satisfaction, "/10")} · marge ${val(row.margin, "€")}`,
    `Actions en retard : ${overdue.length}${overdue.length ? " — " + overdue.slice(0, 6).map((a) => a.title || a.mesures).join(" ; ") : ""}`,
    `Incidents/réclamations ouverts : ${row.openIncidents || 0}`,
    drifts.length ? `Dérives de tendance : ${drifts.join(" ; ")}` : "Aucune dérive de tendance détectée",
  ].filter(Boolean).join("\n");
  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 2200,
      messages: [{ role: "system", content: RECOVERY_PLAN }, { role: "user", content: `Date : ${today}\n\nSignaux du campus :\n${signals}` }],
    });
    if (resp.choices?.[0]?.finish_reason === "length") return res.status(502).json({ error: "brouillon tronqué, réessaie" });
    const txt = resp.choices?.[0]?.message?.content || "";
    const m = txt.match(/\{[\s\S]*\}/);
    let d; try { d = JSON.parse(m ? m[0] : txt); } catch { return res.status(502).json({ error: "réponse IA non exploitable" }); }
    const cleanH = (a) => (Array.isArray(a) ? a : []).filter((x) => x && String(x.text || "").trim()).map((x) => ({ text: String(x.text).trim(), owner: String(x.owner || "").trim() }));
    res.json({ campusId: campus.id, campusName: campus.name, signals,
      diagnostic: String(d.diagnostic || ""), h30: cleanH(d.h30), h60: cleanH(d.h60), h90: cleanH(d.h90), exitCriteria: String(d.exitCriteria || "") });
  } catch (e) {
    console.error("[recovery-draft]", e?.message || e);
    res.status(500).json({ error: "génération impossible" });
  }
});
app.patch("/api/recoveries/:id", requireAuth, requireAdmin, (req, res) => {
  const cur = store.listRecoveries().find((x) => x.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!canCampus(req, cur.campusId)) return res.status(403).json({ error: "hors périmètre" });
  const r = store.updateRecovery(req.params.id, req.body || {});
  logAudit(req, "update", "recovery", cur.campusName || cur.campusId);
  res.json(r);
});
app.delete("/api/recoveries/:id", requireAuth, requireAdmin, (req, res) => {
  const cur = store.listRecoveries().find((x) => x.id === req.params.id);
  if (cur && !canCampus(req, cur.campusId)) return res.status(403).json({ error: "hors périmètre" });
  store.deleteRecovery(req.params.id);
  logAudit(req, "delete", "recovery", cur?.campusName || req.params.id);
  res.json({ ok: true });
});

// ===== Prévision consolidée réseau (effectifs + finance vs objectifs) =====
function admForecastSrv(a) {
  const c = +a.candidatures || 0, e = +a.entretiens || 0, ad = +a.admis || 0, ins = +a.inscrits || 0, obj = +a.objectif || 0;
  if (!c && !ad && !ins) return null;
  const r1 = c ? e / c : 0.6, r2 = e ? ad / e : 0.5, r3 = ad ? ins / ad : 0.7;
  let central = c ? Math.round(c * r1 * r2 * r3) : Math.max(ins, Math.round(ad * 0.7));
  central = Math.max(central, ins);
  return { central, prudent: Math.max(ins, Math.round(central * 0.85)), optimiste: Math.round(central * 1.15), obj, ins };
}
app.get("/api/forecast/consolidated", requireAuth, requireAdmin, (req, res) => {
  const rows = buildNetworkRows(req);
  const campById = Object.fromEntries(store.listCampuses().map((c) => [c.id, c]));
  let effObj = 0, effCentral = 0, effPrudent = 0, effOpt = 0, effIns = 0, caObj = 0, caReal = 0, margeReal = 0;
  const campuses = rows.map((r) => {
    const c = campById[r.id] || {};
    const k = store.latestKpi(r.id) || {};
    const f = admForecastSrv(r.admissions || {});
    const objRev = c.objectives?.revenue || null;
    if (f) { effObj += f.obj || 0; effCentral += f.central; effPrudent += f.prudent; effOpt += f.optimiste; effIns += f.ins; }
    if (objRev) caObj += objRev;
    if (k.revenue != null) { caReal += k.revenue; margeReal += marginOf(k) || 0; }
    const atRisk = !!((f && f.obj && f.central < f.obj * 0.85) || (k.revenue && marginOf(k) < 0) || (r.health != null && r.health < 50));
    return { campusId: r.id, campus: r.name, health: r.health, adObj: f?.obj ?? null, adCentral: f?.central ?? null, adPrudent: f?.prudent ?? null, adOpt: f?.optimiste ?? null, objRevenue: objRev, revenue: k.revenue ?? null, margin: marginOf(k), atRisk };
  });
  res.json({
    effectifs: { objectif: effObj, central: effCentral, prudent: effPrudent, optimiste: effOpt, acquis: effIns },
    finance: { objectifCA: caObj || null, caReal: caReal || null, margeReal: margeReal || null },
    campuses,
    atRisk: campuses.filter((c) => c.atRisk),
  });
});

// ===== Arbitrages CODIR (fiches de décision structurées) =====
app.get("/api/arbitrages", requireAuth, requireAdmin, (req, res) => res.json(store.listArbitrages().filter((a) => !a.campusId || canCampus(req, a.campusId))));
// Ordre du jour CODIR (IA) : généré depuis les DONNÉES RÉELLES du réseau (dérives,
// arbitrages en attente, décisions, retards), sauvé comme livrable exportable Word/PDF.
app.post("/api/codir/agenda-draft", requireAuth, requireAdmin, requireIA, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = buildNetworkRows(req);
  const netLine = rows.map((r) => `- ${r.name} : santé ${r.health ?? "?"}/100 · remplissage ${r.occupancy ?? "?"}% · Qualiopi ${r.qualiopi ?? "?"}% · marge ${r.margin ?? "?"}€ · ${r.overdue || 0} action(s) en retard${r.openIncidents ? ` · ${r.openIncidents} incident(s)` : ""}`).join("\n");
  const drifts = [];
  for (const r of rows) {
    const hist = kpiHistory(r.id);
    const mS = decliningStreak(hist, marginPctOf); if (mS >= 2) drifts.push(`${r.name} : marge en baisse depuis ${mS} mois`);
    const oS = decliningStreak(hist, (x) => x.occupancy); if (oS >= 2) drifts.push(`${r.name} : remplissage en dégradation depuis ${oS} mois`);
    const sS = decliningStreak(hist, (x) => x.satisfaction); if (sS >= 2) drifts.push(`${r.name} : satisfaction en baisse depuis ${sS} mois`);
    if (r.openIncidents >= 2) drifts.push(`${r.name} : incidents récurrents (${r.openIncidents} ouverts)`);
  }
  const arbs = store.listArbitrages().filter((a) => (!a.campusId || canCampus(req, a.campusId)) && ["toprepare", "pending"].includes(a.status));
  const arbLine = arbs.map((a) => `- [${a.status === "toprepare" ? "à préparer" : "en attente"}] ${a.title}${a.campusName ? " (" + a.campusName + ")" : ""}${a.recommendation ? " — reco : " + String(a.recommendation).slice(0, 200) : ""}${a.dueDate ? " — échéance " + a.dueDate : ""}`).join("\n");
  const decs = store.listDecisions().slice(0, 5).map((d) => `- ${d.decidedAt ? d.decidedAt.slice(0, 10) : ""} : ${d.title || d.decision || ""}`).join("\n");
  const overdue = scopeByCampus(req, store.listActions()).filter((a) => a.status !== "done" && a.dueDate && a.dueDate < today);
  const ctx = [
    `Date : ${today} · Réseau : ${rows.length} campus`,
    `=== Synthèse par campus ===\n${netLine || "(aucun campus)"}`,
    `=== Dérives détectées ===\n${drifts.length ? drifts.map((d) => "- " + d).join("\n") : "(aucune)"}`,
    `=== Arbitrages à trancher (${arbs.length}) ===\n${arbLine || "(aucun)"}`,
    `=== Décisions récentes (suivi) ===\n${decs || "(aucune)"}`,
    `=== Actions en retard : ${overdue.length} ===\n${overdue.slice(0, 8).map((a) => `- ${a.title || a.mesures} (${a.campusName || "réseau"}, échéance ${a.dueDate})`).join("\n")}`,
  ].join("\n\n");
  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 3000,
      messages: [{ role: "system", content: CODIR_AGENDA }, { role: "user", content: ctx }],
    });
    if (resp.choices?.[0]?.finish_reason === "length") return res.status(502).json({ error: "ordre du jour tronqué, réessaie" });
    const md = resp.choices?.[0]?.message?.content || "";
    if (!md.trim()) return res.status(502).json({ error: "génération vide" });
    const d = store.addDeliverable({ task: "ordre_du_jour", title: `Ordre du jour CODIR — ${new Date().toLocaleDateString("fr-FR")}`, campusId: null, campusName: null, content: md, model: PROMPTS.pnl.model });
    logAudit(req, "create", "deliverable", d.title);
    res.json({ id: d.id, title: d.title });
  } catch (e) {
    console.error("[codir-agenda]", e?.message || e);
    res.status(500).json({ error: "génération impossible" });
  }
});
app.post("/api/arbitrages", requireAuth, requireAdmin, (req, res) => {
  if (!req.body?.title || !String(req.body.title).trim()) return res.status(400).json({ error: "sujet requis" });
  const campus = req.body.campusId ? store.listCampuses().find((c) => c.id === req.body.campusId) : null;
  const a = store.addArbitrage({ ...req.body, campusName: campus?.name || "" });
  logAudit(req, "create", "arbitrage", a.title);
  res.json(a);
});
app.patch("/api/arbitrages/:id", requireAuth, requireAdmin, (req, res) => {
  const a = store.updateArbitrage(req.params.id, req.body || {});
  if (!a) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "arbitrage", a.title);
  res.json(a);
});
app.delete("/api/arbitrages/:id", requireAuth, requireAdmin, (req, res) => {
  const a = store.listArbitrages().find((x) => x.id === req.params.id);
  store.deleteArbitrage(req.params.id);
  logAudit(req, "delete", "arbitrage", a?.title || req.params.id);
  res.json({ ok: true });
});

// ===== Recherche globale (multi-objets, respecte le cloisonnement) =====
app.get("/api/search", requireAuth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  if (q.length < 2) return res.json([]);
  const hit = (s) => String(s || "").toLowerCase().includes(q);
  const out = [];
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) if (hit(c.name) || hit(c.city)) out.push({ type: "campus", label: c.name, sub: c.city || "", go: { view: "campus", campus360: c.id } });
  for (const a of scopeByCampus(req, store.listActions())) if (hit(a.title) || hit(a.owner)) out.push({ type: "action", label: a.title, sub: a.campusName || "", go: { view: "actions" } });
  for (const d of scopeByCampus(req, store.listDeliverables({}))) if (hit(d.title)) out.push({ type: "livrable", label: d.title, sub: d.campusName || "", go: { view: "historique", deliverable: d.id } });
  for (const i of scopeByCampus(req, store.listIncidents({}))) if (hit(i.title)) out.push({ type: "incident", label: i.title, sub: i.campusName || "", go: { view: "risques" } });
  if (req.user?.role === "admin") {
    for (const d of store.listDecisions()) if (hit(d.title) || hit(d.owner)) out.push({ type: "décision", label: d.title, sub: d.campusName || "", go: { view: "decisions" } });
    for (const a of store.listArbitrages()) if (hit(a.title)) out.push({ type: "arbitrage", label: a.title, sub: a.campusName || "", go: { view: "arbitrages" } });
  }
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) for (const ct of (c.contacts || [])) if (hit([ct.firstName, ct.lastName].join(" ")) || hit(ct.email)) out.push({ type: "contact", label: [ct.firstName, ct.lastName].filter(Boolean).join(" "), sub: `${c.name}${ct.role ? " · " + ct.role : ""}`, go: { view: "campus", campus360: c.id } });
  res.json(out.slice(0, 40));
});

// ===== Weekly Ops Review (support hebdo imprimable) =====
function buildWeeklyHtml(req) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const today = new Date().toISOString().slice(0, 10);
  const rows = buildNetworkRows(req);
  const rouges = rows.filter((r) => r.health != null && r.health < 50).sort((a, b) => a.health - b.health);
  // Dérives (mêmes règles que la heatmap)
  const drifts = [];
  for (const r of rows) {
    const hist = kpiHistory(r.id);
    if (decliningStreak(hist, marginPctOf) >= 2) drifts.push(`${r.name} — marge en baisse`);
    if (decliningStreak(hist, (x) => x.occupancy) >= 2) drifts.push(`${r.name} — remplissage en dégradation`);
    if (r.openIncidents >= 2) drifts.push(`${r.name} — incidents récurrents (${r.openIncidents})`);
  }
  // Actions prioritaires (top 8)
  const healthById = Object.fromEntries(rows.map((r) => [r.id, r.health]));
  const prio = scopeByCampus(req, store.listActions()).filter((a) => a.status !== "done").map((a) => {
    let s = 10;
    if (a.dueDate && a.dueDate < today) s += Math.min(45, 15 + Math.round((new Date(today) - new Date(a.dueDate)) / 864e5));
    const h = healthById[a.campusId]; if (h != null && h < 50) s += 25; else if (h != null && h < 70) s += 12;
    if (a.category === "qualiopi") s += 15; if (!a.owner) s += 8;
    return { a, s };
  }).sort((x, y) => y.s - x.s).slice(0, 8);
  const decisions = store.listDecisions().filter((d) => d.status === "open");
  const arbitrages = store.listArbitrages().filter((a) => ["toprepare", "pending"].includes(a.status));
  // Risques 30 jours : échéances Qualiopi proches
  const risks = [];
  for (const c of store.listCampuses().filter((c) => canCampus(req, c.id))) {
    const ctrl = c.qualiopi?.lastAudit ? computeControlDates(c.qualiopi.lastAudit) : null;
    if (!ctrl) continue;
    for (const [lbl, d] of [["surveillance", ctrl.surveillance], ["renouvellement", ctrl.renewal]]) {
      if (!d) continue; const m = Math.round((new Date(d) - new Date()) / (30 * 864e5));
      if (m <= 2) risks.push(`${c.name} — audit ${lbl} Qualiopi ${m < 0 ? "dépassé" : "dans " + m + " mois"}`);
    }
  }
  const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const ul = (arr, empty) => (arr.length ? `<ul>${arr.map((x) => `<li>${x}</li>`).join("")}</ul>` : `<p class="none">${empty}</p>`);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Revue hebdo des opérations — ${now}</title>
<style>
  :root{--teal:#0B6E5F;--ink:#0D1B2A;--sand:#E2DACD;--muted:#5A6672;--coral:#FF6A4D;--danger:#C94B33;--paper:#FBF9F5;}
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);margin:0;background:var(--paper);font-size:14px;line-height:1.55;}
  .toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;max-width:820px;margin:0 auto;padding:16px 0 8px;}
  .toolbar button{background:var(--teal);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:600;cursor:pointer;}
  .sheet{max-width:820px;margin:0 auto 40px;background:#fff;padding:40px 48px 56px;box-shadow:0 1px 40px rgba(13,27,42,.08);}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand b{font-size:15px;} .brand span{font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);display:block;}
  .rule{height:2px;background:linear-gradient(90deg,var(--teal) 0 64px,var(--sand) 64px);margin:16px 0 20px;}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:var(--teal);font-weight:700;margin:0 0 6px;}
  .eyebrow::before{content:"";width:22px;height:3px;background:var(--coral);border-radius:2px;}
  h1{font-family:Georgia,serif;font-size:26px;margin:0 0 4px;} .sub{color:var(--muted);font-size:13px;margin-bottom:6px;}
  h2{font-family:Georgia,serif;color:var(--teal);font-size:17px;margin:24px 0 8px;padding-bottom:5px;border-bottom:2px solid var(--sand);}
  ul{margin:6px 0;padding-left:22px;} li{margin:4px 0;} li::marker{color:var(--teal);}
  .none{color:var(--muted);font-style:italic;margin:6px 0;}
  .rouge{color:var(--danger);font-weight:700;}
  .foot{margin-top:30px;color:var(--muted);font-size:11px;border-top:1px solid var(--sand);padding-top:10px;}
  @page{margin:14mm 12mm;} @media print{body{background:#fff;}.toolbar{display:none;}.sheet{box-shadow:none;max-width:none;margin:0;padding:0;}h2{break-after:avoid;}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="sheet">
    <div class="brand"><svg width="28" height="28" viewBox="0 0 64 64"><rect x="2" y="2" width="26" height="26" rx="7" fill="#0D1B2A"/><rect x="36" y="2" width="26" height="26" rx="7" fill="#0B6E5F"/><rect x="2" y="36" width="26" height="26" rx="7" fill="#0B6E5F"/><circle cx="49" cy="49" r="13" fill="#FF6A4D"/></svg><div><b>Campus Manager</b><span>Pilotage réseau</span></div></div>
    <div class="rule"></div>
    <div class="eyebrow">Revue hebdomadaire</div>
    <h1>Revue des opérations réseau</h1>
    <div class="sub">${now} · ${rows.length} campus</div>
    <h2>Campus rouges</h2>
    ${rouges.length ? `<ul>${rouges.map((r) => `<li><span class="rouge">${esc(r.name)} (santé ${r.health})</span>${r.healthDetail ? " — " + r.healthDetail.filter((d) => d.score < 60).slice(0, 2).map((d) => esc(d.label)).join(", ") : ""}</li>`).join("")}</ul>` : `<p class="none">Aucun campus en zone rouge cette semaine. 👌</p>`}
    <h2>Signaux faibles & dérives</h2>
    ${ul(drifts.map(esc), "Aucune dérive détectée.")}
    <h2>Actions prioritaires</h2>
    ${prio.length ? `<ul>${prio.map(({ a, s }) => `<li><b>[${s}]</b> ${esc(a.title)}${a.campusName ? " — " + esc(a.campusName) : ""}${a.dueDate && a.dueDate < today ? ' <span class="rouge">(en retard)</span>' : ""}${!a.owner ? " · sans responsable" : ""}</li>`).join("")}</ul>` : `<p class="none">Aucune action ouverte.</p>`}
    <h2>Décisions & arbitrages en attente</h2>
    ${ul([...decisions.map((d) => `Décision : ${esc(d.title)}${d.campusName ? " (" + esc(d.campusName) + ")" : ""}`), ...arbitrages.map((a) => `Arbitrage à ${a.status === "pending" ? "trancher" : "préparer"} : ${esc(a.title)}`)], "Rien en attente.")}
    <h2>Risques 30 jours</h2>
    ${ul(risks.map(esc), "Aucune échéance critique sous 30 jours.")}
    <div class="foot">Campus Manager — support de revue hebdomadaire · confidentiel · généré le ${now}</div>
  </div>
</body></html>`;
}
app.get("/api/weekly-review", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildWeeklyHtml(req));
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
// Premier jet des notes de revue (IA) depuis le snapshot chiffré + la revue précédente.
app.post("/api/reviews/draft-notes", requireAuth, requireAdmin, requireIA, async (req, res) => {
  const cid = req.body?.campusId;
  if (!cid || !canCampus(req, cid)) return res.status(400).json({ error: "campus requis / hors périmètre" });
  const campus = store.listCampuses().find((c) => c.id === cid);
  const snap = campusSnapshot(req, cid);
  if (!snap) return res.status(404).json({ error: "campus introuvable" });
  const prev = store.listReviews(cid)[0] || null;   // la plus récente
  const line = (label, s) => s ? `${label} : santé ${s.health ?? "?"} · remplissage ${s.occupancy ?? "?"}% · Qualiopi ${s.qualiopi ?? "?"}% · satisfaction ${s.satisfaction ?? "?"}/10 · insertion ${s.insertionRate ?? "?"}% · CA ${s.revenue ?? "?"}€ · marge ${s.margin ?? "?"}€ · ${s.openActions ?? 0} action(s) ouverte(s) dont ${s.overdueActions ?? 0} en retard · ${s.openIncidents ?? 0} incident(s)` : `${label} : (aucune donnée)`;
  const ctx = [
    `Campus : ${campus?.name || cid} · mois de la revue : ${req.body?.month || new Date().toISOString().slice(0, 7)}`,
    line("Ce mois-ci", snap),
    prev ? line(`Revue précédente (${prev.month})`, prev.snapshot) : "Revue précédente : aucune (première revue)",
  ].join("\n");
  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 900,
      messages: [{ role: "system", content: REVIEW_NOTES }, { role: "user", content: ctx }],
    });
    res.json({ draft: resp.choices?.[0]?.message?.content || "", truncated: resp.choices?.[0]?.finish_reason === "length" });
  } catch (e) {
    console.error("[review-notes]", e?.message || e);
    res.status(500).json({ error: "génération impossible" });
  }
});
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
  if (!requireCampus(req, res, cid)) return;
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
const DEFAULT_THRESHOLDS = { occupancy: 70, qualiopiMonths: 3, admissionsWarn: 80, admissionsCrit: 60, satisfaction: 7, marginPct: 0, absenteeism: 10 };
function thresholds() { return { ...DEFAULT_THRESHOLDS, ...(store.getSettings().thresholds || {}) }; }
app.get("/api/settings", requireAuth, requireAdmin, (req, res) => {
  const s = store.getSettings();
  const sf = s.salesforce || {};
  res.json({ thresholds: { ...DEFAULT_THRESHOLDS, ...(s.thresholds || {}) }, board: s.board || { enabled: false, recipients: "" },
    smicMensuel: s.smicMensuel ?? null, smicDefaut: SMIC_MENSUEL_DEFAUT,
    iaDesactivee: s.iaDesactivee === true, iaDisponible: !!process.env.OPENAI_API_KEY,
    salesforce: { configured: !!(sf.instanceUrl && sf.clientId && sf.clientSecret), enabled: sf.enabled ?? true,
      instanceUrl: sf.instanceUrl || "", clientId: sf.clientId || "", secretMask: sf.clientSecret ? "•••" + String(sf.clientSecret).slice(-4) : "",
      object: sf.object || "Lead", where: sf.where || "", apiVersion: sf.apiVersion || "v59.0",
      baseLegale: sf.baseLegale || "", orgRegion: sf.orgRegion || "",
      fieldsText: sf.fieldsText || "", statusMapText: sf.statusMapText || "", campusMapText: sf.campusMapText || "",
      lastSync: sf.lastSync || null, lastError: sf.lastError || null } });
});
app.put("/api/settings", requireAuth, requireAdmin, (req, res) => {
  const patch = {};
  if (req.body?.thresholds) { const t = {}; for (const k of Object.keys(DEFAULT_THRESHOLDS)) if (req.body.thresholds[k] != null && req.body.thresholds[k] !== "") t[k] = Number(req.body.thresholds[k]); patch.thresholds = t; }
  if (req.body?.board) patch.board = { enabled: !!req.body.board.enabled, recipients: String(req.body.board.recipients || "").trim() };
  // Le SMIC pilote tous les contrôles de rémunération : il DOIT être modifiable
  // sans redéploiement, sinon chaque revalorisation rend l'outil faux en silence.
  if (req.body?.iaDesactivee !== undefined) {
    patch.iaDesactivee = !!req.body.iaDesactivee;
    logAudit(req, "update", "settings", `assistance IA ${patch.iaDesactivee ? "désactivée" : "réactivée"}`);
  }
  if (req.body?.smicMensuel !== undefined) {
    if (req.body.smicMensuel === "" || req.body.smicMensuel === null) patch.smicMensuel = null;
    else {
      const v = Number(req.body.smicMensuel);
      if (!Number.isFinite(v) || v <= 0 || v > 10000) return res.status(400).json({ error: "SMIC mensuel invalide" });
      patch.smicMensuel = v;
    }
  }
  if (req.body?.salesforce) {
    const prev = store.getSettings().salesforce || {};
    const b = req.body.salesforce;
    if (b.instanceUrl && !/^https:\/\//.test(String(b.instanceUrl))) return res.status(400).json({ error: "URL Salesforce invalide (https attendu)" });
    patch.salesforce = {
      ...prev,
      instanceUrl: String(b.instanceUrl ?? prev.instanceUrl ?? "").trim().replace(/\/+$/, ""),
      clientId: String(b.clientId ?? prev.clientId ?? "").trim(),
      clientSecret: b.clientSecret ? String(b.clientSecret).trim() : (prev.clientSecret || ""),
      object: String(b.object ?? prev.object ?? "Lead").trim() || "Lead",
      where: String(b.where ?? prev.where ?? "").trim(),
      apiVersion: String(b.apiVersion ?? prev.apiVersion ?? "v59.0").trim(),
      fieldsText: String(b.fieldsText ?? prev.fieldsText ?? ""),
      // Base légale de l'import : à déclarer par l'établissement, c'est lui le
      // responsable de traitement. Reportée sur chaque candidat importé.
      baseLegale: String(b.baseLegale ?? prev.baseLegale ?? "").trim(),
      orgRegion: String(b.orgRegion ?? prev.orgRegion ?? "").trim(),
      statusMapText: String(b.statusMapText ?? prev.statusMapText ?? ""),
      campusMapText: String(b.campusMapText ?? prev.campusMapText ?? ""),
      enabled: b.enabled !== undefined ? !!b.enabled : (prev.enabled ?? true),
    };
  }
  const s = store.updateSettings(patch);
  logAudit(req, "update", "settings", "seuils / board pack");
  res.json(s);
});

// ===== RGPD : registre des traitements, export & rétention =====
// Registre par défaut, livré au client. Il doit décrire la RÉALITÉ des traitements :
// un registre incomplet est celui que l'établissement présentera en contrôle.
// Rubriques alignées sur l'art. 30 : personnes concernées, destinataires,
// sous-traitants et transferts, en plus de la finalité, de la base et de la durée.
const DEFAULT_RGPD_REGISTER = [
  { data: "Dossiers apprenants (état civil, INE, coordonnées, représentant légal)", people: "Apprenants, dont mineurs", purpose: "Gestion de la scolarité et de l'alternance", basis: "Exécution du contrat de formation", retention: "Durée de la formation + prescription applicable aux titres", recipients: "Équipe pédagogique et administrative du campus", subprocessors: "Hébergeur (France)" },
  { data: "Reconnaissance de la qualité de travailleur handicapé (RQTH)", people: "Apprenants", purpose: "Accompagnement et adaptations (Qualiopi ind. 26)", basis: "Obligation légale — donnée de santé, art. 9 RGPD", retention: "Durée de la formation", recipients: "Référent handicap et direction UNIQUEMENT", subprocessors: "—" },
  { data: "Candidatures et prospects", people: "Candidats", purpose: "Recrutement et suivi des admissions", basis: "Intérêt légitime / consentement au dépôt de candidature", retention: "24 mois si non convertie", recipients: "Service admissions", subprocessors: "CRM du client si connecté (Salesforce)" },
  { data: "Inscriptions, notes, bulletins", people: "Apprenants", purpose: "Suivi pédagogique et délivrance des résultats", basis: "Exécution du contrat de formation", retention: "Durée de la formation + prescription", recipients: "Équipe pédagogique, apprenant, représentant légal si mineur", subprocessors: "—" },
  { data: "Feuilles d'émargement et signatures manuscrites", people: "Apprenants, formateurs", purpose: "Preuve de réalisation de l'action de formation", basis: "Obligation légale (contrôle financeur, Qualiopi)", retention: "Feuilles 5 ans ; images de signature 13 mois", recipients: "Administration, financeur en cas de contrôle", subprocessors: "—" },
  { data: "Contrats d'alternance (rémunération, maître d'apprentissage, rupture)", people: "Apprentis, tuteurs en entreprise", purpose: "Gestion contractuelle et financement", basis: "Obligation légale et exécution du contrat", retention: "Durée du contrat + prescription", recipients: "Administration, entreprise, opérateur de compétences", subprocessors: "—" },
  { data: "Accès aux portails (apprenant, formateur, tuteur)", people: "Apprenants, formateurs, tuteurs", purpose: "Consultation de leur propre dossier", basis: "Exécution du contrat", retention: "12 mois après révocation ou expiration", recipients: "La personne concernée uniquement", subprocessors: "—" },
  { data: "Formateurs (disponibilités, service, société de rattachement)", people: "Formateurs salariés et prestataires", purpose: "Planification des enseignements", basis: "Exécution du contrat de travail ou de prestation", retention: "Durée de la collaboration + 12 mois", recipients: "Direction et planification", subprocessors: "—" },
  { data: "Comptes utilisateurs (nom, email, moyens d'authentification)", people: "Personnel de l'établissement", purpose: "Gestion des accès et authentification", basis: "Intérêt légitime", retention: "Durée du compte + 12 mois", recipients: "Administrateurs", subprocessors: "—" },
  { data: "Données campus et indicateurs financiers", people: "—", purpose: "Pilotage opérationnel du réseau", basis: "Intérêt légitime", retention: "Durée d'exploitation", recipients: "Direction", subprocessors: "—" },
  { data: "Documents et preuves Qualiopi", people: "Apprenants, formateurs", purpose: "Conformité réglementaire (certification)", basis: "Obligation légale", retention: "3 ans après l'audit", recipients: "Certificateur en audit", subprocessors: "—" },
  { data: "Incidents, réclamations et signalements de tuteurs", people: "Apprenants, tuteurs", purpose: "Suivi qualité et sécurité", basis: "Intérêt légitime", retention: "3 ans", recipients: "Direction", subprocessors: "—" },
  { data: "Emails traités et briefs quotidiens", people: "Correspondants du dirigeant", purpose: "Assistance opérationnelle", basis: "Intérêt légitime", retention: "14 derniers briefs", recipients: "Le dirigeant", subprocessors: "Fournisseur de messagerie ; fournisseur d'IA si l'assistance IA est activée" },
  { data: "Contenus soumis à l'assistance IA", people: "Personnes citées dans les contenus", purpose: "Aide à la rédaction et à l'analyse", basis: "Intérêt légitime", retention: "Non conservé par l'éditeur", recipients: "—", subprocessors: "Fournisseur d'IA (transfert hors UE possible — à encadrer, désactivable)" },
  { data: "Décisions et arbitrages de direction", people: "Personnel", purpose: "Gouvernance et traçabilité", basis: "Intérêt légitime", retention: "5 ans", recipients: "Direction", subprocessors: "—" },
  { data: "Journal d'audit applicatif", people: "Utilisateurs de l'application", purpose: "Traçabilité et sécurité", basis: "Intérêt légitime et obligation de sécurité", retention: "12 mois", recipients: "Administrateurs", subprocessors: "—" },
];
function rgpdConfig() {
  const s = store.getSettings().rgpd || {};
  return { register: Array.isArray(s.register) && s.register.length ? s.register : DEFAULT_RGPD_REGISTER, retentionMonths: s.retentionMonths || 12 };
}

// --- Conservation : politique, application, purge ---
// Les durées sont des défauts de l'éditeur, surchargeables par l'établissement
// (c'est lui le responsable de traitement). Aucune purge sans durée définie.
app.get("/api/rgpd/retention", requireAuth, requireAdmin, (req, res) => {
  res.json({ policy: policyView(store.getSettings()), lastRun: store.getSettings().retentionLastRun || null });
});

app.put("/api/rgpd/retention", requireAuth, requireAdmin, (req, res) => {
  const patch = {};
  for (const k of RETENTION_KEYS) {
    if (!(k in (req.body || {}))) continue;
    const v = req.body[k];
    if (v === null || v === "") { patch[k] = null; continue; } // « ne jamais purger », choix explicite
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 240) return res.status(400).json({ error: `Durée invalide pour ${k} (1 à 240 mois)` });
    patch[k] = n;
  }
  const s = store.updateSettings({ retention: { ...(store.getSettings().retention || {}), ...patch } });
  logAudit(req, "update", "rgpd", "durées de conservation");
  res.json({ policy: policyView(s) });
});

// Purge effective. `dryRun` permet de voir ce qui partirait avant de le faire —
// une purge irréversible ne doit jamais être une surprise.
function runRetention({ dryRun = false } = {}) {
  const settings = store.getSettings();
  const out = {};
  const cut = (k) => cutoffDate(k, settings);

  const cSign = cut("signatures");
  out.signatures = cSign ? (dryRun ? attendancestore.countSignaturesBefore(cSign) : attendancestore.purgeSignaturesBefore(cSign)) : null;

  const cSheets = cut("attendanceSheets");
  out.attendanceSheets = cSheets ? attendancestore.purgeSheetsBefore(cSheets, { dryRun }) : null;

  const cCand = cut("candidates");
  out.candidates = cCand ? store.purgeCandidatesBefore(cCand, { dryRun }) : null;

  const cPortal = cut("portalAccessRevoked");
  out.portalAccessRevoked = cPortal ? store.purgeRevokedPortalAccessBefore(cPortal, { dryRun }) : null;

  const cAnchors = cut("anchors");
  out.anchors = cAnchors ? store.purgeAnchorsBefore(cAnchors, { dryRun }) : null;

  const cAudit = cut("audit");
  out.audit = cAudit ? (dryRun ? null : store.purgeAuditBefore(cAudit)) : null;

  if (!dryRun) store.updateSettings({ retentionLastRun: new Date().toISOString() });
  return out;
}

app.post("/api/rgpd/retention/run", requireAuth, requireAdmin, (req, res) => {
  const dryRun = req.body?.dryRun !== false;
  const r = runRetention({ dryRun });
  if (!dryRun) logAudit(req, "purge", "rgpd", `purge de conservation : ${JSON.stringify(r)}`);
  res.json({ dryRun, resultats: r });
});
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
// Art. 15 et 20 : accès et portabilité pour un apprenant. Renvoie TOUT ce que le
// système détient sur lui, dans un format lisible et réutilisable.
app.get("/api/learners/:id/export", requireAuth, requireAdmin, (req, res) => {
  const l = store.getLearner(req.params.id);
  if (!l) return res.status(404).json({ error: "apprenant introuvable" });
  if (!assertCampus(req, res, l.campusId)) return;
  const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
  const assessments = new Map(store.listAssessments({}).map((a) => [a.id, a]));
  const emargements = [];
  for (const s of attendancestore.listSheets({ campusId: l.campusId })) {
    const e = effectiveEntries(s).find((x) => x.learnerId === l.id);
    if (e) emargements.push({ date: s.date, debut: s.start, fin: s.end, statut: e.status, justifie: !!e.justified, signeLe: e.signedAt || null, corrige: !!e.amende });
  }
  const dossier = {
    exportLe: new Date().toISOString(),
    identite: { ...l },
    inscriptions: store.listEnrollments({ learnerId: l.id }).map((e) => ({ ...e, classe: classes.get(e.classId) || null })),
    contrats: store.listContracts({ learnerId: l.id }),
    notes: store.listGrades({ learnerId: l.id }).map((g) => {
      const a = assessments.get(g.assessmentId);
      return { evaluation: a?.label || null, date: a?.date || null, note: g.score, sur: a?.maxScore ?? 20, absent: !!g.absent, commentaire: g.comment || "" };
    }),
    emargements,
    candidature: store.listCandidates({}).find((c) => c.learnerId === l.id) || null,
    documents: store.listDocuments(l.campusId, null, l.id).map((d) => ({ nom: d.name, depose: d.createdAt })),
    accesPortail: store.listPortalAccess({ subjectId: l.id }).map(({ tokenHash, ...a }) => a),
  };
  logAudit(req, "export", "rgpd", `export du dossier de ${l.prenom} ${l.nom}`);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`donnees-${l.nom}-${l.prenom}.json`)}`);
  res.json(dossier);
});

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

// ===================== Module Plannings =====================
// Professeurs, référentiels, salles, classes, calendrier, séances, génération.
// Les référentiels et les professeurs sont des données RÉSEAU (admin) ; salles,
// classes, périodes et séances sont rattachées à un campus donc scopées.

const DAY_LABEL_FR = { lun: "Lundi", mar: "Mardi", mer: "Mercredi", jeu: "Jeudi", ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const DAY_OF = (iso) => ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"][new Date(`${iso}T12:00:00Z`).getUTCDay()];

// Résout une séance en objet affichable : le store ne stocke que des identifiants,
// mais aucune vue (grille, impression, email, iCal) n'est lisible sans les libellés.
function hydrate(sessions) {
  const camp = new Map(store.listCampuses().map((c) => [c.id, c]));
  const klass = new Map(store.listClasses().map((k) => [k.id, k]));
  const rooms = new Map(store.listRooms().map((r) => [r.id, r]));
  const teachers = new Map(store.listTeachers().map((t) => [t.id, t]));
  const modules = new Map();
  for (const cur of store.listCurricula()) for (const m of cur.modules || []) modules.set(m.id, m);
  return sessions.map((s) => {
    const k = klass.get(s.classId), m = modules.get(s.moduleId);
    return {
      ...s,
      className: k?.name || null, campusName: camp.get(s.campusId)?.name || null,
      moduleLabel: m ? (m.label || m.code) : null, moduleCode: m?.code || null,
      teacherName: teachers.get(s.teacherId)?.name || null,
      roomName: rooms.get(s.roomId)?.name || null,
      day: s.date ? DAY_OF(s.date) : null, dayLabel: s.date ? DAY_LABEL_FR[DAY_OF(s.date)] : null,
    };
  });
}
// Contexte de vérification d'un créneau : ce que la séance seule ne porte pas.
function conflictCtx(s) {
  const k = store.getClass(s.classId);
  const modules = new Map();
  for (const cur of store.listCurricula()) for (const m of cur.modules || []) modules.set(m.id, m);
  return {
    teacher: s.teacherId ? store.getTeacher(s.teacherId) : null,
    room: s.roomId ? store.getRoom(s.roomId) : null,
    module: s.moduleId ? modules.get(s.moduleId) : null,
    classSize: k ? store.classSize(k) : null,
    periods: store.listPeriods({ campusId: s.campusId }),
    amplitude: s.campusId ? store.campusAmplitude(s.campusId) : undefined,
  };
}
// Un directeur ne voit et ne touche que ses campus.
function scopeSessions(req, list) {
  const allowed = allowedCampusIds(req);
  return allowed === null ? list : list.filter((s) => allowed.includes(s.campusId));
}

// --- Professeurs (réseau) ---
app.get("/api/teachers", requireAuth, (req, res) => {
  const allowed = allowedCampusIds(req);
  const all = store.listTeachers();
  res.json(allowed === null ? all : all.filter((t) => (t.campusIds || []).some((c) => allowed.includes(c))));
});
app.post("/api/teachers", requireAuth, requireAdmin, (req, res) => {
  if (!String(req.body?.name || "").trim()) return res.status(400).json({ error: "nom requis" });
  const t = store.addTeacher(req.body);
  logAudit(req, "create", "teacher", t.name);
  res.json(t);
});
app.patch("/api/teachers/:id", requireAuth, requireAdmin, (req, res) => {
  const t = store.updateTeacher(req.params.id, req.body || {});
  if (!t) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "teacher", t.name);
  res.json(t);
});
app.delete("/api/teachers/:id", requireAuth, requireAdmin, (req, res) => {
  const t = store.getTeacher(req.params.id);
  store.deleteTeacher(req.params.id);
  if (t) logAudit(req, "delete", "teacher", t.name);
  res.json({ ok: true });
});
// Amorce depuis les contacts « professeur » déjà saisis sur les fiches campus :
// ils portent nom, email et téléphone et ne servaient jusqu'ici qu'aux comptes rendus.
app.post("/api/teachers/import-contacts", requireAuth, requireAdmin, (req, res) => {
  const existing = new Set(store.listTeachers().map((t) => (t.email || t.name).toLowerCase()));
  const made = [];
  for (const c of store.listCampuses()) {
    for (const k of (c.contacts || []).filter((x) => x.category === "professeur")) {
      const name = `${k.firstName || ""} ${k.lastName || ""}`.trim() || k.role || "Sans nom";
      const key = (k.email || name).toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      made.push(store.addTeacher({ name, email: k.email, phone: k.phone, campusIds: [c.id], status: "vacataire" }));
    }
  }
  if (made.length) logAudit(req, "create", "teacher", `${made.length} depuis les contacts`);
  res.json({ imported: made.length, teachers: made });
});

// --- Référentiels (réseau) ---
app.get("/api/curricula", requireAuth, (req, res) => {
  res.json(store.listCurricula().map((c) => ({
    ...c, totalHours: store.curriculumHours(c),
    weeklyByYear: { 1: store.curriculumWeekly(c, 1), 2: store.curriculumWeekly(c, 2) },
  })));
});
app.post("/api/curricula", requireAuth, requireAdmin, (req, res) => {
  if (!String(req.body?.name || "").trim()) return res.status(400).json({ error: "intitulé requis" });
  const c = store.addCurriculum(req.body);
  logAudit(req, "create", "curriculum", c.name);
  res.json(c);
});
app.patch("/api/curricula/:id", requireAuth, requireAdmin, (req, res) => {
  const c = store.updateCurriculum(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "curriculum", c.name);
  res.json(c);
});
app.delete("/api/curricula/:id", requireAuth, requireAdmin, (req, res) => {
  const c = store.getCurriculum(req.params.id);
  store.deleteCurriculum(req.params.id);
  if (c) logAudit(req, "delete", "curriculum", c.name);
  res.json({ ok: true });
});

// Import d'un référentiel depuis un fichier — PROPOSITION, jamais écriture directe.
// Même doctrine que la proposition financière : un volume horaire inventé est un
// risque réglementaire, pas une coquille.
app.post("/api/curricula/import", requireAuth, requireAdmin, uploadOne, requireIA, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "fichier manquant" });
  let text = "";
  try { text = await extractText(req.file); } catch (e) { return res.status(400).json({ error: "fichier illisible : " + e.message }); }
  if (!text.trim()) return res.status(400).json({ error: "aucun texte exploitable dans ce fichier" });
  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 3000,
      messages: [{ role: "system", content: CURRICULUM_IMPORT }, { role: "user", content: text.slice(0, 120000) }],
    });
    if (resp.choices?.[0]?.finish_reason === "length") return res.status(502).json({ error: "document trop long, découpe-le" });
    const raw = resp.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    let d; try { d = JSON.parse(m ? m[0] : raw); } catch { return res.status(502).json({ error: "réponse IA non exploitable" }); }
    // Retour aux identifiants réels. Un pseudonyme inconnu est ignoré : le modèle
    // ne doit pas pouvoir désigner un intervenant qu'on ne lui a pas soumis.
    if (Array.isArray(d?.assignments)) {
      d.assignments = d.assignments
        .map((x) => ({ ...x, teacherId: pseudo.get(x.teacherId) || null }))
        .filter((x) => x.teacherId);
    }
    const modules = (Array.isArray(d.modules) ? d.modules : [])
      .filter((x) => x && (x.label || x.code))
      .map((x) => ({
        code: String(x.code || "").trim(), label: String(x.label || "").trim(),
        // null explicite = volume absent du document. On ne comble pas.
        heures: x.heures == null || x.heures === "" ? null : Number(x.heures),
        year: x.year == null ? null : Number(x.year),
      }));
    const proposal = { name: String(d.name || "").trim(), diploma: String(d.diploma || "").trim(), level: String(d.level || "").trim(), modules, source: req.file.originalname, at: new Date().toISOString() };
    store.setCurriculumProposal(req.user.id, proposal);
    logAudit(req, "propose", "curriculum", `${proposal.name || "sans titre"} (${modules.length} modules)`);
    res.json({ proposal, missing: modules.filter((x) => x.heures == null).length });
  } catch (e) {
    console.error("[curriculum-import]", e?.message || e);
    res.status(500).json({ error: "extraction impossible" });
  }
});
app.get("/api/curricula/proposal", requireAuth, requireAdmin, (req, res) => res.json(store.getCurriculumProposal(req.user.id) || null));
app.post("/api/curricula/proposal/confirm", requireAuth, requireAdmin, (req, res) => {
  const p = req.body?.proposal || store.getCurriculumProposal(req.user.id);
  if (!p) return res.status(404).json({ error: "aucune proposition en attente" });
  const c = store.addCurriculum(p);
  store.clearCurriculumProposal(req.user.id);
  logAudit(req, "validate", "curriculum", c.name);
  res.json(c);
});
app.post("/api/curricula/proposal/discard", requireAuth, requireAdmin, (req, res) => {
  store.clearCurriculumProposal(req.user.id);
  logAudit(req, "discard", "curriculum", "proposition écartée");
  res.json({ ok: true });
});

// Horaires d'ouverture du campus — l'amplitude réelle, jour par jour.
app.get("/api/campuses/:id/hours", campusGuard, (req, res) => res.json(store.getCampusHours(req.params.id)));
app.put("/api/campuses/:id/hours", campusGuard, (req, res) => {
  const h = store.setCampusHours(req.params.id, req.body?.hours || {});
  if (h == null) return res.status(404).json({ error: "introuvable" });
  logAudit(req, "update", "campus", "horaires d'ouverture");
  res.json(h);
});

// --- Salles, classes, périodes (par campus) ---
// Le nom de la fonction de liste est donné explicitement : dériver un pluriel anglais
// depuis « Class » produit « listClasss » et un 500 silencieux au premier appel.
for (const [seg, api, listName] of [["rooms", "Room", "listRooms"], ["classes", "Class", "listClasses"], ["periods", "Period", "listPeriods"]]) {
  const List = store[listName];
  app.get(`/api/${seg}`, requireAuth, (req, res) => {
    const allowed = allowedCampusIds(req);
    let items = List({ campusId: req.query.campusId || undefined });
    if (allowed !== null) items = items.filter((x) => !x.campusId || allowed.includes(x.campusId));
    res.json(items);
  });
  app.post(`/api/${seg}`, requireAuth, (req, res) => {
    const cid = req.body?.campusId;
    if (cid && !assertCampus(req, res, cid)) return;
    if (!cid && req.user?.role !== "admin") return res.status(403).json({ error: "campus requis" });
    const made = store[`add${api}`](req.body || {});
    logAudit(req, "create", seg, made.name || made.label || made.kind || "");
    res.json(made);
  });
  app.patch(`/api/${seg}/:id`, requireAuth, (req, res) => {
    const cur = List().find((x) => x.id === req.params.id);
    if (!cur) return res.status(404).json({ error: "introuvable" });
    if (cur.campusId && !assertCampus(req, res, cur.campusId)) return;
    res.json(store[`update${api}`](req.params.id, req.body || {}));
  });
  app.delete(`/api/${seg}/:id`, requireAuth, (req, res) => {
    const cur = List().find((x) => x.id === req.params.id);
    if (cur?.campusId && !assertCampus(req, res, cur.campusId)) return;
    store[`delete${api}`](req.params.id);
    res.json({ ok: true });
  });
}

// --- Séances ---
// ===== Ancrage externe de la chaîne d'émargement (S-1) =====
// Publie l'empreinte de tête hors de la machine. C'est l'ENVOI qui a la valeur
// probante (horodatage par un tiers) ; le journal local n'en est que la trace.

async function anchorAttendanceChains({ to }) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const results = [];
  for (const c of store.listCampuses()) {
    const chain = attendancestore.verifyCampusChain(c.id);
    if (!chain.count) continue; // rien à ancrer tant qu'aucune feuille n'est close
    let sent = false;
    if (to && mailConfigured) {
      const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;">
        <p style="background:#0B6E5F;color:#fff;padding:12px 16px;border-radius:6px;margin:0 0 14px;"><b>Ancrage de la chaîne d'émargement</b><br>${esc(c.name)} — ${new Date().toLocaleString("fr-FR")}</p>
        <p><b>${chain.count}</b> feuille(s) close(s) · intégrité : <b style="color:${chain.ok ? "#0B6E5F" : "#B03A2E"}">${chain.ok ? "chaîne intègre" : "CHAÎNE ROMPUE — " + esc(chain.reason || "")}</b></p>
        <p style="margin:14px 0 4px;">Empreinte de tête :</p>
        <p style="font-family:ui-monospace,monospace;font-size:12px;word-break:break-all;background:#F4EFE6;padding:10px;border-radius:6px;">${esc(chain.lastHash || "—")}</p>
        <p style="color:#5A6779;font-size:12.5px;margin-top:16px;">Conservez cet email : son horodatage par un tiers atteste de l'état des feuilles d'émargement à cette date. Une modification postérieure d'une feuille ancienne produirait une empreinte différente de celle-ci.</p></div>`;
      try {
        await sendMail({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD, to,
          subject: `[Campus Manager] Ancrage émargement — ${c.name} — ${new Date().toISOString().slice(0, 10)}`, html });
        sent = true;
      } catch (e) { console.error("[ancrage] envoi échoué :", e?.message || e); }
    }
    store.addAnchor({ campusId: c.id, hash: chain.lastHash, count: chain.count, sentTo: sent ? to : "", ok: chain.ok });
    results.push({ campusId: c.id, campus: c.name, count: chain.count, ok: chain.ok, hash: chain.lastHash, sent });
  }
  return results;
}

app.get("/api/attendance/anchors", requireAuth, (req, res) => {
  const campusId = req.query.campusId;
  if (campusId && !assertCampus(req, res, campusId)) return;
  let items = store.listAnchors({ campusId });
  if (!campusId) items = items.filter((a) => canCampus(req, a.campusId));
  res.json(items);
});

app.post("/api/attendance/anchors", requireAuth, requireAdmin, async (req, res) => {
  const to = alertCfg.to || store.getSettings().board?.recipients || "";
  const results = await anchorAttendanceChains({ to });
  logAudit(req, "export", "emargement", `ancrage manuel (${results.length} campus)`);
  res.json({ results, sentTo: to || null, mailConfigured });
});

// ===== Portails externes (apprenant / formateur / tuteur) =====
// Authentification par jeton porteur, totalement disjointe de la session salariée :
// aucune route ci-dessous ne lit de cookie, et aucune ne peut retomber sur une
// session admin. Voir lib/portal.js pour les partis pris de sécurité.

const portalLimiter = makeRateLimiter({ max: 30, windowMs: 60000 });

function portalAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Lien d'accès requis" });
  const access = store.findPortalAccessByHash(hashToken(token));
  // Deux limites distinctes : un jeton VALIDE est limité par jeton — une classe
  // entière sort sur l'IP publique du campus, et limiter par IP la bloquait dès le
  // 30e appel. Un jeton inconnu reste limité par IP : c'est le cas d'une tentative
  // de devinette, et c'est là que la limite doit mordre.
  const cle = access ? "tok:" + access.id : "ip:" + clientIp(req);
  if (!portalLimiter.check(cle).allowed) return res.status(429).json({ error: "Trop de requêtes. Réessaie dans une minute." });
  const state = accessState(access);
  if (!state.valid) return res.status(401).json({ error: `Lien d'accès ${state.reason}` });
  // Vérification à temps constant en plus de la recherche par empreinte.
  if (!tokenMatches(token, access.tokenHash)) return res.status(401).json({ error: "Lien d'accès invalide" });
  req.portal = access;
  next();
}

// Identité et charge utile du portail, filtrées sur le seul sujet du jeton.
function portalPayload(access) {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const campusName = store.listCampuses().find((c) => c.id === access.campusId)?.name || "";

  if (access.kind === "learner") {
    const l = store.getLearner(access.subjectId);
    if (!l) return null;
    const enr = store.listEnrollments({ learnerId: l.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut)) || store.listEnrollments({ learnerId: l.id })[0];
    const classId = enr?.classId || null;
    const sessions = classId ? sessionstore.listSessions({ classId, from: today, to: in30 }).slice(0, 40) : [];
    const sheets = attendancestore.listSheets({ campusId: l.campusId, classId, from, to: today, status: "locked" });
    const absences = [];
    for (const s of sheets) {
      const e = (s.entries || []).find((x) => x.learnerId === l.id);
      if (e && (e.status === "absent" || e.status === "retard" || e.status === "excuse")) {
        absences.push({ sheetId: s.id, date: s.date, start: s.start, end: s.end, status: e.status, justified: !!e.justified, reason: e.reason || "" });
      }
    }
    let report = null;
    if (classId) {
      const modules = (() => { const k = store.getClass(classId); const cur = k?.curriculumId ? store.getCurriculum(k.curriculumId) : null; return cur?.modules || []; })();
      report = learnerReport({ learnerId: l.id, assessments: store.listAssessments({ classId }), grades: store.listGrades({}), modules });
    }
    return {
      kind: "learner", campusName,
      identity: { nom: l.nom, prenom: l.prenom, className: classId ? store.getClass(classId)?.name || null : null, schoolYear: enr?.schoolYear || null },
      sessions: hydrate(sessions),
      absences: absences.sort((a, b) => (b.date || "").localeCompare(a.date || "")),
      report,
      documents: store.listDocuments(l.campusId, null, l.id).map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt })),
    };
  }

  // Représentant légal : même dossier que l'enfant, en LECTURE. Il ne signe pas à
  // sa place — la signature d'émargement engage l'apprenti lui-même.
  if (access.kind === "guardian") {
    const l = store.getLearner(access.subjectId);
    if (!l) return null;
    const vue = portalPayload({ ...access, kind: "learner" });
    if (!vue) return null;
    return {
      ...vue, kind: "guardian", lectureSeule: true,
      identity: { ...vue.identity, pour: `${l.prenom} ${l.nom}` },
      // Les notes ne sont communiquées que si l'autorisation a été donnée.
      report: store.hasConsent(l, "communication_notes") ? vue.report : null,
      reportBloque: !store.hasConsent(l, "communication_notes"),
    };
  }

  if (access.kind === "teacher") {
    const teachers = store.listTeachers ? store.listTeachers({}) : [];
    const teacher = teachers.find((x) => x.id === access.subjectId) || null;
    const sessions = sessionstore.listSessions({ teacherId: access.subjectId, from: today, to: in30 }).slice(0, 60);
    const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
    return {
      kind: "teacher", campusName,
      identity: { nom: teacher?.lastName || teacher?.name || "", prenom: teacher?.firstName || "" },
      sessions: hydrate(sessions).map((s) => ({ ...s, className: classes.get(s.classId) || null })),
    };
  }

  // Tuteur : uniquement SES alternants (ceux dont il est maître d'apprentissage).
  const contracts = store.listContracts({ companyId: access.subjectId }).filter((c) => c.status !== "termine");
  const alternants = contracts.map((c) => {
    const l = c.learnerId ? store.getLearner(c.learnerId) : null;
    if (!l) return null;
    const enr = store.listEnrollments({ learnerId: l.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut));
    const classId = enr?.classId || null;
    const sheets = attendancestore.listSheets({ campusId: l.campusId, classId, from, to: today, status: "locked" });
    let planned = 0, absent = 0;
    for (const s of sheets) {
      const st = sheetStats(s);
      const e = (s.entries || []).find((x) => x.learnerId === l.id);
      if (!e) continue;
      planned += st.durationMinutes;
      if (e.status === "absent" || e.status === "excuse") absent += st.durationMinutes;
      else if (e.status === "retard") absent += Math.min(Number(e.minutesLate) || 0, st.durationMinutes);
    }
    return {
      learnerId: l.id, nom: l.nom, prenom: l.prenom,
      className: classId ? store.getClass(classId)?.name || null : null,
      contract: { dateDebut: c.dateDebut, dateFin: c.dateFin, status: c.status, rupture: c.rupture ? c.rupture.stage : null },
      assiduite: planned > 0 ? Math.round(((planned - absent) / planned) * 1000) / 10 : null,
      sessions: classId ? hydrate(sessionstore.listSessions({ classId, from: today, to: in30 }).slice(0, 15)) : [],
    };
  }).filter(Boolean);
  const company = store.listPartners().find((p) => p.id === access.subjectId);
  return { kind: "tutor", campusName, identity: { nom: company?.name || "Entreprise" }, alternants };
}

app.get("/api/portal/me", portalAuth, (req, res) => {
  const payload = portalPayload(req.portal);
  if (!payload) return res.status(404).json({ error: "Dossier introuvable — contacte ton campus" });
  store.touchPortalAccess(req.portal.id);
  res.json(payload);
});

// Signature d'émargement par code de séance, depuis le portail apprenant.
app.post("/api/portal/sign", portalAuth, (req, res) => {
  if (req.portal.kind !== "learner") return res.status(403).json({ error: "réservé aux apprenants" });
  const sheet = attendancestore.getSheetByCode(req.body?.code);
  if (!sheet) return res.status(404).json({ error: "Code invalide ou séance déjà close" });
  // Le jeton ne vaut que pour SON apprenant : on ignore tout learnerId envoyé.
  const r = attendancestore.signEntry(sheet.id, req.portal.subjectId, req.body?.signature);
  if (r?.error) return res.status(409).json(r);
  if (!r) return res.status(404).json({ error: "Feuille introuvable" });
  res.json({ ok: true, date: sheet.date, start: sheet.start });
});

// Justification d'absence : l'apprenant motive, l'équipe tranche (pas d'auto-validation).
app.post("/api/portal/justify", portalAuth, (req, res) => {
  // Le représentant légal justifie légitimement l'absence de son enfant mineur.
  if (!["learner", "guardian"].includes(req.portal.kind)) return res.status(403).json({ error: "réservé aux apprenants et à leur représentant légal" });
  const { sheetId, reason } = req.body || {};
  if (!String(reason || "").trim()) return res.status(400).json({ error: "Motif requis" });
  const sheet = attendancestore.getSheet(sheetId);
  if (!sheet || sheet.campusId !== req.portal.campusId) return res.status(404).json({ error: "Séance introuvable" });
  const learner = store.getLearner(req.portal.subjectId);
  // La demande devient une action pour l'équipe : rien n'est justifié automatiquement.
  store.addAction({
    campusId: sheet.campusId,
    campusName: store.listCampuses().find((c) => c.id === sheet.campusId)?.name || null,
    title: `Justificatif à valider — ${learner?.prenom || ""} ${learner?.nom || ""} (${sheet.date})`,
    objectif: String(reason).trim(), category: "suivi",
  });
  res.json({ ok: true });
});

// Signalement d'une difficulté par le tuteur : remonte en incident côté campus.
app.post("/api/portal/signal", portalAuth, (req, res) => {
  if (req.portal.kind !== "tutor") return res.status(403).json({ error: "réservé aux tuteurs" });
  const { learnerId, message } = req.body || {};
  if (!String(message || "").trim()) return res.status(400).json({ error: "Message requis" });
  // Le tuteur ne peut signaler que SES alternants.
  const mine = store.listContracts({ companyId: req.portal.subjectId }).some((c) => c.learnerId === learnerId);
  if (learnerId && !mine) return res.status(403).json({ error: "Cet apprenant n'est pas rattaché à votre entreprise" });
  const l = learnerId ? store.getLearner(learnerId) : null;
  const company = store.listPartners().find((p) => p.id === req.portal.subjectId);
  store.addIncident({
    campusId: req.portal.campusId,
    campusName: store.listCampuses().find((c) => c.id === req.portal.campusId)?.name || null,
    kind: "incident", category: "signalement tuteur", severity: "moyen",
    title: `Signalement tuteur — ${l ? l.prenom + " " + l.nom : company?.name || "entreprise"}`,
    description: String(message).trim(), date: new Date().toISOString().slice(0, 10),
  });
  res.json({ ok: true });
});

// --- Administration des accès (côté salarié) ---
app.get("/api/portal/access", requireAuth, (req, res) => {
  const { campusId, kind } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listPortalAccess({ campusId, kind });
  if (!campusId) items = items.filter((a) => canCampus(req, a.campusId));
  // Jamais le jeton, même haché.
  res.json(items.map(({ tokenHash, ...a }) => a));
});

app.post("/api/portal/access", requireAuth, (req, res) => {
  const { kind, subjectId, campusId, label, days } = req.body || {};
  if (!PORTAL_KINDS.includes(kind)) return res.status(400).json({ error: "type d'accès inconnu" });
  if (!subjectId) return res.status(400).json({ error: "sujet requis" });
  if (!requireCampus(req, res, campusId)) return;
  // Un accès en ligne ouvert à un mineur suppose l'accord du représentant légal.
  // On ne bloque pas l'établissement — il reste responsable de traitement — mais
  // on refuse de le faire en silence : l'autorisation doit être enregistrée.
  if (kind === "learner") {
    const l = store.getLearner(subjectId);
    const age = l?.dateNaissance ? ageAtDate(l.dateNaissance, new Date().toISOString().slice(0, 10)) : null;
    if (age != null && age < 18 && !store.hasConsent(l, "acces_portail") && !req.body?.forcerMineur) {
      return res.status(409).json({
        error: "Apprenant mineur : l'autorisation du représentant légal pour l'accès en ligne n'est pas enregistrée.",
        code: "consentement_mineur_manquant", age,
      });
    }
  }
  if (kind === "guardian" && !store.getLearner(subjectId)) {
    return res.status(400).json({ error: "un accès représentant légal doit désigner un apprenant" });
  }
  const token = generateToken();
  const access = store.createPortalAccess({
    kind, subjectId, campusId, label, tokenHash: hashToken(token),
    expiresAt: expiryFor(kind, days), createdBy: req.user?.name || req.user?.email || "",
  });
  logAudit(req, "create", "portail", `accès ${KIND_LABEL[kind]} — ${label || subjectId}`);
  // Le lien n'est renvoyé QU'ICI, une seule fois : il n'est stocké nulle part en clair.
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({ ...access, tokenHash: undefined, url: `${base}/portail.html#${token}`, warning: "Ce lien ne sera plus jamais affiché — transmets-le maintenant." });
});

app.delete("/api/portal/access/:id", requireAuth, (req, res) => {
  const a = store.listPortalAccess({}).find((x) => x.id === req.params.id);
  if (!a) return res.json({ ok: true });
  if (!assertCampus(req, res, a.campusId)) return;
  store.revokePortalAccess(a.id, req.body?.reason || "révoqué depuis l'administration");
  logAudit(req, "delete", "portail", `révocation accès ${a.kind}`);
  res.json({ ok: true });
});

// ===== Évaluations, notes et bulletins =====
// Le calcul des moyennes vit dans lib/grades.js (pur) : une absence n'est pas un
// zéro, chaque note est ramenée sur 20, et les matières pèsent par coefficient.

function assessmentGuard(req, res) {
  const a = store.getAssessment(req.params.id);
  if (!a) { res.status(404).json({ error: "évaluation introuvable" }); return null; }
  if (!assertCampus(req, res, a.campusId)) return null;
  return a;
}
// Matières du référentiel rattaché à une classe (source des libellés et coefficients).
function modulesOfClass(classId) {
  const k = store.getClass(classId);
  const cur = k?.curriculumId ? store.getCurriculum(k.curriculumId) : null;
  return cur?.modules || [];
}
// Blocs de compétences du titre visé par la classe.
function blocksOfClass(classId) {
  const k = store.getClass(classId);
  const cur = k?.curriculumId ? store.getCurriculum(k.curriculumId) : null;
  return cur?.blocks || [];
}
function learnersOfClassActive(classId, campusId) {
  // Les stagiaires de la formation professionnelle (apprentis dont le contrat a
  // été rompu) restent en formation : ils doivent figurer sur les feuilles
  // d'émargement et dans les bulletins, sans quoi ils sortent des radars.
  const ids = new Set(store.listEnrollments({ classId, statut: store.ENROLLMENT_ACTIFS }).map((e) => e.learnerId));
  return store.listLearners({ campusId }).filter((l) => ids.has(l.id));
}

app.get("/api/assessments", requireAuth, (req, res) => {
  const { campusId, classId, moduleId } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listAssessments({ campusId, classId, moduleId });
  if (!campusId) items = scopeByCampus(req, items);
  const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
  res.json(items.map((a) => {
    const grades = store.listGrades({ assessmentId: a.id });
    const mods = modulesOfClass(a.classId);
    return { ...a, className: classes.get(a.classId) || null,
      moduleLabel: mods.find((m) => m.id === a.moduleId)?.label || null,
      graded: grades.filter((g) => g.score != null || g.absent).length, total: grades.length };
  }));
});

app.post("/api/assessments", requireAuth, (req, res) => {
  const { campusId, classId, label } = req.body || {};
  if (!requireCampus(req, res, campusId)) return;
  if (!classId) return res.status(400).json({ error: "classe requise" });
  if (!String(label || "").trim()) return res.status(400).json({ error: "intitulé requis" });
  const a = store.addAssessment(req.body);
  // Pré-remplit la liste avec les inscrits actifs : le professeur n'a plus qu'à saisir.
  store.setGrades(a.id, learnersOfClassActive(classId, campusId).map((l) => ({ learnerId: l.id, score: null })));
  logAudit(req, "create", "evaluation", `${a.label} (${a.date || "sans date"})`);
  res.json(a);
});

app.get("/api/assessments/:id", requireAuth, (req, res) => {
  const a = assessmentGuard(req, res);
  if (!a) return;
  const names = new Map(store.listLearners({ campusId: a.campusId }).map((l) => [l.id, `${l.prenom} ${l.nom}`]));
  const grades = store.listGrades({ assessmentId: a.id }).map((g) => ({ ...g, learnerName: names.get(g.learnerId) || "—" }))
    .sort((x, y) => (x.learnerName || "").localeCompare(y.learnerName || ""));
  const values = grades.filter((g) => g.score != null && !g.absent).map((g) => (Number(g.score) / (a.maxScore || 20)) * 20);
  res.json({ ...a, grades, stats: classStats(values) });
});

app.patch("/api/assessments/:id", requireAuth, (req, res) => {
  const a = assessmentGuard(req, res);
  if (!a) return;
  const upd = store.updateAssessment(a.id, req.body || {});
  res.json(upd);
});

app.delete("/api/assessments/:id", requireAuth, (req, res) => {
  const a = assessmentGuard(req, res);
  if (!a) return;
  store.deleteAssessment(a.id);
  logAudit(req, "delete", "evaluation", a.label);
  res.json({ ok: true });
});

app.patch("/api/assessments/:id/grades", requireAuth, (req, res) => {
  const a = assessmentGuard(req, res);
  if (!a) return;
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const max = a.maxScore || 20;
  for (const e of entries) {
    if (e.score != null && e.score !== "" && (Number(e.score) < 0 || Number(e.score) > max)) {
      return res.status(400).json({ error: `Note hors barème : ${e.score} (attendu entre 0 et ${max})` });
    }
  }
  store.setGrades(a.id, entries);
  logAudit(req, "update", "notes", `${a.label} — ${entries.length} note(s)`);
  res.json({ ok: true });
});

// Bulletins de TOUTE une classe, en une seule passe.
//
// PERFORMANCE : la version naïve rechargeait l'intégralité des notes puis
// recalculait le rapport de chaque pair pour CHAQUE bulletin demandé, soit
// O(P² × G). Ici les notes de la classe sont indexées une fois, les P rapports
// sont produits ensemble, et le rang comme les moyennes de classe en découlent.
function buildClassReports(classId, campusId, { from = null, to = null } = {}) {
  const modules = modulesOfClass(classId);
  const assessments = store.listAssessments({ classId });
  const idsEval = new Set(assessments.map((a) => a.id));
  // Ne garder que les notes des évaluations de CETTE classe : inutile de traîner
  // toutes les notes de l'établissement dans chaque calcul.
  const grades = store.listGrades({}).filter((g) => idsEval.has(g.assessmentId));
  const peers = learnersOfClassActive(classId, campusId);
  const blocks = blocksOfClass(classId);
  const all = peers.map((l) => {
    const r = learnerReport({ learnerId: l.id, assessments, grades, modules, from, to });
    // Certification : statut par bloc, sans compensation entre blocs.
    const blocs = blockReport({ modules: r.modules, blocks });
    return { ...r, blocs, certification: certificationSummary(blocs) };
  });
  const { ranks, total } = ranking(all);
  const classAvg = new Map();
  for (const m of modules) {
    const vals = all.map((r) => r.modules.find((x) => x.moduleId === m.id)?.average).filter((v) => v != null);
    const st = classStats(vals);
    if (st) classAvg.set(m.id, st);
  }
  const byLearner = new Map(all.map((r) => [r.learnerId, r]));
  return { peers, all, ranks, total, classAverages: classAvg, byLearner };
}

// Bulletin d'un apprenant : moyennes par matière, générale, rang, absences.
function buildLearnerReport(learner, classId, periode = {}) {
  const ctx = buildClassReports(classId, learner.campusId, periode);
  const report = ctx.byLearner.get(learner.id)
    || learnerReport({ learnerId: learner.id, assessments: store.listAssessments({ classId }), grades: store.listGrades({}), modules: modulesOfClass(classId) });
  return { ...report, rank: ctx.ranks.get(learner.id) || null, rankTotal: ctx.total, classAverages: ctx.classAverages };
}

// Tous les bulletins d'une classe en une requête — la vue Notes en émettait une
// par apprenant, en série, dont la plupart étaient ensuite jetées.
app.get("/api/classes/:id/reports", requireAuth, (req, res) => {
  const k = store.getClass(req.params.id);
  if (!k) return res.status(404).json({ error: "classe introuvable" });
  if (!assertCampus(req, res, k.campusId)) return;
  const { from, to } = req.query;
  const ctx = buildClassReports(k.id, k.campusId, { from, to });
  const noms = new Map(ctx.peers.map((l) => [l.id, { nom: l.nom, prenom: l.prenom }]));
  res.json({
    className: k.name, periode: { from: from || null, to: to || null },
    reports: ctx.all.map((r) => ({
      ...r, ...noms.get(r.learnerId),
      rank: ctx.ranks.get(r.learnerId) || null, rankTotal: ctx.total,
    })).sort((a, b) => (b.average ?? -1) - (a.average ?? -1)),
  });
});

app.get("/api/learners/:id/report", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const enr = store.listEnrollments({ learnerId: l.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut)) || store.listEnrollments({ learnerId: l.id })[0];
  if (!enr?.classId) return res.status(400).json({ error: "apprenant sans classe — créer l'inscription d'abord" });
  const r = buildLearnerReport(l, enr.classId, { from: req.query.from, to: req.query.to });
  res.json({ ...r, classAverages: Object.fromEntries(r.classAverages), className: store.getClass(enr.classId)?.name || null });
});

// Bulletin imprimable (PDF via le navigateur), à la charte documentaire.
app.get("/api/learners/:id/bulletin", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const enr = store.listEnrollments({ learnerId: l.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut)) || store.listEnrollments({ learnerId: l.id })[0];
  if (!enr?.classId) return res.status(400).json({ error: "apprenant sans classe" });
  const { from, to } = req.query;
  const r = buildLearnerReport(l, enr.classId, { from, to });
  const campus = store.listCampuses().find((c) => c.id === l.campusId);
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const fmt = (v) => (v == null ? "—" : v.toFixed(2).replace(".", ","));
  const rows = r.modules.map((m) => {
    const cs = r.classAverages.get(m.moduleId);
    return `<tr><td>${esc(m.code ? m.code + " — " : "")}${esc(m.label)}</td><td style="text-align:center;">${m.coefficient}</td>
      <td style="text-align:center;font-weight:700;">${fmt(m.average)}</td>
      <td style="text-align:center;color:#4A5568;">${cs ? fmt(cs.average) : "—"}</td>
      <td style="text-align:center;color:#4A5568;">${cs ? fmt(cs.min) + " / " + fmt(cs.max) : "—"}</td>
      <td style="text-align:center;">${m.count}${m.absences ? ` <span style="color:#B03A2E;">(${m.absences} abs.)</span>` : ""}</td></tr>`;
  }).join("");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bulletin — ${esc(l.prenom)} ${esc(l.nom)}</title>
<style>body{font:13px/1.55 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;max-width:900px;margin:0 auto;padding:28px;}
h1{font-family:Georgia,serif;font-size:22px;margin:0 0 4px;}
.band{background:#0B6E5F;color:#fff;padding:14px 18px;border-radius:6px;margin-bottom:18px;}
.band .eyebrow{color:#FFD9CF;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:12.5px;}
th{background:#0B6E5F;color:#fff;text-align:left;padding:7px 9px;}
td{padding:6px 9px;border-bottom:1px solid #e3ded3;}tr:nth-child(even) td{background:#faf8f3;}
.kpi{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0;}
.kpi div{background:#f4efe6;padding:10px 16px;border-radius:6px;}.kpi b{display:block;font-size:20px;}
.foot{margin-top:24px;padding-top:10px;border-top:1px solid #e3ded3;font-size:11px;color:#4A5568;}
@media print{body{padding:0;}}</style></head><body>
<div class="band"><div class="eyebrow">${esc(campus?.name || "Campus Manager")} · Bulletin scolaire</div><h1>${esc(l.prenom)} ${esc(l.nom.toUpperCase())}</h1></div>
<p><b>${esc(r.className || "")}</b>${enr.schoolYear ? " — année " + esc(enr.schoolYear) : ""}${from || to ? ` · période du ${esc(from || "début")} au ${esc(to || "ce jour")}` : ""} · édité le ${new Date().toLocaleDateString("fr-FR")}</p>
<div class="kpi">
  <div><b>${fmt(r.average)}</b>moyenne générale</div>
  <div><b>${r.mention || "—"}</b>appréciation</div>
  <div><b>${r.rank ? r.rank + "ᵉ" : "—"}</b>rang${r.rankTotal ? " sur " + r.rankTotal : ""}</div>
</div>
<table><thead><tr><th>Matière</th><th style="text-align:center;">Coef.</th><th style="text-align:center;">Moyenne</th><th style="text-align:center;">Classe</th><th style="text-align:center;">Min / Max</th><th style="text-align:center;">Évals</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">Aucune évaluation saisie pour cette classe.</td></tr>'}</tbody></table>
${r.blocs?.length ? `<h2 style="font-family:Georgia,serif;font-size:16px;margin:22px 0 6px;">Validation par blocs de compétences</h2>
<p style="font-size:12px;color:#4A5568;margin:0 0 8px;">Un titre professionnel se valide bloc par bloc, <b>sans compensation entre blocs</b> : une moyenne générale élevée ne remplace pas un bloc non acquis. Chaque bloc acquis est capitalisable et conservé.</p>
<table><thead><tr><th>Bloc</th><th style="text-align:center;">Moyenne</th><th style="text-align:center;">Seuil</th><th style="text-align:center;">Statut</th></tr></thead><tbody>
${r.blocs.map((b) => `<tr><td>${esc(b.code ? b.code + " — " : "")}${esc(b.label)}<div style="font-size:11px;color:#4A5568;">${b.evaluees}/${b.total} matière(s) évaluée(s)</div></td>
  <td style="text-align:center;font-weight:700;">${fmt(b.moyenne)}</td><td style="text-align:center;color:#4A5568;">${b.seuil}</td>
  <td style="text-align:center;font-weight:700;color:${b.status === "acquis" ? "#0B6E5F" : b.status === "non_acquis" ? "#B03A2E" : "#4A5568"};">${b.status === "acquis" ? "Acquis" : b.status === "non_acquis" ? "Non acquis" : "En cours"}${b.elimine ? " (note éliminatoire)" : ""}</td></tr>`).join("")}
</tbody></table>
<p style="font-size:12.5px;">${r.certification.titreComplet ? "<b style=\"color:#0B6E5F;\">Tous les blocs sont acquis.</b>" : `<b>${r.certification.acquis}/${r.certification.total} bloc(s) acquis.</b> Reste à valider : ${esc(r.certification.resteAValider.join(", ")) || "—"}`}</p>` : ""}
<div class="foot">Les moyennes sont pondérées par les coefficients du référentiel ; les notes sont ramenées sur 20. Une absence non convertie en note n'entre pas dans le calcul (elle est signalée séparément). Document édité par Campus Manager.</div>
</body></html>`);
});

// ===== Licence de l'instance =====
// Lisible par tout utilisateur connecté : un directeur qui bute sur un plafond
// doit pouvoir constater lui-même où il en est, sans passer par le support.
app.get("/api/licence", requireAuth, (req, res) => {
  const eff = licenceEffective();
  const etat = licenceState(eff);
  res.json({
    ...etat,
    client: eff.client || null,
    statutStripe: eff.statutStripe, statutLibelle: eff.statutLibelle,
    resiliationProgrammee: eff.resiliationProgrammee, majLe: eff.majLe,
    quotas: quotaReport({ plan: etat.plan, usage: licenceUsage() }),
    modulesDetail: etat.modules.map((m) => ({ id: m, label: MODULES[m] || m })),
    plans: Object.fromEntries(Object.entries(PLANS).map(([id, p]) => [id, { label: p.label, cible: p.cible }])),
  });
});

// ===== Déclarations annuelles (SIFA, BPF) =====
// Ces modules PRÉPARENT la déclaration et signalent nommément ce qui bloque ; ils
// ne se substituent pas au dépôt sur le portail officiel. Formats et
// nomenclatures à revérifier à chaque campagne.

app.get("/api/declarations/sifa", requireAuth, requireAdmin, (req, res) => {
  const campusId = req.query.campusId;
  if (!requireCampus(req, res, campusId)) return;
  const annee = Number(req.query.annee) || new Date().getFullYear();
  const d = buildSifa({
    annee,
    learners: store.listLearners({ campusId }),
    enrollments: store.listEnrollments({ campusId }),
    contracts: store.listContracts({ campusId }),
    classes: store.listClasses({ campusId }),
    curricula: store.listCurricula(),
    companies: store.listPartners(campusId),
  });
  if (req.query.format === "csv") {
    if (!d.deposable && req.query.force !== "1") {
      return res.status(409).json({ error: `${d.anomalies.length} ligne(s) incomplète(s) — corriger avant de déposer`, anomalies: d.anomalies.slice(0, 50) });
    }
    logAudit(req, "export", "sifa", `export SIFA ${annee} — ${d.total} apprenti(s)`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sifa-${annee}.csv"`);
    return res.send(toCsv(SIFA_COLUMNS, d.lignes));
  }
  res.json({ ...d, colonnes: SIFA_COLUMNS, lignes: undefined, apercu: d.lignes.slice(0, 10) });
});

app.get("/api/declarations/bpf", requireAuth, requireAdmin, (req, res) => {
  const campusId = req.query.campusId;
  if (!requireCampus(req, res, campusId)) return;
  // L'exercice comptable, pas l'année scolaire : c'est une confusion fréquente.
  const exerciceDebut = req.query.from || `${new Date().getFullYear() - 1}-01-01`;
  const exerciceFin = req.query.to || `${new Date().getFullYear() - 1}-12-31`;
  const campus = store.listCampuses().find((c) => c.id === campusId);
  // Heures-stagiaires : durée de chaque séance × nombre de présents effectifs.
  const sheets = attendancestore.listSheets({ campusId, from: exerciceDebut, to: exerciceFin, status: "locked" }).map((s) => {
    const st = sheetStats(s);
    return { date: s.date, durationMinutes: st.durationMinutes, presents: st.present + st.retard };
  });
  const stagiaires = new Set(
    store.listEnrollments({ campusId }).filter((e) => !e.dateSortie || e.dateSortie >= exerciceDebut).map((e) => e.learnerId),
  ).size;
  const d = buildBpf({ exerciceDebut, exerciceFin, campus, stagiaires,
    invoices: store.listInvoices({ campusId }), fundings: store.listFundings({ campusId }), sheets });

  if (req.query.format !== "html") return res.json({ ...d, financeurs: BPF_FINANCEURS });

  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const eur = (v) => Number(v || 0).toLocaleString("fr-FR") + " €";
  logAudit(req, "export", "bpf", `BPF ${exerciceDebut} → ${exerciceFin}`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bilan pédagogique et financier</title>
<style>body{font:13px/1.55 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;max-width:880px;margin:0 auto;padding:28px;}
h1{font-family:Georgia,serif;font-size:21px;margin:0 0 4px;}h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:#0B6E5F;margin:22px 0 6px;}
.band{background:#0B6E5F;color:#fff;padding:13px 17px;border-radius:6px;margin-bottom:16px;}
.band .eyebrow{color:#FFD9CF;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px;}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0;}
th{background:#0B6E5F;color:#fff;text-align:left;padding:6px 9px;}td{padding:6px 9px;border-bottom:1px solid #e3ded3;}
td.num{text-align:right;font-variant-numeric:tabular-nums;}tr.total td{font-weight:700;background:#f4efe6;}
.alerte{background:#F7E4E0;border-left:4px solid #B03A2E;padding:10px 14px;border-radius:5px;margin:12px 0;font-size:12.5px;}
.foot{margin-top:22px;padding-top:10px;border-top:1px solid #e3ded3;font-size:11px;color:#4A5568;}
@media print{body{padding:0;}}</style></head><body>
<div class="band"><div class="eyebrow">Bilan pédagogique et financier — Cerfa 10443</div>
<h1>${esc(d.organisme.nom)}</h1></div>
${d.manquantes.length ? `<div class="alerte"><b>À compléter avant dépôt :</b><ul style="margin:6px 0 0;padding-left:18px;">${d.manquantes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
<h2>Cadre A — Identification</h2>
<table><tbody>
<tr><td>Raison sociale</td><td>${esc(d.organisme.nom)}</td></tr>
<tr><td>SIRET</td><td>${esc(d.organisme.siret) || "—"}</td></tr>
<tr><td>Numéro de déclaration d'activité</td><td>${esc(d.organisme.numeroDeclaration) || "—"}</td></tr>
<tr><td>Représentant légal</td><td>${esc(d.organisme.dirigeant) || "—"}</td></tr>
<tr><td>Exercice comptable</td><td>du ${esc(d.exerciceDebut)} au ${esc(d.exerciceFin)}</td></tr>
</tbody></table>
<h2>Cadre B — Bilan pédagogique</h2>
<table><tbody>
<tr><td>Nombre de stagiaires</td><td class="num">${d.cadreB.stagiaires}</td></tr>
<tr><td>Heures-stagiaires réalisées</td><td class="num">${d.cadreB.heuresStagiaires.toLocaleString("fr-FR")}</td></tr>
</tbody></table>
<h2>Cadre C — Bilan financier (produits hors taxes)</h2>
<table><thead><tr><th>Origine des produits</th><th style="text-align:right;">Montant HT</th></tr></thead><tbody>
${Object.entries(BPF_FINANCEURS).map(([k, lbl]) => `<tr><td>${esc(lbl)}</td><td class="num">${eur(d.cadreC.produits[k])}</td></tr>`).join("")}
<tr class="total"><td>Total des produits</td><td class="num">${eur(d.cadreC.total)}</td></tr>
</tbody></table>
<div class="foot"><b>Nature de ce document.</b> Préparation du bilan pédagogique et financier destinée à la télédéclaration sur le portail de l'administration — elle ne s'y substitue pas. Le BPF est à déposer avant le 30 avril auprès de la DREETS.
<br>Les heures-stagiaires sont calculées sur les feuilles d'émargement closes de l'exercice (durée de séance × présents), jamais déclarées à la main. Les montants sont hors taxes, arrondis à l'euro.
<br>Édité le ${new Date().toLocaleDateString("fr-FR")}. Rubriques à revérifier contre la notice Cerfa en vigueur.</div>
</body></html>`);
});

// ===== Financements et facturation =====
// Voir lib/billing.js pour la règle centrale : le NPEC de l'alternance se verse
// au prorata des JOURS DE CONTRAT exécutés, pas à l'assiduité ; le conventionné
// se facture aux HEURES RÉALISÉES. Confondre les deux produit des factures fausses.

function fundingGuard(req, res) {
  const f = store.getFunding(req.params.id);
  if (!f) { res.status(404).json({ error: "dossier de financement introuvable" }); return null; }
  if (!assertCampus(req, res, f.campusId)) return null;
  return f;
}

// Minutes réellement réalisées par un apprenant sur une période — la base du
// mode « heures », tirée des feuilles CLOSES uniquement.
function minutesRealisees(learnerId, campusId, classId, from, to) {
  let prevu = 0, absent = 0;
  for (const s of attendancestore.listSheets({ campusId, classId, from, to, status: "locked" })) {
    const st = sheetStats(s);
    const e = effectiveEntries(s).find((x) => x.learnerId === learnerId);
    if (!e) continue;
    prevu += st.durationMinutes;
    if (e.status === "absent" || e.status === "excuse") absent += st.durationMinutes;
    else if (e.status === "retard") absent += Math.min(Number(e.minutesLate) || 0, st.durationMinutes);
  }
  return Math.max(0, prevu - absent);
}

function hydrateFunding(f) {
  const factures = store.listInvoices({ fundingId: f.id });
  const reglements = factures.flatMap((i) => store.listPayments({ invoiceId: i.id }));
  const p = f.mode === "npec" && f.montant
    ? prorataTemporis({ montant: f.montant, dateDebut: f.dateDebut, dateFin: f.dateFin, arret: f.arret })
    : null;
  const learner = f.learnerId ? store.getLearner(f.learnerId) : null;
  return {
    ...f,
    learnerName: learner ? `${learner.prenom} ${learner.nom}` : null,
    modeLabel: FUNDING_MODES[f.mode]?.label || f.mode,
    prorata: p,
    solde: balance({ montantDu: p ? p.montantDu : (f.montant || 0), factures, reglements }),
    factures: factures.length,
  };
}

app.get("/api/fundings", requireAuth, (req, res) => {
  const { campusId, learnerId, contractId } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listFundings({ campusId, learnerId, contractId });
  if (!campusId) items = scopeByCampus(req, items);
  res.json(items.map(hydrateFunding));
});

app.get("/api/fundings/modes", requireAuth, (req, res) => res.json(FUNDING_MODES));

app.post("/api/fundings", requireAuth, (req, res) => {
  const { campusId, montant, dateDebut, dateFin, mode } = req.body || {};
  if (!requireCampus(req, res, campusId)) return;
  if (!dateDebut || !dateFin) return res.status(400).json({ error: "dates de début et de fin requises" });
  if (mode !== "heures" && !(Number(montant) > 0)) return res.status(400).json({ error: "montant de prise en charge requis" });
  const f = store.addFunding(req.body);
  // L'échéancier se déduit du montant et de la durée : le saisir à la main
  // produirait des écarts d'arrondi et des périodes qui ne se recollent pas.
  const echeances = buildSchedule({ montant: f.montant, dateDebut: f.dateDebut, dateFin: f.dateFin, cadence: f.cadence, mode: f.mode });
  const maj = store.updateFunding(f.id, { echeances });
  logAudit(req, "create", "financement", `${maj.financeur || "financeur"} — ${maj.montant ?? "?"} €`);
  res.json(hydrateFunding(maj));
});

app.get("/api/fundings/:id", requireAuth, (req, res) => {
  const f = fundingGuard(req, res);
  if (!f) return;
  res.json({ ...hydrateFunding(f), invoices: store.listInvoices({ fundingId: f.id }) });
});

app.patch("/api/fundings/:id", requireAuth, (req, res) => {
  const f = fundingGuard(req, res);
  if (!f) return;
  let upd = store.updateFunding(f.id, req.body || {});
  // Un changement de montant, de dates ou de cadence invalide l'échéancier :
  // le recalculer évite qu'il décrive une réalité périmée.
  if (["montant", "dateDebut", "dateFin", "cadence", "mode"].some((k) => k in (req.body || {}))) {
    upd = store.updateFunding(f.id, { echeances: buildSchedule({ montant: upd.montant, dateDebut: upd.dateDebut, dateFin: upd.dateFin, cadence: upd.cadence, mode: upd.mode }) });
  }
  logAudit(req, "update", "financement", upd.financeur || upd.id);
  res.json(hydrateFunding(upd));
});

app.delete("/api/fundings/:id", requireAuth, requireAdmin, (req, res) => {
  const f = fundingGuard(req, res);
  if (!f) return;
  const r = store.deleteFunding(f.id);
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "delete", "financement", f.id);
  res.json({ ok: true });
});

// Prépare une facture pour une échéance : les montants sont CALCULÉS, jamais saisis.
app.post("/api/fundings/:id/invoices", requireAuth, (req, res) => {
  const f = fundingGuard(req, res);
  if (!f) return;
  const { periodeDebut, periodeFin, destinataire } = req.body || {};
  const echeance = (f.echeances || []).find((e) => e.debut === periodeDebut)
    || { debut: periodeDebut, fin: periodeFin, montant: f.montant, mode: f.mode };
  if (!echeance.debut || !echeance.fin) return res.status(400).json({ error: "période à facturer requise" });
  // Facturer deux fois la même période est l'erreur la plus coûteuse : on la bloque.
  const doublon = store.listInvoices({ fundingId: f.id }).find((i) => i.periodeDebut === echeance.debut && i.status !== "annulee");
  if (doublon) return res.status(409).json({ error: `période déjà facturée (${doublon.numero || "brouillon"})` });

  const learner = f.learnerId ? store.getLearner(f.learnerId) : null;
  const enr = learner ? store.listEnrollments({ learnerId: learner.id })[0] : null;
  const minutes = f.mode === "heures"
    ? minutesRealisees(f.learnerId, f.campusId, enr?.classId, echeance.debut, echeance.fin)
    : 0;
  const du = amountDue({ mode: f.mode, echeance, prixHoraire: f.prixHoraire, minutesRealisees: minutes, arret: f.arret });
  const campus = store.listCampuses().find((c) => c.id === f.campusId);
  const totaux = computeTotals([{ montant: du.montant }], { exonereTva: campus?.tvaExoneree !== false });
  const inv = store.addInvoice({
    campusId: f.campusId, fundingId: f.id, learnerId: f.learnerId,
    periodeDebut: echeance.debut, periodeFin: echeance.fin,
    destinataire: destinataire || f.financeur,
    lignes: [{
      libelle: `${FUNDING_MODES[f.mode]?.label || f.mode} — ${learner ? learner.prenom + " " + learner.nom : "dossier"} — du ${echeance.debut} au ${echeance.fin}`,
      detail: du.base + (du.heures != null ? ` (${du.heures} h)` : du.jours != null ? ` (${du.jours}/${du.joursPeriode} jours)` : ""),
      montant: du.montant,
    }],
    ...totaux, mentionExoneration: totaux.mentionExoneration || "",
  });
  logAudit(req, "create", "facture", `brouillon ${echeance.debut} — ${du.montant} €`);
  res.json({ ...inv, calcul: du });
});

app.get("/api/invoices", requireAuth, (req, res) => {
  const { campusId, learnerId, status } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listInvoices({ campusId, learnerId, status });
  if (!campusId) items = scopeByCampus(req, items);
  const noms = new Map(store.listLearners({}).map((l) => [l.id, `${l.prenom} ${l.nom}`]));
  res.json(items.map((i) => ({ ...i, learnerName: noms.get(i.learnerId) || null,
    regle: store.listPayments({ invoiceId: i.id }).reduce((s, p) => s + p.montant, 0) })));
});

app.post("/api/invoices/:id/issue", requireAuth, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: "facture introuvable" });
  if (!assertCampus(req, res, inv.campusId)) return;
  const r = store.issueInvoice(inv.id, req.user?.name || req.user?.email || "");
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "update", "facture", `émission ${r.numero} — ${r.totalTTC} €`);
  res.json(r);
});

app.post("/api/invoices/:id/credit", requireAuth, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: "facture introuvable" });
  if (!assertCampus(req, res, inv.campusId)) return;
  const r = store.creditInvoice(inv.id, { motif: req.body?.motif, by: req.user?.name || req.user?.email || "" });
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "create", "avoir", `avoir sur ${inv.numero} — ${req.body?.motif || ""}`);
  res.json(r);
});

app.post("/api/invoices/:id/payments", requireAuth, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: "facture introuvable" });
  if (!assertCampus(req, res, inv.campusId)) return;
  if (!(Number(req.body?.montant) > 0)) return res.status(400).json({ error: "montant du règlement requis" });
  const r = store.addPayment({ ...req.body, invoiceId: inv.id });
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "create", "reglement", `${r.montant} € sur ${inv.numero}`);
  res.json(r);
});

// Comparateur de bascule : confronte nos montants à ceux du système sortant.
// C'est lui qui autorise l'abandon de l'ancien ERP, et il resservira pour chaque
// client migré — ce n'est pas un script interne, c'est un écran du produit.
app.post("/api/billing/compare", requireAuth, requireAdmin, (req, res) => {
  const { campusId, from, to, reference } = req.body || {};
  if (!requireCampus(req, res, campusId)) return;
  if (!Array.isArray(reference)) return res.status(400).json({ error: "montants de référence attendus (périodes du système sortant)" });
  const nôtres = new Map();
  for (const i of store.listInvoices({ campusId })) {
    if (i.status === "annulee" || !i.periodeDebut) continue;
    if (from && i.periodeDebut < from) continue;
    if (to && i.periodeDebut > to) continue;
    const periode = i.periodeDebut.slice(0, 7);
    nôtres.set(periode, (nôtres.get(periode) || 0) + (Number(i.totalTTC) || 0));
  }
  const r = compareWithLegacy(
    [...nôtres.entries()].map(([periode, montant]) => ({ periode, montant })),
    reference.map((x) => ({ periode: String(x.periode || "").slice(0, 7), montant: Number(x.montant) || 0 })),
  );
  logAudit(req, "export", "facturation", `comparaison de bascule : ${r.ecarts} écart(s) sur ${r.total} période(s)`);
  res.json(r);
});

// ===== Contrats d'alternance =====
// Les contrôles réglementaires sont calculés à la volée et renvoyés avec le contrat :
// l'utilisateur voit ce qui bloque le dépôt AVANT d'éditer quoi que ce soit.

function contractGuard(req, res) {
  const c = store.getContract(req.params.id);
  if (!c) { res.status(404).json({ error: "contrat introuvable" }); return null; }
  if (!assertCampus(req, res, c.campusId)) return null;
  return c;
}
function contractContext(c, index) {
  const learner = c.learnerId ? (index?.learners?.get(c.learnerId) ?? store.getLearner(c.learnerId)) : null;
  const company = c.companyId ? (index?.companies?.get(c.companyId) ?? store.listPartners().find((p) => p.id === c.companyId)) : null;
  return { learner, company, smic: index?.smic ?? (Number(store.getSettings().smicMensuel) || SMIC_MENSUEL_DEFAUT) };
}
// Index partagé pour hydrater une LISTE de contrats sans refaire les mêmes
// recherches à chaque ligne : getLearner balaie tous les apprenants et
// listPartners reconstruit et trie tout le tableau à chaque appel.
function contractIndex() {
  return {
    learners: new Map(store.listLearners({}).map((l) => [l.id, l])),
    companies: new Map(store.listPartners().map((p) => [p.id, p])),
    smic: Number(store.getSettings().smicMensuel) || SMIC_MENSUEL_DEFAUT,
  };
}
function hydrateContract(c, index) {
  const ctx = contractContext(c, index);
  return {
    ...c,
    learnerName: ctx.learner ? `${ctx.learner.prenom} ${ctx.learner.nom}` : null,
    companyName: ctx.company?.name || null,
    validation: validateContract(c, ctx),
    alerts: contractAlerts(c),
  };
}

app.get("/api/contracts", requireAuth, (req, res) => {
  const { campusId, learnerId, companyId, status, enRupture } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let items = store.listContracts({ campusId, learnerId, companyId, status, enRupture: enRupture === "1" });
  if (!campusId) items = scopeByCampus(req, items);
  const index = contractIndex();
  res.json(items.map((c) => hydrateContract(c, index)));
});

app.post("/api/contracts", requireAuth, (req, res) => {
  const { campusId, learnerId, companyId } = req.body || {};
  if (!requireCampus(req, res, campusId)) return;
  if (!learnerId) return res.status(400).json({ error: "apprenant requis" });
  if (!companyId) return res.status(400).json({ error: "entreprise requise" });
  const c = store.addContract(req.body);
  logAudit(req, "create", "contrat", `${c.type} — apprenant ${learnerId}`);
  res.json(hydrateContract(c));
});

// ⚠️ ORDRE — cette route statique doit précéder /api/contracts/:id, sinon Express
// la capture avec id="rupture-modes" et renvoie « contrat introuvable ».
app.get("/api/contracts/rupture-modes", requireAuth, (req, res) => res.json(RUPTURE_MODES));

app.get("/api/contracts/:id", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  res.json(hydrateContract(c));
});

app.patch("/api/contracts/:id", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  // Le passage à « déposé » exige que les contrôles bloquants soient levés.
  if (req.body?.status === "depose") {
    const v = validateContract({ ...c, ...req.body }, contractContext(c));
    if (!v.ok) return res.status(409).json({ error: "contrat non conforme — dépôt impossible", errors: v.errors });
  }
  const upd = store.updateContract(c.id, req.body || {});
  if (upd?.error) return res.status(409).json(upd);
  logAudit(req, "update", "contrat", `${upd.type} (${upd.status})`);
  res.json(hydrateContract(upd));
});

app.delete("/api/contracts/:id", requireAuth, requireAdmin, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  store.deleteContract(c.id);
  logAudit(req, "delete", "contrat", c.id);
  res.json({ ok: true });
});

// ===== Dossier Cerfa =====
// PÉRIMÈTRE ASSUMÉ, et à dire tel quel au client : ceci produit un DOSSIER DE
// DÉPÔT complet et contrôlé — toutes les rubriques du Cerfa, renseignées et
// vérifiées — destiné à la saisie sur le portail de l'opérateur ou au dépôt
// dématérialisé. Ce n'est PAS le formulaire officiel timbré, qui appartient à
// l'administration : prétendre le contraire exposerait à un rejet de forme.
//
// Le NIR n'est jamais stocké (art. 30 loi Informatique et Libertés) : il est
// fourni à la génération, apparaît sur le dossier, et disparaît avec la réponse.

function cerfaContext(c) {
  const learner = c.learnerId ? store.getLearner(c.learnerId) : null;
  const company = c.companyId ? store.listPartners().find((p) => p.id === c.companyId) : null;
  const campus = store.listCampuses().find((x) => x.id === c.campusId) || null;
  const enr = learner ? store.listEnrollments({ learnerId: learner.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut)) : null;
  const classe = enr?.classId ? store.getClass(enr.classId) : null;
  const curriculum = classe?.curriculumId ? store.getCurriculum(classe.curriculumId) : null;
  return { contract: c, learner, company, campus, curriculum,
    smic: Number(store.getSettings().smicMensuel) || SMIC_MENSUEL_DEFAUT };
}

// Complétude du dossier : ce qui manque, avant d'éditer quoi que ce soit.
app.get("/api/contracts/:id/cerfa", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  const d = buildCerfa(cerfaContext(c));
  res.json({ completeness: d.completeness, ready: d.ready, missing: d.missing, mineur: d.mineur,
    sections: d.sections.map((s) => ({ key: s.key, title: s.title, fields: s.fields })), periods: d.periods });
});

// Nomenclatures officielles, pour les listes déroulantes de saisie.
app.get("/api/cerfa/nomenclatures", requireAuth, (req, res) => {
  res.json({ typeEmployeur: TYPE_EMPLOYEUR, employeurSpecifique: EMPLOYEUR_SPECIFIQUE,
    nationalite: NATIONALITE, regimeSocial: REGIME_SOCIAL,
    situationAvant: SITUATION_AVANT_CONTRAT, derogation: DEROGATION, typeContrat: TYPE_CONTRAT });
});

// Dossier imprimable. Le NIR passe en paramètre et n'est jamais persisté.
app.get("/api/contracts/:id/cerfa/print", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  const ctx = cerfaContext(c);
  const d = buildCerfa(ctx);
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[x]));
  const nir = String(req.query.nir || "").trim();
  const eur = (v) => (v == null ? "—" : Number(v).toFixed(2).replace(".", ",") + " €");
  const section = (s) => `<h2>${esc(s.title)}${s.conditional ? ` <span class="cond">(${esc(s.conditional)})</span>` : ""}</h2>
    <table><tbody>${s.fields.map((f) => {
      const valeur = f.label.startsWith("NIR") && nir ? nir : f.value;
      return `<tr><td class="lab">${esc(f.label)}${f.required ? "" : ' <span class="opt">facultatif</span>'}</td>
        <td class="${valeur ? "" : f.required ? "manque" : "vide"}">${valeur ? esc(valeur) : (f.required ? "À COMPLÉTER" : "—")}
        ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}</td></tr>`;
    }).join("")}</tbody></table>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier de dépôt — contrat d'alternance</title>
<style>body{font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;max-width:940px;margin:0 auto;padding:26px;}
h1{font-family:Georgia,serif;font-size:21px;margin:0 0 4px;}h2{font-size:14px;color:#0B6E5F;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 6px;}
.band{background:#0B6E5F;color:#fff;padding:13px 17px;border-radius:6px;margin-bottom:14px;}
.band .eyebrow{color:#FFD9CF;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px;}
table{border-collapse:collapse;width:100%;font-size:12.5px;}
td{padding:5px 9px;border-bottom:1px solid #e3ded3;vertical-align:top;}
.lab{width:38%;color:#4A5568;}.manque{color:#B03A2E;font-weight:700;}.vide{color:#98A2B3;}
.opt{color:#98A2B3;font-weight:400;font-size:11px;}.hint{color:#4A5568;font-size:11px;font-style:italic;margin-top:2px;}
.cond{color:#4A5568;font-weight:400;text-transform:none;letter-spacing:0;}
.alerte{background:#F7E4E0;border-left:4px solid #B03A2E;padding:10px 14px;border-radius:5px;margin:12px 0;}
.ok{background:#E1EFEB;border-left:4px solid #0B6E5F;padding:10px 14px;border-radius:5px;margin:12px 0;}
.foot{margin-top:22px;padding-top:10px;border-top:1px solid #e3ded3;font-size:11px;color:#4A5568;}
th{background:#0B6E5F;color:#fff;text-align:left;padding:6px 9px;font-size:11.5px;}
@media print{body{padding:0;}}</style></head><body>
<div class="band"><div class="eyebrow">${esc(ctx.campus?.name || "Campus Manager")} · Dossier de dépôt</div>
<h1>Contrat d'${c.type === "professionnalisation" ? "professionnalisation" : "apprentissage"} — ${esc(ctx.learner ? ctx.learner.prenom + " " + ctx.learner.nom : "")}</h1></div>
${d.ready ? `<div class="ok"><b>Dossier complet</b> — toutes les rubriques exigées sont renseignées.</div>`
  : `<div class="alerte"><b>${d.missing.length} rubrique(s) à compléter avant dépôt</b> (dossier rempli à ${d.completeness} %)
     <ul style="margin:6px 0 0;padding-left:18px;">${d.missing.slice(0, 12).map((m) => `<li>${esc(m.section)} — ${esc(m.label)}</li>`).join("")}</ul></div>`}
${d.sections.map(section).join("")}
${d.periods.length ? `<h2>Rémunération par période</h2>
<table><thead><tr><th>Du</th><th>Au</th><th>Année</th><th>Âge</th><th>% base</th><th>Minimum légal</th></tr></thead><tbody>
${d.periods.map((p) => `<tr><td>${esc(p.from)}</td><td>${esc(p.to)}</td><td>${p.year ?? "—"}</td><td>${p.age ?? "—"}${p.ageRemuneration != null && p.ageRemuneration !== p.age ? ` <span class="hint">(tranche ${p.ageRemuneration} ans)</span>` : ""}</td>
<td>${p.rate != null ? Math.round(p.rate * 100) + " %" : "—"}</td><td>${eur(p.montantMinimum)}</td></tr>`).join("")}
</tbody></table>
<p class="hint">Les périodes se coupent aux anniversaires du contrat ET au premier jour du mois suivant chaque changement de tranche d'âge de l'apprenti.</p>` : ""}
<div class="foot"><b>Nature de ce document.</b> Dossier de dépôt destiné à la saisie sur le portail de l'opérateur de compétences ou au dépôt dématérialisé. Il ne remplace pas le formulaire Cerfa officiel, qui relève de l'administration.
${nir ? "<br>Le NIR figurant sur ce document a été saisi à l'édition et n'est pas conservé par l'application." : ""}
<br>Barème de rémunération : ${esc(d.periods[0]?.base || "SMIC")} — à revérifier à chaque revalorisation. Édité le ${new Date().toLocaleDateString("fr-FR")}.</div>
</body></html>`);
});

// Simulateur de rémunération minimale (affiché à la saisie, pas seulement en contrôle)
app.get("/api/contracts/wage/simulate", requireAuth, (req, res) => {
  const { age, year } = req.query;
  const smic = Number(store.getSettings().smicMensuel) || SMIC_MENSUEL_DEFAUT;
  const w = minimumWage({ age: Number(age), year: Number(year) || 1, smic });
  if (!w) return res.status(400).json({ error: "âge invalide" });
  res.json({ ...w, smic });
});

// --- Workflow de rupture ---
app.post("/api/contracts/:id/rupture", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  if (!String(req.body?.motif || "").trim()) return res.status(400).json({ error: "motif du signalement requis" });
  const r = store.openRupture(c.id, { ...req.body, by: req.user?.name || req.user?.email || "" });
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "create", "rupture", `signalement — ${req.body.motif}`);
  res.json(hydrateContract(r));
});

app.patch("/api/contracts/:id/rupture", requireAuth, (req, res) => {
  const c = contractGuard(req, res);
  if (!c) return;
  const r = store.advanceRupture(c.id, { ...req.body, by: req.user?.name || req.user?.email || "" });
  if (!r) return res.status(404).json({ error: "aucune rupture en cours sur ce contrat" });
  if (r.error) return res.status(400).json(r);
  logAudit(req, "update", "rupture", `${req.body?.stage} — ${req.body?.note || ""}`);
  res.json(hydrateContract(r));
});

// ===== Émargement (preuve de réalisation) =====
// La feuille est ouverte depuis une séance du planning, remplie, puis CLOSE : la
// clôture la fige et l'accroche à la chaîne d'empreintes du campus. Après clôture,
// toute correction passe par un avenant motivé, jamais par une réécriture.

function sheetGuard(req, res) {
  const sheet = attendancestore.getSheet(req.params.id);
  if (!sheet) { res.status(404).json({ error: "feuille introuvable" }); return null; }
  if (!assertCampus(req, res, sheet.campusId)) return null;
  return sheet;
}
// Apprenants attendus à une séance = inscrits actifs de la classe.
function learnersOfClass(classId, campusId) {
  // Les stagiaires de la formation professionnelle (apprentis dont le contrat a
  // été rompu) restent en formation : ils doivent figurer sur les feuilles
  // d'émargement et dans les bulletins, sans quoi ils sortent des radars.
  const ids = new Set(store.listEnrollments({ classId, statut: store.ENROLLMENT_ACTIFS }).map((e) => e.learnerId));
  return store.listLearners({ campusId }).filter((l) => ids.has(l.id));
}
function hydrateSheet(sheet) {
  if (!sheet) return sheet;
  const names = new Map(store.listLearners({ campusId: sheet.campusId }).map((l) => [l.id, `${l.prenom} ${l.nom}`]));
  return {
    ...sheet,
    // État effectif : l'appel scellé auquel les avenants sont appliqués. Le sceau
    // d'origine, lui, ne bouge jamais (voir lib/attendancestore.js).
    entries: effectiveEntries(sheet).map((e) => ({ ...e, learnerName: names.get(e.learnerId) || "—" })),
    stats: sheetStats(sheet),
  };
}

app.get("/api/attendance/sheets", requireAuth, (req, res) => {
  const { campusId, classId, from, to, status } = req.query;
  if (campusId && !canCampus(req, campusId)) return res.status(403).json({ error: "campus hors de votre périmètre" });
  let sheets = attendancestore.listSheets({ campusId, classId, from, to, status });
  if (!campusId) sheets = sheets.filter((s) => canCampus(req, s.campusId));
  const classes = new Map(store.listClasses({}).map((k) => [k.id, k.name]));
  res.json(sheets.map((s) => ({ ...s, className: classes.get(s.classId) || null, stats: sheetStats(s), entries: undefined, entryCount: (s.entries || []).length })));
});

// Ouvre (ou retrouve) la feuille d'une séance : c'est le geste « faire l'appel ».
app.post("/api/sessions/:sid/attendance", requireAuth, (req, res) => {
  const session = sessionstore.getSession(req.params.sid);
  if (!session) return res.status(404).json({ error: "séance introuvable" });
  if (!assertCampus(req, res, session.campusId)) return;
  const learners = learnersOfClass(session.classId, session.campusId);
  if (!learners.length) return res.status(400).json({ error: "aucun apprenant inscrit dans cette classe — créer les inscriptions d'abord" });
  const sheet = attendancestore.openSheet({ session, learners, signMode: req.body?.signMode, openedBy: req.user?.name || req.user?.email || "" });
  logAudit(req, "create", "emargement", `feuille ${session.date} ${session.start}`);
  res.json(hydrateSheet(sheet));
});

app.get("/api/attendance/sheets/:id", requireAuth, (req, res) => {
  const sheet = sheetGuard(req, res);
  if (!sheet) return;
  res.json(hydrateSheet(sheet));
});

app.patch("/api/attendance/sheets/:id/entries", requireAuth, (req, res) => {
  const sheet = sheetGuard(req, res);
  if (!sheet) return;
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (entries.some((e) => e.status && !ATTENDANCE_STATUSES.includes(e.status))) return res.status(400).json({ error: "statut d'appel invalide" });
  const r = attendancestore.setEntries(sheet.id, entries);
  if (r?.error) return res.status(r.error.startsWith("apprenant") ? 400 : 409).json(r);
  res.json(hydrateSheet(r));
});

app.post("/api/attendance/sheets/:id/sign", requireAuth, (req, res) => {
  const sheet = sheetGuard(req, res);
  if (!sheet) return;
  const { learnerId, signature } = req.body || {};
  if (!learnerId) return res.status(400).json({ error: "apprenant requis" });
  const r = attendancestore.signEntry(sheet.id, learnerId, signature);
  if (r?.error) return res.status(409).json(r);
  res.json(hydrateSheet(r));
});

// Signature par code de séance : l'apprenant saisit le code affiché en salle.
// Route volontairement tolérante au rôle (le portail apprenant s'y branchera),
// mais elle exige le code exact d'une feuille encore ouverte.
// Depuis un poste salarié, la signature par code est réservée à l'administration
// (tablette partagée en salle) et tracée. Un apprenant signe depuis SON portail,
// où le jeton détermine l'identité et où tout learnerId reçu est ignoré. Sans
// cette restriction, n'importe quel compte du campus pourrait signer à la place
// d'un apprenant — un émargement de ce genre ne vaut rien en contrôle.
app.post("/api/attendance/sign-by-code", requireAuth, requireAdmin, (req, res) => {
  const { code, learnerId, signature } = req.body || {};
  const sheet = attendancestore.getSheetByCode(code);
  if (!sheet) return res.status(404).json({ error: "code invalide ou séance close" });
  if (!assertCampus(req, res, sheet.campusId)) return;
  const r = attendancestore.signEntry(sheet.id, learnerId, signature);
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "update", "emargement", `signature saisie depuis un poste salarié pour ${learnerId}`);
  res.json({ ok: true, sheetId: sheet.id });
});

app.post("/api/attendance/sheets/:id/lock", requireAuth, (req, res) => {
  const sheet = sheetGuard(req, res);
  if (!sheet) return;
  const r = attendancestore.lockSheet(sheet.id, req.user?.name || req.user?.email || "");
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "update", "emargement", `clôture feuille ${r.date} ${r.start} (seq ${r.seq})`);
  res.json(hydrateSheet(r));
});

app.post("/api/attendance/sheets/:id/amend", requireAuth, (req, res) => {
  const sheet = sheetGuard(req, res);
  if (!sheet) return;
  const r = attendancestore.amendSheet(sheet.id, { ...req.body, by: req.user?.name || req.user?.email || "" });
  if (r?.error) return res.status(409).json(r);
  logAudit(req, "update", "emargement", `avenant feuille ${r.date} — ${req.body?.reason || ""}`);
  res.json(hydrateSheet(r));
});

// Contrôle d'intégrité de la chaîne d'un campus : c'est le rapport qu'on présente
// à un contrôleur, et celui qui révèle une altération du fichier.
app.get("/api/attendance/verify", requireAuth, (req, res) => {
  const campusId = req.query.campusId;
  if (!requireCampus(req, res, campusId)) return;
  const chain = attendancestore.verifyCampusChain(campusId);
  const avenants = attendancestore.listAmendments(campusId);
  res.json({ ...chain, amendments: avenants.length,
    sheets: Math.max(0, (chain.count ?? 0) - avenants.length) });
});

// Attestation d'assiduité imprimable (période × classe) — la pièce financeur.
// ===== Certificat de réalisation =====
//
// C'est LE justificatif attendu par un financeur (opérateur de compétences,
// Caisse des dépôts, France Travail) pour libérer les fonds. Il est distinct de
// l'attestation de formation, qui est remise au stagiaire : le certificat est
// remis au FINANCEUR et engage le responsable de l'organisme, qui le signe.
//
// Mentions obligatoires : art. D. 6353-4 du code du travail (dans sa rédaction
// issue du décret du 30 décembre 2021) — identité du représentant légal de
// l'organisme et du stagiaire, intitulé de l'action, dates et durée de
// réalisation, et signature. Le modèle est harmonisé entre opérateurs.
//
// ⚠️ À revérifier à chaque évolution réglementaire (veille trimestrielle).
const CERTIFICAT_ISSUES = {
  totalite: "suivi l'action de formation dans sa totalité",
  partielle: "suivi partiellement l'action de formation",
  abandon: "abandonné l'action de formation",
};

app.get("/api/learners/:id/certificat-realisation", requireAuth, (req, res) => {
  const l = learnerGuard(req, res);
  if (!l) return;
  const { from, to, issue } = req.query;
  const enr = store.listEnrollments({ learnerId: l.id }).find((e) => store.ENROLLMENT_ACTIFS.includes(e.statut)) || store.listEnrollments({ learnerId: l.id })[0];
  const classe = enr?.classId ? store.getClass(enr.classId) : null;
  const cur = classe?.curriculumId ? store.getCurriculum(classe.curriculumId) : null;
  const campus = store.listCampuses().find((c) => c.id === l.campusId);

  // Heures réellement réalisées, tirées des feuilles d'émargement CLOSES : c'est
  // la seule base défendable en contrôle. Une durée saisie à la main ne prouve rien.
  const sheets = attendancestore.listSheets({ campusId: l.campusId, classId: enr?.classId, from, to, status: "locked" });
  let prevu = 0, absent = 0;
  for (const s of sheets) {
    const st = sheetStats(s);
    const e = effectiveEntries(s).find((x) => x.learnerId === l.id);
    if (!e) continue;
    prevu += st.durationMinutes;
    if (e.status === "absent" || e.status === "excuse") absent += st.durationMinutes;
    else if (e.status === "retard") absent += Math.min(Number(e.minutesLate) || 0, st.durationMinutes);
  }
  const realise = Math.max(0, prevu - absent);
  const h = (m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  // L'issue est proposée d'après les faits, mais reste un choix de l'organisme :
  // c'est lui qui signe et qui engage sa responsabilité.
  const propose = realise === 0 ? "abandon" : absent === 0 ? "totalite" : "partielle";
  const retenue = CERTIFICAT_ISSUES[issue] ? issue : propose;
  const manquantes = [];
  if (!campus?.name) manquantes.push("nom de l'organisme");
  if (!campus?.numeroDeclaration) manquantes.push("numéro de déclaration d'activité");
  if (!campus?.dirigeant) manquantes.push("nom du représentant légal de l'organisme");
  if (!cur?.name && !classe?.name) manquantes.push("intitulé de l'action de formation");
  if (!sheets.length) manquantes.push("aucune feuille d'émargement close sur la période — la durée réalisée n'est pas justifiable");

  if (req.query.format !== "html") {
    return res.json({ issueProposee: propose, issues: CERTIFICAT_ISSUES, manquantes,
      heuresPrevues: prevu, heuresRealisees: realise, feuilles: sheets.length });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const chain = attendancestore.verifyCampusChain(l.campusId);
  logAudit(req, "export", "certificat", `certificat de réalisation — ${l.prenom} ${l.nom}`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Certificat de réalisation</title>
<style>body{font:13.5px/1.6 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;max-width:820px;margin:0 auto;padding:32px;}
h1{font-family:Georgia,serif;font-size:22px;margin:0 0 6px;}
.band{background:#0B6E5F;color:#fff;padding:14px 18px;border-radius:6px;margin-bottom:20px;}
.band .eyebrow{color:#FFD9CF;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;}
.bloc{margin:16px 0;}.bloc b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0B6E5F;margin-bottom:3px;}
.corps{background:#f7f4ec;border-left:4px solid #0B6E5F;padding:14px 18px;border-radius:5px;margin:18px 0;font-size:14px;}
.sign{margin-top:34px;display:flex;justify-content:space-between;gap:30px;}
.sign div{flex:1;}.sign .ligne{border-bottom:1px solid #0D1B2A;height:56px;margin-top:6px;}
.alerte{background:#F7E4E0;border-left:4px solid #B03A2E;padding:10px 14px;border-radius:5px;margin:14px 0;font-size:12.5px;}
.foot{margin-top:26px;padding-top:10px;border-top:1px solid #e3ded3;font-size:11px;color:#4A5568;}
@media print{body{padding:0;}}</style></head><body>
<div class="band"><div class="eyebrow">Certificat de réalisation — art. D. 6353-4 du code du travail</div>
<h1>Action de formation</h1></div>
${manquantes.length ? `<div class="alerte"><b>Mentions manquantes — ce certificat n'est pas conforme en l'état :</b><ul style="margin:6px 0 0;padding-left:18px;">${manquantes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
<div class="bloc"><b>Organisme de formation</b>${esc(campus?.name || "—")}${campus?.address ? `<br>${esc(campus.address)}` : ""}
${campus?.siret ? `<br>SIRET : ${esc(campus.siret)}` : ""}${campus?.numeroDeclaration ? `<br>Déclaration d'activité n° ${esc(campus.numeroDeclaration)}` : ""}</div>
<div class="bloc"><b>Représentant légal</b>${esc(campus?.dirigeant || "—")}</div>
<div class="corps">Je soussigné(e) <b>${esc(campus?.dirigeant || "…………………………")}</b>, représentant légal de l'organisme <b>${esc(campus?.name || "…………………………")}</b>,
atteste que <b>${esc(l.prenom)} ${esc(l.nom)}</b> a <b>${esc(CERTIFICAT_ISSUES[retenue])}</b>
intitulée <b>${esc(cur?.intitulePrecis || cur?.name || classe?.name || "…………………………")}</b>${cur?.codeRncp ? ` (RNCP ${esc(cur.codeRncp)})` : ""}
${from || to ? `du <b>${esc(from || "…")}</b> au <b>${esc(to || "…")}</b>` : ""}
pour une durée réalisée de <b>${h(realise)}</b>${prevu ? ` sur ${h(prevu)} prévues` : ""}.</div>
<div class="sign">
  <div><b style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0B6E5F;">Le stagiaire</b>
  <div>${esc(l.prenom)} ${esc(l.nom)}</div><div class="ligne"></div></div>
  <div><b style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0B6E5F;">Pour l'organisme</b>
  <div>${esc(campus?.dirigeant || "—")}</div><div class="ligne"></div></div>
</div>
<div class="foot"><b>Nature du document.</b> Certificat de réalisation destiné au financeur de l'action, distinct de l'attestation de formation remise au stagiaire.
La durée réalisée est calculée à partir des <b>feuilles d'émargement closes</b> de la période (${sheets.length} séance(s)), scellées par empreinte chaînée — contrôle d'intégrité à l'édition : ${chain.ok ? "chaîne intègre" : "CHAÎNE ROMPUE"}.
<br>Édité le ${new Date().toLocaleDateString("fr-FR")}. Mentions conformes à l'art. D. 6353-4 du code du travail, à revérifier à chaque évolution réglementaire.</div>
</body></html>`);
});

app.get("/api/attendance/proof", requireAuth, (req, res) => {
  const { campusId, classId, from, to } = req.query;
  if (!requireCampus(req, res, campusId)) return;
  const sheets = attendancestore.listSheets({ campusId, classId, from, to, status: "locked" });
  const agg = periodStats(sheets);
  const chain = attendancestore.verifyCampusChain(campusId);
  const anchors = store.listAnchors({ campusId, limit: 10 });
  const campus = store.listCampuses().find((c) => c.id === campusId);
  const className = classId ? (store.getClass(classId)?.name || "") : "toutes classes";
  const names = new Map(store.listLearners({ campusId }).map((l) => [l.id, `${l.prenom} ${l.nom}`]));
  const perLearner = new Map();
  for (const s of sheets) {
    const st = sheetStats(s);
    for (const e of s.entries || []) {
      const cur = perLearner.get(e.learnerId) || { planned: 0, absent: 0, unjustified: 0 };
      cur.planned += st.durationMinutes;
      if (e.status === "absent" || e.status === "excuse") { cur.absent += st.durationMinutes; if (!e.justified && e.status === "absent") cur.unjustified += st.durationMinutes; }
      else if (e.status === "retard") { const late = Math.min(Number(e.minutesLate) || 0, st.durationMinutes); cur.absent += late; if (!e.justified) cur.unjustified += late; }
      perLearner.set(e.learnerId, cur);
    }
  }
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const h = (n) => `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, "0")}`;
  const rows = [...perLearner.entries()].map(([lid, v]) => `<tr><td>${esc(names.get(lid) || "—")}</td><td>${h(v.planned)}</td><td>${h(Math.max(0, v.planned - v.absent))}</td><td>${h(v.absent)}</td><td>${h(v.unjustified)}</td><td>${v.planned ? Math.round(((v.planned - v.absent) / v.planned) * 1000) / 10 : 0} %</td></tr>`).join("");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Attestation d'assiduité</title>
<style>body{font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#0D1B2A;max-width:900px;margin:0 auto;padding:28px;}
h1{font-family:Georgia,serif;font-size:22px;margin:0 0 4px;}.band{background:#0B6E5F;color:#fff;padding:14px 18px;border-radius:6px;margin-bottom:18px;}
.band .eyebrow{color:#FFD9CF;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:12.5px;}th{background:#0B6E5F;color:#fff;text-align:left;padding:7px 9px;}
td{padding:6px 9px;border-bottom:1px solid #e3ded3;}tr:nth-child(even) td{background:#faf8f3;}
.kpi{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0;}.kpi div{background:#f4efe6;padding:10px 14px;border-radius:6px;}
.kpi b{display:block;font-size:18px;}.seal{margin-top:22px;padding:12px 14px;border:1px solid #e3ded3;border-radius:6px;font-size:11.5px;color:#4A5568;}
code{font-family:ui-monospace,monospace;word-break:break-all;}.ok{color:#0B6E5F;font-weight:700;}.ko{color:#B03A2E;font-weight:700;}
@media print{body{padding:0;}}</style></head><body>
<div class="band"><div class="eyebrow">Campus Manager · Preuve de réalisation</div><h1>Attestation d'assiduité</h1></div>
<p><b>${esc(campus?.name || "")}</b> — ${esc(className)}<br>Période du ${esc(from || "origine")} au ${esc(to || "ce jour")} · éditée le ${new Date().toLocaleDateString("fr-FR")}</p>
<div class="kpi">
  <div><b>${agg.lockedSheets}</b>séances closes</div>
  <div><b>${h(agg.plannedMinutes)}</b>heures prévues</div>
  <div><b>${h(agg.realizedMinutes)}</b>heures réalisées</div>
  <div><b>${agg.attendanceRate ?? "—"} %</b>taux d'assiduité</div>
</div>
<table><thead><tr><th>Apprenant</th><th>Prévu</th><th>Réalisé</th><th>Absence</th><th>dont non justifiée</th><th>Assiduité</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Aucune séance close sur la période.</td></tr>'}</tbody></table>
<div class="seal"><b>Scellement</b> — chaque feuille close est horodatée par le serveur et chaînée à la précédente par empreinte SHA-256 ; toute modification postérieure rompt la chaîne et devient détectable. Contrôle d'intégrité à l'édition : <span class="${chain.ok ? "ok" : "ko"}">${chain.ok ? "chaîne intègre" : "CHAÎNE ROMPUE (" + esc(chain.reason || "") + ")"}</span> sur ${chain.count ?? 0} feuille(s).<br>Empreinte de tête : <code>${esc(chain.lastHash || "—")}</code><br>Les corrections postérieures à une clôture figurent en avenant sur la feuille concernée.
${anchors.length ? `<br><b>Ancrages externes</b> — l'empreinte de la chaîne est publiée hors de ce système (email horodaté par un tiers), ce qui rend une falsification postérieure détectable même avec un accès complet au serveur. Derniers ancrages : ${anchors.slice(0, 5).map((an) => `${new Date(an.at).toLocaleString("fr-FR")}${an.sentTo ? "" : " (non transmis)"}`).join(" · ")}.` : `<br><b>Ancrages externes</b> — aucun ancrage publié pour ce campus : la chaîne n'est vérifiable qu'en interne.`}</div>
</body></html>`);
});

app.get("/api/sessions", requireAuth, (req, res) => {
  const { campusId, classId, teacherId, roomId, from, to } = req.query;
  const list = sessionstore.listSessions({ campusId, classId, teacherId, roomId, from, to });
  res.json(hydrate(scopeSessions(req, list)));
});
// Vérification d'un créneau sans l'écrire : l'éditeur interroge avant de poser.
app.post("/api/sessions/check", requireAuth, (req, res) => {
  const s = req.body || {};
  if (s.campusId && !assertCampus(req, res, s.campusId)) return;
  const others = sessionstore.listSessions({ from: s.date, to: s.date });
  res.json({ conflicts: conflictsFor(s, others, conflictCtx(s)) });
});
app.post("/api/sessions", requireAuth, (req, res) => {
  const s = req.body || {};
  if (!requireCampus(req, res, s.campusId)) return;
  if (!s.date || !s.start || !s.end) return res.status(400).json({ error: "date et horaires requis" });
  const others = sessionstore.listSessions({ from: s.date, to: s.date });
  const conflicts = conflictsFor(s, others, conflictCtx(s));
  // Un blocage dur ne se force pas ; un « forçable » oui, mais il est tracé.
  if (hasHardBlock(conflicts)) return res.status(409).json({ error: "créneau impossible", conflicts });
  const forcables = conflicts.filter((c) => c.level === "block-forcable");
  if (forcables.length && !s.force) return res.status(409).json({ error: "conflit à confirmer", conflicts, forcable: true });
  const made = sessionstore.addSession({ ...s, forced: forcables.map((c) => c.code) });
  if (forcables.length) logAudit(req, "update", "session", `forçage ${forcables.map((c) => c.code).join(",")} le ${s.date}`);
  res.json(hydrate([made])[0]);
});
// Série récurrente : une seule écriture pour N séances.
app.post("/api/sessions/series", requireAuth, (req, res) => {
  const { until, force, ...s } = req.body || {};
  if (!requireCampus(req, res, s.campusId)) return;
  if (!s.date || !s.start || !s.end || !until) return res.status(400).json({ error: "date, horaires et date de fin requis" });
  const seriesId = sessionstore.id();
  const occ = expandWeekly({ ...s, seriesId }, until, store.listPeriods({ campusId: s.campusId }));
  if (!occ.length) return res.status(400).json({ error: "aucune date : la période est entièrement fermée" });
  const kept = [], skipped = [];
  const byDate = new Map();
  for (const o of occ) {
    if (!byDate.has(o.date)) byDate.set(o.date, sessionstore.listSessions({ from: o.date, to: o.date }));
    const conflicts = conflictsFor(o, byDate.get(o.date), conflictCtx(o));
    const hard = hasHardBlock(conflicts);
    const forcables = conflicts.filter((c) => c.level === "block-forcable");
    // Une occurrence en conflit est ÉCARTÉE, pas la série entière : un seul jour férié
    // oublié ne doit pas faire échouer la pose d'une année.
    if (hard || (forcables.length && !force)) { skipped.push({ date: o.date, conflicts }); continue; }
    kept.push({ ...o, forced: forcables.map((c) => c.code) });
  }
  const made = kept.length ? sessionstore.addSessions(kept) : [];
  logAudit(req, "create", "session", `série de ${made.length} séances`);
  res.json({ seriesId, created: made.length, skipped });
});
app.patch("/api/sessions/:id", requireAuth, (req, res) => {
  const cur = sessionstore.getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  if (!assertCampus(req, res, cur.campusId)) return;
  const next = { ...cur, ...req.body };
  if (req.body?.date || req.body?.start || req.body?.end || req.body?.teacherId || req.body?.roomId) {
    const others = sessionstore.listSessions({ from: next.date, to: next.date });
    const conflicts = conflictsFor(next, others, conflictCtx(next));
    if (hasHardBlock(conflicts)) return res.status(409).json({ error: "créneau impossible", conflicts });
    if (conflicts.some((c) => c.level === "block-forcable") && !req.body.force) {
      return res.status(409).json({ error: "conflit à confirmer", conflicts, forcable: true });
    }
  }
  res.json(hydrate([sessionstore.updateSession(req.params.id, req.body || {})])[0]);
});
app.patch("/api/sessions/series/:sid", requireAuth, requireAdmin, (req, res) => {
  res.json({ updated: sessionstore.updateSeries(req.params.sid, req.body || {}).length });
});
app.delete("/api/sessions/:id", requireAuth, (req, res) => {
  const cur = sessionstore.getSession(req.params.id);
  if (cur && !assertCampus(req, res, cur.campusId)) return;
  sessionstore.deleteSession(req.params.id);
  res.json({ ok: true });
});
app.delete("/api/sessions/series/:sid", requireAuth, requireAdmin, (req, res) => {
  res.json({ deleted: sessionstore.deleteSeries(req.params.sid) });
});

// --- Génération automatique de la semaine type ---
app.post("/api/schedule/generate", requireAuth, requireAdmin, (req, res) => {
  const { campusId, classIds, ...opts } = req.body || {};
  if (campusId && !assertCampus(req, res, campusId)) return;
  let classes = store.listClasses({ campusId });
  if (Array.isArray(classIds) && classIds.length) classes = classes.filter((k) => classIds.includes(k.id));
  if (!classes.length) return res.status(400).json({ error: "aucune classe à planifier" });

  const sizes = {};
  for (const k of classes) sizes[k.id] = store.classSize(k);
  // Dates témoins : une date réelle par jour de la semaine, pour que la vérification
  // de disponibilité (indisponibilités datées comprises) porte sur du concret.
  const monday = nextMonday(req.body?.weekOf);
  const probeDates = {};
  ["lun", "mar", "mer", "jeu", "ven", "sam"].forEach((d, i) => {
    const dt = new Date(`${monday}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + i);
    probeDates[d] = dt.toISOString().slice(0, 10);
  });

  const out = generateWeek({
    classes, curricula: store.listCurricula(),
    teachers: store.listTeachers({ campusId }).filter((t) => t.active !== false),
    rooms: store.listRooms({ campusId }), sizes, probeDates,
    openingHours: campusId ? store.getCampusHours(campusId) : null,
    limits: SERVICE_LIMITS,
  }, opts);
  res.json({ ...out, weekOf: monday, options: { ...GEN_DEFAULTS, ...opts } });
});
function nextMonday(from) {
  // Lundi de la semaine visée (ou le prochain si la date tombe un autre jour).
  const d = from ? new Date(`${from}T12:00:00Z`) : new Date();
  const day = d.getUTCDay();               // 0 = dimanche, 1 = lundi
  d.setUTCDate(d.getUTCDate() + (day === 1 ? 0 : (8 - day) % 7));
  return d.toISOString().slice(0, 10);
}
// Application : la semaine générée devient des séances datées, sur toute la période.
app.post("/api/schedule/apply", requireAuth, requireAdmin, (req, res) => {
  const { week, weekOf, until, campusId } = req.body || {};
  if (!Array.isArray(week) || !week.length) return res.status(400).json({ error: "semaine vide" });
  if (campusId && !assertCampus(req, res, campusId)) return;
  if (!weekOf || !until) return res.status(400).json({ error: "période requise" });
  const periods = store.listPeriods({ campusId });
  const offset = { lun: 0, mar: 1, mer: 2, jeu: 3, ven: 4, sam: 5 };
  const all = [];
  for (const w of week) {
    const d = new Date(`${weekOf}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (offset[w.day] ?? 0));
    const first = d.toISOString().slice(0, 10);
    const seriesId = sessionstore.id();
    all.push(...expandWeekly({
      campusId: campusId || w.campusId, classId: w.classId, moduleId: w.moduleId,
      teacherId: w.teacherId, roomId: w.roomId, start: w.start, end: w.end,
      date: first, seriesId, kind: "cours",
    }, until, periods));
  }
  const made = sessionstore.addSessions(all);
  logAudit(req, "create", "session", `planning appliqué : ${made.length} séances`);
  res.json({ created: made.length });
});

// --- Pilotage : couverture, service, coût ---
app.get("/api/schedule/coverage", requireAuth, (req, res) => {
  const k = store.getClass(req.query.classId);
  if (!k) return res.status(404).json({ error: "classe introuvable" });
  if (!assertCampus(req, res, k.campusId)) return;
  const cur = store.getCurriculum(k.curriculumId);
  if (!cur) return res.status(400).json({ error: "aucun référentiel rattaché à cette classe" });
  const sessions = sessionstore.listSessions({ classId: k.id });
  // Semaines de cours reelles de CETTE classe : c'est ce qui convertit la maquette
  // hebdomadaire en volume annuel du. Une alternance en a deux fois moins.
  const weeks = k.weeksAtSchool || (k.modalite === "alternance" ? 18 : 36);
  res.json({
    classId: k.id, className: k.name, curriculum: cur.name, weeks,
    weeklyDue: store.curriculumWeekly(cur, k.year),
    ...coverage(cur, sessions, { today: new Date().toISOString().slice(0, 10), endDate: req.query.endDate, year: k.year, weeks }),
  });
});
app.get("/api/schedule/service", requireAuth, (req, res) => {
  const campusId = req.query.campusId;
  if (campusId && !assertCampus(req, res, campusId)) return;
  const sessions = scopeSessions(req, sessionstore.listSessions({ campusId, from: req.query.from, to: req.query.to }));
  const teachers = store.listTeachers({ campusId });
  const rows = teachers.map((t) => serviceOf(t, sessions));
  const cost = rows.reduce((a, r) => a + (r.cost || 0), 0);
  res.json({ rows: rows.sort((a, b) => b.planned - a.planned), equity: equity(rows), cost: Math.round(cost), limits: SERVICE_LIMITS });
});

// Propose qui peut enseigner quoi, à partir du référentiel et des fiches existantes.
// C'est l'information la plus structurante du module : sans elle, tout le monde est
// « polyvalent » et le générateur affecte au hasard. On la propose, l'utilisateur valide.
app.post("/api/schedule/suggest-assignments", requireAuth, requireAdmin, requireIA, async (req, res) => {
  const { curriculumId, campusId } = req.body || {};
  const cur = store.getCurriculum(curriculumId);
  if (!cur) return res.status(404).json({ error: "référentiel introuvable" });
  const teachers = store.listTeachers({ campusId }).filter((t) => t.active !== false);
  if (!teachers.length) return res.status(400).json({ error: "aucun intervenant déclaré" });

  const ctx = [
    `Référentiel : ${cur.name}${cur.diploma ? ` (${cur.diploma})` : ""}`,
    "Modules :",
    ...(cur.modules || []).map((m) => `- id=${m.id} | ${m.code ? m.code + " · " : ""}${m.label}${m.heures != null ? ` (${m.heures} h)` : ""}${m.requiresRoom ? ` [salle ${m.requiresRoom}]` : ""}`),
    "",
    "Intervenants :",
    // PSEUDONYMISATION — l'appariement matière/compétence ne demande aucun nom.
    // On envoie des étiquettes neutres et on remappe au retour : aucune donnée
    // identifiante d'un salarié ne part chez le fournisseur d'IA.
    ...teachers.map((t, i) => `- id=INT${i + 1} | ${t.status}${t.company ? " (prestataire)" : ""} | matières déclarées : ${(t.subjects || []).join(", ") || "AUCUNE"}`),
  ].join("\n");
  // Table de correspondance, gardée en mémoire le temps de la requête.
  const pseudo = new Map(teachers.map((t, i) => [`INT${i + 1}`, t.id]));

  try {
    const resp = await openai.chat.completions.create({
      model: PROMPTS.pnl.model, max_completion_tokens: 2500,
      messages: [{ role: "system", content: TEACHING_ASSIGNMENTS }, { role: "user", content: ctx }],
    });
    if (resp.choices?.[0]?.finish_reason === "length") return res.status(502).json({ error: "réponse tronquée" });
    const raw = resp.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    let d; try { d = JSON.parse(m ? m[0] : raw); } catch { return res.status(502).json({ error: "réponse IA non exploitable" }); }
    // Retour aux identifiants réels. Un pseudonyme inconnu est ignoré : le modèle
    // ne doit pas pouvoir désigner un intervenant qu'on ne lui a pas soumis.
    if (Array.isArray(d?.assignments)) {
      d.assignments = d.assignments
        .map((x) => ({ ...x, teacherId: pseudo.get(x.teacherId) || null }))
        .filter((x) => x.teacherId);
    }
    const byT = new Map(teachers.map((t) => [t.id, t]));
    const byM = new Map((cur.modules || []).map((x) => [x.id, x]));
    // On ne fait confiance à rien : chaque identifiant renvoyé est revérifié contre
    // le référentiel et la liste réelle des intervenants.
    const assignments = (Array.isArray(d.assignments) ? d.assignments : [])
      .filter((a) => byM.has(a.moduleId))
      .map((a) => ({
        moduleId: a.moduleId, moduleLabel: byM.get(a.moduleId).label,
        teachers: (Array.isArray(a.teacherIds) ? a.teacherIds : []).filter((id) => byT.has(id)).slice(0, 3)
          .map((id) => ({ id, name: byT.get(id).name })),
        confidence: ["haute", "moyenne", "faible"].includes(a.confidence) ? a.confidence : "faible",
        rationale: String(a.rationale || "").slice(0, 300),
      }))
      .filter((a) => a.teachers.length);
    res.json({ assignments, unmatched: Array.isArray(d.unmatched) ? d.unmatched.slice(0, 20) : [] });
  } catch (e) {
    console.error("[suggest-assignments]", e?.message || e);
    res.status(500).json({ error: "suggestion impossible" });
  }
});

// Applique les affectations validées : ajoute les matières aux fiches concernées.
app.post("/api/schedule/apply-assignments", requireAuth, requireAdmin, (req, res) => {
  const list = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const touched = new Map();
  for (const a of list) {
    for (const t of a.teachers || []) {
      const cur = touched.get(t.id) || store.getTeacher(t.id);
      if (!cur) continue;
      const subs = new Set([...(cur.subjects || []), a.moduleLabel].filter(Boolean));
      cur.subjects = [...subs];
      touched.set(t.id, cur);
    }
  }
  for (const [id, t] of touched) store.updateTeacher(id, { subjects: t.subjects });
  logAudit(req, "validate", "teacher", `${touched.size} fiche(s) enrichie(s) des matières`);
  res.json({ updated: touched.size });
});

// Taux d'occupation des salles : une salle vide toute la semaine coûte un loyer,
// une salle saturée bloque le planning. Les deux se voient ici et nulle part ailleurs.
app.get("/api/schedule/rooms-usage", requireAuth, (req, res) => {
  const { campusId, from, to } = req.query;
  if (campusId && !assertCampus(req, res, campusId)) return;
  const rooms = store.listRooms({ campusId });
  const sessions = scopeSessions(req, sessionstore.listSessions({ campusId, from, to })).filter((s) => s.status !== "cancelled");
  // Capacité théorique : jours ouvrés × amplitude, calée sur la fenêtre demandée.
  const days = from && to ? Math.max(1, Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1) : 7;
  const openHoursPerDay = 9;
  const capacity = Math.round((days * 5 / 7) * openHoursPerDay);
  const rows = rooms.map((r) => {
    const mine = sessions.filter((s) => s.roomId === r.id);
    const used = mine.reduce((a, s) => a + hoursOf(s), 0);
    return {
      roomId: r.id, name: r.name, kind: r.kind, places: r.places,
      sessions: mine.length, hours: Math.round(used * 10) / 10,
      rate: capacity ? Math.round((used / capacity) * 100) : null,
      classes: [...new Set(mine.map((s) => s.classId))].length,
    };
  }).sort((a, b) => (b.rate || 0) - (a.rate || 0));
  const orphelines = rows.filter((r) => !r.sessions).map((r) => r.name);
  res.json({ rows, capacityHours: capacity, unused: orphelines });
});

// --- Impression, iCal, envoi ---
function scheduleFor(req) {
  const { classId, teacherId, from, to } = req.query;
  const list = sessionstore.listSessions({ classId, teacherId, from, to });
  return hydrate(scopeSessions(req, list));
}
app.get("/api/schedule/print", requireAuth, (req, res) => {
  const rows = scheduleFor(req);
  const who = req.query.classId ? store.getClass(req.query.classId)?.name : store.getTeacher(req.query.teacherId)?.name;
  const html = buildScheduleHtml({
    title: who || "Emploi du temps",
    subtitle: [req.query.from && `du ${frDateFR(req.query.from)}`, req.query.to && `au ${frDateFR(req.query.to)}`].filter(Boolean).join(" "),
    sessions: rows,
  });
  res.set("Content-Type", "text/html; charset=utf-8").send(html);
});
app.get("/api/schedule/ics", requireAuth, (req, res) => {
  const rows = scheduleFor(req);
  const who = req.query.classId ? store.getClass(req.query.classId)?.name : store.getTeacher(req.query.teacherId)?.name;
  res.set("Content-Type", "text/calendar; charset=utf-8")
     .set("Content-Disposition", `attachment; filename="planning-${slugify(who || "campus")}.ics"`)
     .send(buildIcs({ sessions: rows, name: who || "Emploi du temps" }));
});
const frDateFR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Envoi du planning. Un professeur reçoit LE SIEN (son email de fiche) ; une classe
// s'envoie à des destinataires explicites — les emails étudiants ne sont pas stockés,
// et je ne vais pas les inventer.
app.post("/api/schedule/send", requireAuth, requireAdmin, async (req, res) => {
  const { teacherIds, classId, to, from, until, intro } = req.body || {};
  const period = { from, to: until };
  const targets = [];

  for (const tid of Array.isArray(teacherIds) ? teacherIds : []) {
    const t = store.getTeacher(tid);
    if (!t) continue;
    if (!t.email) { targets.push({ name: t.name, error: "aucune adresse email sur la fiche" }); continue; }
    const rows = hydrate(sessionstore.listSessions({ teacherId: tid, from: period.from, to: period.to }));
    targets.push({ name: t.name, to: t.email, title: `Votre emploi du temps${period.from ? ` — à partir du ${frDateFR(period.from)}` : ""}`, rows });
  }
  if (classId) {
    const k = store.getClass(classId);
    if (!k) return res.status(404).json({ error: "classe introuvable" });
    if (!assertCampus(req, res, k.campusId)) return;
    const dest = (Array.isArray(to) ? to : String(to || "").split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
    if (!dest.length) return res.status(400).json({ error: "aucun destinataire : les adresses des étudiants ne sont pas stockées, indique-les" });
    const rows = hydrate(sessionstore.listSessions({ classId, from: period.from, to: period.to }));
    targets.push({ name: k.name, to: dest.join(","), title: `Emploi du temps — ${k.name}`, rows });
  }
  if (!targets.length) return res.status(400).json({ error: "aucun destinataire" });

  const sent = [], failed = [];
  for (const t of targets) {
    if (t.error) { failed.push({ name: t.name, error: t.error }); continue; }
    try {
      await sendMail({
        user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD,
        to: t.to, subject: t.title,
        html: buildScheduleEmail({ title: t.title, intro: intro || "", sessions: t.rows }),
      });
      sent.push({ name: t.name, to: t.to, sessions: t.rows.length });
    } catch (e) { failed.push({ name: t.name, error: e.message }); }
  }
  logAudit(req, "update", "session", `planning envoyé à ${sent.length} destinataire(s)`);
  res.json({ sent, failed });
});

// --- Sync SI campus quotidienne (avant l'arrivée au bureau ; brief à 7h30) ---
const siCron = process.env.SI_CRON || "15 6 * * *";
if (process.env.SI_SYNC !== "off" && cron.validate(siCron)) {
  cron.schedule(siCron, async () => {
    for (const c of store.listCampuses()) {
      if (!store.getSiConfig(c.id)) continue;
      try {
        const r = await syncSiCampus(c);
        if (r) console.log(`[si] ${c.name} : ${r.ok ? "sync ok" : "echec — " + r.error}`);
      } catch (e) { console.error(`[si] ${c.name} :`, e?.message || e); }
    }
  }, { timezone: "Europe/Paris" });
  console.log(`[si] sync planifiee (${siCron}, Europe/Paris)`);
}

// --- Sync Salesforce quotidienne (funnel admissions) ---
const sfCron = process.env.SF_CRON || "45 6 * * *";
if (process.env.SF_SYNC !== "off" && cron.validate(sfCron)) {
  cron.schedule(sfCron, async () => {
    try {
      const r = await syncSalesforce();
      if (r) console.log(`[salesforce] sync : ${r.created} creees, ${r.updated} maj, ${r.sansCampus} sans campus`);
    } catch (e) { console.error("[salesforce] echec :", e?.message || e); }
  }, { timezone: "Europe/Paris" });
  console.log(`[salesforce] sync planifiee (${sfCron}, Europe/Paris)`);
}

// --- Ancrage quotidien de la chaine d'emargement (S-1) ---
// Publie l'empreinte de tete hors de la machine : c'est ce qui rend une
// falsification a posteriori detectable meme avec un acces serveur complet.
const anchorCron = process.env.ANCHOR_CRON || "30 23 * * *";
if (process.env.ANCHOR !== "off" && cron.validate(anchorCron)) {
  cron.schedule(anchorCron, async () => {
    try {
      const to = alertCfg.to || store.getSettings().board?.recipients || "";
      const r = await anchorAttendanceChains({ to });
      if (r.length) console.log(`[ancrage] ${r.length} chaine(s) ancree(s)${to ? " et envoyee(s) a " + to : " (aucun destinataire configure)"}`);
    } catch (e) { console.error("[ancrage] echec :", e?.message || e); }
  }, { timezone: "Europe/Paris" });
  console.log(`[ancrage] planifie (${anchorCron}, Europe/Paris)`);
}

// --- Purge de conservation (RGPD art. 5.1.e) ---
// Sans execution automatique, une politique de conservation n'est qu'une
// declaration d'intention : c'est le grief numero un des controles CNIL.
const retentionCron = process.env.RETENTION_CRON || "0 4 * * 0";
if (process.env.RETENTION !== "off" && cron.validate(retentionCron)) {
  cron.schedule(retentionCron, () => {
    try {
      const r = runRetention({ dryRun: false });
      const total = Object.values(r).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0);
      if (total) console.log("[retention] purge :", JSON.stringify(r));
    } catch (e) { console.error("[retention] echec :", e?.message || e); }
  }, { timezone: "Europe/Paris" });
  console.log(`[retention] purge planifiee (${retentionCron}, Europe/Paris)`);
}

app.listen(PORT, () => {
  console.log(`assistant-campus V2 sur http://127.0.0.1:${PORT}`);
  console.log("routage :", Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, v.model])));
});

// Tests d'intégration sécurité : démarre le serveur sur un store jetable et vérifie
// CSRF, authentification, cloisonnement des rôles, upload interdit, validation métier.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-sec-"));
let srv;

function req(pathname, { method = "GET", cookie = "", csrf = "", json, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  return fetch(BASE + pathname, { method, headers, body, redirect: "manual" });
}
function readCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return jar;
}
async function login(email, password) {
  const res = await req("/api/login", { method: "POST", json: { email, password } });
  const jar = readCookies(res);
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return { status: res.status, cookie, csrf: jar.ac_csrf };
}

before(async () => {
  srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789", SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test", ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", PORT: String(PORT), NODE_ENV: "test" },
  });
  const deadline = Date.now() + 25000;   // marge démarrage à froid (jsdom/scrypt lents au 1er run sur certaines machines)
  for (;;) {
    try { const r = await fetch(BASE + "/health"); if (r.ok) break; } catch { /* pas encore prêt */ }
    if (Date.now() > deadline) throw new Error("serveur non démarré");
    await new Promise((r) => setTimeout(r, 150));
  }
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("route protégée sans session → 401", async () => {
  const r = await req("/api/campuses");
  assert.equal(r.status, 401);
});

test("login admin → 200 + cookies session & CSRF", async () => {
  const a = await login("admin@test.co", "pw12345678");
  assert.equal(a.status, 200);
  assert.match(a.cookie, /ac_session=/);
  assert.ok(a.csrf && /^[a-f0-9]{48}$/.test(a.csrf), "cookie CSRF présent");
});

test("mutation sans jeton CSRF → 403 ; avec jeton → 200", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const sans = await req("/api/decisions", { method: "POST", cookie: a.cookie, json: { title: "x" } });
  assert.equal(sans.status, 403);
  const avec = await req("/api/decisions", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { title: "Décision test" } });
  assert.equal(avec.status, 200);
});

test("validation métier : occupancy hors bornes → 400", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const camp = await (await req("/api/campuses", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { name: "Campus Test" } })).json();
  const bad = await req("/api/kpi", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { campusId: camp.id, month: "2099-01", occupancy: 150 } });
  assert.equal(bad.status, 400);
  const ok = await req("/api/kpi", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { campusId: camp.id, month: "2099-01", occupancy: 85 } });
  assert.equal(ok.status, 200);
});

test("upload : extension interdite → 400", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const fd = new FormData();
  fd.append("file", new Blob(["MZ"]), "malware.exe");
  const r = await req("/api/upload", { method: "POST", cookie: a.cookie, csrf: a.csrf, form: fd });
  assert.equal(r.status, 400);
});

test("cloisonnement rôles : un directeur n'accède pas aux routes admin", async () => {
  const a = await login("admin@test.co", "pw12345678");
  await req("/api/users", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { email: "dir@test.co", name: "Dir", role: "directeur", password: "pw12345678", campusIds: [] } });
  const d = await login("dir@test.co", "pw12345678");
  assert.equal(d.status, 200);
  const users = await req("/api/users", { cookie: d.cookie }); // route admin
  assert.equal(users.status, 403);
  // Les comités de pilotage sont des données réseau : même cloisonnement.
  assert.equal((await req("/api/committees", { cookie: d.cookie })).status, 403);
  const create = await req("/api/committees", { method: "POST", cookie: d.cookie, csrf: d.csrf, json: { name: "COPIL pirate" } });
  assert.equal(create.status, 403);
});

test("SI campus : config admin-only, jeton jamais renvoyé, overview scopé", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Si" } })).json();
  // URL invalide refusée ; config valide acceptée
  const bad = await req(`/api/campuses/${campus.id}/si/config`, { method: "PUT", ...opts, json: { baseUrl: "ftp://nope", token: "t" } });
  assert.equal(bad.status, 400);
  const ok = await (await req(`/api/campuses/${campus.id}/si/config`, { method: "PUT", ...opts, json: { baseUrl: "https://erp.demo.test", token: "secret-token-4242" } })).json();
  assert.equal(ok.configured, true);
  assert.ok(!JSON.stringify(ok).includes("secret-token-4242")); // jamais le jeton en clair
  // l'overview non plus ne fuit pas le jeton
  const over = await (await req("/api/si/overview", { cookie: a.cookie })).json();
  assert.ok(!JSON.stringify(over).includes("secret-token-4242"));
  // un directeur ne peut ni configurer ni synchroniser (données réseau + secret)
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await req(`/api/campuses/${campus.id}/si/config`, { method: "PUT", cookie: d.cookie, csrf: d.csrf, json: { baseUrl: "https://x.test", token: "t" } })).status, 403);
  assert.equal((await req(`/api/campuses/${campus.id}/si/sync`, { method: "POST", cookie: d.cookie, csrf: d.csrf, json: {} })).status, 403);
  // et l'overview d'un directeur sans campus assigné est vide (scopé)
  const dOver = await (await req("/api/si/overview", { cookie: d.cookie })).json();
  assert.equal(dOver.length, 0);
});

test("apprenants : cloisonnement directeur + garde-fous", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Apprenants" } })).json();
  // création sans nom → 400 ; complète → 200
  assert.equal((await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id } })).status, 400);
  const l = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Test", prenom: "Eleve" } })).json();
  assert.ok(l.id);
  // inscription sans année → 400 ; puis doublon actif → 409
  assert.equal((await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: {} })).status, 400);
  assert.equal((await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027" } })).status, 200);
  assert.equal((await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027" } })).status, 409);
  // un directeur sans campus assigné ne voit rien et ne touche à rien
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await (await req("/api/learners", { cookie: d.cookie })).json()).length, 0);
  assert.equal((await req(`/api/learners/${l.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await req(`/api/learners/${l.id}`, { method: "PATCH", cookie: d.cookie, csrf: d.csrf, json: { nom: "Pirate" } })).status, 403);
  // suppression réservée à l'admin
  assert.equal((await req(`/api/learners/${l.id}`, { method: "DELETE", cookie: d.cookie, csrf: d.csrf })).status, 403);
  assert.equal((await req(`/api/learners/${l.id}`, { method: "DELETE", ...opts })).status, 200);
});

test("apprenants : import CSV en masse + export Excel", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Import" } })).json();
  const csv = "nom;prenom;ine;date_naissance;classe;annee_scolaire\nDurand;Alice;1234IMPORT1;01/09/2007;;2026-2027\nDurand;Alice;1234IMPORT1;01/09/2007;;2026-2027\n;SansNom;;;;";
  // Le parseur SheetJS attend des virgules OU des points-virgules ? CSV standard : virgules.
  const csvComma = csv.replace(/;/g, ",");
  const fd = new FormData();
  fd.append("file", new Blob([csvComma], { type: "text/csv" }), "rentree.csv");
  const r = await (await req(`/api/campuses/${campus.id}/learners/import`, { method: "POST", cookie: a.cookie, csrf: a.csrf, form: fd })).json();
  assert.equal(r.created, 1);           // la 2e ligne = doublon INE, la 3e = sans nom
  assert.equal(r.enrolled, 1);
  assert.equal(r.skipped.length, 2);
  // la date française est normalisée en ISO
  const list = await (await req(`/api/learners?campusId=${campus.id}`, { cookie: a.cookie })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].dateNaissance, "2007-09-01");
  assert.equal(list[0].enrollment?.schoolYear, "2026-2027");
  // export Excel : 200 + un vrai xlsx (magic PK)
  const xls = await req("/api/export/learners", { cookie: a.cookie });
  assert.equal(xls.status, 200);
  const buf = Buffer.from(await xls.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), "PK");
});

test("candidatures : cloisonnement, conversion, config Salesforce jamais fuitée", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Cand" } })).json();
  const cand = await (await req("/api/candidates", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Test", prenom: "Cand" } })).json();
  assert.ok(cand.id);
  await req(`/api/candidates/${cand.id}`, { method: "PATCH", ...opts, json: { stage: "admis" } });
  const conv = await (await req(`/api/candidates/${cand.id}/convert`, { method: "POST", ...opts, json: {} })).json();
  assert.ok(conv.learner?.id);
  // config Salesforce : le secret n'est jamais renvoyé, un directeur ne peut pas la lire/écrire
  await req("/api/settings", { method: "PUT", ...opts, json: { salesforce: { instanceUrl: "https://org.my.salesforce.com", clientId: "cid", clientSecret: "topsecret4242" } } });
  const settings = await (await req("/api/settings", { cookie: a.cookie })).json();
  assert.ok(!JSON.stringify(settings).includes("topsecret4242"));
  assert.equal(settings.salesforce.configured, true);
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await req("/api/settings", { cookie: d.cookie })).status, 403);
  assert.equal((await (await req("/api/candidates", { cookie: d.cookie })).json()).length, 0);
  assert.equal((await req(`/api/candidates/${cand.id}`, { method: "PATCH", cookie: d.cookie, csrf: d.csrf, json: { stage: "perdu" } })).status, 403);
});

test("émargement : cycle appel → clôture → avenant, cloisonné, attestation scellée", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Emarge" } })).json();
  const classe = await (await req("/api/classes", { method: "POST", ...opts, json: { campusId: campus.id, name: "BTS Em 1" } })).json();
  const learner = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Eleve", prenom: "Un" } })).json();
  await req(`/api/learners/${learner.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027", classId: classe.id } });
  const session = await (await req("/api/sessions", { method: "POST", ...opts, json: { campusId: campus.id, classId: classe.id, date: "2026-09-14", start: "09:00", end: "12:00" } })).json();

  // Ouverture de la feuille : les inscrits actifs sont pré-remplis
  const sheet = await (await req(`/api/sessions/${session.id}/attendance`, { method: "POST", ...opts, json: {} })).json();
  assert.equal(sheet.entries.length, 1);
  assert.equal(sheet.entries[0].status, "present");
  assert.ok(sheet.code);

  // Statut invalide refusé
  assert.equal((await req(`/api/attendance/sheets/${sheet.id}/entries`, { method: "PATCH", ...opts, json: { entries: [{ learnerId: learner.id, status: "n_importe_quoi" }] } })).status, 400);

  // Appel : absent non justifié
  const saved = await (await req(`/api/attendance/sheets/${sheet.id}/entries`, { method: "PATCH", ...opts, json: { entries: [{ learnerId: learner.id, status: "absent", justified: false }] } })).json();
  assert.equal(saved.stats.absent, 1);
  assert.equal(saved.stats.attendanceRate, 0);

  // Clôture : scellement
  const locked = await (await req(`/api/attendance/sheets/${sheet.id}/lock`, { method: "POST", ...opts, json: {} })).json();
  assert.equal(locked.status, "locked");
  assert.equal(locked.seq, 1);
  assert.match(locked.hash, /^[a-f0-9]{64}$/);

  // Après clôture : saisie directe refusée (409), avenant sans motif refusé, avec motif accepté
  assert.equal((await req(`/api/attendance/sheets/${sheet.id}/entries`, { method: "PATCH", ...opts, json: { entries: [{ learnerId: learner.id, status: "present" }] } })).status, 409);
  assert.equal((await req(`/api/attendance/sheets/${sheet.id}/amend`, { method: "POST", ...opts, json: { learnerId: learner.id, status: "excuse" } })).status, 409);
  const amended = await (await req(`/api/attendance/sheets/${sheet.id}/amend`, { method: "POST", ...opts, json: { learnerId: learner.id, status: "excuse", reason: "certificat medical" } })).json();
  assert.equal(amended.amendments.length, 1);

  // Chaîne intègre + attestation scellée
  const chain = await (await req(`/api/attendance/verify?campusId=${campus.id}`, { cookie: a.cookie })).json();
  assert.equal(chain.ok, true);
  const proof = await req(`/api/attendance/proof?campusId=${campus.id}&from=2026-09-01&to=2026-09-30`, { cookie: a.cookie });
  assert.equal(proof.status, 200);
  const html = await proof.text();
  assert.match(html, /Attestation d'assiduité/);
  assert.match(html, /chaîne intègre/);

  // Cloisonnement : un directeur hors périmètre ne voit ni la feuille ni la preuve
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await req(`/api/attendance/sheets/${sheet.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await req(`/api/attendance/verify?campusId=${campus.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await (await req("/api/attendance/sheets", { cookie: d.cookie })).json()).length, 0);
});

test("comité : cycle complet et action rattachée à une séance", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const o = await (await req("/api/openings", { method: "POST", ...opts, json: { name: "Ouv Test", targetDate: "2027-09-01", seed: false } })).json();
  const c = await (await req("/api/committees", { method: "POST", ...opts, json: { scope: "opening", scopeId: o.id, name: "COPIL Test" } })).json();
  const s = await (await req(`/api/committees/${c.id}/sessions`, { method: "POST", ...opts, json: { date: "2026-10-01" } })).json();

  // une action sans intitulé est refusée
  const vide = await req(`/api/committees/${c.id}/sessions/${s.id}/tasks`, { method: "POST", ...opts, json: {} });
  assert.equal(vide.status, 400);

  const t = await (await req(`/api/committees/${c.id}/sessions/${s.id}/tasks`, { method: "POST", ...opts, json: { title: "Sécuriser le bail", accountable: "DAF" } })).json();
  assert.equal(t.committeeId, c.id);
  assert.equal(t.sessionId, s.id);

  const out = await (await req(`/api/openings/${o.id}/tasks/${t.id}/outputs`, { method: "POST", ...opts, json: { label: "Bail signé" } })).json();
  assert.equal(out.status, "todo");
  const cm = await req(`/api/openings/${o.id}/tasks/${t.id}/comments`, { method: "POST", ...opts, json: { text: "   " } });
  assert.equal(cm.status, 400, "un message vide est refusé");

  // un comité réseau ne peut pas fabriquer d'action d'ouverture
  const net = await (await req("/api/committees", { method: "POST", ...opts, json: { scope: "network", name: "CODIR" } })).json();
  const ns = await (await req(`/api/committees/${net.id}/sessions`, { method: "POST", ...opts, json: {} })).json();
  const ko = await req(`/api/committees/${net.id}/sessions/${ns.id}/tasks`, { method: "POST", ...opts, json: { title: "X" } });
  assert.equal(ko.status, 400);
});

test("compte désactivé → login refusé", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const list = await (await req("/api/users", { cookie: a.cookie, csrf: a.csrf })).json();
  const dir = list.find((u) => u.email === "dir@test.co");
  await req(`/api/users/${dir.id}`, { method: "PATCH", cookie: a.cookie, csrf: a.csrf, json: { active: false } });
  const d = await login("dir@test.co", "pw12345678");
  // verifyUserPassword bloque déjà les comptes inactifs → login rejeté (pas de session émise).
  assert.notEqual(d.status, 200);
  assert.ok(!d.csrf, "aucune session émise pour un compte désactivé");
});

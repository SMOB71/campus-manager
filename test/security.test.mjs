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

test("contrats : dépôt bloqué si non conforme, rupture répercutée, cloisonnement", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Contrats" } })).json();
  const learner = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Alt", prenom: "Ernant", dateNaissance: "2006-03-01", ine: "1234INE" } })).json();
  await req(`/api/learners/${learner.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027" } });
  const company = await (await req("/api/partners", { method: "POST", ...opts, json: { campusId: campus.id, name: "Entreprise Test", siret: "73282932000074", conventionCollective: "CCN test" } })).json();

  // Création incomplète : le contrat existe mais n'est pas déposable
  const c = await (await req("/api/contracts", { method: "POST", ...opts, json: { campusId: campus.id, learnerId: learner.id, companyId: company.id, type: "apprentissage", dateDebut: "2026-09-01", dateFin: "2028-08-31" } })).json();
  assert.equal(c.validation.ok, false); // maître d'apprentissage manquant
  assert.ok(c.validation.errors.some((e) => /Maître d'apprentissage/.test(e)));
  const refus = await req(`/api/contracts/${c.id}`, { method: "PATCH", ...opts, json: { status: "depose" } });
  assert.equal(refus.status, 409);

  // Une fois complété, le dépôt passe
  const ok = await (await req(`/api/contracts/${c.id}`, { method: "PATCH", ...opts, json: { maitreNom: "Paul Martin", maitreEmail: "paul@test.fr", npec: 8200 } })).json();
  assert.equal(ok.validation.ok, true);
  const depose = await (await req(`/api/contracts/${c.id}`, { method: "PATCH", ...opts, json: { status: "depose" } })).json();
  assert.equal(depose.status, "depose");

  // Rupture : signalement sans motif refusé, puis workflow jusqu'à confirmation
  assert.equal((await req(`/api/contracts/${c.id}/rupture`, { method: "POST", ...opts, json: {} })).status, 400);
  const sig = await (await req(`/api/contracts/${c.id}/rupture`, { method: "POST", ...opts, json: { motif: "Absences répétées", origine: "entreprise" } })).json();
  assert.equal(sig.rupture.stage, "signalee");
  const med = await (await req(`/api/contracts/${c.id}/rupture`, { method: "PATCH", ...opts, json: { stage: "mediation", note: "RDV tripartite" } })).json();
  assert.equal(med.rupture.events.length, 2);

  // Tant que la rupture est OUVERTE, elle remonte en alerte haute dans le cockpit
  const enCours = await (await req("/api/notifications", { cookie: a.cookie })).json();
  assert.ok(enCours.some((n) => n.type === "rupture_contrat" && n.severity === "high"));

  const conf = await (await req(`/api/contracts/${c.id}/rupture`, { method: "PATCH", ...opts, json: { stage: "confirmee", note: "Actée" } })).json();
  assert.equal(conf.status, "rompu");
  // l'inscription de l'apprenant a basculé
  const fiche = await (await req(`/api/learners/${learner.id}`, { cookie: a.cookie })).json();
  assert.equal(fiche.enrollments[0].statut, "rupture");

  // Une fois la rupture confirmée, le contrat est rompu : il n'alerte plus (le suivi
  // se poursuit côté apprenant, pas côté contrat).
  const apres = await (await req("/api/notifications", { cookie: a.cookie })).json();
  assert.ok(!apres.some((n) => n.type === "rupture_contrat" && n.contractId === c.id));

  // Cloisonnement : un directeur hors périmètre ne voit rien et ne peut pas agir
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await (await req("/api/contracts", { cookie: d.cookie })).json()).length, 0);
  assert.equal((await req(`/api/contracts/${c.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await req(`/api/contracts/${c.id}/rupture`, { method: "POST", cookie: d.cookie, csrf: d.csrf, json: { motif: "x" } })).status, 403);
  assert.equal((await req(`/api/contracts/${c.id}`, { method: "DELETE", cookie: d.cookie, csrf: d.csrf })).status, 403);
});

test("notes : barème contrôlé, moyennes et bulletin, cloisonnement", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Notes E2E" } })).json();
  const cur = await (await req("/api/curricula", { method: "POST", ...opts, json: { name: "BTS Test", modules: [{ code: "U1", label: "Optique", coefficient: 3 }, { code: "U2", label: "Anglais", coefficient: 1 }] } })).json();
  const classe = await (await req("/api/classes", { method: "POST", ...opts, json: { campusId: campus.id, name: "BTS T1", curriculumId: cur.id } })).json();
  const l1 = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Premier", prenom: "Eleve" } })).json();
  const l2 = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Second", prenom: "Eleve" } })).json();
  for (const l of [l1, l2]) await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027", classId: classe.id } });

  // Création : les inscrits actifs sont pré-remplis
  const ev = await (await req("/api/assessments", { method: "POST", ...opts, json: { campusId: campus.id, classId: classe.id, label: "DS1", moduleId: cur.modules[0].id, coefficient: 2, maxScore: 20 } })).json();
  const detail = await (await req(`/api/assessments/${ev.id}`, { cookie: a.cookie })).json();
  assert.equal(detail.grades.length, 2);

  // Note hors barème refusée
  assert.equal((await req(`/api/assessments/${ev.id}/grades`, { method: "PATCH", ...opts, json: { entries: [{ learnerId: l1.id, score: 25 }] } })).status, 400);

  // Saisie valide : une note, une absence
  await req(`/api/assessments/${ev.id}/grades`, { method: "PATCH", ...opts, json: { entries: [{ learnerId: l1.id, score: 16 }, { learnerId: l2.id, absent: true }] } });
  const report1 = await (await req(`/api/learners/${l1.id}/report`, { cookie: a.cookie })).json();
  assert.equal(report1.average, 16);
  assert.equal(report1.mention, "Très bien");
  assert.equal(report1.rank, 1);
  // l'absent n'a pas de moyenne (et surtout pas un zéro)
  const report2 = await (await req(`/api/learners/${l2.id}/report`, { cookie: a.cookie })).json();
  assert.equal(report2.average, null);

  // Bulletin imprimable
  const bull = await req(`/api/learners/${l1.id}/bulletin`, { cookie: a.cookie });
  assert.equal(bull.status, 200);
  const html = await bull.text();
  assert.match(html, /Bulletin scolaire/);
  assert.match(html, /16,00/);

  // Cloisonnement
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await (await req("/api/assessments", { cookie: d.cookie })).json()).length, 0);
  assert.equal((await req(`/api/assessments/${ev.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await req(`/api/assessments/${ev.id}/grades`, { method: "PATCH", cookie: d.cookie, csrf: d.csrf, json: { entries: [] } })).status, 403);
  assert.equal((await req(`/api/learners/${l1.id}/bulletin`, { cookie: d.cookie })).status, 403);
});

test("portails : cloisonnement strict, révocation, pas de session ni de CSRF détournables", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Portail E2E" } })).json();
  const classe = await (await req("/api/classes", { method: "POST", ...opts, json: { campusId: campus.id, name: "BTS P1" } })).json();
  const alice = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Alice", prenom: "A" } })).json();
  const bob = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Bob", prenom: "B" } })).json();
  for (const l of [alice, bob]) await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027", classId: classe.id } });

  // Génération du lien : le jeton n'est renvoyé qu'ici
  const acc = await (await req("/api/portal/access", { method: "POST", ...opts, json: { kind: "learner", subjectId: alice.id, campusId: campus.id, label: "Alice" } })).json();
  assert.ok(acc.url.includes("/portail.html#"));
  assert.equal(acc.tokenHash, undefined);
  const tokenAlice = acc.url.split("#")[1];

  const portal = (path, method = "GET", token = tokenAlice, body) => fetch(BASE + path, {
    method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Le portail d'Alice ne renvoie QUE le dossier d'Alice
  const me = await (await portal("/api/portal/me")).json();
  assert.equal(me.kind, "learner");
  assert.equal(me.identity.nom, "Alice");
  const dump = JSON.stringify(me);
  assert.ok(!dump.includes("Bob"), "fuite : le dossier d'un autre apprenant apparaît");
  assert.ok(!dump.includes(bob.id), "fuite : l'identifiant d'un autre apprenant apparaît");

  // Sans jeton, jeton bidon, ou jeton révoqué : refusé
  assert.equal((await fetch(BASE + "/api/portal/me")).status, 401);
  assert.equal((await portal("/api/portal/me", "GET", "n-importe-quoi")).status, 401);

  // Un jeton de portail n'ouvre AUCUNE route salariée
  assert.equal((await portal("/api/learners")).status, 401);
  assert.equal((await portal("/api/campuses")).status, 401);
  assert.equal((await portal("/api/portal/access")).status, 401);

  // Et une session salariée ne vaut pas jeton de portail (pas de repli sur le cookie)
  assert.equal((await req("/api/portal/me", { cookie: a.cookie })).status, 401);

  // L'apprenant ne peut pas signer pour un autre : le learnerId envoyé est ignoré
  const session = await (await req("/api/sessions", { method: "POST", ...opts, json: { campusId: campus.id, classId: classe.id, date: "2026-09-21", start: "09:00", end: "12:00" } })).json();
  const sheet = await (await req(`/api/sessions/${session.id}/attendance`, { method: "POST", ...opts, json: {} })).json();
  const signed = await (await portal("/api/portal/sign", "POST", tokenAlice, { code: sheet.code, learnerId: bob.id })).json();
  assert.equal(signed.ok, true);
  const after = await (await req(`/api/attendance/sheets/${sheet.id}`, { cookie: a.cookie })).json();
  assert.ok(after.entries.find((e) => e.learnerId === alice.id).signedAt, "Alice devait être signée");
  assert.ok(!after.entries.find((e) => e.learnerId === bob.id).signedAt, "Bob ne devait PAS être signé");

  // Un tuteur ne voit que les alternants de SON entreprise et ne peut signaler qu'eux
  const societe = await (await req("/api/partners", { method: "POST", ...opts, json: { campusId: campus.id, name: "Ma Boite" } })).json();
  const autre = await (await req("/api/partners", { method: "POST", ...opts, json: { campusId: campus.id, name: "Autre Boite" } })).json();
  await req("/api/contracts", { method: "POST", ...opts, json: { campusId: campus.id, learnerId: alice.id, companyId: societe.id, dateDebut: "2026-09-01", dateFin: "2028-08-31" } });
  await req("/api/contracts", { method: "POST", ...opts, json: { campusId: campus.id, learnerId: bob.id, companyId: autre.id, dateDebut: "2026-09-01", dateFin: "2028-08-31" } });
  const accTuteur = await (await req("/api/portal/access", { method: "POST", ...opts, json: { kind: "tutor", subjectId: societe.id, campusId: campus.id, label: "Ma Boite" } })).json();
  const tokenTuteur = accTuteur.url.split("#")[1];
  const vue = await (await portal("/api/portal/me", "GET", tokenTuteur)).json();
  assert.equal(vue.alternants.length, 1);
  assert.equal(vue.alternants[0].nom, "Alice");
  assert.ok(!JSON.stringify(vue).includes("Bob"));
  // signalement sur un alternant qui n'est pas le sien → refusé
  assert.equal((await portal("/api/portal/signal", "POST", tokenTuteur, { learnerId: bob.id, message: "test" })).status, 403);
  // un tuteur ne peut pas utiliser les routes réservées aux apprenants
  assert.equal((await portal("/api/portal/sign", "POST", tokenTuteur, { code: sheet.code })).status, 403);

  // Révocation : le lien cesse immédiatement de fonctionner
  const accesses = await (await req(`/api/portal/access?campusId=${campus.id}`, { cookie: a.cookie })).json();
  assert.ok(!JSON.stringify(accesses).includes("tokenHash"), "l'empreinte du jeton ne doit pas sortir");
  const idAlice = accesses.find((x) => x.subjectId === alice.id && !x.revokedAt).id;
  await req(`/api/portal/access/${idAlice}`, { method: "DELETE", ...opts });
  assert.equal((await portal("/api/portal/me")).status, 401);
});

test("ancrage émargement : empreinte publiée, journal consultable, cloisonné", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Ancrage" } })).json();
  const classe = await (await req("/api/classes", { method: "POST", ...opts, json: { campusId: campus.id, name: "BTS Anc" } })).json();
  const l = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom: "Anc", prenom: "Test" } })).json();
  await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027", classId: classe.id } });
  const s = await (await req("/api/sessions", { method: "POST", ...opts, json: { campusId: campus.id, classId: classe.id, date: "2026-09-28", start: "09:00", end: "12:00" } })).json();
  const sheet = await (await req(`/api/sessions/${s.id}/attendance`, { method: "POST", ...opts, json: {} })).json();
  const locked = await (await req(`/api/attendance/sheets/${sheet.id}/lock`, { method: "POST", ...opts, json: {} })).json();

  // Ancrage : l'empreinte publiée est bien celle de la tête de chaîne
  const r = await (await req("/api/attendance/anchors", { method: "POST", ...opts, json: {} })).json();
  const mine = r.results.find((x) => x.campusId === campus.id);
  assert.ok(mine, "le campus doit être ancré");
  assert.equal(mine.hash, locked.hash);
  assert.equal(mine.count, 1);

  // Le journal d'ancrage est consultable et daté
  const anchors = await (await req(`/api/attendance/anchors?campusId=${campus.id}`, { cookie: a.cookie })).json();
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].hash, locked.hash);
  assert.ok(anchors[0].at);

  // L'attestation mentionne l'ancrage
  const proof = await (await req(`/api/attendance/proof?campusId=${campus.id}&from=2026-09-01&to=2026-09-30`, { cookie: a.cookie })).text();
  assert.match(proof, /Ancrages externes/);

  // Cloisonnement : un directeur hors périmètre ne voit ni n'ancre
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await req(`/api/attendance/anchors?campusId=${campus.id}`, { cookie: d.cookie })).status, 403);
  assert.equal((await req("/api/attendance/anchors", { method: "POST", cookie: d.cookie, csrf: d.csrf, json: {} })).status, 403);
});

test("bulletins de classe : une requête, rangs cohérents, cloisonnée", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const opts = { cookie: a.cookie, csrf: a.csrf };
  const campus = await (await req("/api/campuses", { method: "POST", ...opts, json: { name: "Campus Bulletins" } })).json();
  const cur = await (await req("/api/curricula", { method: "POST", ...opts, json: { name: "BTS B", modules: [{ code: "U1", label: "Optique", coefficient: 2 }] } })).json();
  const classe = await (await req("/api/classes", { method: "POST", ...opts, json: { campusId: campus.id, name: "BTS B1", curriculumId: cur.id } })).json();
  const eleves = [];
  for (const [nom, note] of [["Alpha", 18], ["Beta", 10], ["Gamma", 18]]) {
    const l = await (await req("/api/learners", { method: "POST", ...opts, json: { campusId: campus.id, nom, prenom: "E" } })).json();
    await req(`/api/learners/${l.id}/enrollments`, { method: "POST", ...opts, json: { schoolYear: "2026-2027", classId: classe.id } });
    eleves.push({ l, note });
  }
  const ev = await (await req("/api/assessments", { method: "POST", ...opts, json: { campusId: campus.id, classId: classe.id, label: "DS", moduleId: cur.modules[0].id, maxScore: 20 } })).json();
  await req(`/api/assessments/${ev.id}/grades`, { method: "PATCH", ...opts, json: { entries: eleves.map((e) => ({ learnerId: e.l.id, score: e.note })) } });

  // UNE seule requête renvoie toute la classe, triée, avec les rangs
  const data = await (await req(`/api/classes/${classe.id}/reports`, { cookie: a.cookie })).json();
  assert.equal(data.reports.length, 3);
  assert.equal(data.className, "BTS B1");
  assert.equal(data.reports[0].average, 18);
  // Ex aequo : même rang, et le rang 2 est consommé
  const rangs = data.reports.map((r) => r.rank);
  assert.deepEqual(rangs, [1, 1, 3]);
  // Les noms sont joints (la vue n'a plus à faire d'appel supplémentaire)
  assert.ok(data.reports.every((r) => r.nom && r.prenom));

  // Cohérence avec le bulletin individuel
  const solo = await (await req(`/api/learners/${eleves[1].l.id}/report`, { cookie: a.cookie })).json();
  assert.equal(solo.average, 10);
  assert.equal(solo.rank, 3);

  // Cloisonnement
  const d = await login("dir@test.co", "pw12345678");
  assert.equal((await req(`/api/classes/${classe.id}/reports`, { cookie: d.cookie })).status, 403);
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

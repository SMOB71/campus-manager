// Licence appliquée par le serveur réel. Deux instances sont démarrées côte à
// côte — une licence expirée, une licence saine au plafond — parce que l'état de
// licence est fixé au démarrage par le .env : c'est le seul moyen honnête de
// vérifier ce que voit vraiment un client.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_BASE = {
  DATA_KEY: "test_key_throwaway_0123456789", SESSION_SECRET: "test_secret",
  OPENAI_API_KEY: "sk-test", ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678",
  NODE_ENV: "test",
};

const instances = [];
async function demarrer(nom, port, licence) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `ac-lic-${nom}-`));
  const srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, ...ENV_BASE, ...licence, DATA_DIR: dir, PORT: String(port) },
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    try { const r = await fetch(base + "/health"); if (r.ok) break; } catch { /* pas prêt */ }
    if (Date.now() > deadline) throw new Error(`instance ${nom} non démarrée`);
    await new Promise((r) => setTimeout(r, 150));
  }
  const inst = { base, srv, dir };
  instances.push(inst);
  return inst;
}

function readCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return jar;
}
async function connecter(inst) {
  const res = await fetch(inst.base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.co", password: "pw12345678" }),
  });
  const jar = readCookies(res);
  return { status: res.status, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };
}
const appel = (inst, s, chemin, { method = "GET", json } = {}) => fetch(inst.base + chemin, {
  method,
  headers: { Cookie: s.cookie, "X-CSRF-Token": s.csrf, ...(json ? { "Content-Type": "application/json" } : {}) },
  body: json ? JSON.stringify(json) : undefined,
});

const PORT = 3900 + (process.pid % 60);
let expiree, plafonnee;

before(async () => {
  expiree = await demarrer("exp", PORT, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2020-01-01", LICENCE_CLIENT: "CFA Test" });
  plafonnee = await demarrer("cap", PORT + 1, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2099-01-01" });
});
after(() => {
  for (const i of instances) { try { i.srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(i.dir, { recursive: true, force: true }); }
});

test("licence expirée : les écritures sont fermées (423)", async () => {
  const s = await connecter(expiree);
  assert.equal(s.status, 200, "on doit pouvoir se connecter à une instance expirée — sinon les données sont inatteignables");
  const r = await appel(expiree, s, "/api/campuses", { method: "POST", json: { name: "Nouveau campus" } });
  assert.equal(r.status, 423);
  const b = await r.json();
  assert.equal(b.code, "licence_lecture_seule");
  assert.match(b.error, /consultables et exportables/);
});

test("licence expirée : consultation ET export restent ouverts", async () => {
  // C'est l'engagement de fond : un organisme doit pouvoir sortir ses pièces
  // — émargements, contrats, factures — même impayé, même résilié.
  const s = await connecter(expiree);
  for (const chemin of ["/api/campuses", "/api/learners", "/api/contracts", "/api/invoices", "/api/audit", "/api/export/learners", "/api/export/network"]) {
    const r = await appel(expiree, s, chemin);
    assert.notEqual(r.status, 423, `${chemin} ne doit jamais être fermé par la licence`);
    assert.ok(r.status < 400, `${chemin} → ${r.status}`);
  }
});

test("licence expirée : /api/licence dit l'état et ne cache rien", async () => {
  const s = await connecter(expiree);
  const l = await (await appel(expiree, s, "/api/licence")).json();
  assert.equal(l.lectureSeule, true);
  assert.equal(l.expiree, true);
  assert.equal(l.client, "CFA Test");
  assert.equal(l.exportToujoursPossible, true);
  assert.ok(Array.isArray(l.quotas) && l.quotas.length >= 3);
});

test("plan Essentiel : plafond campus appliqué, avec un motif lisible", async () => {
  const s = await connecter(plafonnee);
  const l = await (await appel(plafonnee, s, "/api/licence")).json();
  assert.equal(l.lectureSeule, false);
  assert.equal(l.plan, "essentiel");

  // On amène l'instance AU plafond avant d'éprouver le refus : sans cela, le
  // test pourrait passer par la branche « ça marche » et ne rien vérifier.
  let campus = await (await appel(plafonnee, s, "/api/campuses")).json();
  if (!campus.length) {
    const c = await appel(plafonnee, s, "/api/campuses", { method: "POST", json: { name: "Campus initial" } });
    assert.equal(c.status, 200, "le premier campus du plan Essentiel doit passer");
    campus = await (await appel(plafonnee, s, "/api/campuses")).json();
  }
  assert.equal(campus.length, 1, "le plan Essentiel autorise exactement 1 campus");

  const r = await appel(plafonnee, s, "/api/campuses", { method: "POST", json: { name: "Campus de trop" } });
  assert.equal(r.status, 402, "402 Payment Required : c'est un plafond commercial, pas une erreur technique");
  const b = await r.json();
  assert.equal(b.code, "quota_atteint");
  assert.match(b.error, /Essentiel/);
  assert.match(b.error, /données existantes restent accessibles/);

  // Et le refus n'a rien créé au passage.
  const apres = await (await appel(plafonnee, s, "/api/campuses")).json();
  assert.equal(apres.length, 1);
});

test("plan Essentiel : les apprenants restent créables tant que le plafond n'est pas atteint", async () => {
  const s = await connecter(plafonnee);
  const campus = await (await appel(plafonnee, s, "/api/campuses")).json();
  const campusId = campus[0]?.id;
  assert.ok(campusId, "il faut un campus pour inscrire un apprenant");
  const r = await appel(plafonnee, s, "/api/learners", { method: "POST", json: { campusId, nom: "Test", prenom: "Quota" } });
  assert.equal(r.status, 200, "300 places au plan Essentiel : le premier apprenant ne doit pas être bloqué");
});

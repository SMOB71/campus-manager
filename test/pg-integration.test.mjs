// Le serveur RÉEL sur PostgreSQL, du démarrage au redémarrage.
//
// C'est le seul test qui prouve ce que le chantier promet : que l'application
// complète fonctionne sur la nouvelle persistance, et surtout que les données
// SURVIVENT à un redémarrage. Le magasin fichier donnait cette garantie
// gratuitement ; en base, elle se vérifie.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_TEST = process.env.DATABASE_URL_TEST;
const PORT = 3960 + (process.pid % 30);
const BASE = `http://127.0.0.1:${PORT}`;
const SCHEMA = "t" + String(process.pid).padStart(6, "0");

let srv = null;
const ENV = {
  DATA_KEY: "test_key_throwaway_0123456789", SESSION_SECRET: "test_secret",
  OPENAI_API_KEY: "sk-test", ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678",
  NODE_ENV: "test", PORT: String(PORT), DB_SCHEMA: SCHEMA,
};

async function demarrer() {
  srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, ...ENV, DATABASE_URL: URL_TEST, DATA_DIR: `/tmp/pgint-${SCHEMA}` },
  });
  const limite = Date.now() + 30000;
  for (;;) {
    try { const r = await fetch(BASE + "/health"); if (r.ok) return; } catch { /* pas prêt */ }
    if (Date.now() > limite) throw new Error("serveur non démarré sur PostgreSQL");
    await new Promise((r) => setTimeout(r, 200));
  }
}
const arreter = () => new Promise((res) => {
  if (!srv) return res();
  srv.once("exit", res); srv.kill("SIGKILL"); srv = null;
});

function jar(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const j = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); j[kv.slice(0, i)] = kv.slice(i + 1); }
  return j;
}
async function connecter() {
  const res = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@test.co", password: "pw12345678" }) });
  const j = jar(res);
  return { cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join("; "), csrf: j.ac_csrf };
}
const appel = (s, chemin, { method = "GET", json } = {}) => fetch(BASE + chemin, {
  method, headers: { Cookie: s.cookie, "X-CSRF-Token": s.csrf, ...(json ? { "Content-Type": "application/json" } : {}) },
  body: json ? JSON.stringify(json) : undefined,
});

const siBase = (nom, fn) => test(nom, { skip: URL_TEST ? false : "DATABASE_URL_TEST absent" }, fn);

before(async () => { if (URL_TEST) await demarrer(); });
after(async () => { await arreter(); });

siBase("le serveur démarre sur PostgreSQL et l'application répond", async () => {
  const s = await connecter();
  assert.ok(s.cookie, "connexion impossible");
  assert.equal((await appel(s, "/api/campuses")).status, 200);
});

siBase("LES DONNÉES SURVIVENT AU REDÉMARRAGE — c'est tout l'objet du chantier", async () => {
  const s = await connecter();
  const campus = await (await appel(s, "/api/campuses", { method: "POST", json: { name: "Campus Durable" } })).json();
  const l = await (await appel(s, "/api/learners", { method: "POST", json: { campusId: campus.id, nom: "Survit", prenom: "Au redémarrage" } })).json();
  await appel(s, `/api/learners/${l.id}`, { method: "PATCH", json: { telephone: "0699887766", ine: "INE-DURABLE" } });

  // Redémarrage complet : le cache mémoire est perdu, seule la base subsiste.
  await arreter();
  await demarrer();

  const s2 = await connecter();
  const campusApres = await (await appel(s2, "/api/campuses")).json();
  assert.ok(campusApres.find((c) => c.id === campus.id), "le campus n'a pas survécu");

  const apprenant = await (await appel(s2, `/api/learners/${l.id}`)).json();
  assert.equal(apprenant.nom, "Survit");
  // La mise à jour EN PLACE est le cas qu'une détection par référence perdrait.
  assert.equal(apprenant.telephone, "0699887766", "mise à jour en place perdue au redémarrage");
  assert.equal(apprenant.ine, "INE-DURABLE");
});

siBase("une suppression est durable, elle aussi", async () => {
  const s = await connecter();
  const campus = await (await appel(s, "/api/campuses", { method: "POST", json: { name: "Campus Éphémère" } })).json();
  const l = await (await appel(s, "/api/learners", { method: "POST", json: { campusId: campus.id, nom: "Parti", prenom: "Vite" } })).json();
  assert.equal((await appel(s, `/api/learners/${l.id}`, { method: "DELETE" })).status, 200);

  await arreter();
  await demarrer();
  const s2 = await connecter();
  assert.equal((await appel(s2, `/api/learners/${l.id}`)).status, 404, "l'apprenant supprimé est revenu au redémarrage");
});

siBase("la réponse n'est envoyée qu'une fois l'écriture confirmée", async () => {
  // Sans cette garantie, un arrêt entre la réponse et la confirmation perdrait
  // une donnée que le client croit enregistrée. On le vérifie sans laisser au
  // serveur le temps de faire quoi que ce soit d'autre : réponse, puis coupure
  // immédiate, puis relecture.
  const s = await connecter();
  const campus = await (await appel(s, "/api/campuses", { method: "POST", json: { name: "Campus Sans Répit" } })).json();
  assert.ok(campus.id);
  await arreter();
  await demarrer();
  const s2 = await connecter();
  const liste = await (await appel(s2, "/api/campuses")).json();
  assert.ok(liste.find((c) => c.id === campus.id), "donnée acquittée puis perdue — la durabilité n'est pas garantie");
});

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
import { createHmac } from "node:crypto";

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
const WHSEC = "whsec_integration_0123456789";
let expiree, plafonnee, abonnee;

before(async () => {
  expiree = await demarrer("exp", PORT, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2020-01-01", LICENCE_CLIENT: "CFA Test" });
  plafonnee = await demarrer("cap", PORT + 1, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2099-01-01" });
  abonnee = await demarrer("sub", PORT + 2, {
    LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2026-01-01",
    STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_RESEAU: "price_res",
  });
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

// ---------- Webhook Stripe ----------

function envoyerWebhook(inst, evenement, { secret = WHSEC, ts = null } = {}) {
  const brut = JSON.stringify(evenement);
  const horodatage = ts ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${horodatage}.${brut}`, "utf8").digest("hex");
  return fetch(inst.base + "/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${horodatage},v1=${sig}` },
    body: brut,
  });
}
const abonnement = (over = {}) => ({
  id: "sub_int", status: "active", customer: "cus_int",
  current_period_end: 2_000_000_000, cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_res" } }] }, ...over,
});

test("webhook : sans signature valide, rien n'est appliqué", async () => {
  // Le webhook n'a ni session ni jeton CSRF : sa seule authentification est la
  // signature. Si elle ne tenait pas, n'importe qui prolongerait sa licence.
  const evenement = { id: "evt_faux", type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), data: { object: abonnement() } };

  const sans = await fetch(abonnee.base + "/api/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evenement),
  });
  assert.equal(sans.status, 400);

  const mauvaisSecret = await envoyerWebhook(abonnee, evenement, { secret: "whsec_pirate" });
  assert.equal(mauvaisSecret.status, 400);

  // Signature juste mais horodatage ancien : c'est la forme d'un rejeu.
  const rejeu = await envoyerWebhook(abonnee, evenement, { ts: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(rejeu.status, 400);

  const s = await connecter(abonnee);
  const l = await (await appel(abonnee, s, "/api/licence")).json();
  assert.equal(l.plan, "essentiel", "aucune de ces tentatives ne doit avoir changé le plan");
  assert.equal(l.validUntil, "2026-01-01");
});

test("webhook signé : la licence suit l'abonnement, et l'événement n'agit qu'une fois", async () => {
  const evenement = {
    id: "evt_int_1", type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000), data: { object: abonnement() },
  };
  const r = await envoyerWebhook(abonnee, evenement);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).applique, true);

  const s = await connecter(abonnee);
  const l = await (await appel(abonnee, s, "/api/licence")).json();
  assert.equal(l.plan, "reseau", "l'état persisté doit primer sur le plan du .env");
  assert.equal(l.validUntil, "2033-05-18");
  assert.equal(l.lectureSeule, false, "l'instance était expirée au démarrage : l'abonnement la remet en écriture");

  // Stripe réémet tant qu'il n'a pas de 2xx : le doublon doit être sans effet.
  const bis = await envoyerWebhook(abonnee, evenement);
  assert.equal(bis.status, 200);
  const b = await bis.json();
  assert.equal(b.applique, false);
  assert.match(b.motif, /déjà appliqué/);
});

test("webhook : une résiliation ferme l'écriture mais laisse lire et exporter", async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await envoyerWebhook(abonnee, {
    id: "evt_int_2", type: "customer.subscription.deleted", created: now,
    data: { object: abonnement({ status: "canceled" }) },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).applique, true);

  const s = await connecter(abonnee);
  const l = await (await appel(abonnee, s, "/api/licence")).json();
  assert.equal(l.suspendue, true);
  assert.equal(l.lectureSeule, true);

  const ecriture = await appel(abonnee, s, "/api/campuses", { method: "POST", json: { name: "Après résiliation" } });
  assert.equal(ecriture.status, 423);

  for (const chemin of ["/api/campuses", "/api/learners", "/api/export/learners"]) {
    const lecture = await appel(abonnee, s, chemin);
    assert.ok(lecture.status < 400, `${chemin} doit rester ouvert après résiliation → ${lecture.status}`);
  }
});

// ---------- Contournements de quota ----------
// Un plafond qui ne tient que sur le formulaire de création unitaire ne tient
// pas : les chemins par lesquels on dépasse réellement sont l'import en masse
// et la conversion d'une candidature.

test("import en masse : le plafond tient, et les lignes refusées sont nommées", async () => {
  const petite = await demarrer("imp", PORT + 3, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2099-01-01" });
  const s = await connecter(petite);
  let campus = await (await appel(petite, s, "/api/campuses")).json();
  if (!campus.length) {
    await appel(petite, s, "/api/campuses", { method: "POST", json: { name: "Campus import" } });
    campus = await (await appel(petite, s, "/api/campuses")).json();
  }
  const cid = campus[0].id;

  // 305 lignes valides sur un plan à 300 places.
  const lignes = ["nom;prenom;date_naissance"];
  for (let i = 1; i <= 305; i++) lignes.push(`Nom${i};Prenom${i};01/01/2005`);
  const fd = new FormData();
  fd.append("file", new Blob([lignes.join("\n")], { type: "text/csv" }), "apprenants.csv");
  const r = await fetch(petite.base + `/api/campuses/${cid}/learners/import`, {
    method: "POST", headers: { Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: fd,
  });
  assert.equal(r.status, 200);
  const rapport = await r.json();

  assert.equal(rapport.created, 300, "on importe jusqu'au plafond, pas au-delà");
  assert.equal(rapport.plafondAtteint, true, "le rapport doit le DIRE — « 300 créés » seul se lirait comme un succès");
  const refusees = rapport.skipped.filter((x) => /plafond/.test(x.motif));
  assert.equal(refusees.length, 5, "chaque ligne refusée est nommée, on sait lesquelles reprendre");
  assert.ok(refusees[0].ligne, "avec son numéro de ligne");

  // Le plafond est bien atteint, pas dépassé.
  const l = await (await appel(petite, s, "/api/licence")).json();
  const q = l.quotas.find((x) => x.cle === "apprenants");
  assert.equal(q.utilise, 300);
  assert.equal(q.depasse, true);

  // Et un second import ne fait plus rien passer.
  const fd2 = new FormData();
  fd2.append("file", new Blob(["nom;prenom\nAutre;Personne"], { type: "text/csv" }), "b.csv");
  const r2 = await fetch(petite.base + `/api/campuses/${cid}/learners/import`, {
    method: "POST", headers: { Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: fd2,
  });
  assert.equal((await r2.json()).created, 0);
});

test("conversion d'une candidature : refusée au plafond, mais un rattachement reste permis", async () => {
  const inst = await demarrer("cand", PORT + 4, { LICENCE_PLAN: "essentiel", LICENCE_VALID_UNTIL: "2099-01-01" });
  const s = await connecter(inst);
  let campus = await (await appel(inst, s, "/api/campuses")).json();
  if (!campus.length) {
    await appel(inst, s, "/api/campuses", { method: "POST", json: { name: "Campus cand" } });
    campus = await (await appel(inst, s, "/api/campuses")).json();
  }
  const cid = campus[0].id;

  // Un apprenant déjà au dossier, qu'une candidature homonyme viendra rattacher.
  const dejaLa = await (await appel(inst, s, "/api/learners", { method: "POST", json: { campusId: cid, nom: "Dupont", prenom: "Lea" } })).json();
  assert.ok(dejaLa.id);

  // On sature le plafond.
  const lignes = ["nom;prenom"];
  for (let i = 1; i <= 299; i++) lignes.push(`Rempl${i};Place${i}`);
  const fd = new FormData();
  fd.append("file", new Blob([lignes.join("\n")], { type: "text/csv" }), "c.csv");
  await fetch(inst.base + `/api/campuses/${cid}/learners/import`, {
    method: "POST", headers: { Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: fd,
  });
  const q = (await (await appel(inst, s, "/api/licence")).json()).quotas.find((x) => x.cle === "apprenants");
  assert.equal(q.utilise, 300, "plafond atteint");

  // Une candidature homonyme : elle RATTACHE, ne crée rien, donc elle passe.
  const cRattache = await (await appel(inst, s, "/api/candidates", { method: "POST", json: { campusId: cid, nom: "Dupont", prenom: "Lea" } })).json();
  assert.ok(cRattache.id, "candidature créée");
  const rr = await appel(inst, s, `/api/candidates/${cRattache.id}/convert`, { method: "POST", json: {} });
  assert.equal(rr.status, 200, "un rattachement ne consomme pas de place : il ne doit pas être refusé");
  assert.equal((await rr.json()).learnerCreated, false);

  // Une candidature inconnue, elle, créerait un dossier : refusée, avec le motif.
  const cNouveau = await (await appel(inst, s, "/api/candidates", { method: "POST", json: { campusId: cid, nom: "Inconnu", prenom: "Total" } })).json();
  const rn = await appel(inst, s, `/api/candidates/${cNouveau.id}/convert`, { method: "POST", json: {} });
  assert.equal(rn.status, 402);
  const b = await rn.json();
  assert.equal(b.code, "quota_atteint");
  assert.match(b.error, /Essentiel/);
});

test("ouverture → campus : la création automatique respecte aussi le plafond", async () => {
  const s = await connecter(plafonnee);
  const campus = await (await appel(plafonnee, s, "/api/campuses")).json();
  assert.equal(campus.length, 1, "plan Essentiel déjà au plafond de campus");

  const o = await (await appel(plafonnee, s, "/api/openings", { method: "POST", json: { name: "Projet Lyon", city: "Lyon" } })).json();
  assert.ok(o.id);
  const r = await appel(plafonnee, s, `/api/openings/${o.id}/convert`, { method: "POST", json: {} });
  assert.equal(r.status, 402, "un projet qui ouvre ne doit pas créer un campus hors plafond");

  const apres = await (await appel(plafonnee, s, "/api/campuses")).json();
  assert.equal(apres.length, 1, "aucun campus n'a été créé au passage");
});

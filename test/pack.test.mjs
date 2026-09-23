// Pack documentaire d'ouverture — ce qui doit rester vrai.
//
// Ces tests ne regardent pas la mise en page : ils vérifient que les fichiers
// produits sont de VRAIS fichiers Office, que le contenu vient du plan et non
// d'un gabarit, et que les trois pièges déjà payés ne reviennent pas —
// l'atterrissage mesuré sur les actions d'après la rentrée, la marge inconnue
// confondue avec une marge nulle, et le budget qui dérive à l'arrondi.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerServeur } from "./_serveur.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "ac-pack-"));
let BASE = "", srv, A = null, ouvertureId = null;

const req = (p, { method = "GET", cookie = "", csrf = "", json } = {}) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + p, { method, headers, body, redirect: "manual" });
};
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });

// Un fichier Office est un zip dont la première entrée commence par « PK ».
// Le vérifier interdit le faux positif le plus courant : une réponse d'erreur
// JSON renvoyée avec le bon type MIME.
const estZip = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;

before(async () => {
  const r = await demarrerServeur({
    ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789",
    SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test",
    ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", NODE_ENV: "test",
  });
  srv = r.enfant; BASE = r.base;
  const res = await req("/api/login", { method: "POST", json: { email: "admin@test.co", password: "pw12345678" } });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  A = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };
  const o = await (await post("/api/openings", { name: "Lille", targetDate: "2027-09-01", dureeMois: 11, budget: 1240000 })).json();
  ouvertureId = o.id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("le plan d'ouverture se traduit sans perdre ni inventer d'action", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const taches = buildOpeningTasks("2027-09-01", {}, 11);
  const { projet, plan } = planOuverture({ id: "o", name: "Lille", targetDate: "2027-09-01", budget: 1240000 },
    taches, { aujourdhui: "2026-10-05" });
  assert.equal(plan.taches.length, taches.length, "aucune action ne doit disparaître à la traduction");
  assert.equal(plan.resume.critiques.length, taches.filter((t) => t.critical).length);
  assert.ok(plan.resume.jalons.length >= 15, "les jalons du modèle doivent être repris");
  // Les jalons sont DÉCLARÉS par le modèle. La version qui prenait « la dernière
  // action de chaque lot » donnait « Surveillance des ruptures de contrat » comme
  // jalon de clôture : chronologiquement vrai, absurde en comité.
  assert.ok(plan.resume.jalons.some((j) => /ARRÊTÉ D'OUVERTURE DU MAIRE/i.test(j.titre)));
  assert.ok(plan.resume.jalons.some((j) => /Pré-rentrée/i.test(j.titre)));
  assert.ok(plan.resume.jalons.every((j, i, a) => !i || j.date >= a[i - 1].date), "les jalons sortent triés");
  assert.ok(projet.risques.length >= 5 && projet.instances.length >= 3 && projet.trames.length >= 2,
    "les registres par défaut d'une ouverture doivent être posés");
});

test("une marge inconnue n'est pas une marge nulle", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 0 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  const connues = plan.taches.map((t) => t.margeTotale).filter((v) => v != null);
  assert.ok(plan.taches.some((t) => t.margeTotale == null), "certaines actions n'ont rien en aval");
  assert.ok(Math.min(...connues) > 0, "le modèle garde un matelas : aucune marge connue n'est nulle");
  assert.equal(plan.resume.margeMin, Math.min(...connues));
});

test("l'atterrissage se mesure sur la rentrée, pas sur les soldes de décembre", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 0 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  assert.ok(plan.resume.apresRentree > 0, "le modèle porte des actions postérieures à la rentrée");
  assert.ok(plan.resume.finTotale > plan.fin, "elles vont plus loin que la rentrée");
  assert.equal(plan.fin, "2027-09-01", "la fin annoncée reste la rentrée");
});

test("le budget réparti par chantier retombe à l'euro sur l'enveloppe votée", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 1240000 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  const somme = plan.taches.reduce((s, t) => s + t.budgetPrevu, 0);
  // Une part égale arrondie faisait sortir 1 240 001 € : un euro suffit à faire
  // douter du reste du document.
  assert.equal(somme, 1240000);
});

test("le pack liste ce qu'il contient avant de le produire", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack?inventaire=1`);
  assert.equal(r.status, 200);
  const { pieces } = await r.json();
  assert.ok(pieces.length >= 9, `pack maigre : ${pieces.length} pièces`);
  for (const t of ["docx", "pptx", "xlsx"]) assert.ok(pieces.some((p) => p.ext === t), `aucun ${t} annoncé`);
  assert.ok(pieces.every((p) => p.nom && p.quoi && p.dossier), "chaque pièce dit ce qu'elle est");
});

test("chaque pièce se télécharge seule, et c'est un vrai fichier Office", async () => {
  const { pieces } = await (await get(`/api/openings/${ouvertureId}/pack?inventaire=1`)).json();
  for (const p of pieces) {
    const r = await get(`/api/openings/${ouvertureId}/pack/${p.cle}`);
    assert.equal(r.status, 200, `${p.cle} : ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(estZip(buf), `${p.cle} n'est pas un fichier Office`);
    assert.ok(buf.length > 8000, `${p.cle} pèse ${buf.length} octets — trop peu pour porter un plan`);
    assert.match(r.headers.get("content-disposition") || "", /attachment; filename=/);
  }
});

test("une clé inconnue est refusée, pas servie vide", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack/inexistant`);
  assert.equal(r.status, 404);
});

test("le zip complet porte le sommaire et toutes les pièces annoncées", async () => {
  const { pieces } = await (await get(`/api/openings/${ouvertureId}/pack?inventaire=1`)).json();
  const r = await get(`/api/openings/${ouvertureId}/pack`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(estZip(buf));
  // On lit le répertoire central du zip plutôt que sa taille : une archive
  // tronquée pèse lourd elle aussi, et s'ouvre à moitié sans prévenir.
  const noms = [];
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      const n = buf.readUInt16LE(i + 28);
      noms.push(buf.slice(i + 46, i + 46 + n).toString("utf8"));
      i += 45 + n;
    }
  }
  assert.ok(noms.includes("SOMMAIRE.txt"), "le zip doit dire ce qu'il contient");
  assert.equal(noms.length, pieces.length + 1, `zip incomplet : ${noms.length - 1} pièces pour ${pieces.length} annoncées`);
  assert.ok(noms.some((n) => n.endsWith(".pptx")) && noms.some((n) => n.endsWith(".xlsx")));
});

test("le pack est réservé aux administrateurs", async () => {
  const r = await req(`/api/openings/${ouvertureId}/pack`);
  assert.ok(r.status === 401 || r.status === 403, `statut ${r.status}`);
});

test("une ouverture inexistante ne produit pas d'archive vide", async () => {
  const r = await get("/api/openings/pas-un-id/pack");
  assert.equal(r.status, 404);
});

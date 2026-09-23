// De la note de cadrage au dossier de projet — bout en bout.
//
// La chaîne que ces tests tiennent : un document Word entre, un projet sort
// avec ses actions et ses registres, et les documents du pack cessent de dire
// « à renseigner ». Avec deux garde-fous : rien n'entre sans validation, et
// rien de déjà renseigné n'est remplacé en silence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { extractText } from "../lib/extract.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "", srv, A = null;
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-cadrage-"));

function req(p, { method = "GET", cookie = "", csrf = "", json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + p, { method, headers, body, redirect: "manual" });
}
function readCookies(res) {
  const jar = {};
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
    const [kv] = c.split(";"); const i = kv.indexOf("=");
    jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return jar;
}
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });
const jget = async (p) => (await get(p)).json();

let campusId = null;
const NOTE = `# Note de cadrage — Dématérialisation des dossiers

Commanditaire : Direction générale
Sponsor : Mme Ribeiro
Pilote : Claire Meunier
Budget : 350 k€

## Contexte
Les dossiers papier occupent deux pièces et se perdent à chaque déménagement.

## Objectif
Supprimer le papier sur la chaîne d'inscription avant la rentrée 2027.

## Hors périmètre
Les archives antérieures à 2020 restent en carton.

## Chantiers

### Numérisation
- Recenser les dossiers — resp. Marc — 2 semaines
- Numériser le fonds — 30 j

### Outillage
- Choisir la solution — échéance : 2027-02-15

## Jalons
- Bascule — 2027-06-30
- Bilan — quand ce sera calme

## Risques
- Les dossiers de 2019 sont illisibles — impact : élevé

## Indicateurs
- Dossiers dématérialisés — 100 %
`;

before(async () => {
  const r = await demarrerServeur({
    ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789",
    SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test",
    ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", NODE_ENV: "test",
  });
  srv = r.enfant; BASE = r.base;
  const res = await req("/api/login", { method: "POST", json: { email: "admin@test.co", password: "pw12345678" } });
  const jar = readCookies(res);
  A = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };
  campusId = (await (await post("/api/campuses", { name: "Campus Test" })).json()).id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("ANALYSE — la note est lue, et ce qu'elle ne dit pas est dit", async () => {
  const r = await post("/api/projets/cadrage/analyser", { texte: NOTE });
  assert.equal(r.status, 200);
  const { proposition: p, taches } = await r.json();
  assert.equal(p.source, "structure");        // aucune IA sollicitée sur une note structurée
  assert.equal(p.iaUtilisee, false);
  assert.equal(p.champs.nom, "Dématérialisation des dossiers");
  assert.equal(p.champs.budget, 350000);
  assert.equal(p.champs.sponsor, "Mme Ribeiro");
  assert.match(p.champs.horsPerimetre, /antérieures à 2020/);
  assert.ok(p.absent.includes("perimetre"));   // la note n'a pas de rubrique périmètre
  assert.ok(p.datesNonLues.includes("Bilan")); // « quand ce sera calme » n'est pas une date
  // Le jalon daté entre dans le plan, l'autre non.
  const jalons = taches.filter((t) => t.jalon);
  assert.equal(jalons.length, 1);
  assert.equal(jalons[0].contrainte.date, "2027-06-30");
  // Les durées écrites sont converties et tracées.
  assert.equal(taches.find((t) => /Recenser/.test(t.titre)).dureeJours, 10);
  assert.equal(taches.find((t) => /Choisir/.test(t.titre)).dureeDeduite, true);
});

test("ANALYSE — une note trop courte est refusée, pas devinée", async () => {
  const r = await post("/api/projets/cadrage/analyser", { texte: "refonte" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /trop courte/);
});

test("CRÉATION — le projet sort avec ses actions, ses chantiers et ses registres", async () => {
  const { proposition, taches } = await (await post("/api/projets/cadrage/analyser", { texte: NOTE })).json();
  const r = await post("/api/projets/cadrage/appliquer", { proposition, taches, campusId });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.projet.nom, "Dématérialisation des dossiers");
  assert.equal(out.projet.budget, 350000);
  assert.equal(out.projet.risques.length, 1);
  assert.equal(out.projet.kpis.length, 1);
  assert.ok(out.taches >= 5);

  const d = await jget(`/api/projets/${out.projet.id}`);
  assert.equal(d.ok, true, "le plan issu de la note doit être calculable");
  // Les chantiers sont devenus des regroupements, avec leurs actions dessous.
  const num = d.taches.find((t) => t.titre === "Numérisation");
  assert.equal(num.synthese, true);
  assert.equal(d.taches.find((t) => /Recenser/.test(t.titre)).parentId, num.id);
  // L'échéance écrite dans la note est devenue une vraie échéance.
  assert.equal(d.taches.find((t) => /Choisir/.test(t.titre)).echeance, "2027-02-15");
});

test("LE DOCUMENT NE DIT PLUS « À RENSEIGNER » — c'est tout l'objet", async () => {
  const { proposition, taches } = await (await post("/api/projets/cadrage/analyser", { texte: NOTE })).json();
  const out = await (await post("/api/projets/cadrage/appliquer", { proposition, taches, campusId })).json();
  const doc = await get(`/api/projets/${out.projet.id}/pack/note-cadrage`);
  assert.equal(doc.status, 200);
  const buf = Buffer.from(await doc.arrayBuffer());
  // La lecture .docx est celle que l'application utilise pour avaler une note :
  // ce test la couvre donc aussi.
  const texte = await extractText(buf, "note.docx");
  assert.match(texte, /Dématérialisation des dossiers/);
  assert.match(texte, /Mme Ribeiro/);
  assert.match(texte, /Direction générale/);
  assert.match(texte, /deux pièces/);
  assert.match(texte, /antérieures à 2020/);
  // Le périmètre, absent de la note, reste marqué comme tel : on ne comble pas.
  assert.match(texte, /à renseigner/);
});

test("ENRICHISSEMENT — rien de déjà renseigné n'est remplacé en silence", async () => {
  const p0 = await (await post("/api/projets", { nom: "Déjà cadré", campusId, objectif: "Objectif arbitré en comité" })).json();
  const { proposition, taches } = await (await post("/api/projets/cadrage/analyser", { texte: NOTE })).json();

  const r = await (await post("/api/projets/cadrage/appliquer", { proposition, taches: [], projetId: p0.projet.id })).json();
  assert.equal(r.taches, 0);
  assert.ok(r.conflits.some((c) => c.cle === "objectif"), "le conflit doit être signalé");
  let d = await jget(`/api/projets/${p0.projet.id}`);
  assert.equal(d.projet.objectif, "Objectif arbitré en comité");   // intact
  assert.equal(d.projet.budget, 350000);                            // le vide, lui, se remplit

  // Remplacer est possible, mais c'est une décision explicite.
  await post("/api/projets/cadrage/appliquer", { proposition, taches: [], projetId: p0.projet.id, ecraser: true });
  d = await jget(`/api/projets/${p0.projet.id}`);
  assert.match(d.projet.objectif, /Supprimer le papier/);
});

test("CHOIX — seules les rubriques retenues entrent", async () => {
  const { proposition } = await (await post("/api/projets/cadrage/analyser", { texte: NOTE })).json();
  const out = await (await post("/api/projets/cadrage/appliquer", {
    proposition, taches: [], campusId, nom: "Partiel", choix: ["budget", "risques"],
  })).json();
  assert.equal(out.projet.budget, 350000);
  assert.equal(out.projet.risques.length, 1);
  assert.equal(out.projet.contexte || "", "");
  assert.equal(out.projet.sponsor || "", "");
});

test("SANS NOM — on ne baptise pas un projet à la place de l'utilisateur", async () => {
  const r = await post("/api/projets/cadrage/appliquer", {
    proposition: { champs: { nom: "" }, registres: {} }, taches: [], campusId,
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ne donne pas de nom/);
});

test("PÉRIMÈTRE — appliquer est réservé à l'administrateur", async () => {
  await post("/api/users", { email: "dir3@test.co", password: "pw12345678", name: "Dir", role: "directeur", campusIds: [campusId] });
  const res = await req("/api/login", { method: "POST", json: { email: "dir3@test.co", password: "pw12345678" } });
  const jar = readCookies(res);
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const r = await req("/api/projets/cadrage/appliquer", {
    method: "POST", cookie, csrf: jar.ac_csrf,
    json: { proposition: { champs: { nom: "X" }, registres: {} }, taches: [], campusId },
  });
  assert.equal(r.status, 403);
  // La lecture, elle, reste ouverte : analyser n'écrit rien.
  const a = await req("/api/projets/cadrage/analyser", { method: "POST", cookie, csrf: jar.ac_csrf, json: { texte: NOTE } });
  assert.equal(a.status, 200);
});

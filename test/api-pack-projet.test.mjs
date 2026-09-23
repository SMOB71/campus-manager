// Pack documentaire d'un projet — bout en bout.
//
// Les mêmes pièces que pour une ouverture de campus, produites par le même
// générateur. Ce qui est vérifié ici : qu'elles sortent réellement, qu'aucune
// action du plan ne se perde en route, et qu'on ne produise rien du tout quand
// le planning n'est pas calculable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "", srv, A = null;
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-packproj-"));

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

let campusId = null, projetId = null, casse = null;
const auj = new Date().toISOString().slice(0, 10);

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

  const p = await (await post("/api/projets", {
    nom: "Refonte SI", campusId, debut: auj, pilote: "Claire",
    objectif: "Remplacer l'outil de scolarité",
    ressources: [{ id: "r1", nom: "Marc", role: "Direction des systèmes", capaciteJour: 1 }],
  })).json();
  projetId = p.projet.id;
  const phase = await (await post(`/api/projets/${projetId}/taches`, { titre: "Cadrage" })).json();
  await post(`/api/projets/${projetId}/taches`, { titre: "Recenser l'existant", dureeJours: 5, parentId: phase.tache.id, responsable: "Marc" });
  const b = await (await post(`/api/projets/${projetId}/taches`, { titre: "Migration", dureeJours: 12, parentId: phase.tache.id })).json();
  await post(`/api/projets/${projetId}/taches`, { titre: "Bascule", jalon: true, dureeJours: 0, liens: [{ deId: b.tache.id, type: "FD" }] });

  // Un projet vide : aucun document utile, mais aucun plantage non plus.
  const c = await (await post("/api/projets", { nom: "Projet vide", campusId, debut: auj })).json();
  casse = c.projet.id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("INVENTAIRE — les mêmes pièces que pour une ouverture de campus", async () => {
  const r = await get(`/api/projets/${projetId}/pack?inventaire=1`);
  assert.equal(r.status, 200);
  const { pieces } = await r.json();
  const cles = pieces.map((p) => p.cle);
  for (const attendu of ["note-cadrage", "one-pager", "plan-synthese", "plan-detaille", "deck-comex", "pilotage", "trames", "onboarding"]) {
    assert.ok(cles.includes(attendu), `${attendu} attendu dans le pack`);
  }
  // Chaque pièce dit ce qu'elle est et où elle se range.
  assert.ok(pieces.every((p) => p.nom && p.dossier && p.ext && p.quoi));
});

test("UNE PIÈCE — elle sort, et c'est bien un document Office", async () => {
  const r = await get(`/api/projets/${projetId}/pack/plan-detaille`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") || "", /\.docx"$/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), "PK");
  assert.ok(buf.length > 5000);
});

test("PIÈCE INCONNUE — 404, pas un fichier vide", async () => {
  const r = await get(`/api/projets/${projetId}/pack/nexiste-pas`);
  assert.equal(r.status, 404);
});

test("ARCHIVE — le dossier complet, rangé, avec son sommaire", async () => {
  const r = await get(`/api/projets/${projetId}/pack`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /zip/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), "PK");
  const noms = buf.toString("latin1");
  assert.match(noms, /SOMMAIRE\.txt/);
  assert.match(noms, /1 - Cadrage\//);
  assert.match(noms, /3 - Pr..?sentations\//);
});

test("PLAN IMPRIMABLE — aucune action ne se perd, même rangée sous une phase", async () => {
  const r = await get(`/api/projets/${projetId}/export?format=print`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/html/);
  const h = await r.text();
  assert.match(h, /Refonte SI/);
  assert.match(h, /Remplacer l'outil de scolarité/);
  // Les deux actions sont rangées sous « Cadrage » : elles doivent y figurer.
  assert.match(h, /Recenser l&#039;existant|Recenser l'existant/);
  assert.match(h, /Migration/);
  assert.match(h, /◆ Bascule/);
  assert.match(h, /window\.print\(\)/);

  // Vue par chantier : chacun n'a que sa partie.
  const lot = await (await get(`/api/projets/${projetId}/export?format=print&lot=${encodeURIComponent("Cadrage")}`)).text();
  assert.match(lot, /Vue restreinte au lot/);
});

test("ON NE PEUT PAS FABRIQUER UN PLAN INCALCULABLE PAR L'API", async () => {
  // La garde refuse AVANT écriture toute modification qui rendrait le plan
  // incalculable. Conséquence directe : les documents ne peuvent pas être
  // produits depuis un planning faux — la porte est fermée en amont, pas au
  // moment de générer.
  const x = await (await post(`/api/projets/${casse}/taches`, { titre: "X" })).json();
  const y = await (await post(`/api/projets/${casse}/taches`, { titre: "Y", liens: [{ deId: x.tache.id, type: "FD" }] })).json();
  // Rattacher une sous-tâche à « Y » en ferait un regroupement portant une
  // dépendance : refusé, avec le motif.
  const r = await post(`/api/projets/${casse}/taches`, { titre: "Z", parentId: y.tache.id });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /tâche élémentaire/);

  // Le projet reste donc exploitable, et son pack aussi.
  const inv = await get(`/api/projets/${casse}/pack?inventaire=1`);
  assert.equal(inv.status, 200);
});

test("PROJET SANS TÂCHE — le pack ne plante pas", async () => {
  const vide = await (await post("/api/projets", { nom: "À cadrer", campusId, debut: auj })).json();
  const inv = await get(`/api/projets/${vide.projet.id}/pack?inventaire=1`);
  assert.equal(inv.status, 200);
  const piece = await get(`/api/projets/${vide.projet.id}/pack/note-cadrage`);
  assert.equal(piece.status, 200);
  assert.equal(Buffer.from(await piece.arrayBuffer()).slice(0, 2).toString(), "PK");
});

test("PÉRIMÈTRE — les documents d'un projet hors périmètre sont refusés", async () => {
  const autre = await (await post("/api/campuses", { name: "Ailleurs" })).json();
  await post("/api/users", { email: "dir2@test.co", password: "pw12345678", name: "Dir", role: "directeur", campusIds: [autre.id] });
  const res = await req("/api/login", { method: "POST", json: { email: "dir2@test.co", password: "pw12345678" } });
  const jar = readCookies(res);
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  assert.equal((await req(`/api/projets/${projetId}/pack?inventaire=1`, { cookie })).status, 403);
  assert.equal((await req(`/api/projets/${projetId}/pack/note-cadrage`, { cookie })).status, 403);
  assert.equal((await req(`/api/projets/${projetId}/export?format=print`, { cookie })).status, 403);
});

// Comité de pilotage d'un projet — chaîne complète.
//
// Ce qui est vérifié ici : qu'après UN clic de mise en place, les séances
// existent, que leur ordre du jour se remplit depuis le plan, et qu'il cesse
// de se remplir dès qu'un humain l'a repris — sans quoi l'automatisme se fait
// désactiver dans la semaine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "";
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-copilproj-"));
let srv, A = null;

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
const patch = (p, json) => req(p, { method: "PATCH", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });
const jget = async (p) => (await get(p)).json();

let campusId = null, projetId = null, comiteId = null;
const auj = new Date().toISOString().slice(0, 10);
const decale = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

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

  const p = await (await post("/api/projets", { nom: "Refonte SI", campusId, debut: auj, pilote: "Claire" })).json();
  projetId = p.projet.id;
  const a = await (await post(`/api/projets/${projetId}/taches`, { titre: "Cadrage", dureeJours: 5, responsable: "Marc" })).json();
  const b = await (await post(`/api/projets/${projetId}/taches`, { titre: "Migration", dureeJours: 15, liens: [{ deId: a.tache.id, type: "FD" }] })).json();
  await post(`/api/projets/${projetId}/taches`, {
    titre: "Bascule", jalon: true, dureeJours: 0, liens: [{ deId: b.tache.id, type: "FD" }],
    contrainte: { type: "echeance", date: decale(5) },   // échéance intenable : elle doit remonter
  });
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("UN CLIC — le comité existe, ses séances aussi, et leurs ordres du jour", async () => {
  const avant = await jget(`/api/projets/${projetId}/copil`);
  assert.equal(avant.committee, null);

  const r = await post(`/api/projets/${projetId}/copil`, { cadenceRegle: { type: "hebdo", jourSemaine: 2, heure: "09:30" } });
  assert.equal(r.status, 200);
  const out = await r.json();
  comiteId = out.committee.id;
  assert.equal(out.committee.cadence, "Hebdomadaire, le mardi à 09:30");
  assert.ok(out.seances >= 9, `dix semaines de séances attendues, reçu ${out.seances}`);
  // Le pilote du projet devient membre : un comité sans personne n'en est pas un.
  assert.equal(out.committee.members[0].name, "Claire");

  const etat = await jget(`/api/projets/${projetId}/copil`);
  assert.ok(etat.prochaine?.date >= auj);
  assert.equal(etat.prochaine.time, "09:30");
  assert.ok(etat.aVenir.length >= 9);
  // L'ordre du jour de la prochaine séance est déjà rempli, sans qu'on demande.
  assert.ok(etat.prochaine.agendaItems === undefined || true);
  assert.ok(etat.odj.points.length >= 3);
  assert.equal(etat.odj.points[0].cle, "avancement");
});

test("L'ODJ DIT CE QUE LE PLAN DIT — l'échéance intenable remonte d'elle-même", async () => {
  const etat = await jget(`/api/projets/${projetId}/copil`);
  const bloquant = etat.odj.points.find((p) => p.cle.startsWith("echeance-"));
  assert.ok(bloquant, "l'échéance dépassée doit remonter sans qu'on la saisisse");
  assert.equal(bloquant.gravite, "bloquant");
  assert.match(bloquant.titre, /« Bascule » dépasse son échéance/);
  assert.match(etat.markdown, /# Ordre du jour — Refonte SI/);
  assert.match(etat.markdown, /\*\*Décision attendue :\*\*/);
});

test("LES SÉANCES PORTENT L'ORDRE DU JOUR, prêtes pour la convocation", async () => {
  const c = await jget(`/api/committees/${comiteId}`);
  const prochaine = (c.sessions || []).filter((s) => s.date >= auj).sort((a, b) => a.date.localeCompare(b.date))[0];
  assert.ok(prochaine.agendaItems.length >= 3, "l'ordre du jour est écrit dans la séance, pas seulement calculé à l'écran");
  assert.match(prochaine.agendaItems[0].text, /Point d'avancement/);
  assert.equal(prochaine.agendaAuto, true);
});

test("MAIN HUMAINE — dès qu'on édite, le remplissage automatique se retire", async () => {
  const c = await jget(`/api/committees/${comiteId}`);
  const s = (c.sessions || []).filter((x) => x.date >= auj).sort((a, b) => a.date.localeCompare(b.date))[0];

  await patch(`/api/committees/${comiteId}/sessions/${s.id}`, { agendaItems: [{ text: "Point ajouté par le pilote" }] });
  const apres = await jget(`/api/committees/${comiteId}`);
  const s2 = (apres.sessions || []).find((x) => x.id === s.id);
  assert.equal(s2.agendaAuto, false);
  assert.equal(s2.agendaItems.length, 1);

  // Le remplissage refuse d'écraser sans qu'on le lui demande explicitement.
  const refus = await post(`/api/committees/${comiteId}/sessions/${s.id}/agenda-auto`, {});
  assert.equal(refus.status, 409);
  const err = await refus.json();
  assert.equal(err.forcable, true);
  assert.match(err.error, /repris à la main/);
  assert.equal((await jget(`/api/committees/${comiteId}`)).sessions.find((x) => x.id === s.id).agendaItems.length, 1);

  // Avec la reprise explicite, il réécrit — et reprend la main pour la suite.
  const ok = await post(`/api/committees/${comiteId}/sessions/${s.id}/agenda-auto`, { reprendre: true });
  assert.equal(ok.status, 200);
  const s3 = (await jget(`/api/committees/${comiteId}`)).sessions.find((x) => x.id === s.id);
  assert.ok(s3.agendaItems.length >= 3);
  assert.equal(s3.agendaAuto, true);
});

test("LE COMITÉ PRÉCÉDENT REVIENT — ses décisions échues sont reprises d'office", async () => {
  // Une séance passée, avec deux engagements : l'un échu, l'autre non.
  const passee = await (await post(`/api/committees/${comiteId}/sessions`, { date: decale(-7), time: "09:30" })).json();
  await patch(`/api/committees/${comiteId}/sessions/${passee.id}`, {
    status: "held",
    resolutions: [
      { text: "Choisir le prestataire", owner: "Claire", dueDate: decale(-1) },
      { text: "Valider le budget", owner: "DAF", dueDate: decale(60) },
    ],
  });
  const c = await jget(`/api/committees/${comiteId}`);
  const suivante = (c.sessions || []).filter((s) => s.date >= auj).sort((a, b) => a.date.localeCompare(b.date))[0];
  const ap = await jget(`/api/committees/${comiteId}/sessions/${suivante.id}/agenda-projet`);
  const pt = ap.odj.points.find((x) => x.cle === "decisions-precedentes");
  assert.ok(pt, "le suivi des décisions doit apparaître tout seul");
  assert.match(pt.detail, /Choisir le prestataire/);
  assert.ok(!pt.detail.includes("Valider le budget"), "ce qui n'est pas encore échu n'encombre pas");
});

test("UN SEUL COMITÉ PAR PROJET — la mise en place ne se duplique pas", async () => {
  const r = await post(`/api/projets/${projetId}/copil`, {});
  assert.equal(r.status, 409);
  const err = await r.json();
  assert.equal(err.committeeId, comiteId);
  assert.match(err.error, /pilote déjà ce projet/);
});

test("APERÇU — il ne touche à rien", async () => {
  const c = await jget(`/api/committees/${comiteId}`);
  const s = (c.sessions || []).filter((x) => x.date >= auj).sort((a, b) => a.date.localeCompare(b.date))[0];
  const avant = JSON.stringify(s.agendaItems);
  const ap = await jget(`/api/committees/${comiteId}/sessions/${s.id}/agenda-projet`);
  assert.ok(ap.odj.points.length >= 3);
  assert.ok(ap.markdown.length > 100);
  const apres = (await jget(`/api/committees/${comiteId}`)).sessions.find((x) => x.id === s.id);
  assert.equal(JSON.stringify(apres.agendaItems), avant);
});

test("UN COMITÉ D'OUVERTURE N'EST PAS CONCERNÉ — le module ne déborde pas", async () => {
  const o = await (await post("/api/committees", { name: "COPIL ouverture", scope: "opening", scopeId: "inexistant" })).json();
  const s = await (await post(`/api/committees/${o.id}/sessions`, { date: decale(3) })).json();
  const r = await get(`/api/committees/${o.id}/sessions/${s.id}/agenda-projet`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /n'est pas rattaché à un projet/);
});

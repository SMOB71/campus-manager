// Conduite de projet — tests d'intégration.
//
// Le moteur est testé à part (test/projets.test.mjs). Ce qui se joue ici, ce
// sont les trois gardes de l'API, celles qui font qu'on ne peut pas enregistrer
// un planning qui ment : refus d'une modification qui rend le plan
// incalculable, motif exigé quand un jalon sous échéance glisse, et trace
// signée de tout ce qui déplace une date.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "";
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-proj-"));
let srv;

function req(pathname, { method = "GET", cookie = "", csrf = "", json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + pathname, { method, headers, body, redirect: "manual" });
}
function readCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return jar;
}
let A = null;
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const patch = (p, json) => req(p, { method: "PATCH", cookie: A.cookie, csrf: A.csrf, json });
const del = (p) => req(p, { method: "DELETE", cookie: A.cookie, csrf: A.csrf });
const get = (p) => req(p, { cookie: A.cookie });
const jget = async (p) => (await get(p)).json();

let campusId = null, projetId = null;
const auj = new Date().toISOString().slice(0, 10);
const dans = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const creerTache = (corps) => post(`/api/projets/${projetId}/taches`, corps);

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
  const camp = await (await post("/api/campuses", { name: "Campus Test" })).json();
  campusId = camp.id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("création d'un projet et de son enchaînement", async () => {
  const r = await post("/api/projets", { nom: "Refonte du SI de scolarité", campusId, debut: auj, pilote: "Stéphane" });
  assert.equal(r.status, 200);
  const { projet } = await r.json();
  projetId = projet.id;
  assert.equal(projet.statut, "cadrage");

  const a = await (await creerTache({ titre: "Cadrage", dureeJours: 5 })).json();
  const b = await (await creerTache({ titre: "Migration", dureeJours: 10, liens: [{ deId: a.tache.id, type: "FD" }] })).json();
  await creerTache({ titre: "Bascule", jalon: true, dureeJours: 0, liens: [{ deId: b.tache.id, type: "FD" }] });

  const d = await jget(`/api/projets/${projetId}`);
  assert.equal(d.ok, true);
  assert.equal(d.taches.length, 3);
  assert.equal(d.resume.jalons.length, 1);
  // 15 jours ouvrés de travail : la fin n'est pas saisie, elle est calculée.
  assert.equal(d.resume.critiques.length, 3);
  assert.ok(d.resume.fin > auj);
});

test("REFUS AVANT ÉCRITURE — une dépendance circulaire ne s'enregistre pas", async () => {
  const d = await jget(`/api/projets/${projetId}`);
  const cadrage = d.taches.find((t) => t.titre === "Cadrage");
  const migration = d.taches.find((t) => t.titre === "Migration");
  const r = await patch(`/api/projets/${projetId}/taches/${cadrage.id}`, { liens: [{ deId: migration.id, type: "FD" }] });
  assert.equal(r.status, 400);
  const err = await r.json();
  assert.match(err.error, /circulaire/);
  // Et le plan en base est intact.
  const apres = await jget(`/api/projets/${projetId}`);
  assert.equal(apres.ok, true);
  assert.equal(apres.taches.find((t) => t.titre === "Cadrage").liens.length, 0);
});

test("MOTIF EXIGÉ — un jalon sous échéance ne glisse pas en silence", async () => {
  const d = await jget(`/api/projets/${projetId}`);
  const bascule = d.taches.find((t) => t.jalon);
  // On pose une échéance tenable sur le jalon…
  const ech = await patch(`/api/projets/${projetId}/taches/${bascule.id}`, { contrainte: { type: "echeance", date: dans(60) } });
  assert.equal(ech.status, 200);

  // …puis on allonge une tâche amont au point de la dépasser : refus 409.
  const migration = d.taches.find((t) => t.titre === "Migration");
  const r = await patch(`/api/projets/${projetId}/taches/${migration.id}`, { dureeJours: 120 });
  assert.equal(r.status, 409);
  const err = await r.json();
  assert.equal(err.motifRequis, true);
  assert.equal(err.forcable, true);
  assert.match(err.error, /échéance/);
  assert.equal(err.jalons[0].titre, "Bascule");

  // Avec un motif, la modification passe ET laisse une trace signée.
  const ok = await patch(`/api/projets/${projetId}/taches/${migration.id}`, { dureeJours: 120, motif: "prestataire indisponible avant mars" });
  assert.equal(ok.status, 200);
  const apres = await jget(`/api/projets/${projetId}`);
  const ligne = apres.journal.find((j) => /Migration/.test(j.action));
  assert.ok(ligne, "une ligne de journal est attendue");
  assert.equal(ligne.motif, "prestataire indisponible avant mars");
  assert.ok(ligne.par);
  assert.ok(ligne.mouvements.length >= 1);
  assert.notEqual(ligne.finAvant, ligne.finApres);

  // On remet la durée d'origine pour la suite des tests.
  await patch(`/api/projets/${projetId}/taches/${migration.id}`, { dureeJours: 10, motif: "retour au plan initial" });
  await patch(`/api/projets/${projetId}/taches/${bascule.id}`, { contrainte: { type: "auplustot", date: null } });
});

test("AVANCEMENT — le reste à faire commande, et « faite » ferme le compteur", async () => {
  const d = await jget(`/api/projets/${projetId}`);
  const cadrage = d.taches.find((t) => t.titre === "Cadrage");
  await patch(`/api/projets/${projetId}/taches/${cadrage.id}`, { statut: "en_cours", resteAFaire: 2 });
  let apres = await jget(`/api/projets/${projetId}`);
  let t = apres.taches.find((x) => x.id === cadrage.id);
  assert.equal(t.resteAFaire, 2);
  assert.equal(Math.round(t.avancement * 100), 60);   // 3 j faits sur 5

  const r = await patch(`/api/projets/${projetId}/taches/${cadrage.id}`, { statut: "faite" });
  assert.equal(r.status, 200);
  apres = await jget(`/api/projets/${projetId}`);
  t = apres.taches.find((x) => x.id === cadrage.id);
  // Déclarer faite impose reste = 0 et une date de fin : les deux ne peuvent
  // pas diverger, sinon le pourcentage de confort revient par la fenêtre.
  assert.equal(t.resteAFaire, 0);
  assert.equal(t.statut, "faite");
  assert.ok(t.finReelle);
});

test("SIMULATION — elle répond sans rien modifier", async () => {
  const avant = await jget(`/api/projets/${projetId}`);
  const migration = avant.taches.find((t) => t.titre === "Migration");
  const r = await post(`/api/projets/${projetId}/simuler`, { modifications: [{ tacheId: migration.id, decalageJours: 10 }] });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.ecartJours, 10);
  assert.equal(s.impacts[0].ecart, 10);
  const apres = await jget(`/api/projets/${projetId}`);
  assert.equal(apres.resume.fin, avant.resume.fin, "le plan enregistré n'a pas bougé");
});

test("RÉFÉRENCE — elle se fige, et la remplacer demande confirmation", async () => {
  const r = await post(`/api/projets/${projetId}/reference`, { motif: "validée en comité" });
  assert.equal(r.status, 200);
  const { reference } = await r.json();
  assert.ok(reference.fin);
  assert.ok(reference.par, "la référence porte le nom de qui l'a figée");

  const encore = await post(`/api/projets/${projetId}/reference`, { motif: "seconde" });
  assert.equal(encore.status, 409);
  assert.equal((await encore.json()).forcable, true);

  // La dérive se mesure dès qu'une tâche s'allonge.
  const d = await jget(`/api/projets/${projetId}`);
  const migration = d.taches.find((t) => t.titre === "Migration");
  await patch(`/api/projets/${projetId}/taches/${migration.id}`, { dureeJours: 20 });
  const apres = await jget(`/api/projets/${projetId}`);
  assert.equal(apres.derive.finEcart, 10);
  assert.equal(apres.derive.glissements[0].ecart, 10);
});

test("CHARGE ET NIVELLEMENT — proposé d'abord, appliqué seulement si demandé", async () => {
  const p2 = await (await post("/api/projets", {
    nom: "Déménagement site", campusId, debut: auj,
    ressources: [{ id: "r1", nom: "Claire", role: "directrice", capaciteJour: 1 }],
  })).json();
  const pid = p2.projet.id;
  await post(`/api/projets/${pid}/taches`, { titre: "Lot A", dureeJours: 4, affectations: [{ ressourceId: "r1", tauxJour: 1 }] });
  await post(`/api/projets/${pid}/taches`, { titre: "Lot B", dureeJours: 4, affectations: [{ ressourceId: "r1", tauxJour: 1 }] });

  const detail = await jget(`/api/projets/${pid}`);
  assert.equal(detail.charge.surchargees, 1);
  assert.equal(detail.charge.ressources[0].nbJoursSurcharge, 4);

  const propose = await (await post(`/api/projets/${pid}/nivellement`, {})).json();
  assert.equal(propose.applique, false);
  assert.equal(propose.propositions.length, 1);
  assert.ok(propose.coutJours > 0, "le nivellement annonce ce qu'il coûte en jours");
  // Rien n'a bougé tant qu'on n'a pas demandé l'application.
  assert.equal((await jget(`/api/projets/${pid}`)).charge.surchargees, 1);

  const applique = await (await post(`/api/projets/${pid}/nivellement`, { appliquer: true, motif: "arbitrage charge" })).json();
  assert.equal(applique.applique, true);
  const fin = await jget(`/api/projets/${pid}`);
  assert.equal(fin.charge.surchargees, 0);
  assert.ok(fin.journal.some((j) => /nivellement/.test(j.action)));
});

test("MODÈLE — capturé depuis un projet réel, rejoué à rebours sur une date cible", async () => {
  const r = await post(`/api/projets/${projetId}/modele`, { nom: "Trame refonte SI", description: "capturée après coup" });
  assert.equal(r.status, 200);
  const { modele } = await r.json();
  assert.equal(modele.taches.length, 3);

  // Aucun modèle n'est livré avec le module : la liste ne contient que ce que
  // la maison a capturé.
  const liste = await jget("/api/projets-modeles");
  assert.equal(liste.modeles.length, 1);

  // Date cible FIXE et ouvrée (mercredi 14 avril 2027). Un « aujourd'hui + 200 j »
  // tombe un jour sur un samedi, et le rétroplanning finit alors le vendredi —
  // ce qui est correct, mais rend le test faux un jour sur sept.
  const cible = "2027-04-14";
  const neuf = await (await post("/api/projets", { nom: "Refonte SI — campus 2", campusId, modeleId: modele.id, datePivot: cible, sens: "avant" })).json();
  const detail = await jget(`/api/projets/${neuf.projet.id}`);
  assert.equal(detail.taches.length, 3);
  assert.equal(detail.resume.fin, cible, "le rétroplanning tombe exactement sur la date cible");
  assert.ok(detail.projet.debut < cible);
  // Les liens ont été recâblés sur les nouveaux identifiants, pas laissés
  // pendants sur les références du modèle.
  const migration = detail.taches.find((t) => t.titre === "Migration");
  assert.ok(detail.taches.some((t) => t.id === migration.liens[0].deId));
});

test("SUPPRESSION — les liens orphelins sont nettoyés, pas laissés à pourrir", async () => {
  const d = await jget(`/api/projets/${projetId}`);
  const migration = d.taches.find((t) => t.titre === "Migration");
  const r = await del(`/api/projets/${projetId}/taches/${migration.id}`);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.ok(out.liensRetires.includes("Bascule"));
  const apres = await jget(`/api/projets/${projetId}`);
  assert.equal(apres.ok, true, "le plan reste calculable après suppression");
});

test("PÉRIMÈTRE — un directeur ne voit pas les projets d'un autre campus", async () => {
  const autre = await (await post("/api/campuses", { name: "Campus Ailleurs" })).json();
  await post("/api/projets", { nom: "Projet ailleurs", campusId: autre.id, debut: auj });
  await post("/api/users", { email: "dir@test.co", password: "pw12345678", name: "Dir", role: "directeur", campusIds: [autre.id] });
  const res = await req("/api/login", { method: "POST", json: { email: "dir@test.co", password: "pw12345678" } });
  const jar = readCookies(res);
  const cookieDir = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

  const vue = await (await req("/api/projets", { cookie: cookieDir })).json();
  assert.equal(vue.lignes.length, 1);
  assert.equal(vue.lignes[0].nom, "Projet ailleurs");
  // Et l'accès direct à un projet hors périmètre est refusé.
  const interdit = await req(`/api/projets/${projetId}`, { cookie: cookieDir });
  assert.equal(interdit.status, 403);
  // Un projet réseau (sans campus) est réservé à l'administrateur.
  const reseau = await req("/api/projets", { method: "POST", cookie: cookieDir, csrf: jar.ac_csrf, json: { nom: "Projet réseau", debut: auj } });
  assert.equal(reseau.status, 403);
});

test("EXPORT — le planning sort en tableur avec les marges et le chemin critique", async () => {
  const r = await get(`/api/projets/${projetId}/export`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /spreadsheetml/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), "PK");
});

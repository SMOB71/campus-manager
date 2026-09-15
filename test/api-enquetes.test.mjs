// Enquêtes, bout en bout : ouverture, réponse hors session, anonymat, seuil de
// restitution. Le point vérifié ici que rien d'autre ne peut vérifier :
// l'ABSENCE de lien entre une réponse et son auteur, jusque dans le store.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "";
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-enq-"));
let srv, A = null;

function req(p, { method = "GET", cookie = "", csrf = "", json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + p, { method, headers, body, redirect: "manual" });
}
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });
const jget = async (p) => (await get(p)).json();

let campusId = null, classId = null, learners = [];

before(async () => {
  const r = await demarrerServeur({
    ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789",
    SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test",
    ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", NODE_ENV: "test",
  });
  srv = r.enfant; BASE = r.base;
  const lr = await req("/api/login", { method: "POST", json: { email: "admin@test.co", password: "pw12345678" } });
  const set = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  A = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };

  campusId = (await (await post("/api/campuses", { name: "CFA Enquête" })).json()).id;
  const cur = await (await post("/api/curricula", { name: "BTS OL", modules: [{ code: "M1", label: "Optique", heuresSemaine: 20 }] })).json();
  classId = (await (await post("/api/classes", { campusId, curriculumId: cur.id, name: "BTS1" })).json()).id;
  // Huit inscrits : assez pour franchir le seuil de restitution, et assez peu
  // pour que le seuil ait un sens.
  for (let i = 0; i < 8; i++) {
    const l = await (await post("/api/learners", { campusId, nom: `NOM${i}`, prenom: `P${i}` })).json();
    learners.push(l);
    await post(`/api/learners/${l.id}/enrollments`, { campusId, classId, statut: "inscrit", schoolYear: "2026-2027" });
  }
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("les deux types sont proposés avec leur modèle et leur indicateur", async () => {
  const m = await jget("/api/enquetes/modeles");
  const s = m.types.find((t) => t.cle === "satisfaction");
  const e = m.types.find((t) => t.cle === "enseignements");
  assert.equal(s.indicateur, 30);
  assert.equal(e.indicateur, 33);
  assert.ok(s.modele.length && e.modele.length);
  assert.equal(m.seuilRestitution, 5);
});

test("une évaluation des enseignements adressée aux financeurs est refusée", async () => {
  const r = await post("/api/enquetes", {
    campusId, type: "enseignements", titre: "Mauvais public", classId,
    publics: ["financeur"], questions: [{ id: "q1", type: "echelle", texte: "x" }],
  });
  assert.equal(r.status, 400);
});

let enqId = null, liens = [];

test("ouvrir crée une invitation par inscrit et rend les liens UNE seule fois", async () => {
  const modeles = await jget("/api/enquetes/modeles");
  const e = await (await post("/api/enquetes", {
    campusId, type: "enseignements", titre: "Évaluation des enseignements — S1", classId,
    publics: ["apprenant"], questions: modeles.types.find((t) => t.cle === "enseignements").modele,
  })).json();
  enqId = e.id;
  assert.equal(e.etat, "brouillon");

  const ouv = await (await post(`/api/enquetes/${enqId}/ouvrir`, {})).json();
  assert.equal(ouv.etat, "ouverte");
  assert.equal(ouv.invites, 8, "une invitation par inscrit actif");
  liens = ouv.liens;
  assert.equal(liens.length, 8);
  assert.ok(liens.every((l) => l.url.includes("/enquete.html?j=")));

  // Les jetons ne sont plus récupérables : seule l'empreinte est conservée.
  const relu = (await jget("/api/enquetes?campusId=" + campusId)).find((x) => x.id === enqId);
  assert.equal(JSON.stringify(relu).includes(liens[0].jeton), false,
    "un jeton en clair dans la base permettrait de répondre à la place de quelqu'un");

  // Ouvrir deux fois n'a pas de sens et ne doit pas doubler les invitations.
  assert.equal((await post(`/api/enquetes/${enqId}/ouvrir`, {})).status, 409);
});

test("le questionnaire public ne révèle rien du destinataire", async () => {
  const r = await fetch(`${BASE}/api/enquete-publique/${encodeURIComponent(liens[0].jeton)}`);
  assert.equal(r.status, 200);
  const q = await r.json();
  assert.ok(q.questions.length);
  assert.match(q.anonyme, /anonyme/i);
  const brut = JSON.stringify(q);
  assert.equal(brut.includes(liens[0].destinataireId), false);
  for (const l of learners) assert.equal(brut.includes(l.nom), false);
  // Un jeton inventé n'apprend rien non plus.
  assert.equal((await fetch(`${BASE}/api/enquete-publique/${"z".repeat(43)}`)).status, 404);
});

// LE TEST CENTRAL.
test("UNE RÉPONSE N'EST RATTACHABLE À PERSONNE, ET NE PEUT ÊTRE DONNÉE QU'UNE FOIS", async () => {
  const envoyer = (jeton, note, extra = {}) => fetch(`${BASE}/api/enquete-publique/${encodeURIComponent(jeton)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reponses: { q1: note, q7: `verbatim ${note}` }, ...extra }),
  });

  // Cinq des huit répondent — juste le seuil.
  for (let i = 0; i < 5; i++) {
    const r = await envoyer(liens[i].jeton, i + 1, { moduleId: "m1", teacherId: "t1" });
    assert.equal(r.status, 200, `réponse ${i}`);
  }
  // Le même lien ne peut pas servir deux fois : sinon un lien partagé permet de
  // voter autant de fois qu'on veut.
  assert.equal((await envoyer(liens[0].jeton, 5)).status, 409);

  const res = await jget(`/api/enquetes/${enqId}/resultats`);
  assert.equal(res.invites, 8);
  assert.equal(res.repondus, 5);
  assert.equal(res.participation, 63);
  assert.equal(res.questions.find((q) => q.id === "q1").moyenne, 3);

  // Le dépouillement ne doit contenir AUCUN identifiant de répondant.
  const brut = JSON.stringify(res);
  for (const l of learners) {
    assert.equal(brut.includes(l.id), false, "un identifiant d'apprenant dans les résultats");
    assert.equal(brut.includes(l.nom), false);
  }
  // Ni les invitations honorées, qui savent seulement QUE la personne a répondu.
  assert.equal(brut.includes(liens[0].destinataireId), false);
});

test("sous le seuil, aucun résultat nominatif n'est restitué", async () => {
  // Nouvelle enquête, deux réponses seulement sur un intervenant nommé.
  const e = await (await post("/api/enquetes", {
    campusId, type: "enseignements", titre: "Évaluation — petit effectif", classId,
    publics: ["apprenant"], questions: [{ id: "q1", type: "echelle", texte: "Rythme adapté ?" }],
  })).json();
  const ouv = await (await post(`/api/enquetes/${e.id}/ouvrir`, {})).json();
  for (let i = 0; i < 2; i++) {
    await fetch(`${BASE}/api/enquete-publique/${encodeURIComponent(ouv.liens[i].jeton)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reponses: { q1: 1 }, moduleId: "m1", teacherId: "t1" }),
    });
  }
  const res = await jget(`/api/enquetes/${e.id}/resultats`);
  const [g] = res.parEnseignement;
  assert.equal(g.repondu, 2);
  assert.equal(g.publiable, false);
  assert.equal(g.note, null);
  assert.deepEqual(g.questions, []);
  assert.match(g.motif, /identifiables/);
});

test("les questions ne changent plus une fois l'enquête ouverte", async () => {
  const r = await req(`/api/enquetes/${enqId}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { questions: [{ id: "zz", type: "libre", texte: "ajoutée après coup" }] },
  });
  assert.equal(r.status, 409);
  // Le titre, lui, reste corrigeable.
  assert.equal((await req(`/api/enquetes/${enqId}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf, json: { titre: "Titre corrigé" },
  })).status, 200);
});

test("le dispositif n'est couvert qu'une fois les retours exploités ET restitués", async () => {
  let d = await jget(`/api/enquetes/dispositif?campusId=${campusId}`);
  assert.equal(d.couvert, false);
  assert.match(JSON.stringify(d), /satisfaction/i);

  await post(`/api/enquetes/${enqId}/clore`, {});
  d = await jget(`/api/enquetes/dispositif?campusId=${campusId}`);
  const ens = d.lignes.find((l) => l.type === "enseignements");
  assert.match(ens.manques.join(" "), /mesure d'amélioration/);

  await post(`/api/enquetes/${enqId}/mesures`, { texte: "Revoir le rythme du module optique", responsable: "Dir. péda" });
  d = await jget(`/api/enquetes/dispositif?campusId=${campusId}`);
  assert.match(d.lignes.find((l) => l.type === "enseignements").manques.join(" "), /restitution aux équipes/);

  await post(`/api/enquetes/${enqId}/restitution`, { note: "Présenté en conseil pédagogique" });
  d = await jget(`/api/enquetes/dispositif?campusId=${campusId}`);
  assert.equal(d.lignes.find((l) => l.type === "enseignements").couvert, true);
  // Mais la satisfaction générale, elle, manque toujours : les deux dispositifs
  // sont distincts, l'un ne couvre pas l'autre.
  assert.equal(d.lignes.find((l) => l.type === "satisfaction").couvert, false);
  assert.equal(d.couvert, false);
});

test("la restitution aux équipes ne s'applique pas à la satisfaction générale", async () => {
  const e = await (await post("/api/enquetes", {
    campusId, type: "satisfaction", titre: "Satisfaction annuelle",
    publics: ["apprenant"], questions: [{ id: "q1", type: "echelle", texte: "Accueil" }],
  })).json();
  assert.equal((await post(`/api/enquetes/${e.id}/restitution`, {})).status, 400);
});

test("répondre exige un jeton : la route publique n'accepte rien sans lui", async () => {
  const r = await fetch(`${BASE}/api/enquete-publique/`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reponses: { q1: 5 } }),
  });
  assert.ok(r.status === 404 || r.status === 400);
});

// --- Chantier 2026 : l'écran de pilotage des trois dispositifs ---
// Ce qui est vérifié : l'écran reflète l'ÉTAT RÉEL, et ne se déclare pas prêt
// tant qu'il reste quelque chose à faire.
test("le chantier liste les trois dispositifs et compte ce qui reste", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  assert.deepEqual(d.chantiers.map((c) => c.cle), ["alternance", "qualiopi", "enquetes"]);
  assert.equal(d.bascule, "2026-11-01");
  // Chaque ligne dit la CONSÉQUENCE, pas seulement un compteur : « 0/3 »
  // n'appelle aucune action.
  for (const c of d.chantiers) assert.ok(c.enjeu && c.enjeu.length > 30, c.cle);
  assert.equal(d.pret, false);
  assert.ok(d.restants >= 1);
  assert.match(d.reserve, /ne vaut pas audit/);
});

test("une classe sans rythme est comptée comme telle, et une classe en initial est sans objet", async () => {
  // La classe créée plus haut est en « initial » : le rythme ne la concerne pas.
  let d = await jget(`/api/chantier?campusId=${campusId}`);
  let alt = d.chantiers.find((c) => c.cle === "alternance");
  assert.equal(alt.sansObjet, true);
  assert.equal(alt.concernees, 0);

  // On passe la classe en alternance : elle devient un chantier ouvert.
  await req(`/api/classes/${classId}`, { method: "PATCH", cookie: A.cookie, csrf: A.csrf, json: { modalite: "alternance" } });
  d = await jget(`/api/chantier?campusId=${campusId}`);
  alt = d.chantiers.find((c) => c.cle === "alternance");
  assert.equal(alt.sansObjet, false);
  assert.equal(alt.concernees, 1);
  assert.equal(alt.faites, 0);
  assert.equal(alt.fait, false);
  assert.equal(alt.detail[0].rythme, null);
  assert.match(alt.enjeu, /18 semaines/);

  // Poser le rythme referme la ligne — c'est l'état réel qui est lu, pas un drapeau.
  const r = await post("/api/schedule/rythme/apply", {
    classId, debut: "2026-09-14", fin: "2027-06-30", centre: 2, entreprise: 2,
  });
  assert.equal(r.status, 200);
  d = await jget(`/api/chantier?campusId=${campusId}`);
  alt = d.chantiers.find((c) => c.cle === "alternance");
  assert.equal(alt.fait, true);
  assert.equal(alt.faites, 1);
  assert.match(alt.detail[0].rythme, /2 sem\. centre/);
});

test("la ligne Qualiopi porte l'échéance et ce qu'il y a à reprendre, puis se referme", async () => {
  let d = await jget(`/api/chantier?campusId=${campusId}`);
  let q = d.chantiers.find((c) => c.cle === "qualiopi");
  assert.equal(q.version, "v2019");
  assert.equal(q.fait, false);
  assert.equal(q.aRefaire, 16);
  assert.deepEqual(q.nouveaux, [16, 29, 33]);
  assert.match(q.enjeu, /renumérotés/);
  assert.ok(q.alerte, "l'échéance doit être portée tant que la bascule n'est pas faite");

  await post(`/api/campuses/${campusId}/qualiopi/bascule`, {});
  d = await jget(`/api/chantier?campusId=${campusId}`);
  q = d.chantiers.find((c) => c.cle === "qualiopi");
  assert.equal(q.fait, true);
  assert.equal(q.version, "v2026");
  assert.equal(q.alerte, null);
});

test("le chantier n'est prêt que lorsque les trois lignes le sont", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  // Alternance et Qualiopi sont faits ; les enquêtes, non — la satisfaction
  // générale n'a jamais été exploitée.
  assert.equal(d.chantiers.find((c) => c.cle === "alternance").fait, true);
  assert.equal(d.chantiers.find((c) => c.cle === "qualiopi").fait, true);
  assert.equal(d.chantiers.find((c) => c.cle === "enquetes").fait, false);
  assert.equal(d.restants, 1);
  assert.equal(d.pret, false, "un seul dispositif manquant suffit à ne pas être prêt");
});

test("un campus inconnu, ou hors périmètre, ne renvoie pas un chantier vide et rassurant", async () => {
  assert.equal((await get("/api/chantier?campusId=inexistant")).status, 404);
});

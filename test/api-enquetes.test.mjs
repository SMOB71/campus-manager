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
test("le chantier liste tous les dispositifs et compte ce qui reste", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  assert.deepEqual(d.chantiers.map((c) => c.cle),
    ["alternance", "qualiopi", "enquetes", "certification", "insertion", "distance", "documents"]);
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

test("le chantier n'est prêt que lorsque TOUTES les lignes le sont", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  // Alternance et Qualiopi sont faits ; les enquêtes, non — la satisfaction
  // générale n'a jamais été exploitée. Certification et insertion non plus :
  // rien n'y est encore déclaré à ce stade du scénario.
  assert.equal(d.chantiers.find((c) => c.cle === "alternance").fait, true);
  assert.equal(d.chantiers.find((c) => c.cle === "qualiopi").fait, true);
  assert.equal(d.chantiers.find((c) => c.cle === "enquetes").fait, false);
  // `restants` compte exactement les lignes ni faites ni sans objet : c'est le
  // seul chiffre de l'écran, il ne doit pas dériver quand on ajoute un chantier.
  const attendu = d.chantiers.filter((c) => !c.fait && !c.sansObjet).length;
  assert.equal(d.restants, attendu);
  assert.ok(d.restants >= 1);
  assert.equal(d.pret, false, "un seul dispositif manquant suffit à ne pas être prêt");
});

test("un campus inconnu, ou hors périmètre, ne renvoie pas un chantier vide et rassurant", async () => {
  assert.equal((await get("/api/chantier?campusId=inexistant")).status, 404);
});

// --- Indicateurs 16 et 29, bout en bout ---
test("sans certification déclarée, le chantier ne conclut pas que tout va bien", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  const c = d.chantiers.find((x) => x.cle === "certification");
  assert.equal(c.total, 0);
  assert.equal(c.fait, false, "rien de déclaré n'est pas la même chose que rien à signaler");
  assert.match(c.enjeu, /on ne sait pas/);
});

test("une habilitation sans date de fin est refusée à la création", async () => {
  const curricula = await jget("/api/curricula");
  const r = await post("/api/certifications", {
    campusId, curriculumId: curricula[0].id,
    habilitation: { regime: "habilitation", certificateur: "Ministère X", reference: "H-1" },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /date de fin/);
});

let certifId = null;

test("une habilitation qui expire avant l'épreuve bloque la session, et remonte au chantier", async () => {
  const curricula = await jget("/api/curricula");
  const c = await (await post("/api/certifications", {
    campusId, curriculumId: curricula[0].id,
    habilitation: {
      regime: "habilitation", certificateur: "Ministère X", reference: "H-1",
      dateDebut: "2024-01-01", dateFin: "2027-03-31",
      exigences: [{ id: "e1", libelle: "Livret de suivi visé" }],
    },
  })).json();
  certifId = c.id;

  // Épreuve en juin, habilitation jusqu'en mars.
  const avecSession = await (await post(`/api/certifications/${certifId}/sessions`, {
    dateEpreuve: "2027-06-15", dateLimiteInscription: "2027-01-10",
  })).json();
  assert.equal(avecSession.sessions.length, 1);

  const tdb = await jget(`/api/certifications?campusId=${campusId}`);
  const ligne = tdb.lignes.find((l) => l.curriculumId === curricula[0].id);
  const s = ligne.sessions[0];
  assert.equal(s.presentable, false);
  assert.ok(s.alertes.some((a) => a.code === "habilitation_expire_avant_epreuve"));
  // L'exigence du certificateur n'est pas confirmée : signalée, pas bloquante
  // tant que l'épreuve n'a pas eu lieu.
  assert.equal(s.manquantes, 1);

  const d = await jget(`/api/chantier?campusId=${campusId}`);
  const ch = d.chantiers.find((x) => x.cle === "certification");
  assert.equal(ch.total, 1);
  assert.ok(ch.bloquants >= 1);
  assert.equal(ch.fait, false);
});

test("prolonger l'habilitation referme le blocage — l'état est lu, pas stocké", async () => {
  const r = await req(`/api/certifications/${certifId}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { habilitation: {
      regime: "habilitation", certificateur: "Ministère X", reference: "H-2",
      dateDebut: "2024-01-01", dateFin: "2029-06-30",
      exigences: [{ id: "e1", libelle: "Livret de suivi visé" }],
    } },
  });
  assert.equal(r.status, 200);
  const tdb = await jget(`/api/certifications?campusId=${campusId}`);
  const s = tdb.lignes[0].sessions[0];
  assert.equal(s.alertes.some((a) => a.code === "habilitation_expire_avant_epreuve"), false);
  assert.equal(tdb.empechees, 0);
});

test("l'indicateur 29 n'est couvert que si la POURSUITE D'ÉTUDES l'est aussi", async () => {
  // Trois actions d'insertion : la voie emploi est couverte, l'autre non.
  for (const t of ["forum", "atelier_technique", "relation_entreprise"]) {
    const r = await post("/api/actions-insertion", {
      campusId, type: t, intitule: `Action ${t}`, date: "2026-05-12",
      participants: 30, resultat: "12 contrats signés",
    });
    assert.equal(r.status, 200);
  }
  let d = await jget(`/api/actions-insertion?campusId=${campusId}`);
  assert.equal(d.voies.find((v) => v.voie === "insertion").couvert, true);
  assert.equal(d.voies.find((v) => v.voie === "poursuite").couvert, false);
  assert.equal(d.couvert, false);
  assert.match(d.reserve, /pas sur le taux/);

  let ch = (await jget(`/api/chantier?campusId=${campusId}`)).chantiers.find((x) => x.cle === "insertion");
  assert.equal(ch.fait, false);
  assert.match(ch.enjeu, /POURSUITE D'ÉTUDES/);

  // Une action sur la poursuite d'études referme la ligne.
  await post("/api/actions-insertion", {
    campusId, type: "information_poursuite", intitule: "Réunion poursuite d'études",
    date: "2026-06-02", participants: 22, resultat: "8 dossiers déposés",
  });
  d = await jget(`/api/actions-insertion?campusId=${campusId}`);
  assert.equal(d.couvert, true);
  ch = (await jget(`/api/chantier?campusId=${campusId}`)).chantiers.find((x) => x.cle === "insertion");
  assert.equal(ch.fait, true);
});

test("une action sans résultat est acceptée mais signalée, et ne couvre rien seule", async () => {
  const r = await (await post("/api/actions-insertion", {
    campusId, type: "passerelle", intitule: "Partenariat sans suite", date: "2026-07-01",
  })).json();
  assert.match(r.warnings.join(" "), /ne démontre rien/);
  // Une action sans date, elle, est refusée.
  assert.equal((await post("/api/actions-insertion", { campusId, type: "forum", intitule: "x" })).status, 400);
});

test("chaque dispositif du chantier dit une conséquence, pas un compteur", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  assert.deepEqual(d.chantiers.map((c) => c.cle),
    ["alternance", "qualiopi", "enquetes", "certification", "insertion", "distance", "documents"]);
  for (const c of d.chantiers) assert.ok(c.enjeu && c.enjeu.length > 30, c.cle);
  // Le dispositif à distance est SANS OBJET tant qu'aucune séance n'est à
  // distance — et à ce stade du scénario il n'y en a aucune. Reprocher un
  // référent pédagogique pour des heures qu'on ne délivre pas serait du bruit,
  // et un « sans objet » ne compte pas comme un manque.
  const dist = d.chantiers.find((c) => c.cle === "distance");
  assert.equal(dist.seances, 0);
  assert.equal(dist.sansObjet, true);
  assert.equal(d.restants, d.chantiers.filter((c) => !c.fait && !c.sansObjet).length);
  assert.equal(dist.composantes.length, 3);
});

// --- LMS : ressources et preuve des heures à distance (indicateur 19) ---
test("une activité à distance sans durée moyenne est refusée par l'API", async () => {
  const curricula = await jget("/api/curricula");
  const mod = curricula[0].modules[0];
  const ko = await post("/api/ressources", {
    campusId, titre: "Exercice", type: "exercice", moduleId: mod.id,
    url: "https://exemple.fr/ex", aDistance: true,
  });
  assert.equal(ko.status, 400);
  assert.match((await ko.json()).error, /D\. 6313-3-1/);
  // Un lien qui n'en est pas un est refusé aussi.
  assert.equal((await post("/api/ressources", {
    campusId, titre: "x", type: "document", moduleId: mod.id, url: "javascript:alert(1)",
  })).status, 400);
});

let resDoc = null, resExo = null, seanceDistId = null, jetonEleve = null;

test("le dispositif à distance n'est pas conforme sans référent pédagogique", async () => {
  const d = await jget(`/api/lms/dispositif?campusId=${campusId}`);
  assert.equal(d.conforme, false);
  assert.match(JSON.stringify(d.manques), /indicateur 19/);
  assert.equal(d.composantes.length, 3);

  const r = await req("/api/lms/dispositif", {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { campusId, referentPedagogique: "M. Sivan", modalitesAssistance: "Courriel sous 24 h ouvrées" },
  });
  assert.equal(r.status, 200);
  // Le bloc objet doit réellement avoir été enregistré, pas silencieusement jeté.
  assert.equal((await r.json()).referentPedagogique, "M. Sivan");
  const apres = await jget(`/api/lms/dispositif?campusId=${campusId}`);
  assert.equal(apres.dispositif.referentPedagogique, "M. Sivan");
});

test("une séance devient distancielle, et le suivi la voit", async () => {
  const curricula = await jget("/api/curricula");
  const mod = curricula[0].modules[0];
  resDoc = await (await post("/api/ressources", {
    campusId, titre: "Support de cours", type: "document", moduleId: mod.id,
    url: "https://exemple.fr/support.pdf", aDistance: true, dureeMoyenneMinutes: 30, classIds: [classId],
  })).json();
  resExo = await (await post("/api/ressources", {
    campusId, titre: "Exercice à rendre", type: "exercice", moduleId: mod.id,
    url: "https://exemple.fr/exo", aDistance: true, dureeMoyenneMinutes: 60, classIds: [classId],
  })).json();

  const room = (await jget("/api/rooms")).find((r) => r.campusId === campusId);
  let pose = null;
  for (let j = 0; j < 30 && !pose; j++) {
    const d = new Date(Date.UTC(2027, 2, 1 + j)).toISOString().slice(0, 10);
    const res = await post("/api/sessions", {
      campusId, classId, roomId: room?.id, moduleId: mod.id,
      date: d, start: "09:00", end: "11:00", kind: "cours",
    });
    if (res.status === 200) pose = await res.json();
  }
  assert.ok(pose, "une séance doit avoir pu être posée");
  seanceDistId = pose.id;

  // Elle est en présentiel par défaut : le suivi à distance ne la voit pas.
  assert.equal(pose.modalite, "presentiel");
  assert.equal((await jget(`/api/lms/suivi?campusId=${campusId}`)).seances.length, 0);

  const maj = await req(`/api/sessions/${seanceDistId}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf, json: { modalite: "distanciel" },
  });
  assert.equal(maj.status, 200);
  const suivi = await jget(`/api/lms/suivi?campusId=${campusId}`);
  assert.equal(suivi.seances.length, 1);
  // Huit inscrits, aucune trace : rien n'est justifié.
  assert.equal(suivi.seances[0].inscrits, 8);
  assert.equal(suivi.justifiees, 0);
  assert.equal(suivi.sansTrace, 8);
  assert.match(suivi.risque, /contrôle de service fait/);
});

// LE TEST CENTRAL, VÉRIFIÉ JUSQU'AU BOUT DE LA CHAÎNE.
test("OUVRIR UNE RESSOURCE NE JUSTIFIE AUCUNE HEURE — RENDRE UN TRAVAIL, OUI", async () => {
  const acc = await (await post("/api/portal/access", {
    kind: "learner", subjectId: learners[0].id, campusId, label: "Test",
  })).json();
  jetonEleve = acc.token || acc.jeton || acc.url?.split("#").pop();
  assert.ok(jetonEleve, "le jeton d'accès doit être rendu à la création");
  const porte = (p, body) => fetch(BASE + p, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${jetonEleve}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  // La liste servie à l'apprenant ne porte AUCUN lien.
  const liste = await (await porte("/api/portal/ressources")).json();
  assert.ok(liste.length >= 2);
  for (const r of liste) assert.equal(r.url, undefined);
  assert.ok(liste.some((r) => r.dureeMoyenneMinutes === 60));

  // Il ouvre le support : le lien est délivré ICI, et la consultation est tracée.
  const ouvert = await (await porte(`/api/portal/ressources/${resDoc.id}/ouvrir`, { seanceId: seanceDistId })).json();
  assert.match(ouvert.url, /^https:\/\//);

  let suivi = await jget(`/api/lms/suivi?campusId=${campusId}`);
  // Il a cliqué — et il n'est TOUJOURS PAS justifié.
  assert.equal(suivi.justifiees, 0, "ouvrir un PDF ne justifie pas deux heures de cours");
  assert.equal(suivi.consultationSeule, 1);
  const moi = suivi.seances[0].lignes.find((l) => l.learnerId === learners[0].id);
  assert.equal(moi.niveau, "consultation");
  assert.equal(moi.justifie, false);

  // Un document n'attend aucun travail : le rendre est refusé.
  assert.equal((await porte(`/api/portal/ressources/${resDoc.id}/rendre`, { rendu: "x" })).status, 400);
  // Un rendu vide aussi.
  assert.equal((await porte(`/api/portal/ressources/${resExo.id}/rendre`, { rendu: "  " })).status, 400);

  // Il rend l'exercice : MAINTENANT c'est justifié.
  assert.equal((await porte(`/api/portal/ressources/${resExo.id}/rendre`, {
    rendu: "Ma réponse à l'exercice", seanceId: seanceDistId,
  })).status, 200);

  suivi = await jget(`/api/lms/suivi?campusId=${campusId}`);
  assert.equal(suivi.justifiees, 1);
  assert.equal(suivi.consultationSeule, 0, "le travail rendu prime sur la simple consultation");
  const apres = suivi.seances[0].lignes.find((l) => l.learnerId === learners[0].id);
  assert.equal(apres.niveau, "travail");
  assert.equal(apres.justifie, true);
  // Et le module ne prononce jamais le mot « assidu ».
  assert.match(suivi.seances[0].reserve, /ne remplacent pas l'émargement/);
});

test("un apprenant d'un autre campus n'atteint pas la ressource", async () => {
  const autre = await (await post("/api/campuses", { name: "Autre CFA" })).json();
  const l = await (await post("/api/learners", { campusId: autre.id, nom: "X", prenom: "Y" })).json();
  const acc = await (await post("/api/portal/access", { kind: "learner", subjectId: l.id, campusId: autre.id })).json();
  const jeton = acc.token || acc.jeton || acc.url?.split("#").pop();
  const r = await fetch(`${BASE}/api/portal/ressources/${resDoc.id}/ouvrir`, {
    method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(r.status, 404);
});

test("archiver une ressource ne détruit pas la preuve qu'elle a servi", async () => {
  const r = await req(`/api/ressources/${resExo.id}`, { method: "DELETE", cookie: A.cookie, csrf: A.csrf });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).archivee, true);
  // Le travail rendu reste compté : c'est lui qui justifie l'heure.
  const suivi = await jget(`/api/lms/suivi?campusId=${campusId}`);
  assert.equal(suivi.justifiees, 1);
});

test("une fois une séance passée à distance, le chantier cesse d'être sans objet", async () => {
  const d = await jget(`/api/chantier?campusId=${campusId}`);
  const dist = d.chantiers.find((c) => c.cle === "distance");
  assert.equal(dist.sansObjet, false);
  assert.equal(dist.seances, 1);
  // Un seul des huit inscrits a rendu un travail : la ligne reste ouverte, et
  // elle dit le risque plutôt qu'un pourcentage sec.
  assert.equal(dist.fait, false);
  assert.ok(dist.tauxJustifie < 100);
  assert.match(dist.enjeu, /contrôle de service fait|D\. 6313-3-1/);
});

// --- Dossiers RH des intervenants et masse horaire ---
let profId = null;

test("un dossier incomplet dit ce que chaque manque empêche", async () => {
  const t = await (await post("/api/teachers", {
    name: "Claire Martin", email: "claire@x.fr", status: "vacataire", campusIds: [campusId],
  })).json();
  profId = t.id;

  const d = await jget(`/api/intervenants/dossiers?campusId=${campusId}`);
  const mien = d.dossiers.find((x) => x.teacherId === profId);
  assert.equal(mien.dossier.complet, false);
  assert.ok(mien.dossier.manquants.length >= 3);
  for (const m of mien.dossier.manquants) assert.ok(m.bloque.length > 15, m.cle);
  assert.equal(d.incomplets >= 1, true);
  // Les données les plus sensibles ne sont PAS demandées ici.
  assert.doesNotMatch(JSON.stringify(d.champs), /sécurité sociale|bancaire|iban/i);
  assert.match(JSON.stringify(d.aTransmettre), /sécurité sociale/);
});

test("LE VOLUME HORAIRE VIENT DU PLANNING, PAS D'UNE SAISIE", async () => {
  await req(`/api/teachers/${profId}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { subjects: ["Optique"], tauxHoraire: 45, heuresAnnuelles: 4, matricule: "M12", regle: "+10 % préparation" },
  });

  const curricula = await jget("/api/curricula");
  const mod = curricula[0].modules[0];
  const room = (await jget("/api/rooms")).find((r) => r.campusId === campusId);
  let posees = 0;
  for (let j = 0; j < 40 && posees < 3; j++) {
    const date = new Date(Date.UTC(2027, 4, 3 + j)).toISOString().slice(0, 10);
    const res = await post("/api/sessions", {
      campusId, classId, roomId: room?.id, teacherId: profId, moduleId: mod.id,
      date, start: "09:00", end: "11:00", kind: "cours",
    });
    if (res.status === 200) posees++;
  }
  assert.equal(posees, 3, "trois séances de 2 h doivent avoir pu être posées");

  const d = await jget(`/api/intervenants/dossiers?campusId=${campusId}`);
  const mien = d.dossiers.find((x) => x.teacherId === profId);
  // 3 × 2 h = 6 h, lues dans les séances — jamais saisies.
  assert.equal(mien.volume.heuresAffectees, 6);
  assert.equal(mien.volume.heuresAuContrat, 4);
  assert.equal(mien.volume.ecart, 2);
  assert.match(mien.volume.alerte.message, /avenant/);
  assert.equal(mien.volume.matieres[0].heures, 6);
  assert.equal(mien.dossier.complet, true);
});

test("la fiche RH rassemble tout, et refuse de chiffrer sans coefficient", async () => {
  const f = await jget(`/api/intervenants/${profId}/fiche-rh?campusId=${campusId}`);
  assert.equal(f.intervenant.nom, "Claire Martin");
  assert.equal(f.volume.heuresAffectees, 6);
  assert.equal(f.cout.brut, 270);
  // LE PIÈGE : sans coefficient de charges déclaré, on ne sert PAS le brut
  // comme s'il était le coût employeur.
  assert.equal(f.cout.charge, null);
  assert.match(f.cout.motif, /40 %/);
  // Et la fiche ne prétend pas rédiger le contrat.
  assert.match(f.reserve, /ne le rédige pas/);
});

// LE PIÈGE DU BUDGET ANNUEL.
test("UN BUDGET CONSOMMÉ PLUS VITE QUE L'ANNÉE DÉCLENCHE UNE ALERTE DE TRAJECTOIRE", async () => {
  // Année 2027 entière, budget 1 000 € : 6 h à 45 € chargées à 1,42 = 383,40 €.
  const r = await req("/api/intervenants/masse", {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { campusId, masse: { budgetAnnuel: 1000, coefficientCharges: 1.42, anneeDebut: "2027-01-01", anneeFin: "2027-12-31" } },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).coefficientCharges, 1.42);

  const m = await jget(`/api/intervenants/masse?campusId=${campusId}`);
  assert.equal(m.heures, 6);
  assert.equal(m.cout, 383.4);
  assert.equal(m.budget, 1000);
  assert.equal(m.consommation, 38);
  // L'année 2027 n'a pas commencé : l'avancement est nul, donc AUCUNE
  // projection inventée. Mieux vaut ne rien dire que projeter sur zéro.
  assert.equal(m.projection, null);
  assert.equal(m.horsContrat, 2);

  // Avec une année déjà entamée à 10 %, la même dépense devient une alerte.
  await req("/api/intervenants/masse", {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { campusId, masse: { budgetAnnuel: 1000, coefficientCharges: 1.42, anneeDebut: "2026-08-01", anneeFin: "2027-07-31" } },
  });
  const tard = await jget(`/api/intervenants/masse?campusId=${campusId}`);
  assert.ok(tard.avancement > 0.08 && tard.avancement < 0.25, `avancement ${tard.avancement}`);
  const traj = tard.alertes.find((a) => a.code === "trajectoire");
  assert.ok(traj, "consommer 38 % du budget sur 11 % de l'année doit alerter");
  assert.equal(traj.gravite, "bloquant");
  assert.match(traj.message, /atterrissage/);
});

test("un intervenant sans taux rend le total partiel, et le taux de consommation se tait", async () => {
  const t2 = await (await post("/api/teachers", {
    name: "Sans taux", email: "st@x.fr", status: "vacataire", campusIds: [campusId], subjects: ["Gestion"],
  })).json();
  const room = (await jget("/api/rooms")).find((r) => r.campusId === campusId);
  for (let j = 0; j < 20; j++) {
    const date = new Date(Date.UTC(2027, 5, 1 + j)).toISOString().slice(0, 10);
    const res = await post("/api/sessions", {
      campusId, classId, roomId: room?.id, teacherId: t2.id,
      date, start: "14:00", end: "16:00", kind: "cours",
    });
    if (res.status === 200) break;
  }
  const m = await jget(`/api/intervenants/masse?campusId=${campusId}`);
  const a = m.alertes.find((x) => x.code === "incomplet");
  assert.ok(a, "un intervenant non chiffrable doit rendre le total explicitement partiel");
  assert.match(a.message, /partiel/);
  assert.equal(m.consommation, null, "un taux calculé sur une partie des lignes paraîtrait tenu à tort");
  // Les heures, elles, restent comptées.
  assert.ok(m.heures >= 8);
  assert.ok(m.alertes.some((x) => x.code === "dossiers"));
});

test("un prestataire ne génère pas de charges patronales", async () => {
  const p = await (await post("/api/teachers", {
    name: "Studio X", email: "sx@x.fr", status: "prestataire", campusIds: [campusId],
    subjects: ["Design"], tauxHoraire: 100, heuresAnnuelles: 10, company: "Studio X SARL",
  })).json();
  const f = await jget(`/api/intervenants/${p.id}/fiche-rh?campusId=${campusId}`);
  assert.equal(f.dossier.prestataire, true);
  assert.equal(f.dossier.complet, true);
  // Aucune séance : coût nul, mais surtout coefficient 1 et non 1,42.
  assert.equal(f.cout.charge, f.cout.brut);
  assert.equal(f.cout.coefficient, 1);
  // Et son dossier ne réclame ni matricule ni règle de paie.
  assert.equal(f.dossier.lignes.some((l) => l.cle === "matricule"), false);
  assert.match(JSON.stringify(f.dossier.aTransmettre), /URSSAF/);
});

// --- Documents obligatoires de l'organisme (lot 1) ---
test("sans règlement intérieur, l'organisme est en défaut et le chantier le dit", async () => {
  const d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.equal(d.conforme, false);
  assert.match(JSON.stringify(d.points), /L\. 6352-3/);
  // La durée la plus longue du campus est calculée depuis les référentiels et
  // le rythme réel de chaque classe — c'est elle qui déclenche (ou non) le seuil.
  assert.ok(d.dureeMaxHeures > 0, `durée max ${d.dureeMaxHeures}`);

  const ch = (await jget(`/api/chantier?campusId=${campusId}`)).chantiers.find((c) => c.cle === "documents");
  assert.equal(ch.fait, false);
  assert.equal(ch.reglement, false);
  assert.match(ch.enjeu, /L\. 6352-3/);
});

// LE SEUIL DES 500 HEURES — le seuil est réel, il dépend de la durée enseignée.
const REGLEMENT_BASE = {
  version: "2026-1", dateApplication: "2026-09-01",
  hygieneSecurite: "Consignes incendie et premiers secours", disciplinaire: "Assiduité, ponctualité",
  sanctions: "Avertissement, blâme, exclusion", procedure: "Convocation, entretien, assistance, notification motivée",
};
const majReglement = (reglement) => req("/api/documents-of/reglement", {
  method: "PATCH", cookie: A.cookie, csrf: A.csrf, json: { campusId, reglement },
});

test("sous 500 h, la représentation des stagiaires n'est pas exigée", async () => {
  const d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.ok(d.dureeMaxHeures <= 500, `ce test suppose un campus sous le seuil (${d.dureeMaxHeures} h)`);
  const r = await majReglement({ ...REGLEMENT_BASE, representation: "" });
  assert.equal(r.status, 200, "l'obligation ne s'applique pas en deçà du seuil");
});

test("AU-DELÀ DE 500 H, UN RÈGLEMENT SANS REPRÉSENTATION DES STAGIAIRES EST REFUSÉ", async () => {
  // Une classe longue fait franchir le seuil au campus : 30 h/sem. sur 36
  // semaines, soit 1 080 h — un BTS typique.
  const cur = await (await post("/api/curricula", {
    name: "BTS long", modules: [{ code: "L1", label: "Enseignement long", heuresSemaine: 30 }],
  })).json();
  await post("/api/classes", { campusId, curriculumId: cur.id, name: "Classe longue" });

  const d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.ok(d.dureeMaxHeures > 500, `durée max ${d.dureeMaxHeures}`);

  const sans = await majReglement({ ...REGLEMENT_BASE, representation: "" });
  assert.equal(sans.status, 400);
  assert.match((await sans.json()).error, /R\. 6352-9/);

  const avec = await majReglement({ ...REGLEMENT_BASE, representation: "Élection d'un délégué titulaire et d'un suppléant" });
  assert.equal(avec.status, 200);
  assert.equal((await avec.json()).version, "2026-1");
});

test("LE RÈGLEMENT NE VAUT QUE PORTÉ À CONNAISSANCE, et la remise se compte par version", async () => {
  let d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.equal(d.remises.remis, 0);
  assert.match(d.remises.alerte.message, /pas opposable/);

  const r = await (await post("/api/documents-of/remise", { campusId })).json();
  assert.equal(r.enregistrees, 8);
  d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.equal(d.remises.complet, true);
  assert.equal(d.remises.taux, 100);

  // Rejouer la remise ne double pas les compteurs.
  await post("/api/documents-of/remise", { campusId });
  assert.equal((await jget(`/api/documents-of?campusId=${campusId}`)).remises.remis, 8);

  // Une NOUVELLE version repart de zéro : l'ancienne remise ne vaut pas pour elle.
  await req("/api/documents-of/reglement", {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { campusId, reglement: { ...d.reglement, version: "2026-2" } },
  });
  const apres = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.equal(apres.remises.version, "2026-2");
  assert.equal(apres.remises.remis, 0);
});

test("le programme se construit depuis le référentiel de la classe", async () => {
  const p = await jget(`/api/documents-of/programme?classId=${classId}`);
  assert.ok(p.programme.contenu.length >= 1);
  assert.equal(p.programme.organisme, "CFA Enquête");
  // Sans objectifs saisis au référentiel, il n'est pas encore valide — et on
  // le dit plutôt que de servir un document incomplet.
  assert.equal(p.validation.ok, false);
  assert.match(p.validation.errors.join(" "), /Objectifs/);
});

// LA GARDE CENTRALE.
test("UNE CONVENTION SERVIE À UN PARTICULIER EST REFUSÉE PAR L'API", async () => {
  const prog = (await jget(`/api/documents-of/programme?classId=${classId}`)).programme;
  const commun = {
    campusId, intitule: "BTS OL", objectifs: "Préparer au diplôme", nature: "apprentissage",
    dureeHeures: 1350, dates: "2026-09 → 2027-06", dateDebut: "2026-09-01", dateFin: "2027-06-30",
    effectif: 8, prix: 9000, moyens: "Plateau technique", evaluation: "Contrôle continu",
    programme: prog,
  };
  const faux = await post("/api/actes", {
    ...commun, type: "convention", payeur: "particulier", acheteur: "Léa Dupont", resiliation: "—",
    echeances: [{ montant: 9000, date: "2026-10-01" }],
  });
  assert.equal(faux.status, 400);
  assert.match((await faux.json()).error, /incompatible avec ce financement/);

  // La convention à une entreprise passe.
  const ok = await post("/api/actes", {
    ...commun, type: "convention", payeur: "entreprise", acheteur: "OPCO EP", resiliation: "Dédit 30 %",
    echeances: [{ montant: 9000, date: "2026-10-01" }],
  });
  assert.equal(ok.status, 200);
});

// LE PIÈGE DE L'ÉCHÉANCIER.
test("UN CONTRAT QUI ENCAISSE PENDANT LE DÉLAI DE RÉTRACTATION EST REFUSÉ", async () => {
  const prog = (await jget(`/api/documents-of/programme?classId=${classId}`)).programme;
  const base = {
    campusId, type: "contrat", payeur: "particulier",
    intitule: "BTS OL", objectifs: "Préparer au diplôme", nature: "formation",
    dureeHeures: 1350, dates: "2026-09 → 2027-06", dateDebut: "2026-10-01", dateFin: "2027-06-30",
    effectif: 1, prix: 3000, moyens: "Plateau technique", evaluation: "Contrôle continu",
    sanction: "BTS", beneficiaire: "Léa Dupont", retractation: "10 jours à compter de la signature",
    dedit: "Remboursement au prorata", dateSignature: "2026-09-01", programme: prog,
  };
  // « 50 % à la signature » : la faute qu'un ERP fabrique en trois clics.
  const illicite = await post("/api/actes", { ...base, echeances: [
    { montant: 1500, date: "2026-09-01" }, { montant: 1500, date: "2026-12-01" },
  ] });
  assert.equal(illicite.status, 400);
  assert.match((await illicite.json()).error, /L\. 6353-5/);

  // L'échéancier proposé par l'API est conforme par construction.
  const e = await jget("/api/actes/echeancier?prix=3000&dateSignature=2026-09-01&nbEcheances=3");
  assert.equal(e.finRetractation, "2026-09-11");
  assert.equal(e.lignes[0].montant, 900);

  const bon = await post("/api/actes", { ...base, echeances: e.lignes });
  assert.equal(bon.status, 200);
  const acte = await bon.json();

  // Un acte signé ne se modifie plus.
  assert.equal((await post(`/api/actes/${acte.id}/signer`, {})).status, 200);
  const fige = await req(`/api/actes/${acte.id}`, {
    method: "PATCH", cookie: A.cookie, csrf: A.csrf, json: { prix: 5000 },
  });
  assert.equal(fige.status, 409);
  assert.match((await fige.json()).error, /avenant/);
});

test("l'édition imprimable porte les mentions, leur base, et l'avertissement de rétractation", async () => {
  const actes = (await jget(`/api/documents-of?campusId=${campusId}`)).actes;
  const contrat = actes.find((a) => a.type === "contrat");
  const html = await (await get(`/api/actes/${contrat.id}/print`)).text();
  assert.match(html, /Contrat de formation professionnelle/);
  assert.match(html, /L\. 6353-5/);
  assert.match(html, /L\. 6353-6/);
  assert.match(html, /Programme de formation \(préétabli/);
  assert.match(html, /rédaction reste à valider/);

  // La convention, elle, ne porte PAS l'avertissement de rétractation : il ne
  // s'applique pas, et l'afficher induirait l'acheteur en erreur.
  const conv = actes.find((a) => a.type === "convention");
  const htmlConv = await (await get(`/api/actes/${conv.id}/print`)).text();
  assert.doesNotMatch(htmlConv, /Délai de rétractation/);

  // Et le règlement intérieur s'imprime avec ses bases.
  const ri = await (await get(`/api/documents-of/reglement/print?campusId=${campusId}`)).text();
  assert.match(ri, /R\. 6352-9/);
  assert.match(ri, /remis à chaque bénéficiaire/);
});

test("un acte sans programme est refusé, et une action commencée sans signature remonte", async () => {
  const sans = await post("/api/actes", {
    campusId, type: "convention", payeur: "entreprise", intitule: "Sans programme",
    objectifs: "x", nature: "formation", dureeHeures: 10, dates: "x", effectif: 1,
    prix: 100, moyens: "x", evaluation: "x", resiliation: "x", acheteur: "x",
    echeances: [{ montant: 100, date: "2026-10-01" }],
  });
  assert.equal(sans.status, 400);
  assert.match((await sans.json()).error, /programme préétabli/);

  // La convention entreprise créée plus haut démarre au 2026-09-01 et n'est pas
  // signée : la formation s'exécute sans base contractuelle.
  const d = await jget(`/api/documents-of?campusId=${campusId}`);
  assert.match(JSON.stringify(d.points), /sans base contractuelle/);
});

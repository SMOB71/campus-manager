// Enquêtes : satisfaction générale (indicateur 30) et évaluation des
// enseignements (indicateur 33, décret n° 2026-728). Le décret exige que les
// deux dispositifs restent DISTINCTS.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TYPES, PUBLICS, QUESTION_TYPES, SEUIL_RESTITUTION_NOMINATIVE, modele,
  validateEnquete, validateReponse, assainirReponse, depouiller, parEnseignement, etatDispositif,
} from "../lib/enquetes.js";

const base = (p = {}) => ({
  id: "e1", type: "satisfaction", titre: "Satisfaction 2026", etat: "ouverte",
  publics: ["apprenant"], questions: modele("satisfaction"), ...p,
});

test("les deux dispositifs visent deux indicateurs différents", () => {
  assert.equal(TYPES.satisfaction.indicateur, 30);
  assert.equal(TYPES.enseignements.indicateur, 33);
  // L'évaluation des enseignements ne s'adresse qu'aux apprenants : eux seuls
  // ont suivi les cours.
  assert.deepEqual(TYPES.enseignements.publics, ["apprenant"]);
  assert.ok(TYPES.satisfaction.publics.length > 1);
});

test("un public hors du type est refusé, pas silencieusement ignoré", () => {
  const ok = validateEnquete(base({ publics: ["apprenant", "entreprise", "financeur"] }));
  assert.equal(ok.ok, true);
  // Faire évaluer les enseignements par les financeurs n'a aucun sens.
  const ko = validateEnquete(base({ type: "enseignements", classId: "k1", publics: ["financeur"] }));
  assert.equal(ko.ok, false);
  assert.match(ko.errors.join(" "), /financeurs/i);
  assert.equal(validateEnquete(base({ publics: ["martien"] })).ok, false);
});

test("une évaluation des enseignements sans classe ne sait pas ce qu'elle évalue", () => {
  const sans = validateEnquete(base({ type: "enseignements", publics: ["apprenant"], questions: modele("enseignements") }));
  assert.equal(sans.ok, false);
  assert.match(sans.errors.join(" "), /classe/);
  const avec = validateEnquete(base({ type: "enseignements", classId: "k1", publics: ["apprenant"], questions: modele("enseignements") }));
  assert.equal(avec.ok, true);
});

test("validation de structure : questions, doublons d'identifiant, dates", () => {
  assert.equal(validateEnquete(base({ questions: [] })).ok, false);
  assert.equal(validateEnquete(base({ questions: [{ id: "a", type: "inventé", texte: "x" }] })).ok, false);
  assert.equal(validateEnquete(base({ questions: [{ id: "a", type: "libre", texte: "" }] })).ok, false);
  const doublon = validateEnquete(base({ questions: [
    { id: "a", type: "libre", texte: "x" }, { id: "a", type: "libre", texte: "y" },
  ] }));
  assert.equal(doublon.ok, false);
  assert.match(doublon.errors.join(" "), /double/);
  assert.equal(validateEnquete(base({ dateOuverture: "2026-12-01", dateFermeture: "2026-11-01" })).ok, false);
});

test("une évaluation sans question libre est signalée sans être refusée", () => {
  const v = validateEnquete(base({
    type: "enseignements", classId: "k1", publics: ["apprenant"],
    questions: [{ id: "q1", type: "echelle", texte: "Rythme adapté ?" }],
  }));
  assert.equal(v.ok, true);
  assert.match(v.warnings.join(" "), /verbatim/);
});

test("une réponse est bornée, et une soumission vide est refusée", () => {
  const e = base({ questions: [
    { id: "q1", type: "echelle", texte: "x" },
    { id: "q2", type: "oui_non", texte: "y" },
  ] });
  assert.equal(validateReponse(e, { reponses: { q1: 4, q2: "oui" } }).ok, true);
  assert.equal(validateReponse(e, { reponses: { q1: 9 } }).ok, false);
  assert.equal(validateReponse(e, { reponses: { q1: 2.5 } }).ok, false);
  assert.equal(validateReponse(e, { reponses: { q2: "peut-être" } }).ok, false);
  // Une soumission vide comptée comme un avis fausserait le taux de participation.
  assert.equal(validateReponse(e, { reponses: { q1: "" } }).ok, false);
  // Et une enquête fermée n'accepte plus rien.
  assert.equal(validateReponse({ ...e, etat: "close" }, { reponses: { q1: 4 } }).ok, false);
});

// L'ANONYMAT SE JOUE À L'ÉCRITURE, PAS À L'AFFICHAGE.
test("assainirReponse ne laisse passer que les questions de l'enquête", () => {
  const e = base({ questions: [{ id: "q1", type: "echelle", texte: "x" }] });
  const out = assainirReponse(e, {
    reponses: { q1: 4, q9: "question inexistante", nom: "Léa Dupont", email: "lea@x.fr" },
    moduleId: "m1", teacherId: "t1", learnerId: "l1",
  });
  assert.deepEqual(Object.keys(out.reponses), ["q1"]);
  // Aucun identifiant de répondant ne doit survivre au nettoyage.
  assert.equal(out.learnerId, undefined);
  assert.equal(JSON.stringify(out).includes("Dupont"), false);
  assert.equal(JSON.stringify(out).includes("lea@x.fr"), false);
  // Le contexte pédagogique, lui, est conservé : il ne désigne personne et il
  // est nécessaire à la restitution par enseignement.
  assert.equal(out.moduleId, "m1");
  assert.equal(out.teacherId, "t1");
  // Le verbatim est borné : un champ libre sans limite est une porte ouverte.
  const long = assainirReponse(base({ questions: [{ id: "q1", type: "libre", texte: "x" }] }),
    { reponses: { q1: "a".repeat(5000) } });
  assert.equal(long.reponses.q1.length, 2000);
});

test("dépouillement : moyennes, distribution, taux de oui, verbatims intacts", () => {
  const e = base({ questions: [
    { id: "q1", type: "echelle", texte: "Accueil" },
    { id: "q2", type: "oui_non", texte: "Recommanderiez-vous ?" },
    { id: "q3", type: "libre", texte: "Observations" },
  ] });
  const reponses = [
    { reponses: { q1: 4, q2: "oui", q3: "Très bon accueil" } },
    { reponses: { q1: 2, q2: "non", q3: "Salles trop petites" } },
    { reponses: { q1: 3, q2: "oui" } },
  ];
  const d = depouiller(e, reponses, new Array(10).fill({}));
  assert.equal(d.repondus, 3);
  assert.equal(d.invites, 10);
  assert.equal(d.participation, 30);

  const q1 = d.questions.find((q) => q.id === "q1");
  assert.equal(q1.moyenne, 3);
  assert.equal(q1.distribution.find((x) => x.note === 4).n, 1);
  assert.equal(d.questions.find((q) => q.id === "q2").tauxOui, 67);

  // Le verbatim n'est ni moyenné ni résumé.
  const q3 = d.questions.find((q) => q.id === "q3");
  assert.deepEqual(q3.verbatims, ["Très bon accueil", "Salles trop petites"]);
  assert.equal(q3.moyenne, undefined);

  // La note globale ne porte QUE sur les échelles : y mêler un oui/non
  // produirait un chiffre sans signification.
  assert.equal(d.noteGlobale, 3);
});

// LE POINT QUI ENGAGE : évaluer un enseignement, c'est évaluer quelqu'un.
test("AUCUN RÉSULTAT NOMINATIF SOUS LE SEUIL DE RÉPONSES", () => {
  const e = base({ type: "enseignements", classId: "k1", questions: [{ id: "q1", type: "echelle", texte: "Rythme" }] });
  const peu = [
    { moduleId: "m1", teacherId: "t1", reponses: { q1: 2 } },
    { moduleId: "m1", teacherId: "t1", reponses: { q1: 1 } },
    { moduleId: "m1", teacherId: "t1", reponses: { q1: 3 } },
  ];
  const [g] = parEnseignement(e, peu, { libelles: { m1: "Optique géométrique", t1: "M. Martin" } });
  assert.equal(g.repondu, 3);
  assert.equal(g.publiable, false);
  assert.equal(g.note, null, "aucune note sur trois réponses");
  assert.deepEqual(g.questions, []);
  assert.match(g.motif, /identifiables/);

  // Au seuil, la restitution devient possible.
  const assez = [...peu, { moduleId: "m1", teacherId: "t1", reponses: { q1: 4 } },
    { moduleId: "m1", teacherId: "t1", reponses: { q1: 5 } }];
  assert.equal(assez.length, SEUIL_RESTITUTION_NOMINATIVE);
  const [g2] = parEnseignement(e, assez, { libelles: { m1: "Optique géométrique", t1: "M. Martin" } });
  assert.equal(g2.publiable, true);
  assert.equal(g2.note, 3);
  assert.equal(g2.intervenant, "M. Martin");
});

test("la restitution sépare bien les enseignements les uns des autres", () => {
  const e = base({ type: "enseignements", classId: "k1", questions: [{ id: "q1", type: "echelle", texte: "Rythme" }] });
  const reps = [
    ...new Array(5).fill(0).map(() => ({ moduleId: "m1", teacherId: "t1", reponses: { q1: 5 } })),
    ...new Array(5).fill(0).map(() => ({ moduleId: "m2", teacherId: "t2", reponses: { q1: 2 } })),
  ];
  const out = parEnseignement(e, reps, { libelles: { m1: "Optique", m2: "Gestion" } });
  assert.equal(out.length, 2);
  assert.equal(out.find((x) => x.moduleId === "m1").note, 5);
  assert.equal(out.find((x) => x.moduleId === "m2").note, 2);
});

// Un audit ne demande pas « avez-vous un questionnaire » mais « qu'en avez-vous fait ».
test("le dispositif n'est couvert que si les retours ont produit quelque chose", () => {
  const AUJ = "2026-09-14";
  // Rien du tout.
  const vide = etatDispositif([], { aujourdhui: AUJ });
  assert.equal(vide.couvert, false);
  assert.equal(vide.lignes.length, 2);
  assert.ok(vide.lignes.every((l) => l.manques.length));

  // Des enquêtes closes mais dont rien n'a été tiré.
  const sansSuite = etatDispositif([
    { type: "satisfaction", etat: "close", dateOuverture: "2026-03-01" },
    { type: "enseignements", etat: "close", dateOuverture: "2026-03-01" },
  ], { aujourdhui: AUJ });
  assert.equal(sansSuite.couvert, false);
  assert.match(sansSuite.lignes.map((l) => l.manques.join(" ")).join(" "), /mesure d'amélioration/);

  // L'indicateur 33 exige en plus la restitution aux équipes pédagogiques.
  const sansRestitution = etatDispositif([
    { type: "satisfaction", etat: "close", dateOuverture: "2026-03-01", mesures: [{ texte: "m" }] },
    { type: "enseignements", etat: "close", dateOuverture: "2026-03-01", mesures: [{ texte: "m" }] },
  ], { aujourdhui: AUJ });
  assert.equal(sansRestitution.lignes.find((l) => l.type === "satisfaction").couvert, true);
  const ens = sansRestitution.lignes.find((l) => l.type === "enseignements");
  assert.equal(ens.couvert, false);
  assert.match(ens.manques.join(" "), /restitution aux équipes/);

  // Complet des deux côtés.
  const complet = etatDispositif([
    { type: "satisfaction", etat: "close", dateOuverture: "2026-03-01", mesures: [{ texte: "m" }] },
    { type: "enseignements", etat: "close", dateOuverture: "2026-03-01", mesures: [{ texte: "m" }], restitutionLe: "2026-04-10" },
  ], { aujourdhui: AUJ });
  assert.equal(complet.couvert, true);
});

test("une enquête trop ancienne ne couvre plus rien", () => {
  const vieille = [{ type: "satisfaction", etat: "close", dateOuverture: "2023-01-01", mesures: [{ texte: "m" }] }];
  const e = etatDispositif(vieille, { aujourdhui: "2026-09-14", moisRecents: 12 });
  assert.equal(e.lignes.find((l) => l.type === "satisfaction").total, 0);
});

test("les modèles de départ sont valides et adaptés à leur type", () => {
  assert.equal(validateEnquete(base({ questions: modele("satisfaction") })).ok, true);
  assert.equal(validateEnquete(base({
    type: "enseignements", classId: "k1", publics: ["apprenant"], questions: modele("enseignements"),
  })).ok, true);
  // Les deux modèles ne posent pas les mêmes questions : c'est tout l'enjeu.
  const s = modele("satisfaction").map((q) => q.texte).join(" ");
  const ens = modele("enseignements").map((q) => q.texte).join(" ");
  assert.match(s, /recommanderiez/i);
  assert.doesNotMatch(ens, /recommanderiez/i);
  assert.match(ens, /objectifs/i);
  for (const q of [...modele("satisfaction"), ...modele("enseignements")]) {
    assert.ok(QUESTION_TYPES[q.type], `type ${q.type} inconnu`);
  }
  assert.ok(Object.keys(PUBLICS).length >= 4);
});

// LMS — ressources pédagogiques et suivi à distance (indicateur 19 du
// référentiel 2026, art. D. 6313-3-1 du code du travail).
//
// Ce qui est vraiment testé : que CONSULTER ne devienne jamais ÊTRE ASSIDU.
// C'est la confusion qu'un LMS naïf commet, et elle fabrique une preuve
// d'assiduité qui alimente ensuite la facturation.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RESSOURCE_TYPES, MODALITES, COMPOSANTES_FOAD, NIVEAUX_PREUVE,
  validateRessource, estDisponible, pourApprenant, suiviSeance, conformiteFoad, heuresJustifiables,
} from "../lib/lms.js";

const r = (p = {}) => ({
  id: "r1", titre: "Support optique géométrique", type: "document", moduleId: "m1",
  url: "https://exemple.fr/support.pdf", classIds: ["k1"], ...p,
});

test("une ressource sans module n'est trouvable par personne", () => {
  assert.equal(validateRessource(r({ moduleId: null })).ok, false);
  assert.equal(validateRessource(r({ titre: "" })).ok, false);
  assert.equal(validateRessource(r({ type: "inventé" })).ok, false);
  assert.equal(validateRessource(r({ url: "", documentId: null })).ok, false);
  // Un lien qui n'en est pas un : refusé plutôt que servi tel quel.
  assert.equal(validateRessource(r({ url: "javascript:alert(1)" })).ok, false);
  assert.equal(validateRessource(r({ url: "exemple.fr/x.pdf" })).ok, false);
  assert.equal(validateRessource(r()).ok, true);
});

// LA CONDITION DE L'ARTICLE D. 6313-3-1, 2°.
test("une activité à distance sans durée moyenne annoncée est refusée", () => {
  const sans = validateRessource(r({ type: "exercice", aDistance: true }));
  assert.equal(sans.ok, false);
  assert.match(sans.errors.join(" "), /D\. 6313-3-1/);
  assert.equal(validateRessource(r({ type: "exercice", aDistance: true, dureeMoyenneMinutes: 90 })).ok, true);
  // En présentiel, la durée moyenne n'est pas exigée : la séance la porte.
  assert.equal(validateRessource(r({ type: "document" })).ok, true);
  assert.equal(validateRessource(r({ aDistance: true, dureeMoyenneMinutes: 0 })).ok, false);
});

test("un document mis à distance est signalé : il ne produit aucun élément probant", () => {
  const v = validateRessource(r({ type: "document", aDistance: true, dureeMoyenneMinutes: 30 }));
  assert.equal(v.ok, true, "on n'interdit pas — un support de cours a sa place");
  assert.match(v.warnings.join(" "), /ne justifie pas d'heures/);
  // Un exercice, lui, produit une trace de travail.
  assert.equal(RESSOURCE_TYPES.document.probant, false);
  assert.equal(RESSOURCE_TYPES.exercice.probant, true);
  assert.equal(RESSOURCE_TYPES.evaluation.probant, true);
});

test("la disponibilité tient compte de la classe, des dates et de l'archivage", () => {
  assert.equal(estDisponible(r(), "k1", "2026-09-15"), true);
  assert.equal(estDisponible(r(), "k2", "2026-09-15"), false, "autre classe");
  assert.equal(estDisponible(r({ archivee: true }), "k1", "2026-09-15"), false);
  assert.equal(estDisponible(r({ disponibleDu: "2026-10-01" }), "k1", "2026-09-15"), false);
  assert.equal(estDisponible(r({ disponibleAu: "2026-09-01" }), "k1", "2026-09-15"), false);
  // Sans classe déclarée, la ressource vaut pour tous.
  assert.equal(estDisponible(r({ classIds: [] }), "k9", "2026-09-15"), true);
});

// L'URL ne doit pas fuiter dans la liste : sinon on télécharge tout sans trace.
test("la liste servie à l'apprenant ne porte AUCUN lien", () => {
  const liste = pourApprenant([r(), r({ id: "r2", type: "exercice", aDistance: true, dureeMoyenneMinutes: 60 })],
    { classId: "k1", aujourdhui: "2026-09-15" });
  assert.equal(liste.length, 2);
  for (const x of liste) {
    assert.equal(x.url, undefined, "le lien se délivre à l'ouverture, moment où la consultation se trace");
    assert.equal(x.documentId, undefined);
  }
  assert.equal(liste[1].dureeMoyenneMinutes, 60);
  // Une ressource d'une autre classe n'apparaît pas.
  assert.equal(pourApprenant([r()], { classId: "k2", aujourdhui: "2026-09-15" }).length, 0);
});

// LE TEST CENTRAL.
test("CONSULTER N'EST PAS ÊTRE ASSIDU — une consultation ne justifie jamais d'heures", () => {
  const seance = { id: "s1", date: "2026-10-05", modalite: "distanciel" };
  const inscrits = ["l1", "l2", "l3", "l4"];
  const preuves = [
    { learnerId: "l1", seanceId: "s1", probant: false },   // a ouvert le PDF
    { learnerId: "l1", seanceId: "s1", probant: false },   // deux fois
    { learnerId: "l2", seanceId: "s1", probant: true },    // a rendu l'exercice
    { learnerId: "l3", seanceId: "s1", probant: false },
    // l4 : rien
  ];
  const s = suiviSeance({ seance, inscrits, preuves });

  assert.equal(s.inscrits, 4);
  // Seul celui qui a produit un travail est justifiable.
  assert.equal(s.justifies, 1);
  // Les deux « cliqueurs » sont comptés à part : c'est EXACTEMENT ce qu'un LMS
  // naïf compterait comme présents.
  assert.equal(s.consultationSeule, 2);
  assert.equal(s.sansTrace, 1);

  const l1 = s.lignes.find((x) => x.learnerId === "l1");
  assert.equal(l1.consultations, 2);
  assert.equal(l1.niveau, "consultation");
  assert.equal(l1.justifie, false, "ouvrir deux fois un PDF ne justifie pas deux heures de cours");

  const l2 = s.lignes.find((x) => x.learnerId === "l2");
  assert.equal(l2.niveau, "travail");
  assert.equal(l2.justifie, true);

  // Le module ne prononce jamais le mot « assidu ».
  assert.match(s.reserve, /ne remplacent pas l'émargement/);
  assert.equal(NIVEAUX_PREUVE.consultation.justifie, false);
  assert.match(NIVEAUX_PREUVE.consultation.reserve, /pas d'un temps de formation/);
});

test("les preuves d'une autre séance ne comptent pas, ni celles d'un non-inscrit", () => {
  const s = suiviSeance({
    seance: { id: "s1", modalite: "distanciel" }, inscrits: ["l1"],
    preuves: [
      { learnerId: "l1", seanceId: "s2", probant: true },   // autre séance
      { learnerId: "l9", seanceId: "s1", probant: true },   // pas inscrit
    ],
  });
  assert.equal(s.justifies, 0);
  assert.equal(s.sansTrace, 1);
});

// Les trois composantes de l'article D. 6313-3-1.
test("le dispositif à distance n'est conforme qu'avec référent, durées et jalons", () => {
  const ressources = [
    r({ id: "a", type: "document", aDistance: true, dureeMoyenneMinutes: 30 }),
    r({ id: "b", type: "exercice", aDistance: true, dureeMoyenneMinutes: 60 }),
  ];
  const complet = conformiteFoad({
    dispositif: { referentPedagogique: "M. Sivan", modalitesAssistance: "Par courriel sous 24 h ouvrées" },
    ressources, seancesDistance: 12,
  });
  assert.equal(complet.conforme, true);
  assert.equal(complet.composantes.length, 3);
  assert.ok(complet.composantes.every((c) => c.couverte));
  assert.equal(complet.elementsProbants, 1);

  // Sans référent pédagogique : l'indicateur 19 le nomme explicitement.
  const sansReferent = conformiteFoad({ dispositif: {}, ressources, seancesDistance: 12 });
  assert.equal(sansReferent.conforme, false);
  assert.match(sansReferent.manques.map((m) => m.message).join(" "), /indicateur 19/);

  // Des heures à distance mais aucun exercice ni évaluation : rien ne les justifie.
  const sansJalon = conformiteFoad({
    dispositif: { referentPedagogique: "M. Sivan", modalitesAssistance: "courriel" },
    ressources: [r({ type: "document", aDistance: true, dureeMoyenneMinutes: 30 })],
    seancesDistance: 12,
  });
  assert.equal(sansJalon.conforme, false);
  assert.match(sansJalon.manques.map((m) => m.message).join(" "), /rien ne justifie les heures/);

  // Aucune séance à distance : l'absence de jalon ne se reproche pas.
  const sansDistance = conformiteFoad({
    dispositif: { referentPedagogique: "M. Sivan", modalitesAssistance: "courriel" },
    ressources: [r()], seancesDistance: 0,
  });
  assert.equal(sansDistance.conforme, true);

  for (const c of Object.values(COMPOSANTES_FOAD)) assert.ok(c.label && c.texte);
});

test("une durée moyenne manquante bloque, même avec un référent désigné", () => {
  const c = conformiteFoad({
    dispositif: { referentPedagogique: "M. Sivan", modalitesAssistance: "courriel" },
    ressources: [r({ type: "exercice", aDistance: true })],
    seancesDistance: 5,
  });
  assert.equal(c.conforme, false);
  assert.match(c.manques.map((m) => m.message).join(" "), /durée moyenne/);
  assert.equal(c.composantes.find((x) => x.cle === "information").couverte, false);
});

// Le chiffre qui finit sur une facture ne se déduit pas d'un nombre de clics.
test("les heures justifiables énoncent un RISQUE, pas un score", () => {
  const suivis = [
    suiviSeance({ seance: { id: "s1" }, inscrits: ["l1", "l2"], preuves: [{ learnerId: "l1", seanceId: "s1", probant: true }] }),
    suiviSeance({ seance: { id: "s2" }, inscrits: ["l1", "l2"], preuves: [{ learnerId: "l2", seanceId: "s2", probant: false }] }),
  ];
  const h = heuresJustifiables(suivis);
  assert.equal(h.nbSeances, 2);
  assert.equal(h.participations, 4);
  assert.equal(h.justifiees, 1);
  assert.equal(h.consultationSeule, 1);
  assert.equal(h.sansTrace, 2);
  assert.equal(h.taux, 25);
  assert.match(h.risque, /contrôle de service fait/);

  // Tout justifié : plus de risque à signaler.
  const complet = heuresJustifiables([
    suiviSeance({ seance: { id: "s1" }, inscrits: ["l1"], preuves: [{ learnerId: "l1", seanceId: "s1", probant: true }] }),
  ]);
  assert.equal(complet.taux, 100);
  assert.equal(complet.risque, null);
});

test("les modalités couvrent le cas hybride, pas seulement les deux extrêmes", () => {
  assert.deepEqual(Object.keys(MODALITES), ["presentiel", "distanciel", "hybride"]);
});

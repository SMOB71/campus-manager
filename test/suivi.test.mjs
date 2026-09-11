import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePositionnement, POSITIONNEMENT_MODALITES, PREREQUIS_VERDICTS,
  validateAmenagement, AMENAGEMENT_TYPES, AMENAGEMENT_STATUTS,
  validateSuivi, etatSuivi, SUIVI_TRIPARTITE, CADENCE_DEFAUT_JOURS,
} from "../lib/suivi.js";

// ---------------- Positionnement ----------------

const POS = { date: "2026-08-20", modalite: "entretien", prerequis: "satisfaits", realisePar: "Mme Martin", objectifs: "Viser le bloc 2 en priorité" };

test("positionnement complet accepté", () => {
  const v = validatePositionnement(POS, { debutFormation: "2026-09-01" });
  assert.equal(v.ok, true);
  assert.equal(v.posterieurAuDebut, false);
  assert.deepEqual(v.warnings, []);
});

test("un positionnement daté APRÈS le début de formation ne prouve rien", () => {
  // Il est censé fonder l'individualisation, donc la précéder. Régulariser en
  // fin d'année produit une pièce qui se retourne contre l'organisme.
  const v = validatePositionnement({ ...POS, date: "2027-06-15" }, { debutFormation: "2026-09-01" });
  assert.equal(v.ok, true, "on n'empêche pas de saisir…");
  assert.equal(v.posterieurAuDebut, true, "…mais on le signale");
  assert.ok(v.warnings.some((w) => /après le début de formation/.test(w)));
});

test("positionnement : champs indispensables", () => {
  const v = validatePositionnement({});
  assert.equal(v.ok, false);
  for (const attendu of [/date/, /modalité/, /prérequis/, /auteur/]) {
    assert.ok(v.errors.some((e) => attendu.test(e)), `manque non signalé : ${attendu}`);
  }
  assert.ok(Object.keys(POSITIONNEMENT_MODALITES).includes("mixte"));
  assert.ok(Object.keys(PREREQUIS_VERDICTS).includes("satisfaits_avec_amenagement"));
});

test("prérequis satisfaits « sous réserve d'aménagement » : encore faut-il le décrire", () => {
  const v = validatePositionnement({ ...POS, prerequis: "satisfaits_avec_amenagement" }, { debutFormation: "2026-09-01" });
  assert.ok(v.warnings.some((w) => /aménagement annoncé mais non décrit/.test(w)));
  const decrit = validatePositionnement({ ...POS, prerequis: "satisfaits_avec_amenagement", amenagementPropose: "Parcours en 3 ans" }, { debutFormation: "2026-09-01" });
  assert.equal(decrit.warnings.length, 0);
});

// ---------------- Aménagements ----------------

test("aménagement d'épreuve : l'organisme le DEMANDE, il ne l'accorde pas", () => {
  // Promettre un tiers-temps non obtenu, c'est exposer le candidat le jour J.
  const abusif = validateAmenagement({ type: "epreuve", description: "Tiers-temps", statut: "en_place" });
  assert.equal(abusif.ok, false);
  assert.ok(abusif.errors.some((e) => /accordé par le certificateur/.test(e)));

  // Un aménagement pédagogique, lui, se met en place sans personne.
  const interne = validateAmenagement({ type: "pedagogique", description: "Supports en gros caractères", statut: "en_place" });
  assert.equal(interne.ok, true);
  assert.equal(AMENAGEMENT_TYPES.pedagogique.demandeExterne, false);
  assert.equal(AMENAGEMENT_TYPES.epreuve.demandeExterne, true);
});

test("aménagement d'épreuve : non demandé, ou accordé sans référence → averti", () => {
  const envisage = validateAmenagement({ type: "epreuve", description: "Tiers-temps", statut: "envisage" });
  assert.equal(envisage.ok, true);
  assert.ok(envisage.warnings.some((w) => /non encore demandé au certificateur/.test(w)));

  const sansRef = validateAmenagement({ type: "epreuve", description: "Tiers-temps", statut: "accorde" });
  assert.ok(sansRef.warnings.some((w) => /sans référence de la décision/.test(w)));

  const avecRef = validateAmenagement({ type: "epreuve", description: "Tiers-temps", statut: "accorde", referenceDecision: "Rectorat 2026-1187" });
  assert.deepEqual(avecRef.warnings, []);
  assert.ok(Object.keys(AMENAGEMENT_STATUTS).includes("refuse"));
});

test("RGPD : les données de santé sont activement REFUSÉES, pas seulement déconseillées", () => {
  // La donnée utile à l'organisation est ce qu'il faut mettre en place, pas le
  // diagnostic. Le refuser en amont évite de constituer un traitement art. 9.
  for (const champ of ["diagnostic", "pathologie", "natureHandicap", "documentMedical"]) {
    const v = validateAmenagement({ type: "pedagogique", description: "Salle au rez-de-chaussée", [champ]: "quelque chose" });
    assert.equal(v.ok, false, `${champ} doit être refusé`);
    assert.ok(v.errors.some((e) => /donnée de santé refusée/.test(e)));
  }
  assert.equal(validateAmenagement({ type: "pedagogique", description: "Salle au rez-de-chaussée" }).ok, true);
});

// ---------------- Suivi tripartite ----------------

test("seule une rencontre associant l'entreprise vaut suivi de l'alternance", () => {
  assert.equal(SUIVI_TRIPARTITE.has("visite"), true);
  assert.equal(SUIVI_TRIPARTITE.has("entretien"), true);
  // Un appel avec le seul apprenti documente l'accompagnement, pas la liaison
  // avec le maître d'apprentissage.
  assert.equal(SUIVI_TRIPARTITE.has("appel"), false);
  assert.equal(SUIVI_TRIPARTITE.has("visio"), false);

  const e = etatSuivi({
    suivis: [{ type: "appel", date: "2027-01-10" }, { type: "visio", date: "2027-02-10" }],
    debut: "2026-09-01", aujourdhui: "2027-03-15",
  });
  assert.equal(e.tripartites, 0);
  assert.equal(e.autresContacts, 2, "on les compte, sans les faire passer pour ce qu'ils ne sont pas");
  assert.ok(e.alerte);
});

test("cadence : le compteur part de la dernière rencontre, ou du début du parcours", () => {
  const aJour = etatSuivi({ suivis: [{ type: "visite", date: "2027-02-01" }], debut: "2026-09-01", aujourdhui: "2027-03-15" });
  assert.equal(aJour.enRetard, false);
  assert.equal(aJour.alerte, null);
  assert.equal(aJour.dernier.date, "2027-02-01");

  const enRetard = etatSuivi({ suivis: [{ type: "visite", date: "2026-09-10" }], debut: "2026-09-01", aujourdhui: "2027-06-01" });
  assert.equal(enRetard.enRetard, true);
  assert.match(enRetard.alerte, /Dernière rencontre en entreprise il y a \d+ jours/);

  const jamais = etatSuivi({ suivis: [], debut: "2026-09-01", aujourdhui: "2027-06-01" });
  assert.match(jamais.alerte, /Aucune rencontre en entreprise depuis le début/);
  assert.equal(jamais.cadenceJours, CADENCE_DEFAUT_JOURS);
});

test("rupture engagée sans visite récente : l'alerte change de nature", () => {
  // Ce n'est plus une cadence à tenir, c'est le dossier qu'un financeur
  // épluchera en premier.
  const jamaisVu = etatSuivi({ suivis: [], debut: "2026-09-01", aujourdhui: "2026-11-01", ruptureOuverte: true });
  assert.match(jamaisVu.alerte, /Rupture engagée et aucune rencontre en entreprise n'a jamais eu lieu/);

  const vieilleVisite = etatSuivi({ suivis: [{ type: "visite", date: "2026-05-01" }], debut: "2026-01-01", aujourdhui: "2026-11-01", ruptureOuverte: true });
  assert.match(vieilleVisite.alerte, /Rupture engagée et aucune rencontre en entreprise depuis \d+ jours/);

  // Une visite récente, même avec rupture ouverte, ne déclenche pas cette alerte.
  const recente = etatSuivi({ suivis: [{ type: "visite", date: "2026-10-20" }], debut: "2026-01-01", aujourdhui: "2026-11-01", ruptureOuverte: true });
  assert.equal(recente.alerte, null);
});

test("suivi : un compte rendu vide et des difficultés sans action sont signalés", () => {
  const v = validateSuivi({ date: "2027-01-10", type: "visite", realisePar: "M. Dupont" });
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /compte rendu vide/.test(w)));
  assert.ok(v.warnings.some((w) => /tuteur non identifié/.test(w)));

  const difficile = validateSuivi({ date: "2027-01-10", type: "visite", realisePar: "M. Dupont", tuteur: "Mme X", compteRendu: "tendu", difficultes: "conflit d'horaires" });
  assert.ok(difficile.warnings.some((w) => /difficultés signalées sans action décidée/.test(w)));

  const complet = validateSuivi({ date: "2027-01-10", type: "visite", realisePar: "M. Dupont", tuteur: "Mme X", compteRendu: "ok", difficultes: "horaires", actions: "réunion le 20" });
  assert.deepEqual(complet.warnings, []);
  assert.equal(validateSuivi({}).ok, false);
});

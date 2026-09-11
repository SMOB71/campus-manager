import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReclamation, etatReclamation, registreReclamations, RECLAMATION_KINDS, DELAI_REPONSE_JOURS,
  validateSousTraitant, registreSousTraitance, SOUS_TRAITANCE_PERIMETRES,
} from "../lib/qualite.js";

const R = { date: "2026-09-01", origine: "apprenant", nature: "pedagogique", objet: "Cours annulés non rattrapés" };

test("réclamation : champs indispensables", () => {
  assert.equal(validateReclamation(R).ok, true);
  const v = validateReclamation({});
  assert.equal(v.ok, false);
  for (const attendu of [/date/, /origine/, /nature/, /objet/]) {
    assert.ok(v.errors.some((e) => attendu.test(e)), `manque non signalé : ${attendu}`);
  }
});

test("clore une réclamation exige une réponse écrite ET sa date", () => {
  // Une clôture sans réponse, c'est un dossier rangé, pas traité.
  const sansReponse = validateReclamation({ ...R, statut: "close" });
  assert.equal(sansReponse.ok, false);
  assert.ok(sansReponse.errors.some((e) => /porter la réponse apportée/.test(e)));
  assert.ok(sansReponse.errors.some((e) => /date de réponse requise/.test(e)));

  const complete = validateReclamation({ ...R, statut: "close", reponse: "Rattrapage programmé", dateReponse: "2026-09-08", actionCorrective: "Procédure de rattrapage sous 15 j" });
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.warnings, []);
});

test("close sans action corrective : traitée, mais pas exploitée", () => {
  // C'est le point qu'on oublie, et celui que l'auditeur relève.
  const v = validateReclamation({ ...R, statut: "close", reponse: "Réponse faite", dateReponse: "2026-09-05" });
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /pas exploitée/.test(w)));
});

test("une réponse ne peut pas précéder la réclamation", () => {
  const v = validateReclamation({ ...R, statut: "repondue", reponse: "x", dateReponse: "2026-08-01" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /ne peut pas précéder/.test(e)));
});

test("délai : ouvert hors délai = écart en cours ; clos hors délai = écart constaté", () => {
  const ouverteOk = etatReclamation({ ...R, statut: "en_cours" }, "2026-09-10");
  assert.equal(ouverteOk.horsDelai, false);
  assert.equal(ouverteOk.alerte, null);

  const ouverteTard = etatReclamation({ ...R, statut: "en_cours" }, "2026-10-15");
  assert.equal(ouverteTard.close, false);
  assert.equal(ouverteTard.horsDelai, true);
  assert.match(ouverteTard.alerte, /Sans réponse depuis \d+ jours/);

  const closeTard = etatReclamation({ ...R, statut: "close", dateReponse: "2026-10-01" }, "2026-10-15");
  assert.equal(closeTard.close, true);
  assert.equal(closeTard.joursEcoules, 30, "le délai se mesure jusqu'à la réponse, pas jusqu'à aujourd'hui");
  assert.match(closeTard.alerte, /Réponse apportée en 30 jours/);
  assert.equal(closeTard.delaiJours, DELAI_REPONSE_JOURS);
});

test("registre : c'est la synthèse qu'on présente en audit", () => {
  const reg = registreReclamations([
    { ...R, statut: "close", dateReponse: "2026-09-06", reponse: "ok", actionCorrective: "revue du planning" },
    { ...R, date: "2026-09-02", statut: "close", dateReponse: "2026-09-30", reponse: "ok" },   // hors délai, sans action
    { ...R, date: "2026-09-20", statut: "en_cours" },
    { ...R, date: "2026-09-25", nature: "certification", kind: "appel", statut: "recue" },
  ], "2026-09-28");

  assert.equal(reg.total, 4);
  assert.equal(reg.closes, 2);
  assert.equal(reg.ouvertes, 2);
  assert.equal(reg.horsDelai, 1);
  assert.equal(reg.sansActionCorrective, 1);
  assert.equal(reg.delaiMoyen, 16.5, "(5 + 28) / 2");
  assert.equal(reg.appels, 1);
  assert.ok(reg.parNature.find((n) => n.nature === "certification"));
  // Un appel n'est pas une réclamation : contester une note ne se traite pas
  // comme se plaindre d'un planning.
  assert.deepEqual(Object.keys(RECLAMATION_KINDS), ["reclamation", "appel"]);
});

test("registre vide : la synthèse ne prétend pas que tout va bien", () => {
  const reg = registreReclamations([], "2026-09-28");
  assert.equal(reg.total, 0);
  assert.equal(reg.delaiMoyen, null, "aucune moyenne inventée sur zéro donnée");
  assert.deepEqual(reg.parNature, []);
});

// ---------------- Sous-traitance ----------------

const S = { nom: "Studio Optique Formation", perimetre: "pedagogique", prestation: "Animation des TP d'optique" };

test("sous-traitant : identité, périmètre et prestation sont exigés", () => {
  assert.equal(validateSousTraitant(S).ok, true);
  const v = validateSousTraitant({});
  assert.equal(v.ok, false);
  for (const attendu of [/raison sociale/, /périmètre/, /prestation/]) {
    assert.ok(v.errors.some((e) => attendu.test(e)));
  }
  assert.ok(Object.keys(SOUS_TRAITANCE_PERIMETRES).includes("certification"));
});

test("actions financées sous-traitées à un non-certifié : c'est le donneur d'ordre qui rembourse", () => {
  const risque = validateSousTraitant({ ...S, actionsFinancees: true, certifie: false });
  assert.equal(risque.ok, true, "on n'interdit pas de l'enregistrer…");
  assert.ok(risque.warnings.some((w) => /prise en charge peut être refusée/.test(w)), "…mais on dit ce que ça coûte");

  const sain = validateSousTraitant({ ...S, actionsFinancees: true, certifie: true, numeroDeclaration: "11 75 1", siret: "1", contrat: "Contrat 2026-14" });
  assert.deepEqual(sain.warnings, []);
});

test("sous-traitant : contrat manquant et certification sans numéro signalés", () => {
  const v = validateSousTraitant({ ...S, siret: "1", certifie: true });
  assert.ok(v.warnings.some((w) => /aucun contrat de sous-traitance/.test(w)));
  assert.ok(v.warnings.some((w) => /sans numéro de déclaration/.test(w)));
  // Une pièce en GED vaut contrat au dossier
  const avecPiece = validateSousTraitant({ ...S, siret: "1", documentId: "doc1" });
  assert.equal(avecPiece.warnings.some((w) => /aucun contrat/.test(w)), false);
});

test("dates incohérentes refusées", () => {
  const v = validateSousTraitant({ ...S, dateDebut: "2026-09-01", dateFin: "2026-08-01" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /antérieure à la date de début/.test(e)));
});

test("registre sous-traitance : ce que l'auditeur cherche en premier", () => {
  const reg = registreSousTraitance([
    { ...S, actionsFinancees: true, certifie: false, contrat: "C1" },
    { ...S, nom: "Autre OF", actionsFinancees: true, certifie: true, contrat: "C2" },
    { ...S, nom: "Ancien", dateFin: "2025-12-31", contrat: "C3" },
  ], "2026-09-28");
  assert.equal(reg.total, 3);
  assert.equal(reg.actifs, 2, "un contrat échu ne compte plus parmi les actifs");
  assert.deepEqual(reg.aRisque, ["Studio Optique Formation"]);
  assert.deepEqual(reg.sansContrat, []);
  assert.equal(reg.parPerimetre[0].total, 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmctr-"));
process.env.DATA_KEY = "test-key-contracts";
const store = await import("../lib/store.js");
const { validateContract, contractAlerts, minimumWage, isValidSiret, ageAt, effectiveDateOfBirthdayRaise,
  trialPeriodEnd, practicalDaysCount, startingExecutionYear, contractYears, SMIC_MENSUEL_DEFAUT } = await import("../lib/contracts.js");

// ---------- Logique réglementaire (pure) ----------

test("ageAt : âge révolu à la date de début, anniversaire non atteint", () => {
  assert.equal(ageAt("2008-09-15", "2026-09-01"), 17); // anniversaire pas encore passé
  assert.equal(ageAt("2008-09-01", "2026-09-01"), 18); // pile le jour
  assert.equal(ageAt("", "2026-09-01"), null);
});

test("isValidSiret : clé de Luhn", () => {
  assert.equal(isValidSiret("73282932000074"), true);  // SIRET de test valide
  assert.equal(isValidSiret("73282932000075"), false); // clé cassée
  assert.equal(isValidSiret("1234"), false);
  assert.equal(isValidSiret(""), false);
});

test("minimumWage apprentissage : grille par tranche d'âge et année d'exécution", () => {
  const smic = 1800;
  assert.equal(minimumWage({ age: 17, year: 1, smic }).rate, 0.27);
  assert.equal(minimumWage({ age: 19, year: 1, smic }).rate, 0.43);
  assert.equal(minimumWage({ age: 22, year: 2, smic }).rate, 0.61);
  assert.equal(minimumWage({ age: 30, year: 1, smic }).rate, 1.0); // 26+ = 100 % du SMIC
  assert.equal(minimumWage({ age: 19, year: 1, smic }).amount, 774); // 0.43 × 1800
  assert.equal(minimumWage({ age: null }), null);
  // année hors bornes ramenée dans la grille
  assert.equal(minimumWage({ age: 19, year: 9, smic }).year, 3);
});

test("SMIC par défaut : valeur officielle en vigueur (12,31 €/h → 1 867,02 €)", () => {
  // Vérifié sur service-public.gouv.fr le 7 septembre 2026. Ce test échouera à la
  // prochaine revalorisation : c'est voulu, il sert de rappel de veille.
  assert.equal(SMIC_MENSUEL_DEFAUT, 1867.02);
  assert.equal(minimumWage({ age: 30, year: 1 }).amount, 1867.02);
});

test("minimumWage professionnalisation : grille distincte, selon âge et qualification", () => {
  const smic = 1800;
  // Moins de 21 ans : 55 %, ou 65 % avec un bac pro ou équivalent
  assert.equal(minimumWage({ age: 19, type: "professionnalisation", smic }).rate, 0.55);
  assert.equal(minimumWage({ age: 19, type: "professionnalisation", qualifie: true, smic }).rate, 0.65);
  // 21 à 25 ans : 70 % / 80 %
  assert.equal(minimumWage({ age: 23, type: "professionnalisation", smic }).rate, 0.70);
  assert.equal(minimumWage({ age: 23, type: "professionnalisation", qualifie: true, smic }).rate, 0.80);
  // 26 ans et plus : SMIC entier
  assert.equal(minimumWage({ age: 30, type: "professionnalisation", smic }).amount, 1800);
  // L'année d'exécution n'intervient pas en professionnalisation
  assert.equal(minimumWage({ age: 19, type: "professionnalisation", smic }).year, null);
  // La grille pro est bien DIFFÉRENTE de l'apprentissage au même âge
  assert.notEqual(
    minimumWage({ age: 19, year: 1, smic }).rate,
    minimumWage({ age: 19, type: "professionnalisation", smic }).rate,
  );
});

test("minimum conventionnel (SMC) : prime dès 21 ans s'il est plus favorable", () => {
  const smic = 1800, smc = 2200;
  // Apprenti de 22 ans, année 2 : 61 % appliqué au SMC, plus favorable que le SMIC
  const avec = minimumWage({ age: 22, year: 2, smic, smc });
  assert.equal(avec.amount, Math.round(0.61 * 2200 * 100) / 100);
  assert.equal(avec.base, "minimum conventionnel");
  // Avant 21 ans, le SMC ne s'applique pas
  assert.equal(minimumWage({ age: 19, year: 1, smic, smc }).base, "SMIC");
  // Un SMC moins favorable ne dégrade jamais le minimum légal
  assert.equal(minimumWage({ age: 22, year: 2, smic, smc: 1000 }).base, "SMIC");
  // Professionnalisation 26+ : plancher = SMIC entier OU 85 % du SMC
  const pro = minimumWage({ age: 30, type: "professionnalisation", smic, smc: 2500 });
  assert.equal(pro.amount, Math.round(0.85 * 2500 * 100) / 100); // 2125 > 1800
  assert.equal(pro.base, "85 % du minimum conventionnel");
});

test("effectiveDateOfBirthdayRaise : effet au 1er du mois SUIVANT l'anniversaire", () => {
  // Règle officielle (service-public F2918) — l'erreur classique est de couper au
  // jour de l'anniversaire.
  assert.equal(effectiveDateOfBirthdayRaise("2026-09-15"), "2026-10-01");
  assert.equal(effectiveDateOfBirthdayRaise("2026-09-01"), "2026-10-01"); // même le 1er
  assert.equal(effectiveDateOfBirthdayRaise("2026-12-20"), "2027-01-01"); // passage d'année
  assert.equal(effectiveDateOfBirthdayRaise(""), null);
});

const LEARNER = { id: "l1", prenom: "Léa", nom: "Dupont", dateNaissance: "2006-05-10", ine: "1234ABC" };
const COMPANY = { id: "co1", name: "Optique Martin", siret: "73282932000074", conventionCollective: "Optique-lunetterie" };
const BASE = {
  learnerId: "l1", companyId: "co1", type: "apprentissage",
  dateDebut: "2026-09-01", dateFin: "2028-08-31", anneeExecution: 1,
  maitreNom: "Paul Martin", maitreEmail: "paul@optique.fr", npec: 8200,
};

test("validateContract : contrat conforme → aucune erreur", () => {
  const v = validateContract(BASE, { learner: LEARNER, company: COMPANY });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
  assert.equal(v.wage.bracket, "18-20"); // 20 ans au 01/09/2026
});

test("validateContract : dates incohérentes et durée trop courte bloquent", () => {
  const inverse = validateContract({ ...BASE, dateFin: "2026-08-01" }, { learner: LEARNER, company: COMPANY });
  assert.ok(inverse.errors.some((e) => /fin précède/.test(e)));
  const court = validateContract({ ...BASE, dateFin: "2026-11-01" }, { learner: LEARNER, company: COMPANY });
  assert.ok(court.errors.some((e) => /6 mois/.test(e)));
});

test("validateContract : rémunération sous le minimum légal bloque, avec le calcul", () => {
  const v = validateContract({ ...BASE, remunerationMensuelle: 400 }, { learner: LEARNER, company: COMPANY, smic: 1800 });
  assert.equal(v.ok, false);
  const err = v.errors.find((e) => /minimum légal/.test(e));
  assert.ok(err);
  assert.match(err, /43 % du SMIC/);
  assert.match(err, /année 1/);
  // au niveau exact du minimum : accepté
  const ok = validateContract({ ...BASE, remunerationMensuelle: 774 }, { learner: LEARNER, company: COMPANY, smic: 1800 });
  assert.equal(ok.ok, true);
});

test("validateContract : SIRET invalide, maître d'apprentissage absent, apprenti trop jeune", () => {
  const v = validateContract({ ...BASE, maitreNom: "" }, { learner: { ...LEARNER, dateNaissance: "2011-01-01" }, company: { ...COMPANY, siret: "00000000000000" } });
  assert.ok(v.errors.some((e) => /SIRET invalide/.test(e)));
  assert.ok(v.errors.some((e) => /Maître d'apprentissage/.test(e)));
  assert.ok(v.errors.some((e) => /16 ans minimum/.test(e)));
});

test("validateContract : avertissements non bloquants (INE, convention, âge > 29)", () => {
  const v = validateContract(BASE, {
    learner: { ...LEARNER, ine: "", dateNaissance: "1994-01-01" },
    company: { ...COMPANY, conventionCollective: "" },
  });
  assert.equal(v.ok, true); // aucun blocage
  assert.ok(v.warnings.some((w) => /INE/.test(w)));
  assert.ok(v.warnings.some((w) => /Convention collective/.test(w)));
  assert.ok(v.warnings.some((w) => /dérogation est requise/.test(w)));
});

test("période d'essai : 45 jours de formation PRATIQUE, pas 45 jours calendaires", () => {
  // Rythme 2 semaines CFA / 2 semaines entreprise à partir du 01/09/2026.
  const cfaDays = new Set();
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 8, 1) + i * 864e5);
    const semaine = Math.floor(i / 7);
    if (semaine % 4 < 2) cfaDays.add(d.toISOString().slice(0, 10)); // 2 semaines sur 4 au centre
  }
  const fin = trialPeriodEnd({ dateDebut: "2026-09-01", dateFin: "2028-08-31", cfaDays });
  assert.ok(fin, "la fin de période d'essai doit être atteignable");
  // En calendaire, 45 jours donneraient le 16/10/2026 ; en jours d'entreprise, il
  // faut environ quatre mois — c'est tout l'enjeu de la correction.
  assert.ok(fin > "2026-12-15", `attendu bien après le calendaire, obtenu ${fin}`);

  // Sans planning, on ne devine pas : aucune alerte plutôt qu'une alerte fausse.
  assert.equal(trialPeriodEnd({ dateDebut: "2026-09-01", cfaDays: null }), null);
  const sansPlanning = contractAlerts({ status: "valide", dateDebut: "2026-08-01", dateFin: "2028-08-31", dateDepot: "2026-08-02" }, "2026-09-10");
  assert.ok(!sansPlanning.some((a) => a.type === "essai"));

  // Le décompte ignore week-ends et jours au centre
  const faits = practicalDaysCount({ dateDebut: "2026-09-01", until: "2026-09-30", cfaDays });
  assert.ok(faits > 0 && faits < 22, `jours en entreprise sur septembre : ${faits}`);
});

test("alertes de dépôt : 5 jours ouvrables, puis relance d'instruction", () => {
  // Contrat démarré, jamais déposé : alerte, qui monte en gravité après 5 jours
  const recent = contractAlerts({ status: "valide", dateDebut: "2026-09-08", dateFin: "2028-08-31" }, "2026-09-10");
  const dep = recent.find((a) => a.type === "depot");
  assert.ok(dep && dep.severity === "medium");
  const tardif = contractAlerts({ status: "valide", dateDebut: "2026-08-01", dateFin: "2028-08-31" }, "2026-09-10");
  const retard = tardif.find((a) => a.type === "depot");
  assert.ok(retard && retard.severity === "high");
  assert.match(retard.label, /financement menacé/);
  // Déposé sans retour de l'opérateur : relance
  const attente = contractAlerts({ status: "depose", dateDebut: "2026-08-01", dateFin: "2028-08-31", dateDepot: "2026-08-05" }, "2026-09-10");
  assert.ok(attente.some((a) => a.type === "instruction"));
  // Déposé ET validé : plus aucune alerte de dépôt
  const ok = contractAlerts({ status: "valide", dateDebut: "2026-08-01", dateFin: "2028-08-31", dateDepot: "2026-08-05", dateValidation: "2026-08-20" }, "2026-09-10");
  assert.ok(!ok.some((a) => a.type === "depot" || a.type === "instruction"));
});

test("contractAlerts : fin de contrat, contrat échu, rupture", () => {
  const fin = contractAlerts({ status: "valide", dateDebut: "2024-09-01", dateFin: "2026-10-01", dateDepot: "2024-09-02", dateValidation: "2024-09-20" }, "2026-09-10");
  assert.ok(fin.some((a) => a.type === "fin"));
  const echu = contractAlerts({ status: "valide", dateDebut: "2024-09-01", dateFin: "2026-08-01", dateDepot: "2024-09-02", dateValidation: "2024-09-20" }, "2026-09-10");
  assert.ok(echu.some((a) => a.type === "echu"));
  const rompu = contractAlerts({ status: "rompu", dateFin: "2026-10-01" }, "2026-09-10");
  assert.equal(rompu.length, 0); // un contrat rompu n'alerte plus
  const rupt = contractAlerts({ status: "valide", rupture: { stage: "mediation", since: "2026-09-01" } }, "2026-09-10");
  assert.ok(rupt.some((a) => a.type === "rupture" && a.severity === "high"));
});

// ---------- Store : workflow de rupture ----------

test("contrat de durée réduite : l'année d'exécution ne repart pas à 1", () => {
  // BTS (cycle de 2 ans) préparé en 1 an : l'apprenti est réputé avoir fait la
  // 1re année, sa rémunération est celle de la 2e. Cas MAJORITAIRE en post-bac.
  assert.equal(startingExecutionYear({ dureeCycleAnnees: 2, dureeContratAnnees: 1 }), 2);
  // Cycle de 3 ans en 1 an : 3e année
  assert.equal(startingExecutionYear({ dureeCycleAnnees: 3, dureeContratAnnees: 1 }), 3);
  // Contrat couvrant tout le cycle : départ normal
  assert.equal(startingExecutionYear({ dureeCycleAnnees: 2, dureeContratAnnees: 2 }), 1);
  // Saisie explicite de l'année d'entrée : elle prime
  assert.equal(startingExecutionYear({ dureeCycleAnnees: 3, dureeContratAnnees: 3, anneeEntree: 2 }), 2);
  // Données absentes : on ne devine pas, on reste en année 1
  assert.equal(startingExecutionYear({}), 1);

  assert.equal(contractYears("2026-09-01", "2027-08-31"), 1);
  assert.equal(contractYears("2026-09-01", "2028-08-31"), 2);
  assert.equal(contractYears("2026-09-01", "2026-01-01"), null);

  // Effet réel sur le contrôle : 19 ans, BTS en 1 an → taux de 2e année (51 %),
  // et non de 1re (43 %). Un salaire calculé à 43 % serait sous le minimum légal.
  const learner = { ...LEARNER, dateNaissance: "2007-01-10" };
  const court = { ...BASE, dateFin: "2027-08-31", dureeCycleAnnees: 2, remunerationMensuelle: 774 };
  const v = validateContract(court, { learner, company: COMPANY, smic: 1800 });
  assert.equal(v.wage.year, 2);
  assert.equal(v.wage.rate, 0.51);
  assert.ok(v.errors.some((e) => /minimum légal/.test(e)), "774 € (43 %) doit être refusé pour une 2e année");
});

test("rupture : signalement unique, étapes tracées, confirmation répercutée sur l'inscription", () => {
  const campus = store.addCampus({ name: "Campus Contrat" });
  const learner = store.addLearner({ campusId: campus.id, nom: "Roux", prenom: "Max" });
  store.addEnrollment({ learnerId: learner.id, campusId: campus.id, schoolYear: "2026-2027" });
  const company = store.addPartner({ campusId: campus.id, name: "Entreprise X", siret: "73282932000074" });
  const c = store.addContract({ campusId: campus.id, learnerId: learner.id, companyId: company.id, type: "apprentissage", dateDebut: "2026-09-01", dateFin: "2028-08-31" });

  const opened = store.openRupture(c.id, { motif: "Absences répétées signalées par le tuteur", origine: "entreprise", by: "dir" });
  assert.equal(opened.rupture.stage, "signalee");
  assert.equal(opened.rupture.events.length, 1);
  // un second signalement sur une rupture en cours est refusé
  assert.ok(store.openRupture(c.id, { motif: "doublon", by: "dir" }).error);

  const med = store.advanceRupture(c.id, { stage: "mediation", note: "RDV tripartite le 20/09", owner: "Chargé alternance", by: "dir" });
  assert.equal(med.rupture.stage, "mediation");
  assert.equal(med.rupture.owner, "Chargé alternance");
  assert.equal(med.rupture.events.length, 2);
  assert.ok(store.advanceRupture(c.id, { stage: "n_importe_quoi" }).error);

  // Confirmation : le contrat passe en rompu ET l'inscription bascule
  const conf = store.advanceRupture(c.id, { stage: "confirmee", note: "Rupture actée", by: "dir" });
  assert.equal(conf.status, "rompu");
  assert.ok(conf.rupture.dateRupture);
  const enr = store.listEnrollments({ learnerId: learner.id })[0];
  assert.equal(enr.statut, "rupture");
  assert.ok(enr.dateSortie);
});

test("rupture résolue : le contrat reste actif (c'est le résultat recherché)", () => {
  const campus = store.addCampus({ name: "Campus Resolu" });
  const learner = store.addLearner({ campusId: campus.id, nom: "Petit", prenom: "Ana" });
  store.addEnrollment({ learnerId: learner.id, campusId: campus.id, schoolYear: "2026-2027" });
  const c = store.addContract({ campusId: campus.id, learnerId: learner.id, companyId: "co", dateDebut: "2026-09-01", dateFin: "2028-08-31" });
  store.openRupture(c.id, { motif: "Conflit avec le tuteur", by: "dir" });
  const resolu = store.advanceRupture(c.id, { stage: "resolue", note: "Médiation réussie, apprenti maintenu", by: "dir" });
  assert.equal(resolu.status, "brouillon"); // le statut du contrat n'a pas été rompu
  assert.equal(store.listEnrollments({ learnerId: learner.id })[0].statut, "inscrit");
  // et une nouvelle rupture redevient possible plus tard
  assert.ok(!store.openRupture(c.id, { motif: "nouvelle difficulté", by: "dir" }).error);
});

test("listContracts : filtre enRupture ne retient que les ruptures ouvertes", () => {
  const enCours = store.listContracts({ enRupture: true });
  assert.ok(enCours.every((c) => c.rupture && !["resolue", "confirmee"].includes(c.rupture.stage)));
});

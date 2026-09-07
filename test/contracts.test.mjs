import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmctr-"));
process.env.DATA_KEY = "test-key-contracts";
const store = await import("../lib/store.js");
const { validateContract, contractAlerts, minimumWage, isValidSiret, ageAt } = await import("../lib/contracts.js");

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

test("minimumWage : grille par tranche d'âge et année d'exécution", () => {
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

test("contractAlerts : période d'essai, fin de contrat, contrat échu, rupture", () => {
  const essai = contractAlerts({ status: "valide", dateDebut: "2026-08-01", dateFin: "2028-08-31" }, "2026-09-10");
  assert.ok(essai.some((a) => a.type === "essai"));
  const fin = contractAlerts({ status: "valide", dateDebut: "2024-09-01", dateFin: "2026-10-01" }, "2026-09-10");
  assert.ok(fin.some((a) => a.type === "fin"));
  const echu = contractAlerts({ status: "valide", dateDebut: "2024-09-01", dateFin: "2026-08-01" }, "2026-09-10");
  assert.ok(echu.some((a) => a.type === "echu"));
  const rompu = contractAlerts({ status: "rompu", dateFin: "2026-10-01" }, "2026-09-10");
  assert.equal(rompu.length, 0); // un contrat rompu n'alerte plus
  const rupt = contractAlerts({ status: "valide", rupture: { stage: "mediation", since: "2026-09-01" } }, "2026-09-10");
  assert.ok(rupt.some((a) => a.type === "rupture" && a.severity === "high"));
});

// ---------- Store : workflow de rupture ----------

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

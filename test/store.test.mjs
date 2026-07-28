import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store isolé : DATA_DIR temporaire + chiffrement actif. À définir AVANT l'import du store.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmtest-"));
process.env.DATA_KEY = "test-key-abc123";
const store = await import("../lib/store.js");
const { buildOpeningTasks, buildOpeningBudget } = await import("../lib/calc.js");

test("campus : create + list", () => {
  const c = store.addCampus({ name: "Test Nantes", city: "Nantes" });
  assert.ok(c.id);
  assert.ok(store.listCampuses().some((x) => x.id === c.id));
});

test("addKpi : merge par (campus, mois) sans écraser les champs absents", () => {
  const c = store.addCampus({ name: "KpiCampus" });
  store.addKpi({ campusId: c.id, month: "2026-06", students: 200, occupancy: 80, revenue: 100000 });
  store.addKpi({ campusId: c.id, month: "2026-06", payroll: 55000, charges: 25000 }); // 2e écriture partielle
  const k = store.latestKpi(c.id);
  assert.equal(k.students, 200);      // conservé
  assert.equal(k.revenue, 100000);    // conservé
  assert.equal(k.payroll, 55000);     // ajouté
  assert.equal(k.charges, 25000);
  // un seul enregistrement pour ce mois
  assert.equal(store.listKpi(c.id).filter((x) => x.month === "2026-06").length, 1);
});

test("setKpiPostes : l'agrégat du poste = somme des sous-lignes", () => {
  const c = store.addCampus({ name: "PostesCampus" });
  store.setKpiPostes(c.id, "2026-05", "charges", [{ label: "Loyer", amount: 12000 }, { label: "Énergie", amount: 3000 }]);
  const k = store.listKpi(c.id).find((x) => x.month === "2026-05");
  assert.equal(k.charges, 15000);
  assert.equal(k.postes.charges.length, 2);
  assert.equal(store.setKpiPostes(c.id, "2026-05", "invalide", []), null); // poste inconnu
});

test("openings : create + seed tâches + budget", () => {
  const o = store.addOpening({ name: "Ouv Rennes", city: "Rennes", targetDate: "2027-09-06", budget: 500000 });
  store.setOpeningTasks(o.id, buildOpeningTasks(o.targetDate));
  const got = store.getOpening(o.id);
  assert.ok(got.tasks.length > 30);
  store.setOpeningBudget(o.id, buildOpeningBudget(500000));
  assert.equal(store.getOpening(o.id).budgetLines.find((l) => l.lot === "travaux").planned, 200000);
});

test("openings : lien campus (conversion) sans doublon", () => {
  const o = store.addOpening({ name: "Ouv Lyon", targetDate: "2027-09-06" });
  const c = store.addCampus({ name: "Lyon issu ouverture" });
  store.setOpeningCampus(o.id, c.id);
  assert.equal(store.getOpening(o.id).campusId, c.id);
});

test("scenarios : create + list + delete", () => {
  const s = store.addScenario({ name: "Cible 2026", target: 1500000, rows: [{ id: "x", rev: 600000, pay: 300000, chg: 120000 }] });
  assert.ok(store.listScenarios().some((x) => x.id === s.id));
  store.deleteScenario(s.id);
  assert.ok(!store.listScenarios().some((x) => x.id === s.id));
});

test("backup + restore : rollback d'un état", () => {
  const c = store.addCampus({ name: "AvantBackup" });
  const snap = store.backupNow();
  store.deleteCampus(c.id);
  assert.ok(!store.listCampuses().some((x) => x.id === c.id)); // supprimé
  const r = store.restoreBackup(snap);
  assert.equal(r.ok, true);
  assert.ok(store.listCampuses().some((x) => x.id === c.id)); // revenu
  assert.deepEqual(store.restoreBackup("../../etc/passwd"), { error: "nom de sauvegarde invalide" });
});

test("documents : indicateur Qualiopi filtrable", () => {
  const c = store.addCampus({ name: "DocCampus" });
  store.addDocument({ campusId: c.id, name: "preuve1.pdf", indicator: "3", file: "f1" });
  store.addDocument({ campusId: c.id, name: "autre.pdf", indicator: "7", file: "f2" });
  assert.equal(store.listDocuments(c.id, "3").length, 1);
  assert.equal(store.listDocuments(c.id, "3")[0].name, "preuve1.pdf");
  assert.equal(store.listDocuments(c.id).length, 2);
});

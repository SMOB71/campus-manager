import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmgrd-"));
process.env.DATA_KEY = "test-key-grades";
const store = await import("../lib/store.js");
const { weightedAverage, normalized, isCounted, learnerReport, mention, classStats, ranking, blockReport, certificationSummary } = await import("../lib/grades.js");

// ---------- Règles de calcul ----------

test("isCounted : une absence n'est pas un zéro, sauf décision explicite", () => {
  assert.equal(isCounted({ score: 12 }), true);
  assert.equal(isCounted({ score: null }), false);
  assert.equal(isCounted({ score: "", absent: false }), false);
  assert.equal(isCounted({ absent: true, score: null }), false);
  // l'équipe peut sanctionner explicitement une absence
  assert.equal(isCounted({ absent: true, zeroSiAbsent: true, score: null }), false);
  assert.equal(isCounted({ absent: true, zeroSiAbsent: true, score: 0 }), true);
});

test("normalized : ramène toute note sur 20", () => {
  assert.equal(normalized({ score: 20 }, { maxScore: 40 }), 10);
  assert.equal(normalized({ score: 8 }, { maxScore: 10 }), 16);
  assert.equal(normalized({ score: 15 }, {}), 15); // barème par défaut = 20
  assert.equal(normalized({ absent: true, zeroSiAbsent: true, score: null }, { maxScore: 20 }), 0);
  assert.equal(normalized({ score: "abc" }, { maxScore: 20 }), null);
});

test("weightedAverage : pondération, coefficient 0 ignoré, aucune note → null", () => {
  assert.equal(weightedAverage([{ value: 10, coefficient: 1 }, { value: 20, coefficient: 3 }]), 17.5);
  assert.equal(weightedAverage([{ value: 10, coefficient: 1 }, { value: 20, coefficient: 0 }]), 10);
  assert.equal(weightedAverage([{ value: null, coefficient: 2 }]), null);
  assert.equal(weightedAverage([]), null);
  // coefficient absent = 1
  assert.equal(weightedAverage([{ value: 10 }, { value: 12 }]), 11);
});

test("mention : bornes exactes", () => {
  assert.equal(mention(16), "Très bien");
  assert.equal(mention(15.99), "Bien");
  assert.equal(mention(12), "Assez bien");
  assert.equal(mention(9.99), "Insuffisant");
  assert.equal(mention(null), null);
});

test("classStats et ranking : ex aequo partagent le rang", () => {
  assert.deepEqual(classStats([10, 14, 12]), { average: 12, min: 10, max: 14, count: 3 });
  assert.equal(classStats([]), null);
  const { ranks, total } = ranking([
    { learnerId: "a", average: 15 }, { learnerId: "b", average: 15 },
    { learnerId: "c", average: 12 }, { learnerId: "d", average: null },
  ]);
  assert.equal(ranks.get("a"), 1);
  assert.equal(ranks.get("b"), 1); // ex aequo
  assert.equal(ranks.get("c"), 3); // le rang 2 est consommé
  assert.equal(ranks.get("d"), undefined);
  assert.equal(total, 3);
});

test("learnerReport : moyennes par matière puis générale pondérée par les coefficients", () => {
  const modules = [
    { id: "m1", code: "U1", label: "Optique géométrique", coefficient: 3 },
    { id: "m2", code: "U2", label: "Anglais", coefficient: 1 },
  ];
  const assessments = [
    { id: "a1", moduleId: "m1", label: "DS1", coefficient: 1, maxScore: 20, date: "2026-10-01" },
    { id: "a2", moduleId: "m1", label: "DS2", coefficient: 3, maxScore: 20, date: "2026-11-01" },
    { id: "a3", moduleId: "m2", label: "Oral", coefficient: 1, maxScore: 10, date: "2026-10-15" },
  ];
  const grades = [
    { assessmentId: "a1", learnerId: "L", score: 8 },
    { assessmentId: "a2", learnerId: "L", score: 16 },   // coef 3 → tire la matière vers le haut
    { assessmentId: "a3", learnerId: "L", score: 9 },    // 9/10 = 18/20
  ];
  const r = learnerReport({ learnerId: "L", assessments, grades, modules });
  const m1 = r.modules.find((m) => m.moduleId === "m1");
  const m2 = r.modules.find((m) => m.moduleId === "m2");
  assert.equal(m1.average, 14);  // (8×1 + 16×3) / 4
  assert.equal(m2.average, 18);  // note sur 10 ramenée sur 20
  assert.equal(r.average, 15);   // (14×3 + 18×1) / 4
  assert.equal(r.mention, "Bien");
});

test("learnerReport : les absences sont comptées à part, pas en zéro", () => {
  const modules = [{ id: "m1", label: "Optique", coefficient: 1 }];
  const assessments = [
    { id: "a1", moduleId: "m1", coefficient: 1, maxScore: 20 },
    { id: "a2", moduleId: "m1", coefficient: 1, maxScore: 20 },
  ];
  const grades = [
    { assessmentId: "a1", learnerId: "L", score: 14 },
    { assessmentId: "a2", learnerId: "L", absent: true, score: null },
  ];
  const r = learnerReport({ learnerId: "L", assessments, grades, modules });
  assert.equal(r.modules[0].average, 14); // et non 7
  assert.equal(r.modules[0].absences, 1);
  assert.equal(r.modules[0].count, 1);
  // avec sanction explicite, l'absence devient un zéro
  const sanction = learnerReport({ learnerId: "L", assessments,
    grades: [grades[0], { assessmentId: "a2", learnerId: "L", absent: true, zeroSiAbsent: true, score: 0 }], modules });
  assert.equal(sanction.modules[0].average, 7);
});

test("learnerReport : notes sans matière regroupées, apprenant sans note → moyenne null", () => {
  const r = learnerReport({ learnerId: "L", modules: [],
    assessments: [{ id: "a1", moduleId: null, coefficient: 1, maxScore: 20 }],
    grades: [{ assessmentId: "a1", learnerId: "L", score: 11 }] });
  assert.equal(r.modules[0].label, "Autres évaluations");
  assert.equal(r.average, 11);
  const vide = learnerReport({ learnerId: "X", assessments: [], grades: [], modules: [] });
  assert.equal(vide.average, null);
  assert.equal(vide.mention, null);
});

test("blocs de compétences : validation SANS compensation entre blocs", () => {
  const modules = [
    { moduleId: "m1", label: "Optique", coefficient: 3, average: 18 },
    { moduleId: "m2", label: "Contactologie", coefficient: 2, average: 16 },
    { moduleId: "m3", label: "Anglais", coefficient: 1, average: 6 },
  ];
  const blocks = [
    { id: "b1", code: "BC01", label: "Technique optique", moduleIds: ["m1", "m2"] },
    { id: "b2", code: "BC02", label: "Communication", moduleIds: ["m3"] },
  ];
  const blocs = blockReport({ modules, blocks });
  assert.equal(blocs[0].status, "acquis");
  assert.equal(blocs[0].moyenne, 17.2); // (18×3 + 16×2) / 5
  // LE POINT CLÉ : l'excellence en technique ne rattrape PAS l'anglais.
  assert.equal(blocs[1].status, "non_acquis");
  assert.equal(blocs[1].moyenne, 6);

  const synth = certificationSummary(blocs);
  assert.equal(synth.acquis, 1);
  assert.equal(synth.nonAcquis, 1);
  assert.equal(synth.titreComplet, false, "un bloc non acquis empêche le titre complet");
  assert.deepEqual(synth.resteAValider, ["BC02"]);
});

test("blocs : seuil propre, note éliminatoire, bloc non évalué", () => {
  const modules = [
    { moduleId: "m1", label: "Pratique", coefficient: 1, average: 12 },
    { moduleId: "m2", label: "Théorie", coefficient: 1, average: 4 },
    { moduleId: "m3", label: "Stage", coefficient: 1, average: null },
  ];
  // Seuil relevé à 14 : une moyenne de 8 ne suffit plus
  const seuilHaut = blockReport({ modules, blocks: [{ id: "b", moduleIds: ["m1", "m2"], seuil: 14 }] });
  assert.equal(seuilHaut[0].status, "non_acquis");
  // Note éliminatoire : la moyenne du bloc est de 8, mais c'est le 4 qui bloque
  const elim = blockReport({ modules, blocks: [{ id: "b", moduleIds: ["m1", "m2"], noteEliminatoire: 5 }] });
  assert.equal(elim[0].elimine, true);
  assert.equal(elim[0].status, "non_acquis");
  // Aucune matière évaluée : « en cours », surtout pas « non acquis »
  const vide = blockReport({ modules, blocks: [{ id: "b", moduleIds: ["m3"] }] });
  assert.equal(vide[0].status, "en_cours");
  assert.equal(vide[0].moyenne, null);
  assert.equal(certificationSummary(vide).titreComplet, false);
});

test("bulletin par période : seules les évaluations de la fenêtre comptent", () => {
  const modules = [{ id: "m1", label: "Optique", coefficient: 1 }];
  const assessments = [
    { id: "a1", moduleId: "m1", coefficient: 1, maxScore: 20, date: "2026-10-15" }, // S1
    { id: "a2", moduleId: "m1", coefficient: 1, maxScore: 20, date: "2027-03-10" }, // S2
  ];
  const grades = [
    { assessmentId: "a1", learnerId: "L", score: 8 },
    { assessmentId: "a2", learnerId: "L", score: 16 },
  ];
  // Sans période : tout l'historique (moyenne 12)
  assert.equal(learnerReport({ learnerId: "L", assessments, grades, modules }).average, 12);
  // 1er semestre seulement
  const s1 = learnerReport({ learnerId: "L", assessments, grades, modules, from: "2026-09-01", to: "2027-01-31" });
  assert.equal(s1.average, 8);
  // 2e semestre seulement
  const s2 = learnerReport({ learnerId: "L", assessments, grades, modules, from: "2027-02-01", to: "2027-07-31" });
  assert.equal(s2.average, 16);
  // Période sans évaluation : aucune moyenne, et surtout pas zéro
  const vide = learnerReport({ learnerId: "L", assessments, grades, modules, from: "2028-01-01", to: "2028-06-30" });
  assert.equal(vide.average, null);
});

// ---------- Store ----------

test("évaluation : saisie par lot en upsert, suppression en cascade des notes", () => {
  const campus = store.addCampus({ name: "Campus Notes" });
  const classe = store.addClass({ campusId: campus.id, name: "BTS N1" });
  const a = store.addAssessment({ campusId: campus.id, classId: classe.id, label: "DS1", coefficient: 2, maxScore: 20 });
  assert.equal(a.coefficient, 2);

  store.setGrades(a.id, [{ learnerId: "l1", score: 12 }, { learnerId: "l2", score: 15 }]);
  assert.equal(store.listGrades({ assessmentId: a.id }).length, 2);
  // second passage : mise à jour, pas de doublon
  store.setGrades(a.id, [{ learnerId: "l1", score: 14 }]);
  const gs = store.listGrades({ assessmentId: a.id });
  assert.equal(gs.length, 2);
  assert.equal(gs.find((g) => g.learnerId === "l1").score, 14);

  store.deleteAssessment(a.id);
  assert.equal(store.listGrades({ assessmentId: a.id }).length, 0); // notes purgées avec l'évaluation
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store isolé (même pattern que store.test.mjs) — à définir AVANT l'import du store.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmlearn-"));
process.env.DATA_KEY = "test-key-learners";
const store = await import("../lib/store.js");

const campus = store.addCampus({ name: "Campus Test" });
const classe = store.addClass({ campusId: campus.id, name: "BTS OL 1", year: 1 });

test("apprenant : création normalisée + recherche", () => {
  const l = store.addLearner({ campusId: campus.id, nom: "  Dupont ", prenom: "Léa", ine: "1234abcd567", rqth: 1 });
  assert.equal(l.nom, "Dupont");
  assert.equal(l.ine, "1234ABCD567"); // INE en majuscules
  assert.equal(l.rqth, true);
  assert.equal(store.listLearners({ campusId: campus.id }).length, 1);
  assert.equal(store.listLearners({ q: "dupo" }).length, 1);
  assert.equal(store.listLearners({ q: "introuvable" }).length, 0);
});

test("inscription : cycle complet + unicité par année scolaire", () => {
  const l = store.addLearner({ campusId: campus.id, nom: "Martin", prenom: "Sami" });
  const e = store.addEnrollment({ learnerId: l.id, classId: classe.id, schoolYear: "2026-2027", dateDebut: "2026-09-01" });
  assert.equal(e.statut, "inscrit");
  assert.equal(e.campusId, campus.id); // hérité du dossier
  // Doublon actif refusé sur la même année
  const dup = store.addEnrollment({ learnerId: l.id, schoolYear: "2026-2027" });
  assert.ok(dup.error);
  // Passage en rupture
  const upd = store.updateEnrollment(e.id, { statut: "rupture", dateSortie: "2027-01-15", motifSortie: "Abandon employeur" });
  assert.equal(upd.statut, "rupture");
  // La timeline retrace inscription + sortie, plus récent d'abord
  const tl = store.learnerTimeline(l.id);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].type, "rupture");
  assert.equal(tl[1].type, "inscription");
});

test("inscription : apprenant inconnu → null, statut invalide → inscrit", () => {
  assert.equal(store.addEnrollment({ learnerId: "nope", schoolYear: "2026-2027" }), null);
  const l = store.addLearner({ campusId: campus.id, nom: "Bernard", prenom: "Jules" });
  const e = store.addEnrollment({ learnerId: l.id, schoolYear: "2025-2026", statut: "n'importe quoi" });
  assert.equal(e.statut, "inscrit");
});

test("effacement RGPD : cascade réelle sur toutes les données de l'apprenant", () => {
  const l = store.addLearner({ campusId: campus.id, nom: "Petit", prenom: "Emma" });
  store.addEnrollment({ learnerId: l.id, schoolYear: "2026-2027", classId: classe.id });
  const doc = store.addDocument({ campusId: campus.id, name: "carte-identite.pdf", learnerId: l.id });
  const ev = store.addAssessment({ campusId: campus.id, classId: classe.id, label: "DS RGPD" });
  store.setGrades(ev.id, [{ learnerId: l.id, score: 12 }]);
  store.addContract({ campusId: campus.id, learnerId: l.id, companyId: "co-x", dateDebut: "2026-09-01", dateFin: "2028-08-31" });
  store.addCandidate({ campusId: campus.id, nom: "Petit", prenom: "Emma", learnerId: l.id });
  store.createPortalAccess({ kind: "learner", subjectId: l.id, campusId: campus.id, tokenHash: "abc" });

  const r = store.deleteLearner(l.id);

  // Plus AUCUNE donnée nominative ne subsiste dans le store
  assert.equal(store.getLearner(l.id), null);
  assert.equal(store.listEnrollments({ learnerId: l.id }).length, 0);
  assert.equal(store.listGrades({ learnerId: l.id }).length, 0, "les notes doivent partir");
  assert.equal(store.listContracts({ learnerId: l.id }).length, 0, "les contrats doivent partir");
  assert.equal(store.listCandidates({}).filter((c) => c.learnerId === l.id).length, 0, "la candidature d'origine doit partir");
  assert.equal(store.listPortalAccess({ subjectId: l.id }).length, 0, "les accès portail doivent partir");
  assert.equal(store.listDocuments(campus.id).find((d) => d.id === doc.id), undefined, "les pièces du dossier doivent partir");

  // L'appelant reçoit de quoi supprimer les fichiers correspondants sur disque
  assert.equal(r.contractIds.length, 1);
  assert.equal(r.documentIds.length, 1);
  assert.equal(r.name, "Emma Petit");
});

test("suppression d'une classe : inscriptions détachées, évaluations et notes purgées", () => {
  const k = store.addClass({ campusId: campus.id, name: "Classe éphémère" });
  const l = store.addLearner({ campusId: campus.id, nom: "Reste", prenom: "Ici" });
  store.addEnrollment({ learnerId: l.id, schoolYear: "2027-2028", classId: k.id });
  const ev = store.addAssessment({ campusId: campus.id, classId: k.id, label: "DS classe" });
  store.setGrades(ev.id, [{ learnerId: l.id, score: 15 }]);

  store.deleteClass(k.id);

  // L'apprenant reste inscrit à l'établissement, mais sans classe
  const enr = store.listEnrollments({ learnerId: l.id }).find((e) => e.schoolYear === "2027-2028");
  assert.ok(enr, "l'inscription ne doit pas disparaître avec la classe");
  assert.equal(enr.classId, null);
  // Les évaluations de la classe et leurs notes ne pointent plus dans le vide
  assert.equal(store.listAssessments({ classId: k.id }).length, 0);
  assert.equal(store.listGrades({ assessmentId: ev.id }).length, 0);
});

test("mise à jour : le campus et la date de création survivent au patch", () => {
  const l = store.addLearner({ campusId: campus.id, nom: "Roux", prenom: "Max" });
  const created = l.createdAt;
  const upd = store.updateLearner(l.id, { email: "max@test.fr" });
  assert.equal(upd.email, "max@test.fr");
  assert.equal(upd.campusId, campus.id);
  assert.equal(upd.createdAt, created);
  assert.equal(upd.nom, "Roux");
});

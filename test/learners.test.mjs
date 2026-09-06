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

test("suppression RGPD : dossier + inscriptions purgés, documents délestés", () => {
  const l = store.addLearner({ campusId: campus.id, nom: "Petit", prenom: "Emma" });
  store.addEnrollment({ learnerId: l.id, schoolYear: "2026-2027" });
  const doc = store.addDocument({ campusId: campus.id, name: "carte-identite.pdf", learnerId: l.id });
  assert.equal(store.listDocuments(campus.id, null, l.id).length, 1);
  store.deleteLearner(l.id);
  assert.equal(store.getLearner(l.id), null);
  assert.equal(store.listEnrollments({ learnerId: l.id }).length, 0);
  // le document reste au campus (pièce comptable) mais n'est plus rattaché
  const kept = store.listDocuments(campus.id).find((d) => d.id === doc.id);
  assert.ok(kept);
  assert.equal(kept.learnerId, null);
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

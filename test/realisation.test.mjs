// Réalisation d'une étape de projet.
//
// Une case cochée ne dit rien. Trois choses la rendent exploitable : un compte
// rendu, des personnes rattachées, une pièce qui valide.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RACI, validatePersonne, resoudreRaci, convocables, validateRealisation, etatPlan,
} from "../lib/realisation.js";

const repertoire = [
  { id: "p1", nom: "Stéphane Francese", role: "Directeur des opérations", email: "s@campus.fr" },
  { id: "p2", nom: "Claire Martin", role: "Responsable pédagogique", email: "c@campus.fr" },
  { id: "p3", nom: "Sans adresse", role: "Observateur", email: "" },
];
const documents = [{ id: "d1", nom: "PV du conseil.pdf" }];

const etape = (p = {}) => ({
  id: "t1", title: "Conseil de perfectionnement", lot: "pedagogie", status: "done",
  ownerId: "p1", consultedIds: ["p2"],
  realisation: { texte: "Séance du 12 septembre, sept membres présents. Deux décisions : ouverture d'une seconde section, révision du rythme.", le: "2026-09-12", par: "p1" },
  outputs: [{ id: "o1", label: "Procès-verbal" }],
  preuves: [{ documentId: "d1", label: "PV signé" }],
  ...p,
});

test("une personne sans adresse ne peut pas être convoquée : c'est tout l'objet du répertoire", () => {
  assert.equal(validatePersonne({ nom: "X", email: "x@y.fr" }).ok, true);
  const sans = validatePersonne({ nom: "X" });
  assert.equal(sans.ok, false);
  assert.match(sans.errors.join(" "), /ne peut pas être convoquée/);
  assert.equal(validatePersonne({ nom: "X", email: "pasunemail" }).ok, false);
  assert.equal(validatePersonne({ email: "x@y.fr" }).ok, false);
  assert.match(validatePersonne({ nom: "X", email: "x@y.fr" }).warnings.join(" "), /rôle/);
});

test("le RACI se résout en personnes réelles, et le texte libre est signalé comme tel", () => {
  const r = resoudreRaci(etape(), repertoire);
  const owner = r.find((l) => l.cle === "owner");
  assert.equal(owner.personnes[0].nom, "Stéphane Francese");
  assert.equal(owner.nonResolu, false);
  assert.equal(r.find((l) => l.cle === "consulted").personnes.length, 1);

  // Un plan ancien porte des chaînes : on les affiche sans prétendre les résoudre.
  const libre = resoudreRaci({ owner: "le directeur", accountable: "" }, repertoire);
  const o = libre.find((l) => l.cle === "owner");
  assert.equal(o.libre, "le directeur");
  assert.equal(o.nonResolu, true);
  assert.equal(o.personnes.length, 0);

  // Une personne supprimée du répertoire laisse une référence morte, dite.
  const mort = resoudreRaci({ ownerId: "disparu" }, repertoire);
  assert.deepEqual(mort.find((l) => l.cle === "owner").introuvables, ["disparu"]);
});

// ON NE CONVOQUE PAS UNE CHAÎNE DE CARACTÈRES.
test("LES CONVOCABLES SE CALCULENT AVANT L'ENVOI, PAS APRÈS L'ÉCHEC", () => {
  const c = convocables(etape(), repertoire);
  assert.equal(c.complet, true);
  assert.equal(c.retenus.length, 2);
  assert.deepEqual(c.retenus.find((r) => r.id === "p1").roles, ["R"]);

  // Un nom saisi à la main n'a pas d'adresse : on le dit avant de partir.
  const libre = convocables({ ownerId: "p1", accountable: "le directeur" }, repertoire);
  assert.equal(libre.complet, false);
  assert.match(libre.ecartes[0].motif, /saisi à la main/);
  assert.match(libre.ecartes[0].motif, /pas d'adresse où écrire/);

  // Une personne sans adresse est écartée nommément.
  const muette = convocables({ ownerId: "p3" }, repertoire);
  assert.equal(muette.retenus.length, 0);
  assert.match(muette.ecartes[0].motif, /aucune adresse/);
  assert.equal(muette.motif, "aucun destinataire joignable");

  // L'« informé » n'est pas convoqué : il n'a pas à l'être.
  assert.equal(RACI.informed.convoque, false);
  const avecInforme = convocables({ ownerId: "p1", informedIds: ["p2"] }, repertoire);
  assert.equal(avecInforme.retenus.length, 1);
});

test("une même personne cumulant deux rôles n'est pas convoquée deux fois", () => {
  const c = convocables({ ownerId: "p1", accountableId: "p1", consultedIds: ["p1"] }, repertoire);
  assert.equal(c.retenus.length, 1);
  assert.deepEqual(c.retenus[0].roles, ["R", "A", "C"]);
});

// LE COMPTE RENDU.
test("une étape cochée sans compte rendu est signalée", () => {
  const v = validateRealisation(etape({ realisation: { texte: "" } }), { repertoire, documents });
  const m = v.manques.find((x) => x.cle === "compte_rendu");
  assert.equal(m.gravite, "important");
  assert.match(m.message, /n'apprend rien six mois plus tard/);
  assert.equal(v.documentee, false);
  // Complète, elle est documentée.
  assert.equal(validateRealisation(etape(), { repertoire, documents }).documentee, true);
});

// LA PIÈCE QUI VALIDE.
test("un livrable annoncé sans pièce annexée est signalé ; sans livrable, on n'exige rien", () => {
  const sans = validateRealisation(etape({ preuves: [] }), { repertoire, documents });
  const m = sans.manques.find((x) => x.cle === "preuve");
  assert.match(m.message, /le compte rendu dit ce qui a été fait, la pièce le démontre/);

  // Toutes les étapes ne produisent pas de livrable : on ne réclame pas dans le vide.
  const pasDeLivrable = validateRealisation(etape({ outputs: [], preuves: [] }), { repertoire, documents });
  assert.equal(pasDeLivrable.manques.some((x) => x.cle === "preuve"), false);
  assert.equal(pasDeLivrable.documentee, true);
});

test("UNE PIÈCE QUI POINTE DANS LE VIDE EST PIRE QUE PAS DE PIÈCE", () => {
  const v = validateRealisation(etape({ preuves: [{ documentId: "supprime" }] }), { repertoire, documents });
  const m = v.manques.find((x) => x.cle === "preuve_introuvable");
  assert.equal(m.gravite, "bloquant", "elle rassure sans rien démontrer");
  assert.equal(v.bloquants, 1);
  assert.equal(v.documentee, false);
});

test("une étape non faite n'a pas à être documentée, mais doit être convocable", () => {
  const v = validateRealisation({ id: "t2", status: "todo", owner: "le directeur" }, { repertoire, documents });
  assert.equal(v.fait, false);
  // Aucun reproche sur le compte rendu ou la pièce.
  assert.equal(v.manques.some((m) => ["compte_rendu", "preuve"].includes(m.cle)), false);
  // Mais le responsable en texte libre, si : on doit pouvoir convoquer AVANT.
  assert.ok(v.manques.find((m) => m.cle === "raci_non_resolu"));
});

test("une étape sans aucun responsable n'appartient à personne", () => {
  const v = validateRealisation({ id: "t3", status: "todo" }, { repertoire, documents });
  assert.ok(v.manques.find((m) => m.cle === "sans_responsable"));
});

test("l'état du plan montre ce qu'un audit démonterait en dix minutes", () => {
  const e = etatPlan([
    etape({ id: "a" }),
    etape({ id: "b", realisation: { texte: "" }, preuves: [] }),
    etape({ id: "c", status: "todo", ownerId: "p1", realisation: null, outputs: [], preuves: [] }),
  ], { repertoire, documents });

  assert.equal(e.total, 3);
  assert.equal(e.faites, 2);
  assert.equal(e.documentees, 1);
  assert.equal(e.sansCompteRendu, 1);
  assert.equal(e.sansPreuve, 1);
  assert.match(e.reserve, /pas un jugement sur la qualité/);
});

test("les quatre responsabilités portent un code et disent qui se convoque", () => {
  assert.deepEqual(Object.keys(RACI), ["owner", "accountable", "consulted", "informed"]);
  for (const [k, v] of Object.entries(RACI)) {
    assert.ok(v.label && v.code, k);
    assert.equal(typeof v.convoque, "boolean");
  }
});

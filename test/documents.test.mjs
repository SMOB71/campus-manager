// Documents obligatoires de l'organisme de formation.
//
// Deux fautes que ce module existe pour rendre impossibles : servir une
// convention à un particulier qui finance lui-même (il perd ses protections),
// et construire un échéancier qui encaisse trop, trop tôt.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TYPES, MENTIONS, PAYEURS, RETRACTATION_JOURS, PREMIER_VERSEMENT_MAX, SEUIL_DELEGUES_HEURES,
  acteRequis, mentionsManquantes, validateReglement, etatRemises,
  construireProgramme, validateProgramme, echeancierLegal, validateEcheancier,
  validateActe, peutModifier, etatDocumentaire,
} from "../lib/documents.js";

const AUJ = "2026-09-16";

// LA DISTINCTION CENTRALE.
test("L'ACTE SE DÉDUIT DU PAYEUR — CE N'EST PAS UN CHOIX DE MISE EN FORME", () => {
  assert.equal(acteRequis("entreprise").type, "convention");
  assert.equal(acteRequis("opco").type, "convention");
  // Seul cas où le contrat s'impose.
  const c = acteRequis("particulier");
  assert.equal(c.type, "contrat");
  assert.match(c.motif, /rétractation/);
  assert.match(c.motif, /Une convention ne porte aucune de ces protections/);
  assert.equal(acteRequis("inventé"), null);
  for (const p of Object.values(PAYEURS)) assert.ok(TYPES[p.acte]);
});

const acte = (p = {}) => ({
  type: "convention", payeur: "entreprise",
  intitule: "BTS Opticien-Lunetier", objectifs: "Préparer au diplôme", nature: "apprentissage",
  dureeHeures: 1350, dates: "2026-09-01 → 2027-06-30", dateDebut: "2026-09-01", dateFin: "2027-06-30",
  effectif: 18, prix: 9000, moyens: "Salles équipées, plateau technique",
  evaluation: "Contrôle continu et épreuves ponctuelles", resiliation: "Dédit de 30 % au-delà de J-15",
  acheteur: "OPCO EP", programme: { intitule: "BTS OL" }, echeances: [{ montant: 9000, date: "2026-10-01" }],
  ...p,
});

test("une convention servie à un particulier est refusée, et le refus dit pourquoi", () => {
  const faux = validateActe(acte({ payeur: "particulier" }));
  assert.equal(faux.ok, false);
  assert.match(faux.errors.join(" "), /incompatible avec ce financement/);
  assert.match(faux.errors.join(" "), /contrat de formation professionnelle/i);
  // Et l'inverse aussi : un contrat pour un achat d'entreprise n'a pas lieu d'être.
  const inverse = validateActe(acte({ type: "contrat", payeur: "entreprise" }));
  assert.equal(inverse.ok, false);
});

test("une convention complète passe ; une mention manquante est classée selon ce qu'elle protège", () => {
  assert.equal(validateActe(acte()).ok, true);
  // « resiliation » manque : signalé, non bloquant.
  const mou = validateActe(acte({ resiliation: "" }));
  assert.equal(mou.ok, true);
  assert.match(mou.warnings.join(" "), /dédit ou de résiliation/);

  // Sur un contrat, la mention du délai de rétractation PROTÈGE : elle bloque.
  const sansDelai = validateActe({
    ...acte({ type: "contrat", payeur: "particulier" }),
    beneficiaire: "Léa Dupont", sanction: "BTS", retractation: "", dedit: "Remboursement au prorata",
    prix: 3000, dateSignature: "2026-09-01",
    echeances: [{ montant: 900, date: "2026-09-11" }, { montant: 2100, date: null }],
  });
  assert.equal(sansDelai.ok, false);
  assert.match(sansDelai.errors.join(" "), /Délai de rétractation/);
});

test("un acte sans programme rattaché est refusé : le programme doit être PRÉÉTABLI", () => {
  const sans = validateActe(acte({ programme: null }));
  assert.equal(sans.ok, false);
  assert.match(sans.errors.join(" "), /programme préétabli/);
});

// LE PIÈGE QUI COÛTE LE PLUS CHER.
test("AUCUNE SOMME EXIGIBLE PENDANT LES 10 JOURS DE RÉTRACTATION", () => {
  const base = { type: "contrat", prix: 3000, dateSignature: "2026-09-01" };
  // « 50 % à la signature » : la faute qu'un ERP fabrique en trois clics.
  const illicite = validateEcheancier({ ...base, lignes: [
    { montant: 1500, date: "2026-09-01" }, { montant: 1500, date: "2026-12-01" },
  ] });
  assert.equal(illicite.ok, false);
  assert.match(illicite.errors.join(" "), /avant le 2026-09-11/);
  assert.match(illicite.errors.join(" "), /L\. 6353-5/);

  // Même au bon moment, on ne peut pas encaisser plus de 30 %.
  const tropGros = validateEcheancier({ ...base, lignes: [
    { montant: 1500, date: "2026-09-11" }, { montant: 1500, date: "2027-01-01" },
  ] });
  assert.equal(tropGros.ok, false);
  assert.match(tropGros.errors.join(" "), /plafond de 900 €/);

  // Conforme : 30 % à l'expiration, le solde échelonné.
  const bon = validateEcheancier({ ...base, lignes: [
    { montant: 900, date: "2026-09-11" }, { montant: 1050, date: "2026-12-01" }, { montant: 1050, date: "2027-03-01" },
  ] });
  assert.equal(bon.ok, true);
  assert.equal(bon.plafond, 900);
  assert.equal(bon.finRetractation, "2026-09-11");
});

test("deux échéances le même jour ne contournent pas le plafond", () => {
  // Chacune sous 30 %, mais leur somme le dépasse : le plafond s'apprécie sur
  // ce qui est exigible à l'issue du délai, pas ligne par ligne.
  const v = validateEcheancier({ type: "contrat", prix: 3000, dateSignature: "2026-09-01", lignes: [
    { montant: 800, date: "2026-09-11" }, { montant: 800, date: "2026-09-11" }, { montant: 1400, date: "2026-12-01" },
  ] });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /1600 € exigibles/);
});

test("les échéances doivent totaliser le prix, et la convention reste libre", () => {
  const faux = validateEcheancier({ type: "contrat", prix: 3000, dateSignature: "2026-09-01",
    lignes: [{ montant: 900, date: "2026-09-11" }] });
  assert.match(faux.errors.join(" "), /totalisent 900 €/);
  // Une convention n'est pas soumise à ce régime : il protège une personne
  // physique, pas un acheteur professionnel.
  assert.equal(validateEcheancier({ type: "convention", prix: 9000, lignes: [{ montant: 9000, date: "2026-09-01" }] }).ok, true);
});

test("l'échéancier légal proposé est conforme par construction et solde au centime", () => {
  const e = echeancierLegal({ prix: 3000, dateSignature: "2026-09-01", nbEcheances: 3 });
  assert.equal(e.finRetractation, "2026-09-11");
  assert.equal(e.premierVersementMax, 900);
  assert.equal(e.lignes[0].montant, 900);
  assert.match(e.lignes[0].motif, /L\. 6353-6/);
  assert.equal(e.lignes.reduce((a, l) => a + l.montant, 0), 3000);

  // Un prix qui tombe mal ne doit pas laisser de centimes orphelins.
  const impair = echeancierLegal({ prix: 1000, dateSignature: "2026-09-01", nbEcheances: 3 });
  assert.equal(impair.lignes.reduce((a, l) => a + l.montant, 0), 1000);
  assert.equal(echeancierLegal({ prix: 0, dateSignature: "2026-09-01" }), null);
  assert.equal(RETRACTATION_JOURS, 10);
  assert.equal(PREMIER_VERSEMENT_MAX, 0.3);
});

// LE SEUIL QUE PERSONNE NE CONNAÎT.
test("au-delà de 500 heures, les délégués des stagiaires deviennent obligatoires", () => {
  const r = {
    version: "2026-1", dateApplication: "2026-09-01",
    hygieneSecurite: "…", disciplinaire: "…", sanctions: "…", procedure: "…", representation: "",
  };
  // Une formation courte : l'absence de modalités est seulement signalée.
  assert.equal(validateReglement(r, { dureeMaxHeures: 120 }).errors.length, 0);
  // Un BTS : 1 350 h, très au-delà du seuil.
  const cfa = validateReglement(r, { dureeMaxHeures: 1350 });
  assert.equal(cfa.ok, false);
  assert.match(cfa.errors.join(" "), /R\. 6352-9/);
  assert.equal(SEUIL_DELEGUES_HEURES, 500);
});

test("un règlement sans garanties de procédure disciplinaire est bloqué", () => {
  const v = validateReglement({ version: "1", dateApplication: "2026-09-01",
    hygieneSecurite: "…", disciplinaire: "…", sanctions: "…", procedure: "", representation: "…" });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /procédure disciplinaire/);
  // Une version manquante bloque aussi : sans elle on ne sait pas quoi a été remis.
  assert.match(validateReglement({ dateApplication: "2026-09-01" }).errors.join(" "), /version/);
});

// LE DOCUMENT NE VAUT QUE PORTÉ À CONNAISSANCE.
test("le règlement doit être REMIS, et la remise se compte par version", () => {
  const inscrits = ["l1", "l2", "l3"];
  const sans = etatRemises({}, [], inscrits);
  assert.equal(sans.alerte.gravite, "bloquant");
  assert.match(sans.alerte.message, /L\. 6352-3/);

  const partiel = etatRemises({ version: "2026-1" }, [{ learnerId: "l1", version: "2026-1" }], inscrits);
  assert.equal(partiel.remis, 1);
  assert.deepEqual(partiel.manquants, ["l2", "l3"]);
  assert.match(partiel.alerte.message, /pas opposable/);

  // Une remise de l'ANCIENNE version ne vaut pas pour la nouvelle.
  const perime = etatRemises({ version: "2026-2" }, inscrits.map((id) => ({ learnerId: id, version: "2026-1" })), inscrits);
  assert.equal(perime.remis, 0);
  assert.equal(perime.complet, false);

  const complet = etatRemises({ version: "2026-1" }, inscrits.map((id) => ({ learnerId: id, version: "2026-1" })), inscrits);
  assert.equal(complet.complet, true);
  assert.equal(complet.alerte, null);
});

test("le programme se construit depuis le référentiel, pas depuis le planning réalisé", () => {
  const cur = {
    name: "BTS OL", codeRncp: "35338", level: "5", dureeHeures: 1350,
    modules: [
      { code: "M1", label: "Optique géométrique", heures: 200, year: 1 },
      { code: "M2", label: "Gestion", heures: 80, year: 1 },
      { code: "M3", label: "Contactologie", heures: 150, year: 2 },
    ],
    blocks: [{ code: "B1", label: "Analyse de la vision" }],
  };
  const p = construireProgramme({ curriculum: cur, campus: { name: "CFA Test" }, annee: 1,
    prerequis: "Baccalauréat", evaluation: "Contrôle continu", moyens: "Plateau technique", });
  assert.equal(p.contenu.length, 2, "l'année filtre les enseignements");
  assert.equal(p.dureeHeures, 280);
  assert.equal(p.codeRncp, "35338");
  assert.equal(p.blocs.length, 1);

  // Il manque les objectifs : le programme n'est pas valide.
  const v = validateProgramme(p);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /Objectifs déterminés/);
  assert.equal(validateProgramme({ ...p, objectifs: "Préparer au BTS" }).ok, true);
  // Un programme sans contenu ne décrit rien.
  assert.equal(validateProgramme({ ...p, objectifs: "x", contenu: [] }).ok, false);
});

test("un acte signé ne se modifie plus, il s'avenante", () => {
  assert.equal(peutModifier({ statut: "brouillon" }).autorise, true);
  const bloque = peutModifier({ statut: "signe" });
  assert.equal(bloque.autorise, false);
  assert.match(bloque.motif, /avenant/);
});

test("l'état documentaire remonte ce qui est bloquant, pas ce qui est perfectible", () => {
  const vide = etatDocumentaire({ aujourdhui: AUJ });
  assert.equal(vide.conforme, false);
  assert.match(JSON.stringify(vide.points), /L\. 6352-3/);

  // Une action commencée sans acte signé : la formation s'exécute sans base.
  const encours = etatDocumentaire({
    reglement: { version: "1" },
    actes: [{ statut: "brouillon", dateDebut: "2026-09-01", programme: {} }],
    aujourdhui: AUJ,
  });
  assert.match(JSON.stringify(encours.points), /sans base contractuelle/);
  assert.equal(encours.bloquants >= 1, true);

  const sain = etatDocumentaire({
    reglement: { version: "1" }, livret: { contenu: "…" },
    actes: [{ statut: "signe", dateDebut: "2026-09-01", programme: {} }],
    remises: { complet: true, manquants: [] },
    aujourdhui: AUJ,
  });
  assert.equal(sain.conforme, true);
  assert.match(sain.reserve, /ne vaut pas avis juridique/);
});

test("chaque mention obligatoire cite sa base", () => {
  for (const [type, liste] of Object.entries(MENTIONS)) {
    assert.ok(liste.length, type);
    for (const m of liste) {
      assert.ok(m.cle && m.label, `${type}: mention incomplète`);
      assert.match(m.base, /^[LR]\. \d{4}-\d+/, `${type}/${m.cle} : base « ${m.base} »`);
    }
  }
  assert.equal(mentionsManquantes("inconnu", {}).length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  MOTIFS, MOTIF_IDS, normalizeExemption, validateExemption, estOpposable,
  applyExemptions, certification, blocsAlleges,
} from "../lib/acquis.js";

const bloc = (id, code, status) => ({ blocId: id, code, label: `Bloc ${code}`, status, moyenne: status === "acquis" ? 13 : null });
const JUSTIFIE = { justificatif: "Relevé de notes session 2025", dateDecision: "2026-09-01", decidePar: "Mme Martin" };

test("LA distinction : allègement de parcours ≠ acquisition", () => {
  // Un allègement dispense de SUIVRE, pas de PASSER. Le confondre avec un acquis
  // revient à délivrer un bloc que personne n'a jamais évalué.
  const blocs = applyExemptions([bloc("b1", "RNCP-01", "en_cours")], [
    { learnerId: "l1", blocId: "b1", motif: "allegement", ...JUSTIFIE },
  ]);
  assert.equal(blocs[0].status, "en_cours", "un allègement ne valide RIEN");
  assert.equal(blocs[0].dispense.dispenseFormation, true);
  assert.equal(blocs[0].dispense.dispenseEpreuve, false);

  const c = certification(blocs);
  assert.equal(c.acquis, 0);
  assert.equal(c.titreComplet, false);
  assert.deepEqual(c.resteAValider, ["RNCP-01"]);
});

test("LA distinction, dans l'autre sens : une dispense d'épreuve vaut acquisition", () => {
  const blocs = applyExemptions([bloc("b1", "RNCP-01", "en_cours")], [
    { learnerId: "l1", blocId: "b1", motif: "acquis_anterieur", ...JUSTIFIE },
  ]);
  assert.equal(blocs[0].status, "acquis_dispense");
  assert.equal(blocs[0].dispense.dispenseEpreuve, true);
  // Le statut évalué reste lisible : un bloc dispensé qui avait des notes doit
  // pouvoir être expliqué au jury.
  assert.equal(blocs[0].statutEvalue, "en_cours");
});

test("le bulletin d'une vraie promo : un bloc déjà validé n'est plus « non acquis »", () => {
  // C'est le défaut que le module corrige. Sans lui, un redoublant partiel voit
  // son bloc acquis l'an dernier compté comme non acquis, et le document est faux.
  const brut = [bloc("b1", "RNCP-01", "acquis"), bloc("b2", "RNCP-02", "non_acquis"), bloc("b3", "RNCP-03", "en_cours")];
  const sansDecision = certification(applyExemptions(brut, []));
  assert.equal(sansDecision.acquis, 1);
  assert.equal(sansDecision.titreComplet, false);

  const avec = certification(applyExemptions(brut, [
    { learnerId: "l1", blocId: "b2", motif: "acquis_anterieur", ...JUSTIFIE },
    { learnerId: "l1", blocId: "b3", motif: "vae", ...JUSTIFIE },
  ]));
  assert.equal(avec.acquis, 3);
  assert.equal(avec.acquisEvalues, 1);
  assert.equal(avec.acquisParDispense, 2);
  assert.equal(avec.titreComplet, true);
  assert.deepEqual(avec.resteAValider, []);
});

test("traçabilité : un titre complet dit d'où vient chaque bloc dispensé", () => {
  // Un titre dont deux blocs viennent d'une équivalence doit pouvoir être
  // expliqué — c'est la première question du jury.
  const c = certification(applyExemptions([bloc("b1", "RNCP-01", "acquis"), bloc("b2", "RNCP-02", "en_cours")], [
    { learnerId: "l1", blocId: "b2", motif: "equivalence", ...JUSTIFIE },
  ]));
  assert.equal(c.origines.length, 1);
  assert.equal(c.origines[0].bloc, "RNCP-02");
  assert.equal(c.origines[0].motif, "equivalence");
  assert.equal(c.origines[0].motifLabel, MOTIFS.equivalence.label);
  assert.equal(c.origines[0].opposable, true);
});

test("dispense non justifiée : elle suit le parcours mais ne délivre pas le titre", () => {
  // On n'empêche pas de saisir pendant qu'on rassemble les pièces. Mais un
  // certificateur qui trouve un bloc « acquis » sans justificatif relève un écart.
  const blocs = applyExemptions([bloc("b1", "RNCP-01", "acquis"), bloc("b2", "RNCP-02", "non_acquis")], [
    { learnerId: "l1", blocId: "b2", motif: "equivalence" },   // sans pièce ni date ni auteur
  ]);
  assert.equal(blocs[1].status, "acquis_dispense", "la décision s'applique au suivi pédagogique");
  assert.equal(blocs[1].dispense.opposable, false);

  const c = certification(blocs);
  assert.equal(c.acquis, 2, "tous les blocs sont acquis au sens du suivi");
  assert.equal(c.titreComplet, false, "mais le titre ne peut pas être délivré");
  // « il manque des papiers » et « il manque des blocs » ne sont pas la même
  // action, ni le même délai : on les distingue.
  assert.equal(c.blocageDocumentaire, true);
  assert.deepEqual(c.dispensesNonJustifiees, ["RNCP-02"]);
  assert.deepEqual(c.resteAValider, []);
});

test("opposabilité : pièce, date ET auteur — les trois", () => {
  assert.equal(estOpposable(normalizeExemption({ motif: "vae", ...JUSTIFIE })), true);
  for (const manquant of ["justificatif", "dateDecision", "decidePar"]) {
    const partiel = { ...JUSTIFIE, [manquant]: "" };
    assert.equal(estOpposable(normalizeExemption({ motif: "vae", ...partiel })), false, `${manquant} manquant`);
  }
  // Une pièce déposée en GED vaut justificatif écrit
  assert.equal(estOpposable(normalizeExemption({ motif: "vae", documentId: "doc1", dateDecision: "2026-09-01", decidePar: "X" })), true);
});

test("le motif propose, la décision dispose", () => {
  // Un organisme peut dispenser d'épreuve tout en maintenant la présence en cours.
  const x = normalizeExemption({ motif: "acquis_anterieur", dispenseFormation: false, ...JUSTIFIE });
  assert.equal(x.dispenseEpreuve, true, "valeur par défaut du motif");
  assert.equal(x.dispenseFormation, false, "surcharge explicite respectée");
  // Et l'inverse : un allègement assorti d'une dispense d'épreuve.
  const y = normalizeExemption({ motif: "allegement", dispenseEpreuve: true });
  assert.equal(y.dispenseEpreuve, true);
});

test("validation : une décision qui ne dispense de rien est refusée", () => {
  // Elle laisserait croire à un aménagement qui n'existe pas.
  const v = validateExemption({ learnerId: "l1", blocId: "b1", motif: "allegement", dispenseFormation: false, dispenseEpreuve: false });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /dispenser de l'épreuve, de la formation/.test(e)));

  const manquants = validateExemption({});
  assert.equal(manquants.ok, false);
  assert.ok(manquants.errors.some((e) => /apprenant/.test(e)));
  assert.ok(manquants.errors.some((e) => /bloc/.test(e)));
  assert.ok(manquants.errors.some((e) => /motif/.test(e)));

  const motifInconnu = validateExemption({ learnerId: "l1", blocId: "b1", motif: "parce_que" });
  assert.equal(motifInconnu.ok, false);
});

test("validation : les pièces manquantes sont des AVERTISSEMENTS, pas des refus", () => {
  const v = validateExemption({ learnerId: "l1", blocId: "b1", motif: "vae" });
  assert.equal(v.ok, true, "on peut saisir pendant qu'on rassemble les papiers");
  assert.equal(v.warnings.length, 3);
  assert.ok(v.warnings.some((w) => /pièce justificative/.test(w)));
});

test("assiduité : les blocs allégés sortent du calcul, sinon on fabrique un absentéisme", () => {
  // Compter comme absent quelqu'un dispensé de suivre le cours, c'est déclencher
  // une alerte de décrochage sur un apprenant parfaitement à jour.
  const blocs = applyExemptions([bloc("b1", "A", "en_cours"), bloc("b2", "B", "en_cours"), bloc("b3", "C", "en_cours")], [
    { learnerId: "l1", blocId: "b1", motif: "allegement", ...JUSTIFIE },
    { learnerId: "l1", blocId: "b2", motif: "dispense", ...JUSTIFIE },    // dispense d'épreuve, formation maintenue
  ]);
  assert.deepEqual(blocsAlleges(blocs), ["b1"], "seul l'allègement dispense de la formation");
});

test("les cinq motifs couvrent les cas réels et portent leurs valeurs par défaut", () => {
  assert.deepEqual(MOTIF_IDS, ["acquis_anterieur", "vae", "equivalence", "dispense", "allegement"]);
  // Les blocs sont acquis définitivement depuis la loi du 5 septembre 2018 :
  // c'est le cas d'usage le plus fréquent, il doit dispenser des deux.
  assert.equal(MOTIFS.acquis_anterieur.dispenseEpreuve, true);
  assert.equal(MOTIFS.acquis_anterieur.dispenseFormation, true);
  // L'allègement, lui, ne dispense JAMAIS de l'épreuve par défaut.
  assert.equal(MOTIFS.allegement.dispenseEpreuve, false);
  assert.equal(MOTIFS.allegement.dispenseFormation, true);
  for (const m of MOTIF_IDS) assert.ok(MOTIFS[m].label && MOTIFS[m].aide, `${m} doit être expliqué à l'utilisateur`);
});

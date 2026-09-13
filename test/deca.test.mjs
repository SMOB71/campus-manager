import test from "node:test";
import assert from "node:assert/strict";
import { etatDepot, tableauDeBord, validateDepot, ajouterJoursOuvrables, ETATS, DELAI_DECISION_JOURS } from "../lib/deca.js";

const contrat = { id: "c1", dateDebut: "2027-01-04" };   // lundi
const codes = (e) => e.alertes.map((a) => a.code);

test("jours ouvrables : samedi et dimanche ne comptent pas, les fériés non plus", () => {
  // Lundi 4 janvier + 5 jours ouvrables = lundi 11.
  assert.equal(ajouterJoursOuvrables("2027-01-04", 5), "2027-01-11");
  // Avec un férié le vendredi 8, l'échéance glisse au mardi 12.
  assert.equal(ajouterJoursOuvrables("2027-01-04", 5, ["2027-01-08"]), "2027-01-12");
  assert.equal(ajouterJoursOuvrables(null, 5), null);
});

test("LE SILENCE DE L'OPCO VAUT REFUS — et c'est une alerte, pas une absence de nouvelle", () => {
  // Décret n° 2024-631 du 28 juin 2024 : le silence valait autrefois
  // acceptation. Traiter « pas de nouvelles » comme « tout va bien » se trompe
  // désormais dans le sens le plus coûteux : contrat exécuté, financement perdu.
  const e = etatDepot({ contrat, depot: { etat: "transmis", dateTransmission: "2027-01-06", opco: "OPCO Test" }, aujourdhui: "2027-02-10" });
  assert.equal(e.risque, "critique");
  assert.ok(codes(e).includes("silence_vaut_refus"));
  const m = e.alertes.find((a) => a.code === "silence_vaut_refus").message;
  assert.match(m, /vaut REFUS/);
  assert.match(m, /2024-631/, "la référence permet de vérifier plutôt que de croire");
  assert.equal(e.finance, false);
  assert.equal(e.clos, false, "le dossier n'est pas clos pour autant : il faut relancer");
});

test("délai de décision : alerte AVANT l'échéance, pas après", () => {
  const e = etatDepot({ contrat, depot: { etat: "transmis", dateTransmission: "2027-01-06" }, aujourdhui: "2027-01-23" });
  assert.equal(e.echeanceDecision, "2027-01-26", `${DELAI_DECISION_JOURS} jours après la transmission`);
  assert.equal(e.risque, "moyen");
  assert.ok(codes(e).includes("decision_imminente"));

  // Loin de l'échéance : rien à signaler.
  const calme = etatDepot({ contrat, depot: { etat: "transmis", dateTransmission: "2027-01-06" }, aujourdhui: "2027-01-10" });
  assert.equal(calme.risque, "aucun");
  assert.deepEqual(calme.alertes, []);
});

test("transmission : 5 jours ouvrables après le DÉBUT du contrat", () => {
  const aTemps = etatDepot({ contrat, depot: {}, aujourdhui: "2027-01-06" });
  assert.equal(aTemps.echeanceTransmission, "2027-01-11");
  assert.equal(aTemps.risque, "aucun");

  const imminent = etatDepot({ contrat, depot: {}, aujourdhui: "2027-01-10" });
  assert.equal(imminent.risque, "moyen");
  assert.ok(codes(imminent).includes("transmission_imminente"));

  const rate = etatDepot({ contrat, depot: {}, aujourdhui: "2027-01-15" });
  assert.equal(rate.risque, "eleve");
  assert.ok(codes(rate).includes("transmission_hors_delai"));
});

test("dossier retourné : le délai de décision RECOMMENCE à la nouvelle transmission", () => {
  const e = etatDepot({ contrat, depot: { etat: "a_corriger", dateTransmission: "2027-01-06", motif: "SIRET erroné" }, aujourdhui: "2027-02-10" });
  assert.equal(e.risque, "eleve");
  const m = e.alertes.find((a) => a.code === "a_corriger").message;
  assert.match(m, /SIRET erroné/);
  assert.match(m, /recommence/);
  // Et surtout : on ne crie pas au silence sur un dossier qui n'est plus chez l'OPCO.
  assert.equal(codes(e).includes("silence_vaut_refus"), false);
});

test("refus explicite : le financement est perdu, et on le dit", () => {
  const e = etatDepot({ contrat, depot: { etat: "refuse", dateTransmission: "2027-01-06", dateDecision: "2027-01-20", motif: "durée non conforme" }, aujourdhui: "2027-02-01" });
  assert.equal(e.risque, "critique");
  assert.equal(e.clos, true);
  assert.equal(e.finance, false);
  assert.match(e.alertes[0].message, /ne sera pas financée/);
});

test("accord : dossier clos, financé, plus aucune alerte", () => {
  const e = etatDepot({ contrat, depot: { etat: "accepte", dateTransmission: "2027-01-06", dateDecision: "2027-01-18" }, aujourdhui: "2027-03-01" });
  assert.equal(e.finance, true);
  assert.equal(e.clos, true);
  assert.deepEqual(e.alertes, []);
  assert.equal(e.risque, "aucun");
});

test("validation : ce qui empêche de suivre un dossier", () => {
  assert.equal(validateDepot({ etat: "transmis" }, contrat).ok, false, "transmis sans date de transmission");
  assert.ok(validateDepot({ etat: "accepte", dateTransmission: "2027-01-06" }, contrat).errors.some((e) => /date de décision/.test(e)));
  assert.equal(validateDepot({ etat: "inventé" }, contrat).ok, false);

  const refusSansMotif = validateDepot({ etat: "refuse", dateTransmission: "2027-01-06", dateDecision: "2027-01-20" }, contrat);
  assert.equal(refusSansMotif.ok, true, "on peut enregistrer le refus…");
  assert.ok(refusSansMotif.warnings.some((w) => /impossible de corriger ni de contester/.test(w)), "…mais sans motif on ne peut rien en faire");

  const avant = validateDepot({ etat: "transmis", dateTransmission: "2026-12-01" }, contrat);
  assert.ok(avant.warnings.some((w) => /avant le début du contrat/.test(w)));
});

test("tableau de bord : le plus urgent en tête, et le chiffre qui compte", () => {
  const contrats = [
    { id: "ok", apprenant: "A", dateDebut: "2027-01-04", depot: { etat: "accepte", dateTransmission: "2027-01-06", dateDecision: "2027-01-15" } },
    { id: "silence", apprenant: "B", dateDebut: "2027-01-04", depot: { etat: "transmis", dateTransmission: "2027-01-06" } },
    { id: "retard", apprenant: "C", dateDebut: "2027-01-04", depot: {} },
  ];
  const t = tableauDeBord(contrats, { aujourdhui: "2027-02-15" });
  assert.equal(t.total, 3);
  assert.equal(t.lignes[0].contratId, "silence", "le risque critique passe devant");
  assert.equal(t.finances, 1);
  assert.equal(t.aTraiter, 2);
  // De la trésorerie déjà engagée : formation dispensée, financement compromis.
  assert.equal(t.financementCompromis, 1);
  assert.ok(Object.keys(ETATS).includes("a_corriger"));
});

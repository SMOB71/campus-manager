import test from "node:test";
import assert from "node:assert/strict";
import { heuresConstatees, ligneDePaie, preparerExport, validateIntervenant, STATUTS, REGLES_PREPARATION } from "../lib/paie.js";

const s = (date, start, end, status = "done") => ({ date, start, end, status });

test("UN INDÉPENDANT N'ENTRE JAMAIS DANS UN EXPORT DE PAIE", () => {
  // Ce n'est pas une maladresse d'export : la ligne de paie serait la pièce
  // servant à démontrer un lien de subordination et à requalifier le contrat.
  const r = ligneDePaie({ id: "t1", name: "Mme Externe", status: "prestataire", tauxHoraire: 60 },
    [s("2027-01-11", "09:00", "12:00")], { from: "2027-01-01", to: "2027-01-31" });
  assert.equal(r.exclu, true);
  assert.match(r.motif, /requalification en contrat de travail/);
  assert.equal(r.brut, undefined, "aucun montant n'est calculé pour un indépendant");
  // Ses heures restent visibles — il facture sur cette base.
  assert.equal(r.constate.heures, 3);
  assert.equal(STATUTS.prestataire.paie, false);
});

test("statut non renseigné : on ne tranche pas à la place de l'organisme", () => {
  const r = ligneDePaie({ id: "t2", name: "M. Inconnu", tauxHoraire: 50 }, [s("2027-01-11", "09:00", "12:00")], {});
  assert.equal(r.exclu, true);
  assert.match(r.motif, /impossible de trancher/);
});

test("LES HEURES DE FACE-À-FACE NE SONT PAS LES HEURES PAYÉES", () => {
  // Le temps de préparation se paie aussi. Un export qui remonte les seules
  // heures de cours sous-paie l'intervenant.
  const seances = [s("2027-01-11", "09:00", "13:00"), s("2027-01-12", "09:00", "13:00")];  // 8 h
  const brut = ligneDePaie({ id: "t3", name: "M. Formateur", status: "vacataire", tauxHoraire: 40, matricule: "M1" }, seances, {});
  assert.equal(brut.heuresConstatees, 8);
  assert.equal(brut.heuresPayees, 8, "sans règle, on ne majore rien de soi-même");
  assert.equal(brut.brut, 320);

  const avecPrepa = ligneDePaie({ id: "t3", name: "M. Formateur", status: "vacataire", tauxHoraire: 40, matricule: "M1", regle: "forfait_25" }, seances, {});
  assert.equal(avecPrepa.heuresPayees, 10);
  assert.equal(avecPrepa.brut, 400);
  assert.match(avecPrepa.regle, /25 %/);
  assert.equal(REGLES_PREPARATION.forfait_25.coefficient, 1.25);
});

test("une séance ANNULÉE n'est pas payée, et une séance non confirmée non plus", () => {
  const r = heuresConstatees([
    s("2027-01-11", "09:00", "12:00", "done"),
    s("2027-01-12", "09:00", "12:00", "cancelled"),
    s("2027-01-13", "09:00", "12:00", "planned"),
  ]);
  assert.equal(r.heures, 3, "seule la séance assurée compte");
  assert.equal(r.annulees, 1);
  assert.equal(r.planifiees, 1, "une séance non confirmée est comptée à part, pas payée");
});

test("heures : bornées par la période, horaires incohérents ignorés", () => {
  const seances = [s("2026-12-31", "09:00", "12:00"), s("2027-01-15", "09:00", "12:00"), s("2027-02-01", "09:00", "12:00")];
  assert.equal(heuresConstatees(seances, { from: "2027-01-01", to: "2027-01-31" }).heures, 3);
  assert.equal(heuresConstatees([s("2027-01-11", "14:00", "09:00")]).heures, 0, "fin avant début : ignorée");
  assert.equal(heuresConstatees([{ date: "2027-01-11", start: "bof", end: "12:00", status: "done" }]).heures, 0);
});

test("export : les indépendants sont écartés ET listés, jamais silencieusement omis", () => {
  const intervenants = [
    { id: "a", name: "Salarié Un", status: "vacataire", tauxHoraire: 40, matricule: "M1" },
    { id: "b", name: "Indépendant Deux", status: "prestataire", tauxHoraire: 60 },
  ];
  const seances = new Map([
    ["a", [s("2027-01-11", "09:00", "13:00")]],
    ["b", [s("2027-01-12", "09:00", "13:00")]],
  ]);
  const r = preparerExport({ intervenants, seancesParIntervenant: seances, from: "2027-01-01", to: "2027-01-31" });
  assert.equal(r.lignes.length, 1);
  assert.equal(r.lignes[0].nom, "Salarié Un");
  assert.equal(r.exclus.length, 1, "l'exclusion est visible : l'organisme doit savoir qu'il faut une facture");
  assert.match(r.exclus[0].motif, /il facture/);
  assert.equal(r.totalBrut, 160);
  assert.equal(r.transmettable, true);
});

test("export : un taux ou un matricule manquant empêche la transmission", () => {
  // Un export de paie faux se découvre sur le bulletin du salarié.
  const r = preparerExport({
    intervenants: [{ id: "a", name: "Sans Taux", status: "vacataire", matricule: "M1" }],
    seancesParIntervenant: new Map([["a", [s("2027-01-11", "09:00", "13:00")]]]),
    from: "2027-01-01", to: "2027-01-31",
  });
  assert.equal(r.transmettable, false);
  assert.ok(r.incomplets.some((i) => /aucun taux horaire/.test(i)));
  assert.equal(r.lignes[0].brut, 0, "on n'invente pas un taux");
});

test("export : aucune ligne vide pour qui n'a rien assuré", () => {
  const r = preparerExport({
    intervenants: [{ id: "a", name: "Absent", status: "vacataire", tauxHoraire: 40, matricule: "M1" }],
    seancesParIntervenant: new Map([["a", [s("2027-01-11", "09:00", "13:00", "cancelled")]]]),
    from: "2027-01-01", to: "2027-01-31",
  });
  assert.equal(r.lignes.length, 0);
  assert.equal(r.transmettable, false, "un export vide n'est pas un export prêt");
});

test("export : les séances non confirmées sont remontées — payer sur cette base, c'est payer au jugé", () => {
  const r = preparerExport({
    intervenants: [{ id: "a", name: "Prof", status: "vacataire", tauxHoraire: 40, matricule: "M1" }],
    seancesParIntervenant: new Map([["a", [s("2027-01-11", "09:00", "13:00", "done"), s("2027-01-12", "09:00", "13:00", "planned")]]]),
    from: "2027-01-01", to: "2027-01-31",
  });
  assert.equal(r.lignes[0].heuresConstatees, 4);
  assert.equal(r.seancesNonConfirmees, 1);
});

test("validation d'un intervenant : refus et avertissements distingués", () => {
  assert.equal(validateIntervenant({}).ok, false);
  assert.ok(validateIntervenant({ name: "X", status: "inventé" }).errors.some((e) => /statut inconnu/.test(e)));
  const sansStatut = validateIntervenant({ name: "X" });
  assert.equal(sansStatut.ok, true, "on peut enregistrer un intervenant incomplet…");
  assert.ok(sansStatut.warnings.some((w) => /paie ou.*facturation/.test(w)), "…mais on dit ce qui manquera");
  assert.equal(validateIntervenant({ name: "X", status: "vacataire", tauxHoraire: 40, matricule: "M1" }).warnings.length, 0);
});

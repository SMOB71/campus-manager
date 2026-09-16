// Dossier RH des intervenants et masse horaire face au budget.
//
// Deux erreurs que ce module existe pour empêcher : confondre le taux horaire
// BRUT avec le COÛT EMPLOYEUR, et comparer un budget annuel à des heures
// cumulées sans regarder où l'on en est dans l'année.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAMPS_RH, A_TRANSMETTRE_RH, dossierRh, volumeContractuel,
  coutIntervenant, avancementAnnee, masseCampus,
} from "../lib/intervenants.js";

const salarie = (p = {}) => ({
  id: "t1", name: "Claire Martin", email: "c@x.fr", status: "vacataire",
  subjects: ["Optique"], tauxHoraire: 45, heuresAnnuelles: 200,
  campusIds: ["c1"], matricule: "M12", regle: "+10 % préparation", ...p,
});
const seance = (start, end, moduleId = "m1", p = {}) => ({ start, end, moduleId, status: "done", ...p });

test("un dossier complet dit qu'il l'est, et chaque manque dit ce qu'il bloque", () => {
  const ok = dossierRh(salarie());
  assert.equal(ok.complet, true);
  assert.equal(ok.completude, 100);

  const ko = dossierRh(salarie({ tauxHoraire: null, subjects: [] }));
  assert.equal(ko.complet, false);
  assert.equal(ko.manquants.length, 2);
  for (const m of ko.manquants) assert.ok(m.bloque && m.bloque.length > 15, m.cle);
  assert.match(ko.manquants.map((m) => m.bloque).join(" "), /rémunération|objet du contrat/);
});

// Les deux statuts n'ont pas le même contrat, donc pas le même dossier.
test("un prestataire n'a ni matricule ni règle de paie, mais une société", () => {
  const p = dossierRh({ id: "t2", name: "Studio X", email: "s@x.fr", status: "prestataire",
    subjects: ["Gestion"], tauxHoraire: 70, heuresAnnuelles: 50, campusIds: ["c1"], company: "Studio X SARL" });
  assert.equal(p.prestataire, true);
  assert.equal(p.complet, true);
  const cles = p.lignes.map((l) => l.cle);
  assert.ok(cles.includes("company"));
  assert.equal(cles.includes("matricule"), false, "un prestataire n'entre pas dans la paie");
  assert.equal(cles.includes("regle"), false);
  // Et la vigilance URSSAF le concerne, lui.
  assert.match(JSON.stringify(p.aTransmettre), /URSSAF/);
});

// Ce que l'application refuse de stocker, et le dit.
test("les données les plus sensibles sont à transmettre à la RH, pas à saisir ici", () => {
  const d = dossierRh(salarie());
  assert.match(JSON.stringify(A_TRANSMETTRE_RH), /sécurité sociale/);
  assert.match(JSON.stringify(A_TRANSMETTRE_RH), /bancaires/);
  // Aucun de ces champs n'est demandé dans le dossier saisi.
  const cles = CHAMPS_RH.map((c) => c.cle).join(" ");
  assert.doesNotMatch(cles, /nir|secu|iban|rib/i);
  assert.match(d.reserve, /seconde base des données les plus sensibles/);
});

// LE VOLUME EST DÉRIVÉ, PAS SAISI.
test("les heures viennent du planning, et l'écart avec le contrat est nommé", () => {
  const affectations = [
    seance("09:00", "12:00"), seance("14:00", "16:00"),
    seance("09:00", "11:00", "m2"),
    seance("09:00", "11:00", "m2", { status: "cancelled" }),   // annulée : ne compte pas
  ];
  const v = volumeContractuel(salarie({ heuresAnnuelles: 5 }), affectations,
    { libelles: { m1: "Optique géométrique", m2: "Gestion" } });

  assert.equal(v.heuresAffectees, 7);
  assert.equal(v.heuresAuContrat, 5);
  assert.equal(v.ecart, 2);
  assert.equal(v.matieres[0].label, "Optique géométrique");
  assert.equal(v.matieres[0].heures, 5);
  assert.equal(v.matieres[1].heures, 2);
  // On dit quoi faire, pas seulement qu'il y a un écart.
  assert.match(v.alerte.message, /heures supplémentaires ou demanderont un avenant/);
});

test("un service non rempli est signalé dans l'autre sens", () => {
  const v = volumeContractuel(salarie({ heuresAnnuelles: 200 }), [seance("09:00", "12:00")]);
  assert.equal(v.ecart, -197);
  assert.match(v.alerte.message, /payée sans être posée/);
  assert.equal(v.alerte.gravite, "conseille");
});

test("sans volume au contrat, on ne peut rien conclure et on le dit", () => {
  const v = volumeContractuel(salarie({ heuresAnnuelles: null }), [seance("09:00", "12:00")]);
  assert.equal(v.heuresAuContrat, null);
  assert.equal(v.ecart, null);
  assert.match(v.alerte.message, /impossible de dire/);
});

// LE PIÈGE N° 1.
test("LE TAUX HORAIRE BRUT N'EST PAS LE COÛT EMPLOYEUR", () => {
  // Sans coefficient déclaré, on REFUSE de produire un coût chargé plutôt que
  // de servir le brut, qui sous-estimerait la dépense d'environ 40 %.
  const sans = coutIntervenant({ heures: 100, tauxHoraire: 45, statut: "vacataire" });
  assert.equal(sans.brut, 4500);
  assert.equal(sans.charge, null);
  assert.match(sans.motif, /40 %/);

  const avec = coutIntervenant({ heures: 100, tauxHoraire: 45, statut: "vacataire", coefficientCharges: 1.42 });
  assert.equal(avec.brut, 4500);
  assert.equal(avec.charge, 6390);

  // Un prestataire ne génère PAS de charges patronales : sa facture est le coût.
  // Lui appliquer le coefficient gonflerait le budget d'une dépense inexistante.
  const p = coutIntervenant({ heures: 100, tauxHoraire: 70, statut: "prestataire", coefficientCharges: 1.42 });
  assert.equal(p.brut, 7000);
  assert.equal(p.charge, 7000);
  assert.equal(p.coefficient, 1);

  // Taux absent : on ne devine pas.
  assert.equal(coutIntervenant({ heures: 10, tauxHoraire: null }).brut, null);
});

test("l'avancement de l'année se calcule sur les bornes déclarées", () => {
  assert.equal(avancementAnnee("2026-09-01", "2027-08-31", "2026-09-01"), 0);
  assert.equal(Math.round(avancementAnnee("2026-09-01", "2027-08-31", "2027-08-31") * 100), 100);
  assert.ok(Math.abs(avancementAnnee("2026-09-01", "2027-08-31", "2027-03-02") - 0.5) < 0.02);
  assert.equal(avancementAnnee(null, "2027-08-31", "2027-01-01"), null);
});

const dossier = (t, heures) => ({
  intervenant: t,
  dossier: dossierRh(t),
  volume: { heuresAffectees: heures, heuresAuContrat: t.heuresAnnuelles, ecart: heures - (t.heuresAnnuelles ?? heures) },
});

// LE PIÈGE N° 2.
test("30 % DE BUDGET CONSOMMÉ EN NOVEMBRE N'EST PAS UNE BONNE NOUVELLE", () => {
  // 100 h à 45 € chargées à 1,42 = 6 390 €, pour un budget de 20 000 €.
  // Soit 32 % du budget — rassurant, sauf que l'année n'est écoulée qu'à 20 %.
  const m = masseCampus({
    dossiers: [dossier(salarie({ heuresAnnuelles: 300 }), 100)],
    budget: 20000, coefficientCharges: 1.42, avancement: 0.2,
  });
  assert.equal(m.cout, 6390);
  assert.equal(m.consommation, 32);
  // La projection est ce qui change la lecture.
  assert.equal(m.projection, 31950);
  const traj = m.alertes.find((a) => a.code === "trajectoire");
  assert.ok(traj, "un budget consommé plus vite que l'année doit alerter");
  assert.equal(traj.gravite, "bloquant");
  assert.match(traj.message, /dépassement/);

  // Au même rythme que l'année, aucune alerte de trajectoire.
  const sain = masseCampus({
    dossiers: [dossier(salarie({ heuresAnnuelles: 300 }), 100)],
    budget: 40000, coefficientCharges: 1.42, avancement: 0.2,
  });
  assert.equal(sain.alertes.some((a) => a.code === "trajectoire"), false);
});

// Un total calculé sur une partie des intervenants n'est pas un total.
test("un intervenant non chiffrable rend le total PARTIEL, et on le dit", () => {
  const m = masseCampus({
    dossiers: [
      dossier(salarie(), 100),
      dossier(salarie({ id: "t3", name: "Sans taux", tauxHoraire: null }), 80),
    ],
    budget: 20000, coefficientCharges: 1.42,
  });
  const a = m.alertes.find((x) => x.code === "incomplet");
  assert.ok(a);
  assert.match(a.message, /partiel/);
  // Tant que le total est partiel, on ne prononce pas de taux de consommation :
  // il paraîtrait tenu parce qu'il manque des lignes.
  assert.equal(m.consommation, null);
  // Les heures, elles, se comptent quand même.
  assert.equal(m.heures, 180);
});

test("sans coefficient de charges, rien n'est chiffré — c'est voulu", () => {
  const m = masseCampus({ dossiers: [dossier(salarie(), 100)], budget: 20000, coefficientCharges: null });
  assert.equal(m.cout, 0);
  assert.match(m.alertes.find((a) => a.code === "incomplet").message, /40 %/);
});

test("les dossiers incomplets remontent : la RH ne peut pas rédiger sans eux", () => {
  const m = masseCampus({
    dossiers: [dossier(salarie({ subjects: [] }), 100)],
    budget: 50000, coefficientCharges: 1.42,
  });
  const a = m.alertes.find((x) => x.code === "dossiers");
  assert.ok(a);
  assert.match(a.message, /ne peut pas rédiger/);
});

test("les heures affectées au-delà des contrats se totalisent", () => {
  const m = masseCampus({
    dossiers: [
      dossier(salarie({ heuresAnnuelles: 50 }), 80),    // +30
      dossier(salarie({ id: "t4", heuresAnnuelles: 100 }), 90),  // -10, ne compte pas
    ],
    budget: 50000, coefficientCharges: 1.42,
  });
  assert.equal(m.horsContrat, 30, "seul le dépassement compte : un sous-service ne le compense pas");
});

test("sans budget déclaré, la masse ne se compare à rien et le dit", () => {
  const m = masseCampus({ dossiers: [dossier(salarie(), 100)], budget: null, coefficientCharges: 1.42 });
  assert.equal(m.consommation, null);
  assert.ok(m.alertes.find((a) => a.code === "sans_budget"));
  assert.match(m.reserve, /ne remplace pas la paie/);
});

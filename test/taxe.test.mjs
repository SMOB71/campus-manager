import test from "node:test";
import assert from "node:assert/strict";
import { etatCampagne, soldeEstime, validateHabilitation, evolution, CALENDRIER_2026, TAUX_SOLDE_MASSE_SALARIALE } from "../lib/taxe.js";

const c = CALENDRIER_2026;
const codes = (e) => e.alertes.map((a) => a.code);

test("LE GUICHET D'HABILITATION FERME QUATRE MOIS AVANT LA CAMPAGNE", () => {
  // C'est le piège qui coûte une année entière : un organisme qui pense à la
  // taxe au printemps découvre que le guichet est fermé depuis janvier.
  const automne = etatCampagne({ habilitation: {}, aujourdhui: "2025-11-20" });
  assert.ok(codes(automne).includes("habilitation_ouverte"));
  assert.match(automne.alertes[0].message, /aucune entreprise ne pourra vous désigner/);

  const janvier = etatCampagne({ habilitation: {}, aujourdhui: "2026-01-10" });
  assert.equal(janvier.risque, "eleve", "à moins d'un mois de la fermeture, l'alerte monte");

  const printemps = etatCampagne({ habilitation: {}, aujourdhui: "2026-05-30" });
  assert.equal(printemps.risque, "critique");
  assert.ok(codes(printemps).includes("habilitation_manquee"));
  assert.match(printemps.alertes[0].message, /pas de rattrapage/);
});

test("LE VERSEMENT DE SEPTEMBRE N'EST PAS LE TOTAL", () => {
  // Deux périodes de répartition, deux versements. Prendre le premier pour un
  // total sous-estime la recette et fausse la trésorerie du dernier trimestre.
  const e = etatCampagne({
    habilitation: { etat: "habilite", numeroUai: "0751234X" },
    versements: [{ periode: 1, date: "2026-09-05", montant: 4200 }],
    aujourdhui: "2026-09-20",
  });
  assert.equal(e.total, 4200);
  assert.equal(e.totalDefinitif, false);
  assert.ok(codes(e).includes("second_versement_attendu"));
  assert.match(e.alertes.find((a) => a.code === "second_versement_attendu").message, /2026-11-05/);

  const complet = etatCampagne({
    habilitation: { etat: "habilite" },
    versements: [{ periode: 1, montant: 4200 }, { periode: 2, montant: 1800 }],
    aujourdhui: "2026-11-10",
  });
  assert.equal(complet.total, 6000);
  assert.equal(complet.totalDefinitif, true);
  assert.equal(codes(complet).includes("second_versement_attendu"), false);
});

test("habilité mais aucun versement après l'échéance : on le signale", () => {
  const e = etatCampagne({ habilitation: { etat: "habilite" }, versements: [], aujourdhui: "2026-09-20" });
  assert.ok(codes(e).includes("premier_versement_absent"));
  assert.match(e.alertes.find((a) => a.code === "premier_versement_absent").message, /vérifier les désignations/);
});

test("période de répartition ouverte : c'est le moment où les entreprises désignent", () => {
  const e = etatCampagne({ habilitation: { etat: "habilite" }, aujourdhui: "2026-06-15" });
  assert.equal(e.periodeEnCours, 1);
  assert.ok(codes(e).includes("periode_ouverte"));
  const deux = etatCampagne({ habilitation: { etat: "habilite" }, aujourdhui: "2026-09-20" });
  assert.equal(deux.periodeEnCours, 2);
  // Hors période : rien à annoncer.
  assert.equal(etatCampagne({ habilitation: { etat: "habilite" }, aujourdhui: "2026-08-28" }).periodeEnCours, null);
});

test("refus d'habilitation : aucun solde cette année, et on le dit", () => {
  const e = etatCampagne({ habilitation: { etat: "refusee", motif: "pièces incomplètes" }, aujourdhui: "2026-03-01" });
  assert.equal(e.risque, "critique");
  assert.match(e.alertes[0].message, /pièces incomplètes/);
  assert.match(e.alertes[0].message, /Aucun solde ne sera perçu/);
});

test("estimation du solde d'un employeur : le chiffre vient avec sa formule", () => {
  const s = soldeEstime(1000000);
  assert.equal(s.taxeTotale, 6800);
  assert.equal(s.solde, 900, "0,09 % de la masse salariale");
  assert.equal(TAUX_SOLDE_MASSE_SALARIALE, 0.0009);
  assert.match(s.formule, /0,68 %|0\.68 %/);
  assert.equal(soldeEstime(0), null, "on n'invente pas un montant sur une masse salariale absente");
});

test("validation : le code UAI est ce qui vous rend trouvable sur la plateforme", () => {
  assert.equal(validateHabilitation({ etat: "deposee" }).ok, false, "déposée sans date de dépôt");
  const sansUai = validateHabilitation({ etat: "habilite", dateDepot: "2025-12-01" });
  assert.equal(sansUai.ok, true);
  assert.ok(sansUai.warnings.some((w) => /une entreprise ne vous trouvera pas/.test(w)));
  assert.equal(validateHabilitation({ etat: "inventé" }).ok, false);
});

test("évolution d'une campagne à l'autre : le seul chiffre qui mesure l'effort", () => {
  const e = evolution({ total: 6000 }, { total: 5000 });
  assert.equal(e.ecart, 1000);
  assert.equal(e.pourcent, 20);
  assert.equal(evolution({ total: 6000 }, { total: 0 }).pourcent, null, "aucune division par zéro");
});

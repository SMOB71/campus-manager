import test from "node:test";
import assert from "node:assert/strict";
import { validateMobilite, periodesNeutralisees, estEnMobilite, filtrerSeances, tableauDeBord, dureeJours, REGIMES, SEUIL_MISE_EN_VEILLE_JOURS } from "../lib/mobilite.js";

const mob = (o = {}) => ({ id: "m1", learnerId: "l1", regime: "ue", pays: "Espagne",
  structureAccueil: "Óptica Madrid", dateDebut: "2027-03-01", dateFin: "2027-04-11",
  etat: "conventionnee", convention: "CONV-2027-01", referentCfa: "Mme Martin", ...o });

test("UNE MOBILITÉ N'EST PAS UNE ABSENCE — les séances sont neutralisées", () => {
  // Sans cette notion, six semaines à l'étranger ressemblent à six semaines
  // d'absence : l'assiduité s'effondre et l'alerte de décrochage se déclenche
  // sur un apprenti exemplaire.
  const seances = [
    { date: "2027-02-20" }, { date: "2027-03-10" }, { date: "2027-03-25" }, { date: "2027-04-20" },
  ];
  const r = filtrerSeances(seances, [mob()]);
  assert.equal(r.retenues.length, 2, "seules les séances hors mobilité comptent");
  assert.equal(r.neutralisees, 2);
  // La neutralisation est explicite : silencieuse, elle serait invérifiable.
  assert.equal(r.periodes.length, 1);
  assert.match(r.periodes[0].motif, /Espagne/);
});

test("seules les mobilités RÉELLES neutralisent — un projet ne suspend rien", () => {
  assert.equal(periodesNeutralisees([mob({ etat: "projet" })]).length, 0);
  assert.equal(periodesNeutralisees([mob({ etat: "annulee" })]).length, 0);
  assert.equal(periodesNeutralisees([mob({ etat: "en_cours" })]).length, 1);
  assert.equal(periodesNeutralisees([mob({ etat: "terminee" })]).length, 1);
  assert.equal(estEnMobilite([mob()], "2027-03-15"), true);
  assert.equal(estEnMobilite([mob()], "2027-05-01"), false);
  // Sans mobilité, rien n'est retiré.
  const s = [{ date: "2027-03-10" }];
  assert.equal(filtrerSeances(s, []).retenues.length, 1);
});

test("MISE EN VEILLE : obligatoire hors Union, attendue au-delà de quatre semaines", () => {
  // Le contrat est suspendu, et avec lui les obligations de l'employeur
  // (art. L. 6222-42). Le supposer actif serait une erreur de droit.
  assert.equal(REGIMES.hors_ue.miseEnVeilleObligatoire, true);
  assert.equal(REGIMES.ue.miseEnVeilleObligatoire, false);

  const horsUe = validateMobilite(mob({ regime: "hors_ue", pays: "Canada", miseEnVeille: false, couvertureSociale: true }));
  assert.equal(horsUe.veilleAttendue, true);
  assert.ok(horsUe.warnings.some((w) => /suspension est normalement la règle/.test(w)));

  // Courte mobilité dans l'Union : le contrat français peut continuer.
  const courte = validateMobilite(mob({ dateFin: "2027-03-14", miseEnVeille: false }));
  assert.equal(courte.duree, 14);
  assert.equal(courte.veilleAttendue, false);
  assert.deepEqual(courte.warnings.filter((w) => /suspension/.test(w)), []);
  assert.equal(SEUIL_MISE_EN_VEILLE_JOURS, 28);
});

test("HORS UNION : la couverture sociale ne découle PAS du contrat français", () => {
  // C'est le point où l'on découvre trop tard qu'un apprenti n'était couvert
  // pour rien.
  const v = validateMobilite(mob({ regime: "hors_ue", pays: "Canada", miseEnVeille: true }));
  assert.ok(v.warnings.some((w) => /couverture sociale hors Union non attestée/.test(w)));
  const attestee = validateMobilite(mob({ regime: "hors_ue", pays: "Canada", miseEnVeille: true, couvertureSociale: "AT/MP + assurance privée" }));
  assert.equal(attestee.warnings.some((w) => /couverture sociale/.test(w)), false);
});

test("une mobilité conventionnée SANS convention est refusée", () => {
  const v = validateMobilite(mob({ convention: null }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /aucune convention enregistrée/.test(e)));
  assert.match(v.errors.find((e) => /convention/.test(e)), /lie le CFA, l'employeur, l'apprenti et la structure/);
  // Un simple projet n'en exige pas encore.
  assert.equal(validateMobilite(mob({ etat: "projet", convention: null })).ok, true);
});

test("la mobilité ne peut pas déborder du contrat d'apprentissage", () => {
  const v = validateMobilite(mob({ dateFin: "2028-01-01" }), { dateFin: "2027-08-31" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /se termine après le contrat/.test(e)));
});

test("validation : champs indispensables et dates cohérentes", () => {
  assert.equal(validateMobilite({}).ok, false);
  const v = validateMobilite({});
  for (const attendu of [/dates de début et de fin/, /régime requis/, /pays d'accueil/, /structure d'accueil/]) {
    assert.ok(v.errors.some((e) => attendu.test(e)), `manque non signalé : ${attendu}`);
  }
  assert.ok(validateMobilite(mob({ dateDebut: "2027-04-01", dateFin: "2027-03-01" })).errors.some((e) => /antérieure/.test(e)));
  assert.equal(dureeJours(mob()), 42, "bornes incluses");
  assert.ok(validateMobilite(mob({ referentCfa: null })).warnings.some((w) => /référent mobilité/.test(w)));
});

test("tableau de bord : une mobilité sans convention n'existe pas juridiquement", () => {
  const t = tableauDeBord([
    mob(),
    mob({ id: "m2", etat: "en_cours", convention: null, dateDebut: "2027-01-10", dateFin: "2027-02-20" }),
    mob({ id: "m3", etat: "projet", dateDebut: "2027-09-01", dateFin: "2027-10-01" }),
  ], { aujourdhui: "2027-02-01" });
  assert.equal(t.total, 3);
  assert.equal(t.enCours, 1);
  assert.equal(t.sansConvention, 1, "c'est le premier chiffre à regarder");
  assert.equal(t.lignes[0].id, "m2", "trié par date de début");
  assert.ok(t.lignes[0].alertes.some((a) => a.gravite === "bloquant"));
  assert.equal(t.joursCumules, 42 + 42 + 31);
});

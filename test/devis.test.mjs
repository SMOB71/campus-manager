// Devis et pipeline commercial.
// La garde centrale : un devis accepté n'est pas une convention.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ETAPES, VALIDITE_DEFAUT_JOURS,
  validateDevis, totaux, etatDevis, versActe, peutTransformer, pipeline, validiteParDefaut,
} from "../lib/devis.js";

const AUJ = "2026-09-16";
const devis = (p = {}) => ({
  id: "d1", client: "Optic Sud SARL", intitule: "Formation réfraction",
  dateEmission: "2026-09-01", dateValidite: "2026-10-01", etape: "envoye", dateEnvoi: "2026-09-01",
  lignes: [{ libelle: "Parcours 120 h", quantite: 3, prixUnitaire: 2400 }], ...p,
});

test("un devis sans ligne ne chiffre rien, et une date de validité manquante est signalée", () => {
  assert.equal(validateDevis(devis({ lignes: [] })).ok, false);
  assert.equal(validateDevis(devis({ client: "" })).ok, false);
  assert.equal(validateDevis(devis({ lignes: [{ libelle: "x", quantite: 0, prixUnitaire: 10 }] })).ok, false);
  assert.equal(validateDevis(devis({ dateValidite: "2026-08-01" })).ok, false, "validité avant émission");
  const v = validateDevis(devis({ dateValidite: null }));
  assert.equal(v.ok, true);
  assert.match(v.warnings.join(" "), /engage indéfiniment/);
});

test("la TVA est DÉCLARÉE, pas présumée à 20 %", () => {
  // La formation professionnelle est en principe exonérée : appliquer 20 % par
  // défaut gonflerait chaque devis d'un cinquième.
  const t = totaux(devis());
  assert.equal(t.ht, 7200);
  assert.equal(t.taux, 0);
  assert.equal(t.ttc, 7200);
  const avec = totaux(devis({ tauxTva: 0.2 }));
  assert.equal(avec.tva, 1440);
  assert.equal(avec.ttc, 8640);
});

// LA GARDE CENTRALE.
test("UN DEVIS ACCEPTÉ N'EST PAS UNE CONVENTION", () => {
  const e = etatDevis(devis({ etape: "accepte" }), AUJ);
  const a = e.alertes.find((x) => x.code === "sans_acte");
  assert.equal(a.gravite, "bloquant");
  assert.match(a.message, /L\. 6353-2/);
  assert.match(a.message, /exécuter sans le document requis/);

  // Une fois l'acte établi, l'alerte disparaît.
  assert.equal(etatDevis(devis({ etape: "accepte", acteId: "a1" }), AUJ).alertes.length, 0);
});

test("l'expiration se CONSTATE, elle n'attend pas qu'on change l'étape", () => {
  const e = etatDevis(devis({ dateValidite: "2026-09-01" }), AUJ);
  assert.equal(e.expire, true);
  assert.equal(e.etape, "expire", "l'étape affichée reflète le fait, pas la saisie");
  assert.equal(e.ouvert, false);
  assert.match(e.alertes[0].message, /n'engage plus aux conditions affichées/);
  assert.match(e.alertes[0].message, /prise en charge ont pu changer/);
});

test("un devis parti sans réponse se signale, sans dramatiser", () => {
  const e = etatDevis(devis({ dateEnvoi: "2026-09-01" }), AUJ);
  const a = e.alertes.find((x) => x.code === "a_relancer");
  assert.equal(a.gravite, "conseille");
  assert.match(a.message, /15 jours/);
});

test("la transformation refuse ce qui ne doit pas être transformé", () => {
  assert.equal(peutTransformer(devis({ etape: "envoye" }), AUJ).autorise, false);
  assert.equal(peutTransformer(devis({ etape: "accepte", acteId: "a1" }), AUJ).autorise, false);

  // Expiré : refus FORÇABLE — on peut assumer, pas se tromper.
  const exp = peutTransformer(devis({ etape: "accepte", dateValidite: "2026-09-01" }), AUJ);
  assert.equal(exp.autorise, false);
  assert.equal(exp.forcable, true);
  assert.match(exp.motif, /conditions qui ne sont plus garanties/);

  assert.equal(peutTransformer(devis({ etape: "accepte" }), AUJ).autorise, true);
});

test("versActe déduit le type du payeur et ne pré-remplit PAS ce qui manque", () => {
  const conv = versActe(devis({ dureeHeures: 120, effectif: 3 }), { payeur: "entreprise" });
  assert.equal(conv.type, "convention");
  assert.equal(conv.acheteur, "Optic Sud SARL");
  assert.equal(conv.beneficiaire, "");
  assert.equal(conv.prix, 7200);
  assert.equal(conv.devisId, "d1");

  const contrat = versActe(devis(), { payeur: "particulier" });
  assert.equal(contrat.type, "contrat");
  assert.equal(contrat.beneficiaire, "Optic Sud SARL");
  assert.equal(contrat.acheteur, "");

  // Ce qui n'était pas dans le devis reste VIDE : le remplir d'un « à compléter »
  // ferait passer une mention manquante pour une mention renseignée, et la
  // validation de l'acte ne la verrait plus.
  assert.equal(conv.resiliation, "");
  assert.equal(conv.moyens, "");
});

test("le pipeline EST la liste des devis, et le taux porte sur les devis tranchés", () => {
  const p = pipeline([
    devis({ id: "a", etape: "envoye" }),
    devis({ id: "b", etape: "accepte", acteId: "x" }),
    devis({ id: "c", etape: "refuse" }),
    devis({ id: "d", etape: "transforme", acteId: "y" }),
  ], AUJ);
  assert.equal(p.total, 4);
  assert.equal(p.enCours, 1);
  assert.equal(p.montantEnCours, 7200);
  assert.equal(p.montantGagne, 14400);
  // 2 gagnés sur 3 tranchés — le devis encore en cours n'entre pas au
  // dénominateur, sinon émettre ferait baisser le taux mécaniquement.
  assert.equal(p.tauxTransformation, 67);
  assert.match(p.reserve, /ni gagnés ni perdus/);
  assert.equal(p.parEtape.find((x) => x.etape === "accepte").n, 1);
});

test("un devis accepté sans acte remonte comme bloquant dans le pipeline", () => {
  const p = pipeline([devis({ id: "a", etape: "accepte" })], AUJ);
  assert.equal(p.bloquants, 1);
});

test("la validité par défaut évite de laisser le champ vide", () => {
  assert.equal(validiteParDefaut("2026-09-01"), "2026-10-01");
  assert.equal(VALIDITE_DEFAUT_JOURS, 30);
  assert.equal(validiteParDefaut(null), null);
  // Les étapes sont ordonnées : c'est ce qui permet un entonnoir.
  for (const [k, v] of Object.entries(ETAPES)) {
    assert.ok(v.label, k);
    assert.equal(typeof v.rang, "number");
    assert.equal(typeof v.ouvert, "boolean");
  }
});

// Catalogue de formation. Ce qui est publié engage l'organisme.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NATURES, MODALITES, MENTIONS_PUBLIABLES,
  validateOffre, libelleTarif, resultatsPubliables, versPublic, etatCatalogue,
} from "../lib/catalogue.js";

const offre = (p = {}) => ({
  id: "o1", nature: "continue", intitule: "Certificat d'optique", objectifs: "Maîtriser la réfraction",
  prerequis: "Bac", publicVise: "Salariés du secteur", dureeHeures: 120, modalites: "presentiel",
  delaiAcces: "Quinze jours ouvrés après la demande", tarif: "2 400 €", evaluation: "QCM et mise en situation",
  accessibilite: "Locaux accessibles, référent handicap joignable", debouches: "Opticien-lunetier",
  contact: "formation@campus.fr", ...p,
});

// LE POINT DE DROIT.
test("UN MONTANT SUR UNE OFFRE D'APPRENTISSAGE EST REFUSÉ : LA FORMATION EST GRATUITE", () => {
  const faux = validateOffre(offre({ nature: "apprentissage", tarifMontant: 9000 }));
  assert.equal(faux.ok, false);
  assert.match(faux.errors.join(" "), /L\. 6211-1/);
  assert.match(faux.errors.join(" "), /gratuite pour l'apprenti/);
  assert.match(faux.errors.join(" "), /n'est pas un prix de vente/);

  // Sans montant, l'offre passe — et le libellé se rédige tout seul.
  const ok = validateOffre(offre({ nature: "apprentissage" }));
  assert.equal(ok.ok, true);
  const t = libelleTarif({ nature: "apprentissage" });
  assert.equal(t.montantAffichable, false);
  assert.match(t.texte, /gratuite pour l'apprenti/);
  assert.match(t.texte, /opérateur de compétences/);

  // En formation continue, le montant s'affiche normalement.
  assert.equal(validateOffre(offre({ nature: "continue", tarifMontant: 2400 })).ok, true);
  assert.equal(libelleTarif({ nature: "continue", tarifMontant: 2400 }).montantAffichable, true);
  assert.equal(NATURES.apprentissage.gratuitePourBeneficiaire, true);
});

test("l'exigence mord à la PUBLICATION, pas à la saisie", () => {
  const brouillon = validateOffre(offre({ delaiAcces: "", accessibilite: "", publiee: false }));
  assert.equal(brouillon.ok, true, "un brouillon incomplet reste modifiable");
  assert.equal(brouillon.warnings.length, 2);

  const publiee = validateOffre(offre({ delaiAcces: "", accessibilite: "", publiee: true }));
  assert.equal(publiee.ok, false);
  assert.equal(publiee.errors.length, 2);
  assert.match(publiee.errors.join(" "), /indicateur 1/);
  assert.match(publiee.errors.join(" "), /indicateur 26/);
});

test("le délai d'accès est traqué à part : c'est l'écart le plus fréquent", () => {
  const m = MENTIONS_PUBLIABLES.find((x) => x.cle === "delaiAcces");
  assert.equal(m.oubliee, true);
  const e = etatCatalogue([offre({ delaiAcces: "" }), offre({ id: "o2" })]);
  assert.equal(e.sansDelaiAcces, 1);
});

// LE SEUIL, PARTAGÉ AVEC LES INDICATEURS RÉGLEMENTAIRES.
test("AUCUN TAUX PUBLIÉ SOUS LE SEUIL D'EFFECTIF, MÊME EN COMMERCIAL", () => {
  const r = resultatsPubliables({
    obtention: { valeur: 100, effectif: 3 },
    insertion: { valeur: 92, effectif: 40 },
  });
  const obt = r.lignes.find((l) => l.cle === "obtention");
  assert.equal(obt.publiable, false);
  assert.equal(obt.valeur, null, "« 100 % de réussite » sur trois apprenants désigne tout le monde");
  assert.match(obt.motif, /identifiables/);

  const ins = r.lignes.find((l) => l.cle === "insertion");
  assert.equal(ins.publiable, true);
  assert.equal(ins.valeur, 92);

  // Un taux sans son effectif n'est pas une information.
  const sans = resultatsPubliables({ obtention: { valeur: 100 } });
  assert.equal(sans.lignes[0].publiable, false);
  assert.match(sans.lignes[0].motif, /effectif non renseigné/);
  assert.match(r.reserve, /désignent des personnes/);
});

test("la vue publique ne laisse passer que ce qui est public", () => {
  const p = versPublic(offre({ coutRevient: 1800, marge: 600, notesInternes: "négocier à 2200" }),
    { resultats: { obtention: { valeur: 88, effectif: 25 } } });
  const brut = JSON.stringify(p);
  assert.equal(brut.includes("1800"), false, "un coût de revient n'a pas à traverser cette fonction");
  assert.equal(brut.includes("négocier"), false);
  assert.equal(p.marge, undefined);
  assert.equal(p.modalitesLabel, MODALITES.presentiel);
  assert.equal(p.resultats.lignes.find((l) => l.cle === "obtention").valeur, 88);
});

test("l'état du catalogue dit ce qui est publié à tort", () => {
  const e = etatCatalogue([
    offre({ id: "bon", publiee: true }),
    offre({ id: "mauvais", publiee: true, objectifs: "" }),
    offre({ id: "brouillon", objectifs: "" }),
  ]);
  assert.equal(e.total, 3);
  assert.equal(e.publiees, 2);
  assert.equal(e.conforme, false);
  assert.equal(e.invalides.length, 1);
  assert.equal(e.invalides[0].id, "mauvais");
  assert.match(e.reserve, /engage l'organisme/);
});

test("chaque mention publiable cite sa base", () => {
  for (const m of MENTIONS_PUBLIABLES) {
    assert.ok(m.cle && m.label, JSON.stringify(m));
    assert.match(m.base, /^indicateur \d+$/);
  }
});

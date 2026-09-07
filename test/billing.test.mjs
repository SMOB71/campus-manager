import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmbill-"));
process.env.DATA_KEY = "test-key-billing";
const store = await import("../lib/store.js");
const { daysBetween, prorataTemporis, buildSchedule, amountDue, computeTotals, balance, compareWithLegacy, FUNDING_MODES } = await import("../lib/billing.js");

// ---------- Prorata temporis ----------

test("daysBetween : bornes incluses (un contrat d'un jour dure un jour)", () => {
  assert.equal(daysBetween("2026-09-01", "2026-09-01"), 1);
  assert.equal(daysBetween("2026-09-01", "2026-09-30"), 30);
  assert.equal(daysBetween("2026-09-01", "2027-08-31"), 365);
  assert.equal(daysBetween("", "2026-09-01"), null);
});

test("prorata temporis : NPEC au nombre de jours réellement exécutés", () => {
  // Contrat d'un an à 8 000 €, rompu à mi-parcours
  const p = prorataTemporis({ montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31", arret: "2027-02-28" });
  assert.equal(p.joursTotal, 365);
  assert.equal(p.joursExecutes, 181);
  assert.equal(p.montantDu, 3967.12); // 8000 × 181/365
  assert.equal(p.montantInitial, 8000);
  // Sans arrêt, la totalité est due
  assert.equal(prorataTemporis({ montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31" }).montantDu, 8000);
  // Un arrêt postérieur au terme ne majore rien
  assert.equal(prorataTemporis({ montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31", arret: "2028-01-01" }).montantDu, 8000);
  // Arrêt le jour même du début : un jour dû, pas zéro
  assert.equal(prorataTemporis({ montant: 365, dateDebut: "2026-09-01", dateFin: "2027-08-31", arret: "2026-09-01" }).joursExecutes, 1);
});

test("échéancier : la somme des échéances égale EXACTEMENT le montant convenu", () => {
  // L'arrondi au centime dérive sur 12 échéances : la dernière absorbe l'écart,
  // sinon on facture 8 000,04 € pour une prise en charge de 8 000 €.
  const ech = buildSchedule({ montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31" });
  assert.equal(ech.length, 12);
  const somme = Math.round(ech.reduce((s, e) => s + e.montant, 0) * 100) / 100;
  assert.equal(somme, 8000);
  // Chaque échéance vaut sa part de JOURS : février est moins cher que mars
  const fev = ech.find((e) => e.debut.startsWith("2027-02"));
  const mars = ech.find((e) => e.debut.startsWith("2027-03"));
  assert.ok(fev.montant < mars.montant, "un mois court doit coûter moins qu'un mois long");
  // Cadence trimestrielle
  const trim = buildSchedule({ montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31", cadence: "trimestrielle" });
  assert.equal(trim.length, 4);
  assert.equal(Math.round(trim.reduce((s, e) => s + e.montant, 0) * 100) / 100, 8000);
});

// ---------- La distinction qui commande tout ----------

test("alternance vs conventionné : l'assiduité n'entre PAS dans le NPEC", () => {
  const echeance = { debut: "2026-09-01", fin: "2026-09-30", montant: 660 };
  // NPEC : un apprenti absent tout le mois donne le MÊME montant. Le NPEC se
  // verse au prorata des jours de CONTRAT, pas des heures suivies.
  const npec = amountDue({ mode: "npec", echeance, minutesRealisees: 0 });
  const npecPresent = amountDue({ mode: "npec", echeance, minutesRealisees: 9000 });
  assert.equal(npec.montant, 660);
  assert.equal(npec.montant, npecPresent.montant);
  assert.equal(FUNDING_MODES.npec.assiduiteImpacte, false);

  // Conventionné : là, seules les heures réalisées se facturent.
  const heures = amountDue({ mode: "heures", echeance, prixHoraire: 15, minutesRealisees: 1200 });
  assert.equal(heures.heures, 20);
  assert.equal(heures.montant, 300);
  assert.equal(amountDue({ mode: "heures", echeance, prixHoraire: 15, minutesRealisees: 0 }).montant, 0);
  assert.equal(FUNDING_MODES.heures.assiduiteImpacte, true);

  // Forfait : ni la durée ni l'assiduité
  assert.equal(amountDue({ mode: "forfait", echeance, minutesRealisees: 0 }).montant, 660);
});

test("NPEC : une rupture en cours de période ne fait payer que les jours exécutés", () => {
  const echeance = { debut: "2026-09-01", fin: "2026-09-30", montant: 600 };
  const du = amountDue({ mode: "npec", echeance, arret: "2026-09-10" });
  assert.equal(du.jours, 10);
  assert.equal(du.joursPeriode, 30);
  assert.equal(du.montant, 200);
});

// ---------- TVA, solde, comparateur ----------

test("TVA : exonération de formation professionnelle par défaut, mention portée", () => {
  const ex = computeTotals([{ montant: 1000 }, { montant: 500 }]);
  assert.equal(ex.totalHT, 1500);
  assert.equal(ex.totalTVA, 0);
  assert.equal(ex.totalTTC, 1500);
  assert.match(ex.mentionExoneration, /261-4-4/);
  // Organisme non exonéré
  const avec = computeTotals([{ montant: 1000 }], { exonereTva: false });
  assert.equal(avec.totalTVA, 200);
  assert.equal(avec.totalTTC, 1200);
  assert.equal(avec.mentionExoneration, null);
});

test("solde : une facture annulée ne compte plus, un avoir se déduit", () => {
  const b = balance({
    montantDu: 8000,
    factures: [{ totalTTC: 3000, status: "emise" }, { totalTTC: 2000, status: "annulee" }, { totalTTC: -2000, status: "emise" }],
    reglements: [{ montant: 1000 }],
  });
  assert.equal(b.facture, 1000);        // 3000 − 2000 (avoir), l'annulée exclue
  assert.equal(b.encaisse, 1000);
  assert.equal(b.resteAFacturer, 7000);
  assert.equal(b.resteAEncaisser, 0);
});

test("comparateur de bascule : un seul écart suffit à la refuser", () => {
  const nôtres = [{ periode: "2026-09", montant: 660 }, { periode: "2026-10", montant: 680 }];
  // Identique : bascule autorisée
  const ok = compareWithLegacy(nôtres, [{ periode: "2026-09", montant: 660 }, { periode: "2026-10", montant: 680 }]);
  assert.equal(ok.ecarts, 0);
  assert.equal(ok.basculeAutorisee, true);

  // Écart de montant : refusée
  const ecart = compareWithLegacy(nôtres, [{ periode: "2026-09", montant: 660 }, { periode: "2026-10", montant: 700 }]);
  assert.equal(ecart.ecarts, 1);
  assert.equal(ecart.basculeAutorisee, false);
  assert.equal(ecart.lignes.find((l) => l.periode === "2026-10").ecart, -20);

  // Le sens le plus dangereux : le système sortant facture une période que nous
  // ne facturons pas — c'est une recette qu'on perdrait à la bascule.
  const manque = compareWithLegacy(nôtres, [...nôtres, { periode: "2026-11", montant: 700 }]);
  const ligne = manque.lignes.find((l) => l.periode === "2026-11");
  assert.equal(ligne.calcule, null);
  assert.match(ligne.motif, /non facturé/);
  assert.equal(manque.basculeAutorisee, false);

  // Aucune donnée : on n'autorise pas une bascule sur du vide
  assert.equal(compareWithLegacy([], []).basculeAutorisee, false);
});

// ---------- Store : immutabilité des pièces ----------

test("facture émise : immuable, corrigée par un avoir, numérotation sans trou", () => {
  const campus = store.addCampus({ name: "Campus Facturation" });
  const f = store.addFunding({ campusId: campus.id, financeur: "OPCO Test", mode: "npec", montant: 8000, dateDebut: "2026-09-01", dateFin: "2027-08-31" });

  const i1 = store.addInvoice({ campusId: campus.id, fundingId: f.id, date: "2026-10-01", lignes: [{ montant: 660 }], totalTTC: 660 });
  assert.equal(i1.status, "brouillon");
  assert.equal(i1.numero, "");

  const emise = store.issueInvoice(i1.id, "compta");
  assert.equal(emise.status, "emise");
  assert.match(emise.numero, /^FA2026-00001$/);
  assert.ok(emise.emiseAt);
  // Une facture émise ne se ré-émet pas
  assert.ok(store.issueInvoice(i1.id, "compta").error);

  // Numérotation continue
  const i2 = store.addInvoice({ campusId: campus.id, fundingId: f.id, date: "2026-11-01", lignes: [{ montant: 660 }], totalTTC: 660 });
  assert.equal(store.issueInvoice(i2.id, "compta").numero, "FA2026-00002");

  // Correction : avoir obligatoirement motivé, la facture d'origine est annulée
  assert.ok(store.creditInvoice(i1.id, { motif: "" }).error, "un avoir sans motif est refusé");
  const avoir = store.creditInvoice(i1.id, { motif: "erreur de période", by: "compta" });
  assert.equal(avoir.avoirDe, i1.id);
  assert.equal(avoir.totalTTC, -660);
  assert.equal(store.getInvoice(i1.id).status, "annulee");
  // La facture annulée GARDE son numéro : la séquence ne doit pas avoir de trou
  assert.equal(store.getInvoice(i1.id).numero, "FA2026-00001");
  // Un second avoir sur la même facture est refusé
  assert.ok(store.creditInvoice(i1.id, { motif: "encore" }).error);
  // L'avoir a sa propre séquence, elle aussi continue
  assert.equal(store.issueInvoice(avoir.id, "compta").numero, "AV2026-00001");
  // La numérotation lit le plus grand numéro attribué : supprimer une pièce ne
  // fait jamais réattribuer un numéro déjà utilisé.
  assert.equal(store.nextInvoiceSeq(campus.id, 2026, "FA"), 3);
});

test("avoir : possible sur une facture PAYÉE, refusé sur un brouillon", () => {
  const campus = store.addCampus({ name: "Campus Avoir" });
  const inv = store.addInvoice({ campusId: campus.id, date: "2026-10-01", lignes: [{ montant: 500 }], totalTTC: 500 });
  // Un brouillon se corrige directement, il n'a pas à être contrepassé
  assert.ok(store.creditInvoice(inv.id, { motif: "x" }).error);
  store.issueInvoice(inv.id, "compta");
  store.addPayment({ invoiceId: inv.id, montant: 500 });
  assert.equal(store.getInvoice(inv.id).status, "payee");
  // Cas le plus courant : l'erreur se découvre APRÈS l'encaissement
  const avoir = store.creditInvoice(inv.id, { motif: "double facturation", by: "compta" });
  assert.equal(avoir.totalTTC, -500);
  assert.equal(store.getInvoice(inv.id).status, "annulee");
});

test("règlement : impossible sur un brouillon, solde la facture au cumul", () => {
  const campus = store.addCampus({ name: "Campus Règlement" });
  const inv = store.addInvoice({ campusId: campus.id, date: "2026-10-01", lignes: [{ montant: 1000 }], totalTTC: 1000 });
  assert.ok(store.addPayment({ invoiceId: inv.id, montant: 500 }).error, "un brouillon ne se règle pas");
  store.issueInvoice(inv.id, "compta");
  store.addPayment({ invoiceId: inv.id, montant: 400 });
  assert.equal(store.getInvoice(inv.id).status, "emise", "un règlement partiel ne solde pas");
  store.addPayment({ invoiceId: inv.id, montant: 600 });
  assert.equal(store.getInvoice(inv.id).status, "payee");
});

test("dossier de financement : non supprimable s'il porte des factures émises", () => {
  const campus = store.addCampus({ name: "Campus Suppr" });
  const f = store.addFunding({ campusId: campus.id, mode: "npec", montant: 1000, dateDebut: "2026-09-01", dateFin: "2027-08-31" });
  const inv = store.addInvoice({ campusId: campus.id, fundingId: f.id, lignes: [{ montant: 100 }], totalTTC: 100 });
  // Un brouillon n'empêche pas la suppression
  assert.ok(store.deleteFunding(f.id).ok);

  const f2 = store.addFunding({ campusId: campus.id, mode: "npec", montant: 1000, dateDebut: "2026-09-01", dateFin: "2027-08-31" });
  const i2 = store.addInvoice({ campusId: campus.id, fundingId: f2.id, lignes: [{ montant: 100 }], totalTTC: 100 });
  store.issueInvoice(i2.id, "compta");
  assert.ok(store.deleteFunding(f2.id).error, "une pièce comptable doit rester rattachable à son origine");
  void inv;
});

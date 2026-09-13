import test from "node:test";
import assert from "node:assert/strict";
import {
  ecrituresFacture, ecrituresReglement, assembler, controler, toFec,
  nomFichier, construire, CHAMPS_FEC, PLAN_DEFAUT,
} from "../lib/comptabilite.js";

const facture = (o = {}) => ({ id: "f1", numero: "FA2026-00001", date: "2026-03-15", status: "emise",
  totalHT: 1000, totalTVA: 0, totalTTC: 1000, fundingId: "fd1", ...o });

test("les 18 champs, dans l'ordre imposé — toute inversion rend le fichier non conforme", () => {
  assert.equal(CHAMPS_FEC.length, 18);
  assert.deepEqual(CHAMPS_FEC.slice(0, 4), ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate"]);
  assert.deepEqual(CHAMPS_FEC.slice(11, 13), ["Debit", "Credit"]);
  assert.equal(CHAMPS_FEC.at(-1), "Idevise");
});

test("facture émise : le client doit, l'organisme a produit", () => {
  const l = ecrituresFacture(facture(), { tiers: { code: "C001", nom: "OPCO Test" } });
  assert.equal(l.length, 2, "sans TVA, deux lignes suffisent");
  const client = l.find((x) => x.compte === PLAN_DEFAUT.client);
  const produit = l.find((x) => x.compte === PLAN_DEFAUT.produits);
  assert.equal(client.debit, 1000);
  assert.equal(client.credit, 0);
  assert.equal(produit.credit, 1000);
  assert.equal(client.auxNum, "C001", "le compte auxiliaire identifie le tiers");
  // Le compte de produit n'a pas de tiers : c'est un compte général.
  assert.equal(produit.auxNum, "");
});

test("UNE FACTURE BROUILLON N'EST PAS UN FAIT COMPTABLE", () => {
  // La comptabiliser, c'est déclarer un produit qui n'existe pas.
  assert.deepEqual(ecrituresFacture(facture({ status: "brouillon" })), []);
  assert.deepEqual(ecrituresFacture(facture({ status: "annulee" })), []);
  assert.deepEqual(ecrituresFacture(null), []);
  // Une facture payée, elle, reste un fait comptable.
  assert.equal(ecrituresFacture(facture({ status: "payee" })).length, 2);
});

test("UN AVOIR EST UNE ÉCRITURE INVERSE, PAS UNE FACTURE NÉGATIVE", () => {
  // C'est le piège classique : écrire −1 200 au débit produit un fichier rejeté.
  // Le sens se porte par la COLONNE, le montant reste positif.
  const l = ecrituresFacture(facture({ numero: "AV2026-00001", totalHT: -1200, totalTTC: -1200 }));
  const client = l.find((x) => x.compte === PLAN_DEFAUT.client);
  const produit = l.find((x) => x.compte === PLAN_DEFAUT.produits);
  assert.equal(client.credit, 1200, "l'avoir crédite le client");
  assert.equal(client.debit, 0);
  assert.equal(produit.debit, 1200, "et débite le produit");
  assert.ok(l.every((x) => x.debit >= 0 && x.credit >= 0), "aucun montant négatif");
  assert.match(l[0].libelle, /^Avoir/);
});

test("TVA : absente quand l'organisme est exonéré, présente sinon", () => {
  // La formation professionnelle continue est exonérée (art. 261-4-4° a du CGI).
  assert.equal(ecrituresFacture(facture()).length, 2);
  const avecTva = ecrituresFacture(facture({ totalHT: 1000, totalTVA: 200, totalTTC: 1200 }));
  assert.equal(avecTva.length, 3);
  const tva = avecTva.find((x) => x.compte === PLAN_DEFAUT.tva);
  assert.equal(tva.credit, 200);
  // Et l'écriture reste équilibrée : 1200 au débit, 1000 + 200 au crédit.
  assert.equal(avecTva.reduce((s, x) => s + x.debit, 0), avecTva.reduce((s, x) => s + x.credit, 0));
});

test("règlement : la banque encaisse, la créance s'éteint — et un remboursement inverse", () => {
  const l = ecrituresReglement({ id: "p1", date: "2026-04-01", montant: 1000 }, facture(), {});
  assert.equal(l.find((x) => x.compte === PLAN_DEFAUT.banque).debit, 1000);
  assert.equal(l.find((x) => x.compte === PLAN_DEFAUT.client).credit, 1000);

  const remb = ecrituresReglement({ id: "p2", date: "2026-05-01", montant: -300 }, facture(), {});
  assert.equal(remb.find((x) => x.compte === PLAN_DEFAUT.banque).credit, 300);
  assert.ok(remb.every((x) => x.debit >= 0 && x.credit >= 0));
});

test("numérotation : chronologique, continue, et PAR JOURNAL", () => {
  const lignes = [
    ...ecrituresFacture(facture({ id: "a", numero: "FA-2", date: "2026-03-20" })),
    ...ecrituresFacture(facture({ id: "b", numero: "FA-1", date: "2026-03-10" })),
    ...ecrituresReglement({ id: "p", date: "2026-03-15", montant: 500 }, facture({ numero: "FA-1" }), {}),
  ];
  const e = assembler(lignes, { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  const ventes = [...new Set(e.filter((x) => x.journal === "VT").map((x) => x.numero))];
  assert.deepEqual(ventes, ["VT000001", "VT000002"], "la plus ancienne facture porte le n° 1");
  assert.equal(e.find((x) => x.piece === "FA-1" && x.journal === "VT").numero, "VT000001");
  // Le journal de banque a sa propre séquence.
  assert.deepEqual([...new Set(e.filter((x) => x.journal === "BQ").map((x) => x.numero))], ["BQ000001"]);
});

test("l'exercice borne le fichier : ce qui est hors période n'y entre pas", () => {
  const lignes = [
    ...ecrituresFacture(facture({ date: "2025-12-31", numero: "FA-ancienne" })),
    ...ecrituresFacture(facture({ date: "2026-06-01", numero: "FA-dans" })),
    ...ecrituresFacture(facture({ date: "2027-01-02", numero: "FA-apres" })),
  ];
  const e = assembler(lignes, { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  assert.deepEqual([...new Set(e.map((x) => x.piece))], ["FA-dans"]);
});

test("ÉQUILIBRE : un fichier déséquilibré est REFUSÉ, pas signalé", () => {
  const bon = assembler(ecrituresFacture(facture()), { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  const c = controler(bon);
  assert.equal(c.equilibre, true);
  assert.equal(c.remettable, true);
  assert.deepEqual(c.anomalies, []);

  // On casse l'équilibre à la main : le contrôle doit bloquer.
  const casse = bon.map((l, i) => (i === 0 ? { ...l, debit: l.debit + 10 } : l));
  const k = controler(casse);
  assert.equal(k.remettable, false);
  assert.ok(k.anomalies.some((a) => /déséquilibré/.test(a.message)));
  assert.ok(k.anomalies.every((a) => a.gravite === "bloquant"));
});

test("une ligne ne peut pas être au débit ET au crédit, ni porter un négatif", () => {
  const base = assembler(ecrituresFacture(facture()), { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  assert.ok(controler(base.map((l, i) => (i === 0 ? { ...l, credit: 5 } : l))).anomalies.some((a) => /à la fois au débit et au crédit/.test(a.message)));
  assert.ok(controler(base.map((l, i) => (i === 0 ? { ...l, debit: -1, credit: 0 } : l))).anomalies.some((a) => /Montant négatif/.test(a.message)));
});

test("un fichier vide n'est pas remettable — c'est un fichier vide, pas une conformité", () => {
  const c = controler([]);
  assert.equal(c.remettable, false);
  assert.equal(c.lignes, 0);
});

test("sérialisation : en-tête, tabulations, dates AAAAMMJJ, montants positifs", () => {
  const e = assembler(ecrituresFacture(facture(), { tiers: { code: "C1", nom: "OPCO" } }),
    { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31", dateValidation: "2026-12-31" });
  const fec = toFec(e);
  // On ne « trim » PAS le fichier : les derniers champs sont vides (lettrage,
  // devise) et un trim les effacerait. Dans un FEC, un champ vide reste un champ
  // — c'est le séparateur qui compte, et sa disparition rend le fichier non
  // conforme. C'est exactement ce que mon premier test faisait par erreur.
  const lignes = fec.split("\r\n").filter((l, i, a) => l !== "" || i < a.length - 1);
  assert.equal(lignes[0], CHAMPS_FEC.join("\t"), "la première ligne porte les noms de champs");
  assert.equal(lignes.length, 3, "un en-tête et deux lignes");
  const cols = lignes[1].split("\t");
  assert.equal(cols.length, 18, "un champ vide reste présent : c'est le séparateur qui compte");
  assert.equal(cols[3], "20260315", "date au format AAAAMMJJ");
  assert.equal(cols[11], "1000,00", "séparateur décimal français par défaut");
  assert.equal(cols[15], "20261231", "date de validation");
  // Le point décimal reste possible quand l'outil du cabinet l'exige.
  assert.match(toFec(e, { sepDecimal: "." }).split("\r\n")[1].split("\t")[11], /^1000\.00$/);
});

test("aucune tabulation parasite ne peut casser une colonne", () => {
  // Un libellé contenant une tabulation décalerait toutes les colonnes suivantes.
  const e = assembler(ecrituresFacture(facture(), { tiers: { code: "C1", nom: "OPCO\tSud" } }),
    { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  const lignes = toFec(e).split("\r\n").filter((l, i, a) => l !== "" || i < a.length - 1);
  for (const l of lignes) assert.equal(l.split("\t").length, 18, `ligne à ${l.split("\t").length} colonnes : ${l.slice(0, 80)}`);
});

test("nom du fichier : SIREN + FEC + date de clôture", () => {
  assert.equal(nomFichier("73282932000074", "2026-12-31"), "732829320FEC20261231.txt");
  assert.equal(nomFichier(null, "2026-12-31"), "000000000FEC20261231.txt");
});

test("construction complète : factures et règlements, contrôlés d'un bloc", () => {
  const invoices = [facture(), facture({ id: "f2", numero: "FA2026-00002", date: "2026-04-10", totalHT: 500, totalTTC: 500 })];
  const payments = [{ id: "p1", invoiceId: "f1", date: "2026-04-20", montant: 1000 }];
  const r = construire({ invoices, payments, exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31",
    tiersParId: new Map([["fd1", { code: "C1", nom: "OPCO" }]]) });
  assert.equal(r.controle.equilibre, true);
  assert.equal(r.controle.remettable, true);
  assert.equal(r.controle.ecritures, 3, "deux ventes et un règlement");
  assert.equal(r.controle.totalDebit, 2500);
});

test("les champs vides de fin restent des champs — un trim rendrait le fichier non conforme", () => {
  // Les quatre derniers champs (lettrage, date de lettrage, devise) sont
  // normalement vides. Ils doivent néanmoins figurer : c'est le séparateur qui
  // porte l'information de position. Un outil qui « nettoie » les fins de ligne
  // casse le fichier sans rien afficher d'anormal.
  const e = assembler(ecrituresFacture(facture()), { exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31" });
  const fec = toFec(e);
  const derniereLigne = fec.split("\r\n").filter((l) => l !== "").at(-1);
  assert.equal(derniereLigne.split("\t").length, 18);
  assert.ok(derniereLigne.endsWith("\t\t"), "les derniers champs vides sont bien présents");
  // Et la preuve par l'absurde : un trim les détruit.
  assert.notEqual(fec.trim().split("\r\n").at(-1).split("\t").length, 18);
});

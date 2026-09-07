import test from "node:test";
import assert from "node:assert/strict";
import { buildSifa, buildBpf, toCsv, isInSifaScope, sifaObservationDate, SIFA_COLUMNS } from "../lib/declarations.js";

// ---------- SIFA ----------

test("périmètre SIFA : présence au 31 décembre, stagiaire post-rupture inclus", () => {
  const date = sifaObservationDate(2026);
  assert.equal(date, "2026-12-31");
  const dans = (e) => isInSifaScope({ enrollment: e, dateObservation: date });
  assert.equal(dans({ statut: "inscrit", dateDebut: "2026-09-01" }), true);
  // Entré après l'observation : hors périmètre
  assert.equal(dans({ statut: "inscrit", dateDebut: "2027-01-05" }), false);
  // Sorti avant : hors périmètre
  assert.equal(dans({ statut: "sorti", dateDebut: "2026-09-01", dateSortie: "2026-11-30" }), false);
  // Contrat rompu MAIS maintenu en formation : il est bien au CFA au 31 décembre,
  // donc il compte. L'oublier sous-déclare les effectifs.
  assert.equal(dans({ statut: "stagiaire", dateDebut: "2026-09-01" }), true);
  assert.equal(dans(null), false);
});

const CTX = {
  annee: 2026,
  learners: [
    { id: "l1", nom: "Dupont", prenom: "Léa", ine: "1234ABCDE", sexe: "F", dateNaissance: "2006-05-10", diplomeLePlusEleve: "Bac pro" },
    { id: "l2", nom: "Martin", prenom: "Sami", ine: "", sexe: "M", dateNaissance: "2005-02-02" }, // INE manquant
  ],
  enrollments: [
    { learnerId: "l1", statut: "inscrit", dateDebut: "2026-09-01", classId: "k1" },
    { learnerId: "l2", statut: "inscrit", dateDebut: "2026-09-01", classId: "k1" },
  ],
  contracts: [{ learnerId: "l1", companyId: "co1", dateDebut: "2026-09-01", dateFin: "2028-08-31" }],
  classes: [{ id: "k1", name: "BTS OL 1", curriculumId: "c1", year: 1 }],
  curricula: [{ id: "c1", name: "BTS Opticien-Lunetier", diploma: "BTS OL", codeRncp: "RNCP35338", dureeHeures: 1350 }],
  companies: [{ id: "co1", name: "Optique Martin", siret: "73282932000074" }],
};

test("SIFA : une ligne par apprenti, données jointes, INE manquant bloque le dépôt", () => {
  const d = buildSifa(CTX);
  assert.equal(d.total, 2);
  const lea = d.lignes.find((x) => x.learnerId === "l1");
  assert.equal(lea.diplomePrepare, "BTS OL");
  assert.equal(lea.codeRncp, "RNCP35338");
  assert.equal(lea.siretEmployeur, "73282932000074");
  assert.equal(lea.dureeFormation, 1350);

  // L'INE est la clé du fichier : sans lui la ligne est rejetée par la plateforme.
  assert.equal(d.anomalies.length, 1);
  assert.equal(d.anomalies[0].apprenant, "Sami Martin");
  assert.ok(d.anomalies[0].manquants.includes("INE"));
  assert.equal(d.deposable, false, "un fichier incomplet ne doit pas être présenté comme déposable");

  // Une fois l'INE saisi, le fichier devient déposable
  const corrige = buildSifa({ ...CTX, learners: CTX.learners.map((l) => (l.id === "l2" ? { ...l, ine: "9999ZZZZZ" } : l)) });
  assert.equal(corrige.anomalies.length, 0);
  assert.equal(corrige.deposable, true);
});

test("SIFA : aucun apprenant en périmètre → non déposable (et non « conforme »)", () => {
  const vide = buildSifa({ ...CTX, enrollments: [] });
  assert.equal(vide.total, 0);
  assert.equal(vide.deposable, false, "un fichier vide n'est pas un fichier valide");
});

test("CSV : séparateur français, échappement, BOM UTF-8", () => {
  const csv = toCsv(
    [{ key: "nom", label: "Nom" }, { key: "note", label: "Note" }],
    [{ nom: 'Dupont; "Léa"', note: "ok" }],
  );
  assert.ok(csv.startsWith("﻿"), "le BOM évite les accents cassés dans un tableur français");
  assert.match(csv, /Nom;Note/);
  // Un nom contenant le séparateur ou un guillemet ne doit pas casser le fichier
  assert.match(csv, /"Dupont; ""Léa"""/);
  assert.ok(csv.endsWith("\r\n"));
});

// ---------- BPF ----------

test("BPF : produits ventilés par financeur, avoirs déduits, brouillons exclus", () => {
  const fundings = [
    { id: "f1", typeFinanceur: "opco" },
    { id: "f2", typeFinanceur: "entreprise" },
    { id: "f3", typeFinanceur: "particulier" },
  ];
  const invoices = [
    { fundingId: "f1", status: "emise", date: "2026-03-01", totalHT: 5000 },
    { fundingId: "f1", status: "emise", date: "2026-04-01", totalHT: -1000 }, // avoir
    { fundingId: "f2", status: "payee", date: "2026-05-01", totalHT: 2000 },
    { fundingId: "f3", status: "emise", date: "2026-06-01", totalHT: 800 },
    { fundingId: "f1", status: "brouillon", date: "2026-07-01", totalHT: 9999 },  // exclu
    { fundingId: "f1", status: "annulee", date: "2026-07-01", totalHT: 9999 },    // exclu
    { fundingId: "f1", status: "emise", date: "2025-12-01", totalHT: 7777 },      // hors exercice
  ];
  const d = buildBpf({ exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31", invoices, fundings,
    sheets: [{ date: "2026-03-01", durationMinutes: 180, presents: 10 }, { date: "2026-03-02", durationMinutes: 120, presents: 5 }],
    stagiaires: 12, campus: { name: "OF", siret: "1", numeroDeclaration: "11 75", dirigeant: "M. X" } });

  assert.equal(d.cadreC.produits.opco, 4000);       // 5000 − 1000
  assert.equal(d.cadreC.produits.entreprises, 2000);
  assert.equal(d.cadreC.produits.particuliers, 800);
  assert.equal(d.cadreC.total, 6800);
  // Heures-stagiaires : durée × présents
  assert.equal(d.cadreB.heuresStagiaires, 40);      // 3 h × 10 + 2 h × 5
  assert.equal(d.cadreB.stagiaires, 12);
  assert.equal(d.deposable, true);
});

test("BPF : mentions manquantes signalées, jamais de déclaration silencieusement fausse", () => {
  const d = buildBpf({ exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31", invoices: [], fundings: [], sheets: [], campus: { name: "OF" } });
  assert.equal(d.deposable, false);
  assert.ok(d.manquantes.some((m) => /déclaration d'activité/.test(m)));
  assert.ok(d.manquantes.some((m) => /SIRET/.test(m)));
  assert.ok(d.manquantes.some((m) => /représentant légal/.test(m)));
  assert.ok(d.manquantes.some((m) => /émargement/.test(m)), "sans feuille close, les heures ne sont pas justifiables");
  assert.equal(d.cadreC.total, 0);
});

test("BPF : l'exercice comptable n'est pas l'année scolaire", () => {
  const invoices = [
    { fundingId: "f1", status: "emise", date: "2026-09-15", totalHT: 1000 },
    { fundingId: "f1", status: "emise", date: "2027-01-15", totalHT: 500 },
  ];
  const fundings = [{ id: "f1", typeFinanceur: "opco" }];
  // Exercice civil 2026 : seule la facture de septembre entre
  const civil = buildBpf({ exerciceDebut: "2026-01-01", exerciceFin: "2026-12-31", invoices, fundings, sheets: [] });
  assert.equal(civil.cadreC.total, 1000);
  // Exercice décalé septembre → août : les deux entrent
  const decale = buildBpf({ exerciceDebut: "2026-09-01", exerciceFin: "2027-08-31", invoices, fundings, sheets: [] });
  assert.equal(decale.cadreC.total, 1500);
});


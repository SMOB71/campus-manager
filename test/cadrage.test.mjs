// Alimenter un projet depuis une note de cadrage.
//
// Ce que ces tests protègent : qu'on lise ce que la note dit, qu'on n'invente
// rien de ce qu'elle ne dit pas, et qu'on ne remplace jamais en silence ce que
// le projet a appris depuis.
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyser, fusionner, tachesDepuisProposition,
  dateDe, dureeDe, montantDe, impactDe, detailsDePuce, ATTENDUES,
} from "../lib/cadrage.js";

// Une note telle qu'une direction en écrit une : titres, puces, étiquettes.
const NOTE = `# Note de cadrage — Refonte du système de scolarité

Commanditaire : Direction générale
Sponsor : Mme Ribeiro, directrice des opérations
Pilote : Claire Meunier
Budget : 1,2 M€

## 1. Contexte
Le système actuel date de 2014 et n'est plus maintenu par l'éditeur.
Trois campus saisissent déjà les notes en dehors de l'outil.

## 2. Objectif
Disposer d'un système unique de gestion de la scolarité pour les huit campus
avant la rentrée 2027.

## 3. Périmètre
Inscriptions, notes et bulletins, émargement, éditions réglementaires.

## 4. Hors périmètre
La paie des intervenants et la comptabilité générale restent sur l'outil actuel.

## 5. Chantiers

### Cadrage et choix
- Recenser l'existant — resp. Marc Ollivier — 3 semaines
- Comparer trois solutions — durée : 15 j — échéance : 2027-01-30

### Migration
- Reprise des données — resp. Prestataire — 2 mois
- Former les équipes — 5 j

## 6. Jalons
- Décision en comité — 2026-12-15
- Bascule en production — 30/06/2027
- Bilan à froid — fin du premier trimestre suivant

## 7. Risques
- Les données de 2014 sont inexploitables en l'état — impact : élevé — resp. Marc — le plan B est de repartir des seules cinq dernières années
- Indisponibilité du prestataire au moment de la bascule — impact moyen

## 8. Indicateurs
- Taux de bulletins édités dans l'outil — 100 %
- Délai moyen d'inscription — < 3 jours

## 9. Gouvernance
- Comité de pilotage — hebdomadaire — DG, DO, pilote, prestataire
- Comité technique — mensuel — équipe SI
`;

// ---------------------------------------------------------------------------
test("VALEURS TYPÉES — une date ne vaut que si elle est écrite", () => {
  assert.equal(dateDe("2026-06-30"), "2026-06-30");
  assert.equal(dateDe("livraison le 30/06/2027"), "2027-06-30");
  assert.equal(dateDe("le 1er septembre 2026"), "2026-09-01");
  // Ce qui n'est pas une date reste sans date. Inventer un 31 mars fabriquerait
  // un engagement que personne n'a pris.
  assert.equal(dateDe("fin du premier trimestre"), null);
  assert.equal(dateDe("dès que possible"), null);

  assert.deepEqual(dureeDe("3 semaines"), { jours: 15, source: "3 semaines" });
  assert.deepEqual(dureeDe("2 mois"), { jours: 40, source: "2 mois" });
  assert.deepEqual(dureeDe("durée : 15 j"), { jours: 15, source: "15 j" });
  assert.equal(dureeDe("quelques jours"), null);

  assert.equal(montantDe("1,2 M€"), 1200000);
  assert.equal(montantDe("350 k€"), 350000);
  assert.equal(montantDe("12 500 €"), 12500);
  assert.equal(montantDe("à chiffrer"), null);
  assert.equal(impactDe("impact : élevé"), "eleve");
  assert.equal(impactDe("risque mineur"), "faible");
});

test("PUCE — les précisions étiquetées sont lues, le reste est conservé", () => {
  const d = detailsDePuce("Reprise des données — resp. Marc — 15 j — échéance : 2027-01-30");
  assert.equal(d.titre, "Reprise des données");
  assert.equal(d.responsable, "Marc");
  assert.equal(d.duree.jours, 15);
  assert.equal(d.echeance, "2027-01-30");
});

// ---------------------------------------------------------------------------
test("NOTE DE CADRAGE — on lit ce qui est écrit", () => {
  const p = analyser(NOTE);
  assert.equal(p.champs.nom, "Refonte du système de scolarité");
  assert.equal(p.champs.commanditaire, "Direction générale");
  assert.match(p.champs.sponsor, /Ribeiro/);
  assert.equal(p.champs.pilote, "Claire Meunier");
  assert.equal(p.champs.budget, 1200000);
  assert.match(p.champs.contexte, /n'est plus maintenu/);
  assert.match(p.champs.objectif, /huit campus/);
  assert.match(p.champs.perimetre, /émargement/);
  assert.match(p.champs.horsPerimetre, /comptabilité générale/);
  // Le hors-périmètre ne doit pas atterrir dans le périmètre.
  assert.ok(!p.champs.perimetre.includes("comptabilité générale"));
});

test("CHANTIERS ET ACTIONS — chaque action sait d'où elle vient et combien elle dure", () => {
  const p = analyser(NOTE);
  assert.deepEqual(p.chantiers, ["Cadrage et choix", "Migration"]);
  const a = p.actions.find((x) => x.titre === "Recenser l'existant");
  assert.equal(a.chantier, "Cadrage et choix");
  assert.equal(a.responsable, "Marc Ollivier");
  assert.equal(a.dureeJours, 15);
  assert.equal(a.dureeSource, "3 semaines");   // la conversion est dite, pas cachée
  const b = p.actions.find((x) => x.titre === "Comparer trois solutions");
  assert.equal(b.echeance, "2027-01-30");
  const c = p.actions.find((x) => x.titre === "Former les équipes");
  assert.equal(c.chantier, "Migration");
  assert.equal(c.dureeJours, 5);
});

test("JALONS — ceux qui n'ont pas de date sont SIGNALÉS, pas datés d'office", () => {
  const p = analyser(NOTE);
  assert.equal(p.jalons.find((j) => /Décision/.test(j.titre)).date, "2026-12-15");
  assert.equal(p.jalons.find((j) => /Bascule/.test(j.titre)).date, "2027-06-30");
  const flou = p.jalons.find((j) => /Bilan/.test(j.titre));
  assert.equal(flou.date, null);
  assert.ok(p.datesNonLues.includes("Bilan à froid"));
});

test("REGISTRES — risques, indicateurs et instances sortent utilisables", () => {
  const p = analyser(NOTE);
  const r = p.registres.risques[0];
  assert.match(r.titre, /inexploitables/);
  assert.equal(r.impact, "eleve");
  assert.equal(r.proprietaire, "Marc");
  assert.match(r.planB, /cinq dernières années/);
  assert.equal(p.registres.risques[1].impact, "moyen");

  assert.equal(p.registres.kpis[0].cible, "100 %");
  assert.match(p.registres.kpis[1].indicateur, /Délai moyen/);

  assert.equal(p.registres.instances[0].nom, "Comité de pilotage");
  assert.equal(p.registres.instances[0].frequence, "hebdomadaire");
  assert.match(p.registres.instances[0].composition, /prestataire/);
});

test("CE QUE LA NOTE NE DIT PAS EST DIT — avant de produire les documents", () => {
  const p = analyser(NOTE);
  assert.ok(p.trouve.includes("objectif") && p.trouve.includes("risques") && p.trouve.includes("budget"));
  // La note ne nomme pas de prestataire en rubrique ni de co-sponsor : ces
  // rubriques sortiront « à renseigner » dans les documents, et on le sait AVANT.
  assert.ok(p.absent.length < ATTENDUES.length);
  const pauvre = analyser("Juste trois lignes sans titre ni structure.");
  assert.equal(pauvre.vide, true);
  assert.deepEqual(pauvre.absent.sort(), [...ATTENDUES].sort());
});

// ---------------------------------------------------------------------------
test("FUSION — on n'écrase jamais en silence ce que le projet sait déjà", () => {
  const p = analyser(NOTE);
  const projet = { objectif: "Objectif déjà arbitré en comité", risques: [{ titre: "Les données de 2014 sont inexploitables en l'état", planB: "travail déjà fait" }] };
  const f = fusionner(projet, p);
  // Le champ déjà rempli et différent n'est pas remplacé : il est signalé.
  assert.ok(!("objectif" in f.patch));
  assert.equal(f.conflits.find((c) => c.cle === "objectif").actuel, "Objectif déjà arbitré en comité");
  // Les champs vides, eux, se remplissent.
  assert.equal(f.patch.contexte.includes("plus maintenu"), true);
  assert.equal(f.patch.budget, 1200000);
  // Un risque déjà travaillé n'est pas dupliqué ni écrasé ; l'autre est ajouté.
  assert.equal(f.patch.risques.length, 2);
  assert.equal(f.patch.risques[0].planB, "travail déjà fait");

  // Avec `ecraser`, la décision est explicite.
  const force = fusionner(projet, p, { ecraser: true });
  assert.match(force.patch.objectif, /huit campus/);
  // Et on peut ne retenir que certaines rubriques.
  const partiel = fusionner({}, p, { choix: ["budget"] });
  assert.deepEqual(Object.keys(partiel.patch), ["budget"]);
});

test("TÂCHES — les chantiers deviennent des regroupements, les jalons flous restent dehors", () => {
  const p = analyser(NOTE);
  const t = tachesDepuisProposition(p);
  const parent = t.find((x) => x.titre === "Cadrage et choix");
  assert.equal(parent.synthese, true);
  const enfant = t.find((x) => x.titre === "Recenser l'existant");
  assert.equal(enfant.parentRef, parent.ref);
  assert.equal(enfant.dureeJours, 15);
  assert.equal(enfant.dureeDeduite, false);
  // « Former les équipes » a une durée écrite ; une action sans durée serait
  // marquée comme déduite, pour que l'écran de validation la montre.
  assert.equal(t.find((x) => x.titre === "Former les équipes").dureeJours, 5);

  // Jalons : les deux datés entrent, le flou reste dehors.
  const jalons = t.filter((x) => x.jalon);
  assert.equal(jalons.length, 2);
  assert.ok(!jalons.some((j) => /Bilan/.test(j.titre)));
  assert.equal(jalons[0].contrainte.type, "echeance");

  // Une action sans durée écrite est marquée pour l'écran de validation.
  const sansDuree = tachesDepuisProposition({ actions: [{ titre: "Rédiger le cahier des charges", chantier: "" }] });
  assert.equal(sansDuree[0].dureeJours, 1);
  assert.equal(sansDuree[0].dureeDeduite, true);
});

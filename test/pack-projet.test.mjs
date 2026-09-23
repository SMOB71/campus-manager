// Le projet branché sur le pack documentaire.
//
// Ce que ces tests protègent : qu'AUCUNE action ne disparaisse des documents,
// et qu'aucune ne s'y invente. Un document qui perd des lignes sans le dire est
// plus dangereux qu'un document absent — on le diffuse en croyant qu'il est
// complet.
import test from "node:test";
import assert from "node:assert/strict";
import { planProjet, htmlPlanProjet, gouvernanceDepuisCopil } from "../lib/pack/projet.js";

const LUNDI = "2026-01-05";
const PROJET = { id: "p1", nom: "Refonte du SI", debut: LUNDI, pilote: "Claire", objectif: "Remplacer l'outil de scolarité" };
const t = (id, o = {}) => ({ id, titre: id, dureeJours: 1, ...o });
const adapter = (taches, projet = PROJET, opts = {}) => planProjet(projet, taches, { aujourdhui: LUNDI, ...opts });

test("CHANTIERS — une action rangée sous une phase ne disparaît pas du document", () => {
  // Les documents groupent par « lot ». Un projet se structure en arborescence :
  // sans traduction, tout ce qui est rangé sous une phase sortait des tableaux.
  const { plan } = adapter([
    t("phase", { titre: "Cadrage" }),
    t("a", { titre: "Recenser", parentId: "phase", dureeJours: 4 }),
    t("b", { titre: "Comparer", parentId: "phase", dureeJours: 3 }),
    t("seule", { titre: "Bascule", dureeJours: 2 }),
    t("declare", { titre: "Audit", dureeJours: 2, lot: "Conformité" }),
  ]);
  const lot = (titre) => plan.taches.find((x) => x.titre === titre).lot;
  assert.equal(lot("Recenser"), "Cadrage");
  assert.equal(lot("Comparer"), "Cadrage");
  // Un lot explicitement saisi prime sur l'arborescence.
  assert.equal(lot("Audit"), "Conformité");
  // Une action de premier niveau a son propre bac : elle ne tombe nulle part.
  assert.equal(lot("Bascule"), "Actions hors chantier");
  // Et aucune action n'est sans lot, donc aucune n'est perdue par le groupage.
  assert.ok(plan.taches.filter((x) => !x.synthese).every((x) => x.lot));
});

test("CHEMIN LE PLUS LONG — les documents surlignent la chaîne, pas un sac de tâches", () => {
  const { plan } = adapter([
    t("debut", { dureeJours: 1 }),
    t("long1", { dureeJours: 5, liens: [{ deId: "debut", type: "FD" }] }),
    t("long2", { dureeJours: 5, liens: [{ deId: "long1", type: "FD" }] }),
    t("court", { dureeJours: 2, liens: [{ deId: "debut", type: "FD" }] }),
    t("fin", { dureeJours: 1, liens: [{ deId: "long2", type: "FD" }, { deId: "court", type: "FD" }] }),
  ]);
  const sur = plan.taches.filter((x) => x.surCheminLePlusLong).map((x) => x.id);
  assert.deepEqual(sur.sort(), ["debut", "fin", "long1", "long2"]);
  assert.equal(plan.resume.margeMin, 0);
  assert.equal(plan.resume.horsMarge, 0);
});

test("DIRECTION ET DÉPENDANCES — les champs que les générateurs lisent sont remplis", () => {
  const projet = { ...PROJET, ressources: [{ id: "r1", nom: "Marc", role: "Direction des systèmes" }] };
  const { plan } = adapter([
    t("a", { dureeJours: 3, affectations: [{ ressourceId: "r1", tauxJour: 1 }] }),
    t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FD", decalage: 3 }] }),
  ], projet);
  assert.equal(plan.taches.find((x) => x.id === "a").dept, "Direction des systèmes");
  // Le classeur lit `decalageJours` ; le moteur stocke `decalage`. Les deux sont exposés.
  const l = plan.taches.find((x) => x.id === "b").liens[0];
  assert.equal(l.decalage, 3);
  assert.equal(l.decalageJours, 3);
  // Le pack lit plan.debut / plan.fin à plat.
  assert.equal(plan.debut, plan.resume.debut);
  assert.equal(plan.fin, plan.resume.fin);
});

test("GOUVERNANCE — le comité réel décrit l'instance ; rien n'est inventé sans lui", () => {
  assert.deepEqual(gouvernanceDepuisCopil(null), { instances: [], trames: [] });
  const g = gouvernanceDepuisCopil(
    { name: "COPIL Refonte", cadence: "Hebdomadaire, le mardi à 09:00", members: [{ name: "Claire", role: "pilote" }, { name: "Marc" }] },
    { total: 30, points: [{ titre: "Point d'avancement", minutes: 5, porteur: "Claire" }, { titre: "Surcharges", minutes: 10, porteur: "" }] },
  );
  assert.equal(g.instances[0].nom, "COPIL Refonte");
  assert.equal(g.instances[0].frequence, "Hebdomadaire, le mardi à 09:00");
  assert.equal(g.instances[0].composition, "Claire (pilote), Marc");
  assert.equal(g.trames[0].etapes.length, 2);
  assert.equal(g.trames[0].etapes[0].duree, "5 min");
});

test("GOUVERNANCE — ce qui est saisi dans la fiche prime sur le comité", () => {
  const projet = { ...PROJET, instances: [{ nom: "Comité stratégique", frequence: "Mensuelle" }] };
  const { projet: out } = adapter([t("a")], projet, {
    committee: { name: "COPIL auto", cadence: "Hebdomadaire", members: [] },
  });
  assert.equal(out.instances.length, 1);
  assert.equal(out.instances[0].nom, "Comité stratégique");
});

test("PLAN IMPRIMABLE — les chiffres, les jalons, et le retard dit comme tel", () => {
  const { projet, plan } = adapter([
    t("phase", { titre: "Cadrage" }),
    t("a", { titre: "Recenser", parentId: "phase", dureeJours: 10 }),
    t("j", { titre: "Bascule", jalon: true, dureeJours: 0, parentId: "phase", liens: [{ deId: "a", type: "FD" }], contrainte: { type: "echeance", date: "2026-01-09" } }),
  ]);
  const h = htmlPlanProjet(projet, plan);
  assert.match(h, /<h1>Refonte du SI<\/h1>/);
  assert.match(h, /Piloté par Claire/);
  assert.match(h, /Remplacer l'outil de scolarité/);
  assert.match(h, /Échéances dépassées/);
  assert.match(h, /jour\(s\) de retard/);
  assert.match(h, /L'échéance n'a pas comprimé le plan/);
  assert.match(h, /◆ Bascule/);
  assert.match(h, /<h2>Cadrage<\/h2>/);
  assert.match(h, /elles sont calculées depuis les durées/);
  // Vue restreinte à un chantier : pour ne donner à chacun que sa partie.
  const partiel = htmlPlanProjet(projet, plan, { lot: "Cadrage" });
  assert.match(partiel, /Vue restreinte au lot/);
});

test("PLAN IMPRIMABLE — le contenu utilisateur est échappé", () => {
  const { projet, plan } = adapter([t("a", { titre: "<script>alert(1)</script>" })],
    { ...PROJET, nom: "Projet <img src=x onerror=alert(1)>" });
  const h = htmlPlanProjet(projet, plan);
  assert.ok(!h.includes("<script>alert(1)</script>"));
  assert.ok(!h.includes("<img src=x"));
  assert.match(h, /&lt;script&gt;/);
});

test("PLAN NON CALCULABLE — on le dit, on ne produit rien", () => {
  const { plan } = adapter([
    t("a", { liens: [{ deId: "b", type: "FD" }] }),
    t("b", { liens: [{ deId: "a", type: "FD" }] }),
  ]);
  assert.equal(plan.ok, false);
  assert.ok(plan.erreurs.length);
});

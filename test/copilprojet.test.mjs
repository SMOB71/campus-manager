// Comité de pilotage d'un projet : récurrence des séances et ordre du jour
// déduit du plan.
//
// Ce que ces tests protègent : qu'un comité hebdomadaire EXISTE sans que
// personne n'y pense, que son ordre du jour dise ce qui a bougé et pourquoi,
// et qu'il se taise quand il n'y a rien — meubler ferait perdre au comité la
// seule chose qui le rend utile, la confiance dans ce qu'il remonte.
import test from "node:test";
import assert from "node:assert/strict";
import { ordonnancer, charge, prendreReference, derive, jourSemaine } from "../lib/projets.js";
import {
  CADENCES, normaliserRegle, libelleRegle, prochainesSeances,
  ordreDuJour, versAgendaItems, versMarkdown,
} from "../lib/copilprojet.js";

const LUNDI = "2026-01-05";
const PROJET = { id: "p1", nom: "Refonte du SI", debut: LUNDI, pilote: "Claire" };
const t = (id, o = {}) => ({ id, titre: id, dureeJours: 1, ...o });
const plan = (taches, projet = PROJET, auj = LUNDI) => ordonnancer(projet, taches, { aujourdhui: auj });

// ---------------------------------------------------------------------------
test("RÉCURRENCE — les séances existent sans que personne n'y pense", () => {
  const r = normaliserRegle({ type: "hebdo", jourSemaine: 2, heure: "09:30" });
  assert.equal(libelleRegle(r), "Hebdomadaire, le mardi à 09:30");
  const s = prochainesSeances(r, { aujourdhui: LUNDI });
  assert.equal(s.length, 10);                       // horizon par défaut : dix semaines
  assert.equal(s[0].date, "2026-01-06");            // le premier mardi à venir
  assert.equal(s[1].date, "2026-01-13");
  assert.ok(s.every((x) => jourSemaine(x.date) === 2));
  assert.ok(s.every((x) => x.date >= LUNDI));       // jamais une séance dans le passé
  assert.equal(s[0].time, "09:30");
});

test("RÉCURRENCE — idempotente : rappelée, elle ne propose pas de doublon", () => {
  const r = { type: "hebdo", jourSemaine: 2 };
  const premier = prochainesSeances(r, { aujourdhui: LUNDI });
  // Un cron qui repasse le lendemain avec les séances déjà créées ne doit RIEN
  // reproposer : un doublon de séance, c'est deux convocations pour la même
  // réunion et un comité qui arrive en ordre dispersé.
  const second = prochainesSeances(r, { aujourdhui: LUNDI, existantes: premier });
  assert.deepEqual(second, []);
  // Le lendemain, l'horizon a glissé d'un jour : au plus une séance de plus.
  const demain = prochainesSeances(r, { aujourdhui: "2026-01-06", existantes: premier });
  assert.ok(demain.length <= 1);
});

test("RÉCURRENCE — un comité tombant un férié est REPORTÉ, pas sauté", () => {
  // 1er mai 2026 = vendredi férié. Le comité du vendredi passe au lundi
  // suivant : un comité sauté ne se rattrape pas, et le 1er mai revient tous
  // les ans.
  const s = prochainesSeances({ type: "hebdo", jourSemaine: 5 }, { aujourdhui: "2026-04-20" });
  const dates = s.map((x) => x.date);
  assert.ok(!dates.includes("2026-05-01"));
  assert.ok(dates.includes("2026-05-04"));
});

test("RÉCURRENCE — mensuelle : même quantième, jour ouvré", () => {
  const s = prochainesSeances({ type: "mensuelle", quantieme: 1 }, { aujourdhui: "2026-01-15" });
  // 1er février 2026 = dimanche -> lundi 2. 1er mars = dimanche -> lundi 2.
  assert.equal(s[0].date, "2026-02-02");
  assert.equal(s[1].date, "2026-03-02");
  assert.equal(Object.keys(CADENCES).length, 3);
});

// ---------------------------------------------------------------------------
test("ODJ — les trois chiffres, toujours les mêmes, toujours en tête", () => {
  const p = plan([t("a", { dureeJours: 5 }), t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] })]);
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: LUNDI });
  assert.equal(odj.points[0].cle, "avancement");
  assert.equal(odj.chiffres.fin, "2026-01-16");
  assert.equal(odj.chiffres.avancement, 0);
  assert.equal(odj.chiffres.resteAFaire, 10);
  assert.match(odj.points[0].detail, /aucune référence figée/);
  assert.equal(odj.points[0].porteur, "Claire");
});

test("ODJ — il SE TAIT quand rien ne cloche, au lieu de meubler", () => {
  const p = plan([t("a", { dureeJours: 5 })]);
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: LUNDI });
  assert.equal(odj.vide, true);
  assert.match(odj.note, /Rien ne bloque/);
  assert.ok(odj.points.every((x) => x.gravite === "info"));
  assert.ok(odj.total <= 60);
});

test("ODJ — une échéance franchie fait un point par échéance, avec l'arbitrage attendu", () => {
  const p = plan([
    t("a", { dureeJours: 10 }),
    t("j", { jalon: true, dureeJours: 0, liens: [{ deId: "a", type: "FD" }], contrainte: { type: "echeance", date: "2026-01-09" } }),
  ]);
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: LUNDI });
  const pt = odj.points.find((x) => x.cle.startsWith("echeance-"));
  assert.ok(pt, "un point par échéance dépassée");
  assert.equal(pt.gravite, "bloquant");
  assert.match(pt.titre, /dépasse son échéance de 5 jour/);
  assert.match(pt.decision, /réduire le contenu|acter la nouvelle date/);
  assert.equal(odj.vide, false);
});

test("ODJ — ce qui a bougé DEPUIS la dernière séance, avec le motif signé", () => {
  const p = plan([t("a", { dureeJours: 5 }), t("j", { jalon: true, dureeJours: 0, liens: [{ deId: "a", type: "FD" }] })]);
  const journal = [
    { at: "2026-01-02T10:00:00Z", motif: "avant le comité précédent", mouvements: [{ titre: "Vieux", de: "2026-01-01", vers: "2026-01-02" }] },
    { at: "2026-01-08T10:00:00Z", motif: "prestataire indisponible", par: "Claire", mouvements: [{ titre: "Décision", de: "2026-01-09", vers: "2026-01-16" }] },
  ];
  const odj = ordreDuJour({
    projet: PROJET, plan: p, journal, aujourdhui: "2026-01-12",
    seancePrecedente: { date: "2026-01-06", resolutions: [] },
  });
  const pt = odj.points.find((x) => x.cle === "mouvements");
  assert.match(pt.titre, /1 jalon\(s\) déplacé\(s\) depuis le comité du 06\/01/);
  assert.match(pt.detail, /prestataire indisponible/);
  assert.ok(!pt.detail.includes("Vieux"), "ce qui précède la dernière séance n'y est plus");

  // Sans mouvement, on le DIT : l'absence de mouvement est une information.
  const calme = ordreDuJour({ projet: PROJET, plan: p, journal: [], aujourdhui: "2026-01-12", seancePrecedente: { date: "2026-01-06" } });
  assert.match(calme.points.find((x) => x.cle === "mouvements").titre, /Aucun jalon déplacé/);
});

test("ODJ — un report SANS motif est dénoncé comme tel", () => {
  const p = plan([t("a", { dureeJours: 5 })]);
  const odj = ordreDuJour({
    projet: PROJET, plan: p, aujourdhui: "2026-01-12",
    seancePrecedente: { date: "2026-01-06" },
    journal: [{ at: "2026-01-08T10:00:00Z", motif: "", mouvements: [{ titre: "Jalon", de: "2026-01-09", vers: "2026-01-20" }] }],
  });
  assert.match(odj.points.find((x) => x.cle === "mouvements").detail, /sans motif consigné/);
});

test("ODJ — reprend les décisions du comité précédent arrivées à terme", () => {
  const p = plan([t("a", { dureeJours: 5 })]);
  const odj = ordreDuJour({
    projet: PROJET, plan: p, aujourdhui: "2026-01-12",
    seancePrecedente: { date: "2026-01-06", resolutions: [
      { text: "Choisir le prestataire", owner: "Claire", dueDate: "2026-01-09" },
      { text: "Budget à valider", owner: "DAF", dueDate: "2026-03-01" },   // pas encore échue
    ] },
  });
  const pt = odj.points.find((x) => x.cle === "decisions-precedentes");
  assert.match(pt.titre, /Suivi des 1 décision/);
  assert.match(pt.detail, /Choisir le prestataire/);
  assert.ok(!pt.detail.includes("Budget à valider"));
  assert.match(pt.decision, /soldée, ou nouvelle échéance/);
});

test("ODJ — tâche critique qui devrait être lancée et ne l'est pas", () => {
  const p = plan([
    t("a", { titre: "Reprise des données", dureeJours: 10, responsable: "Marc" }),
    t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] }),
  ], PROJET, "2026-01-12");
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: "2026-01-12" });
  const pt = odj.points.find((x) => x.cle === "a-lancer");
  assert.ok(pt);
  assert.equal(pt.gravite, "bloquant");
  assert.match(pt.decision, /qui lance quoi/);
  assert.equal(pt.porteur, "Marc");
});

test("ODJ — la surcharge remonte avec son arbitrage chiffrable", () => {
  const projet = { ...PROJET, ressources: [{ id: "r1", nom: "Claire", capaciteJour: 0.4 }] };
  const p = plan([t("a", { dureeJours: 4, affectations: [{ ressourceId: "r1", tauxJour: 1 }] })], projet);
  const odj = ordreDuJour({ projet, plan: p, charge: charge(p), aujourdhui: LUNDI });
  const pt = odj.points.find((x) => x.cle === "charge");
  assert.match(pt.titre, /1 personne\(s\) au-delà de la capacité/);
  assert.match(pt.detail, /Claire : 4 j au-dessus de 0.4 j\/j/);
  assert.match(pt.decision, /assumant le coût en jours/);
});

test("ODJ — plan non calculable : un seul point, et il dit de ne rien annoncer", () => {
  const p = plan([t("a", { liens: [{ deId: "b", type: "FD" }] }), t("b", { liens: [{ deId: "a", type: "FD" }] })]);
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: LUNDI });
  assert.equal(odj.ok, false);
  assert.equal(odj.points.length, 1);
  assert.match(odj.points[0].decision, /aucune date annoncée ici ne vaut/);
});

test("ODJ — la dérive se lit quand une référence a été figée", () => {
  const taches = [t("a", { dureeJours: 5 }), t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] })];
  const ref = prendreReference(plan(taches));
  const tard = plan(taches, PROJET, "2026-01-26");
  const odj = ordreDuJour({ projet: PROJET, plan: tard, derive: derive(tard, ref), aujourdhui: "2026-01-26" });
  assert.equal(odj.chiffres.derive, 15);
  assert.match(odj.points[0].detail, /15 j de retard sur la référence/);
});

test("ODJ — un comité ne dure pas deux heures : le total est borné", () => {
  const taches = [];
  for (let i = 0; i < 6; i++) {
    taches.push(t(`a${i}`, { dureeJours: 10 }));
    taches.push(t(`j${i}`, { jalon: true, dureeJours: 0, liens: [{ deId: `a${i}`, type: "FD" }], contrainte: { type: "echeance", date: "2026-01-09" } }));
  }
  const odj = ordreDuJour({ projet: PROJET, plan: plan(taches), aujourdhui: LUNDI });
  assert.ok(odj.total <= 60, `total ${odj.total} min`);
  // Ce qu'on rabote en premier, c'est l'informatif — jamais un bloquant en dessous de 2 min.
  assert.ok(odj.points.filter((x) => x.gravite === "bloquant").every((x) => x.minutes >= 2));
});

test("SORTIES — convocation et Markdown reprennent le fond sans le reformuler", () => {
  const p = plan([t("a", { dureeJours: 10 }), t("j", { jalon: true, dureeJours: 0, liens: [{ deId: "a", type: "FD" }], contrainte: { type: "echeance", date: "2026-01-09" } })]);
  const odj = ordreDuJour({ projet: PROJET, plan: p, aujourdhui: LUNDI });
  const items = versAgendaItems(odj);
  assert.equal(items.length, odj.points.length);
  assert.match(items[0].text, /Point d'avancement.*min\)$/);
  assert.ok(items.every((x) => x.text.length <= 900));
  const md = versMarkdown(odj, { projet: PROJET, seance: { date: "2026-01-12" } });
  assert.match(md, /# Ordre du jour — Refonte du SI — 12 janvier 2026/);
  assert.match(md, /\*\*Décision attendue :\*\*/);
  assert.match(md, /sans reformulation/);
});

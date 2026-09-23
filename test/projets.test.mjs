// Conduite de projet — moteur d'ordonnancement.
//
// Ce que ces tests protègent, ce n'est pas « le calcul marche » : c'est que le
// planning REFUSE de mentir. Un plan faux est plus dangereux qu'un plan absent,
// parce qu'on prend des décisions avec.
import test from "node:test";
import assert from "node:assert/strict";
import {
  feriesFR, construireCalendrier, ajouterJoursOuvres, compterJoursOuvres, indexJour,
  ordonnancer, validerPlan, chercherCycle, charge, nivellement, simuler,
  prendreReference, derive, cheminsCritiques, modeleDepuisProjet, instancierModele,
  portefeuille, normaliserTache, fusionnerModele, TYPES_LIEN,
} from "../lib/projets.js";

// 2026-01-05 est un lundi : toutes les dates des tests partent de là.
const LUNDI = "2026-01-05";
const PROJET = { id: "p1", nom: "Test", debut: LUNDI };
const t = (id, o = {}) => ({ id, titre: id, dureeJours: 1, ...o });
const plan = (taches, projet = PROJET, auj = LUNDI) => ordonnancer(projet, taches, { aujourdhui: auj });
const dateDe = (p, id) => { const x = p.taches.find((y) => y.id === id); return [x.debut, x.fin]; };

// ---------------------------------------------------------------------------
test("CALENDRIER — les fériés mobiles sont calculés, jamais codés en dur", () => {
  // Pâques 2026 : 5 avril. Lundi de Pâques le 6, Ascension le 14 mai, Pentecôte le 25.
  const f = feriesFR(2026);
  assert.equal(f.paques, "2026-04-05");
  assert.ok(f.jours.includes("2026-04-06"));
  assert.ok(f.jours.includes("2026-05-14"));
  assert.ok(f.jours.includes("2026-05-25"));
  assert.equal(f.jours.length, 11);
  // Alsace-Moselle : Vendredi saint et 26 décembre, déclarés et non devinés.
  assert.deepEqual(f.alsaceMoselle, ["2026-04-03", "2026-12-26"]);
});

test("CALENDRIER — week-ends, fériés et fermetures sortent du décompte", () => {
  const cal = construireCalendrier({ debut: "2026-04-01", fin: "2026-04-10" });
  assert.ok(!cal.estOuvre("2026-04-04")); // samedi
  assert.ok(!cal.estOuvre("2026-04-06")); // lundi de Pâques
  assert.equal(cal.motifNonOuvre("2026-04-06"), "jour férié");
  assert.equal(cal.motifNonOuvre("2026-04-05"), "dimanche non travaillé");

  const ferme = construireCalendrier({ debut: "2026-12-20", fin: "2027-01-10", fermetures: [{ du: "2026-12-21", au: "2027-01-02", motif: "fermeture de fin d'année" }] });
  assert.equal(ferme.motifNonOuvre("2026-12-23"), "fermeture de fin d'année");
  // Le 21 décembre n'est pas travaillé : le premier jour utile est le lundi
  // 4 janvier (le 1er est férié, les 2 et 3 tombent un week-end).
  assert.equal(ajouterJoursOuvres(ferme, "2026-12-21", 0), "2027-01-04");
});

test("CALENDRIER — compter en jours ouvrés, pas en jours calendaires", () => {
  const cal = construireCalendrier({ debut: LUNDI, fin: "2026-02-28" });
  assert.equal(compterJoursOuvres(cal, LUNDI, "2026-01-09"), 5);   // lundi -> vendredi
  assert.equal(compterJoursOuvres(cal, LUNDI, "2026-01-12"), 6);   // le week-end ne compte pas
  assert.equal(ajouterJoursOuvres(cal, LUNDI, 5), "2026-01-12");
});

// ---------------------------------------------------------------------------
test("ENCHAÎNEMENT FIN -> DÉBUT — la durée s'exprime en jours ouvrés", () => {
  const p = plan([
    t("a", { dureeJours: 3 }),
    t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FD" }] }),
  ]);
  assert.ok(p.ok);
  assert.deepEqual(dateDe(p, "a"), ["2026-01-05", "2026-01-07"]);
  assert.deepEqual(dateDe(p, "b"), ["2026-01-08", "2026-01-09"]);
  assert.equal(p.resume.fin, "2026-01-09");
});

test("JALON — durée nulle : le successeur part le jour même, pas le lendemain", () => {
  // Le décalage d'un jour est le bug classique des implémentations naïves :
  // sur dix jalons en cascade, le plan dérive de deux semaines.
  const p = plan([
    t("a", { dureeJours: 2 }),
    t("j", { jalon: true, dureeJours: 0, liens: [{ deId: "a", type: "FD" }] }),
    t("b", { dureeJours: 1, liens: [{ deId: "j", type: "FD" }] }),
  ]);
  assert.deepEqual(dateDe(p, "j"), ["2026-01-07", "2026-01-07"]);
  assert.deepEqual(dateDe(p, "b"), ["2026-01-07", "2026-01-07"]);
});

test("LES QUATRE TYPES DE LIENS, ET LE DÉCALAGE", () => {
  const dd = plan([t("a", { dureeJours: 5 }), t("b", { dureeJours: 2, liens: [{ deId: "a", type: "DD", decalage: 2 }] })]);
  assert.deepEqual(dateDe(dd, "b"), ["2026-01-07", "2026-01-08"]);

  const ff = plan([t("a", { dureeJours: 5 }), t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FF" }] })]);
  // b doit finir en même temps que a (le 9) : elle commence donc le 8.
  assert.deepEqual(dateDe(ff, "b"), ["2026-01-08", "2026-01-09"]);

  const df = plan([t("a", { dureeJours: 3 }), t("b", { dureeJours: 2, liens: [{ deId: "a", type: "DF" }] })]);
  // b ne peut finir qu'une fois a commencée : fin >= début de a.
  assert.equal(df.taches.find((x) => x.id === "b").fin >= "2026-01-05", true);

  // Décalage négatif = recouvrement : a occupe le 5 au 8, et b démarre le 8,
  // soit un jour ouvré de chevauchement.
  const chevauche = plan([t("a", { dureeJours: 4 }), t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FD", decalage: -1 }] })]);
  assert.deepEqual(dateDe(chevauche, "a"), ["2026-01-05", "2026-01-08"]);
  assert.deepEqual(dateDe(chevauche, "b"), ["2026-01-08", "2026-01-09"]);
  assert.equal(Object.keys(TYPES_LIEN).length, 4);
});

// ---------------------------------------------------------------------------
test("REFUS DE CALCULER — un cycle est NOMMÉ, pas contourné", () => {
  const taches = [
    t("a", { liens: [{ deId: "c", type: "FD" }] }),
    t("b", { liens: [{ deId: "a", type: "FD" }] }),
    t("c", { liens: [{ deId: "b", type: "FD" }] }),
  ].map(normaliserTache);
  const cycle = chercherCycle(taches);
  assert.ok(cycle && cycle.length === 3);
  const v = validerPlan(taches);
  assert.equal(v.ok, false);
  assert.match(v.erreurs.at(-1).message, /circulaire/);
  // Et surtout : aucune date n'est produite.
  const p = plan(taches);
  assert.equal(p.ok, false);
  assert.equal(p.taches.length, 0);
});

test("REFUS DE CALCULER — lien orphelin, auto-dépendance, synthèse avec lien", () => {
  assert.match(validerPlan([t("a", { liens: [{ deId: "zzz" }] })].map(normaliserTache)).erreurs[0].message, /tâche supprimée/);
  assert.match(validerPlan([t("a", { liens: [{ deId: "a" }] })].map(normaliserTache)).erreurs[0].message, /dépend d'elle-même/);
  // Une tâche de synthèse avec une dépendance : refusé, et on dit pourquoi.
  const v = validerPlan([
    t("phase", { liens: [{ deId: "amont" }] }), t("amont"),
    t("x", { parentId: "phase" }),
  ].map(normaliserTache));
  assert.equal(v.ok, false);
  assert.match(v.erreurs.find((e) => e.tacheId === "phase" && /élémentaire/.test(e.message)).message, /tâche élémentaire/);
  // Sa durée saisie est un avertissement, pas un blocage : elle sera écrasée
  // par l'enveloppe de ses enfants.
  const dureeSynthese = v.erreurs.find((e) => /durée saisie est ignorée/.test(e.message));
  assert.equal(dureeSynthese.corrigible, true);
  assert.equal(dureeSynthese.avertissement, true);
});

test("AJOUTER UNE SOUS-TÂCHE NE CASSE PAS LE PLAN", () => {
  // Ajouter un enfant à une tâche existante en fait une tâche de synthèse : sa
  // durée saisie (1 jour par défaut) devient caduque. La traiter comme une
  // erreur rendait le plan ENTIER non calculable au premier regroupement, pour
  // une donnée que le calcul n'utilise même pas.
  const p = plan([
    t("phase", { dureeJours: 1 }),
    t("enfant", { parentId: "phase", dureeJours: 4 }),
  ]);
  assert.equal(p.ok, true);
  assert.equal(p.resume.fin, "2026-01-08");
  // La durée du regroupement vient de ses enfants, pas de la saisie.
  assert.equal(p.taches.find((x) => x.id === "phase").dureeJours, 4);
  // Et l'avertissement reste remonté à l'écran.
  assert.ok(p.erreurs.some((e) => /durée saisie est ignorée/.test(e.message)));
});

// ---------------------------------------------------------------------------
test("MARGES ET CHEMIN CRITIQUE — la branche courte a du jeu, la longue n'en a pas", () => {
  const p = plan([
    t("debut", { dureeJours: 1 }),
    t("long1", { dureeJours: 5, liens: [{ deId: "debut", type: "FD" }] }),
    t("long2", { dureeJours: 5, liens: [{ deId: "long1", type: "FD" }] }),
    t("court", { dureeJours: 2, liens: [{ deId: "debut", type: "FD" }] }),
    t("fin", { dureeJours: 1, liens: [{ deId: "long2", type: "FD" }, { deId: "court", type: "FD" }] }),
  ]);
  const par = (id) => p.taches.find((x) => x.id === id);
  assert.equal(par("long1").critique, true);
  assert.equal(par("long1").margeTotale, 0);
  assert.equal(par("court").critique, false);
  assert.equal(par("court").margeTotale, 8);   // 10 j de branche longue - 2 j
  assert.equal(par("court").margeLibre, 8);    // rien ne bouge si « court » glisse de 8 j
  const chaines = cheminsCritiques(p);
  assert.deepEqual(chaines[0].taches.map((x) => x.id), ["debut", "long1", "long2", "fin"]);
});

test("ÉCHÉANCE — elle ne comprime pas le plan, elle révèle le retard", () => {
  const p = plan([
    t("a", { dureeJours: 10, contrainte: { type: "echeance", date: "2026-01-09" } }),
  ]);
  const a = p.taches[0];
  // La tâche garde ses 10 jours : on ne la raccourcit pas pour faire rentrer.
  assert.equal(a.fin, "2026-01-16");
  assert.ok(a.margeTotale < 0, "marge négative attendue");
  assert.equal(a.echeanceDepassee, 5);
  assert.equal(p.resume.echeancesDepassees[0].retard, 5);
});

test("DATE IMPOSÉE — le conflit est nommé, jamais corrigé en douce", () => {
  const p = plan([
    t("a", { dureeJours: 10 }),
    t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FD" }], contrainte: { type: "impose", date: "2026-01-07" } }),
  ]);
  const b = p.taches.find((x) => x.id === "b");
  assert.equal(b.debut, "2026-01-07");            // la date tenue est celle de l'engagement
  assert.equal(b.conflits.length, 1);
  assert.match(b.conflits[0], /ne la libèrent que le 2026-01-19/);
  assert.equal(p.resume.conflits.length, 1);
});

test("PAS AVANT — l'attente externe repousse sans inventer de dépendance", () => {
  const p = plan([t("a", { dureeJours: 2, contrainte: { type: "pas_avant", date: "2026-01-14" } })]);
  assert.deepEqual(dateDe(p, "a"), ["2026-01-14", "2026-01-15"]);
});

// ---------------------------------------------------------------------------
test("RIEN NE COMMENCE DANS LE PASSÉ — le retard remonte au lieu de dormir", () => {
  // Projet lancé en janvier, on est en mars, rien n'a démarré.
  const p = plan([t("a", { dureeJours: 5 }), t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] })], PROJET, "2026-03-02");
  assert.equal(p.taches[0].debut, "2026-03-02");
  assert.equal(p.resume.fin, "2026-03-13");
});

test("AVANCEMENT — c'est le RESTE À FAIRE qui pilote, pas un pourcentage saisi", () => {
  // Tâche de 10 jours commencée le 5, il en reste 8 au 12 janvier : la fin
  // prévue est dans 8 jours ouvrés, pas à la date initiale.
  const p = plan([t("a", { dureeJours: 10, statut: "en_cours", debutReel: LUNDI, resteAFaire: 8 })], PROJET, "2026-01-12");
  const a = p.taches[0];
  assert.equal(a.debut, "2026-01-05");
  assert.equal(a.fin, "2026-01-21");             // 12 janvier + 8 jours ouvrés
  assert.equal(Math.round(a.avancement * 100), 20);
  assert.equal(p.resume.resteAFaireJours, 8);
});

test("UNE TÂCHE EN COURS QUI COMMANDE LA SUITE EST CRITIQUE", () => {
  // Elle a démarré il y a dix jours, il en reste trois, et tout attend après
  // elle. Ancrer la marge sur la date de début RÉELLE lui inventerait sept
  // jours de jeu et la sortirait du chemin critique — au moment précis où
  // c'est elle qu'il faut pousser.
  const p = plan([
    t("a", { dureeJours: 10, statut: "en_cours", debutReel: LUNDI, resteAFaire: 3 }),
    t("b", { dureeJours: 4, liens: [{ deId: "a", type: "FD" }] }),
  ], PROJET, "2026-01-19");
  const a = p.taches.find((x) => x.id === "a");
  assert.equal(a.margeTotale, 0);
  assert.equal(a.critique, true);
  assert.equal(a.fin, "2026-01-21");          // 19 janvier + 3 jours ouvrés
});

test("AVANCEMENT — une phase ne peut pas se déclarer à 80 % : il est calculé", () => {
  const p = plan([
    t("phase", { dureeJours: 0 }),
    t("gros", { parentId: "phase", dureeJours: 8, statut: "a_faire" }),
    t("petit", { parentId: "phase", dureeJours: 2, statut: "faite", debutReel: LUNDI, finReelle: "2026-01-06", resteAFaire: 0 }),
  ]);
  const phase = p.taches.find((x) => x.id === "phase");
  assert.equal(phase.synthese, true);
  // 2 jours faits sur 10 = 20 %, et non « une tâche sur deux = 50 % ».
  assert.equal(Math.round(phase.avancement * 100), 20);
  assert.equal(phase.debut, "2026-01-05");
  assert.equal(phase.code, "1");
  assert.equal(p.taches.find((x) => x.id === "gros").code, "1.1");
});

test("TÂCHE FAITE — elle ne se replanifie pas, et libère ses successeurs", () => {
  const p = plan([
    t("a", { dureeJours: 5, statut: "faite", debutReel: LUNDI, finReelle: "2026-01-07", resteAFaire: 0 }),
    t("b", { dureeJours: 2, liens: [{ deId: "a", type: "FD" }] }),
  ], PROJET, "2026-01-12");
  assert.deepEqual(dateDe(p, "a"), ["2026-01-05", "2026-01-07"]);
  // b ne peut pas démarrer le 8 : on est le 12. Le passé ne se replanifie pas.
  assert.equal(p.taches.find((x) => x.id === "b").debut, "2026-01-12");
});

// ---------------------------------------------------------------------------
test("CHARGE — la surcharge se mesure jour par jour, pas en moyenne mensuelle", () => {
  const projet = { ...PROJET, ressources: [{ id: "r1", nom: "Claire", capaciteJour: 1 }] };
  const p = plan([
    t("a", { dureeJours: 3, affectations: [{ ressourceId: "r1", tauxJour: 1 }] }),
    t("b", { dureeJours: 3, affectations: [{ ressourceId: "r1", tauxJour: 1 }] }),
  ], projet);
  const c = charge(p);
  assert.equal(c.ressources[0].nbJoursSurcharge, 3);
  assert.equal(c.ressources[0].pic, 2);
  assert.equal(c.surchargees, 1);

  // Capacité réaliste : un directeur à 40 % sur le projet est en surcharge dès
  // qu'on lui confie une tâche à plein temps. « 1 ETP » masquait exactement ça.
  const mi = plan([t("a", { dureeJours: 2, affectations: [{ ressourceId: "r1", tauxJour: 1 }] })],
    { ...PROJET, ressources: [{ id: "r1", nom: "Claire", capaciteJour: 0.4 }] });
  assert.equal(charge(mi).ressources[0].nbJoursSurcharge, 2);
});

test("CHARGE — une affectation vers une ressource retirée est signalée, pas oubliée", () => {
  const p = plan([t("a", { affectations: [{ ressourceId: "parti", tauxJour: 1 }] })], { ...PROJET, ressources: [] });
  assert.equal(charge(p).inconnues.length, 1);
});

test("NIVELLEMENT — c'est une PROPOSITION chiffrée, avec son coût en jours", () => {
  const projet = { ...PROJET, ressources: [{ id: "r1", nom: "Claire", capaciteJour: 1 }] };
  const taches = [
    t("a", { dureeJours: 3, affectations: [{ ressourceId: "r1", tauxJour: 1 }] }),
    t("b", { dureeJours: 3, affectations: [{ ressourceId: "r1", tauxJour: 1 }] }),
    t("fin", { dureeJours: 1, liens: [{ deId: "a", type: "FD" }, { deId: "b", type: "FD" }] }),
  ];
  const n = nivellement(projet, taches, { aujourdhui: LUNDI });
  assert.equal(n.ok, true);
  assert.equal(n.avant.joursSurcharge, 3);
  assert.equal(n.apres.joursSurcharge, 0);
  assert.equal(n.resolu, true);
  assert.equal(n.propositions.length, 1);
  assert.equal(n.propositions[0].jours, 3);
  assert.equal(n.coutJours, 3);   // le décalage coûte 3 jours sur la fin : c'est dit
});

// ---------------------------------------------------------------------------
test("SIMULATION — répond sans rien écrire", () => {
  const taches = [
    t("a", { dureeJours: 5 }),
    t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] }),
    t("jalon", { jalon: true, dureeJours: 0, liens: [{ deId: "b", type: "FD" }] }),
  ];
  const s = simuler(PROJET, taches, [{ tacheId: "a", decalageJours: 4 }], { aujourdhui: LUNDI });
  assert.equal(s.ok, true);
  assert.equal(s.ecartJours, 4);
  assert.equal(s.impacts[0].ecart, 4);
  // Le plan d'origine n'a pas bougé d'un octet.
  assert.equal(taches[0].contrainte, undefined);
  assert.equal(plan(taches).resume.fin, s.finAvant);

  // Allonger une tâche non critique ne coûte rien tant qu'on reste dans sa marge.
  const paralleles = [t("a", { dureeJours: 10 }), t("b", { dureeJours: 2 }), t("f", { dureeJours: 1, liens: [{ deId: "a", type: "FD" }, { deId: "b", type: "FD" }] })];
  assert.equal(simuler(PROJET, paralleles, [{ tacheId: "b", dureeJours: 5 }], { aujourdhui: LUNDI }).ecartJours, 0);
  assert.equal(simuler(PROJET, paralleles, [{ tacheId: "b", dureeJours: 15 }], { aujourdhui: LUNDI }).ecartJours, 5);
});

// ---------------------------------------------------------------------------
test("RÉFÉRENCE ET DÉRIVE — sans référence figée, un plan qui glisse a l'air à jour", () => {
  const taches = [t("a", { dureeJours: 5 }), t("b", { dureeJours: 5, liens: [{ deId: "a", type: "FD" }] })];
  const p0 = plan(taches);
  const ref = prendreReference(p0, { par: "Stéphane", motif: "validation en comité" });
  assert.equal(ref.fin, "2026-01-16");
  assert.equal(ref.taches.length, 2);

  // Trois semaines plus tard, rien n'a commencé.
  const p1 = plan(taches, PROJET, "2026-01-26");
  const d = derive(p1, ref);
  assert.equal(d.finEcart, 15);
  assert.equal(d.glissements[0].ecart, 15);
  // Une tâche ajoutée après la référence est signalée comme telle, pas comme dérive.
  const d2 = derive(plan([...taches, t("c", { dureeJours: 1 })]), ref);
  assert.equal(d2.lignes.find((l) => l.id === "c").nouvelle, true);
});

// ---------------------------------------------------------------------------
test("MODÈLE — se capture depuis un projet réel, aucune trame imposée", () => {
  const taches = [
    t("a", { titre: "Dossier", dureeJours: 5 }),
    t("b", { titre: "Dépôt", dureeJours: 2, liens: [{ deId: "a", type: "FD" }] }),
    t("j", { titre: "Validation", jalon: true, dureeJours: 0, liens: [{ deId: "b", type: "FD" }] }),
  ];
  const p = plan(taches);
  const m = modeleDepuisProjet(PROJET, taches, p, { nom: "Trame dépôt" });
  assert.equal(m.taches.length, 3);
  assert.equal(m.taches[0].ref, "T1");
  assert.equal(m.taches[1].liens[0].ref, "T1");
  // Un modèle ne transporte pas les personnes : elles changent de poste.
  assert.equal(m.taches[0].responsable, "");

  // Instanciation « depuis » : la première tâche tombe sur le pivot.
  const inst = instancierModele(m, { datePivot: "2026-03-02", sens: "depuis" });
  assert.equal(inst.debutProjet, "2026-03-02");
  const rejoue = ordonnancer({ debut: inst.debutProjet }, inst.taches, { aujourdhui: "2026-03-02" });
  assert.equal(rejoue.taches.find((x) => x.titre === "Dossier").debut, "2026-03-02");
  assert.equal(rejoue.resume.fin, "2026-03-10");
});

test("MODÈLE À REBOURS — la date qui ne se négocie pas est la FIN", () => {
  // Une rentrée, un audit, une date de dépôt : on part de la date cible et on
  // remonte. C'est le cas le plus fréquent, et celui que les outils traitent
  // le plus mal (ils demandent une date de début qu'on n'a pas).
  const m = {
    nom: "Trame", calendrier: {},
    taches: [
      { ref: "T1", titre: "Préparer", dureeJours: 5, offset: 0, liens: [] },
      { ref: "T2", titre: "Déposer", dureeJours: 2, offset: 5, liens: [{ ref: "T1", type: "FD", decalage: 0 }] },
    ],
  };
  const inst = instancierModele(m, { datePivot: "2026-06-30", sens: "avant" });
  const p = ordonnancer({ debut: inst.debutProjet }, inst.taches, { aujourdhui: inst.debutProjet });
  assert.equal(p.resume.fin, "2026-06-30");     // la fin tombe exactement sur la cible
  // 7 jours ouvrés à remonter depuis le 30 juin : « Préparer » part le 22.
  assert.equal(p.taches.find((x) => x.titre === "Préparer").debut, "2026-06-22");
  assert.equal(p.taches.find((x) => x.titre === "Déposer").debut, "2026-06-29");

  // Cible tombant un samedi : le projet finit le vendredi. Un planning ne peut
  // pas s'achever un jour où personne ne travaille — et surtout, viser le
  // samedi reviendrait à s'accorder deux jours qui n'existent pas.
  const weekend = instancierModele(m, { datePivot: "2026-07-04", sens: "avant" });
  const q = ordonnancer({ debut: weekend.debutProjet }, weekend.taches, { aujourdhui: weekend.debutProjet });
  assert.equal(q.resume.fin, "2026-07-03");
});

// ---------------------------------------------------------------------------
test("PORTEFEUILLE — des faits comptés, pas une note de santé sur 100", () => {
  const p1 = { id: "p1", nom: "Avec retard", statut: "en_cours", debut: LUNDI };
  const p2 = { id: "p2", nom: "Sain", statut: "en_cours", debut: LUNDI };
  const plans = {
    p1: plan([t("a", { dureeJours: 10, contrainte: { type: "echeance", date: "2026-01-09" } })], p1),
    p2: plan([t("a", { dureeJours: 2 })], p2),
  };
  const pf = portefeuille([p2, p1], plans);
  assert.equal(pf.lignes[0].id, "p1");           // le projet en alerte remonte en tête
  assert.equal(pf.lignes[0].alertes[0].niveau, "bloquant");
  assert.equal(pf.enAlerte, 1);
  // Aucun score composite : on ne lit que des faits.
  assert.equal(pf.lignes[0].sante, undefined);

  // Un plan non calculable n'est pas masqué : il est compté à part.
  const casse = { p3: plan([t("a", { liens: [{ deId: "b", type: "FD" }] }), t("b", { liens: [{ deId: "a", type: "FD" }] })], { id: "p3", nom: "Cassé", debut: LUNDI }) };
  const pf2 = portefeuille([{ id: "p3", nom: "Cassé", statut: "en_cours" }], casse);
  assert.equal(pf2.nonCalculables, 1);
  assert.equal(pf2.lignes[0].calculable, false);
});

test("PROJET VIDE — pas de plantage, pas de date inventée", () => {
  const p = plan([]);
  assert.equal(p.ok, true);
  assert.equal(p.resume.taches, 0);
  assert.equal(p.resume.fin, LUNDI);
  assert.deepEqual(cheminsCritiques(p), []);
});

// ---------------------------------------------------------------------------
test("REJOUER UN MODÈLE — le modèle donne la forme, la tâche garde le travail", () => {
  const taches = [
    { id: "t1", titre: "Ancien intitulé", dureeJours: 5, modeleRef: "T1", modeleId: "m1",
      statut: "en_cours", resteAFaire: 2, responsable: "Marc", note: "prestataire relancé" },
    { id: "t2", titre: "Déposer", dureeJours: 2, modeleRef: "T2", modeleId: "m1" },
    { id: "t3", titre: "Ajoutée à la main", dureeJours: 1 },
  ];
  const modele = [
    { ref: "T1", titre: "Intitulé corrigé", dureeJours: 8, lot: "Cadrage" },
    { ref: "T2", titre: "Déposer", dureeJours: 4, liens: [{ ref: "T1", type: "FD" }] },
    { ref: "T3", titre: "Nouvelle étape du modèle", dureeJours: 3 },
  ];
  const f = fusionnerModele(taches, modele, { modeleId: "m1" });

  // Appariement par la clé de modèle, qui survit au changement de titre.
  const maj = f.majs.find((x) => x.ref === "T1");
  assert.equal(maj.id, "t1");
  assert.equal(maj.patch.titre, "Intitulé corrigé");
  assert.equal(maj.patch.dureeJours, 8);
  // Ce qu'un humain a mis n'est PAS dans le patch : statut, responsable, note,
  // reste à faire d'une tâche démarrée.
  assert.equal("statut" in maj.patch, false);
  assert.equal("responsable" in maj.patch, false);
  assert.equal("note" in maj.patch, false);
  assert.equal("resteAFaire" in maj.patch, false);
  // Sur une tâche jamais commencée, le reste à faire suit la nouvelle durée.
  assert.equal(f.majs.find((x) => x.ref === "T2").patch.resteAFaire, 4);

  assert.deepEqual(f.ajouts.map((a) => a.titre), ["Nouvelle étape du modèle"]);
  assert.equal(f.conservees, 1);                       // la tâche ajoutée à la main reste
  assert.deepEqual(f.renommees ?? [], []);             // (le résumé des renommages est côté route)
  // Les liens du modèle sont traduits vers les identifiants qui survivent.
  assert.deepEqual(f.liens.find((l) => l.id === "t2").liens, [{ deId: "t1", type: "FD", decalage: 0 }]);
});

test("REJOUER UN MODÈLE — une tâche retirée n'est supprimée que si personne n'y a touché", () => {
  const modele = [{ ref: "T1", titre: "Reste au modèle", dureeJours: 2 }];
  const base = (extra) => [
    { id: "t1", titre: "Reste au modèle", dureeJours: 2, modeleRef: "T1", modeleId: "m1" },
    { id: "t2", titre: "Retirée du modèle", dureeJours: 2, modeleRef: "T9", modeleId: "m1", ...extra },
  ];
  // Intacte : elle part.
  const propre = fusionnerModele(base({}), modele, { modeleId: "m1" });
  assert.deepEqual(propre.supprimables.map((t) => t.id), ["t2"]);
  assert.equal(propre.gardees.length, 0);

  // Travaillée : elle reste. Effacer un travail consigné serait pire qu'un plan
  // un peu long.
  for (const marque of [{ statut: "en_cours" }, { responsable: "Claire" }, { note: "vu en comité" }, { affectations: [{ ressourceId: "r1", tauxJour: 1 }] }]) {
    const f = fusionnerModele(base(marque), modele, { modeleId: "m1" });
    assert.equal(f.supprimables.length, 0, JSON.stringify(marque));
    assert.equal(f.gardees[0].id, "t2");
  }
});

test("REJOUER UN MODÈLE — à défaut de clé, on apparie sur le titre", () => {
  // Plan monté à la main puis rattaché à un modèle : sans cet appariement, tout
  // se dédoublerait.
  const f = fusionnerModele(
    [{ id: "x", titre: "Recenser l'existant", dureeJours: 3, responsable: "Marc" }],
    [{ ref: "T1", titre: "Recenser l'existant", dureeJours: 6 }],
    { modeleId: "m2" },
  );
  assert.equal(f.majs.length, 1);
  assert.equal(f.majs[0].id, "x");
  assert.equal(f.ajouts.length, 0);
  assert.equal(f.majs[0].patch.modeleRef, "T1");
});

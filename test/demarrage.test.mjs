import test from "node:test";
import assert from "node:assert/strict";
import { controler, parEcran, NIVEAUX } from "../lib/demarrage.js";

const complet = {
  campus: { name: "CFA Lumière", siret: "73282932000074", numeroDeclaration: "11 75 12345 75",
    dirigeant: "Mme Martin", address: "1 rue X", referentHandicap: "M. Dupont",
    // `openingHours` et non `hours` : le contrôle regarde ce qui a été DÉCLARÉ.
    // Le champ `hours` était la sortie d'un lecteur qui retombe toujours sur un
    // défaut — s'y fier rendait l'alerte impossible à déclencher.
    openingHours: { lun: [["08:00", "18:00"]] } },
  settings: { planComptable: { client: "411000" }, rgpd: { register: [{ data: "Identité" }] } },
  curricula: [{ id: "c1", name: "BTS", blocks: [{ id: "b1" }] }],
  classes: [{ id: "k1" }],
  teachers: [{ id: "t1", status: "vacataire", tauxHoraire: 40 }],
  users: [{ role: "admin", active: true }, { role: "admin", active: true }],
  licence: { lectureSeule: false },
  qualiopi: { valideJusquau: "2029-06-30" },
  reclamationsOuvertes: 2,
  sauvegardeLe: "2027-01-14",
  aujourdhui: "2027-01-15",
};
const cles = (r) => r.points.map((p) => p.cle);

test("un organisme complet est exploitable, sans rien inventer", () => {
  const r = controler(complet);
  assert.equal(r.exploitable, true);
  assert.equal(r.bloquants, 0);
  assert.deepEqual(r.points, []);
  // On ne dit jamais « conforme ».
  assert.match(r.reserve, /ne vaut pas audit/);
});

test("CHAQUE MANQUE EST RELIÉ À CE QU'IL EMPÊCHE, NOMMÉMENT", () => {
  // « Numéro de déclaration manquant » n'appelle aucune action.
  // « Sans lui, ni le BPF ni le certificat de réalisation ne sont délivrables »
  // en appelle une, tout de suite.
  const r = controler({ ...complet, campus: { ...complet.campus, numeroDeclaration: "" } });
  const p = r.points.find((x) => x.cle === "nda");
  assert.equal(p.niveau, "bloquant");
  assert.match(p.empeche, /BPF/);
  assert.match(p.empeche, /certificat de réalisation/);
  // Et il dit OÙ corriger : un diagnostic sans chemin d'action est ignoré.
  assert.ok(p.ou);
  for (const point of r.points) assert.ok(point.quoi && point.empeche && point.ou);
});

test("identité de l'organisme : ce sont les manques qui bloquent le plus de documents", () => {
  const r = controler({ ...complet, campus: { name: "X" } });
  for (const attendu of ["siret", "nda", "dirigeant"]) {
    assert.ok(cles(r).includes(attendu), `${attendu} non détecté`);
  }
  assert.equal(r.exploitable, false);
  assert.match(r.points.find((x) => x.cle === "siret").empeche, /FEC/);
});

test("QUALIOPI EXPIRÉE : c'est tout le modèle économique qui tombe", () => {
  const r = controler({ ...complet, qualiopi: { valideJusquau: "2026-12-31" } });
  const p = r.points.find((x) => x.cle === "qualiopi_expire");
  assert.equal(p.niveau, "bloquant");
  assert.match(p.empeche, /financements publics et mutualisés/);

  // À l'approche, on prévient : un audit de renouvellement se prépare.
  const bientot = controler({ ...complet, qualiopi: { valideJusquau: "2027-04-01" } });
  assert.ok(cles(bientot).includes("qualiopi_echeance"));
  assert.equal(bientot.exploitable, true, "une échéance n'est pas un blocage");
});

test("SAUVEGARDE : absente ou ancienne, c'est bloquant", () => {
  // C'est la seule panne dont on ne revient pas, et la sauvegarde qui ne tourne
  // plus ne se découvre qu'au moment d'en avoir besoin.
  const absente = controler({ ...complet, sauvegardeLe: null });
  assert.equal(absente.exploitable, false);
  assert.match(absente.points.find((x) => x.cle === "sauvegarde").empeche, /définitive/);

  const ancienne = controler({ ...complet, sauvegardeLe: "2027-01-05" });
  const p = ancienne.points.find((x) => x.cle === "sauvegarde_ancienne");
  assert.equal(p.niveau, "bloquant");
  assert.match(p.quoi, /10 jours/);
});

test("un registre de réclamations vide se signale — ce n'est pas une bonne nouvelle", () => {
  const r = controler({ ...complet, reclamationsOuvertes: 0 });
  const p = r.points.find((x) => x.cle === "reclamations");
  assert.equal(p.niveau, "conseille");
  assert.match(p.empeche, /qu'on ne les enregistre pas/);
  assert.equal(r.exploitable, true, "cela ne bloque pas l'exploitation");
});

test("un seul administrateur actif : une indisponibilité bloque toute la gestion", () => {
  const r = controler({ ...complet, users: [{ role: "admin", active: true }, { role: "admin", active: false }] });
  assert.ok(cles(r).includes("admin_unique"));
  assert.match(r.points.find((x) => x.cle === "admin_unique").empeche, /bloque toute la gestion/);
});

test("référentiels et classes : sans eux, l'application ne peut rien faire", () => {
  const sansRef = controler({ ...complet, curricula: [], classes: [] });
  assert.ok(cles(sansRef).includes("referentiel"));
  assert.ok(cles(sansRef).includes("classes"));
  assert.equal(sansRef.exploitable, false);

  // Un référentiel sans blocs n'empêche pas d'exploiter, mais prive de la
  // certification par blocs.
  const sansBlocs = controler({ ...complet, curricula: [{ id: "c1", name: "BTS", blocks: [] }] });
  const p = sansBlocs.points.find((x) => x.cle === "blocs");
  assert.equal(p.niveau, "important");
  assert.match(p.empeche, /dispenses/);
  assert.equal(sansBlocs.exploitable, true);
});

test("licence en lecture seule : bloquant, mais la lecture reste ouverte", () => {
  const r = controler({ ...complet, licence: { lectureSeule: true } });
  const p = r.points.find((x) => x.cle === "licence");
  assert.equal(p.niveau, "bloquant");
  assert.match(p.empeche, /consultation et l'export restent ouverts/);
});

test("les points sont triés par gravité et regroupés par écran — c'est ainsi qu'on corrige", () => {
  const r = controler({ campus: {}, settings: {}, curricula: [], classes: [], teachers: [], users: [], aujourdhui: "2027-01-15" });
  const poids = r.points.map((p) => NIVEAUX[p.niveau].poids);
  assert.deepEqual(poids, [...poids].sort((a, b) => a - b), "les bloquants d'abord");

  const groupes = parEcran(r);
  assert.ok(groupes.length > 1);
  assert.ok(groupes[0].points.every((p) => p.ou === groupes[0].ecran));
  // Le groupe le plus grave passe en premier.
  assert.equal(groupes[0].points[0].niveau, "bloquant");
});

// UN CONTRÔLE QUI NE PEUT JAMAIS SE DÉCLENCHER NE CONTRÔLE RIEN.
//
// Celui-ci lisait la sortie de getCampusHours(), qui retombe TOUJOURS sur
// 08 h–18 h. La condition ne pouvait donc jamais être vraie : l'alerte n'est
// jamais apparue, et un campus restait sur des horaires par défaut sans que
// personne ne le sache. C'est le symétrique du champ lu mais jamais écrit.
test("les horaires se contrôlent sur ce qui est DÉCLARÉ, pas sur ce que le lecteur renvoie", () => {
  const base = { campus: { name: "X" }, curricula: [{ modules: [{}] }], classes: [{}], teachers: [{}] };

  // Rien de déclaré : l'alerte doit partir, même si un lecteur renverrait un défaut.
  const sans = controler({ ...base, settings: { hours: { lun: [["08:00", "18:00"]] } } });
  assert.ok(sans.points.find((p) => p.cle === "horaires"), "un défaut servi par le lecteur ne vaut pas déclaration");

  // Des horaires réellement déclarés : plus d'alerte.
  const avec = controler({ ...base, settings: { openingHours: { lun: [["09:00", "17:00"]] } } });
  assert.equal(avec.points.some((p) => p.cle === "horaires"), false);

  // Déclarés sur le campus lui-même : même résultat.
  const surCampus = controler({ ...base, campus: { name: "X", openingHours: { mar: [["09:00", "17:00"]] } } });
  assert.equal(surCampus.points.some((p) => p.cle === "horaires"), false);
});

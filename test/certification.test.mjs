// Indicateur 16 — conditions de présentation à la certification.
// Le manquement que ce module existe pour attraper : une habilitation expirée
// AVANT l'épreuve. Deux ans de formation, et personne ne passe.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REGIMES, validateHabilitation, validateSession, etatHabilitation, controlerSession, tableauDeBord,
} from "../lib/certification.js";

const AUJ = "2026-09-15";
const hab = (p = {}) => ({
  regime: "habilitation", certificateur: "Ministère X", reference: "HAB-2024-118",
  dateDebut: "2024-01-01", dateFin: "2028-06-30", exigences: [], ...p,
});

test("une habilitation sans date de fin n'est surveillée par personne", () => {
  const v = validateHabilitation(hab({ dateFin: "" }));
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /date de fin/);
  assert.equal(validateHabilitation(hab({ reference: "" })).ok, false);
  assert.equal(validateHabilitation(hab()).ok, true);
  // L'indicateur porte sur le respect des exigences : ne pas les déclarer est
  // signalé, sans bloquer la saisie.
  assert.match(validateHabilitation(hab()).warnings.join(" "), /exigence formelle/);
});

test("un organisme certificateur lui-même n'a ni référence ni échéance à produire", () => {
  assert.equal(validateHabilitation({ regime: "autorite", exigences: [{ id: "e1", libelle: "x" }] }).ok, true);
  for (const r of Object.values(REGIMES)) assert.ok(r.preuve, "chaque régime doit dire ce qui le prouve");
});

test("préparer sans présenter n'est pas un manquement, mais doit être dit au public", () => {
  const e = etatHabilitation({ regime: "prepare_seulement" }, AUJ);
  assert.equal(e.peutPresenter, false);
  assert.equal(e.etat, "valide");
  assert.equal(e.alertes[0].gravite, "conseille");
  assert.match(e.alertes[0].message, /information au public/);
});

test("rien de déclaré : on ne sait pas si l'organisme peut présenter, et on le dit", () => {
  const e = etatHabilitation({}, AUJ);
  assert.equal(e.etat, "a_declarer");
  assert.equal(e.peutPresenter, null, "ne pas savoir n'est pas la même chose que pouvoir");
  assert.equal(e.alertes[0].gravite, "bloquant");
});

test("expirée ou suspendue : aucun candidat ne peut être présenté", () => {
  const exp = etatHabilitation(hab({ dateFin: "2026-06-30" }), AUJ);
  assert.equal(exp.etat, "expire");
  assert.equal(exp.peutPresenter, false);
  assert.match(exp.alertes[0].message, /promotion entière/);

  const susp = etatHabilitation(hab({ suspendue: true, motifSuspension: "contrôle en cours" }), AUJ);
  assert.equal(susp.peutPresenter, false);
  assert.match(susp.alertes[0].message, /contrôle en cours/);
});

test("l'échéance se signale avant, parce qu'un renouvellement prend du temps", () => {
  const proche = etatHabilitation(hab({ dateFin: "2026-11-30" }), AUJ);
  assert.equal(proche.etat, "valide");
  assert.equal(proche.peutPresenter, true);
  assert.equal(proche.alertes[0].gravite, "important");
  assert.match(proche.alertes[0].message, /76 jour\(s\)/);
  // Loin, on ne dit rien : une alerte permanente ne se lit plus.
  assert.deepEqual(etatHabilitation(hab(), AUJ).alertes, []);
});

// LE TEST CENTRAL.
test("UNE HABILITATION VALABLE AUJOURD'HUI MAIS EXPIRÉE À L'ÉPREUVE EST UN BLOCAGE", () => {
  // Valable jusqu'en mars, épreuve en juin : tout va bien ce matin.
  const c = controlerSession(
    { id: "s1", dateEpreuve: "2027-06-15", dateLimiteInscription: "2027-01-10" },
    hab({ dateFin: "2027-03-31" }), AUJ);
  assert.equal(c.peutPresenter, false);
  const a = c.alertes.find((x) => x.code === "habilitation_expire_avant_epreuve");
  assert.ok(a, "l'habilitation doit être jugée à la date de l'épreuve, pas aujourd'hui");
  assert.equal(a.gravite, "bloquant");
  assert.equal(c.presentable, false);

  // Avec une habilitation qui couvre l'épreuve, plus de blocage de ce chef.
  const ok = controlerSession(
    { id: "s1", dateEpreuve: "2027-06-15", dateLimiteInscription: "2027-01-10" },
    hab(), AUJ);
  assert.equal(ok.peutPresenter, true);
  assert.equal(ok.alertes.some((x) => x.code === "habilitation_expire_avant_epreuve"), false);
});

// Le piège de calendrier, même famille que le guichet de la taxe d'apprentissage.
test("la date limite d'inscription tombe des mois avant l'épreuve, et c'est elle qui alerte", () => {
  // Limite dépassée, rien de déposé : la session est perdue.
  const manquee = controlerSession(
    { dateEpreuve: "2026-12-10", dateLimiteInscription: "2026-08-31" }, hab(), AUJ);
  const m = manquee.alertes.find((x) => x.code === "inscription_manquee");
  assert.equal(m.gravite, "bloquant");
  assert.match(m.message, /ne se rattrape pas/);
  assert.equal(manquee.presentable, false);

  // Déposée à temps : plus rien.
  const faite = controlerSession(
    { dateEpreuve: "2026-12-10", dateLimiteInscription: "2026-08-31", inscriptionFaiteLe: "2026-08-20" }, hab(), AUJ);
  assert.equal(faite.alertes.some((x) => x.code?.startsWith("inscription")), false);
  assert.equal(faite.presentable, true);

  // Déposée après la limite : à vérifier, sans affirmer que c'est refusé.
  const tard = controlerSession(
    { dateEpreuve: "2026-12-10", dateLimiteInscription: "2026-08-31", inscriptionFaiteLe: "2026-09-05" }, hab(), AUJ);
  assert.equal(tard.alertes.find((x) => x.code === "inscription_hors_delai").gravite, "important");

  // Limite inconnue : c'est elle qui conditionne tout.
  const sans = controlerSession({ dateEpreuve: "2027-06-10" }, hab(), AUJ);
  assert.ok(sans.alertes.find((x) => x.code === "limite_inconnue"));
});

test("une exigence du certificateur non confirmée durcit une fois l'épreuve tenue", () => {
  const h = hab({ exigences: [
    { id: "e1", libelle: "Livret de suivi visé par le maître d'apprentissage" },
    { id: "e2", libelle: "Dossier professionnel déposé sur la plateforme" },
  ] });
  const base = { dateEpreuve: "2027-06-15", dateLimiteInscription: "2027-01-10", inscriptionFaiteLe: "2026-12-01" };

  const avant = controlerSession({ ...base, exigencesSatisfaites: { e1: true } }, h, AUJ);
  assert.equal(avant.manquantes, 1);
  const av = avant.alertes.find((x) => x.code === "exigences_non_satisfaites");
  assert.equal(av.gravite, "important");
  assert.match(av.message, /Dossier professionnel/);
  assert.equal(avant.presentable, true, "avant l'épreuve, il reste le temps de la satisfaire");

  // L'épreuve a eu lieu sans que l'exigence soit remplie : ce n'est plus un rappel.
  const apres = controlerSession({ ...base, statut: "tenue", exigencesSatisfaites: { e1: true } }, h, AUJ);
  assert.equal(apres.alertes.find((x) => x.code === "exigences_non_satisfaites").gravite, "bloquant");
  assert.equal(apres.presentable, false);

  // Toutes satisfaites : rien.
  const toutes = controlerSession({ ...base, exigencesSatisfaites: { e1: true, e2: true } }, h, AUJ);
  assert.equal(toutes.manquantes, 0);
  assert.equal(toutes.presentable, true);
});

test("le tableau de bord met en tête ce qui empêche de présenter", () => {
  const t = tableauDeBord([
    { curriculumId: "c1", intitule: "BTS OL", habilitation: hab(), sessions: [] },
    { curriculumId: "c2", intitule: "Titre X", habilitation: hab({ dateFin: "2026-01-01" }), sessions: [] },
    { curriculumId: "c3", intitule: "Non déclaré", habilitation: {}, sessions: [] },
  ], AUJ);
  assert.equal(t.total, 3);
  assert.equal(t.empechees, 1, "seule l'habilitation expirée empêche ; « non déclaré » ne se présume pas");
  assert.equal(t.lignes[0].curriculumId !== "c1", true, "les lignes bloquantes passent devant");
  assert.match(t.reserve, /L'application ne les connaît pas/);
});

test("une session mal datée est refusée avant tout contrôle", () => {
  assert.equal(validateSession({}).ok, false);
  assert.equal(validateSession({ dateEpreuve: "2027-06-10", dateLimiteInscription: "2027-08-01" }).ok, false);
  assert.equal(validateSession({ dateEpreuve: "2027-06-10", dateLimiteInscription: "2027-01-01" }).ok, true);
});

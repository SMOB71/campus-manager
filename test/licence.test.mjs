import test from "node:test";
import assert from "node:assert/strict";
import { licenceState, quotaReport, canWrite, hasModule, PLANS, GRACE_JOURS } from "../lib/licence.js";

test("licence valide : aucune alerte, écriture permise", () => {
  const e = licenceState({ plan: "reseau", validUntil: "2027-06-30", today: "2026-09-07" });
  assert.equal(e.expiree, false);
  assert.equal(e.lectureSeule, false);
  assert.equal(e.alerte, null);
  assert.equal(e.planLabel, "Réseau");
});

test("licence sans échéance : ne s'éteint jamais toute seule", () => {
  // Une instance interne ou une licence perpétuelle ne doit pas se verrouiller
  // parce que personne n'a pensé à renseigner une date.
  const e = licenceState({ plan: "groupe", validUntil: null, today: "2030-01-01" });
  assert.equal(e.joursRestants, null);
  assert.equal(e.expiree, false);
  assert.equal(e.lectureSeule, false);
});

test("expiration : période de grâce d'abord, lecture seule ensuite", () => {
  const veille = licenceState({ plan: "essentiel", validUntil: "2026-09-30", today: "2026-09-25" });
  assert.equal(veille.expiree, false);
  assert.match(veille.alerte, /renouveler dans 5 jour/);

  const jourApres = licenceState({ plan: "essentiel", validUntil: "2026-09-30", today: "2026-10-01" });
  assert.equal(jourApres.expiree, true);
  assert.equal(jourApres.enGrace, true);
  assert.equal(jourApres.lectureSeule, false, "un virement en retard ne bloque pas un CFA du jour au lendemain");
  assert.match(jourApres.alerte, /tolérance/);

  const bienApres = licenceState({ plan: "essentiel", validUntil: "2026-09-30", today: "2026-10-20" });
  assert.equal(bienApres.lectureSeule, true);
});

test("aucun état de licence ne coupe la consultation ni l'export", () => {
  // Les feuilles d'émargement scellées et les contrats sont ce dont le client
  // répond devant un contrôleur : les lui retenir serait indéfendable.
  for (const cas of [{ suspendue: true }, { validUntil: "2020-01-01" }, { plan: "inconnu" }]) {
    const e = licenceState({ ...cas, today: "2026-09-07" });
    assert.equal(e.exportToujoursPossible, true);
    assert.equal(e.consultationToujoursPossible, true);
  }
});

test("plan inconnu : repli sur le plan le plus restrictif, jamais d'ouverture", () => {
  // Une valeur corrompue dans le .env ne doit pas offrir le plan le plus large.
  const e = licenceState({ plan: "premium-illimite", today: "2026-09-07" });
  assert.equal(e.plan, "essentiel");
  assert.equal(e.planInconnu, true);
  assert.equal(hasModule("premium-illimite", "reseau"), false);
});

test("quotas : consommation, seuil d'alerte à 90 %, illimité assumé", () => {
  const r = quotaReport({ plan: "essentiel", usage: { campus: 1, apprenants: 271, utilisateurs: 3 } });
  const apprenants = r.find((q) => q.cle === "apprenants");
  assert.equal(apprenants.plafond, 300);
  assert.equal(apprenants.restant, 29);
  assert.equal(apprenants.proche, true, "prévenir avant le blocage, pas au moment d'inscrire");
  assert.equal(apprenants.depasse, false);
  const campus = r.find((q) => q.cle === "campus");
  assert.equal(campus.depasse, true, "1 campus sur 1 : le plafond est atteint");

  const illimite = quotaReport({ plan: "groupe", usage: { apprenants: 99999 } });
  const a = illimite.find((q) => q.cle === "apprenants");
  assert.equal(a.plafond, null);
  assert.equal(a.depasse, false);
  assert.equal(a.pourcent, null);
});

test("canWrite : refus motivés et lisibles, jamais un 403 muet", () => {
  const base = { plan: "essentiel", validUntil: "2027-01-01", today: "2026-09-07" };

  assert.equal(canWrite({ ...base, ressource: "apprenants", usage: { apprenants: 10 } }).ok, true);

  const quota = canWrite({ ...base, ressource: "apprenants", usage: { apprenants: 300 } });
  assert.equal(quota.ok, false);
  assert.equal(quota.code, "quota_atteint");
  assert.match(quota.error, /300 apprenants/);
  assert.match(quota.error, /données existantes restent accessibles/);

  const module = canWrite({ ...base, moduleId: "reseau" });
  assert.equal(module.ok, false);
  assert.equal(module.code, "module_absent");
  assert.match(module.error, /Essentiel/);

  const morte = canWrite({ plan: "essentiel", validUntil: "2020-01-01", today: "2026-09-07", ressource: "apprenants" });
  assert.equal(morte.ok, false);
  assert.equal(morte.code, "licence_lecture_seule");
});

test("le quota se mesure sur l'existant : le 300e apprenant passe, le 301e non", () => {
  // Erreur classique du >= mal placé : soit on bloque un cran trop tôt et le
  // client paie pour 300 places dont il n'en a que 299, soit un cran trop tard.
  const base = { plan: "essentiel", validUntil: "2027-01-01", today: "2026-09-07", ressource: "apprenants" };
  assert.equal(canWrite({ ...base, usage: { apprenants: 299 } }).ok, true, "le 300e doit pouvoir être créé");
  assert.equal(canWrite({ ...base, usage: { apprenants: 300 } }).ok, false, "le 301e est refusé");
});

test("les plans ne portent pas de prix — la source de vérité tarifaire est Stripe", () => {
  // Un prix dupliqué dans le code diverge tôt ou tard de ce qui est prélevé.
  for (const [id, p] of Object.entries(PLANS)) {
    for (const interdit of ["prix", "price", "montant", "tarif", "amount"]) {
      const trouve = Object.keys(p).find((k) => k.toLowerCase().includes(interdit));
      assert.equal(trouve, undefined, `le plan ${id} ne doit pas porter de prix (${trouve})`);
    }
    assert.ok(p.modules.includes("socle"), `le plan ${id} doit inclure le socle`);
  }
  assert.equal(GRACE_JOURS > 0, true);
});

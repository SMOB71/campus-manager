import test from "node:test";
import assert from "node:assert/strict";
import { risqueDecrochage, tauxAbsenteismeCorrige, classerPromotion, SEUILS_DEFAUT, NIVEAUX } from "../lib/risque.js";

test("aucun signal : aucun risque, et on le dit simplement", () => {
  const r = risqueDecrochage({ tauxAbsenteisme: 4, moyenne: 13, blocsTotal: 3, blocsNonAcquis: 0 });
  assert.equal(r.niveau, "faible");
  assert.equal(r.score, 0);
  assert.deepEqual(r.signaux, []);
  assert.equal(r.resume, "Aucun signal.");
  assert.equal(r.aTraiter, false);
});

test("un score ne se traite pas — ce sont les MOTIFS qui se lisent", () => {
  // « Risque 72 % » n'appelle aucune action. La phrase, si.
  const r = risqueDecrochage({ tauxAbsenteisme: 32, absencesNonJustifiees: 4, moyenne: 8, moyennePrecedente: 12, joursSansSuivi: 210 });
  assert.ok(r.score >= 60);
  assert.equal(r.niveau, "critique");
  assert.equal(r.aTraiter, true);
  const codes = r.signaux.map((s) => s.code);
  for (const attendu of ["absenteisme_critique", "absences_injustifiees", "moyenne_faible", "chute_resultats", "sans_suivi"]) {
    assert.ok(codes.includes(attendu), `signal manquant : ${attendu}`);
  }
  assert.match(r.resume, /32 % d'heures manquées/);
  assert.match(r.resume, /4 absences non justifiées/);
  assert.match(r.resume, /Moyenne passée de 12 à 8/);
  assert.match(r.resume, /depuis 210 jours/);
});

test("un signal isolé ne fait pas un décrochage ; deux signaux concordants, oui", () => {
  const isole = risqueDecrochage({ tauxAbsenteisme: 18, moyenne: 13 });
  assert.equal(isole.signaux.length, 1);
  assert.equal(isole.niveau, "faible", "un absentéisme seul en période d'examens ne veut rien dire");

  // Deux signaux doux qui se croisent : on surveille, on n'alarme pas.
  const doux = risqueDecrochage({ absencesNonJustifiees: 3, joursSansSuivi: 200 });
  assert.equal(doux.signaux.length, 2);
  assert.equal(doux.niveau, "moyen");
  assert.equal(doux.aTraiter, false);

  // Deux signaux sérieux qui se croisent — absentéisme ET moyenne sous le seuil
  // de validation — c'est un dossier à prendre, pas à surveiller.
  const serieux = risqueDecrochage({ tauxAbsenteisme: 18, moyenne: 8 });
  assert.equal(serieux.signaux.length, 2);
  assert.equal(serieux.niveau, "eleve");
  assert.equal(serieux.aTraiter, true);
});

test("une rupture n'est pas un risque de décrochage : c'est un décrochage en cours", () => {
  const seule = risqueDecrochage({ ruptureOuverte: true, moyenne: 13, tauxAbsenteisme: 2 });
  assert.equal(seule.signaux.length, 1);

  const accompagnee = risqueDecrochage({ ruptureOuverte: true, tauxAbsenteisme: 20 });
  assert.equal(accompagnee.niveau, "critique", "rupture + un autre signal = critique, quel que soit le score");
  assert.ok(accompagnee.signaux.some((s) => s.code === "rupture"));

  const sansContrat = risqueDecrochage({ sansContrat: true, moyenne: 8 });
  assert.ok(sansContrat.signaux.some((s) => s.code === "sans_contrat"));
  assert.equal(sansContrat.signaux.some((s) => s.code === "rupture"), false, "les deux ne se cumulent pas");
});

test("ON NE SIGNALE PAS UN FAIT QU'ON A SOI-MÊME PROVOQUÉ : les allègements sortent du calcul", () => {
  // Un apprenant dispensé de suivre un bloc n'est pas absent de ce bloc. Le
  // compter absent alerterait sur quelqu'un de parfaitement à jour — et trois
  // alertes fausses suffisent à faire ignorer toutes les autres.
  const brut = tauxAbsenteismeCorrige({ minutesPrevues: 1000, minutesManquees: 400, minutesAllegees: 0 });
  assert.equal(brut, 40);

  const corrige = tauxAbsenteismeCorrige({ minutesPrevues: 1000, minutesManquees: 400, minutesAllegees: 400 });
  assert.equal(corrige, 0, "les 400 minutes manquées étaient les heures allégées");

  const partiel = tauxAbsenteismeCorrige({ minutesPrevues: 1000, minutesManquees: 500, minutesAllegees: 400 });
  assert.equal(partiel, Math.round((100 / 600) * 1000) / 10);

  // Et l'alerte disparaît une fois corrigée.
  assert.equal(risqueDecrochage({ tauxAbsenteisme: corrige, moyenne: 13 }).niveau, "faible");
});

test("assiduité corrigée : bornes saines, jamais de division par zéro ni de taux > 100", () => {
  assert.equal(tauxAbsenteismeCorrige({ minutesPrevues: 0 }), null);
  assert.equal(tauxAbsenteismeCorrige({ minutesPrevues: 500, minutesAllegees: 500 }), null, "tout allégé : aucun taux à calculer");
  assert.equal(tauxAbsenteismeCorrige({ minutesPrevues: 100, minutesManquees: 999 }), 100);
  assert.equal(tauxAbsenteismeCorrige({ minutesPrevues: 100, minutesManquees: -50 }), 0);
});

test("seuils paramétrables : un CFA du bâtiment n'a pas l'absentéisme d'une école de commerce", () => {
  const donnees = { tauxAbsenteisme: 18, moyenne: 13 };
  assert.equal(risqueDecrochage(donnees).signaux.length, 1);
  assert.equal(risqueDecrochage(donnees, { seuils: { absenteismeAlerte: 25 } }).signaux.length, 0);
  assert.equal(risqueDecrochage({}).seuils.absenteismeAlerte, SEUILS_DEFAUT.absenteismeAlerte);
});

test("classement : on ne traite pas cent dossiers, on traite les premiers", () => {
  const promo = [
    { learnerId: "c", risque: risqueDecrochage({ tauxAbsenteisme: 5 }) },
    { learnerId: "a", risque: risqueDecrochage({ ruptureOuverte: true, tauxAbsenteisme: 35, moyenne: 6 }) },
    { learnerId: "b", risque: risqueDecrochage({ tauxAbsenteisme: 18, moyenne: 8 }) },
  ];
  assert.deepEqual(classerPromotion(promo).map((x) => x.learnerId), ["a", "b", "c"]);
  assert.equal(NIVEAUX.critique, "Critique");
});

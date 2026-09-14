// Bascule du Référentiel National Qualité : 32 indicateurs (décret 2019-565)
// vers 33 (décret 2026-728, applicable au 1er novembre 2026).
//
// Ce qui est vraiment testé ici : que la RENUMÉROTATION ne réattribue pas les
// preuves d'un indicateur à un autre. C'est le seul défaut de cette bascule qui
// serait invisible — un tableau resterait vert en désignant les mauvaises
// exigences, et l'organisme s'en apercevrait le jour de l'audit.
import test from "node:test";
import assert from "node:assert/strict";
import {
  QUALIOPI_V2019, QUALIOPI_V2026, QUALIOPI_VERSIONS, BASCULE_V2026,
  REPRISE_2019_VERS_2026, numerosDe, indicateurDe, versionApplicable,
  preparerBascule, basculer, conformityRate, etatVersion,
} from "../lib/qualiopi.js";

test("les deux référentiels sont complets et numérotés sans trou", () => {
  assert.deepEqual(numerosDe("v2019"), Array.from({ length: 32 }, (_, i) => i + 1));
  assert.deepEqual(numerosDe("v2026"), Array.from({ length: 33 }, (_, i) => i + 1));
  // Sept critères dans les deux cas : c'est ce qui n'a PAS changé.
  assert.equal(QUALIOPI_V2019.length, 7);
  assert.equal(QUALIOPI_V2026.length, 7);
});

// La répartition par critère change — c'est là que naît le piège.
test("la répartition par critère est bien remaniée, pas seulement allongée", () => {
  const parCritere = (ref) => ref.map((c) => c.indicators.length);
  assert.deepEqual(parCritere(QUALIOPI_V2019), [2, 6, 8, 4, 3, 4, 5]);
  assert.deepEqual(parCritere(QUALIOPI_V2026), [3, 5, 8, 4, 2, 7, 4]);
  // Donc un même numéro ne désigne pas le même critère d'une version à l'autre.
  assert.equal(indicateurDe("v2019", 23).critere, 5);
  assert.equal(indicateurDe("v2026", 23).critere, 6);
});

test("la version applicable se déduit de la date, pas d'un réglage", () => {
  assert.equal(versionApplicable("2026-10-31"), "v2019");
  assert.equal(versionApplicable(BASCULE_V2026), "v2026");
  assert.equal(versionApplicable("2027-03-01"), "v2026");
  assert.equal(BASCULE_V2026, "2026-11-01");
});

// LE TEST QUI COMPTE.
test("LA RENUMÉROTATION NE DÉPLACE PAS LES PREUVES SUR LE MAUVAIS INDICATEUR", () => {
  // Sous l'ancien référentiel : 23 = handicap (critère 5), 24 = veille légale.
  const avant = {
    23: { status: "conforme", note: "convention Agefiph + référent formé" },
    24: { status: "conforme", note: "abonnement juridique, revue trimestrielle" },
  };
  const prep = preparerBascule(avant);
  const trouve = (n) => prep.lignes.find((l) => l.n === n);

  // Le handicap est passé au critère 6 sous le numéro 26.
  assert.equal(trouve(26).critere, 6);
  assert.deepEqual(trouve(26).anciens.map((a) => a.n), [23]);
  assert.match(trouve(26).notePropose, /Agefiph/);

  // Et le nouveau 23 est la veille légale, qui portait le numéro 24.
  assert.deepEqual(trouve(23).anciens.map((a) => a.n), [24]);
  assert.match(trouve(23).notePropose, /abonnement juridique/);

  // Surtout : la preuve du handicap ne doit PAS s'être retrouvée sur le 23.
  assert.doesNotMatch(trouve(23).notePropose, /Agefiph/);
});

test("aucune conformité n'est reportée : tout repart à vérifier", () => {
  const avant = Object.fromEntries(numerosDe("v2019").map((n) => [n, { status: "conforme" }]));
  const prep = preparerBascule(avant);
  assert.ok(prep.lignes.every((l) => l.statutPropose === "a_verifier"),
    "un audit 2026 ne se déduit pas d'une conformité 2019");
  const apres = basculer({ indicators: avant, lastAudit: "2025-06-01" });
  assert.equal(apres.version, "v2026");
  assert.equal(conformityRate(apres.indicators, "v2026"), 0);
  // Les notes, elles, se reportent : ce sont des descriptions de preuves.
  const avecNote = basculer({ indicators: { 1: { status: "conforme", note: "plaquette + site" } } });
  assert.match(avecNote.indicators[1].note, /plaquette/);
  // Et l'ancien tableau est conservé : un auditeur peut demander l'historique.
  assert.deepEqual(apres.archiveV2019, avant);
  assert.equal(apres.lastAudit, "2025-06-01", "les métadonnées de certification survivent");
});

test("les trois exigences sans équivalent sont annoncées comme telles", () => {
  const prep = preparerBascule({});
  assert.deepEqual(prep.nouveaux, [16, 29, 33]);
  for (const n of prep.nouveaux) {
    assert.equal(prep.lignes.find((l) => l.n === n).anciens.length, 0);
    assert.equal(REPRISE_2019_VERS_2026[n].confiance, "nouveau");
  }
  // Le 33 est l'ajout du décret : évaluation des enseignements, à ne pas
  // confondre avec l'enquête de satisfaction de l'indicateur 30.
  assert.match(indicateurDe("v2026", 33).l, /contenus et des enseignements/i);
  assert.match(REPRISE_2019_VERS_2026[33].note, /satisfaction/i);
});

test("chaque indicateur 2026 a une correspondance déclarée — aucun oubli silencieux", () => {
  for (const n of numerosDe("v2026")) {
    const r = REPRISE_2019_VERS_2026[n];
    assert.ok(r, `indicateur ${n} sans correspondance déclarée`);
    assert.ok(["directe", "partielle", "nouveau"].includes(r.confiance), `confiance invalide sur ${n}`);
    for (const o of r.depuis) assert.ok(indicateurDe("v2019", o), `l'indicateur 2019 n° ${o} n'existe pas`);
  }
});

// Un indicateur hors périmètre est SANS OBJET, pas non conforme.
test("le périmètre ne pénalise pas un organisme qui ne fait pas d'apprentissage", () => {
  const tout = Object.fromEntries(numerosDe("v2026").map((n) => [n, { status: "conforme" }]));
  // Un organisme de formation seul : les indicateurs « apprentissage » ne le
  // concernent pas. On les retire du calcul au lieu de les compter en échec.
  const sansApp = { ...tout };
  for (const n of [13, 14, 15, 20, 28, 29]) delete sansApp[n];
  assert.equal(conformityRate(sansApp, "v2026", ["af"]), 100);
  // Sans filtre de périmètre, les mêmes données plafonnent sans recours.
  assert.ok(conformityRate(sansApp, "v2026") < 100);
  // Et un CFA, lui, doit bien les traiter.
  assert.ok(conformityRate(sansApp, "v2026", ["af", "app"]) < 100);
});

test("le taux se calcule sur la version de l'enregistrement, pas sur la date du jour", () => {
  const v2019 = Object.fromEntries(numerosDe("v2019").map((n) => [n, { status: "conforme" }]));
  // 32 conformes lus comme du 2019 : 100 %.
  assert.equal(conformityRate(v2019, "v2019"), 100);
  // Les mêmes données lues comme du 2026 : l'indicateur 33 manque. Si le taux
  // basculait tout seul le 1er novembre au matin, il chuterait sans que
  // personne n'ait rien touché — et sans dire pourquoi.
  assert.ok(conformityRate(v2019, "v2026") < 100);
  // Le défaut d'une version absente est l'ancien référentiel : c'est celui sous
  // lequel les enregistrements existants ont été saisis.
  assert.equal(conformityRate(v2019), 100);
});

test("l'échéance du 1er novembre est portée par l'état, avec la bonne gravité", () => {
  const q = { version: "v2019", indicators: {} };
  const avant = etatVersion(q, "2026-09-14");
  // Avant le 1er novembre, suivre le référentiel 2019 EST conforme — c'est un
  // fait, et le nier serait faux. Mais l'alerte tombe quand même : sans période
  // de transition, attendre la date c'est arriver en retard.
  assert.equal(avant.aJour, true);
  assert.equal(avant.alerte.gravite, "important");
  assert.equal(avant.jours, 48);
  assert.match(avant.alerte.message, /renumérotés/);

  // Passée la date, ce n'est plus une échéance à préparer : le tableau affiché
  // ne correspond plus à ce que l'auditeur vérifie.
  const apres = etatVersion(q, "2026-11-15");
  assert.equal(apres.alerte.gravite, "bloquant");

  // Une fois basculé, plus d'alerte.
  assert.equal(etatVersion({ version: "v2026" }, "2026-11-15").aJour, true);
  assert.equal(etatVersion({ version: "v2026" }, "2026-11-15").alerte, null);
});

test("chaque version cite le texte qui la fonde", () => {
  for (const v of Object.values(QUALIOPI_VERSIONS)) {
    assert.match(v.texte, /décret n° \d{4}-\d+/);
    assert.match(v.source, /^https:\/\/www\.legifrance\.gouv\.fr\//);
  }
  assert.match(QUALIOPI_VERSIONS.v2026.texte, /2026-728/);
  assert.equal(QUALIOPI_VERSIONS.v2019.au, "2026-10-31");
  assert.equal(QUALIOPI_VERSIONS.v2026.du, BASCULE_V2026);
});

test("loin de l'échéance, on informe sans alarmer", () => {
  const tot = etatVersion({ version: "v2019" }, "2026-01-10");
  assert.equal(tot.aJour, true);
  assert.equal(tot.alerte.gravite, "conseille");
  assert.doesNotMatch(tot.alerte.message, /jour\(s\)/, "pas de compte à rebours à dix mois");
});

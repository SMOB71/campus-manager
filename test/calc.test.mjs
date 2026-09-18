import test from "node:test";
import assert from "node:assert/strict";
import {
  marginOf, healthScore, schoolYearRange, extractPnlPostes,
  buildOpeningTasks, buildOpeningBudget, OPENING_TEMPLATE, OPENING_LOTS, OPENING_FAMILIES, dateMoinsJours,
} from "../lib/calc.js";

test("marginOf = CA - masse salariale - charges", () => {
  assert.equal(marginOf({ revenue: 100000, payroll: 40000, charges: 20000 }), 40000);
  assert.equal(marginOf({ revenue: 100000 }), 100000);
  assert.equal(marginOf({ payroll: 10 }), null);
  assert.equal(marginOf(null), null);
});

test("healthScore : cas parfait = 100", () => {
  const { score, detail } = healthScore({ occupancy: 100, qualiopi: 100, overdue: 0, visitDue: false, satisfaction: 10, openIncidents: 0 });
  assert.equal(score, 100);
  assert.equal(detail.length, 6);
});

test("healthScore : pondération correcte (Qualiopi 0, 2 retards, visite due)", () => {
  // parts : qualiopi[.30,0] actions[.15,60] visites[.10,50] incidents[.05,100] ; w=.60
  // (0 + 9 + 5 + 5)/0.60 = 31.67 -> 32
  const { score } = healthScore({ qualiopi: 0, overdue: 2, visitDue: true, openIncidents: 0 });
  assert.equal(score, 32);
});

test("healthScore : detail trié pire -> meilleur", () => {
  const { detail } = healthScore({ occupancy: 90, qualiopi: 20, overdue: 0, visitDue: false });
  for (let i = 1; i < detail.length; i++) assert.ok(detail[i].score >= detail[i - 1].score);
  assert.equal(detail[0].label, "Qualiopi"); // 20 = le plus bas
});

test("schoolYearRange : avant septembre -> année précédente", () => {
  const a = schoolYearRange(new Date("2026-07-15"));
  assert.equal(a.startY, 2025);
  assert.equal(a.from, "2025-09");
  assert.equal(a.to, "2026-08");
  const b = schoolYearRange(new Date("2026-10-15"));
  assert.equal(b.startY, 2026);
});

test("extractPnlPostes : parse le bloc json + convertit les montants", () => {
  const content = 'Analyse…\n```json\n{"postes":{"month":"2026-06","revenue":[{"label":"Scolarité","amount":1000}],"payroll":[],"charges":[{"label":"Loyer","amount":"250"}]}}\n```';
  const p = extractPnlPostes(content);
  assert.equal(p.month, "2026-06");
  assert.equal(p.revenue.length, 1);
  assert.equal(p.revenue[0].amount, 1000);
  assert.equal(p.charges[0].amount, 250); // string -> number
  assert.equal(typeof p.charges[0].amount, "number");
});

test("extractPnlPostes : pas de bloc -> null", () => {
  assert.equal(extractPnlPostes("aucun bloc json ici"), null);
  assert.equal(extractPnlPostes('```json\n{"kpis":[]}\n```'), null); // pas de postes
});

test("buildOpeningTasks : dates à rebours de la rentrée", () => {
  const tasks = buildOpeningTasks("2027-09-06");
  assert.equal(tasks.length, OPENING_TEMPLATE.length);
  assert.ok(tasks.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)));
  const m15 = tasks.find((t) => t.title.startsWith("Étude de marché"));
  assert.equal(m15.offset, Math.round(15 * 30.4)); // 456 j
  assert.ok(m15.dueDate < "2027-09-06");
  assert.equal(buildOpeningTasks("date-invalide").length, 0);
});

test("OPENING_FAMILIES est déduit du modèle, pas recopié", () => {
  // Une liste parallèle finirait par diverger : le jour où une commande est ajoutée
  // au modèle sans sa famille, le délai saisi ne s'appliquerait plus à rien.
  const cmd = OPENING_TEMPLATE.filter((t) => t.family);
  assert.equal(OPENING_FAMILIES.length, cmd.length);
  assert.ok(cmd.every((t) => t.needM != null && t.m > t.needM), "toute commande a une date de livraison requise, antérieure à la commande");
  assert.equal(new Set(OPENING_FAMILIES.map((f) => f.k)).size, OPENING_FAMILIES.length, "clefs uniques");
  assert.ok(OPENING_FAMILIES.every((f) => f.defaultLeadWeeks > 0));
});

test("délai fournisseur réel : la commande remonte depuis la livraison requise", () => {
  const fam = OPENING_FAMILIES.find((f) => f.k === "refraction");
  const base = buildOpeningTasks("2027-09-06");
  const lent = buildOpeningTasks("2027-09-06", { leadTimes: [{ family: "refraction", leadWeeks: 30, supplier: "Essilor" }] });
  const rapide = buildOpeningTasks("2027-09-06", { leadTimes: [{ family: "refraction", leadWeeks: 6 }] });
  const cmd = (ts) => ts.find((t) => t.title.startsWith("COMMANDE postes de réfraction"));
  // 30 semaines > défaut du modèle → il faut commander PLUS TÔT ; 6 semaines → plus tard.
  assert.ok(cmd(lent).dueDate < cmd(base).dueDate, "délai long avance la commande");
  assert.ok(cmd(rapide).dueDate > cmd(base).dueDate, "délai court la retarde");
  assert.ok(cmd(lent).title.includes("Essilor"), "le fournisseur est porté sur la tâche");
  // Ancrage sur la livraison requise, pas sur le m du modèle : 30 sem. avant M−1.5.
  assert.equal(cmd(lent).offset, Math.round((fam.needM + 30 / 4.345) * 30.4));
  // Un délai absent ou nul ne doit rien déplacer : sinon une ligne à moitié saisie
  // ferait silencieusement glisser une date critique.
  assert.equal(cmd(buildOpeningTasks("2027-09-06", { leadTimes: [{ family: "refraction", supplier: "X" }] })).offset, cmd(base).offset);
});

test("seuil budgétaire : insère la validation AVANT la commande, au palier le plus exigeant", () => {
  const cfg = {
    thresholds: [{ label: "Réseau", minAmount: 20000, approver: "Dir. réseau", leadDays: 15 },
                 { label: "DG", minAmount: 100000, approver: "DG", leadDays: 45 }],
    leadTimes: [{ family: "refraction", leadWeeks: 20, amount: 145000 },
                { family: "mobilier", leadWeeks: 10, amount: 38000 },
                { family: "fournitures", leadWeeks: 2, amount: 900 }],
  };
  const ts = buildOpeningTasks("2027-09-06", cfg);
  const val = ts.filter((t) => t.title.startsWith("Validation budgétaire"));
  assert.equal(val.length, 2, "900 € ne franchit aucun seuil");
  const dg = val.find((t) => t.title.includes("« DG »"));
  assert.ok(dg, "145 000 € relève du palier DG, pas du palier Réseau");
  assert.equal(dg.owner, "DG");
  assert.equal(dg.lot, "finance");
  assert.ok(dg.critical);
  const cmd = ts.find((t) => t.title.startsWith("COMMANDE postes de réfraction"));
  assert.ok(dg.dueDate < cmd.dueDate, "la validation précède la commande");
  // Être datée avant ne suffit pas : sans dépendance, la validation flottait à côté de la
  // commande, invisible pour le calcul de chaîne, et un retard dessus ne poussait rien.
  assert.ok(cmd.dependsOn.includes(dg.id), "la commande est bloquée par sa validation");
  // Identifiants stables d'une génération à l'autre, sinon réappliquer les paramètres
  // recrée des doublons au lieu de retrouver la tâche existante.
  assert.equal(dg.tplKey, "val-refraction");
  assert.deepEqual(buildOpeningTasks("2027-09-06", cfg).map((t) => t.id), ts.map((t) => t.id));
  assert.equal(dg.offset - cmd.offset, Math.round((20 / 4.345 + 1.5 + 45 / 30.4) * 30.4) - cmd.offset);
  // Sans montant, pas de validation : on ne fabrique pas un jalon sur une hypothèse.
  assert.equal(buildOpeningTasks("2027-09-06", { thresholds: cfg.thresholds, leadTimes: [{ family: "refraction", leadWeeks: 20 }] })
    .filter((t) => t.title.startsWith("Validation budgétaire")).length, 0);
});

test("jalons de convention réseau : ajoutés, datés, jamais substitués au modèle", () => {
  const ts = buildOpeningTasks("2027-09-06", {
    milestones: [{ title: "Validation du dossier par le comité réseau", lot: "gouv", m: 13, critical: true, owner: "Dir. réseau" },
                 { title: "   ", m: 5 }],
  });
  assert.equal(ts.length, OPENING_TEMPLATE.length + 1, "le jalon vide est ignoré, le modèle reste entier");
  const j = ts.find((t) => t.title === "Validation du dossier par le comité réseau");
  assert.equal(j.offset, Math.round(13 * 30.4));
  assert.equal(j.owner, "Dir. réseau");
  assert.ok(j.critical);
  // m = 0 est une valeur valide (jalon le jour de la rentrée), pas un « non renseigné ».
  const j0 = buildOpeningTasks("2027-09-06", { milestones: [{ title: "Jour J", m: 0 }] }).find((t) => t.title === "Jour J");
  assert.equal(j0.dueDate, "2027-09-06");
});

test("dates en UTC : l'aller-retour date ↔ offset est exact des deux côtés d'un changement d'heure", () => {
  // `setDate(getDate() - n)` opère en heure LOCALE sur une date parsée en UTC : passée
  // une bascule été/hiver, le résultat recule d'un jour. Symptôme observé en production :
  // après « recalculer les échéances », onze tâches d'un plan sain redevenaient en retard
  // et la rentrée glissait d'un jour, sans que rien n'ait changé.
  assert.equal(dateMoinsJours("2027-12-10", 0), "2027-12-10");
  assert.equal(dateMoinsJours("2027-12-10", 60), "2027-10-11");   // hiver → été
  assert.equal(dateMoinsJours("2027-06-15", 120), "2027-02-15");   // été → hiver
  for (const cible of ["2027-09-01", "2028-09-04", "2027-12-10", "2028-03-26"]) {
    for (const t of buildOpeningTasks(cible)) {
      const offset = Math.round((new Date(cible) - new Date(t.dueDate)) / 86400000);
      assert.equal(dateMoinsJours(cible, offset), t.dueDate, `dérive sur « ${t.title} » (${cible})`);
      assert.equal(t.offset, offset, `offset incohérent avec l'échéance sur « ${t.title} »`);
    }
  }
});

test("buildOpeningBudget : répartit le total par lot", () => {
  const b = buildOpeningBudget(500000);
  assert.equal(b.length, OPENING_LOTS.length);
  assert.equal(b.find((x) => x.lot === "travaux").planned, 200000);
  const sum = b.reduce((s, x) => s + x.planned, 0);
  assert.ok(Math.abs(sum - 500000) <= OPENING_LOTS.length); // tolérance arrondi
  assert.deepEqual(buildOpeningBudget(0), []);
});

// --- Portée des règles de validation ---
// `objectif` vaut un nombre d'inscrits en admissions, mais une phrase dans un plan
// d'action. Borné globalement, il rejetait toute action dont l'objectif était rempli.
test("validateBody : les champs ambigus ne sont bornés que sur leurs routes numériques", async () => {
  const { validateBody } = await import("../lib/validators.js");

  // texte libre accepté là où le champ est rédactionnel
  assert.equal(validateBody({ objectif: "Ouvrir en septembre" }, "/api/actions").ok, true);
  assert.equal(validateBody({ objectif: "Sécuriser le bail" }, "/api/committees").ok, true);

  // toujours borné là où il est numérique
  assert.equal(validateBody({ objectif: 150 }, "/api/campuses/x1/admissions").ok, true);
  assert.equal(validateBody({ objectif: 999999 }, "/api/campuses/x1/admissions").ok, false);
  assert.equal(validateBody({ objectif: "beaucoup" }, "/api/campuses/x1/admissions").ok, false);
  assert.equal(validateBody({ attendees: "plein" }, "/api/events").ok, false);
  assert.equal(validateBody({ confidence: 180 }, "/api/campuses/x1/director-review").ok, false);

  // les champs non ambigus restent bornés partout
  assert.equal(validateBody({ occupancy: 150 }, "/api/actions").ok, false);
  assert.equal(validateBody({ occupancy: 80 }, "/api/actions").ok, true);
});

// --- Intégrité du modèle type d'ouverture ---
// Une dépendance qui pointe vers une clef inexistante ne casse rien à
// l'exécution : elle est simplement ignorée, et l'enchaînement qu'on croyait
// avoir posé n'existe pas. C'est le genre de défaut qu'on ne voit jamais.
test("le modèle d'ouverture n'a ni clef en double ni dépendance orpheline", async () => {
  const { OPENING_TEMPLATE, OPENING_LOTS } = await import("../lib/calc.js");
  const cles = OPENING_TEMPLATE.filter((t) => t.key).map((t) => t.key);
  assert.equal(new Set(cles).size, cles.length, "deux tâches ne peuvent pas partager une clef");

  const orphelines = [...new Set(OPENING_TEMPLATE.flatMap((t) => t.after || []))]
    .filter((a) => !cles.includes(a));
  assert.deepEqual(orphelines, [], "une dépendance vers une clef inexistante est ignorée en silence");

  // Chaque tâche appartient à un lot déclaré, sinon elle disparaît de l'écran.
  const lots = new Set(OPENING_LOTS.map((l) => l.k));
  for (const t of OPENING_TEMPLATE) {
    assert.ok(lots.has(t.lot), `lot inconnu « ${t.lot} » sur « ${t.title} »`);
    assert.ok(String(t.title || "").trim(), "tâche sans intitulé");
    assert.equal(typeof t.m, "number", `échéance manquante sur « ${t.title} »`);
  }
});

// Les exigences reglementaires outillees dans l'application doivent exister
// dans le modele : sinon l'ouverture se prepare sans elles.
test("le modèle porte les échéances réglementaires qui ne se rattrapent pas", async () => {
  const { OPENING_TEMPLATE } = await import("../lib/calc.js");
  const titres = OPENING_TEMPLATE.map((t) => t.title).join(" | ").toLowerCase();
  for (const attendu of ["soltéa", "opérateur de compétences", "sifa", "préétabli", "délégués", "enquête"]) {
    assert.ok(titres.includes(attendu.toLowerCase()), `« ${attendu} » absent du modèle d'ouverture`);
  }
  // Le guichet de la taxe ferme quatre mois avant la campagne : la tâche doit
  // être posée tôt, pas au printemps.
  const taxe = OPENING_TEMPLATE.find((t) => t.key === "taxe-hab");
  assert.ok(taxe.m >= 8, `habilitation taxe posée à M-${taxe.m} : trop tard, le guichet aura fermé`);
  assert.equal(taxe.critical, true);
});

// --- Recalibrage de la durée du plan ----------------------------------------
test("recalibrer : seul l'amont se comprime, la chaîne contrainte ne bouge pas", async () => {
  const { recalibrer, OPENING_PIVOT, OPENING_DUREE_REF } = await import("../lib/calc.js");
  // Au-delà du pivot (déclaration au recteur), les délais sont subis : trois mois
  // d'opposition légale ne deviennent pas deux mois parce qu'on vise une ouverture
  // plus courte. Un recalibrage qui les toucherait produirait un plan infaisable.
  for (const m of [OPENING_PIVOT, 9, 6, 3, 1, 0, -1]) {
    assert.equal(recalibrer(m, 12), m, `M${m} est en aval du pivot : il ne doit pas bouger`);
  }
  // L'amont, lui, se comprime : 4,5 mois deviennent 1,5 mois pour un plan de 12 mois.
  assert.equal(recalibrer(OPENING_DUREE_REF, 12), 12, "la première action cale sur la durée visée");
  assert.equal(recalibrer(12, 12), 11, "M−12 se resserre à M−11");
  assert.ok(recalibrer(14, 12) < 14 && recalibrer(14, 12) > OPENING_PIVOT);
});

test("recalibrer : ordre préservé, et aucune durée ne passe sous le plancher d'amont", async () => {
  const { recalibrer, OPENING_DUREE_REF, OPENING_PIVOT, OPENING_AMONT_MIN } = await import("../lib/calc.js");
  const amont = [15, 14.5, 14, 13, 12, 11.5, 11, 10.75];
  for (const duree of [14, 12, 10, 6, 1]) {
    const vus = amont.map((m) => recalibrer(m, duree));
    for (let i = 1; i < vus.length; i++) {
      assert.ok(vus[i] <= vus[i - 1], `l'ordre des échéances doit tenir (durée ${duree})`);
    }
    // Comprimer l'amont à zéro ferait démarrer l'étude de marché le jour de la signature
    // du bail : on garde un plancher.
    assert.ok(Math.max(...vus) >= OPENING_PIVOT + OPENING_AMONT_MIN - 0.01, `plancher tenu (durée ${duree})`);
  }
  // Une durée égale ou supérieure au modèle ne touche à rien.
  for (const m of amont) assert.equal(recalibrer(m, OPENING_DUREE_REF), m);
  for (const m of amont) assert.equal(recalibrer(m, 18), m);
});

test("buildOpeningTasks : un plan de 12 mois tient en 12 mois, sans perdre d'action", async () => {
  const { buildOpeningTasks, OPENING_PIVOT } = await import("../lib/calc.js");
  const ref = buildOpeningTasks("2028-09-04");
  const court = buildOpeningTasks("2028-09-04", {}, 12);
  assert.equal(court.length, ref.length, "recalibrer ne supprime ni n'ajoute d'action");

  const mois = (t) => t.offset / 30.44;
  assert.ok(Math.max(...court.map(mois)) <= 12.2, "la première échéance ne précède pas M−12");
  assert.ok(Math.max(...ref.map(mois)) > 14, "le plan de référence, lui, part bien de M−15");

  // Les actions en aval du pivot gardent leur date au jour près.
  const parClef = new Map(ref.filter((t) => t.tplKey).map((t) => [t.tplKey, t]));
  let compares = 0;
  for (const t of court) {
    if (!t.tplKey || mois(t) > OPENING_PIVOT) continue;
    const r = parClef.get(t.tplKey);
    if (!r) continue;
    assert.equal(t.dueDate, r.dueDate, `${t.title} est en aval du pivot et ne doit pas bouger`);
    compares += 1;
  }
  assert.ok(compares > 80, `on doit comparer l'essentiel du plan (${compares} tâches)`);
});

test("un délai fournisseur réel ignore le recalibrage : 30 semaines restent 30 semaines", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const cfg = { leadTimes: [{ family: "refraction", leadWeeks: 30, supplier: "Essilor" }] };
  const cmd = (ts) => ts.find((t) => /COMMANDE postes de réfraction/.test(t.title));
  assert.equal(cmd(buildOpeningTasks("2028-09-04", cfg, 12)).offset,
               cmd(buildOpeningTasks("2028-09-04", cfg)).offset,
               "la date de commande se calcule à rebours de la livraison, pas de la durée visée");
});

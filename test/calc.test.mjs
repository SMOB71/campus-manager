import test from "node:test";
import assert from "node:assert/strict";
import {
  marginOf, healthScore, schoolYearRange, extractPnlPostes,
  buildOpeningTasks, buildOpeningBudget, OPENING_TEMPLATE, OPENING_LOTS, OPENING_FAMILIES,
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

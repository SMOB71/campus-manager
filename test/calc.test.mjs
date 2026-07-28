import test from "node:test";
import assert from "node:assert/strict";
import {
  marginOf, healthScore, schoolYearRange, extractPnlPostes,
  buildOpeningTasks, buildOpeningBudget, OPENING_TEMPLATE, OPENING_LOTS,
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

test("buildOpeningBudget : répartit le total par lot", () => {
  const b = buildOpeningBudget(500000);
  assert.equal(b.length, OPENING_LOTS.length);
  assert.equal(b.find((x) => x.lot === "travaux").planned, 200000);
  const sum = b.reduce((s, x) => s + x.planned, 0);
  assert.ok(Math.abs(sum - 500000) <= OPENING_LOTS.length); // tolérance arrondi
  assert.deepEqual(buildOpeningBudget(0), []);
});

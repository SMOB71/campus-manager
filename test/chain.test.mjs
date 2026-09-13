import test from "node:test";
import assert from "node:assert/strict";
import { analyseChain } from "../lib/chain.js";
import { buildOpeningTasks, OPENING_TEMPLATE } from "../lib/calc.js";

// Graphe minimal : A -> B -> C, puis la rentrée. Dates espacées de 10 jours.
const plan = (over = {}) => [
  { id: "A", title: "A", lot: "gouv", dueDate: "2027-01-01", status: "todo", dependsOn: [], ...(over.A || {}) },
  { id: "B", title: "B", lot: "gouv", dueDate: "2027-01-11", status: "todo", dependsOn: ["A"], ...(over.B || {}) },
  { id: "C", title: "C", lot: "gouv", dueDate: "2027-01-21", status: "todo", dependsOn: ["B"], ...(over.C || {}) },
];
const CTX = { targetDate: "2027-02-01", today: "2027-01-01" };

test("marge = glissement possible sans repousser la rentrée, partagé par la chaîne", () => {
  const a = analyseChain(plan(), CTX);
  // Les écarts A→B→C (10 j chacun) sont des DÉLAIS, pas du jeu : le seul jeu réel est
  // l'écart entre la fin de la chaîne et la rentrée, et il est commun à toute la chaîne.
  assert.equal(a.byId.A.slack, 11);
  assert.equal(a.byId.B.slack, 11);
  assert.equal(a.byId.C.slack, 11);
  assert.equal(a.byId.A.blocks, 1);
  assert.equal(a.byId.A.downstream, 2); // B et C
  assert.equal(a.slip, 0);
});

test("un retard décale bien l'aval, mais ne coûte rien s'il tient dans la marge", () => {
  // Distinction qui fait tout l'intérêt du calcul : le retard de A DÉCALE B de 6 jours
  // (B héritera), et pourtant il ne COÛTE rien, parce que la chaîne atterrit encore avant
  // la rentrée. Confondre les deux, c'est soit alerter sur tout, soit n'alerter sur rien.
  const a = analyseChain(plan(), { ...CTX, today: "2027-01-07" });
  assert.equal(a.byId.A.ownDelay, 6);
  assert.equal(a.byId.B.ownDelay, 0, "B n'est pas échue");
  assert.equal(a.byId.B.inherited, 6, "mais elle est décalée d'autant");
  assert.equal(a.slip, 0);
  assert.equal(a.ruptures.length, 1, "seule A est en retard d'elle-même");
  assert.equal(a.ruptures[0].cost, 0, "coût nul : 6 j de décalage pour 11 j de marge");
});

test("un retard non soldé se propage : les écarts du modèle sont des délais", () => {
  // A a 25 j de retard. B ne peut pas se faire le jour même : le modèle dit qu'il faut
  // 10 jours entre les deux. Traiter cet écart comme du jeu libre — l'erreur corrigée —
  // faisait qu'un plan avec 42 tâches en retard s'affichait à l'heure.
  const a = analyseChain(plan(), { ...CTX, today: "2027-01-26" });
  assert.equal(a.byId.A.ownDelay, 25);
  assert.equal(a.byId.A.projected, "2027-01-26", "au plus tôt : aujourd'hui");
  assert.equal(a.byId.B.projected, "2027-02-05", "10 jours après A, pas avant");
  assert.equal(a.byId.C.projected, "2027-02-15");
  assert.equal(a.slip, 14, "C atterrit 14 j après la rentrée du 1er février");
  assert.equal(a.path[0], "A", "la chaîne remonte à la tâche qui cause le glissement");
});

test("tant que la chaîne tient avant la rentrée, rien ne glisse", () => {
  // 6 j de retard : C atterrit le 27 janvier, avant la rentrée du 1er février.
  const a = analyseChain(plan(), { ...CTX, today: "2027-01-07" });
  assert.equal(a.byId.C.projected, "2027-01-27");
  assert.equal(a.slip, 0);
});

test("une tâche faite EN RETARD pousse quand même : c'est à ça que sert doneAt", () => {
  // Seul cas où un retard se propage vers une tâche encore À VENIR : la tâche amont est
  // soldée, mais soldée tard. Sans doneAt, la cocher effaçait le retard.
  const tasks = [
    { id: "A", title: "A", lot: "gouv", dueDate: "2027-01-01", status: "done", doneAt: "2027-02-10", dependsOn: [] },
    { id: "B", title: "B", lot: "gouv", dueDate: "2027-01-31", status: "todo", dependsOn: ["A"] },
  ];
  const tard = analyseChain(tasks, { targetDate: "2027-06-01", today: "2027-01-05" });
  assert.equal(tard.byId.A.ownDelay, 40);
  assert.equal(tard.byId.B.ownDelay, 0, "B n'est pas encore échue");
  assert.equal(tard.byId.B.projected, "2027-03-12", "30 jours après A, qui a fini le 10 février");
  assert.equal(tard.byId.B.inherited, 40, "B subit le retard de A sans en avoir le moindre");
  // Sans doneAt, cocher la tâche effaçait le retard et les suivantes repartaient à zéro.
  const sans = analyseChain(tasks.map((t) => (t.id === "A" ? { ...t, doneAt: null } : t)), { targetDate: "2027-06-01", today: "2027-01-05" });
  assert.equal(sans.byId.A.ownDelay, 0);
  assert.equal(sans.byId.B.inherited, 0);
  // Repasser à « à faire » purge l'horodatage côté store ; ici on vérifie juste que
  // le calcul retombe sur la date du jour et non sur un doneAt fossile.
  const rouvert = analyseChain(plan({ A: { status: "doing", doneAt: null } }), { ...CTX, today: "2027-01-05" });
  assert.equal(rouvert.byId.A.ownDelay, 4);
});

test("les ruptures sont classées par coût, pas par ancienneté du retard", () => {
  const tasks = [
    // 40 jours de retard mais aucune tâche en aval et 50 j de marge → coût nul.
    { id: "vieux", title: "Vieux retard isolé", lot: "gouv", dueDate: "2026-12-01", status: "todo", dependsOn: [] },
    // 5 jours de retard seulement, mais marge nulle et une tâche en aval → coût réel.
    { id: "goulot", title: "Goulot", lot: "immo", dueDate: "2027-01-05", status: "todo", dependsOn: [] },
    { id: "apres", title: "Après le goulot", lot: "immo", dueDate: "2027-01-20", status: "todo", dependsOn: ["goulot"] },
  ];
  const a = analyseChain(tasks, { targetDate: "2027-01-20", today: "2027-01-10" });
  assert.equal(a.byId.vieux.ownDelay, 40);
  assert.equal(a.byId.vieux.slack, 50);
  assert.equal(a.byId.goulot.slack, 0);
  assert.equal(a.ruptures[0].id, "goulot", "le goulot passe devant le vieux retard inoffensif");
  assert.equal(a.ruptures[0].cost, 5);
  assert.equal(a.ruptures.find((r) => r.id === "vieux").cost, 0);
});

test("une dépendance circulaire est signalée et contournée, jamais fatale", () => {
  const tasks = [
    { id: "X", title: "X", lot: "gouv", dueDate: "2027-01-01", status: "todo", dependsOn: ["Y"] },
    { id: "Y", title: "Y", lot: "gouv", dueDate: "2027-01-11", status: "todo", dependsOn: ["X"] },
  ];
  const a = analyseChain(tasks, CTX);
  assert.equal(a.cycles.length, 1);
  assert.equal(a.datees, 2, "le calcul aboutit malgré le cycle");
  assert.ok(Number.isFinite(a.slip));
});

test("les tâches postérieures à la rentrée ne fabriquent pas de glissement fantôme", () => {
  // Le modèle contient un bilan d'ouverture à M+1 : le rattacher à la rentrée donnait
  // une marge négative, donc un glissement de 30 jours sur un plan parfaitement à jour.
  assert.ok(OPENING_TEMPLATE.some((t) => t.m < 0), "le modèle a bien des tâches post-rentrée");
  const tasks = buildOpeningTasks("2028-09-04");
  const a = analyseChain(tasks, { targetDate: "2028-09-04", today: "2026-09-12" });
  assert.equal(a.slip, 0);
  assert.equal(a.ruptures.length, 0);
  const bilan = tasks.find((t) => t.dueDate > "2028-09-04");
  assert.equal(a.byId[bilan.id].slack, null, "marge indéfinie, pas négative");
});

test("chaîne du modèle : acyclique, cohérente dans le temps, et finit au jour J", () => {
  const tasks = buildOpeningTasks("2028-09-04");
  const by = new Map(tasks.map((t) => [t.id, t]));
  // Aucune dépendance ne doit remonter le temps : ce serait un plan infaisable, et le
  // calcul de marge produirait des valeurs négatives partout en aval.
  for (const t of tasks) {
    for (const p of t.dependsOn) {
      assert.ok(by.has(p), `dépendance orpheline sur « ${t.title} »`);
      assert.ok(by.get(p).dueDate <= t.dueDate, `« ${by.get(p).title} » (${by.get(p).dueDate}) est après « ${t.title} » (${t.dueDate})`);
    }
  }
  const a = analyseChain(tasks, { targetDate: "2028-09-04", today: "2026-09-12" });
  assert.equal(a.cycles.length, 0);
  assert.ok(a.path.length > 10, "la chaîne la plus tendue traverse le projet");
  // Elle doit passer par les verrous réels d'une ouverture d'ERP scolaire.
  const titres = a.path.map((id) => by.get(id).title).join(" | ");
  for (const attendu of ["ARRÊTÉ D'OUVERTURE DU MAIRE", "Passage de la commission de sécurité", "Pré-rentrée"]) {
    assert.ok(titres.includes(attendu), `la chaîne doit passer par « ${attendu} » — obtenu : ${titres}`);
  }
});

test("toutes les clefs de modèle sont uniques et tous les `after` résolvent", () => {
  const clefs = OPENING_TEMPLATE.filter((t) => t.key).map((t) => t.key);
  assert.equal(new Set(clefs).size, clefs.length, "clefs de modèle dupliquées");
  const connues = new Set(clefs);
  for (const t of OPENING_TEMPLATE) {
    for (const a of t.after || []) assert.ok(connues.has(a), `« ${t.title} » dépend de la clef inconnue « ${a} »`);
    if (t.after?.length) assert.ok(t.key, `« ${t.title} » déclare after sans key`);
  }
  // Les identifiants générés doivent être uniques : un doublon ferait qu'une dépendance
  // pointe vers la mauvaise tâche, en silence.
  const ids = buildOpeningTasks("2028-09-04").map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

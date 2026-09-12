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

test("marge = jours jusqu'à la première tâche qui attend, pas jusqu'à la rentrée", () => {
  const a = analyseChain(plan(), CTX);
  assert.equal(a.byId.A.slack, 10);
  assert.equal(a.byId.B.slack, 10);
  assert.equal(a.byId.C.slack, 11); // C n'a pas de suivante → marge jusqu'à la rentrée
  assert.equal(a.byId.A.blocks, 1);
  assert.equal(a.byId.A.downstream, 2); // B et C
  assert.equal(a.slip, 0);
});

test("un retard sous la marge est absorbé : rien ne glisse", () => {
  // A a 6 jours de retard pour 10 jours de marge → B n'est pas touchée.
  const a = analyseChain(plan(), { ...CTX, today: "2027-01-07" });
  assert.equal(a.byId.A.ownDelay, 6);
  assert.equal(a.byId.B.inherited, 0);
  assert.equal(a.slip, 0);
  assert.equal(a.ruptures.length, 1);
  assert.equal(a.ruptures[0].cost, 0, "coût nul : le retard tient dans la marge");
});

test("un retard non soldé ne se propage pas au-delà d'aujourd'hui : c'est volontaire", () => {
  // Propriété du modèle, et non un oubli : une tâche non faite peut, au plus tôt, être
  // soldée AUJOURD'HUI. Si son retard dépasse la marge, c'est que la suivante est elle
  // aussi déjà dépassée — son retard propre couvre alors le même nombre de jours, et
  // l'annoncer deux fois gonflerait artificiellement le glissement.
  const a = analyseChain(plan(), { ...CTX, today: "2027-01-26" });
  assert.equal(a.byId.A.ownDelay, 25);
  assert.equal(a.byId.B.ownDelay, 15);
  assert.equal(a.byId.B.inherited, 0);
  assert.equal(a.byId.B.shift, 15);
  // Ce qui alerte tôt, c'est le COÛT par tâche : retard au-delà de sa propre marge.
  assert.equal(a.ruptures[0].cost, 15);
});

test("le glissement de la rentrée ne se déclare que quand les marges sont mangées", () => {
  // Tant qu'il reste du jeu en aval, un retard est absorbé — et le dire serait faux.
  assert.equal(analyseChain(plan(), { ...CTX, today: "2027-01-26" }).slip, 0);
  // Une fois le jeu consommé, il sort, et la chaîne remonte à la tâche qui le cause.
  const b = analyseChain(plan(), { ...CTX, today: "2027-02-10" });
  assert.ok(b.slip > 0);
  assert.equal(b.path[0], "A");
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
  assert.equal(tard.byId.B.inherited, 10, "40 j de retard amont − 30 j de marge");
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
    // 40 jours de retard mais aucune tâche en aval et beaucoup de marge → coût nul.
    { id: "vieux", title: "Vieux retard isolé", lot: "gouv", dueDate: "2026-12-01", status: "todo", dependsOn: [] },
    // 5 jours de retard, marge nulle, 1 tâche en aval → coût réel.
    { id: "goulot", title: "Goulot", lot: "immo", dueDate: "2027-01-05", status: "todo", dependsOn: [] },
    { id: "apres", title: "Après le goulot", lot: "immo", dueDate: "2027-01-05", status: "todo", dependsOn: ["goulot"] },
  ];
  const a = analyseChain(tasks, { targetDate: "2027-06-01", today: "2027-01-10" });
  assert.equal(a.byId.vieux.ownDelay, 40);
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

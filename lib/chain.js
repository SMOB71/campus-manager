// Chaîne d'un rétroplanning : marge, propagation du retard, glissement de la rentrée.
// Logique PURE (aucune I/O, aucune horloge implicite) — `today` et `targetDate` sont
// passés, donc tout est testable sans geler le temps.
//
// POURQUOI CE FICHIER EXISTE
// `dependsOn` était stocké et saisissable depuis le début, mais rien ne le lisait : un
// rétroplanning restait une liste de 161 dates indépendantes. Or ce qu'un chef de projet
// a besoin de savoir n'est pas « quelles tâches sont en retard » — ça, un tri par date le
// donne — mais « de combien ce retard repousse la rentrée, et par quelle chaîne ».
//
// MODÈLE. Les écarts entre jalons du modèle NE SONT PAS du jeu : ce sont des délais.
// Commande → livraison, c'est le délai fournisseur ; déclaration au recteur → expiration
// de l'opposition, trois mois de droit ; demande de visite → passage de la commission, un
// mois de convocation ; démarrage → achèvement du chantier, la durée des travaux. Les
// traiter comme de la marge libre menait à une absurdité démontrable : un retard non soldé
// ne pouvait JAMAIS repousser la rentrée avant qu'on ne l'ait dépassée, puisque la tâche
// suivante, elle aussi échue, « absorbait » le même retard. Un plan avec 42 tâches en
// retard, dont une de 165 jours, s'affichait à l'heure.
//
// On applique donc la méthode du chemin critique avec les écarts du modèle pour durées :
//   passe avant   → date de fin projetée de chaque tâche, puis glissement de la rentrée ;
//   passe arrière → date limite de chaque tâche, d'où la MARGE TOTALE (combien elle peut
//                   glisser sans repousser la rentrée) et le chemin critique (marge nulle).
// L'arête virtuelle vers la rentrée porte un délai NUL : une tâche sans suivante doit être
// faite avant la rentrée, elle ne « dure » pas jusqu'à elle.

const J = 86400000;
const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / J);
const RENTREE = "__rentree__";

// Un retard ne se propage que s'il dépasse la marge. Une tâche de 3 jours de retard qui
// a 10 jours d'avance sur la suivante ne pousse rien — la confondre avec un vrai
// glissement noierait les alertes réelles sous le bruit.
const pousse = (retard, marge) => Math.max(0, retard - marge);

/**
 * @param {Array} tasks  tâches d'une ouverture (id, dueDate, status, doneAt, dependsOn)
 * @param {{targetDate: string, today: string}} ctx
 */
export function analyseChain(tasks = [], { targetDate = "", today = "" } = {}) {
  const vide = { byId: {}, slip: 0, landing: targetDate, ruptures: [], cycles: [], path: [], datees: 0 };
  const items = (tasks || []).filter((t) => t?.id && t.dueDate);
  if (!items.length || !targetDate || !today) return vide;

  const byId = new Map(items.map((t) => [t.id, t]));
  // On ne garde que les arêtes dont les DEUX bouts existent et sont datées : une
  // dépendance vers une tâche supprimée ou sans date ferait diverger tout le calcul.
  const preds = new Map(items.map((t) => [t.id, (t.dependsOn || []).filter((p) => byId.has(p) && p !== t.id)]));

  // --- Cycles. L'utilisateur peut en créer un à la main dans la fiche de tâche (A après
  // B, B après A). On ne plante pas et on ne boucle pas : on coupe l'arête fermante, on
  // la signale, et on calcule sur le graphe restant. Un rétroplanning à moitié faux qui
  // dit où il est faux vaut mieux qu'une page blanche.
  const cycles = [];
  {
    const etat = new Map(); // 0 = en cours, 1 = fini
    const pile = [];
    const visite = (n) => {
      etat.set(n, 0); pile.push(n);
      for (const p of [...(preds.get(n) || [])]) {
        if (etat.get(p) === 0) {
          cycles.push([...pile.slice(pile.indexOf(p)), p].map((x) => byId.get(x)?.title || x));
          preds.set(n, preds.get(n).filter((x) => x !== p));
        } else if (etat.get(p) === undefined) visite(p);
      }
      pile.pop(); etat.set(n, 1);
    };
    for (const t of items) if (etat.get(t.id) === undefined) visite(t.id);
  }

  const succs = new Map(items.map((t) => [t.id, []]));
  for (const t of items) for (const p of preds.get(t.id)) succs.get(p).push(t.id);

  // Toute tâche sans suivante déclarée débouche sur la rentrée : c'est la seule
  // hypothèse qui fait qu'un retard de fin de projet compte. Elle est conservatrice —
  // la marge jusqu'à la rentrée est large, donc un retard lointain ne déclenche rien.
  const dateDe = (n) => (n === RENTREE ? targetDate : byId.get(n).dueDate);
  // …SAUF celles qui tombent APRÈS la rentrée (bilan d'ouverture, revue de fin de projet,
  // bilan pédagogique annuel). Les faire remonter vers la rentrée produisait une marge
  // négative et donc un glissement fantôme de 30 jours sur un plan parfaitement à jour.
  // « Après la rentrée » est une propriété du MODÈLE (offset négatif : bilan d'ouverture,
  // revue de fin de projet), pas une propriété de la date du jour. Se fier à la date
  // rendait le dépassement invisible dès qu'un plan rebasé débordait la rentrée : ses
  // derniers jalons, passés de l'autre côté, sortaient du calcul et le glissement
  // retombait à zéro — exactement l'information qu'on cherchait à voir.
  const posterieure = (t) => (t.afterOpening != null ? t.afterOpening
    : t.offset != null ? t.offset < 0 : t.dueDate > targetDate);
  const predsRentree = items.filter((t) => !succs.get(t.id).length && !posterieure(t)).map((t) => t.id);
  const apresRentree = (n) => !succs.get(n).length && posterieure(byId.get(n));

  // Ordre topologique (Kahn). Le graphe est acyclique : les cycles ont été coupés.
  const reste = new Map(items.map((t) => [t.id, preds.get(t.id).length]));
  const file = items.filter((t) => !reste.get(t.id)).map((t) => t.id);
  const ordre = [];
  while (file.length) {
    const n = file.shift(); ordre.push(n);
    for (const s of succs.get(n)) { reste.set(s, reste.get(s) - 1); if (reste.get(s) === 0) file.push(s); }
  }

  // --- Fin projetée. Une tâche non soldée ne peut, au plus tôt, l'être qu'AUJOURD'HUI ;
  // une tâche soldée l'a été à sa date réelle. Sans `doneAt`, cocher une tâche faite trois
  // semaines en retard effaçait le retard et ses suivantes repartaient à zéro.
  const finDe = (t) => (t.status === "done" ? (t.doneAt || t.dueDate) : (t.dueDate > today ? t.dueDate : today));
  const decale = (d, n) => new Date(new Date(d).getTime() + n * J).toISOString().slice(0, 10);

  const tot = new Map(), viaQui = new Map();
  for (const n of ordre) {
    const t = byId.get(n);
    let d = finDe(t), src = null;
    // Une tâche déjà soldée est soldée : ses amont ne la repoussent plus.
    if (t.status !== "done") {
      for (const q of preds.get(n)) {
        const v = decale(tot.get(q), jours(dateDe(q), dateDe(n)));
        if (v > d) { d = v; src = q; }
      }
    }
    tot.set(n, d); viaQui.set(n, src);
  }
  let slip = 0, slipSrc = null, landing = targetDate;
  for (const q of predsRentree) {
    if (tot.get(q) > landing) landing = tot.get(q);
    const v = jours(targetDate, tot.get(q));
    if (v > slip) { slip = v; slipSrc = q; }
  }

  // --- Passe arrière : date limite, donc marge totale. Les tâches postérieures à la
  // rentrée n'ont aucune limite qui les contraigne : marge indéfinie, pas négative.
  const limite = new Map();
  for (const n of [...ordre].reverse()) {
    const sc = succs.get(n);
    if (!sc.length) { limite.set(n, apresRentree(n) ? null : targetDate); continue; }
    let lim = null;
    for (const x of sc) {
      const lx = limite.get(x);
      if (lx == null) continue;
      const v = decale(lx, -jours(dateDe(n), dateDe(x)));
      if (lim == null || v < lim) lim = v;
    }
    limite.set(n, lim);
  }

  // --- Aval transitif : « 14 tâches dépendent de celle-ci » pèse plus lourd, pour un
  // arbitrage, que « 2 tâches en dépendent directement ».
  const aval = new Map();
  for (const n of [...ordre].reverse()) {
    const set = new Set();
    for (const x of succs.get(n)) { set.add(x); for (const y of aval.get(x) || []) set.add(y); }
    aval.set(n, set);
  }

  const out = {};
  for (const t of items) {
    const lim = limite.get(t.id);
    const glissement = Math.max(0, jours(t.dueDate, tot.get(t.id)));
    const propre = Math.max(0, jours(t.dueDate, t.status === "done" ? (t.doneAt || t.dueDate) : today));
    out[t.id] = {
      slack: lim == null ? null : jours(t.dueDate, lim),   // marge TOTALE avant de toucher la rentrée
      blocks: succs.get(t.id).length,
      downstream: aval.get(t.id).size,
      ownDelay: propre,
      shift: glissement,
      inherited: Math.max(0, glissement - propre),
      projected: tot.get(t.id),
      via: viaQui.get(t.id) || null,
    };
  }

  // --- Chaîne à afficher. Quand ça glisse, celle qui le DÉTERMINE (on remonte les
  // `via`). Sinon le chemin critique, de marge minimale : c'est là que le prochain
  // retard coûtera, et nulle part ailleurs.
  const path = [];
  {
    let n = slipSrc;
    if (!n) {
      let best = null;
      for (const q of predsRentree) {
        const m = out[q]?.slack;
        if (m != null && (!best || m < best.m)) best = { id: q, m };
      }
      n = best?.id || null;
    }
    const vus = new Set();
    while (n && !vus.has(n)) {
      vus.add(n); path.unshift(n);
      if (viaQui.get(n)) { n = viaQui.get(n); continue; }
      let best = null;
      for (const q of preds.get(n) || []) {
        const m = out[q]?.slack;
        if (m != null && (!best || m < best.m)) best = { id: q, m };
      }
      n = best?.id || null;
    }
  }

  // --- Ruptures : les tâches en retard, classées par ce qu'elles COÛTENT en aval, pas
  // par leur ancienneté. Un retard de 40 jours sans suivante importe moins qu'un retard
  // de 5 jours sur une tâche à marge nulle dont 20 autres dépendent.
  const ruptures = items
    .filter((t) => out[t.id].ownDelay > 0)
    .map((t) => ({
      id: t.id, title: t.title, lot: t.lot, dueDate: t.dueDate, owner: t.owner || "",
      ownDelay: out[t.id].ownDelay, slack: out[t.id].slack,
      cost: out[t.id].slack == null ? 0 : pousse(out[t.id].shift, out[t.id].slack),
      downstream: out[t.id].downstream,
    }))
    .sort((a, b) => b.cost - a.cost || b.downstream - a.downstream || b.ownDelay - a.ownDelay);

  return { byId: out, slip, landing, ruptures, cycles, path, datees: items.length };
}

// --- Rebasage ---------------------------------------------------------------
// Un rétroplanning calculé à rebours d'une rentrée trop proche naît avec des tâches déjà
// échues. Les laisser en rouge n'aide personne : ce qu'il faut, c'est un calendrier
// exécutable à partir d'AUJOURD'HUI. La passe avant le donne déjà — la date projetée de
// chaque tâche EST sa première date réalisable, puisqu'elle respecte à la fois « pas avant
// aujourd'hui » et les délais du modèle.
//
// Deux principes :
//  • une tâche déjà soldée garde sa date (on ne réécrit pas ce qui a eu lieu) ;
//  • une tâche qui n'était pas en retard et dont aucun amont ne bouge garde sa date aussi.
//    C'est ce qui distingue un rebasage d'un décalage en bloc : seul ce qui doit bouger bouge.
export function planRebase(tasks = [], { targetDate = "", today = "" } = {}) {
  const a = analyseChain(tasks, { targetDate, today });
  const moved = [];
  for (const t of tasks) {
    const c = a.byId[t.id];
    if (!c || t.status === "done" || !c.projected || c.projected === t.dueDate) continue;
    moved.push({ id: t.id, title: t.title, lot: t.lot, from: t.dueDate, to: c.projected, days: jours(t.dueDate, c.projected) });
  }
  moved.sort((x, y) => y.days - x.days || x.to.localeCompare(y.to));
  return {
    moved, count: moved.length,
    maxShift: moved.length ? moved[0].days : 0,
    landing: a.landing, slip: a.slip, targetDate,
    // Combien étaient échues avant rebasage : c'est le retard qu'on solde.
    overdue: a.ruptures.length,
  };
}

// Applique le rebasage. `offset` (jours avant la rentrée) est la source de vérité quand
// l'utilisateur change la date de rentrée et demande un recalcul : le laisser périmé
// ferait silencieusement annuler le rebasage au prochain « recalculer les échéances ».
export function applyRebase(tasks = [], { targetDate = "", today = "", moveTarget = false } = {}) {
  const plan = planRebase(tasks, { targetDate, today });
  const parId = new Map(plan.moved.map((m) => [m.id, m.to]));
  const cible = moveTarget && plan.slip > 0 ? plan.landing : targetDate;
  const base = new Date(cible);
  const out = tasks.map((t) => {
    const due = parId.get(t.id) || t.dueDate;
    if (!due) return t;
    const offset = Math.round((base - new Date(due)) / J);
    return { ...t, dueDate: due, offset };
  });
  return { ...plan, tasks: out, targetDate: cible, movedTarget: cible !== targetDate };
}

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
// MODÈLE. Les tâches sont des JALONS (durée nulle, une date d'échéance posée par un
// expert), pas des activités avec une durée à ordonnancer. Le CPM classique, qui déduit
// les dates des durées, ne s'applique donc pas : ici les dates sont la donnée d'entrée et
// la marge est l'écart entre une tâche et la première qui l'attend. C'est ce qu'on calcule.

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
  const vide = { byId: {}, slip: 0, ruptures: [], cycles: [], path: [], datees: 0 };
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
  const predsRentree = items.filter((t) => !succs.get(t.id).length && t.dueDate <= targetDate).map((t) => t.id);
  const apresRentree = (n) => !succs.get(n).length && byId.get(n).dueDate > targetDate;

  // Ordre topologique (Kahn). Le graphe est acyclique : les cycles ont été coupés.
  const reste = new Map(items.map((t) => [t.id, preds.get(t.id).length]));
  const file = items.filter((t) => !reste.get(t.id)).map((t) => t.id);
  const ordre = [];
  while (file.length) {
    const n = file.shift(); ordre.push(n);
    for (const s of succs.get(n)) { reste.set(s, reste.get(s) - 1); if (reste.get(s) === 0) file.push(s); }
  }

  // --- Retard propre. Une tâche faite EN RETARD compte : sans `doneAt`, la cocher
  // effaçait le retard et ses suivantes repartaient à zéro.
  const retardPropre = (t) => {
    if (t.status === "done") return t.doneAt ? Math.max(0, jours(t.dueDate, t.doneAt)) : 0;
    return Math.max(0, jours(t.dueDate, today));
  };

  // --- Passe avant : glissement de chaque tâche, puis de la rentrée.
  const shift = new Map(), viaQui = new Map();
  for (const n of ordre) {
    const t = byId.get(n);
    let s = retardPropre(t), src = null;
    for (const p of preds.get(n)) {
      const v = pousse(shift.get(p) || 0, jours(dateDe(p), dateDe(n)));
      if (v > s) { s = v; src = p; }
    }
    shift.set(n, s); viaQui.set(n, src);
  }
  let slip = 0, slipSrc = null;
  for (const p of predsRentree) {
    const v = pousse(shift.get(p) || 0, jours(dateDe(p), targetDate));
    if (v > slip) { slip = v; slipSrc = p; }
  }

  // --- Marge : jours jusqu'à la PREMIÈRE tâche qui attend celle-ci.
  const margeDe = (n) => {
    const s = succs.get(n);
    // Une tâche postérieure à la rentrée n'a aucune échéance qui l'attend : sa marge est
    // indéfinie, pas négative. Retourner un nombre négatif la ferait passer pour la plus
    // contrainte du plan alors qu'elle ne contraint rien.
    if (!s.length && apresRentree(n)) return null;
    const cibles = s.length ? s : [RENTREE];
    return Math.min(...cibles.map((c) => jours(dateDe(n), dateDe(c))));
  };

  // --- Aval transitif : « 14 tâches dépendent de celle-ci » pèse plus lourd, pour un
  // arbitrage, que « 2 tâches en dépendent directement ».
  const aval = new Map();
  for (const n of [...ordre].reverse()) {
    const set = new Set();
    for (const s of succs.get(n)) { set.add(s); for (const x of aval.get(s) || []) set.add(x); }
    aval.set(n, set);
  }

  const out = {};
  for (const t of items) {
    const marge = margeDe(t.id);
    out[t.id] = {
      slack: marge,
      blocks: succs.get(t.id).length,
      downstream: aval.get(t.id).size,
      ownDelay: retardPropre(t),
      shift: shift.get(t.id) || 0,
      // Hérité = ce qu'une tâche subit du fait des autres, au-delà de son propre retard.
      inherited: Math.max(0, (shift.get(t.id) || 0) - retardPropre(t)),
      via: viaQui.get(t.id) || null,
    };
  }

  // --- Chaîne à afficher. Quand ça glisse, celle qui DÉTERMINE le glissement (on
  // remonte les `via`). Quand rien ne glisse, la plus tendue (marge minimale à chaque
  // pas) : c'est là que le prochain retard fera mal.
  const path = [];
  {
    let n = slip > 0 ? slipSrc : null;
    if (!n) {
      let best = null;
      for (const p of predsRentree) {
        const m = jours(dateDe(p), targetDate);
        if (!best || m < best.m) best = { id: p, m };
      }
      n = best?.id || null;
    }
    const vus = new Set();
    while (n && !vus.has(n)) {
      vus.add(n); path.unshift(n);
      if (slip > 0 && viaQui.get(n)) { n = viaQui.get(n); continue; }
      let best = null;
      for (const p of preds.get(n) || []) {
        const m = jours(dateDe(p), dateDe(n));
        if (!best || m < best.m) best = { id: p, m };
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
      cost: out[t.id].slack == null ? 0 : pousse(out[t.id].ownDelay, out[t.id].slack),
      downstream: out[t.id].downstream,
    }))
    .sort((a, b) => b.cost - a.cost || b.downstream - a.downstream || b.ownDelay - a.ownDelay);

  return { byId: out, slip, ruptures, cycles, path, datees: items.length };
}

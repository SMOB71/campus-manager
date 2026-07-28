// Bornes de validation métier.
// But : empêcher qu'une saisie aberrante (taux 150 %, effectif négatif, texte…) soit écrite
// dans le store et casse silencieusement les calculs dérivés (score de santé, %, agrégats).
// On borne ; le store se charge ensuite de la coercition Number.

// champ : [min, max, entier?]
const RULES = {
  students: [0, 100000, true],
  capacity: [0, 100000, true],
  occupancy: [0, 100],
  satisfaction: [0, 10],
  successRate: [0, 100],
  insertionRate: [0, 100],
  qualiopi: [0, 100],
  revenue: [0, 1e12],
  revenueBudget: [0, 1e12],
  payroll: [0, 1e12],
  charges: [0, 1e12],
  margin: [-1e12, 1e12],
  alternants: [0, 100000, true],
  alternantsObjectif: [0, 100000, true],
  visitCadenceMonths: [1, 60, true],
  objectif: [0, 100000, true],
  candidatures: [0, 1000000, true],
  entretiens: [0, 1000000, true],
  admis: [0, 1000000, true],
  inscrits: [0, 1000000, true],
  confidence: [0, 100],
  target: [0, 1000000, true],
  attendees: [0, 1000000, true],
  leads: [0, 1000000, true],
};

// Vérifie tous les champs présents dans `body` qui ont une règle connue.
// Ignore les champs vides (null / "") : effacement autorisé.
// Retourne { ok:true } ou { ok:false, error:"…" }.
export function validateBody(body) {
  if (!body || typeof body !== "object") return { ok: true };
  for (const [f, raw] of Object.entries(body)) {
    const rule = RULES[f];
    if (!rule) continue;
    if (raw === "" || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `Champ « ${f} » : valeur numérique attendue.` };
    const [min, max, int] = rule;
    if (n < min || n > max) return { ok: false, error: `Champ « ${f} » : doit être compris entre ${min} et ${max}.` };
    if (int && !Number.isInteger(n)) return { ok: false, error: `Champ « ${f} » : nombre entier attendu.` };
  }
  return { ok: true };
}

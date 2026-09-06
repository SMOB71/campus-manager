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

// Certains noms de champ sont numériques sur une route et du texte libre sur une autre.
// `objectif` vaut un nombre d'inscrits visés en admissions, mais c'est une phrase dans le
// plan d'action (structure Objectif / Moyen / Mesures) et dans les fiches de comité.
// Les borner globalement rejetait toute action dont l'objectif était renseigné, en 400
// « valeur numérique attendue » — le formulaire restait bloqué sans explication.
// On ne les applique donc que sur les routes où ils sont réellement des nombres.
const AMBIGUOUS = {
  objectif: [/^\/api\/campuses\/[^/]+\/admissions$/],
  confidence: [/^\/api\/campuses\/[^/]+\/director-review$/],
  target: [/^\/api\/events\b/, /^\/api\/scenarios\b/],
  attendees: [/^\/api\/events\b/],
  leads: [/^\/api\/events\b/],
};

// Vérifie tous les champs présents dans `body` qui ont une règle connue.
// Ignore les champs vides (null / "") : effacement autorisé.
// `path` (optionnel) restreint les champs ambigus ci-dessus à leurs routes numériques.
// Retourne { ok:true } ou { ok:false, error:"…" }.
export function validateBody(body, path = "") {
  if (!body || typeof body !== "object") return { ok: true };
  for (const [f, raw] of Object.entries(body)) {
    const rule = RULES[f];
    if (!rule) continue;
    const only = AMBIGUOUS[f];
    if (only && !only.some((re) => re.test(path))) continue;
    if (raw === "" || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `Champ « ${f} » : valeur numérique attendue.` };
    const [min, max, int] = rule;
    if (n < min || n > max) return { ok: false, error: `Champ « ${f} » : doit être compris entre ${min} et ${max}.` };
    if (int && !Number.isInteger(n)) return { ok: false, error: `Champ « ${f} » : nombre entier attendu.` };
  }
  return { ok: true };
}

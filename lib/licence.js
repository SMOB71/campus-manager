// Licence et quotas d'une instance cliente — logique pure (aucune I/O).
//
// LA DÉCISION QUI STRUCTURE TOUT LE MODULE — que se passe-t-il quand une licence
// expire ou qu'un quota est dépassé ?
//
// Un ERP de formation détient les données dont le client répond devant un
// contrôleur : feuilles d'émargement scellées, contrats d'alternance, factures,
// bulletins. Couper l'accès à ces données parce qu'un prélèvement a échoué, ce
// serait empêcher un organisme de justifier son activité — un moyen de pression
// qui se retourne contre lui au premier contrôle, et contre nous ensuite.
//
// La règle est donc :
//   • licence expirée  → LECTURE SEULE. On bloque les écritures, jamais la
//     consultation, et JAMAIS l'export : le client récupère ses données à tout
//     moment, y compris impayé, y compris après résiliation.
//   • quota dépassé    → on bloque la CRÉATION de nouveaux éléments de la
//     ressource saturée. Le reste de l'application continue de fonctionner.
//
// Aucun état de licence ne supprime ni ne dégrade des données existantes.
//
// Les PRIX ne sont pas ici : la source de vérité tarifaire est Stripe. Un prix
// dupliqué dans le code finit toujours par diverger de ce qui est réellement
// facturé. Les plans ne définissent que des LIMITES et des MODULES.

export const MODULES = {
  socle: "Pilotage, campus, documents, journal d'audit",
  pedagogie: "Emploi du temps, émargement scellé, notes et bulletins",
  alternance: "Contrats d'alternance, Cerfa, entreprises et tuteurs",
  facturation: "Financements, factures, avoirs, règlements",
  declarations: "SIFA, BPF, exports réglementaires",
  portails: "Portails apprenant, tuteur, enseignant, représentant légal",
  reseau: "Consolidation multi-campus, heatmap, arbitrages CODIR",
  ia: "Assistant, briefs, comptes rendus et notes de cadrage",
};

// `null` = pas de plafond. Un plafond à 0 n'existe pas : ce serait un module
// désactivé, et cela se dit avec `modules`, pas avec un quota.
export const PLANS = {
  essentiel: {
    label: "Essentiel",
    cible: "Un organisme mono-site",
    campusMax: 1, apprenantsMax: 300, utilisateursMax: 10,
    modules: ["socle", "pedagogie", "alternance", "facturation", "declarations", "portails"],
  },
  reseau: {
    label: "Réseau",
    cible: "Plusieurs campus pilotés ensemble",
    campusMax: 10, apprenantsMax: 2000, utilisateursMax: 60,
    modules: ["socle", "pedagogie", "alternance", "facturation", "declarations", "portails", "reseau", "ia"],
  },
  groupe: {
    label: "Groupe",
    cible: "Réseau national, volumétrie non bornée",
    campusMax: null, apprenantsMax: null, utilisateursMax: null,
    modules: Object.keys(MODULES),
  },
};

export const PLAN_IDS = Object.keys(PLANS);

// Ressources soumises à quota : le libellé sert les messages d'erreur, qui sont
// lus par un utilisateur, pas par un développeur.
export const QUOTAS = [
  { cle: "campus", plafond: "campusMax", label: "campus", pluriel: "campus" },
  { cle: "apprenants", plafond: "apprenantsMax", label: "apprenant", pluriel: "apprenants" },
  { cle: "utilisateurs", plafond: "utilisateursMax", label: "utilisateur", pluriel: "utilisateurs" },
];

const jour = 864e5;
const isoDay = (d) => d.toISOString().slice(0, 10);

export function daysUntil(dateISO, todayISO) {
  if (!dateISO) return null;
  const a = new Date(todayISO + "T00:00:00Z"), b = new Date(dateISO + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / jour);
}

// État courant de la licence. `validUntil` est la date de fin de la période
// payée ; on tolère un délai de grâce, parce qu'un virement en retard ou une
// carte à renouveler ne doit pas bloquer un CFA un lundi matin.
export const GRACE_JOURS = 15;

export function licenceState({ plan = "essentiel", validUntil = null, suspendue = false, today = null } = {}) {
  const jourRef = today || isoDay(new Date());
  const def = PLANS[plan] || PLANS.essentiel;
  const restants = daysUntil(validUntil, jourRef);
  // Sans date de fin, la licence ne s'éteint pas d'elle-même : une instance
  // interne ou une licence perpétuelle ne doit pas se verrouiller par oubli.
  const expiree = restants != null && restants < 0;
  const horsGrace = restants != null && restants < -GRACE_JOURS;
  const lectureSeule = suspendue || horsGrace;
  return {
    plan: PLANS[plan] ? plan : "essentiel",
    planLabel: def.label,
    planInconnu: !PLANS[plan],
    validUntil, joursRestants: restants,
    expiree, enGrace: expiree && !horsGrace,
    graceJours: GRACE_JOURS,
    suspendue,
    lectureSeule,
    // Ce qui reste vrai dans TOUS les cas, et qu'on affiche pour qu'il n'y ait
    // aucun doute côté client.
    exportToujoursPossible: true,
    consultationToujoursPossible: true,
    alerte: lectureSeule
      ? (suspendue ? "Instance suspendue — lecture seule. Vos données restent consultables et exportables."
        : `Licence expirée depuis plus de ${GRACE_JOURS} jours — lecture seule. Vos données restent consultables et exportables.`)
      : expiree ? `Licence expirée — période de tolérance, ${GRACE_JOURS + restants} jour(s) avant passage en lecture seule.`
      : restants != null && restants <= 30 ? `Licence à renouveler dans ${restants} jour(s).`
      : null,
    modules: def.modules,
  };
}

export function hasModule(plan, moduleId) {
  const def = PLANS[plan] || PLANS.essentiel;
  return def.modules.includes(moduleId);
}

// Photographie des quotas : ce qui est consommé, le plafond, et ce qui reste.
export function quotaReport({ plan = "essentiel", usage = {} } = {}) {
  const def = PLANS[plan] || PLANS.essentiel;
  return QUOTAS.map((q) => {
    const plafond = def[q.plafond];
    const utilise = Number(usage[q.cle]) || 0;
    return {
      cle: q.cle, label: q.pluriel, utilise, plafond,
      restant: plafond == null ? null : Math.max(0, plafond - utilise),
      depasse: plafond != null && utilise >= plafond,
      // Un seuil d'alerte permet de prévenir AVANT le blocage : découvrir le
      // plafond au moment d'inscrire un apprenant, c'est le découvrir trop tard.
      proche: plafond != null && utilise >= Math.floor(plafond * 0.9) && utilise < plafond,
      pourcent: plafond == null ? null : Math.min(100, Math.round((utilise / plafond) * 100)),
    };
  });
}

// Autorisation d'une écriture. Renvoyer un motif lisible fait partie du contrat :
// « 403 » sans explication transforme un plafond commercial en bug perçu.
export function canWrite({ plan = "essentiel", validUntil = null, suspendue = false, today = null, usage = {}, ressource = null, moduleId = null } = {}) {
  const etat = licenceState({ plan, validUntil, suspendue, today });
  if (etat.lectureSeule) {
    return { ok: false, code: "licence_lecture_seule", error: etat.alerte, etat };
  }
  if (moduleId && !hasModule(etat.plan, moduleId)) {
    return {
      ok: false, code: "module_absent",
      error: `Le module « ${MODULES[moduleId] || moduleId} » n'est pas inclus dans le plan ${etat.planLabel}.`,
      etat,
    };
  }
  if (ressource) {
    const q = quotaReport({ plan: etat.plan, usage }).find((x) => x.cle === ressource);
    if (q && q.depasse) {
      return {
        ok: false, code: "quota_atteint",
        error: `Plafond du plan ${etat.planLabel} atteint : ${q.plafond} ${q.label}. Les données existantes restent accessibles.`,
        etat, quota: q,
      };
    }
  }
  return { ok: true, etat };
}

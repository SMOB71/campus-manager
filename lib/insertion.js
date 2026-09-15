// Actions d'insertion professionnelle et de poursuite d'études — indicateur 29
// du référentiel 2026 (décret n° 2026-728). Logique pure.
//
// L'EXIGENCE : « Le prestataire développe des actions qui concourent à
// l'insertion professionnelle ou la poursuite d'étude par la voie de
// l'apprentissage ou par toute autre voie permettant de développer leurs
// connaissances et leurs compétences. »
//
// LA CONFUSION À NE PAS FAIRE, ET ELLE EST FACILE :
//
//   L'INDICATEUR 29 NE DEMANDE PAS UN TAUX D'INSERTION. Le taux, c'est
//   l'indicateur 3, et il vient du dispositif national InserJeunes (voir
//   lib/indicateurs.js). Le 29 demande des ACTIONS : ce que l'organisme
//   ORGANISE pour que ses apprentis s'insèrent ou poursuivent. Présenter un
//   taux en réponse au 29, c'est répondre à côté — et un bon taux n'a jamais
//   démontré qu'on avait fait quoi que ce soit pour l'obtenir.
//
// CE QUI EST AUDITÉ EST LA TENUE DU REGISTRE, pas son volume. Trois actions
// datées, avec leurs participants et ce qu'elles ont produit, valent mieux
// qu'une liste d'intentions. D'où le champ qui fait la différence : le
// RÉSULTAT. Un forum d'entreprises sans aucune suite enregistrée est un
// événement, pas une action d'insertion.
//
// ⚠️ Aucun niveau attendu n'est fixé par l'annexe du décret : les seuils
// ci-dessous sont des repères d'exploitation, pas une règle citée.

export const TYPES = {
  forum: { label: "Forum, salon ou job dating", vise: "insertion" },
  relation_entreprise: { label: "Prospection et relation entreprises", vise: "insertion" },
  atelier_technique: { label: "Atelier CV, entretien, recherche d'emploi", vise: "insertion" },
  // La poursuite d'études est la moitié oubliée de l'indicateur : beaucoup
  // d'organismes ne documentent que l'emploi, et se font reprendre là-dessus.
  information_poursuite: { label: "Information sur la poursuite d'études", vise: "poursuite" },
  passerelle: { label: "Passerelle ou partenariat avec un établissement", vise: "poursuite" },
  accompagnement_individuel: { label: "Accompagnement individuel au projet", vise: "les deux" },
  suivi_sortants: { label: "Suivi des sortants", vise: "les deux" },
  autre: { label: "Autre action", vise: "les deux" },
};

export const VISEES = { insertion: "Insertion professionnelle", poursuite: "Poursuite d'études", "les deux": "Les deux" };

// Repères d'exploitation. Une année sans aucune action sur l'une des deux
// voies est le manque que l'audit relève en premier.
export const MOIS_FENETRE = 12;
export const MINIMUM_PAR_VOIE = 1;

export function validateAction(a = {}) {
  const errors = [], warnings = [];
  if (!TYPES[a.type]) errors.push(`type requis (${Object.keys(TYPES).join(", ")})`);
  if (!String(a.intitule || "").trim()) errors.push("intitulé requis");
  if (!a.date) errors.push("date requise — une action sans date ne se situe dans aucune période auditée");
  if (a.participants != null && a.participants !== "") {
    const n = Number(a.participants);
    if (!Number.isInteger(n) || n < 0) errors.push("nombre de participants invalide");
  }
  if (a.vise && !VISEES[a.vise]) errors.push("visée inconnue");

  // Le champ qui sépare une action d'un événement.
  if (!String(a.resultat || "").trim()) {
    warnings.push("aucun résultat enregistré : une action dont on ne sait pas ce qu'elle a produit ne démontre rien");
  }
  if (a.participants === 0) warnings.push("aucun participant : l'action a-t-elle eu lieu ?");
  return { ok: errors.length === 0, errors, warnings };
}

// La visée effective : celle saisie, sinon celle du type.
export const viseeDe = (a = {}) => a.vise || TYPES[a.type]?.vise || "les deux";

function couvre(a, voie) {
  const v = viseeDe(a);
  return v === voie || v === "les deux";
}

// État du dispositif sur une fenêtre glissante. C'est la réponse à l'indicateur
// 29 — et elle porte sur les DEUX voies, pas seulement l'emploi.
export function etatDispositif(actions = [], { aujourdhui, moisFenetre = MOIS_FENETRE, minimum = MINIMUM_PAR_VOIE } = {}) {
  const depuis = aujourdhui
    ? (() => { const d = new Date(aujourdhui + "T00:00:00Z"); d.setMonth(d.getMonth() - moisFenetre); return d.toISOString().slice(0, 10); })()
    : null;
  const recentes = actions.filter((a) => a.date && (!depuis || a.date >= depuis));

  const voies = ["insertion", "poursuite"].map((voie) => {
    const miennes = recentes.filter((a) => couvre(a, voie));
    const avecResultat = miennes.filter((a) => String(a.resultat || "").trim());
    return {
      voie, label: VISEES[voie],
      total: miennes.length, avecResultat: avecResultat.length,
      participants: miennes.reduce((s, a) => s + (Number(a.participants) || 0), 0),
      couvert: miennes.length >= minimum && avecResultat.length > 0,
      manque: miennes.length < minimum
        ? `aucune action sur ${moisFenetre} mois pour la ${VISEES[voie].toLowerCase()}`
        : !avecResultat.length
          ? `${miennes.length} action(s) sans résultat enregistré : rien ne dit ce qu'elles ont produit`
          : null,
    };
  });

  return {
    fenetreDepuis: depuis, total: recentes.length,
    voies,
    couvert: voies.every((v) => v.couvert),
    // Le rappel qui évite la réponse à côté.
    reserve: "L'indicateur 29 porte sur les ACTIONS menées, pas sur le taux d'insertion — celui-ci relève de l'indicateur 3 et du dispositif national InserJeunes. Un bon taux ne démontre pas qu'on a agi pour l'obtenir.",
  };
}

// Regroupement par type, pour montrer la diversité des actions : dix fois le
// même forum couvre moins bien l'exigence que trois actions de natures
// différentes.
export function parType(actions = []) {
  const m = new Map();
  for (const a of actions) {
    if (!m.has(a.type)) m.set(a.type, { type: a.type, label: TYPES[a.type]?.label || a.type, n: 0, participants: 0 });
    const g = m.get(a.type);
    g.n++;
    g.participants += Number(a.participants) || 0;
  }
  return [...m.values()].sort((x, y) => y.n - x.n);
}

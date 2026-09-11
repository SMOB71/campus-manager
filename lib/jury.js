// Sessions d'examen, convocations et jury — logique pure (aucune I/O).
//
// CE QUI DISTINGUE CE MODULE DU MODULE DE NOTES — les notes disent ce que
// l'apprenant a obtenu. Le JURY dit ce qu'il OBTIENT. Ce ne sont pas les mêmes
// faits : une moyenne au-dessus du seuil ne délivre rien tant qu'un jury n'a pas
// statué, et un jury peut valider un bloc légèrement en dessous du seuil au vu
// du parcours. Écraser l'un sur l'autre, c'est soit délivrer un titre que
// personne n'a prononcé, soit ignorer une délibération.
//
// D'où la règle centrale : la décision de jury est SOUVERAINE et s'enregistre
// telle quelle, mais tout écart avec le calcul doit être MOTIVÉ. Un procès-verbal
// où un bloc passe de « non acquis » à « acquis » sans un mot est exactement ce
// qu'un certificateur relève.
//
// La convocation, elle, a une contrainte propre : un délai de prévenance. Une
// convocation envoyée trois jours avant l'épreuve est un motif de contestation,
// et c'est l'organisme qui perd.

const jour = 864e5;
const ecart = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);

export const SESSION_STATUTS = {
  planifiee: "Planifiée",
  convoquee: "Convoquée",
  tenue: "Tenue",
  deliberee: "Délibérée",
  annulee: "Annulée",
};

// Délai de prévenance par défaut. Rien ne fixe un délai unique en droit : ce qui
// est opposable, c'est le délai que l'organisme annonce dans son règlement.
export const DELAI_CONVOCATION_JOURS = 15;

export function validateSession(s = {}) {
  const errors = [], warnings = [];
  if (!s.date) errors.push("date de session requise");
  if (!String(s.intitule || "").trim()) errors.push("intitulé de la session requis");
  if (s.statut && !SESSION_STATUTS[s.statut]) errors.push("statut inconnu");
  if (s.dateConvocation && s.date && s.dateConvocation > s.date) errors.push("convocation postérieure à l'épreuve");
  if (!String(s.lieu || "").trim()) warnings.push("lieu non précisé sur la convocation");
  if (["tenue", "deliberee"].includes(s.statut) && !s.dateConvocation) {
    warnings.push("session tenue sans trace de convocation");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function etatConvocation(session = {}, { delaiJours = DELAI_CONVOCATION_JOURS } = {}) {
  const prevenance = ecart(session.dateConvocation, session.date);
  const insuffisant = prevenance != null && prevenance < delaiJours;
  return {
    convoquee: !!session.dateConvocation,
    prevenanceJours: prevenance, delaiJours,
    insuffisant,
    // Un délai trop court est un motif de contestation, et c'est l'organisme
    // qui perd : on le dit avant l'épreuve, pas après le recours.
    alerte: !session.dateConvocation ? "Aucune convocation enregistrée."
      : insuffisant ? `Convocation envoyée ${prevenance} jour(s) avant l'épreuve (délai annoncé : ${delaiJours}).`
      : null,
  };
}

export const DECISIONS_JURY = {
  admis: "Admis — titre délivré",
  admis_partiel: "Admis partiellement — blocs acquis capitalisés",
  ajourne: "Ajourné",
  absent: "Absent",
  non_presente: "Non présenté par l'organisme",
};

// Une décision par bloc, plus une décision globale. Le jury peut valider un bloc
// et en ajourner un autre : c'est même le cas le plus courant.
export const DECISIONS_BLOC = { acquis: "Acquis", non_acquis: "Non acquis", ajourne: "Ajourné" };

// Rapprochement entre ce que le calcul disait et ce que le jury a prononcé.
// C'est cette fonction qui produit la matière du procès-verbal.
export function deliberation({ blocsCalcules = [], decisions = {}, decisionGlobale = null, motifs = {} } = {}) {
  const lignes = blocsCalcules.map((b) => {
    const prononce = decisions[b.blocId] || null;
    // Ce que le calcul « proposait » : un bloc acquis par dispense arrive déjà
    // acquis, le jury n'a pas à le reprononcer.
    const propose = b.status === "acquis" || b.status === "acquis_dispense" ? "acquis"
      : b.status === "non_acquis" ? "non_acquis" : null;
    const ecarte = prononce != null && propose != null && prononce !== propose;
    return {
      blocId: b.blocId, code: b.code || "", label: b.label || "",
      moyenne: b.moyenne ?? null, seuil: b.seuil ?? null,
      parDispense: b.status === "acquis_dispense",
      propose, prononce,
      ecart: ecarte,
      motif: String(motifs[b.blocId] || "").trim(),
      // Un écart non motivé est LE point que relève un certificateur.
      motifManquant: ecarte && !String(motifs[b.blocId] || "").trim(),
    };
  });

  const prononces = lignes.filter((l) => l.prononce);
  const acquis = lignes.filter((l) => l.prononce === "acquis");
  const ecarts = lignes.filter((l) => l.ecart);
  const sansMotif = lignes.filter((l) => l.motifManquant);

  // La décision globale se propose, elle ne se calcule pas : c'est le jury qui
  // prononce. On signale seulement quand elle contredit ses propres décisions
  // par bloc — un « admis » avec un bloc non acquis n'est pas soutenable.
  const proposeGlobale = !lignes.length ? null
    : acquis.length === lignes.length ? "admis"
    : acquis.length > 0 ? "admis_partiel" : "ajourne";
  const incoherence = decisionGlobale === "admis" && acquis.length < lignes.length
    ? "décision « admis » alors que tous les blocs ne sont pas acquis — sans compensation entre blocs, elle n'est pas soutenable"
    : null;

  return {
    lignes,
    blocsTotal: lignes.length,
    blocsPrononces: prononces.length,
    blocsAcquis: acquis.length,
    ecarts: ecarts.length,
    sansMotif: sansMotif.map((l) => l.code || l.label),
    proposeGlobale,
    decisionGlobale: decisionGlobale || null,
    decisionLabel: DECISIONS_JURY[decisionGlobale] || null,
    incoherence,
    // Le PV n'est signable que si tout est prononcé — blocs ET décision globale —
    // et si tout écart est motivé. La décision globale manquait à ce test : un
    // procès-verbal sans elle était déclaré signable, alors qu'il ne prononce rien.
    signable: lignes.length > 0 && prononces.length === lignes.length && sansMotif.length === 0
      && !incoherence && !!decisionGlobale,
    manquantes: [
      ...(lignes.length && prononces.length < lignes.length ? [`${lignes.length - prononces.length} bloc(s) sans décision de jury`] : []),
      ...(sansMotif.length ? [`écart non motivé sur : ${sansMotif.map((l) => l.code || l.label).join(", ")}`] : []),
      ...(incoherence ? [incoherence] : []),
      ...(decisionGlobale ? [] : ["décision globale du jury non prononcée"]),
    ],
  };
}

// Composition du jury : sans membres identifiés, un procès-verbal ne vaut rien.
export function validateComposition(membres = []) {
  const errors = [], warnings = [];
  const valides = membres.filter((m) => String(m.nom || "").trim());
  if (!valides.length) errors.push("aucun membre de jury identifié");
  if (!valides.some((m) => m.role === "president")) errors.push("président de jury non désigné");
  // La présence de professionnels est une exigence courante des certificateurs
  // pour les titres à finalité professionnelle.
  if (!valides.some((m) => m.role === "professionnel")) {
    warnings.push("aucun professionnel du métier au jury — vérifier le règlement de la certification");
  }
  return { ok: errors.length === 0, errors, warnings, membres: valides.length };
}

export const ROLES_JURY = { president: "Président", formateur: "Formateur", professionnel: "Professionnel du métier", representant: "Représentant du certificateur" };

// Individualisation et suivi du parcours — logique pure (aucune I/O).
//
// Trois objets qui n'en font qu'un dans la réalité d'un CFA : ce qu'on constate
// À L'ENTRÉE (positionnement), ce qu'on aménage POUR CE PARCOURS (adaptations),
// et ce qu'on vérifie PENDANT (suivi tripartite CFA / apprenti / entreprise).
// Un contrôle Qualiopi les demande ensemble parce qu'ils racontent la même
// histoire : ce parcours-là a été adapté à cette personne-là, et suivi.
//
// TROIS RÈGLES MÉTIER QUI NE SE DEVINENT PAS :
//
//   1. Un positionnement DATÉ APRÈS le début de la formation ne prouve rien. Il
//      est censé fonder l'individualisation, donc la précéder. Un organisme qui
//      régularise ses positionnements en fin d'année produit une pièce qui se
//      retourne contre lui.
//
//   2. Un AMÉNAGEMENT D'ÉPREUVE n'est PAS un aménagement pédagogique. Le premier
//      relève du certificateur ou de l'autorité académique, qui seuls
//      l'accordent ; l'organisme le DEMANDE. Le second, l'organisme le décide
//      seul. Promettre un tiers-temps qu'on n'a pas obtenu, c'est exposer le
//      candidat le jour de l'épreuve.
//
//   3. L'absence de visite en entreprise est le meilleur signe avant-coureur
//      d'une rupture. Une rupture engagée sans aucune visite récente est,
//      devant un financeur, le pire dossier possible.
//
// RGPD — aucune donnée de santé ici. On enregistre l'AMÉNAGEMENT accordé, jamais
// la nature du handicap ni un document médical : la donnée utile à
// l'organisation est ce qu'il faut mettre en place, pas le diagnostic. C'est
// aussi ce qui évite de constituer un traitement de données de l'article 9.

const jour = 864e5;
const jours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);

// ---------------------------------------------------------------- Positionnement

export const POSITIONNEMENT_MODALITES = {
  entretien: "Entretien individuel",
  test: "Test de positionnement",
  dossier: "Étude de dossier",
  mixte: "Entretien et test",
};

export const PREREQUIS_VERDICTS = {
  satisfaits: "Prérequis satisfaits",
  satisfaits_avec_amenagement: "Satisfaits sous réserve d'aménagement du parcours",
  non_satisfaits: "Prérequis non satisfaits",
};

export function validatePositionnement(p = {}, { debutFormation = null } = {}) {
  const errors = [], warnings = [];
  if (!p.date) errors.push("date du positionnement requise");
  if (!POSITIONNEMENT_MODALITES[p.modalite]) errors.push(`modalité requise (${Object.keys(POSITIONNEMENT_MODALITES).join(", ")})`);
  if (!PREREQUIS_VERDICTS[p.prerequis]) errors.push("verdict sur les prérequis requis");
  if (!String(p.realisePar || "").trim()) errors.push("auteur du positionnement requis");

  // Règle 1 : la chronologie fait la preuve.
  const posterieur = p.date && debutFormation && p.date > debutFormation;
  if (posterieur) {
    warnings.push(`positionnement daté du ${p.date}, après le début de formation du ${debutFormation} — il est censé fonder l'individualisation, donc la précéder`);
  }
  if (p.prerequis === "satisfaits_avec_amenagement" && !String(p.amenagementPropose || "").trim()) {
    warnings.push("aménagement annoncé mais non décrit");
  }
  if (!String(p.objectifs || "").trim()) warnings.push("objectifs individualisés non formalisés");
  return { ok: errors.length === 0, errors, warnings, posterieurAuDebut: !!posterieur };
}

// --------------------------------------------------------------- Aménagements

// L'axe qui compte : qui décide. L'organisme décide seul de la pédagogie et du
// matériel ; l'aménagement d'épreuve, lui, s'obtient.
export const AMENAGEMENT_TYPES = {
  pedagogique: { label: "Aménagement pédagogique", decideur: "organisme", demandeExterne: false },
  materiel: { label: "Aménagement matériel ou logistique", decideur: "organisme", demandeExterne: false },
  rythme: { label: "Aménagement du rythme ou de la durée", decideur: "organisme", demandeExterne: false },
  epreuve: { label: "Aménagement des épreuves de certification", decideur: "certificateur", demandeExterne: true },
};

export const AMENAGEMENT_STATUTS = {
  envisage: "Envisagé",
  demande: "Demandé au certificateur",
  accorde: "Accordé",
  refuse: "Refusé",
  en_place: "Mis en place",
};

export function validateAmenagement(a = {}) {
  const errors = [], warnings = [];
  const type = AMENAGEMENT_TYPES[a.type];
  if (!type) errors.push(`type requis (${Object.keys(AMENAGEMENT_TYPES).join(", ")})`);
  if (!String(a.description || "").trim()) errors.push("description de l'aménagement requise");
  if (a.statut && !AMENAGEMENT_STATUTS[a.statut]) errors.push("statut inconnu");

  // Règle 2 : ne jamais laisser croire qu'un tiers-temps est acquis alors qu'il
  // n'a même pas été demandé.
  if (type?.demandeExterne) {
    if (a.statut === "en_place") {
      errors.push("un aménagement d'épreuve ne peut pas être « mis en place » par l'organisme : il est accordé par le certificateur");
    }
    if (a.statut === "accorde" && !String(a.referenceDecision || "").trim()) {
      warnings.push("aménagement d'épreuve déclaré accordé sans référence de la décision du certificateur");
    }
    if (!a.statut || a.statut === "envisage") {
      warnings.push("aménagement d'épreuve non encore demandé au certificateur — le délai de dépôt conditionne l'obtention");
    }
  }
  // RGPD : on refuse activement ce qu'il ne faut pas stocker.
  for (const champ of ["diagnostic", "pathologie", "natureHandicap", "documentMedical"]) {
    if (a[champ]) errors.push(`donnée de santé refusée (${champ}) : n'enregistrer que l'aménagement à mettre en place`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// --------------------------------------------------------- Suivi tripartite

export const SUIVI_TYPES = {
  visite: "Visite en entreprise",
  entretien: "Entretien tripartite",
  appel: "Point téléphonique",
  visio: "Point en visioconférence",
};

// Seule une rencontre associant l'entreprise vaut suivi de l'alternance. Un
// point téléphonique avec le seul apprenti documente l'accompagnement, pas la
// liaison avec le maître d'apprentissage.
export const SUIVI_TRIPARTITE = new Set(["visite", "entretien"]);

export function validateSuivi(s = {}) {
  const errors = [], warnings = [];
  if (!s.date) errors.push("date requise");
  if (!SUIVI_TYPES[s.type]) errors.push(`type requis (${Object.keys(SUIVI_TYPES).join(", ")})`);
  if (!String(s.realisePar || "").trim()) errors.push("auteur du suivi requis");
  if (!String(s.compteRendu || "").trim()) warnings.push("compte rendu vide — un suivi sans trace ne prouve rien");
  if (SUIVI_TRIPARTITE.has(s.type) && !String(s.tuteur || "").trim()) {
    warnings.push("maître d'apprentissage ou tuteur non identifié sur une rencontre tripartite");
  }
  if (s.difficultes && !String(s.actions || "").trim()) {
    warnings.push("difficultés signalées sans action décidée");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export const CADENCE_DEFAUT_JOURS = 182; // un suivi par semestre

// État du suivi d'un apprenant. `ruptureOuverte` change la lecture : ce n'est
// plus une cadence à tenir, c'est un dossier à défendre.
export function etatSuivi({ suivis = [], debut = null, aujourdhui, cadenceJours = CADENCE_DEFAUT_JOURS, ruptureOuverte = false } = {}) {
  const tripartites = suivis
    .filter((s) => SUIVI_TRIPARTITE.has(s.type) && s.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const dernier = tripartites[0] || null;
  const reference = dernier?.date || debut || null;
  const depuis = reference ? jours(reference, aujourdhui) : null;
  const enRetard = depuis != null && depuis > cadenceJours;

  let alerte = null;
  if (ruptureOuverte && (!dernier || (depuis != null && depuis > 90))) {
    // Règle 3 : c'est le dossier qu'un financeur épluche en premier.
    alerte = dernier
      ? `Rupture engagée et aucune rencontre en entreprise depuis ${depuis} jours.`
      : "Rupture engagée et aucune rencontre en entreprise n'a jamais eu lieu.";
  } else if (!dernier && depuis != null && depuis > cadenceJours) {
    alerte = `Aucune rencontre en entreprise depuis le début du parcours (${depuis} jours).`;
  } else if (enRetard) {
    alerte = `Dernière rencontre en entreprise il y a ${depuis} jours (cadence attendue : ${cadenceJours}).`;
  }

  return {
    total: suivis.length,
    tripartites: tripartites.length,
    dernier: dernier ? { date: dernier.date, type: dernier.type, realisePar: dernier.realisePar || "" } : null,
    joursDepuis: depuis, cadenceJours, enRetard, ruptureOuverte, alerte,
    // Un point téléphonique compte pour l'accompagnement mais pas pour la
    // liaison entreprise : on le dit, plutôt que de gonfler un compteur.
    autresContacts: suivis.length - tripartites.length,
  };
}

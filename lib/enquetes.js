// Enquêtes — logique pure, aucune I/O.
//
// DEUX DISPOSITIFS, ET LE DÉCRET EXIGE QU'ILS RESTENT DISTINCTS.
//
//   • Indicateur 30 — recueil des appréciations des PARTIES PRENANTES :
//     bénéficiaires, financeurs, équipes. C'est la satisfaction générale, et
//     elle ne s'adresse pas qu'aux apprenants.
//
//   • Indicateur 33 (nouveau, décret n° 2026-728) — évaluation des CONTENUS et
//     des ENSEIGNEMENTS par les apprenants, « distinct du recueil général de
//     satisfaction », avec restitution aux équipes pédagogiques.
//
// Un formulaire unique qui mélangerait « recommanderiez-vous l'école ? » et
// « le rythme du cours de mathématiques était-il adapté ? » ne satisferait
// AUCUN des deux : le premier indicateur veut des parties prenantes que le
// second ignore, et le second veut une granularité par enseignement que le
// premier noie. Le module refuse donc de confondre les deux types.
//
// LE POINT QUI ENGAGE, ET QUI N'EST PAS TECHNIQUE :
//
//   Évaluer des ENSEIGNEMENTS, c'est évaluer des ENSEIGNANTS. Sur une classe de
//   huit, trois réponses sur un formateur nommé ne mesurent rien et désignent
//   tout le monde : l'intéressé reconnaît qui a répondu quoi, et le résultat
//   peut nourrir une décision qui le concerne. D'où deux règles non
//   contournables : les réponses sont ANONYMES (le lien avec le répondant est
//   rompu à la soumission, pas seulement masqué à l'affichage), et aucun
//   résultat nominatif n'est restitué sous un seuil de réponses.
//
// ⚠️ Modalités de l'indicateur 33 fixées par le décret et son guide de lecture :
// à revérifier. Le seuil ci-dessous est un choix prudent, pas une règle citée.

// En deçà, aucun résultat par intervenant n'est affiché. Choisi explicitement
// plutôt que laissé à zéro : un silence laisserait publier n'importe quoi.
export const SEUIL_RESTITUTION_NOMINATIVE = 5;

export const TYPES = {
  satisfaction: {
    cle: "satisfaction", label: "Satisfaction générale", indicateur: 30,
    publics: ["apprenant", "entreprise", "financeur", "equipe", "ancien"],
    nominatif: false,
  },
  enseignements: {
    cle: "enseignements", label: "Évaluation des contenus et des enseignements", indicateur: 33,
    // Seuls les apprenants évaluent les enseignements qu'ils ont suivis.
    publics: ["apprenant"],
    nominatif: true,        // les résultats se lisent par module / intervenant
  },
};

export const PUBLICS = {
  apprenant: "Apprenants", entreprise: "Entreprises / tuteurs",
  financeur: "Financeurs", equipe: "Équipe pédagogique", ancien: "Anciens apprenants",
};

export const ETATS = { brouillon: "Brouillon", ouverte: "Ouverte", close: "Close" };

// Types de questions. `echelle` produit une note exploitable ; `libre` produit
// du verbatim, qui ne se moyenne pas mais qui est souvent le plus utile.
export const QUESTION_TYPES = {
  echelle: { label: "Échelle 1 à 5", chiffrable: true },
  oui_non: { label: "Oui / Non", chiffrable: true },
  libre: { label: "Réponse libre", chiffrable: false },
  choix: { label: "Choix unique", chiffrable: false },
};

const moy = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

// --- Modèles de départ -------------------------------------------------------
// Fournis pour que l'organisme parte d'un questionnaire qui tient debout plutôt
// que d'une page blanche. Ils restent modifiables : c'est son dispositif, pas
// le nôtre.
export function modele(type) {
  if (type === "enseignements") {
    return [
      { id: "q1", type: "echelle", texte: "Les objectifs de l'enseignement ont été annoncés clairement." },
      { id: "q2", type: "echelle", texte: "Les contenus correspondent aux objectifs annoncés." },
      { id: "q3", type: "echelle", texte: "Le rythme et le niveau étaient adaptés." },
      { id: "q4", type: "echelle", texte: "Les supports fournis sont utiles et exploitables." },
      { id: "q5", type: "echelle", texte: "Les modalités d'évaluation ont été expliquées." },
      { id: "q6", type: "echelle", texte: "Les liens avec la pratique professionnelle sont établis." },
      { id: "q7", type: "libre", texte: "Ce qui vous a le plus aidé à progresser." },
      { id: "q8", type: "libre", texte: "Ce qui devrait être amélioré." },
    ];
  }
  return [
    { id: "q1", type: "echelle", texte: "Information reçue avant l'entrée en formation (contenu, durée, modalités)." },
    { id: "q2", type: "echelle", texte: "Conditions d'accueil et locaux." },
    { id: "q3", type: "echelle", texte: "Accompagnement et disponibilité de l'équipe." },
    { id: "q4", type: "echelle", texte: "Adéquation de la formation à vos attentes." },
    { id: "q5", type: "oui_non", texte: "Recommanderiez-vous cette formation ?" },
    { id: "q6", type: "libre", texte: "Vos observations." },
  ];
}

// --- Validation --------------------------------------------------------------
export function validateEnquete(e = {}) {
  const errors = [], warnings = [];
  const t = TYPES[e.type];
  if (!t) errors.push(`type requis (${Object.keys(TYPES).join(", ")})`);
  if (!String(e.titre || "").trim()) errors.push("titre requis");
  if (e.etat && !ETATS[e.etat]) errors.push("état inconnu");

  const questions = Array.isArray(e.questions) ? e.questions : [];
  if (!questions.length) errors.push("aucune question");
  const vus = new Set();
  for (const q of questions) {
    if (!QUESTION_TYPES[q?.type]) errors.push(`type de question inconnu : ${q?.type}`);
    if (!String(q?.texte || "").trim()) errors.push("une question sans énoncé");
    if (q?.id && vus.has(q.id)) errors.push(`identifiant de question en double : ${q.id}`);
    if (q?.id) vus.add(q.id);
  }

  // Le public doit appartenir au type : une évaluation des enseignements
  // adressée aux financeurs n'aurait pas de sens.
  const publics = Array.isArray(e.publics) ? e.publics : [];
  if (!publics.length) errors.push("aucun public destinataire");
  for (const p of publics) {
    if (!PUBLICS[p]) errors.push(`public inconnu : ${p}`);
    else if (t && !t.publics.includes(p)) {
      errors.push(`${PUBLICS[p]} ne peut pas être destinataire d'une ${t.label.toLowerCase()}`);
    }
  }

  if (e.type === "enseignements" && !e.classId) {
    errors.push("une évaluation des enseignements porte sur une classe : sans elle, on ne sait pas quels enseignements sont évalués");
  }
  if (e.dateOuverture && e.dateFermeture && e.dateFermeture < e.dateOuverture) {
    errors.push("fermeture antérieure à l'ouverture");
  }
  if (e.type === "enseignements" && !questions.some((q) => q.type === "libre")) {
    warnings.push("aucune question libre : le verbatim est souvent ce qui fait progresser une équipe, la moyenne le cache");
  }
  return { ok: errors.length === 0, errors, warnings };
}

// --- Réponses ----------------------------------------------------------------
// Une réponse ne porte JAMAIS l'identité du répondant. L'invitation sait qu'elle
// a été honorée (c'est ce qui donne le taux de participation), la réponse ne
// sait pas d'où elle vient. Rompre le lien à l'écriture, et non à l'affichage,
// est la seule façon de garantir qu'aucune requête ultérieure ne le rétablisse.
export function validateReponse(enquete = {}, reponse = {}) {
  const errors = [];
  if (enquete.etat !== "ouverte") errors.push("cette enquête n'est pas ouverte");
  const rep = reponse.reponses && typeof reponse.reponses === "object" ? reponse.reponses : null;
  if (!rep) errors.push("aucune réponse");
  for (const q of enquete.questions || []) {
    const v = rep?.[q.id];
    if (v === undefined || v === null || v === "") continue;
    if (q.type === "echelle") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) errors.push(`${q.id} : note attendue entre 1 et 5`);
    } else if (q.type === "oui_non" && !["oui", "non"].includes(String(v))) {
      errors.push(`${q.id} : « oui » ou « non » attendu`);
    }
  }
  // On refuse une soumission vide : elle fausserait le taux de participation en
  // la comptant comme un avis.
  if (rep && !Object.values(rep).some((v) => v !== undefined && v !== null && v !== "")) {
    errors.push("réponse entièrement vide");
  }
  return { ok: errors.length === 0, errors };
}

// Nettoie une réponse avant enregistrement : on ne garde que les questions de
// l'enquête, et rien d'autre. Sans ce filtre, un champ « nom » glissé dans le
// corps de la requête serait stocké au milieu de réponses censées être anonymes.
export function assainirReponse(enquete = {}, brut = {}) {
  const permises = new Set((enquete.questions || []).map((q) => q.id));
  const out = {};
  for (const [k, v] of Object.entries(brut.reponses || {})) {
    if (permises.has(k)) out[k] = typeof v === "string" ? v.slice(0, 2000) : v;
  }
  return {
    reponses: out,
    // Le contexte pédagogique est conservé car il est nécessaire à la
    // restitution par enseignement — et il ne désigne personne.
    moduleId: brut.moduleId || null,
    teacherId: brut.teacherId || null,
  };
}

// --- Dépouillement -----------------------------------------------------------
function agregerQuestion(q, reponses) {
  const vals = reponses.map((r) => r.reponses?.[q.id]).filter((v) => v !== undefined && v !== null && v !== "");
  if (q.type === "echelle") {
    const nums = vals.map(Number).filter(Number.isFinite);
    const dist = [1, 2, 3, 4, 5].map((n) => ({ note: n, n: nums.filter((x) => x === n).length }));
    return { ...q, repondu: nums.length, moyenne: moy(nums), distribution: dist };
  }
  if (q.type === "oui_non") {
    const oui = vals.filter((v) => String(v) === "oui").length;
    return { ...q, repondu: vals.length, oui, non: vals.length - oui,
      tauxOui: vals.length ? Math.round((oui / vals.length) * 100) : null };
  }
  // Le verbatim n'est ni moyenné ni résumé : le déformer lui ferait perdre ce
  // qui en fait la valeur.
  return { ...q, repondu: vals.length, verbatims: vals.map(String) };
}

export function depouiller(enquete = {}, reponses = [], invitations = []) {
  const questions = (enquete.questions || []).map((q) => agregerQuestion(q, reponses));
  const chiffrables = questions.filter((q) => QUESTION_TYPES[q.type]?.chiffrable && q.moyenne != null);
  const invites = invitations.length;
  return {
    enqueteId: enquete.id, type: enquete.type, titre: enquete.titre,
    invites, repondus: reponses.length,
    // Le taux de participation est lui-même regardé en audit : une enquête à
    // 4 % de réponses ne démontre pas un recueil des appréciations.
    participation: invites ? Math.round((reponses.length / invites) * 100) : null,
    questions,
    // Note globale sur 5, uniquement sur les échelles : mélanger un « oui/non »
    // dans une moyenne sur 5 produirait un chiffre qui ne veut rien dire.
    noteGlobale: moy(chiffrables.map((q) => q.moyenne)),
  };
}

// Restitution par enseignement — c'est ce que l'indicateur 33 demande de
// remonter aux équipes pédagogiques. Sous le seuil, on ne montre rien et on dit
// pourquoi : un résultat sur trois réponses désigne les répondants.
export function parEnseignement(enquete = {}, reponses = [], { seuil = SEUIL_RESTITUTION_NOMINATIVE, libelles = {} } = {}) {
  const groupes = new Map();
  for (const r of reponses) {
    const cle = `${r.moduleId || ""}|${r.teacherId || ""}`;
    if (!groupes.has(cle)) groupes.set(cle, { moduleId: r.moduleId || null, teacherId: r.teacherId || null, reponses: [] });
    groupes.get(cle).reponses.push(r);
  }
  const echelles = (enquete.questions || []).filter((q) => q.type === "echelle");
  return [...groupes.values()].map((g) => {
    const n = g.reponses.length;
    const publiable = n >= seuil;
    return {
      moduleId: g.moduleId, teacherId: g.teacherId,
      module: libelles[g.moduleId] || null, intervenant: libelles[g.teacherId] || null,
      repondu: n, publiable,
      questions: publiable ? echelles.map((q) => agregerQuestion(q, g.reponses)) : [],
      note: publiable ? moy(echelles.map((q) => agregerQuestion(q, g.reponses).moyenne).filter((x) => x != null)) : null,
      motif: publiable ? null
        : `${n} réponse(s) pour un seuil de ${seuil} : afficher un résultat nominatif ici rendrait les répondants identifiables par la personne évaluée`,
    };
  }).sort((a, b) => String(a.module || "").localeCompare(String(b.module || "")));
}

// --- Ce qu'un audit regarde --------------------------------------------------
// Pas « avez-vous un questionnaire » mais « qu'en avez-vous fait ». Une enquête
// dépouillée dont rien n'a été tiré est un recueil, pas une démarche qualité.
export function etatDispositif(enquetes = [], { aujourdhui, moisRecents = 12 } = {}) {
  const limite = aujourdhui
    ? new Date(new Date(aujourdhui + "T00:00:00Z").setMonth(new Date(aujourdhui + "T00:00:00Z").getMonth() - moisRecents))
        .toISOString().slice(0, 10)
    : null;
  const recentes = (e) => !limite || (e.dateOuverture || e.createdAt || "").slice(0, 10) >= limite;

  const lignes = Object.values(TYPES).map((t) => {
    const miennes = enquetes.filter((e) => e.type === t.cle && recentes(e));
    const closes = miennes.filter((e) => e.etat === "close");
    const exploitees = closes.filter((e) => (e.mesures || []).length);
    const restituees = closes.filter((e) => e.restitutionLe);
    const manques = [];
    if (!miennes.length) manques.push(`aucune ${t.label.toLowerCase()} sur les ${moisRecents} derniers mois`);
    else if (!closes.length) manques.push("aucune campagne close : rien n'a encore été dépouillé");
    else if (!exploitees.length) manques.push("aucune mesure d'amélioration tirée des retours — un recueil sans suite n'est pas une démarche qualité");
    // Propre à l'indicateur 33 : la restitution aux équipes fait partie de
    // l'exigence, elle n'est pas une bonne pratique facultative.
    if (t.cle === "enseignements" && closes.length && !restituees.length) {
      manques.push("aucune restitution aux équipes pédagogiques enregistrée");
    }
    return {
      type: t.cle, label: t.label, indicateur: t.indicateur,
      total: miennes.length, closes: closes.length,
      exploitees: exploitees.length, restituees: restituees.length,
      couvert: manques.length === 0, manques,
    };
  });
  return {
    lignes,
    couvert: lignes.every((l) => l.couvert),
    reserve: "Les deux dispositifs doivent rester distincts (décret n° 2026-728) : un questionnaire unique ne couvre ni l'indicateur 30 ni l'indicateur 33.",
  };
}

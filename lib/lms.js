// Ressources pédagogiques et suivi à distance — logique pure, aucune I/O.
//
// CE QU'UN LMS EST DANS UN CFA, ET CE QU'IL N'EST PAS.
//
// Ce n'est pas une bibliothèque de contenus. C'est le SYSTÈME DE PREUVE DES
// HEURES À DISTANCE. En présentiel, l'heure réalisée se prouve par une
// signature ; à distance, il n'y a personne à faire signer. Ce sont les
// « éléments probants » — activités effectuées, travaux rendus, évaluations —
// qui établissent la réalisation. Sans eux :
//
//   • l'indicateur 19 du référentiel 2026 tombe (« ressources pédagogiques,
//     VÉRIFICATION DU SUIVI À DISTANCE, référent pédagogique ») ;
//   • et surtout les heures à distance ne sont pas justifiables devant le
//     financeur. Une heure non justifiée est une heure non payée, et un contrôle
//     de service fait peut la reprendre des années après.
//
// LA RÈGLE QUE CE MODULE REFUSE DE PLIER :
//
//   CONSULTER UNE RESSOURCE N'EST PAS ÊTRE ASSIDU.
//
// Un LMS naïf compte « vu = présent ». C'est faux et c'est dangereux : ouvrir un
// PDF trois secondes n'est pas suivre deux heures de cours, et cette confusion
// fabrique une preuve d'assiduité qui alimente ensuite la facturation. On
// produirait des heures facturées sur une ligne de journal de connexion. Le
// module tient donc la consultation et l'assiduité comme deux faits distincts,
// et ne convertit jamais l'une en l'autre.
//
// CE QUE DIT LE CODE DU TRAVAIL SUR L'ACTION À DISTANCE (art. D. 6313-3-1) :
// elle comprend une assistance technique et pédagogique, une information du
// bénéficiaire sur les activités à effectuer à distance ET LEUR DURÉE MOYENNE,
// et des évaluations qui jalonnent ou concluent l'action. Ces trois composantes
// ne sont pas des bonnes pratiques : ce sont des conditions.
//
// ⚠️ Régime FOAD et modalités de preuve à revérifier : ils ont bougé plusieurs
// fois, et les attentes des financeurs varient d'un OPCO à l'autre.

export const RESSOURCE_TYPES = {
  document: { label: "Document (PDF, support de cours)", probant: false },
  lien: { label: "Lien externe", probant: false },
  video: { label: "Vidéo", probant: false },
  // Ce qui suit produit une TRACE de travail, pas seulement une consultation.
  // C'est la différence entre « mis à disposition » et « élément probant ».
  exercice: { label: "Exercice à rendre", probant: true },
  evaluation: { label: "Évaluation jalon", probant: true },
};

export const MODALITES = {
  presentiel: "Présentiel",
  distanciel: "À distance",
  hybride: "Hybride",
};

// Les trois composantes de l'article D. 6313-3-1. Nommées, parce qu'une liste à
// cocher sans référence ne se défend pas devant un contrôle.
export const COMPOSANTES_FOAD = {
  assistance: {
    label: "Assistance technique et pédagogique",
    texte: "Un contact identifié, joignable, et des modalités connues du bénéficiaire.",
  },
  information: {
    label: "Information sur les activités et leur durée moyenne",
    texte: "Le bénéficiaire sait ce qu'il doit faire à distance et combien de temps cela prend.",
  },
  evaluations: {
    label: "Évaluations jalonnant ou concluant l'action",
    texte: "Des points d'évaluation, pas seulement une épreuve finale.",
  },
};

const min = (v) => (v === "" || v == null ? null : Number(v));

// --- Ressources ---------------------------------------------------------------

export function validateRessource(r = {}) {
  const errors = [], warnings = [];
  if (!RESSOURCE_TYPES[r.type]) errors.push(`type requis (${Object.keys(RESSOURCE_TYPES).join(", ")})`);
  if (!String(r.titre || "").trim()) errors.push("titre requis");
  if (!r.moduleId) errors.push("module requis — une ressource qui n'est rattachée à aucun enseignement n'est trouvable par personne");
  if (!String(r.url || "").trim() && !r.documentId) errors.push("fichier ou lien requis");
  if (r.url && !/^https?:\/\//i.test(String(r.url))) {
    errors.push("lien invalide : l'adresse doit commencer par http:// ou https://");
  }

  const duree = min(r.dureeMoyenneMinutes);
  if (duree != null && (!Number.isFinite(duree) || duree <= 0)) errors.push("durée moyenne invalide");
  // LA CONDITION DE L'ARTICLE D. 6313-3-1, 2°. Une activité à distance sans
  // durée moyenne annoncée n'informe pas le bénéficiaire — et surtout, elle ne
  // pourra pas être convertie en heures justifiables.
  if (r.aDistance && duree == null) {
    errors.push("durée moyenne requise pour une activité à distance : le bénéficiaire doit savoir combien de temps elle prend (art. D. 6313-3-1)");
  }
  if (r.disponibleDu && r.disponibleAu && r.disponibleAu < r.disponibleDu) {
    errors.push("fin de mise à disposition antérieure au début");
  }
  if (!(r.classIds || []).length) {
    warnings.push("aucune classe destinataire : la ressource ne sera visible par aucun apprenant");
  }
  if (r.aDistance && !RESSOURCE_TYPES[r.type]?.probant) {
    warnings.push("ce type de ressource ne produit pas d'élément probant : seule sa consultation sera tracée, ce qui ne justifie pas d'heures à distance");
  }
  return { ok: errors.length === 0, errors, warnings };
}

// Une ressource est-elle visible par une classe, à une date donnée ?
export function estDisponible(r = {}, classId, dateISO) {
  if (r.archivee) return false;
  if ((r.classIds || []).length && classId && !r.classIds.includes(classId)) return false;
  if (r.disponibleDu && dateISO && dateISO < r.disponibleDu) return false;
  if (r.disponibleAu && dateISO && dateISO > r.disponibleAu) return false;
  return true;
}

export function pourApprenant(ressources = [], { classId, aujourdhui } = {}) {
  return ressources
    .filter((r) => estDisponible(r, classId, aujourdhui))
    .map((r) => ({
      id: r.id, titre: r.titre, type: r.type, typeLabel: RESSOURCE_TYPES[r.type]?.label || r.type,
      moduleId: r.moduleId, description: r.description || "",
      dureeMoyenneMinutes: r.dureeMoyenneMinutes ?? null,
      obligatoire: !!r.obligatoire, aDistance: !!r.aDistance,
      // L'URL n'est PAS servie ici : on la délivre à l'ouverture, ce qui est le
      // moment où la consultation se trace. Une liste qui porte les liens permet
      // de tout télécharger sans qu'aucune trace n'existe.
    }));
}

// --- Suivi à distance ---------------------------------------------------------

// Ce qui compte comme élément probant pour une séance à distance. On distingue
// TROIS niveaux, parce que les confondre est exactement l'erreur à éviter.
export const NIVEAUX_PREUVE = {
  aucun: { label: "Aucun élément", justifie: false },
  consultation: {
    label: "Consultation seule",
    justifie: false,
    // Le point dur, énoncé dans la donnée elle-même.
    reserve: "Une consultation atteste d'un accès, pas d'un temps de formation. Elle ne justifie pas d'heures devant un financeur.",
  },
  travail: { label: "Travail rendu ou évaluation", justifie: true },
};

// Bilan d'une séance à distance, apprenant par apprenant.
// `preuves` = traces horodatées : consultations ET travaux rendus.
export function suiviSeance({ seance = {}, inscrits = [], preuves = [] } = {}) {
  const parApprenant = new Map(inscrits.map((id) => [id, { learnerId: id, consultations: 0, travaux: 0 }]));
  for (const p of preuves) {
    if (p.seanceId && seance.id && p.seanceId !== seance.id) continue;
    const e = parApprenant.get(p.learnerId);
    if (!e) continue;
    if (p.probant) e.travaux++;
    else e.consultations++;
  }
  const lignes = [...parApprenant.values()].map((e) => {
    const niveau = e.travaux ? "travail" : e.consultations ? "consultation" : "aucun";
    return { ...e, niveau, justifie: NIVEAUX_PREUVE[niveau].justifie };
  });
  const justifies = lignes.filter((l) => l.justifie).length;
  return {
    seanceId: seance.id || null, date: seance.date || null,
    modalite: seance.modalite || "presentiel",
    inscrits: inscrits.length, justifies,
    // Ceux qu'on croirait suivis parce qu'ils ont cliqué : c'est LE chiffre à
    // regarder, parce que c'est celui qu'un LMS naïf compterait comme présents.
    consultationSeule: lignes.filter((l) => l.niveau === "consultation").length,
    sansTrace: lignes.filter((l) => l.niveau === "aucun").length,
    lignes,
    // On ne dit jamais « assidu » : l'assiduité se constate sur la feuille
    // d'émargement, qui reste le document probant. Ici on dit ce qui est
    // JUSTIFIABLE, ce qui n'est pas la même chose.
    reserve: "Ces éléments justifient la réalisation d'une activité à distance. Ils ne remplacent pas l'émargement et ne valent pas constat d'assiduité.",
  };
}

// --- Conformité du dispositif à distance (indicateur 19 + art. D. 6313-3-1) ---

export function conformiteFoad({ dispositif = {}, ressources = [], seancesDistance = 0 } = {}) {
  const manques = [];

  // Indicateur 19 nomme explicitement le référent pédagogique.
  if (!String(dispositif.referentPedagogique || "").trim()) {
    manques.push({
      composante: "assistance", gravite: "bloquant",
      message: "Aucun référent pédagogique désigné : l'indicateur 19 le nomme explicitement, et l'article D. 6313-3-1 exige une assistance identifiée.",
    });
  }
  if (!String(dispositif.modalitesAssistance || "").trim()) {
    manques.push({
      composante: "assistance", gravite: "important",
      message: "Modalités d'assistance non décrites : un référent que le bénéficiaire ne sait pas joindre n'est pas une assistance.",
    });
  }

  // 2° : information sur les activités ET leur durée moyenne.
  const aDistance = ressources.filter((r) => r.aDistance);
  const sansDuree = aDistance.filter((r) => r.dureeMoyenneMinutes == null);
  if (sansDuree.length) {
    manques.push({
      composante: "information", gravite: "bloquant",
      message: `${sansDuree.length} activité(s) à distance sans durée moyenne annoncée : sans elle, le bénéficiaire n'est pas informé et les heures ne sont pas convertibles.`,
    });
  }

  // 3° : des évaluations qui JALONNENT, pas seulement une épreuve finale.
  const jalons = ressources.filter((r) => RESSOURCE_TYPES[r.type]?.probant);
  if (seancesDistance > 0 && !jalons.length) {
    manques.push({
      composante: "evaluations", gravite: "bloquant",
      message: "Aucun exercice ni évaluation jalonnant le parcours à distance : rien ne produit d'élément probant, donc rien ne justifie les heures.",
    });
  }

  return {
    composantes: Object.entries(COMPOSANTES_FOAD).map(([cle, c]) => ({
      cle, ...c,
      couverte: !manques.some((m) => m.composante === cle && m.gravite === "bloquant"),
      manques: manques.filter((m) => m.composante === cle),
    })),
    seancesDistance,
    activitesADistance: aDistance.length,
    elementsProbants: jalons.length,
    manques,
    conforme: !manques.some((m) => m.gravite === "bloquant"),
    reserve: "Les composantes vérifiées sont celles de l'article D. 6313-3-1. Les attentes des financeurs en matière de preuve varient d'un OPCO à l'autre : ce contrôle ne les remplace pas.",
  };
}

// Volume d'heures à distance déclarables, et ce qui les justifie. C'est le
// chiffre qui finit sur une facture : il ne se déduit pas d'un nombre de clics.
export function heuresJustifiables(suivis = []) {
  const total = suivis.reduce((a, s) => a + s.inscrits, 0);
  const justifies = suivis.reduce((a, s) => a + s.justifies, 0);
  const clics = suivis.reduce((a, s) => a + s.consultationSeule, 0);
  return {
    // `nbSeances` et non `seances` : ce résumé est destiné à être fusionné avec la
    // liste des séances dans une même réponse. Nommer le compteur « seances »
    // écrasait silencieusement le tableau — l'écran recevait un nombre et
    // plantait sur .map(). Attrapé par les tests, pas par la relecture.
    nbSeances: suivis.length, participations: total, justifiees: justifies,
    consultationSeule: clics, sansTrace: total - justifies - clics,
    taux: total ? Math.round((justifies / total) * 100) : null,
    // Formulé comme un risque, pas comme un score : c'est ce qui serait repris
    // en contrôle de service fait.
    risque: total && justifies < total
      ? `${total - justifies} participation(s) à distance sans élément probant : autant d'heures qui pourraient être écartées en contrôle de service fait.`
      : null,
  };
}

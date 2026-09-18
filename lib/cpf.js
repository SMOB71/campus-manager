// Compte personnel de formation — logique pure, aucune I/O.
//
// CE QUI DÉCIDE DE TOUT, ET QUI N'EST PAS UN PARAMÉTRAGE :
//
//   LE SERVICE FAIT CONDITIONNE LE PAIEMENT, ET IL SE PROUVE PAR L'ASSIDUITÉ.
//
// Le financeur ne paie pas une formation vendue, il paie une formation
// RÉALISÉE. C'est pourquoi ce module ne comporte AUCUN champ « heures
// réalisées » à saisir : le chiffre est lu dans les feuilles d'émargement
// CLOSES, celles de la chaîne scellée. Un organisme qui déclare un service fait
// à la main déclare ce qu'il souhaite ; celui qui le lit dans son émargement
// déclare ce qui s'est passé — et c'est le second qui tient en contrôle.
//
// LES QUATRE CONDITIONS D'ÉLIGIBILITÉ, DANS L'ORDRE OÙ ELLES BLOQUENT :
//
//   1. La certification qualité. Sans elle, aucun financement mutualisé : ce
//      n'est pas une formalité préalable, c'est la condition d'existence.
//   2. Une certification PROFESSIONNELLE enregistrée. Seules les formations
//      certifiantes sont éligibles — un atelier de perfectionnement, si utile
//      soit-il, ne se vend pas sur ce dispositif.
//   3. L'habilitation à préparer cette certification, quand l'organisme n'en
//      est pas le propriétaire.
//   4. La publication de l'offre. Une offre non publiée n'existe pas pour le
//      bénéficiaire, quelle que soit sa qualité.
//
// LE PIÈGE DE CALENDRIER, DE LA MÊME FAMILLE QUE LE GUICHET DE LA TAXE :
//
//   Un dossier ne peut pas être déposé la veille de l'entrée en formation. Il
//   existe un délai minimal entre l'inscription du bénéficiaire et le début de
//   la session — et une session qui démarre trop tôt après l'inscription n'est
//   pas finançable. On ne le découvre pas en le tentant : on le vérifie avant
//   de publier les dates.
//
// ⚠️ Délais, participation forfaitaire du bénéficiaire et modalités de dépôt
// sont fixés par voie réglementaire et ont changé plusieurs fois depuis 2019.
// Les valeurs ci-dessous sont PARAMÉTRABLES et à revérifier auprès du
// financeur : les figer dans le code garantirait qu'elles soient fausses.

const jour = 864e5;
const ecart = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Délai minimal entre l'inscription et l'entrée en formation. Paramétrable :
// c'est une règle du financeur, pas une constante de la nature.
export const DELAI_ENTREE_JOURS = 11;
// Participation forfaitaire laissée au bénéficiaire, hors cas d'exonération.
export const PARTICIPATION_DEFAUT = 100;

export const REPERTOIRES = {
  rncp: "Répertoire national des certifications professionnelles",
  rs: "Répertoire spécifique",
};

// Cycle de vie d'un dossier. `ouvert` = le dossier attend quelque chose de
// l'organisme ; c'est ce qui distingue une file d'attente d'un historique.
export const ETATS = {
  demande: { label: "Demande du bénéficiaire", ouvert: true },
  accepte: { label: "Acceptée par l'organisme", ouvert: true },
  refuse: { label: "Refusée", ouvert: false },
  annule: { label: "Annulée", ouvert: false },
  en_formation: { label: "En formation", ouvert: true },
  service_fait: { label: "Service fait déclaré", ouvert: true },
  paye: { label: "Payé", ouvert: false },
};

// --- Éligibilité de l'offre --------------------------------------------------

export function verifierEligibilite({ qualiopi = null, offre = {}, certification = null, aujourdhui } = {}) {
  const manques = [];

  // 1. La certification qualité — condition d'existence, pas formalité.
  if (!qualiopi?.valideJusquau) {
    manques.push({ cle: "qualiopi", gravite: "bloquant",
      message: "Aucune certification qualité renseignée : sans elle, aucun financement mutualisé n'est possible." });
  } else if (aujourdhui && qualiopi.valideJusquau < aujourdhui) {
    manques.push({ cle: "qualiopi_expire", gravite: "bloquant",
      message: `Certification qualité expirée le ${qualiopi.valideJusquau} : les dossiers en cours ne seront pas payés.` });
  }

  // 2. Une certification professionnelle enregistrée.
  if (!REPERTOIRES[offre.repertoire] || !String(offre.codeCertification || "").trim()) {
    manques.push({ cle: "certification", gravite: "bloquant",
      message: "Aucune certification enregistrée rattachée : seules les formations certifiantes sont éligibles. Un atelier de perfectionnement ne se vend pas sur ce dispositif, quelle que soit sa qualité." });
  }

  // 3. L'habilitation à préparer cette certification.
  if (certification && certification.peutPresenter === false) {
    manques.push({ cle: "habilitation", gravite: "bloquant",
      message: "L'organisme n'est pas en mesure de présenter les candidats à cette certification : le financement suppose qu'elle puisse être passée." });
  }
  if (!certification && REPERTOIRES[offre.repertoire]) {
    manques.push({ cle: "habilitation_inconnue", gravite: "important",
      message: "Aucune habilitation déclarée pour cette certification : vérifier que l'organisme peut bien y présenter." });
  }

  // 4. La publication.
  if (!offre.publiee) {
    manques.push({ cle: "publication", gravite: "important",
      message: "Offre non publiée : elle n'existe pas pour le bénéficiaire." });
  }

  return {
    manques,
    eligible: !manques.some((m) => m.gravite === "bloquant"),
    reserve: "L'éligibilité s'apprécie aussi au regard des règles du financeur, qui évoluent. Ce contrôle porte sur ce que l'application peut constater.",
  };
}

// --- Dossier d'un bénéficiaire ------------------------------------------------

export function validateDossier(d = {}, { delaiEntree = DELAI_ENTREE_JOURS } = {}) {
  const errors = [], warnings = [];
  if (!d.beneficiaire) errors.push("bénéficiaire requis");
  if (!d.offreId) errors.push("offre requise");
  if (d.etat && !ETATS[d.etat]) errors.push("état inconnu");
  if (!d.dateInscription) errors.push("date d'inscription requise : c'est elle qui fait courir le délai d'entrée");
  if (!d.dateDebut) errors.push("date de début de session requise");

  // LE PIÈGE DE CALENDRIER. On le vérifie AVANT de publier les dates, pas au
  // moment du dépôt.
  if (d.dateInscription && d.dateDebut) {
    const delai = ecart(d.dateInscription, d.dateDebut);
    if (delai < 0) errors.push("la session démarre avant l'inscription");
    else if (delai < delaiEntree) {
      errors.push(`${delai} jour(s) entre l'inscription et l'entrée en formation, pour un minimum de ${delaiEntree} : la session ne serait pas finançable. Décaler le début, ou avancer l'inscription.`);
    }
  }
  const prix = Number(d.prix);
  if (d.prix != null && (!Number.isFinite(prix) || prix < 0)) errors.push("prix invalide");
  if (d.etat === "service_fait" && !d.serviceFaitLe) warnings.push("service fait déclaré sans date");
  return { ok: errors.length === 0, errors, warnings };
}

// --- LE SERVICE FAIT : LU, JAMAIS SAISI ---------------------------------------
//
// `feuilles` = les feuilles d'émargement CLOSES de la session. On ne prend que
// celles-là : une feuille ouverte est modifiable, donc elle ne prouve rien.

export function serviceFait({ dossier = {}, feuilles = [], stats = null } = {}) {
  const closes = feuilles.filter((f) => f.status === "locked");
  const ignorees = feuilles.length - closes.length;

  let prevues = 0, realisees = 0;
  for (const f of closes) {
    const s = stats ? stats(f) : f.stats;
    if (!s) continue;
    const dureeMin = (s.plannedMinutes || 0) / Math.max(1, s.total || 1);
    // On raisonne sur LE bénéficiaire du dossier, pas sur la moyenne du groupe :
    // un service fait est individuel, et deux apprenants d'une même session
    // n'ont pas la même assiduité.
    const e = (f.entries || []).find((x) => x.learnerId === dossier.learnerId);
    if (!e) continue;
    prevues += dureeMin;
    if (e.status === "present") realisees += dureeMin;
    else if (e.status === "retard") realisees += Math.max(0, dureeMin - (Number(e.minutesLate) || 0));
  }

  const heuresPrevues = round2(prevues / 60), heuresRealisees = round2(realisees / 60);
  const taux = prevues ? Math.round((realisees / prevues) * 100) : null;
  return {
    heuresPrevues, heuresRealisees, taux,
    feuillesRetenues: closes.length, feuillesIgnorees: ignorees,
    // Une feuille non close ne prouve rien : elle reste modifiable.
    alerte: ignorees ? {
      gravite: "important", code: "feuilles_ouvertes",
      message: `${ignorees} feuille(s) d'émargement non closes ne sont pas comptées : tant qu'elles sont modifiables, elles ne prouvent rien.`,
    } : null,
    // On ne calcule PAS le montant à facturer : il dépend des règles du
    // financeur et d'un éventuel prorata. On fournit la matière, pas la facture.
    reserve: "Ces heures sont lues dans les feuilles d'émargement closes. Elles ne se saisissent pas : un service fait déclaré à la main déclare ce qu'on souhaite, pas ce qui s'est passé.",
  };
}

// Le dossier est-il déclarable ? C'est la question qui précède l'envoi.
export function peutDeclarerServiceFait(dossier = {}, service = {}) {
  if (!["en_formation", "accepte"].includes(dossier.etat)) {
    return { autorise: false, motif: "seul un dossier en formation donne lieu à une déclaration de service fait" };
  }
  if (!service.feuillesRetenues) {
    return { autorise: false, motif: "aucune feuille d'émargement close : rien ne prouve que la formation a eu lieu" };
  }
  if (service.taux != null && service.taux < 100) {
    // On n'interdit pas : une assiduité partielle se déclare, au prorata. Mais
    // elle se déclare en connaissance de cause.
    return {
      autorise: true, partiel: true,
      motif: `assiduité de ${service.taux} % : le service fait sera partiel, et le financement calculé au prorata des heures réalisées.`,
    };
  }
  return { autorise: true };
}

// --- Reste à charge -----------------------------------------------------------
// La participation du bénéficiaire ne s'applique pas à tout le monde : la
// présenter comme systématique ferait renoncer des candidats qui en sont exonérés.

export const EXONERATIONS = {
  demandeur_emploi: "Demandeur d'emploi",
  abondement_employeur: "Abondement de l'employeur",
  aucune: "Aucune",
};

export function resteACharge({ prix, droitsDisponibles = 0, exoneration = "aucune", participation = PARTICIPATION_DEFAUT } = {}) {
  const p = Number(prix) || 0;
  const droits = Math.max(0, Number(droitsDisponibles) || 0);
  const couvert = Math.min(p, droits);
  const complement = round2(p - couvert);
  const forfait = exoneration && exoneration !== "aucune" ? 0 : Number(participation) || 0;
  return {
    prix: round2(p), droitsMobilises: round2(couvert),
    complementAFinancer: complement,
    participationForfaitaire: forfait,
    exoneration, exonerationLabel: EXONERATIONS[exoneration] || null,
    resteACharge: round2(complement + forfait),
    reserve: "Le montant et les cas d'exonération de la participation forfaitaire sont fixés par voie réglementaire et ont changé plusieurs fois : à revérifier avant de l'annoncer à un candidat.",
  };
}

// --- Vue d'ensemble -----------------------------------------------------------

export function tableauDeBord(dossiers = [], { aujourdhui, delaiEntree = DELAI_ENTREE_JOURS } = {}) {
  const lignes = dossiers.map((d) => {
    const v = validateDossier(d, { delaiEntree });
    const e = ETATS[d.etat] || ETATS.demande;
    return {
      ...d, etatLabel: e.label, ouvert: e.ouvert,
      alertes: v.errors.map((m) => ({ gravite: "bloquant", message: m })),
    };
  });
  const ouverts = lignes.filter((l) => l.ouvert);
  return {
    total: lignes.length, ouverts: ouverts.length,
    enAttente: lignes.filter((l) => l.etat === "demande").length,
    aDeclarer: lignes.filter((l) => l.etat === "en_formation").length,
    payes: lignes.filter((l) => l.etat === "paye").length,
    montantOuvert: round2(ouverts.reduce((a, l) => a + (Number(l.prix) || 0), 0)),
    bloquants: lignes.reduce((a, l) => a + l.alertes.length, 0),
    lignes,
    reserve: "Ce suivi porte sur ce que l'application connaît des dossiers. Il ne remplace pas la plateforme du financeur, qui fait foi.",
  };
}

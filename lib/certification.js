// Conditions de présentation à la certification — indicateur 16 du référentiel
// 2026 (décret n° 2026-728). Logique pure, aucune I/O.
//
// L'EXIGENCE : « Lorsque le prestataire met en œuvre des formations conduisant à
// une certification professionnelle, il s'assure que les conditions de
// présentation des bénéficiaires à la certification respectent les exigences
// formelles de l'autorité de certification. »
//
// CE QUI SE JOUE VRAIMENT, ET QUI N'EST PAS UNE FORMALITÉ :
//
//   UN ORGANISME NON HABILITÉ NE PEUT PAS PRÉSENTER SES CANDIDATS. Deux ans de
//   formation, des contrats d'apprentissage, des financements — et personne ne
//   passe l'épreuve. L'habilitation a une DATE DE FIN, et elle se renouvelle
//   auprès du certificateur, pas toute seule. C'est le seul manquement de cette
//   liste qui ne se rattrape pas après coup.
//
// LE SECOND PIÈGE EST UN PIÈGE DE CALENDRIER, DE LA MÊME FAMILLE QUE LA TAXE
// D'APPRENTISSAGE : la date limite d'INSCRIPTION à l'examen tombe des mois
// avant l'épreuve. On pense à la certification quand la session approche ; le
// guichet, lui, a fermé en janvier. D'où une alerte calée sur la date limite
// d'inscription, jamais sur la date d'épreuve.
//
// CE MODULE NE DIT PAS CE QUE LE CERTIFICATEUR EXIGE. Chaque autorité a ses
// règles, et les inventer produirait une liste fausse présentée comme
// réglementaire. L'organisme SAISIT les exigences formelles qu'on lui a
// notifiées ; le module vérifie qu'elles sont déclarées, datées, et respectées
// à temps. C'est cette tenue-là qui est auditée.

const jour = 864e5;
const jours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);

// Comment l'organisme est autorisé à présenter des candidats. Le régime change
// ce qu'il faut pouvoir montrer : un partenariat se prouve par une convention,
// une habilitation par sa notification.
export const REGIMES = {
  autorite: {
    label: "Organisme certificateur lui-même",
    preuve: "dépôt de la certification au RNCP ou au répertoire spécifique",
  },
  habilitation: {
    label: "Habilité par le certificateur",
    preuve: "notification d'habilitation du certificateur, avec sa date de fin",
  },
  partenariat: {
    label: "Partenaire du certificateur",
    preuve: "convention de partenariat signée, en cours de validité",
  },
  prepare_seulement: {
    // Cas très différent des trois autres : l'organisme prépare mais ne présente
    // pas. Ce n'est pas un manquement — à condition que ce soit dit au public,
    // parce qu'un candidat qui découvre après coup qu'il doit s'inscrire
    // lui-même en candidat libre a été mal informé.
    label: "Prépare sans présenter (le candidat s'inscrit lui-même)",
    preuve: "mention explicite dans l'information au public (indicateur 1)",
  },
};

export const ETATS = {
  a_declarer: "À déclarer",
  valide: "Valide",
  expire: "Expirée",
  suspendue: "Suspendue",
};

export function validateHabilitation(h = {}) {
  const errors = [], warnings = [];
  if (!REGIMES[h.regime]) errors.push(`régime requis (${Object.keys(REGIMES).join(", ")})`);
  if (!String(h.certificateur || "").trim() && h.regime !== "autorite") {
    errors.push("autorité de certification non désignée — c'est elle qui fixe les exigences formelles à respecter");
  }
  // Une habilitation ou un partenariat sans date de fin, c'est une habilitation
  // dont personne ne surveille l'échéance.
  if (["habilitation", "partenariat"].includes(h.regime)) {
    if (!h.reference) errors.push("référence de la notification ou de la convention requise");
    if (!h.dateFin) errors.push("date de fin de validité requise : sans elle, l'expiration ne peut pas être surveillée");
  }
  if (h.dateDebut && h.dateFin && h.dateFin < h.dateDebut) errors.push("fin antérieure au début");
  if (!(h.exigences || []).length && h.regime !== "prepare_seulement") {
    warnings.push("aucune exigence formelle du certificateur n'est déclarée : l'indicateur 16 porte précisément sur leur respect");
  }
  return { ok: errors.length === 0, errors, warnings };
}

// État d'une habilitation à une date donnée.
export function etatHabilitation(h = {}, aujourdhui, { preavisJours = 120 } = {}) {
  if (!h || !h.regime) return { etat: "a_declarer", peutPresenter: null, alertes: [
    { gravite: "bloquant", code: "non_declare",
      message: "Aucun régime de présentation déclaré : on ne sait pas si cet organisme peut présenter ses candidats à la certification." },
  ] };

  const alertes = [];
  if (h.regime === "prepare_seulement") {
    return { etat: "valide", peutPresenter: false, alertes: [{
      gravite: "conseille", code: "prepare_seulement",
      message: "L'organisme prépare sans présenter : les candidats s'inscrivent eux-mêmes. Cette information doit figurer dans l'information au public, sinon ils le découvriront trop tard.",
    }] };
  }
  if (h.suspendue) {
    return { etat: "suspendue", peutPresenter: false, alertes: [{
      gravite: "bloquant", code: "suspendue",
      message: `Habilitation suspendue${h.motifSuspension ? ` : ${h.motifSuspension}` : ""}. Aucun candidat ne peut être présenté tant qu'elle ne l'est plus.`,
    }] };
  }

  const reste = h.dateFin ? jours(aujourdhui, h.dateFin) : null;
  if (reste != null && reste < 0) {
    return { etat: "expire", peutPresenter: false, restant: reste, alertes: [{
      gravite: "bloquant", code: "expiree",
      message: `Habilitation expirée depuis le ${h.dateFin}. Les candidats ne peuvent plus être présentés : c'est la promotion entière qui est concernée, pas un dossier.`,
    }] };
  }
  if (reste != null && reste <= preavisJours) {
    alertes.push({
      gravite: "important", code: "echeance",
      message: `Habilitation valable jusqu'au ${h.dateFin} (${reste} jour(s)). Le renouvellement se demande au certificateur et prend du temps : engagé trop tard, il laisse une session sans candidats présentables.`,
    });
  }
  return { etat: "valide", peutPresenter: true, restant: reste, alertes };
}

// --- Session d'examen : les candidats ont-ils été présentés dans les règles ? ---

export function validateSession(s = {}) {
  const errors = [];
  if (!s.dateEpreuve) errors.push("date d'épreuve requise");
  if (s.dateLimiteInscription && s.dateEpreuve && s.dateLimiteInscription > s.dateEpreuve) {
    errors.push("date limite d'inscription postérieure à l'épreuve");
  }
  return { ok: errors.length === 0, errors };
}

// Contrôle d'une session. `candidats` = les inscrits présentés, `exigences` =
// ce que le certificateur impose, tel que l'organisme l'a saisi.
export function controlerSession(session = {}, habilitation = {}, aujourdhui, { preavisJours = 45 } = {}) {
  const alertes = [];
  const hab = etatHabilitation(habilitation, aujourdhui);

  // L'habilitation se juge À LA DATE DE L'ÉPREUVE, pas aujourd'hui : une
  // habilitation valable ce matin mais expirée en juin ne présentera personne
  // en juin, et c'est maintenant qu'il faut le voir.
  const habALEpreuve = etatHabilitation(habilitation, session.dateEpreuve || aujourdhui);
  if (habALEpreuve.peutPresenter === false && hab.peutPresenter !== false) {
    alertes.push({
      gravite: "bloquant", code: "habilitation_expire_avant_epreuve",
      message: `L'habilitation expire avant l'épreuve du ${session.dateEpreuve} : valable aujourd'hui, elle ne le sera plus le jour de la session.`,
    });
  }
  alertes.push(...hab.alertes);

  // Le piège de calendrier : l'inscription ferme bien avant l'épreuve.
  const limite = session.dateLimiteInscription;
  if (!limite) {
    alertes.push({ gravite: "important", code: "limite_inconnue",
      message: "Date limite d'inscription non renseignée : c'est elle qui conditionne tout, et elle tombe souvent plusieurs mois avant l'épreuve." });
  } else {
    const reste = jours(aujourdhui, limite);
    if (!session.inscriptionFaiteLe && reste < 0) {
      alertes.push({ gravite: "bloquant", code: "inscription_manquee",
        message: `Date limite d'inscription dépassée depuis le ${limite} et aucune inscription enregistrée. Une session manquée ne se rattrape pas : les candidats attendront la suivante.` });
    } else if (!session.inscriptionFaiteLe && reste <= preavisJours) {
      alertes.push({ gravite: "important", code: "inscription_a_faire",
        message: `Inscription à déposer avant le ${limite} (${reste} jour(s)).` });
    } else if (session.inscriptionFaiteLe && limite && session.inscriptionFaiteLe > limite) {
      alertes.push({ gravite: "important", code: "inscription_hors_delai",
        message: `Inscription déposée le ${session.inscriptionFaiteLe}, après la date limite du ${limite} : vérifier qu'elle a bien été acceptée.` });
    }
  }

  // Les exigences formelles, telles que l'organisme les a déclarées. On ne juge
  // pas leur contenu — on constate ce qui n'est pas coché.
  const exigences = (habilitation.exigences || []).map((e) => ({
    ...e, satisfaite: !!(session.exigencesSatisfaites || {})[e.id],
  }));
  const manquantes = exigences.filter((e) => !e.satisfaite);
  if (manquantes.length) {
    alertes.push({
      gravite: session.statut === "tenue" || session.statut === "deliberee" ? "bloquant" : "important",
      code: "exigences_non_satisfaites",
      message: `${manquantes.length} exigence(s) du certificateur non confirmée(s) : ${manquantes.map((e) => e.libelle).join(" ; ")}.`,
    });
  }

  const bloquants = alertes.filter((a) => a.gravite === "bloquant");
  return {
    sessionId: session.id || null, dateEpreuve: session.dateEpreuve || null,
    dateLimiteInscription: limite || null,
    habilitation: hab.etat, peutPresenter: habALEpreuve.peutPresenter,
    exigences, manquantes: manquantes.length,
    alertes,
    // « Conforme » ne se décrète pas : on dit qu'aucun obstacle connu ne
    // s'oppose à la présentation, ce qui n'est pas la même chose.
    presentable: bloquants.length === 0,
    bloquants: bloquants.length,
  };
}

// Vue d'ensemble pour un campus : c'est ce qu'un responsable pédagogique
// regarde en septembre pour ne pas découvrir le problème en juin.
export function tableauDeBord(certifications = [], aujourdhui) {
  const lignes = certifications.map((c) => {
    const hab = etatHabilitation(c.habilitation, aujourdhui);
    const sessions = (c.sessions || []).map((s) => controlerSession(s, c.habilitation || {}, aujourdhui));
    return {
      curriculumId: c.curriculumId || null, intitule: c.intitule || "",
      codeRncp: c.codeRncp || null,
      regime: c.habilitation?.regime || null,
      regimeLabel: REGIMES[c.habilitation?.regime]?.label || "Non déclaré",
      etat: hab.etat, peutPresenter: hab.peutPresenter, restant: hab.restant ?? null,
      alertes: hab.alertes, sessions,
      bloquants: hab.alertes.filter((a) => a.gravite === "bloquant").length
        + sessions.reduce((a, s) => a + s.bloquants, 0),
    };
  });
  return {
    total: lignes.length,
    // Le chiffre qui compte : combien de certifications ne peuvent pas être
    // présentées en l'état.
    empechees: lignes.filter((l) => l.peutPresenter === false).length,
    bloquants: lignes.reduce((a, l) => a + l.bloquants, 0),
    lignes: lignes.sort((a, b) => b.bloquants - a.bloquants),
    reserve: "Les exigences formelles sont celles que l'organisme a saisies d'après les notifications du certificateur. L'application ne les connaît pas : elle vérifie qu'elles sont déclarées, datées et suivies.",
  };
}

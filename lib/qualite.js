// Réclamations et sous-traitance — logique pure (aucune I/O).
//
// Deux registres que le référentiel national qualité exige et qui n'existaient
// nulle part dans l'application. Ils ont ceci en commun : ce n'est pas leur
// contenu qui est contrôlé, c'est leur TENUE. Un registre vide chez un
// organisme qui forme trois cents apprentis n'est pas la preuve qu'il n'y a eu
// aucune réclamation — c'est la preuve qu'on ne les enregistre pas.
//
// RÉCLAMATIONS — ce qui est regardé, dans l'ordre : la réclamation est-elle
// tracée, a-t-elle reçu une RÉPONSE, dans quel DÉLAI, et l'organisme en a-t-il
// tiré quelque chose. Le dernier point est celui qu'on oublie : une réclamation
// close sans aucune action est traitée, pas exploitée.
//
// SOUS-TRAITANCE — l'organisme donneur d'ordre reste responsable de la
// prestation. Il doit donc pouvoir montrer QUI intervient, sur QUEL périmètre,
// et que le sous-traitant est lui-même en règle. Un sous-traitant qui réalise
// des actions financées sans être certifié fait tomber la prise en charge, et
// c'est le donneur d'ordre qui rembourse.

const jour = 864e5;
const ecart = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);

// ------------------------------------------------------------- Réclamations

export const RECLAMATION_ORIGINES = {
  apprenant: "Apprenant ou stagiaire",
  representant: "Représentant légal",
  entreprise: "Entreprise ou maître d'apprentissage",
  financeur: "Financeur",
  formateur: "Formateur ou intervenant",
  autre: "Autre",
};

export const RECLAMATION_NATURES = {
  pedagogique: "Pédagogie et contenus",
  organisation: "Organisation, planning, locaux",
  administratif: "Administratif, contrat, facturation",
  relationnel: "Relations et comportement",
  accessibilite: "Accessibilité et aménagements",
  certification: "Examens et certification",
  autre: "Autre",
};

// Un « appel » n'est pas une réclamation : c'est la contestation d'une décision
// (note, exclusion, refus d'aménagement). Le référentiel les demande tous les
// deux, et ils ne se traitent pas pareil.
export const RECLAMATION_KINDS = { reclamation: "Réclamation", appel: "Appel d'une décision" };

export const RECLAMATION_STATUTS = {
  recue: "Reçue",
  en_cours: "En cours de traitement",
  repondue: "Réponse apportée",
  close: "Close",
  irrecevable: "Irrecevable",
};

// Délai de réponse que l'organisme s'engage à tenir. Rien ne l'impose par la
// loi ; ce qui est contrôlé, c'est qu'un délai soit annoncé et tenu.
export const DELAI_REPONSE_JOURS = 15;

export function validateReclamation(r = {}) {
  const errors = [], warnings = [];
  if (!r.date) errors.push("date de réception requise");
  if (!RECLAMATION_ORIGINES[r.origine]) errors.push(`origine requise (${Object.keys(RECLAMATION_ORIGINES).join(", ")})`);
  if (!RECLAMATION_NATURES[r.nature]) errors.push("nature requise");
  if (!String(r.objet || "").trim()) errors.push("objet requis");
  if (r.statut && !RECLAMATION_STATUTS[r.statut]) errors.push("statut inconnu");
  if (r.kind && !RECLAMATION_KINDS[r.kind]) errors.push("type inconnu (réclamation ou appel)");

  // Une clôture sans réponse écrite, c'est un dossier rangé, pas traité.
  if (["repondue", "close"].includes(r.statut) && !String(r.reponse || "").trim()) {
    errors.push("une réclamation déclarée répondue ou close doit porter la réponse apportée");
  }
  if (["repondue", "close"].includes(r.statut) && !r.dateReponse) {
    errors.push("date de réponse requise pour clore une réclamation");
  }
  if (r.dateReponse && r.date && r.dateReponse < r.date) {
    errors.push("la réponse ne peut pas précéder la réclamation");
  }
  // Le point qu'on oublie : traité n'est pas exploité.
  if (r.statut === "close" && !String(r.actionCorrective || "").trim()) {
    warnings.push("réclamation close sans action corrective — traitée, mais pas exploitée");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function etatReclamation(r = {}, aujourdhui, { delaiJours = DELAI_REPONSE_JOURS } = {}) {
  const close = ["repondue", "close", "irrecevable"].includes(r.statut);
  const delai = close ? ecart(r.date, r.dateReponse) : ecart(r.date, aujourdhui);
  const horsDelai = delai != null && delai > delaiJours;
  return {
    close, joursEcoules: delai, delaiJours,
    horsDelai,
    // Une réclamation ouverte hors délai est un écart en cours ; une réclamation
    // close hors délai est un écart constaté. Les deux se disent.
    alerte: horsDelai
      ? (close ? `Réponse apportée en ${delai} jours (engagement : ${delaiJours}).`
        : `Sans réponse depuis ${delai} jours (engagement : ${delaiJours}).`)
      : null,
  };
}

// Synthèse du registre : c'est elle qu'on présente en audit.
export function registreReclamations(items = [], aujourdhui, { delaiJours = DELAI_REPONSE_JOURS } = {}) {
  const etats = items.map((r) => ({ ...r, etat: etatReclamation(r, aujourdhui, { delaiJours }) }));
  const closes = etats.filter((r) => r.etat.close);
  const delais = closes.map((r) => r.etat.joursEcoules).filter((d) => d != null);
  return {
    total: etats.length,
    ouvertes: etats.length - closes.length,
    closes: closes.length,
    horsDelai: etats.filter((r) => r.etat.horsDelai).length,
    sansActionCorrective: etats.filter((r) => r.statut === "close" && !String(r.actionCorrective || "").trim()).length,
    delaiMoyen: delais.length ? Math.round((delais.reduce((s, d) => s + d, 0) / delais.length) * 10) / 10 : null,
    appels: etats.filter((r) => r.kind === "appel").length,
    parNature: Object.keys(RECLAMATION_NATURES).map((k) => ({ nature: k, label: RECLAMATION_NATURES[k], total: etats.filter((r) => r.nature === k).length })).filter((x) => x.total),
    items: etats,
  };
}

// ------------------------------------------------------------ Sous-traitance

export const SOUS_TRAITANCE_PERIMETRES = {
  pedagogique: "Animation pédagogique",
  certification: "Passage de certification",
  accompagnement: "Accompagnement et suivi",
  logistique: "Logistique et hébergement",
  autre: "Autre",
};

export function validateSousTraitant(s = {}) {
  const errors = [], warnings = [];
  if (!String(s.nom || "").trim()) errors.push("raison sociale requise");
  if (!SOUS_TRAITANCE_PERIMETRES[s.perimetre]) errors.push(`périmètre requis (${Object.keys(SOUS_TRAITANCE_PERIMETRES).join(", ")})`);
  if (!String(s.prestation || "").trim()) errors.push("description de la prestation requise");
  if (s.dateDebut && s.dateFin && s.dateFin < s.dateDebut) errors.push("date de fin antérieure à la date de début");

  if (!String(s.siret || "").trim()) warnings.push("SIRET non renseigné");
  if (!String(s.contrat || "").trim() && !s.documentId) warnings.push("aucun contrat de sous-traitance au dossier");
  // Le point qui coûte cher : le donneur d'ordre reste responsable.
  if (s.actionsFinancees && !s.certifie) {
    warnings.push("sous-traitant intervenant sur des actions financées sans certification qualité attestée — la prise en charge peut être refusée, et c'est le donneur d'ordre qui rembourse");
  }
  if (s.certifie && !s.numeroDeclaration) warnings.push("certification déclarée sans numéro de déclaration d'activité");
  return { ok: errors.length === 0, errors, warnings };
}

export function registreSousTraitance(items = [], aujourdhui) {
  const actifs = items.filter((s) => !s.dateFin || s.dateFin >= aujourdhui);
  return {
    total: items.length,
    actifs: actifs.length,
    // Ce que l'auditeur cherche en premier.
    aRisque: items.filter((s) => s.actionsFinancees && !s.certifie).map((s) => s.nom),
    sansContrat: items.filter((s) => !String(s.contrat || "").trim() && !s.documentId).map((s) => s.nom),
    parPerimetre: Object.keys(SOUS_TRAITANCE_PERIMETRES)
      .map((k) => ({ perimetre: k, label: SOUS_TRAITANCE_PERIMETRES[k], total: items.filter((s) => s.perimetre === k).length }))
      .filter((x) => x.total),
  };
}

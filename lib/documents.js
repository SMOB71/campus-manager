// Documents obligatoires de l'organisme de formation — logique pure, aucune I/O.
//
// CE QUE CE MODULE COUVRE, ET POURQUOI C'EST OBLIGATOIRE :
//
//   • RÈGLEMENT INTÉRIEUR — art. L. 6352-3 et R. 6352-1 et suivants. Tout
//     organisme de formation en établit un. Il n'est pas facultatif et son
//     contenu est fixé : hygiène et sécurité, règles disciplinaires, échelle
//     des sanctions, garanties de procédure, et représentation des stagiaires.
//
//   • PROGRAMME DE FORMATION — art. L. 6353-1. Les actions sont réalisées
//     « conformément à un programme PRÉÉTABLI » précisant les objectifs, le
//     niveau de connaissances préalables requis, les moyens pédagogiques,
//     techniques et d'encadrement, et les modalités d'évaluation.
//
//   • CONVENTION ou CONTRAT DE FORMATION — art. L. 6353-2 et L. 6353-3. Deux
//     documents distincts, et le choix n'en est pas un.
//
// LA DISTINCTION QUI COMMANDE TOUT, ET QUI EST JURIDIQUE AVANT D'ÊTRE
// DOCUMENTAIRE :
//
//   La CONVENTION lie l'organisme à un ACHETEUR — une entreprise, un OPCO, une
//   collectivité. Le CONTRAT DE FORMATION lie l'organisme à une PERSONNE
//   PHYSIQUE qui entreprend la formation à titre individuel et À SES FRAIS.
//
//   Ce n'est pas une variante de mise en forme : le contrat ouvre au
//   bénéficiaire des protections que la convention ne porte pas — délai de
//   rétractation, plafonnement du premier versement, remboursement au prorata.
//   Servir une convention à un particulier qui finance lui-même, c'est le
//   priver de ces droits, et l'acte est attaquable.
//
// LE PIÈGE QUI COÛTE LE PLUS CHER, ET QU'UN LOGICIEL FABRIQUE TRÈS FACILEMENT :
//
//   Sur un contrat de formation, AUCUNE SOMME NE PEUT ÊTRE EXIGÉE avant
//   l'expiration d'un délai de rétractation de DIX JOURS, et il ne peut ensuite
//   être encaissé PLUS DE 30 % du prix, le solde étant échelonné au fur et à
//   mesure du déroulement. Un échéancier « 50 % à la signature » saisi dans un
//   ERP produit un plan de facturation illicite, édité et envoyé sans que
//   personne ne s'en aperçoive. Le module REFUSE de le construire.
//
// ⚠️ Références et montants à revérifier avant mise en œuvre : ces articles ont
// évolué, et la pratique des financeurs s'y ajoute sans s'y substituer.

const jour = 864e5;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const vide = (v) => !String(v ?? "").trim();
const isoPlus = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * jour).toISOString().slice(0, 10);

// --- Régime du contrat de formation professionnelle --------------------------
export const RETRACTATION_JOURS = 10;      // art. L. 6353-5
export const PREMIER_VERSEMENT_MAX = 0.30; // art. L. 6353-6
// Au-delà de cette durée, l'élection de délégués des stagiaires est organisée.
export const SEUIL_DELEGUES_HEURES = 500;  // art. R. 6352-9

export const TYPES = {
  reglement: {
    cle: "reglement", label: "Règlement intérieur",
    base: "art. L. 6352-3 et R. 6352-1 s.", obligatoire: true,
    portee: "campus",
  },
  programme: {
    cle: "programme", label: "Programme de formation",
    base: "art. L. 6353-1", obligatoire: true,
    portee: "formation",
  },
  convention: {
    cle: "convention", label: "Convention de formation professionnelle",
    base: "art. L. 6353-2", obligatoire: true,
    portee: "acheteur",
  },
  contrat: {
    cle: "contrat", label: "Contrat de formation professionnelle",
    base: "art. L. 6353-3 à L. 6353-7", obligatoire: true,
    portee: "particulier",
  },
  livret: {
    cle: "livret", label: "Livret d'accueil",
    base: "référentiel qualité, indicateur 9", obligatoire: false,
    portee: "campus",
  },
  devis: {
    cle: "devis", label: "Devis",
    base: "usage commercial", obligatoire: false,
    portee: "acheteur",
  },
};

// --- Le choix convention / contrat : il se déduit, il ne se propose pas -------

export const PAYEURS = {
  entreprise: { label: "Entreprise ou personne morale", acte: "convention" },
  opco: { label: "OPCO ou financeur public", acte: "convention" },
  // Seul cas où le contrat de formation s'impose : la personne physique qui
  // entreprend la formation à titre individuel et à ses frais.
  particulier: { label: "Le bénéficiaire lui-même, à ses frais", acte: "contrat" },
};

export function acteRequis(payeur) {
  const p = PAYEURS[payeur];
  if (!p) return null;
  return {
    type: p.acte, label: TYPES[p.acte].label, base: TYPES[p.acte].base,
    motif: p.acte === "contrat"
      ? "Le bénéficiaire finance lui-même : le contrat de formation lui ouvre un délai de rétractation, un plafonnement du premier versement et un remboursement au prorata. Une convention ne porte aucune de ces protections."
      : "L'achat est fait par un tiers : la relation se noue avec l'acheteur, pas avec le bénéficiaire.",
  };
}

// --- Mentions obligatoires ---------------------------------------------------
// Chaque mention dit D'OÙ elle vient : une liste sans base juridique ne se
// défend pas, et personne ne sait ce qu'il risque à la laisser vide.

export const MENTIONS = {
  convention: [
    { cle: "intitule", label: "Intitulé de l'action", base: "R. 6353-1" },
    { cle: "objectifs", label: "Objectifs de l'action", base: "R. 6353-1" },
    { cle: "nature", label: "Nature de l'action (formation, bilan, VAE, apprentissage)", base: "R. 6353-1" },
    { cle: "dureeHeures", label: "Durée en heures", base: "R. 6353-1" },
    { cle: "dates", label: "Dates de début et de fin", base: "R. 6353-1" },
    { cle: "effectif", label: "Effectif concerné", base: "R. 6353-1" },
    { cle: "prix", label: "Prix et modalités de règlement", base: "R. 6353-1" },
    { cle: "moyens", label: "Moyens pédagogiques et techniques", base: "L. 6353-1" },
    { cle: "evaluation", label: "Modalités d'évaluation des résultats", base: "L. 6353-1" },
    { cle: "resiliation", label: "Conditions de dédit ou de résiliation", base: "R. 6353-1" },
    { cle: "acheteur", label: "Identité de l'acheteur", base: "L. 6353-2" },
  ],
  contrat: [
    { cle: "intitule", label: "Intitulé de l'action", base: "R. 6353-2" },
    { cle: "objectifs", label: "Objectifs de l'action", base: "R. 6353-2" },
    { cle: "nature", label: "Nature de l'action", base: "R. 6353-2" },
    { cle: "dureeHeures", label: "Durée en heures", base: "R. 6353-2" },
    { cle: "dates", label: "Dates de début et de fin", base: "R. 6353-2" },
    { cle: "effectif", label: "Effectif concerné", base: "R. 6353-2" },
    { cle: "moyens", label: "Moyens pédagogiques et techniques", base: "L. 6353-1" },
    { cle: "evaluation", label: "Modalités d'évaluation des résultats", base: "L. 6353-1" },
    { cle: "sanction", label: "Sanction de la formation (diplôme, titre, attestation)", base: "R. 6353-2" },
    { cle: "prix", label: "Prix et modalités de règlement échelonné", base: "R. 6353-2" },
    { cle: "beneficiaire", label: "Identité du bénéficiaire", base: "L. 6353-3" },
    // Propres au contrat : ce sont EUX qui protègent le bénéficiaire.
    { cle: "retractation", label: `Délai de rétractation de ${RETRACTATION_JOURS} jours`, base: "L. 6353-5", protege: true },
    { cle: "dedit", label: "Conséquences d'un abandon ou d'une cessation anticipée", base: "L. 6353-7", protege: true },
  ],
  programme: [
    { cle: "objectifs", label: "Objectifs déterminés", base: "L. 6353-1" },
    { cle: "prerequis", label: "Niveau de connaissances préalables requis", base: "L. 6353-1" },
    { cle: "moyens", label: "Moyens pédagogiques, techniques et d'encadrement", base: "L. 6353-1" },
    { cle: "evaluation", label: "Modalités d'évaluation des résultats", base: "L. 6353-1" },
    { cle: "contenu", label: "Contenu et durée des enseignements", base: "L. 6353-1" },
  ],
  reglement: [
    { cle: "hygieneSecurite", label: "Mesures d'hygiène et de sécurité", base: "R. 6352-1" },
    { cle: "disciplinaire", label: "Règles disciplinaires applicables", base: "R. 6352-3" },
    { cle: "sanctions", label: "Nature et échelle des sanctions", base: "R. 6352-3" },
    { cle: "procedure", label: "Garanties de procédure disciplinaire", base: "R. 6352-4 à R. 6352-8", protege: true },
    { cle: "representation", label: "Représentation des stagiaires", base: "R. 6352-9 s." },
  ],
};

export function mentionsManquantes(type, donnees = {}) {
  const liste = MENTIONS[type];
  if (!liste) return [];
  return liste.filter((m) => {
    const v = donnees[m.cle];
    if (typeof v === "number") return !Number.isFinite(v);
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "boolean") return v === false;
    return vide(v);
  });
}

// --- Règlement intérieur ------------------------------------------------------

export function validateReglement(r = {}, { dureeMaxHeures = null } = {}) {
  const errors = [], warnings = [];
  const manquantes = mentionsManquantes("reglement", r);
  for (const m of manquantes) {
    (m.protege ? errors : warnings).push(`${m.label} — ${m.base}`);
  }
  if (!r.version) errors.push("version du règlement requise : sans elle, on ne sait pas lequel a été remis à qui");
  if (!r.dateApplication) errors.push("date d'entrée en application requise");

  // LE SEUIL QUE PERSONNE NE CONNAÎT. Au-delà de 500 heures de formation, la
  // représentation des stagiaires n'est plus une bonne pratique : des délégués
  // sont élus, et le règlement doit en décrire les modalités. Une formation de
  // CFA dépasse ce seuil de très loin.
  if (dureeMaxHeures != null && dureeMaxHeures > SEUIL_DELEGUES_HEURES && vide(r.representation)) {
    errors.push(`formation de ${dureeMaxHeures} h : au-delà de ${SEUIL_DELEGUES_HEURES} h, l'élection de délégués des stagiaires doit être organisée et décrite (R. 6352-9)`);
  }
  return { ok: errors.length === 0, errors, warnings, manquantes };
}

// Le document ne vaut que PORTÉ À CONNAISSANCE. C'est la remise datée qui est
// demandée en contrôle, pas le fichier sur un serveur.
export function etatRemises(reglement = {}, remises = [], inscrits = []) {
  const version = reglement.version || null;
  const aJour = new Set(remises.filter((x) => !version || x.version === version).map((x) => x.learnerId));
  const manquants = inscrits.filter((id) => !aJour.has(id));
  return {
    version, inscrits: inscrits.length, remis: inscrits.length - manquants.length,
    manquants,
    taux: inscrits.length ? Math.round(((inscrits.length - manquants.length) / inscrits.length) * 100) : null,
    complet: manquants.length === 0 && inscrits.length > 0,
    // Nommé plutôt que compté : un chiffre n'appelle pas d'action.
    alerte: !version ? { gravite: "bloquant", message: "Aucun règlement intérieur établi : l'organisme est en défaut (art. L. 6352-3)." }
      : manquants.length ? { gravite: "important", message: `${manquants.length} inscrit(s) sans remise enregistrée de la version ${version} : le règlement ne leur est pas opposable.` }
      : null,
  };
}

// --- Programme de formation ---------------------------------------------------

// « PRÉÉTABLI » est le mot de l'article. Un programme reconstitué après coup
// depuis le planning réalisé est une pièce antidatée : on le construit depuis
// le RÉFÉRENTIEL, et on le FIGE au moment où il est rattaché à un acte.
export function construireProgramme({ curriculum = {}, campus = {}, annee = null, prerequis = "", evaluation = "", moyens = "" } = {}) {
  const modules = (curriculum.modules || []).filter((m) => annee == null || m.year == null || Number(m.year) === Number(annee));
  const heures = modules.reduce((a, m) => a + (m.heuresSemaine != null ? 0 : (Number(m.heures) || 0)), 0);
  return {
    intitule: curriculum.name || "",
    codeRncp: curriculum.codeRncp || null,
    niveau: curriculum.level || null,
    organisme: campus.name || "",
    annee,
    objectifs: curriculum.objectifs || "",
    prerequis, evaluation, moyens,
    contenu: modules.map((m) => ({
      code: m.code || "", label: m.label || "",
      heures: m.heures ?? null, heuresSemaine: m.heuresSemaine ?? null,
      bloc: m.blocId || null,
    })),
    dureeHeures: heures || (curriculum.dureeHeures ?? null),
    blocs: (curriculum.blocks || []).map((b) => ({ code: b.code || "", label: b.label || "" })),
  };
}

export function validateProgramme(p = {}) {
  const manquantes = mentionsManquantes("programme", p);
  const errors = manquantes.map((m) => `${m.label} — ${m.base}`);
  const warnings = [];
  if (!(p.contenu || []).length) errors.push("aucun enseignement : un programme sans contenu ne décrit rien");
  if (!p.dureeHeures) warnings.push("durée totale non déterminée : elle sera reprise dans la convention ou le contrat");
  return { ok: errors.length === 0, errors, warnings, manquantes };
}

// --- Échéancier : c'est ici que le module refuse de produire un acte illicite --

// Construit l'échéancier CONFORME d'un contrat de formation. La première
// échéance ne peut pas être antérieure à l'expiration du délai de rétractation,
// ni dépasser 30 % du prix.
export function echeancierLegal({ prix, dateSignature, nbEcheances = 3 } = {}) {
  const p = Number(prix);
  if (!Number.isFinite(p) || p <= 0 || !dateSignature) return null;
  const finRetractation = isoPlus(dateSignature, RETRACTATION_JOURS);
  const premier = round2(p * PREMIER_VERSEMENT_MAX);
  const reste = round2(p - premier);
  const n = Math.max(1, Math.min(12, Number(nbEcheances) || 3) - 1);
  const part = round2(reste / n);

  const lignes = [{
    rang: 1, date: finRetractation, montant: premier,
    motif: `premier versement, plafonné à ${PREMIER_VERSEMENT_MAX * 100} % du prix (L. 6353-6), exigible au plus tôt le ${finRetractation}`,
  }];
  let cumul = premier;
  for (let i = 1; i <= n; i++) {
    // Dernière échéance : on solde exactement, sinon les arrondis créent un
    // écart de quelques centimes qui bloque le rapprochement comptable.
    const montant = i === n ? round2(p - cumul) : part;
    cumul = round2(cumul + montant);
    lignes.push({
      rang: i + 1, date: null, montant,
      motif: "solde échelonné au fur et à mesure du déroulement de l'action (L. 6353-6)",
    });
  }
  return { prix: round2(p), finRetractation, premierVersementMax: premier, lignes };
}

// Contrôle d'un échéancier saisi à la main. C'est la garde qui empêche l'ERP de
// fabriquer un plan de facturation illicite.
export function validateEcheancier({ type, prix, dateSignature, lignes = [] } = {}) {
  const errors = [], warnings = [];
  if (type !== "contrat") return { ok: true, errors, warnings };   // la convention est libre

  const p = Number(prix);
  if (!Number.isFinite(p) || p <= 0) { errors.push("prix requis"); return { ok: false, errors, warnings }; }
  if (!dateSignature) { errors.push("date de signature requise : le délai de rétractation court à partir d'elle"); return { ok: false, errors, warnings }; }

  const finRetractation = isoPlus(dateSignature, RETRACTATION_JOURS);
  const total = round2(lignes.reduce((a, l) => a + (Number(l.montant) || 0), 0));
  if (Math.abs(total - round2(p)) > 0.01) {
    errors.push(`les échéances totalisent ${total} € pour un prix de ${round2(p)} €`);
  }

  const avant = lignes.filter((l) => l.date && l.date < finRetractation);
  if (avant.length) {
    errors.push(`${avant.length} échéance(s) exigible(s) avant le ${finRetractation} : aucune somme ne peut être exigée pendant le délai de rétractation de ${RETRACTATION_JOURS} jours (L. 6353-5 et L. 6353-6)`);
  }

  // Le plafond des 30 % s'apprécie sur ce qui est exigible à l'issue du délai,
  // pas sur la seule première ligne : deux échéances le même jour contourneraient
  // la règle sans qu'aucune ne dépasse le plafond.
  const aLaFinDuDelai = round2(lignes
    .filter((l) => l.date && l.date <= finRetractation)
    .reduce((a, l) => a + (Number(l.montant) || 0), 0));
  const plafond = round2(p * PREMIER_VERSEMENT_MAX);
  if (aLaFinDuDelai > plafond + 0.01) {
    errors.push(`${aLaFinDuDelai} € exigibles à l'expiration du délai, pour un plafond de ${plafond} € (30 % du prix, L. 6353-6)`);
  }
  if (lignes.length < 2 && p > 0) {
    warnings.push("paiement en une seule fois : le solde doit être échelonné au fur et à mesure du déroulement de l'action");
  }
  return { ok: errors.length === 0, errors, warnings, finRetractation, plafond };
}

// --- Convention et contrat ----------------------------------------------------

export function validateActe(a = {}) {
  const errors = [], warnings = [];
  if (!["convention", "contrat"].includes(a.type)) {
    errors.push("type d'acte requis (convention ou contrat)");
    return { ok: false, errors, warnings };
  }
  if (!PAYEURS[a.payeur]) errors.push(`payeur requis (${Object.keys(PAYEURS).join(", ")})`);

  // LA GARDE CENTRALE : l'acte doit correspondre au payeur.
  const requis = acteRequis(a.payeur);
  if (requis && requis.type !== a.type) {
    errors.push(`${TYPES[a.type].label} incompatible avec ce financement : ${requis.motif} C'est ${TYPES[requis.type].label.toLowerCase()} qui s'impose.`);
  }

  const manquantes = mentionsManquantes(a.type, a);
  for (const m of manquantes) {
    // Les mentions qui PROTÈGENT le bénéficiaire ne sont pas des oublis
    // véniels : sans elles l'acte est attaquable.
    (m.protege ? errors : warnings).push(`${m.label} — ${m.base}`);
  }
  if (a.dateDebut && a.dateFin && a.dateFin < a.dateDebut) errors.push("date de fin antérieure au début");

  const ech = validateEcheancier({ type: a.type, prix: a.prix, dateSignature: a.dateSignature, lignes: a.echeances || [] });
  errors.push(...ech.errors);
  warnings.push(...ech.warnings);

  // Le programme doit être PRÉÉTABLI, donc attaché avant l'exécution.
  if (!a.programme) {
    errors.push("aucun programme rattaché : l'action doit être réalisée conformément à un programme préétabli (L. 6353-1)");
  }
  return { ok: errors.length === 0, errors, warnings, manquantes, echeancier: ech };
}

// Un acte signé ne se modifie plus : il s'avenante. Sans cette règle, le
// document remis au bénéficiaire et celui conservé divergent en silence.
export function peutModifier(a = {}) {
  if (a.statut === "signe") {
    return { autorise: false, motif: "acte signé : toute modification passe par un avenant, sinon le document remis et celui conservé divergent" };
  }
  return { autorise: true };
}

// --- État documentaire du campus ---------------------------------------------

export function etatDocumentaire({ reglement = null, livret = null, actes = [], remises = null, aujourdhui } = {}) {
  const points = [];
  if (!reglement?.version) {
    points.push({ cle: "reglement", gravite: "bloquant", label: TYPES.reglement.label,
      message: "Aucun règlement intérieur établi. L'obligation ne dépend ni de la taille ni de l'activité (L. 6352-3)." });
  } else if (remises && !remises.complet && remises.manquants.length) {
    points.push({ cle: "remises", gravite: "important", label: "Remise du règlement",
      message: remises.alerte.message });
  }
  if (!livret?.contenu) {
    points.push({ cle: "livret", gravite: "conseille", label: TYPES.livret.label,
      message: "Aucun livret d'accueil : l'indicateur 9 porte sur l'information des bénéficiaires quant aux conditions de déroulement." });
  }

  const brouillons = actes.filter((a) => a.statut !== "signe" && a.dateDebut && aujourdhui && a.dateDebut <= aujourdhui);
  if (brouillons.length) {
    points.push({ cle: "actes_non_signes", gravite: "bloquant", label: "Actes non signés",
      message: `${brouillons.length} action(s) ont commencé sans convention ni contrat signé : la formation s'exécute alors sans base contractuelle.` });
  }
  const sansProgramme = actes.filter((a) => !a.programme);
  if (sansProgramme.length) {
    points.push({ cle: "programme", gravite: "bloquant", label: TYPES.programme.label,
      message: `${sansProgramme.length} acte(s) sans programme rattaché (L. 6353-1).` });
  }

  return {
    points,
    bloquants: points.filter((p) => p.gravite === "bloquant").length,
    conforme: points.filter((p) => p.gravite === "bloquant").length === 0,
    reserve: "Ce contrôle porte sur l'existence et la cohérence des pièces. Il ne vaut pas avis juridique : la rédaction reste à valider, et la convention collective comme les usages du financeur s'y ajoutent.",
  };
}

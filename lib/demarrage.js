// Contrôle de mise en service — logique pure.
//
// POURQUOI CE MODULE EXISTE. L'application sait produire un FEC, un BPF, un
// certificat de réalisation, un fichier SIFA, un Cerfa. Chacun de ces documents
// exige des informations d'identité de l'organisme qui, si elles manquent, ne se
// découvrent qu'au moment de produire le document — c'est-à-dire à l'échéance,
// quand il est trop tard.
//
// CE QUI DISTINGUE CE CONTRÔLE D'UNE LISTE À COCHER : chaque manque est relié à
// CE QU'IL EMPÊCHE, nommément. « Numéro de déclaration d'activité manquant »
// n'appelle aucune action. « Sans numéro de déclaration, ni le BPF ni le
// certificat de réalisation ne sont délivrables » en appelle une, tout de suite.
//
// Le module ne dit jamais « conforme ». Il dit ce qui est prêt et ce qui ne
// l'est pas : la conformité se constate en contrôle, elle ne se décrète pas dans
// un logiciel.

export const NIVEAUX = {
  bloquant: { label: "Bloquant", poids: 0 },
  important: { label: "Important", poids: 1 },
  conseille: { label: "Conseillé", poids: 2 },
};

const vide = (v) => !String(v ?? "").trim();

// Chaque point porte : ce qui manque, ce que ça empêche, et où le corriger.
// Le troisième champ compte autant que les deux autres — un diagnostic sans
// chemin d'action se transforme en liste ignorée.
function point(niveau, cle, quoi, empeche, ou) {
  return { niveau, cle, quoi, empeche, ou };
}

export function controler({ campus = {}, settings = {}, curricula = [], classes = [],
  teachers = [], users = [], licence = null, taxe = null, qualiopi = null,
  reclamationsOuvertes = null, sauvegardeLe = null, aujourdhui = null } = {}) {
  const out = [];

  // --- Identité de l'organisme : c'est elle qui bloque le plus de documents ---
  if (vide(campus.name)) out.push(point("bloquant", "nom", "Raison sociale du campus absente",
    "aucun document éditable : tous la portent en en-tête", "Campus → fiche"));
  if (vide(campus.siret)) out.push(point("bloquant", "siret", "SIRET absent",
    "le FEC ne peut pas être nommé, et le Cerfa d'apprentissage est incomplet", "Campus → fiche"));
  if (vide(campus.numeroDeclaration)) out.push(point("bloquant", "nda", "Numéro de déclaration d'activité absent",
    "ni le BPF ni le certificat de réalisation ne sont délivrables", "Campus → fiche"));
  if (vide(campus.dirigeant)) out.push(point("bloquant", "dirigeant", "Représentant légal non désigné",
    "le certificat de réalisation et le BPF portent sa signature : ils ne peuvent pas être émis", "Campus → fiche"));
  if (vide(campus.address)) out.push(point("important", "adresse", "Adresse postale absente",
    "elle figure sur les conventions et les attestations remises aux financeurs", "Campus → fiche"));

  // --- Ce qui conditionne la facturation et la comptabilité ---
  if (!settings.planComptable) out.push(point("important", "plan_comptable", "Plan de comptes non paramétré",
    "l'export comptable partira avec des comptes par défaut, que le cabinet rejettera probablement", "Comptabilité & paie"));

  // --- Référentiels : sans eux, ni bulletin ni certification ---
  if (!curricula.length) out.push(point("bloquant", "referentiel", "Aucun référentiel de formation",
    "ni emploi du temps, ni bulletin, ni suivi de certification", "Référentiels"));
  else if (!curricula.some((c) => (c.blocks || []).length)) {
    out.push(point("important", "blocs", "Aucun bloc de compétences défini",
      "la certification par blocs, les dispenses et les procès-verbaux de jury sont inopérants", "Référentiels"));
  }
  if (!classes.length) out.push(point("bloquant", "classes", "Aucune classe",
    "aucun apprenant ne peut être inscrit, ni aucune séance planifiée", "Salles & classes"));

  // --- Planning ---
  // LE CONTRÔLE REGARDE CE QUI A ÉTÉ DÉCLARÉ, PAS CE QUE LE LECTEUR RENVOIE.
  //
  // Il lisait `settings.hours`, alimenté par getCampusHours() — qui retourne
  // TOUJOURS quelque chose, en retombant sur 08 h–18 h. La condition ne pouvait
  // donc jamais être vraie : l'alerte n'est jamais apparue, et un campus restait
  // sur des horaires par défaut sans que personne ne le sache. C'est le
  // symétrique du champ lu mais jamais écrit, et il se lit pareil : « tout va
  // bien ». On teste donc la DÉCLARATION (`openingHours`), pas la lecture.
  const declares = campus.openingHours || settings.openingHours || null;
  if (!declares || !Object.keys(declares).length) out.push(point("important", "horaires", "Horaires d'ouverture non déclarés",
    "le planning retiendra 08 h–18 h par défaut et refusera toute séance en dehors", "Campus → horaires"));
  if (!teachers.length) out.push(point("important", "intervenants", "Aucun intervenant",
    "aucune séance ne peut être affectée, et l'export de paie sera vide", "Professeurs"));
  else if (!teachers.some((t) => t.status && t.tauxHoraire)) {
    out.push(point("conseille", "intervenants_paie", "Aucun intervenant avec statut et taux horaire",
      "l'export de paie sortira incomplet et devra être repris à la main", "Professeurs"));
  }

  // --- Obligations qualité et accessibilité ---
  if (qualiopi && qualiopi.valideJusquau && aujourdhui && qualiopi.valideJusquau < aujourdhui) {
    out.push(point("bloquant", "qualiopi_expire", `Certification Qualiopi expirée le ${qualiopi.valideJusquau}`,
      "les financements publics et mutualisés sont suspendus : c'est l'ensemble du modèle économique", "Qualiopi"));
  } else if (qualiopi && qualiopi.valideJusquau && aujourdhui) {
    const jours = Math.round((new Date(qualiopi.valideJusquau + "T00:00:00Z") - new Date(aujourdhui + "T00:00:00Z")) / 864e5);
    if (jours <= 120) out.push(point("important", "qualiopi_echeance", `Certification Qualiopi à renouveler (${jours} jours)`,
      "l'audit de renouvellement se prépare plusieurs mois à l'avance", "Qualiopi"));
  } else if (!qualiopi) {
    out.push(point("important", "qualiopi", "Certification Qualiopi non renseignée",
      "impossible de savoir si les financements mutualisés sont ouverts", "Qualiopi"));
  }
  if (vide(campus.referentHandicap)) out.push(point("important", "referent_handicap", "Référent handicap non désigné",
    "c'est une exigence du référentiel national qualité, et personne n'instruit les demandes d'aménagement", "Campus → fiche"));

  // --- RGPD ---
  if (!(settings.rgpd?.register || []).length) out.push(point("important", "registre_rgpd", "Registre des traitements vide",
    "il est exigible à tout moment par l'autorité de contrôle", "RGPD & conformité"));

  // --- Registres tenus ---
  if (reclamationsOuvertes === 0) out.push(point("conseille", "reclamations", "Aucune réclamation enregistrée",
    "un registre vide n'est pas la preuve qu'il n'y a pas eu de réclamation, mais qu'on ne les enregistre pas", "Réclamations & sous-traitance"));

  // --- Recettes ---
  if (taxe && taxe.etat === "non_demandee" && taxe.risque === "critique") {
    out.push(point("important", "taxe", "Habilitation à la taxe d'apprentissage non demandée, guichet fermé",
      "aucun solde de taxe ne sera perçu cette année, et il n'y a pas de rattrapage", "Taxe d'apprentissage"));
  }

  // --- Exploitation ---
  const admins = users.filter((u) => u.role === "admin" && u.active !== false);
  if (admins.length < 2) out.push(point("important", "admin_unique", "Un seul compte administrateur actif",
    "une indisponibilité de cette personne bloque toute la gestion des comptes", "Utilisateurs"));
  if (!sauvegardeLe) out.push(point("bloquant", "sauvegarde", "Aucune sauvegarde constatée",
    "une perte de données serait définitive — c'est la seule panne dont on ne revient pas", "Sauvegardes"));
  else if (aujourdhui) {
    const jours = Math.round((new Date(aujourdhui + "T00:00:00Z") - new Date(String(sauvegardeLe).slice(0, 10) + "T00:00:00Z")) / 864e5);
    if (jours > 2) out.push(point("bloquant", "sauvegarde_ancienne", `Dernière sauvegarde il y a ${jours} jours`,
      "la sauvegarde automatique ne tourne plus : on ne s'en aperçoit qu'au moment d'en avoir besoin", "Sauvegardes"));
  }
  if (licence?.lectureSeule) out.push(point("bloquant", "licence", "Instance en lecture seule",
    "aucune écriture n'est possible ; la consultation et l'export restent ouverts", "Licence & abonnement"));

  const parNiveau = (n) => out.filter((p) => p.niveau === n);
  out.sort((a, b) => NIVEAUX[a.niveau].poids - NIVEAUX[b.niveau].poids);

  return {
    points: out,
    bloquants: parNiveau("bloquant").length,
    importants: parNiveau("important").length,
    conseilles: parNiveau("conseille").length,
    // « Exploitable » et non « conforme » : ce contrôle dit qu'aucun obstacle
    // technique connu ne s'oppose à l'usage, pas que l'organisme est en règle.
    exploitable: parNiveau("bloquant").length === 0,
    reserve: "Ce contrôle porte sur ce que l'application peut constater. Il ne vaut pas audit : la conformité se vérifie en contrôle, elle ne se décrète pas dans un logiciel.",
  };
}

// Regroupement par écran : c'est ainsi qu'on corrige, pas point par point.
export function parEcran(resultat) {
  const m = new Map();
  for (const p of resultat.points || []) {
    if (!m.has(p.ou)) m.set(p.ou, []);
    m.get(p.ou).push(p);
  }
  return [...m.entries()].map(([ecran, points]) => ({ ecran, points }))
    .sort((a, b) => NIVEAUX[a.points[0].niveau].poids - NIVEAUX[b.points[0].niveau].poids);
}

// Référentiel National Qualité (Qualiopi) — DEUX VERSIONS, et c'est le point.
//
// Le décret n° 2026-728 du 1er août 2026 (JORF n° 0180 du 4 août) remplace le
// référentiel au 1er NOVEMBRE 2026, sans période de transition : à partir de
// cette date les audits portent sur 33 indicateurs, pas 32.
//
// LE PIÈGE QU'IL FAUT VOIR AVANT DE BASCULER — ce n'est pas « 32 + 1 ». La
// numérotation est REMANIÉE : le critère 1 passe de 2 à 3 indicateurs, le
// critère 2 de 6 à 5, le critère 5 de 3 à 2, le critère 6 de 4 à 7. Un
// organisme qui a enregistré « indicateur 23 : conforme » l'a fait sur
// « mobilisation d'expertises handicap » (critère 5) ; dans le nouveau
// référentiel, l'indicateur 23 est « veille légale et réglementaire »
// (critère 6). Incrémenter le numéro de version sans plus de précaution
// réattribuerait CHAQUE preuve à un autre indicateur, et l'organisme se
// présenterait à l'audit avec un tableau vert qui ne veut rien dire.
//
// D'où le parti pris : AUCUN statut n'est repris automatiquement. La bascule
// remet tout à « à vérifier » et fournit, pour chaque nouvel indicateur, la
// correspondance probable avec l'ancien — comme une aide à retrouver les
// preuves, jamais comme un constat de conformité. C'est aussi ce qu'exige la
// situation réelle : l'auditeur auditera sur le nouveau référentiel, et la
// conformité à l'ancien ne se transporte pas.
//
// ⚠️ Les libellés ci-dessous sont des RÉSUMÉS destinés à se repérer, pas le
// texte réglementaire. Le texte qui fait foi est l'annexe du décret :
// https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054608509

// Date d'entrée en vigueur du référentiel à 33 indicateurs.
export const BASCULE_V2026 = "2026-11-01";
// À partir de quand on insiste. Six mois : c'est le délai réaliste pour
// produire les preuves des exigences nouvelles (évaluation des enseignements,
// analyse des risques qualité) — pas pour cocher des cases.
export const HORIZON_PREPARATION_JOURS = 180;

// --- Référentiel 2019 (décret n° 2019-565), applicable jusqu'au 31/10/2026 ---
export const QUALIOPI_V2019 = [
  { c: 1, titre: "Information du public", indicators: [
    { n: 1, l: "Information sur prestations, délais, tarifs, modalités et résultats" },
    { n: 2, l: "Indicateurs de résultats adaptés (obtention, satisfaction, insertion…)" },
  ]},
  { c: 2, titre: "Objectifs et adaptation des prestations", indicators: [
    { n: 3, l: "Objectifs définis (analyse du besoin, prérequis, objectifs évaluables)" },
    { n: 4, l: "Contenus et modalités adaptés aux objectifs et publics" },
    { n: 5, l: "Positionnement et évaluation à l'entrée" },
    { n: 6, l: "Objectifs alignés avec la certification (blocs de compétences)", tag: "certifiant" },
    { n: 7, l: "Contenus adaptés au référentiel de la certification", tag: "certifiant" },
    { n: 8, l: "Modalités d'évaluation en cours et en fin de prestation" },
  ]},
  { c: 3, titre: "Adaptation aux publics, accueil, accompagnement, suivi", indicators: [
    { n: 9, l: "Conditions de déroulement communiquées et adaptées" },
    { n: 10, l: "Adaptation de la prestation, accompagnement, suivi" },
    { n: 11, l: "Atteinte des objectifs évaluée" },
    { n: 12, l: "Prise en compte des besoins d'adaptation (rythme, format)" },
    { n: 13, l: "Coordination des acteurs (alternance / situation de travail)", tag: "alternance" },
    { n: 14, l: "Accompagnement socio-professionnel de l'apprenti (droits/devoirs)", tag: "apprentissage" },
    { n: 15, l: "Information sur les aides et la mobilité", tag: "apprentissage" },
    { n: 16, l: "Prise en compte du handicap (référent, adaptation)", tag: "handicap" },
  ]},
  { c: 4, titre: "Moyens pédagogiques, techniques et d'encadrement", indicators: [
    { n: 17, l: "Moyens humains et techniques adaptés, environnement" },
    { n: 18, l: "Coordination et mobilisation des ressources" },
    { n: 19, l: "Ressources pédagogiques mises à disposition et actualisées" },
    { n: 20, l: "Personnels dédiés à l'accueil, l'accompagnement, le handicap" },
  ]},
  { c: 5, titre: "Qualification et compétences des personnels", indicators: [
    { n: 21, l: "Compétences des personnels déterminées et mobilisées" },
    { n: 22, l: "Entretien et développement des compétences des personnels" },
    { n: 23, l: "Mobilisation d'expertises / réseaux handicap", tag: "handicap" },
  ]},
  { c: 6, titre: "Inscription dans l'environnement professionnel", indicators: [
    { n: 24, l: "Veille légale et réglementaire, mise à jour" },
    { n: 25, l: "Veille sur l'évolution des compétences, métiers, emplois" },
    { n: 26, l: "Veille sur les innovations pédagogiques et technologiques" },
    { n: 27, l: "Réseau de partenaires socio-économiques mobilisé" },
  ]},
  { c: 7, titre: "Recueil et prise en compte des appréciations et réclamations", indicators: [
    { n: 28, l: "Recueil des appréciations des parties prenantes" },
    { n: 29, l: "Traitement des réclamations, difficultés et aléas" },
    { n: 30, l: "Mesures d'amélioration à partir des retours" },
    { n: 31, l: "Maîtrise des prestataires / sous-traitance", tag: "sous-traitance" },
    { n: 32, l: "Amélioration continue formalisée" },
  ]},
];

// --- Référentiel 2026 (décret n° 2026-728), applicable à partir du 01/11/2026 ---
// LE PÉRIMÈTRE N'EST PAS ENCODÉ ICI, VOLONTAIREMENT. Chaque indicateur ne
// concerne que certaines catégories d'actions (formation, bilan de compétences,
// VAE, apprentissage), et l'annexe le dit par un tableau de croix. Deux
// lectures de ce tableau m'ont donné des résultats contradictoires : plutôt
// qu'une donnée approximative qui retirerait en silence des indicateurs du
// calcul de conformité, l'organisme marque « non applicable » ce qui ne le
// concerne pas — ce qu'il sait, et que nous ne savons pas.
export const QUALIOPI_V2026 = [
  { c: 1, titre: "Information du public", indicators: [
    { n: 1, l: "Information accessible au public : prestations, prérequis, objectifs, durée, modalités" },
    { n: 2, l: "Indicateurs de résultats adaptés à la nature des prestations et des publics" },
    // Exigence détachée et renforcée : ce n'est plus un sous-ensemble de l'info
    // générale, c'est un indicateur à part entière.
    { n: 3, l: "Taux d'obtention des certifications, équivalences, passerelles et débouchés" },
  ]},
  { c: 2, titre: "Objectifs et adaptation des prestations", indicators: [
    { n: 4, l: "Analyse du besoin du bénéficiaire, avec l'entreprise et/ou le financeur" },
    { n: 5, l: "Objectifs opérationnels et évaluables de la prestation" },
    { n: 6, l: "Contenus et modalités adaptés aux objectifs définis et aux publics" },
    { n: 7, l: "Adéquation des contenus à la certification visée et capacité à l'assurer" },
    { n: 8, l: "Procédures de positionnement et d'évaluation des acquis à l'entrée" },
  ]},
  { c: 3, titre: "Adaptation aux publics, accueil, accompagnement, suivi", indicators: [
    { n: 9, l: "Information des bénéficiaires sur les conditions de déroulement" },
    { n: 10, l: "Mise en œuvre, adaptation, accompagnement et suivi adaptés aux publics" },
    { n: 11, l: "Évaluation de l'atteinte des objectifs par les bénéficiaires" },
    // Élargi : la prévention des ruptures s'accompagne désormais explicitement de
    // celle des violences, du harcèlement et des discriminations.
    { n: 12, l: "Prévention des ruptures, des violences, du harcèlement et des discriminations" },
    { n: 13, l: "Anticipation des missions confiées et coordination centre / entreprise" },
    { n: 14, l: "Accompagnement socio-professionnel et traitement des ruptures sans délai" },
    { n: 15, l: "Information des apprentis : droits et devoirs, santé-sécurité, violences, harcèlement" },
    { n: 16, l: "Conditions de présentation à la certification conformes aux exigences de l'autorité" },
  ]},
  { c: 4, titre: "Moyens pédagogiques, techniques et d'encadrement", indicators: [
    { n: 17, l: "Moyens humains et techniques adaptés, environnement approprié" },
    { n: 18, l: "Mobilisation et coordination des intervenants internes et/ou externes" },
    // Le distanciel ne suffit plus à être proposé : son suivi doit être
    // DÉMONTRABLE, et un référent pédagogique identifié.
    { n: 19, l: "Ressources pédagogiques, vérification du suivi à distance, référent pédagogique" },
    { n: 20, l: "Appui à la mobilité, référent handicap, conseil de perfectionnement, supervision" },
  ]},
  { c: 5, titre: "Qualification et compétences des personnels", indicators: [
    { n: 21, l: "Compétences des intervenants déterminées, mobilisées et évaluées" },
    { n: 22, l: "Entretien et développement des compétences des salariés" },
  ]},
  { c: 6, titre: "Inscription dans l'environnement professionnel", indicators: [
    { n: 23, l: "Veille légale et réglementaire sur la formation professionnelle" },
    { n: 24, l: "Veille sur l'évolution des compétences, des métiers et des emplois" },
    { n: 25, l: "Veille sur les innovations pédagogiques et technologiques" },
    // Le handicap quitte le critère 5 pour le critère 6 : c'est le déplacement
    // qui piège les reprises de données faites au numéro.
    { n: 26, l: "Expertises, outils et réseaux pour l'accueil et l'accompagnement du handicap" },
    { n: 27, l: "Conformité au référentiel en sous-traitance, traçabilité dans les contrats" },
    { n: 28, l: "Réseau de partenaires mobilisé pour co-construire l'ingénierie de formation" },
    { n: 29, l: "Actions d'insertion professionnelle ou de poursuite d'études" },
  ]},
  { c: 7, titre: "Recueil et prise en compte des appréciations et réclamations", indicators: [
    { n: 30, l: "Recueil des appréciations des parties prenantes : bénéficiaires, financeurs, équipes" },
    { n: 31, l: "Traitement des difficultés, réclamations et aléas survenus en prestation" },
    { n: 32, l: "Démarche d'amélioration continue incluant une analyse des risques qualité" },
    // LE NOUVEL INDICATEUR. À ne pas confondre avec l'indicateur 30 : il ne
    // s'agit pas de la satisfaction générale, mais d'une évaluation des CONTENUS
    // et des ENSEIGNEMENTS par les apprenants, restituée aux équipes pédagogiques.
    { n: 33, l: "Évaluation des contenus et des enseignements par les apprenants, distincte de la satisfaction générale", nouveau: true },
  ]},
];

// Registre des versions. La version applicable se déduit d'une DATE, pas d'un
// réglage : c'est le décret qui décide, pas l'utilisateur.
export const QUALIOPI_VERSIONS = {
  v2019: {
    cle: "v2019", label: "Référentiel 2019 — 32 indicateurs",
    texte: "décret n° 2019-565 du 6 juin 2019",
    du: null, au: "2026-10-31", reference: QUALIOPI_V2019,
    source: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000038565259",
  },
  v2026: {
    cle: "v2026", label: "Référentiel 2026 — 33 indicateurs",
    texte: "décret n° 2026-728 du 1er août 2026",
    du: BASCULE_V2026, au: null, reference: QUALIOPI_V2026,
    source: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054608509",
  },
};
export const QUALIOPI_VERSION_KEYS = Object.keys(QUALIOPI_VERSIONS);

// Version applicable à une date donnée.
export function versionApplicable(dateISO) {
  const d = String(dateISO || "").slice(0, 10);
  return d && d >= BASCULE_V2026 ? "v2026" : "v2019";
}
export function referenceDe(cle) {
  return (QUALIOPI_VERSIONS[cle] || QUALIOPI_VERSIONS.v2019).reference;
}
export function numerosDe(cle) {
  return referenceDe(cle).flatMap((c) => c.indicators.map((i) => i.n));
}
export function indicateurDe(cle, n) {
  for (const c of referenceDe(cle)) {
    const i = c.indicators.find((x) => x.n === Number(n));
    if (i) return { ...i, critere: c.c, critereTitre: c.titre };
  }
  return null;
}

// AIDE À LA REPRISE — pour chaque indicateur 2026, l'indicateur 2019 dont les
// preuves ont des chances de servir. `confiance` dit ce que ça vaut :
//   directe  — même exigence, simple renumérotation : les preuves servent telles quelles
//   partielle — l'exigence a été scindée, fusionnée ou élargie : preuves à compléter
//   nouveau  — exigence sans équivalent : tout est à produire
// Ce tableau ORIENTE une relecture humaine. Il ne conclut jamais à la conformité.
export const REPRISE_2019_VERS_2026 = {
  1: { depuis: [1], confiance: "directe" },
  2: { depuis: [2], confiance: "directe" },
  3: { depuis: [2], confiance: "partielle", note: "détaché de l'information générale et renforcé : taux d'obtention, équivalences, passerelles, débouchés" },
  4: { depuis: [3], confiance: "partielle", note: "l'ancien indicateur 3 est scindé : ici l'analyse du besoin" },
  5: { depuis: [3], confiance: "partielle", note: "l'ancien indicateur 3 est scindé : ici les objectifs évaluables" },
  6: { depuis: [4], confiance: "directe" },
  7: { depuis: [6, 7], confiance: "partielle", note: "fusion des anciens 6 et 7, avec la capacité à assurer la certification" },
  8: { depuis: [5], confiance: "directe" },
  9: { depuis: [9], confiance: "directe" },
  10: { depuis: [10, 12], confiance: "partielle" },
  11: { depuis: [8, 11], confiance: "partielle" },
  12: { depuis: [12], confiance: "partielle", note: "élargi à la prévention des violences, du harcèlement et des discriminations" },
  13: { depuis: [13], confiance: "directe" },
  14: { depuis: [14], confiance: "partielle", note: "renforcé : traitement des ruptures sans délai" },
  15: { depuis: [14, 15], confiance: "partielle", note: "renforcé pour les mineurs : santé-sécurité, violences, harcèlement" },
  16: { depuis: [], confiance: "nouveau", note: "conditions de présentation à la certification" },
  17: { depuis: [17], confiance: "directe" },
  18: { depuis: [18], confiance: "directe" },
  19: { depuis: [19], confiance: "partielle", note: "le suivi du distanciel doit désormais être démontrable, avec un référent pédagogique" },
  20: { depuis: [20], confiance: "partielle", note: "gouvernance CFA renforcée : appui mobilité, conseil de perfectionnement" },
  21: { depuis: [21], confiance: "directe" },
  22: { depuis: [22], confiance: "directe" },
  23: { depuis: [24], confiance: "directe", note: "ATTENTION : portait le numéro 24 dans le référentiel 2019" },
  24: { depuis: [25], confiance: "directe", note: "portait le numéro 25" },
  25: { depuis: [26], confiance: "directe", note: "portait le numéro 26" },
  26: { depuis: [23], confiance: "directe", note: "le handicap passe du critère 5 au critère 6 : portait le numéro 23" },
  27: { depuis: [31], confiance: "partielle", note: "portait le numéro 31 ; étendu à la traçabilité contractuelle et au portage salarial" },
  28: { depuis: [27], confiance: "directe", note: "portait le numéro 27" },
  29: { depuis: [], confiance: "nouveau", note: "insertion professionnelle ou poursuite d'études des apprentis" },
  30: { depuis: [28], confiance: "directe", note: "portait le numéro 28" },
  31: { depuis: [29], confiance: "directe", note: "portait le numéro 29" },
  32: { depuis: [30, 32], confiance: "partielle", note: "ajout d'une analyse des risques qualité" },
  33: { depuis: [], confiance: "nouveau", note: "évaluation des contenus et des enseignements par les apprenants — à ne pas confondre avec l'enquête de satisfaction" },
};

// Prépare la bascule. Ne renvoie JAMAIS un statut « conforme » : chaque
// indicateur repart à « à vérifier », accompagné de ce qui existait avant.
export function preparerBascule(indicateurs2019 = {}) {
  const lignes = numerosDe("v2026").map((n) => {
    const def = indicateurDe("v2026", n);
    const rep = REPRISE_2019_VERS_2026[n] || { depuis: [], confiance: "nouveau" };
    const anciens = rep.depuis.map((o) => ({
      n: o,
      libelle: indicateurDe("v2019", o)?.l || "",
      statut: indicateurs2019[o]?.status || "a_verifier",
      note: indicateurs2019[o]?.note || "",
    }));
    return {
      n, critere: def.critere, libelle: def.l,
      confiance: rep.confiance, note: rep.note || null, anciens,
      // Les notes libres se reportent — elles décrivent des preuves, et perdre
      // ce texte ferait recommencer une saisie à la main. Le STATUT, lui, non.
      statutPropose: "a_verifier",
      notePropose: anciens.map((a) => a.note).filter(Boolean).join("\n"),
    };
  });
  return {
    lignes,
    aRefaire: lignes.filter((l) => l.confiance !== "directe").length,
    nouveaux: lignes.filter((l) => l.confiance === "nouveau").map((l) => l.n),
    reserve: "Aucune conformité n'est reportée : l'audit portera sur le référentiel 2026, et la conformité à l'ancien ne s'y transporte pas. Les correspondances indiquées servent à retrouver les preuves, pas à conclure.",
  };
}

// Applique la bascule sur un enregistrement de campus.
export function basculer(qualiopi = {}) {
  const prep = preparerBascule(qualiopi.indicators || {});
  const indicators = {};
  for (const l of prep.lignes) {
    indicators[l.n] = { status: l.statutPropose, note: l.notePropose || "" };
  }
  return {
    ...qualiopi, version: "v2026", indicators,
    basculeLe: new Date().toISOString().slice(0, 10),
    // On garde l'ancien tableau : c'est la trace de ce qui a été constaté sous
    // le référentiel précédent, et un auditeur peut le demander.
    archiveV2019: qualiopi.indicators || {},
  };
}

// Compatibilité : l'ancien nom pointe sur la version 2019, celle des
// enregistrements existants. Le faire pointer sur la version applicable AU JOUR
// LE JOUR ferait changer le sens des données stockées le 1er novembre au matin,
// sans que personne n'ait rien fait.
export const QUALIOPI_REFERENCE = QUALIOPI_V2019;

// Glossaire des éléments clés Qualiopi (aide-mémoire du DO — définitions condensées).
export const QUALIOPI_GLOSSARY = [
  { sec: "Certification", t: "Qualiopi", d: "Marque de certification qualité, obligatoire depuis le 1er janvier 2022 pour accéder aux fonds publics et mutualisés (CPF, OPCO, État, Régions, France Travail). Sans elle, pas de financement de ces prestations." },
  { t: "RNQ (Référentiel National Qualité)", d: "Le référentiel unique qui fonde Qualiopi : 7 critères déclinés en 32 indicateurs. C'est le texte de référence sur lequel porte l'audit." },
  { t: "Critère", d: "Un des 7 axes du RNQ (information du public, objectifs, accompagnement, moyens, personnels, environnement pro, amélioration continue)." },
  { t: "Indicateur", d: "Une des 32 exigences concrètes réparties dans les critères. L'audit vérifie la conformité de chaque indicateur applicable à ton périmètre." },
  { t: "Élément de preuve", d: "Document ou enregistrement démontrant qu'un indicateur est respecté (programme, émargements, enquête de satisfaction, CV formateurs, veille…). Pas de preuve = non conforme." },
  { t: "Catégories d'actions", d: "4 périmètres possibles : AF (actions de formation), BC (bilans de compétences), VAE, et apprentissage (CFA). Le périmètre certifié conditionne les indicateurs applicables." },
  { t: "Périmètre conditionnel (tags)", d: "Certains indicateurs ne s'appliquent que sous conditions : certifiant, alternance, apprentissage, handicap, sous-traitance. Sinon ils sont « non applicables »." },
  { t: "Non-conformité mineure", d: "Écart qui n'empêche pas la certification mais doit être corrigé (plan d'action de remédiation, vérifié à l'audit suivant)." },
  { t: "Non-conformité majeure", d: "Écart grave : bloque ou suspend la certification tant qu'il n'est pas levé (souvent sous 3 mois, preuve à l'appui)." },
  { t: "Audit initial", d: "Premier audit pour obtenir le certificat, valable 3 ans." },
  { t: "Audit de surveillance", d: "Audit à mi-parcours (entre 14 et 22 mois, cible ~18) qui vérifie le maintien de la conformité. À anticiper : c'est là que ça se joue." },
  { t: "Audit de renouvellement", d: "Audit à l'approche des 3 ans pour reconduire le certificat sur un nouveau cycle." },
  { t: "Organisme certificateur", d: "Organisme accrédité par le COFRAC qui réalise les audits et délivre le certificat Qualiopi (à ne pas confondre avec l'organisme de formation audité)." },
  { t: "NDA (Numéro de Déclaration d'Activité)", d: "Enregistrement préfectoral de l'organisme de formation. Préalable et distinct de Qualiopi." },
  { t: "BPF (Bilan Pédagogique et Financier)", d: "Déclaration annuelle obligatoire de l'organisme (activité + comptes). Contrôlée, cohérente avec le suivi Qualiopi." },
  { t: "Sous-traitance / portage", d: "Recours à un prestataire tiers pour tout ou partie d'une action : l'organisme reste responsable de la qualité (indicateur 31)." },
  { t: "Bloc de compétences", d: "Pour les actions certifiantes : ensemble homogène de compétences du référentiel de la certification. Les objectifs et contenus doivent s'y aligner (indicateurs 6-7)." },
  { t: "Amélioration continue", d: "Cœur du critère 7 : recueillir les appréciations et réclamations, les traiter, et en tirer des mesures correctives formalisées." },
  // — Écosystème & financement (ce que Qualiopi débloque) —
  { sec: "Écosystème & financement", t: "CPF (Compte Personnel de Formation)", d: "Droit à la formation crédité en euros pour chaque actif, mobilisable via Mon Compte Formation. Ne finance que des formations certifiantes portées par un organisme certifié Qualiopi." },
  { t: "OPCO (Opérateur de Compétences)", d: "Un des 11 opérateurs qui financent l'apprentissage/l'alternance et appuient les entreprises sur la formation. Principaux financeurs des CFA (via le NPEC)." },
  { t: "France Compétences", d: "Instance nationale de régulation et de financement de la formation et de l'apprentissage : répartit les fonds, fixe les règles, tient le RNCP et le RS." },
  { t: "RNCP (Répertoire National des Certifications Professionnelles)", d: "Registre officiel des diplômes et titres à finalité professionnelle. Une certification enregistrée au RNCP ouvre l'accès à de nombreux financements." },
  { t: "RS (Répertoire Spécifique)", d: "Registre des certifications et habilitations complémentaires (compétences ciblées : langues, sécurité, logiciels…), également tenu par France Compétences." },
  { t: "EDOF (Espace Des Organismes de Formation)", d: "Plateforme où l'organisme publie et gère ses offres éligibles au CPF (Mon Compte Formation)." },
  { t: "NPEC (Niveau de Prise En Charge)", d: "Montant de financement d'un contrat d'apprentissage, fixé par branche / France Compétences. Détermine le budget par apprenti versé par l'OPCO." },
  { t: "VAE (Validation des Acquis de l'Expérience)", d: "Voie d'obtention d'une certification par la reconnaissance de l'expérience. C'est une des 4 catégories d'actions, avec son parcours et ses financements propres." },
];

// Liste plate des numéros d'indicateurs (pour calcul de conformité)
export const QUALIOPI_INDICATOR_NUMBERS = QUALIOPI_REFERENCE.flatMap((c) => c.indicators.map((i) => i.n));

// Statuts possibles par indicateur
export const QUALIOPI_STATUSES = ["conforme", "non_conforme", "non_applicable", "a_verifier"];

// Calcul des dates de controle a partir du dernier audit.
// Cycle Qualiopi : certificat 3 ans ; audit de surveillance entre 14 et 22 mois (cible 18).
export function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
export function computeControlDates(lastAudit) {
  if (!lastAudit) return null;
  const surveillance = addMonths(lastAudit, 18);
  const renewal = addMonths(lastAudit, 36);
  const checkpoints = [
    { label: "Revue interne Qualiopi — T1", dueDate: addMonths(lastAudit, 3) },
    { label: "Revue interne Qualiopi — T2", dueDate: addMonths(lastAudit, 6) },
    { label: "Revue interne Qualiopi — T3", dueDate: addMonths(lastAudit, 9) },
    { label: "Revue interne Qualiopi — T4", dueDate: addMonths(lastAudit, 12) },
    { label: "Préparer l'audit de surveillance Qualiopi", dueDate: addMonths(lastAudit, 16) },
    { label: "Audit de surveillance Qualiopi", dueDate: surveillance },
    { label: "Préparer le renouvellement Qualiopi", dueDate: addMonths(lastAudit, 33) },
    { label: "Audit de renouvellement Qualiopi", dueDate: renewal },
  ];
  return { surveillance, renewal, checkpoints };
}

// Taux de conformité : conformes / (total - non applicables)
// La version est celle de l'ENREGISTREMENT, pas la date du jour : un tableau
// saisi sous le référentiel 2019 doit continuer d'être lu sur 32 indicateurs
// jusqu'à ce que quelqu'un bascule explicitement.
// CORRECTION D'UN CHOIX QUE J'AI D'ABORD FAIT, ET QUI ÉTAIT DANGEREUX.
//
// Une première version excluait automatiquement du calcul les indicateurs hors
// périmètre, d'après une table de correspondance « indicateur → catégories
// d'actions » que j'avais dérivée de l'annexe. Deux lectures successives de la
// même annexe ont donné des périmètres CONTRADICTOIRES (l'indicateur 3 avec
// puis sans l'apprentissage). Cette table n'est donc pas fiable.
//
// Or l'erreur n'est pas symétrique : un périmètre trop LARGE fait baisser un
// taux à tort — c'est agaçant et ça se voit. Un périmètre trop ÉTROIT retire
// des indicateurs du dénominateur et fait paraître l'organisme PLUS conforme
// qu'il ne l'est — personne ne le voit, jusqu'à l'audit.
//
// Et le mécanisme correct existait déjà : le statut « non applicable », posé
// indicateur par indicateur par quelqu'un qui connaît son périmètre. Un filtre
// automatique le doublonnait avec des données moins sûres. Il est retiré.
export function conformityRate(indicators = {}, version = "v2019") {
  const vals = numerosDe(version).map((n) => indicators[n]?.status || "a_verifier");
  const applicable = vals.filter((s) => s !== "non_applicable");
  if (!applicable.length) return null;
  const conforme = applicable.filter((s) => s === "conforme").length;
  return Math.round((conforme / applicable.length) * 100);
}

// Où en est l'organisme par rapport à l'échéance réglementaire. C'est le seul
// message qui compte entre aujourd'hui et le 1er novembre 2026.
export function etatVersion(qualiopi = {}, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const version = qualiopi.version || "v2019";
  const applicable = versionApplicable(aujourdhui);
  const jours = Math.round((new Date(BASCULE_V2026 + "T00:00:00Z") - new Date(aujourdhui + "T00:00:00Z")) / 864e5);
  // « À jour » est un constat de fait : avant le 1er novembre, suivre le
  // référentiel 2019 EST conforme. Mais s'en tenir là ne dirait rien pendant
  // les mois où il faut préparer la bascule — et il n'y a pas de période de
  // transition pour rattraper. L'alerte est donc indépendante de aJour.
  if (version === "v2026") return { version, applicable, aJour: version === applicable, jours, alerte: null };

  if (jours <= 0) {
    return {
      version, applicable, aJour: false, jours,
      alerte: { gravite: "bloquant", message: `Le référentiel à 33 indicateurs s'applique depuis le ${BASCULE_V2026}. Ce campus est encore suivi sur l'ancien : le tableau de conformité ne correspond plus à ce que l'auditeur vérifiera.` },
    };
  }
  return {
    version, applicable, aJour: true, jours,
    alerte: jours <= HORIZON_PREPARATION_JOURS
      ? { gravite: "important", message: `Le référentiel à 33 indicateurs (${QUALIOPI_VERSIONS.v2026.texte}) s'applique dans ${jours} jour(s), sans période de transition. Les indicateurs sont renumérotés : la reprise demande une relecture, elle ne se fait pas toute seule.` }
      : { gravite: "conseille", message: `Le référentiel passera à 33 indicateurs le ${BASCULE_V2026} (${QUALIOPI_VERSIONS.v2026.texte}).` },
  };
}

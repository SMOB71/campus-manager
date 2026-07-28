// Référentiel National Qualité (Qualiopi) — 7 critères / 32 indicateurs.
// Libellés condensés (le DO reconnaît le référentiel ; une note libre par indicateur
// permet de préciser). tag = périmètre conditionnel (certifiant / apprentissage / handicap).
export const QUALIOPI_REFERENCE = [
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
export function conformityRate(indicators = {}) {
  const vals = QUALIOPI_INDICATOR_NUMBERS.map((n) => indicators[n]?.status || "a_verifier");
  const applicable = vals.filter((s) => s !== "non_applicable");
  if (!applicable.length) return null;
  const conforme = applicable.filter((s) => s === "conforme").length;
  return Math.round((conforme / applicable.length) * 100);
}

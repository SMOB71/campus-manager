// Acquis, dispenses, équivalences et allègements de parcours — logique pure.
//
// LA DISTINCTION QUI COMMANDE TOUT LE MODULE, et que presque tous les logiciels
// du secteur écrasent en une seule case « dispensé » :
//
//   • ALLÈGEMENT DE PARCOURS — l'apprenant est dispensé de SUIVRE la formation
//     du bloc. Il passe quand même l'épreuve. Cela change ce qu'on attend de son
//     assiduité et peut réduire la durée du contrat (art. L. 6222-7-1), mais
//     cela ne valide RIEN.
//
//   • DISPENSE D'ÉPREUVE, ÉQUIVALENCE, ACQUIS ANTÉRIEUR, VAE — le bloc est
//     réputé acquis : il ne passe pas l'épreuve. Cela change la CERTIFICATION.
//
// Confondre les deux se paie dans les deux sens :
//   — traiter un allègement comme un acquis, c'est délivrer un bloc que
//     personne n'a jamais évalué ;
//   — traiter une dispense comme un allègement, c'est convoquer quelqu'un à une
//     épreuve dont il est exempté, et le compter absent d'un cours qu'il n'avait
//     pas à suivre.
//
// D'où deux axes INDÉPENDANTS sur chaque décision : dispense d'épreuve, et
// dispense de formation. Le motif ne fait que proposer des valeurs par défaut.
//
// Depuis la loi du 5 septembre 2018, les blocs de compétences sont acquis
// définitivement : un bloc validé lors d'une session antérieure n'est pas à
// repasser. C'est le cas d'usage le plus fréquent, et celui qui rendait les
// bulletins faux tant qu'il n'était pas modélisé.

export const MOTIFS = {
  acquis_anterieur: {
    label: "Bloc acquis lors d'une session précédente",
    aide: "Les blocs de compétences sont acquis définitivement (loi du 5 septembre 2018).",
    dispenseEpreuve: true, dispenseFormation: true,
  },
  vae: {
    label: "Bloc validé par validation des acquis de l'expérience",
    aide: "VAE partielle : le jury a validé ce bloc, pas la certification entière.",
    dispenseEpreuve: true, dispenseFormation: true,
  },
  equivalence: {
    label: "Équivalence au titre d'une autre certification",
    aide: "Reconnaissance d'un bloc obtenu dans une autre certification.",
    dispenseEpreuve: true, dispenseFormation: true,
  },
  dispense: {
    label: "Dispense réglementaire d'épreuve",
    aide: "Dispense prévue par le règlement de la certification. Le suivi de la formation reste possible.",
    dispenseEpreuve: true, dispenseFormation: false,
  },
  allegement: {
    label: "Allègement de parcours",
    aide: "Dispensé de SUIVRE la formation du bloc, mais il passe l'épreuve.",
    dispenseEpreuve: false, dispenseFormation: true,
  },
};

export const MOTIF_IDS = Object.keys(MOTIFS);

// Une décision d'acquis engage la certification : elle doit être datée, signée
// et appuyée sur une pièce. Un contrôle de certificateur qui trouve un bloc
// « acquis » sans justificatif, c'est un écart, pas une remarque.
export function normalizeExemption(e = {}) {
  const motif = MOTIF_IDS.includes(e.motif) ? e.motif : null;
  const def = motif ? MOTIFS[motif] : { dispenseEpreuve: false, dispenseFormation: false };
  return {
    id: e.id || null,
    learnerId: e.learnerId || null,
    blocId: e.blocId || null,
    motif,
    // Le motif propose ; la décision dispose. Un organisme peut parfaitement
    // dispenser d'épreuve tout en maintenant la présence en cours.
    dispenseEpreuve: e.dispenseEpreuve === undefined ? def.dispenseEpreuve : !!e.dispenseEpreuve,
    dispenseFormation: e.dispenseFormation === undefined ? def.dispenseFormation : !!e.dispenseFormation,
    justificatif: String(e.justificatif || "").trim(),
    documentId: e.documentId || null,
    dateDecision: e.dateDecision || "",
    decidePar: String(e.decidePar || "").trim(),
    note: String(e.note || "").trim(),
  };
}

export function validateExemption(e = {}) {
  const x = normalizeExemption(e);
  const errors = [];
  if (!x.learnerId) errors.push("apprenant requis");
  if (!x.blocId) errors.push("bloc requis");
  if (!x.motif) errors.push(`motif requis (${MOTIF_IDS.join(", ")})`);
  // Une décision qui ne dispense de rien ne veut rien dire — et laisserait
  // croire à un aménagement qui n'existe pas.
  if (x.motif && !x.dispenseEpreuve && !x.dispenseFormation) {
    errors.push("une décision doit dispenser de l'épreuve, de la formation, ou des deux");
  }
  const warnings = [];
  if (!x.justificatif && !x.documentId) warnings.push("aucune pièce justificative");
  if (!x.dateDecision) warnings.push("date de décision absente");
  if (!x.decidePar) warnings.push("auteur de la décision absent");
  return { ok: errors.length === 0, errors, warnings, exemption: x };
}

// Une décision est OPPOSABLE si elle est justifiée : pièce, date et auteur.
// Elle s'applique quand même sans cela — on n'empêche pas de saisir pendant
// qu'on rassemble les papiers — mais elle ne pourra pas fonder un titre complet.
export function estOpposable(x) {
  return !!((x.justificatif || x.documentId) && x.dateDecision && x.decidePar);
}

export const STATUT_LABEL = {
  acquis: "Acquis",
  non_acquis: "Non acquis",
  en_cours: "En cours",
  acquis_dispense: "Acquis par dispense",
};

// Applique les décisions aux blocs issus de blockReport().
// Le statut d'origine n'est JAMAIS écrasé : il reste lisible sous
// `statutEvalue`, parce qu'un bloc dispensé qui avait par ailleurs des notes
// doit pouvoir être expliqué au jury.
export function applyExemptions(blocs = [], exemptions = []) {
  const parBloc = new Map(exemptions.map(normalizeExemption).filter((e) => e.blocId).map((e) => [e.blocId, e]));
  return blocs.map((b) => {
    const e = parBloc.get(b.blocId);
    if (!e) return { ...b, statutEvalue: b.status, dispense: null };
    const opposable = estOpposable(e);
    return {
      ...b,
      statutEvalue: b.status,
      // Seule une dispense d'ÉPREUVE vaut acquisition. Un allègement de parcours
      // laisse le bloc exactement où il était : il reste à évaluer.
      status: e.dispenseEpreuve ? "acquis_dispense" : b.status,
      dispense: {
        motif: e.motif, motifLabel: MOTIFS[e.motif]?.label || "",
        dispenseEpreuve: e.dispenseEpreuve,
        dispenseFormation: e.dispenseFormation,
        justificatif: e.justificatif, documentId: e.documentId,
        dateDecision: e.dateDecision, decidePar: e.decidePar, note: e.note,
        opposable,
      },
    };
  });
}

// Synthèse de certification tenant compte des dispenses.
// Elle remplace certificationSummary() dès qu'il y a des décisions à considérer.
export function certification(blocs = []) {
  const acquisEvalues = blocs.filter((b) => b.status === "acquis");
  const acquisDispenses = blocs.filter((b) => b.status === "acquis_dispense");
  const nonAcquis = blocs.filter((b) => b.status === "non_acquis");
  const enCours = blocs.filter((b) => b.status === "en_cours");
  const tousAcquis = acquisEvalues.length + acquisDispenses.length;

  // Une dispense non justifiée ne peut pas fonder un titre : on la compte comme
  // acquise pour le suivi pédagogique, mais elle bloque la délivrance tant que
  // la pièce manque. C'est exactement ce qu'un certificateur contrôle.
  const dispensesNonJustifiees = acquisDispenses.filter((b) => !b.dispense?.opposable);

  return {
    total: blocs.length,
    acquis: tousAcquis,
    acquisEvalues: acquisEvalues.length,
    acquisParDispense: acquisDispenses.length,
    nonAcquis: nonAcquis.length,
    enCours: enCours.length,
    // Aucune compensation entre blocs : le titre suppose TOUS les blocs acquis.
    titreComplet: blocs.length > 0 && tousAcquis === blocs.length && dispensesNonJustifiees.length === 0,
    // On distingue « il manque des blocs » de « il manque des papiers » : ce ne
    // sont pas les mêmes actions, ni les mêmes délais.
    blocageDocumentaire: blocs.length > 0 && tousAcquis === blocs.length && dispensesNonJustifiees.length > 0,
    dispensesNonJustifiees: dispensesNonJustifiees.map((b) => b.code || b.label),
    resteAValider: nonAcquis.concat(enCours).map((b) => b.code || b.label),
    // Traçabilité : un titre complet dont deux blocs viennent d'une équivalence
    // doit pouvoir être expliqué. C'est ce que le jury demande en premier.
    origines: blocs
      .filter((b) => b.dispense?.dispenseEpreuve)
      .map((b) => ({ bloc: b.code || b.label, motif: b.dispense.motif, motifLabel: b.dispense.motifLabel, opposable: b.dispense.opposable })),
  };
}

// Blocs dont la FORMATION est allégée : ce sont eux qu'il ne faut pas compter
// dans l'assiduité attendue, sous peine de fabriquer un absentéisme qui n'existe
// pas — et d'alerter à tort sur un décrochage.
export function blocsAlleges(blocs = []) {
  return blocs.filter((b) => b.dispense?.dispenseFormation).map((b) => b.blocId);
}

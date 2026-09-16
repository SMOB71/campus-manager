// Catalogue de formation — logique pure, aucune I/O.
//
// CE QU'EST UN CATALOGUE POUR UN ORGANISME DE FORMATION : ce n'est pas une
// plaquette, c'est l'exécution de l'indicateur 1 du référentiel qualité —
// « information accessible au public sur les prestations, les prérequis, les
// objectifs, la durée et les modalités ». Ce qui est publié ENGAGE, et ce qui
// manque est relevable.
//
// LE POINT DE DROIT QUE LES CATALOGUES RATENT LE PLUS SOUVENT :
//
//   LA FORMATION EST GRATUITE POUR L'APPRENTI ET SON REPRÉSENTANT LÉGAL
//   (art. L. 6211-1). Publier un tarif sur une offre en apprentissage laisse
//   croire à une famille qu'elle doit payer — et le coût réel n'est pas un prix
//   de vente, c'est un niveau de prise en charge fixé par la branche, versé par
//   l'OPCO. Afficher « 9 000 € » sur une offre d'apprentissage est à la fois
//   faux pour le candidat et sans rapport avec ce que l'organisme perçoit.
//
// LE SECOND PIÈGE, ET IL EST PARTAGÉ AVEC LES INDICATEURS PUBLIÉS :
//
//   Publier « 100 % de réussite » sur une promotion de trois apprenants
//   n'informe personne et DÉSIGNE tout le monde. Le catalogue réutilise le
//   seuil d'effectif du module des indicateurs — il ne le réimplémente pas, et
//   surtout il ne le contourne pas au motif que c'est « du commercial ».
//
// LA MENTION QUE PERSONNE N'ÉCRIT SPONTANÉMENT : le DÉLAI D'ACCÈS, c'est-à-dire
// le temps entre la demande du bénéficiaire et l'entrée en formation. Il est
// attendu à l'indicateur 1, et son absence est l'un des écarts les plus
// fréquemment relevés.
//
// ⚠️ Mentions attendues et seuil à revérifier : le guide de lecture du
// référentiel les précise et a évolué.

import { SEUIL_EFFECTIF } from "./indicateurs.js";

export const MODALITES = {
  presentiel: "Présentiel",
  distanciel: "À distance",
  mixte: "Mixte",
};

// La nature commande le régime de prix : c'est le cœur du module.
export const NATURES = {
  apprentissage: {
    label: "Formation par apprentissage",
    // Gratuité d'ordre public : ce n'est pas une politique commerciale.
    gratuitePourBeneficiaire: true,
    base: "art. L. 6211-1",
    financement: "Prise en charge par l'opérateur de compétences au niveau fixé par la branche",
  },
  continue: {
    label: "Formation professionnelle continue",
    gratuitePourBeneficiaire: false,
    financement: "Entreprise, opérateur de compétences, ou bénéficiaire",
  },
  initiale: {
    label: "Formation initiale hors apprentissage",
    gratuitePourBeneficiaire: false,
    financement: "Frais de scolarité",
  },
};

// Mentions attendues d'une offre publiée. Chacune dit d'où elle vient : une
// exigence sans base ne se défend pas, et personne ne sait ce qu'il risque.
export const MENTIONS_PUBLIABLES = [
  { cle: "intitule", label: "Intitulé de la formation", base: "indicateur 1" },
  { cle: "objectifs", label: "Objectifs", base: "indicateur 1" },
  { cle: "prerequis", label: "Prérequis et niveau d'entrée", base: "indicateur 1" },
  { cle: "publicVise", label: "Public visé", base: "indicateur 1" },
  { cle: "dureeHeures", label: "Durée en heures", base: "indicateur 1" },
  { cle: "modalites", label: "Modalités (présentiel, distance, mixte)", base: "indicateur 1" },
  // Celle-ci manque presque toujours.
  { cle: "delaiAcces", label: "Délai d'accès", base: "indicateur 1", oubliee: true },
  { cle: "tarif", label: "Tarif ou conditions de financement", base: "indicateur 1" },
  { cle: "evaluation", label: "Modalités d'évaluation", base: "indicateur 1" },
  { cle: "accessibilite", label: "Accessibilité aux personnes en situation de handicap", base: "indicateur 26" },
  { cle: "debouches", label: "Débouchés, équivalences et passerelles", base: "indicateur 3" },
  { cle: "contact", label: "Contact et modalités d'inscription", base: "indicateur 1" },
];

const vide = (v) => !String(v ?? "").trim();

export function validateOffre(o = {}) {
  const errors = [], warnings = [];
  const nature = NATURES[o.nature];
  if (!nature) errors.push(`nature requise (${Object.keys(NATURES).join(", ")})`);
  if (o.modalites && !MODALITES[o.modalites]) errors.push("modalité inconnue");

  const manquantes = MENTIONS_PUBLIABLES.filter((m) => {
    const v = o[m.cle];
    if (typeof v === "number") return !Number.isFinite(v);
    return vide(v);
  });

  // Une offre en BROUILLON peut être incomplète ; une offre PUBLIÉE, non. Le
  // moment où l'exigence mord est la publication, pas la saisie.
  if (o.publiee) {
    for (const m of manquantes) errors.push(`${m.label} — ${m.base}`);
  } else {
    for (const m of manquantes) warnings.push(`${m.label} — ${m.base}`);
  }

  // LE POINT DE DROIT. Un tarif sur une offre d'apprentissage induit en erreur.
  if (nature?.gratuitePourBeneficiaire && o.tarifMontant != null && Number(o.tarifMontant) > 0) {
    errors.push(`un montant ne peut pas être affiché sur une offre en apprentissage : la formation est gratuite pour l'apprenti et son représentant légal (${nature.base}). Le coût est pris en charge par l'opérateur de compétences, il n'est pas un prix de vente.`);
  }
  if (o.dureeHeures != null && Number(o.dureeHeures) <= 0) errors.push("durée invalide");
  return { ok: errors.length === 0, errors, warnings, manquantes };
}

// Le libellé de tarif à publier. Pour l'apprentissage, il se rédige tout seul —
// et c'est mieux ainsi que de laisser quelqu'un écrire « nous consulter ».
export function libelleTarif(o = {}) {
  const nature = NATURES[o.nature];
  if (nature?.gratuitePourBeneficiaire) {
    return {
      texte: `Formation gratuite pour l'apprenti et son représentant légal (${nature.base}). ${nature.financement}.`,
      montantAffichable: false,
    };
  }
  if (o.tarifMontant != null) {
    return { texte: `${o.tarifMontant} € ${o.tarifUnite || "pour le parcours complet"}`, montantAffichable: true };
  }
  return { texte: String(o.tarif || "").trim() || "Tarif sur demande", montantAffichable: true };
}

// Indicateurs de résultats joints à l'offre. On NE publie pas sous le seuil, et
// on dit pourquoi — la même règle que sur les indicateurs réglementaires, parce
// que c'est la même donnée et les mêmes personnes.
export function resultatsPubliables(resultats = {}, { seuil = SEUIL_EFFECTIF } = {}) {
  const lignes = [];
  for (const [cle, def] of Object.entries({
    obtention: "Taux d'obtention de la certification",
    poursuite: "Taux de poursuite d'études",
    insertion: "Taux d'insertion professionnelle",
    rupture: "Taux de rupture des contrats",
  })) {
    const r = resultats[cle];
    if (!r || r.valeur == null) { lignes.push({ cle, label: def, publiable: false, motif: "non renseigné" }); continue; }
    const effectif = r.effectif ?? null;
    const assez = effectif == null ? false : effectif >= seuil;
    lignes.push({
      cle, label: def,
      valeur: assez ? r.valeur : null, effectif, publiable: assez,
      motif: assez ? null
        : effectif == null ? "effectif non renseigné : un taux sans son effectif n'est pas une information"
          : `effectif de ${effectif}, inférieur au seuil de ${seuil} : publier un taux sur si peu de personnes n'informe pas et rend les individus identifiables`,
    });
  }
  return {
    lignes, seuil,
    publiables: lignes.filter((l) => l.publiable).length,
    reserve: "Les taux non publiables ne sont pas masqués par prudence commerciale : en deçà du seuil, ils désignent des personnes.",
  };
}

// Ce que voit le public. Rien d'autre ne sort : une offre interne, un coût de
// revient ou une marge n'ont pas à traverser cette fonction.
export function versPublic(o = {}, { resultats = null, seuil = SEUIL_EFFECTIF } = {}) {
  const tarif = libelleTarif(o);
  return {
    id: o.id, intitule: o.intitule, nature: o.nature, natureLabel: NATURES[o.nature]?.label || o.nature,
    objectifs: o.objectifs, prerequis: o.prerequis, publicVise: o.publicVise,
    dureeHeures: o.dureeHeures ?? null,
    modalites: o.modalites, modalitesLabel: MODALITES[o.modalites] || o.modalites,
    delaiAcces: o.delaiAcces, evaluation: o.evaluation,
    accessibilite: o.accessibilite, debouches: o.debouches, contact: o.contact,
    codeRncp: o.codeRncp || null,
    tarif: tarif.texte,
    resultats: resultats ? resultatsPubliables(resultats, { seuil }) : null,
  };
}

// État du catalogue : ce qui est publié, ce qui ne pourrait pas l'être.
export function etatCatalogue(offres = []) {
  const publiees = offres.filter((o) => o.publiee);
  const invalides = publiees.map((o) => ({ offre: o, v: validateOffre(o) })).filter((x) => !x.v.ok);
  const oubliDelai = offres.filter((o) => vide(o.delaiAcces)).length;
  return {
    total: offres.length, publiees: publiees.length,
    invalides: invalides.map((x) => ({ id: x.offre.id, intitule: x.offre.intitule, erreurs: x.v.errors })),
    // Signalé à part parce que c'est l'écart le plus fréquemment relevé.
    sansDelaiAcces: oubliDelai,
    conforme: invalides.length === 0,
    reserve: "Ce qui est publié engage l'organisme. Le contrôle porte ici sur la présence des mentions, pas sur l'exactitude de leur contenu.",
  };
}

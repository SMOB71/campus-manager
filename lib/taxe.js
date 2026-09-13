// Taxe d'apprentissage — solde et plateforme SOLTéA. Logique pure.
//
// CE QUI SE JOUE, ET QUAND — la taxe d'apprentissage représente 0,68 % de la
// masse salariale. 87 % financent l'apprentissage par les OPCO ; les 13 %
// restants — le SOLDE, soit 0,09 % de la masse salariale — sont répartis par les
// EMPLOYEURS eux-mêmes, sur la plateforme SOLTéA, entre les établissements
// qu'ils choisissent. C'est la seule recette de l'organisme qui dépende
// directement de sa notoriété auprès des entreprises.
//
// LE PIÈGE DE CALENDRIER, QUI COÛTE UNE ANNÉE ENTIÈRE :
//
//   La campagne de répartition court de MAI à OCTOBRE. Mais pour y figurer, il
//   faut être habilité, et les demandes d'habilitation se déposent de NOVEMBRE
//   à JANVIER — quatre mois avant l'ouverture. Un organisme qui pense à la taxe
//   d'apprentissage au printemps découvre qu'il ne peut plus être désigné : le
//   guichet est fermé depuis janvier, et il n'y a pas de rattrapage.
//
// D'où une alerte qui se déclenche à l'automne, pas au printemps.
//
// SECOND PIÈGE — LE VERSEMENT DE SEPTEMBRE N'EST PAS LE TOTAL. La campagne
// comporte DEUX périodes de répartition et DEUX versements : le premier début
// septembre, le second début novembre. Considérer le premier comme définitif
// sous-estime la recette et fausse la trésorerie du dernier trimestre.
//
// ⚠️ Dates et taux à revérifier à chaque campagne : le calendrier est publié
// chaque année et a déjà bougé.

export const PART_SOLDE = 0.13;              // 13 % de la taxe d'apprentissage
export const TAUX_TAXE_MASSE_SALARIALE = 0.0068;
export const TAUX_SOLDE_MASSE_SALARIALE = 0.0009;   // 0,09 %, soit 13 % de 0,68 %

// Calendrier de référence. Il est PARAMÉTRABLE parce qu'il est republié chaque
// année : figer 2026 dans le code garantirait une alerte fausse en 2027.
export const CALENDRIER_2026 = {
  annee: 2026,
  habilitationDebut: "2025-11-03",
  habilitationFin: "2026-01-16",
  periode1Debut: "2026-05-26",
  periode1Fin: "2026-08-21",
  versement1: "2026-09-01",
  periode2Debut: "2026-09-03",
  periode2Fin: "2026-10-21",
  versement2: "2026-11-05",
};

export const ETATS_HABILITATION = {
  non_demandee: "Non demandée",
  deposee: "Demande déposée",
  habilite: "Habilité",
  refusee: "Refusée",
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const jours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5) : null);

// Estimation du solde qu'un employeur a à répartir. Sert à argumenter auprès
// d'une entreprise partenaire : « votre solde représente environ X € ».
export function soldeEstime(masseSalariale) {
  const m = Number(masseSalariale) || 0;
  if (m <= 0) return null;
  return {
    masseSalariale: round2(m),
    taxeTotale: round2(m * TAUX_TAXE_MASSE_SALARIALE),
    solde: round2(m * TAUX_SOLDE_MASSE_SALARIALE),
    // On dit d'où vient le chiffre : un montant sans sa formule ne se discute pas.
    formule: `${(TAUX_TAXE_MASSE_SALARIALE * 100).toFixed(2)} % de la masse salariale, dont ${PART_SOLDE * 100} % de solde`,
  };
}

export function validateHabilitation(h = {}) {
  const errors = [], warnings = [];
  if (h.etat && !ETATS_HABILITATION[h.etat]) errors.push(`état inconnu (${Object.keys(ETATS_HABILITATION).join(", ")})`);
  if (["deposee", "habilite", "refusee"].includes(h.etat) && !h.dateDepot) {
    errors.push("date de dépôt requise dès que la demande est partie");
  }
  if (h.etat === "habilite" && !String(h.numeroUai || "").trim()) {
    warnings.push("aucun code UAI : c'est lui qui identifie l'établissement sur la plateforme, une entreprise ne vous trouvera pas sans");
  }
  if (h.etat === "refusee" && !String(h.motif || "").trim()) warnings.push("refus sans motif : impossible de corriger pour la campagne suivante");
  return { ok: errors.length === 0, errors, warnings };
}

// État de la campagne à une date donnée, du point de vue de l'organisme.
export function etatCampagne({ habilitation = {}, versements = [], calendrier = CALENDRIER_2026, aujourdhui } = {}) {
  const c = calendrier;
  const etat = ETATS_HABILITATION[habilitation.etat] ? habilitation.etat : "non_demandee";
  const alertes = [];
  let risque = "aucun";

  // Le piège de calendrier : l'alerte doit tomber à l'automne.
  if (etat === "non_demandee") {
    if (aujourdhui >= c.habilitationDebut && aujourdhui <= c.habilitationFin) {
      const reste = jours(aujourdhui, c.habilitationFin);
      risque = reste <= 30 ? "eleve" : "moyen";
      alertes.push({
        code: "habilitation_ouverte",
        message: `Guichet d'habilitation SOLTéA ouvert jusqu'au ${c.habilitationFin} (${reste} jour(s)). Sans habilitation, aucune entreprise ne pourra vous désigner pour la campagne ${c.annee}.`,
      });
    } else if (aujourdhui > c.habilitationFin) {
      risque = "critique";
      alertes.push({
        code: "habilitation_manquee",
        message: `Guichet d'habilitation fermé depuis le ${c.habilitationFin} : aucun solde de taxe d'apprentissage ne pourra être perçu au titre de ${c.annee}. Il n'existe pas de rattrapage — préparer la campagne suivante.`,
      });
    } else {
      alertes.push({ code: "habilitation_a_venir", message: `Le guichet d'habilitation ${c.annee} ouvrira le ${c.habilitationDebut}.` });
    }
  }
  if (etat === "deposee" && aujourdhui > c.habilitationFin) {
    risque = "moyen";
    alertes.push({ code: "habilitation_en_attente", message: "Demande déposée, décision non enregistrée : vérifier avant l'ouverture de la période de répartition." });
  }
  if (etat === "refusee") {
    risque = "critique";
    alertes.push({ code: "habilitation_refusee", message: `Habilitation refusée${habilitation.motif ? ` : ${habilitation.motif}` : ""}. Aucun solde ne sera perçu cette année.` });
  }

  // Périodes de répartition : c'est là que les entreprises désignent.
  let periode = null;
  if (aujourdhui >= c.periode1Debut && aujourdhui <= c.periode1Fin) periode = 1;
  else if (aujourdhui >= c.periode2Debut && aujourdhui <= c.periode2Fin) periode = 2;
  if (periode && etat === "habilite") {
    const fin = periode === 1 ? c.periode1Fin : c.periode2Fin;
    alertes.push({ code: "periode_ouverte", message: `Période de répartition ${periode} ouverte jusqu'au ${fin} : c'est maintenant que les entreprises vous désignent.` });
  }

  const recu = round2(versements.reduce((s, v) => s + (Number(v.montant) || 0), 0));
  const v1 = versements.some((v) => v.periode === 1);
  const v2 = versements.some((v) => v.periode === 2);

  // Second piège : ne pas prendre le versement de septembre pour un total.
  if (v1 && !v2 && aujourdhui < c.versement2) {
    alertes.push({
      code: "second_versement_attendu",
      message: `Un second versement est attendu à partir du ${c.versement2} : le montant reçu n'est pas le total de la campagne.`,
    });
  }
  if (etat === "habilite" && !v1 && aujourdhui > c.versement1) {
    risque = risque === "aucun" ? "moyen" : risque;
    alertes.push({ code: "premier_versement_absent", message: `Aucun versement enregistré alors que le premier était prévu à partir du ${c.versement1} : vérifier les désignations reçues sur la plateforme.` });
  }

  return {
    annee: c.annee, etat, etatLabel: ETATS_HABILITATION[etat],
    numeroUai: habilitation.numeroUai || null,
    periodeEnCours: periode,
    versements: versements.map((v) => ({ ...v, montant: round2(v.montant) })),
    total: recu,
    // « Partiel » tant que la campagne n'est pas close : une recette annoncée
    // comme définitive en septembre fausse la trésorerie du dernier trimestre.
    totalDefinitif: v2 || aujourdhui > c.versement2,
    risque, alertes,
    calendrier: c,
  };
}

// Comparaison d'une campagne à la précédente : c'est le seul chiffre qui dit si
// l'effort de relation entreprise a produit quelque chose.
export function evolution(campagneN, campagneN1) {
  const a = round2(campagneN?.total), b = round2(campagneN1?.total);
  if (!b) return { total: a, precedent: b, ecart: null, pourcent: null };
  return { total: a, precedent: b, ecart: round2(a - b), pourcent: Math.round(((a - b) / b) * 1000) / 10 };
}

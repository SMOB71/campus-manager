// Dossier Cerfa d'apprentissage (FA13) — logique pure, aucune I/O.
//
// PÉRIMÈTRE ASSUMÉ : ce module produit un DOSSIER DE DÉPÔT complet et contrôlé —
// toutes les rubriques du Cerfa, renseignées et vérifiées — destiné à la saisie
// sur le portail du financeur ou au dépôt dématérialisé. Il ne produit pas le PDF
// officiel timbré, qui appartient à l'administration : prétendre le contraire
// exposerait l'établissement à un rejet pour non-conformité de forme.
//
// CE QUI FAIT LA VALEUR DE CE MODULE : le calcul des PÉRIODES DE RÉMUNÉRATION.
// Le Cerfa exige une ligne par période, et les périodes ne se coupent pas
// seulement aux anniversaires du contrat : elles se coupent AUSSI quand l'apprenti
// change de tranche d'âge (18, 21, 26 ans).
//
// ⚠️ RÈGLE EXACTE, vérifiée sur service-public.gouv.fr (F2918) le 7 septembre 2026 :
// « Les majorations liées au passage d'une tranche d'âge à une autre prennent effet
// à compter du 1er jour du MOIS SUIVANT la date d'anniversaire. » La coupure ne
// tombe donc PAS le jour de l'anniversaire — se tromper ici produit un rappel de
// salaire ou un dossier rejeté. Même règle en professionnalisation.

import { ageAt, minimumWage, effectiveDateOfBirthdayRaise, SMIC_MENSUEL_DEFAUT } from "./contracts.js";

// Nomenclatures officielles utiles au dépôt (codes Cerfa FA13).
export const TYPE_EMPLOYEUR = {
  11: "Entreprise inscrite au répertoire des métiers",
  12: "Entreprise inscrite au registre du commerce",
  13: "Entreprise inscrite aux deux registres",
  14: "Autre entreprise privée",
  21: "Service de l'État",
  22: "Commune",
  23: "Département",
  24: "Région",
  25: "Établissement public hospitalier",
  26: "Autre employeur public",
};
export const EMPLOYEUR_SPECIFIQUE = {
  0: "Aucun",
  1: "Entreprise de travail temporaire",
  2: "Groupement d'employeurs",
  3: "Employeur saisonnier (contrat partagé)",
  4: "Apprentissage familial (parent employeur)",
};
export const NATIONALITE = { 1: "Française", 2: "Union européenne", 3: "Hors Union européenne" };
export const REGIME_SOCIAL = { 1: "MSA (régime agricole)", 2: "URSSAF (régime général)" };
export const SITUATION_AVANT_CONTRAT = {
  1: "Scolaire",
  2: "Prépa apprentissage",
  3: "Étudiant",
  4: "Contrat d'apprentissage",
  5: "Contrat de professionnalisation",
  6: "Contrat aidé",
  7: "En formation au CFA (sans contrat)",
  8: "Stagiaire de la formation professionnelle",
  9: "Salarié",
  10: "Personne à la recherche d'un emploi",
  11: "Inactif",
};
export const DEROGATION = {
  0: "Aucune",
  11: "Âge de l'apprenti (moins de 16 ans)",
  12: "Âge de l'apprenti (plus de 29 ans)",
  21: "Réduction de la durée du contrat",
  22: "Allongement de la durée du contrat",
  31: "Travaux réglementés (jeune de moins de 18 ans)",
  50: "Cumul de dérogations",
};
export const TYPE_CONTRAT = {
  11: "Premier contrat d'apprentissage",
  21: "Nouveau contrat avec un même employeur",
  22: "Nouveau contrat avec un autre employeur",
  31: "Avenant : modification de situation juridique de l'employeur",
  32: "Avenant : changement de maître d'apprentissage",
  33: "Avenant : modification de la durée du contrat",
  34: "Avenant : autre modification",
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateISO, n) => iso(new Date(new Date(dateISO + "T00:00:00Z").getTime() + n * 864e5));
const addYears = (dateISO, n) => {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return iso(d);
};

// Dates d'EFFET des changements de tranche d'âge à l'intérieur du contrat :
// le 1er du mois suivant l'anniversaire des 18, 21 et 26 ans (et non l'anniversaire).
export function ageBoundaryDates(birthDateISO, startISO, endISO) {
  if (!birthDateISO || !startISO || !endISO) return [];
  const out = [];
  for (const n of [18, 21, 26]) {
    const anniversaire = addYears(birthDateISO, n);
    const effet = effectiveDateOfBirthdayRaise(anniversaire);
    if (effet && effet > startISO && effet <= endISO) out.push(effet);
  }
  return out;
}

// Périodes de rémunération du contrat, telles qu'attendues par le Cerfa.
// Coupures : chaque anniversaire du CONTRAT (changement d'année d'exécution) et
// chaque anniversaire de l'APPRENTI franchissant une borne de tranche d'âge.
export function salaryPeriods({ dateDebut, dateFin, dateNaissance, smic = SMIC_MENSUEL_DEFAUT, type = "apprentissage", qualifie = false, smc = null }) {
  if (!dateDebut || !dateFin || dateFin <= dateDebut) return [];
  const cuts = new Set([dateDebut]);
  // anniversaires du contrat
  for (let y = 1; y <= 4; y++) {
    const d = addYears(dateDebut, y);
    if (d > dateDebut && d <= dateFin) cuts.add(d);
  }
  // franchissements de tranche d'âge
  for (const d of ageBoundaryDates(dateNaissance, dateDebut, dateFin)) cuts.add(d);
  const starts = [...cuts].sort();
  const periods = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? addDays(starts[i + 1], -1) : dateFin;
    if (to < from) continue;
    // L'année d'exécution est déterminée par l'ancienneté au DÉBUT de la période.
    let year = 1;
    for (let y = 1; y <= 4; y++) if (from >= addYears(dateDebut, y)) year = y + 1;
    // Âge civil au début de la période, et âge « de rémunération » : tant que le
    // 1er du mois suivant l'anniversaire n'est pas atteint, l'ancienne tranche
    // reste en vigueur, même si l'apprenti a déjà eu son anniversaire.
    const age = dateNaissance ? ageAt(dateNaissance, from) : null;
    let ageRemuneration = age;
    if (age != null && dateNaissance) {
      const anniversaire = addYears(dateNaissance, age);
      const effet = effectiveDateOfBirthdayRaise(anniversaire);
      if (effet && from < effet) ageRemuneration = age - 1;
    }
    const wage = ageRemuneration != null ? minimumWage({ age: ageRemuneration, year, smic, type, qualifie, smc }) : null;
    periods.push({
      from, to, year, age, ageRemuneration,
      rate: wage ? wage.rate : null,
      bracket: wage ? wage.bracket : null,
      base: wage ? wage.base : null,
      montantMinimum: wage ? wage.amount : null,
    });
  }
  return periods;
}

// Un champ manquant sur le Cerfa, c'est un dossier rejeté et des semaines perdues.
// On distingue ce qui est EXIGÉ de ce qui est conditionnel (mineur, dérogation…).
function field(label, value, { required = true, code = null, hint = "" } = {}) {
  const filled = value !== null && value !== undefined && String(value).trim() !== "";
  return { label, value: filled ? value : null, required, filled, code, hint };
}

// Construit le dossier complet, section par section, dans l'ordre du formulaire.
export function buildCerfa({ contract, learner, company, campus, curriculum, smic = SMIC_MENSUEL_DEFAUT }) {
  const c = contract || {};
  const l = learner || {};
  const co = company || {};
  const ca = campus || {};
  const cu = curriculum || {};
  const mineur = l.dateNaissance && c.dateDebut ? ageAt(l.dateNaissance, c.dateDebut) < 18 : false;

  const sections = [
    {
      key: "employeur", title: "L'employeur",
      fields: [
        field("Raison sociale", co.name),
        field("Adresse", [co.adresse, co.codePostal, co.ville].filter(Boolean).join(" ") || co.address),
        field("Téléphone", co.contactPhone, { required: false }),
        field("Courriel", co.contactEmail, { required: false }),
        field("SIRET", co.siret),
        field("Type d'employeur", co.typeEmployeur ? `${co.typeEmployeur} — ${TYPE_EMPLOYEUR[co.typeEmployeur] || "?"}` : null, { code: "typeEmployeur" }),
        field("Employeur spécifique", co.employeurSpecifique != null && co.employeurSpecifique !== "" ? `${co.employeurSpecifique} — ${EMPLOYEUR_SPECIFIQUE[co.employeurSpecifique] || "?"}` : null, { code: "employeurSpecifique" }),
        field("Code NAF", co.naf),
        field("Effectif de l'entreprise", co.effectif),
        field("Convention collective applicable", co.conventionCollective),
        field("Code IDCC", co.idcc, { hint: "4 chiffres — identifiant de la convention collective" }),
        field("Caisse de retraite complémentaire", co.caisseRetraite, { required: false }),
      ],
    },
    {
      key: "apprenti", title: "L'apprenti",
      fields: [
        field("Nom de naissance", l.nom),
        field("Prénom", l.prenom),
        field("NIR (n° de sécurité sociale)", l.nir, { required: false, hint: "facultatif au dépôt" }),
        field("Date de naissance", l.dateNaissance),
        field("Sexe", l.sexe === "M" ? "Masculin" : l.sexe === "F" ? "Féminin" : null),
        field("Département de naissance", l.deptNaissance),
        field("Commune de naissance", l.lieuNaissance),
        field("Nationalité", l.nationalite ? `${l.nationalite} — ${NATIONALITE[l.nationalite] || "?"}` : null, { code: "nationalite" }),
        field("Régime social", l.regimeSocial ? `${l.regimeSocial} — ${REGIME_SOCIAL[l.regimeSocial] || "?"}` : null, { code: "regimeSocial" }),
        field("Adresse", l.adresse),
        field("Téléphone", l.telephone, { required: false }),
        field("Courriel", l.email, { required: false }),
        field("Travailleur handicapé (RQTH)", l.rqth ? "Oui" : "Non", { required: false }),
        field("Sportif de haut niveau", l.sportifHautNiveau ? "Oui" : "Non", { required: false }),
        field("Situation avant ce contrat", l.situationAvant ? `${l.situationAvant} — ${SITUATION_AVANT_CONTRAT[l.situationAvant] || "?"}` : null, { code: "situationAvant" }),
        field("Dernier diplôme préparé", l.dernierDiplomePrepare),
        field("Dernière classe suivie", l.derniereClasse),
        field("Diplôme le plus élevé obtenu", l.diplomeLePlusEleve),
      ],
    },
    {
      key: "representant", title: "Représentant légal", conditional: "apprenti mineur",
      applicable: mineur,
      fields: [
        field("Nom et prénom", l.repLegalNom, { required: mineur }),
        field("Adresse", l.repLegalAdresse || l.adresse, { required: mineur }),
        field("Téléphone", l.repLegalTel, { required: false }),
        field("Courriel", l.repLegalEmail, { required: false }),
      ],
    },
    {
      key: "maitre", title: "Maître d'apprentissage",
      fields: [
        field("Nom et prénom", c.maitreNom),
        field("Date de naissance", c.maitreDateNaissance),
        field("Emploi occupé", c.maitreFonction),
        field("Diplôme ou titre le plus élevé", c.maitreDiplome),
        field("Niveau du diplôme", c.maitreNiveau),
        field("Courriel", c.maitreEmail, { required: false }),
        field("Attestation d'éligibilité signée", c.maitreEligibilite ? "Oui" : null,
          { hint: "l'employeur atteste que le maître remplit les conditions de compétence et d'expérience" }),
      ],
    },
    {
      key: "contrat", title: "Le contrat",
      fields: [
        field("Type de contrat", c.typeContrat ? `${c.typeContrat} — ${TYPE_CONTRAT[c.typeContrat] || "?"}` : null, { code: "typeContrat" }),
        field("Dérogation", c.derogation != null && c.derogation !== "" ? `${c.derogation} — ${DEROGATION[c.derogation] || "?"}` : "0 — Aucune", { required: false, code: "derogation" }),
        field("Date de conclusion", c.dateConclusion || c.dateSignature),
        field("Date de début d'exécution", c.dateDebut),
        field("Date de fin", c.dateFin),
        field("Durée hebdomadaire de travail", c.dureeHebdoHeures ? `${c.dureeHebdoHeures} h ${String(c.dureeHebdoMinutes || 0).padStart(2, "0")}` : null),
        field("Travail sur machines dangereuses", c.travauxDangereux ? "Oui" : "Non", { required: false,
          hint: mineur ? "apprenti mineur : une déclaration de dérogation aux travaux réglementés est nécessaire" : "" }),
        field("Salaire brut mensuel à l'embauche", c.remunerationMensuelle != null ? `${Number(c.remunerationMensuelle).toFixed(2)} €` : null),
        field("Avantage en nature — nourriture", c.avantageNourriture != null && c.avantageNourriture !== "" ? `${Number(c.avantageNourriture).toFixed(2)} €` : null, { required: false }),
        field("Avantage en nature — logement", c.avantageLogement != null && c.avantageLogement !== "" ? `${Number(c.avantageLogement).toFixed(2)} €` : null, { required: false }),
      ],
    },
    {
      key: "formation", title: "La formation",
      fields: [
        field("CFA responsable", ca.name),
        field("SIRET du CFA", ca.siret),
        field("N° UAI du CFA", ca.uai),
        field("Diplôme ou titre visé", cu.diploma || cu.name),
        field("Code RNCP", cu.codeRncp),
        field("Code diplôme", cu.codeDiplome, { required: false }),
        field("Intitulé précis", cu.intitulePrecis || cu.name),
        field("Date de début de formation", c.formationDebut || c.dateDebut),
        field("Date de fin des épreuves", c.formationFin || c.dateFin),
        field("Durée de la formation (heures)", cu.dureeHeures),
      ],
    },
  ];

  const periods = salaryPeriods({
    dateDebut: c.dateDebut, dateFin: c.dateFin, dateNaissance: l.dateNaissance, smic,
    type: c.type || "apprentissage", qualifie: !!c.qualifieBacPro, smc: c.smcBranche || null,
  });
  const applicable = sections.filter((s) => s.applicable !== false);
  const missing = applicable.flatMap((s) =>
    s.fields.filter((f) => f.required && !f.filled).map((f) => ({ section: s.title, label: f.label, hint: f.hint }))
  );
  const total = applicable.reduce((n, s) => n + s.fields.filter((f) => f.required).length, 0);
  return {
    sections: applicable,
    periods,
    missing,
    completeness: total > 0 ? Math.round(((total - missing.length) / total) * 100) : 100,
    ready: missing.length === 0,
    mineur,
  };
}

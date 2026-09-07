// Contrats d'alternance — logique pure (aucune I/O), testable sans serveur.
//
// Deux responsabilités : empêcher le dépôt d'un contrat qui sera refusé (contrôles
// bloquants avant édition), et outiller la RUPTURE — le sujet où les ERP du marché
// s'arrêtent au constat alors que c'est là que se joue l'argent et l'humain.
//
// ⚠️ DONNÉES RÉGLEMENTAIRES : la grille de rémunération et le SMIC ci-dessous
// changent chaque année (revalorisation, réforme). Ils sont datés et surchargeables
// par établissement (réglages) ; la veille trimestrielle prévue au plan doit les
// revérifier. Ne jamais présenter ces montants comme une garantie juridique.

export const CONTRACT_TYPES = { apprentissage: "Apprentissage", professionnalisation: "Professionnalisation" };
export const CONTRACT_STATUSES = ["brouillon", "a_deposer", "depose", "valide", "rompu", "termine"];
export const STATUS_LABEL = {
  brouillon: "Brouillon", a_deposer: "À déposer", depose: "Déposé", valide: "Validé",
  rompu: "Rompu", termine: "Terminé",
};

// Étapes du traitement d'une rupture : de la détection à la sortie.
export const RUPTURE_STAGES = ["signalee", "mediation", "replacement", "resolue", "confirmee"];
export const RUPTURE_LABEL = {
  signalee: "Signalée", mediation: "Médiation en cours", replacement: "Recherche d'entreprise",
  resolue: "Résolue (maintien)", confirmee: "Rupture confirmée",
};

// Barème au 6 septembre 2026 — À REVÉRIFIER à chaque campagne (veille trimestrielle).
export const WAGE_TABLE_VERSION = "2026-09";
export const SMIC_MENSUEL_DEFAUT = 1801.8; // 35 h/semaine, brut

// Part du SMIC due à un apprenti, par année d'exécution du contrat et tranche d'âge.
const APPRENTICE_RATES = {
  1: [["-18", 0.27], ["18-20", 0.43], ["21-25", 0.53], ["26+", 1.0]],
  2: [["-18", 0.39], ["18-20", 0.51], ["21-25", 0.61], ["26+", 1.0]],
  3: [["-18", 0.55], ["18-20", 0.67], ["21-25", 0.78], ["26+", 1.0]],
};

export function ageAt(birthDateISO, atISO) {
  if (!birthDateISO || !atISO) return null;
  const b = new Date(birthDateISO), a = new Date(atISO);
  if (isNaN(b) || isNaN(a)) return null;
  let age = a.getFullYear() - b.getFullYear();
  const m = a.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && a.getDate() < b.getDate())) age--;
  return age;
}

const bracketOf = (age) => (age < 18 ? "-18" : age <= 20 ? "18-20" : age <= 25 ? "21-25" : "26+");

// Rémunération minimale légale d'un apprenti, pour une année d'exécution donnée.
export function minimumWage({ age, year = 1, smic = SMIC_MENSUEL_DEFAUT }) {
  if (age == null) return null;
  // Au-delà de la 3e année (prolongation, redoublement), la grille de 3e année
  // continue de s'appliquer : on borne, et on renvoie l'année RÉELLEMENT utilisée
  // pour que l'explication affichée corresponde au calcul.
  const effectiveYear = Math.min(Math.max(Number(year) || 1, 1), 3);
  const bracket = bracketOf(age);
  const rate = (APPRENTICE_RATES[effectiveYear].find(([b]) => b === bracket) || [])[1];
  if (rate == null) return null;
  return { rate, bracket, year: effectiveYear, amount: Math.round(rate * smic * 100) / 100, version: WAGE_TABLE_VERSION };
}

// Contrôle de la clé de Luhn d'un SIRET (14 chiffres).
export function isValidSiret(siret) {
  const s = String(siret || "").replace(/\s/g, "");
  if (!/^\d{14}$/.test(s)) return false;
  // Une suite de zéros satisfait la clé de Luhn (somme nulle) sans être un SIRET.
  if (/^0+$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(s[14 - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const monthsBetween = (a, b) => {
  const d1 = new Date(a), d2 = new Date(b);
  if (isNaN(d1) || isNaN(d2)) return null;
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
};

// Contrôles avant dépôt. `errors` bloque l'édition du Cerfa ; `warnings` alerte
// sans bloquer (un contrôle trop zélé pousse à contourner l'outil).
export function validateContract(contract = {}, { learner = null, company = null, smic = SMIC_MENSUEL_DEFAUT } = {}) {
  const errors = [], warnings = [];
  const c = contract;

  if (!c.learnerId) errors.push("Aucun apprenant rattaché");
  if (!c.companyId) errors.push("Aucune entreprise rattachée");
  if (!CONTRACT_TYPES[c.type]) errors.push("Type de contrat manquant (apprentissage ou professionnalisation)");

  if (!c.dateDebut) errors.push("Date de début manquante");
  if (!c.dateFin) errors.push("Date de fin manquante");
  if (c.dateDebut && c.dateFin) {
    if (c.dateFin <= c.dateDebut) errors.push("La date de fin précède la date de début");
    else {
      const months = monthsBetween(c.dateDebut, c.dateFin);
      if (months != null && months < 6) errors.push("Durée inférieure à 6 mois (minimum légal pour un contrat d'alternance)");
      if (months != null && months > 36) warnings.push("Durée supérieure à 36 mois — vérifier la dérogation");
    }
  }
  if (c.dateSignature && c.dateDebut && c.dateSignature > c.dateDebut) {
    warnings.push("Contrat signé après le début d'exécution — régularisation à justifier");
  }

  if (!String(c.maitreNom || "").trim()) errors.push("Maître d'apprentissage non renseigné");
  else if (!String(c.maitreEmail || "").trim() && !String(c.maitreTel || "").trim()) {
    warnings.push("Maître d'apprentissage sans email ni téléphone");
  }

  if (company) {
    if (!company.siret) errors.push("SIRET de l'entreprise manquant");
    else if (!isValidSiret(company.siret)) errors.push("SIRET invalide (clé de contrôle incorrecte)");
    if (!String(company.name || "").trim()) errors.push("Raison sociale de l'entreprise manquante");
    if (!String(company.conventionCollective || "").trim()) warnings.push("Convention collective non renseignée");
  }

  let wage = null;
  if (learner) {
    if (!learner.dateNaissance) warnings.push("Date de naissance de l'apprenant inconnue — rémunération minimale non vérifiable");
    else {
      const age = ageAt(learner.dateNaissance, c.dateDebut);
      if (age != null) {
        if (age < 16) errors.push(`Apprenti de ${age} ans au début du contrat (16 ans minimum, sauf dérogation)`);
        if (c.type === "apprentissage" && age > 29 && !c.derogationAge) {
          warnings.push(`Apprenti de ${age} ans — au-delà de 29 ans, une dérogation est requise (RQTH, sportif de haut niveau, création d'entreprise…)`);
        }
        wage = minimumWage({ age, year: c.anneeExecution || 1, smic });
        if (wage && c.remunerationMensuelle != null && c.remunerationMensuelle !== "" && Number(c.remunerationMensuelle) + 0.01 < wage.amount) {
          errors.push(`Rémunération sous le minimum légal : ${Number(c.remunerationMensuelle).toFixed(2)} € < ${wage.amount.toFixed(2)} € (${Math.round(wage.rate * 100)} % du SMIC, tranche ${wage.bracket}, année ${wage.year})`);
        }
      }
    }
    if (!learner.ine) warnings.push("INE de l'apprenant manquant (requis pour l'enquête SIFA)");
  }

  if (c.npec != null && c.npec !== "" && Number(c.npec) <= 0) warnings.push("NPEC à zéro ou négatif — vérifier la prise en charge");
  if (!c.npec && c.status !== "brouillon") warnings.push("NPEC non renseigné — la facturation du financeur en dépend");

  return { ok: errors.length === 0, errors, warnings, wage };
}

// Alertes d'échéance : fin de période d'essai (45 jours de présence en entreprise,
// approchés ici en jours calendaires) et fin de contrat.
export function contractAlerts(contract, todayISO) {
  const out = [];
  if (!contract || ["rompu", "termine"].includes(contract.status)) return out;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 864e5);
  if (contract.dateDebut) {
    const essai = new Date(new Date(contract.dateDebut).getTime() + 45 * 864e5).toISOString().slice(0, 10);
    const d = days(today, essai);
    if (d >= 0 && d <= 15) out.push({ type: "essai", severity: "medium", date: essai, label: `Fin de période d'essai dans ${d} jour(s)` });
  }
  if (contract.dateFin) {
    const d = days(today, contract.dateFin);
    if (d >= 0 && d <= 60) out.push({ type: "fin", severity: d <= 30 ? "medium" : "low", date: contract.dateFin, label: `Fin de contrat dans ${d} jour(s)` });
    if (d < 0 && contract.status !== "termine") out.push({ type: "echu", severity: "medium", date: contract.dateFin, label: `Contrat échu depuis ${-d} jour(s) — clôturer ou prolonger` });
  }
  if (contract.rupture && !["resolue", "confirmee"].includes(contract.rupture.stage)) {
    const since = contract.rupture.since ? days(contract.rupture.since, today) : null;
    out.push({ type: "rupture", severity: "high", date: contract.rupture.since || null, label: `Rupture ${RUPTURE_LABEL[contract.rupture.stage] || ""}${since != null ? ` depuis ${since} jour(s)` : ""}` });
  }
  return out;
}

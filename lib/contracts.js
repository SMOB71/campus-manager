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

// Barème vérifié le 7 septembre 2026 sur service-public.gouv.fr (fiches F2918
// apprentissage, F15478 professionnalisation) et travail-emploi.gouv.fr.
// À REVÉRIFIER à chaque revalorisation du SMIC et à chaque campagne (veille
// trimestrielle inscrite au plan). Ne jamais présenter ces montants comme une
// garantie juridique : la convention collective peut être plus favorable.
export const WAGE_TABLE_VERSION = "2026-09-07";
// SMIC mensuel brut base 35 h — 12,31 €/h depuis le 1er juin 2026.
export const SMIC_MENSUEL_DEFAUT = 1867.02;
export const SMIC_HORAIRE_DEFAUT = 12.31;

// Part du SMIC due à un APPRENTI, par année d'exécution et tranche d'âge.
// À partir de 21 ans, le salaire minimum conventionnel (SMC) de la branche
// s'applique s'il est plus favorable — d'où le paramètre `smc`.
const APPRENTICE_RATES = {
  1: [["-18", 0.27], ["18-20", 0.43], ["21-25", 0.53], ["26+", 1.0]],
  2: [["-18", 0.39], ["18-20", 0.51], ["21-25", 0.61], ["26+", 1.0]],
  3: [["-18", 0.55], ["18-20", 0.67], ["21-25", 0.78], ["26+", 1.0]],
};

// Le CONTRAT DE PROFESSIONNALISATION obéit à une grille DIFFÉRENTE, qui dépend de
// l'âge ET du niveau de qualification déjà détenu (bac professionnel ou plus).
// Appliquer la grille d'apprentissage à un contrat pro produit un salaire
// sous-évalué et un contrat non conforme.
const PRO_RATES = {
  "-21": { base: 0.55, qualifie: 0.65 },
  "21-25": { base: 0.70, qualifie: 0.80 },
  "26+": { base: 1.0, qualifie: 1.0 },
};

// CONTRAT DE DURÉE RÉDUITE — art. D. 6222-28 et s.
//
// Quand la durée du contrat est INFÉRIEURE au cycle de formation (BTS préparé en
// un an, entrée directe en 2e année, licence pro…), l'apprenti est réputé avoir
// accompli les années précédentes : sa rémunération est celle de l'année de
// formation qu'il suit réellement, pas de la « 1re année de contrat ».
//
// Pour un réseau d'écoles post-bac, c'est le cas MAJORITAIRE, pas un cas limite :
// démarrer en année 1 fait perdre 8 à 12 points de SMIC par mois à l'apprenti,
// et expose l'employeur à un rappel de salaire.
//
// `dureeCycleAnnees` = durée normale du diplôme (2 pour un BTS) ; `dureeContratAnnees`
// = durée réelle du contrat. L'année de départ comble l'écart.
export function startingExecutionYear({ dureeCycleAnnees, dureeContratAnnees, anneeEntree }) {
  // Saisie explicite de l'année d'entrée dans le cycle : elle prime sur la déduction.
  if (anneeEntree != null && anneeEntree !== "") {
    const n = Number(anneeEntree);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 3);
  }
  const cycle = Number(dureeCycleAnnees), contrat = Number(dureeContratAnnees);
  if (!Number.isFinite(cycle) || !Number.isFinite(contrat) || cycle <= 0 || contrat <= 0) return 1;
  if (contrat >= cycle) return 1; // contrat couvrant tout le cycle : départ normal
  return Math.min(Math.max(1, Math.round(cycle - contrat) + 1), 3);
}

// Durée du contrat en années (arrondie), pour la déduction ci-dessus.
export function contractYears(dateDebut, dateFin) {
  if (!dateDebut || !dateFin) return null;
  const d1 = new Date(dateDebut + "T00:00:00Z"), d2 = new Date(dateFin + "T00:00:00Z");
  if (isNaN(d1) || isNaN(d2) || d2 <= d1) return null;
  return Math.round(((d2 - d1) / 864e5 / 365.25) * 10) / 10;
}

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
const proBracketOf = (age) => (age < 21 ? "-21" : age <= 25 ? "21-25" : "26+");

// Rémunération minimale légale, selon le TYPE de contrat.
// - apprentissage : grille par année d'exécution et tranche d'âge ;
// - professionnalisation : grille par tranche d'âge et niveau de qualification
//   (`qualifie` = titulaire d'un bac professionnel ou d'un titre équivalent).
// `smc` = salaire minimum conventionnel de la branche : il prime dès 21 ans s'il
// est plus favorable, et à 26 ans en professionnalisation (85 % du SMC).
export function minimumWage({ age, year = 1, smic = SMIC_MENSUEL_DEFAUT, type = "apprentissage", qualifie = false, smc = null }) {
  if (age == null) return null;

  if (type === "professionnalisation") {
    const bracket = proBracketOf(age);
    const rate = PRO_RATES[bracket][qualifie ? "qualifie" : "base"];
    let amount = Math.round(rate * smic * 100) / 100;
    let base = "SMIC";
    // 26 ans et plus : le plancher est le SMIC entier OU 85 % du minimum
    // conventionnel, le plus favorable des deux.
    if (bracket === "26+" && smc) {
      const conventionnel = Math.round(0.85 * Number(smc) * 100) / 100;
      if (conventionnel > amount) { amount = conventionnel; base = "85 % du minimum conventionnel"; }
    }
    return { rate, bracket, year: null, amount, base, type, qualifie, version: WAGE_TABLE_VERSION };
  }

  // Au-delà de la 3e année (prolongation, redoublement), la grille de 3e année
  // continue de s'appliquer : on borne, et on renvoie l'année RÉELLEMENT utilisée
  // pour que l'explication affichée corresponde au calcul.
  const effectiveYear = Math.min(Math.max(Number(year) || 1, 1), 3);
  const bracket = bracketOf(age);
  const rate = (APPRENTICE_RATES[effectiveYear].find(([b]) => b === bracket) || [])[1];
  if (rate == null) return null;
  let amount = Math.round(rate * smic * 100) / 100;
  let base = "SMIC";
  // Dès 21 ans, le minimum conventionnel de la branche s'applique s'il est
  // plus favorable que le SMIC (même pourcentage appliqué au SMC).
  if (smc && (bracket === "21-25" || bracket === "26+")) {
    const conventionnel = Math.round(rate * Number(smc) * 100) / 100;
    if (conventionnel > amount) { amount = conventionnel; base = "minimum conventionnel"; }
  }
  return { rate, bracket, year: effectiveYear, amount, base, type: "apprentissage", version: WAGE_TABLE_VERSION };
}

// Date d'effet d'un changement de tranche d'âge : le 1er jour du MOIS SUIVANT
// l'anniversaire, et non le jour de l'anniversaire. Règle commune à
// l'apprentissage et à la professionnalisation ; c'est l'erreur la plus fréquente
// des dossiers rejetés et des rappels de salaire.
export function effectiveDateOfBirthdayRaise(birthdayISO) {
  if (!birthdayISO) return null;
  const d = new Date(birthdayISO + "T00:00:00Z");
  if (isNaN(d)) return null;
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
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
  // Un dossier supprimé ne doit PAS faire passer les contrôles en silence : sans
  // apprenant ni entreprise résolus, les vérifications d'âge, de rémunération et
  // de SIRET sont sautées et le contrat serait déclaré conforme à tort.
  else if (!learner) errors.push("Apprenant introuvable — le dossier a été supprimé ou déplacé");
  if (!c.companyId) errors.push("Aucune entreprise rattachée");
  else if (!company) errors.push("Entreprise introuvable — la fiche a été supprimée");
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
        // L'année d'exécution retenue tient compte d'un éventuel contrat de durée
        // réduite : un BTS préparé en un an démarre au taux de 2e année.
        const anneeDepart = startingExecutionYear({
          dureeCycleAnnees: c.dureeCycleAnnees,
          dureeContratAnnees: contractYears(c.dateDebut, c.dateFin),
          anneeEntree: c.anneeEntreeCycle,
        });
        const annee = Math.max(Number(c.anneeExecution) || 1, anneeDepart);
        wage = minimumWage({ age, year: annee, smic, type: c.type,
          qualifie: !!c.qualifieBacPro, smc: c.smcBranche || null });
        if (wage && c.remunerationMensuelle != null && c.remunerationMensuelle !== "" && Number(c.remunerationMensuelle) + 0.01 < wage.amount) {
          // Quand le plancher retenu est déjà exprimé en pourcentage (85 % du SMC),
          // ne pas recomposer « 100 % du 85 % du minimum conventionnel ».
          const socle = wage.base.startsWith("85 %") ? wage.base : `${Math.round(wage.rate * 100)} % du ${wage.base}`;
          const detail = wage.type === "professionnalisation"
            ? `${socle}, tranche ${wage.bracket}${wage.qualifie ? ", titulaire d'un bac pro ou équivalent" : ""}`
            : `${socle}, tranche ${wage.bracket}, année ${wage.year}`;
          errors.push(`Rémunération sous le minimum légal : ${Number(c.remunerationMensuelle).toFixed(2)} € < ${wage.amount.toFixed(2)} € (${detail})`);
        }
      }
    }
    if (!learner.ine) warnings.push("INE de l'apprenant manquant (requis pour l'enquête SIFA)");
  }

  if (c.npec != null && c.npec !== "" && Number(c.npec) <= 0) warnings.push("NPEC à zéro ou négatif — vérifier la prise en charge");
  if (!c.npec && c.status !== "brouillon") warnings.push("NPEC non renseigné — la facturation du financeur en dépend");

  return { ok: errors.length === 0, errors, warnings, wage };
}

// PÉRIODE DE RUPTURE UNILATÉRALE — art. L. 6222-18, vérifié sur service-public.gouv.fr
// (F2918) le 7 septembre 2026 : la rupture unilatérale est possible pendant les
// « 45 premiers jours, consécutifs ou non, de FORMATION PRATIQUE EN ENTREPRISE ».
//
// Ce ne sont PAS 45 jours calendaires : les jours passés au CFA, les congés et les
// absences ne comptent pas. Sur un rythme 2 semaines / 2 semaines, 45 jours en
// entreprise représentent quatre à cinq mois. Compter en calendaire ferait croire
// au CFA que le délai est expiré alors qu'il reste des mois — ou l'inverse.
//
// `cfaDays` = ensemble des dates ISO où l'apprenti est au centre (issu du planning).
// Sans planning fourni, on ne devine pas : la fonction renvoie null plutôt qu'une
// approximation fausse.
export function practicalDaysCount({ dateDebut, until, cfaDays }) {
  if (!dateDebut || !until || !(cfaDays instanceof Set)) return null;
  let count = 0;
  const d = new Date(dateDebut + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  if (isNaN(d) || isNaN(end) || end < d) return null;
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    // Jours ouvrés uniquement, et hors jours de présence au CFA.
    if (day !== 0 && day !== 6 && !cfaDays.has(iso)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// Date à laquelle le 45e jour de formation pratique est atteint, si elle l'est.
export function trialPeriodEnd({ dateDebut, dateFin, cfaDays, horizon = 400 }) {
  if (!dateDebut || !(cfaDays instanceof Set)) return null;
  let count = 0;
  const d = new Date(dateDebut + "T00:00:00Z");
  if (isNaN(d)) return null; // date non parsable : ne rien affirmer plutôt que planter
  for (let i = 0; i < horizon; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (dateFin && iso > dateFin) return null;
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !cfaDays.has(iso)) {
      count++;
      if (count >= 45) return iso;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

// Délais légaux de la rupture à l'initiative de l'apprenti après la période
// d'essai (art. R. 6222-21) : saisine du médiateur, puis 5 jours calendaires
// minimum avant d'informer l'employeur, puis 7 jours calendaires minimum avant
// que la rupture prenne effet.
export const MEDIATION_DELAI_INFORMATION_JOURS = 5;
export const MEDIATION_DELAI_RUPTURE_JOURS = 7;
// Le CFA doit maintenir l'apprenti en formation et rechercher un employeur
// pendant 6 mois après la rupture (art. L. 6231-2).
export const ACCOMPAGNEMENT_APRES_RUPTURE_MOIS = 6;

// Alertes d'échéance. `cfaDays` (facultatif) permet de calculer la vraie fin de
// période d'essai ; sans lui, l'alerte correspondante n'est pas produite plutôt
// que d'être fausse.
export function contractAlerts(contract, todayISO, cfaDays = null) {
  const out = [];
  if (!contract || ["rompu", "termine"].includes(contract.status)) return out;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 864e5);
  if (contract.dateDebut && cfaDays instanceof Set) {
    const essai = trialPeriodEnd({ dateDebut: contract.dateDebut, dateFin: contract.dateFin, cfaDays });
    if (essai) {
      const d = days(today, essai);
      const faits = practicalDaysCount({ dateDebut: contract.dateDebut, until: today, cfaDays });
      if (d >= 0 && d <= 21) {
        out.push({ type: "essai", severity: "medium", date: essai,
          label: `Fin de la période de rupture unilatérale le ${essai} (${faits ?? "?"}/45 jours en entreprise effectués)` });
      }
    }
  }
  if (contract.dateFin) {
    const d = days(today, contract.dateFin);
    if (d >= 0 && d <= 60) out.push({ type: "fin", severity: d <= 30 ? "medium" : "low", date: contract.dateFin, label: `Fin de contrat dans ${d} jour(s)` });
    if (d < 0 && contract.status !== "termine") out.push({ type: "echu", severity: "medium", date: contract.dateFin, label: `Contrat échu depuis ${-d} jour(s) — clôturer ou prolonger` });
  }
  // Dépôt du contrat : l'employeur doit le transmettre à son opérateur au plus tard
  // 5 jours ouvrables après le début d'exécution (art. D. 6224-1). Passé ce délai,
  // le financement est menacé — c'est le premier risque financier d'un CFA.
  if (contract.dateDebut && contract.dateDebut <= today && !contract.dateDepot && !["rompu", "termine"].includes(contract.status)) {
    const retard = days(contract.dateDebut, today);
    out.push({ type: "depot", severity: retard > 5 ? "high" : "medium", date: contract.dateDebut,
      label: retard > 5 ? `Contrat non déposé ${retard} jours après le début — financement menacé` : `Contrat à déposer sous 5 jours ouvrables (début le ${contract.dateDebut})` });
  }
  if (contract.dateDepot && !contract.dateValidation && !["rompu", "termine"].includes(contract.status)) {
    const attente = days(contract.dateDepot, today);
    if (attente >= 20) out.push({ type: "instruction", severity: "medium", date: contract.dateDepot,
      label: `Déposé depuis ${attente} jours sans retour de l'opérateur — relancer` });
  }
  if (contract.rupture && !["resolue", "confirmee"].includes(contract.rupture.stage)) {
    const since = contract.rupture.since ? days(contract.rupture.since, today) : null;
    out.push({ type: "rupture", severity: "high", date: contract.rupture.since || null, label: `Rupture ${RUPTURE_LABEL[contract.rupture.stage] || ""}${since != null ? ` depuis ${since} jour(s)` : ""}` });
  }
  return out;
}

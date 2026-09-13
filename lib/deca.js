// Dépôt du contrat d'apprentissage — suivi des délais. Logique pure.
//
// CE QUE CE MODULE FAIT, ET CE QU'IL NE PEUT PAS FAIRE — depuis 2020, ce n'est
// plus l'organisme qui dépose : l'EMPLOYEUR transmet le contrat à son OPCO, qui
// contrôle puis dépose auprès de l'administration (DECA). Aucune interface
// publique ne permet de déposer à sa place. Ce que le CFA peut faire, en
// revanche, c'est ne pas laisser filer les délais — et c'est exactement ce qui
// fait perdre des prises en charge.
//
// LE POINT QUI A CHANGÉ, ET QUE BEAUCOUP D'OUTILS N'ONT PAS SUIVI :
//
//   Le silence de l'OPCO au terme des vingt jours valait autrefois acceptation.
//   Depuis le décret n° 2024-631 du 28 juin 2024, il vaut REFUS IMPLICITE.
//
// Un logiciel qui traite « pas de nouvelles » comme « tout va bien » se trompe
// désormais dans le sens le plus coûteux : le contrat est exécuté, la formation
// dispensée, et le financement n'arrivera jamais. Ce module considère donc le
// silence comme une alerte de premier rang, pas comme une absence d'information.
//
// DEUX DÉLAIS, À NE PAS CONFONDRE :
//   • 5 JOURS OUVRABLES après le début d'exécution du contrat pour que
//     l'employeur transmette à l'OPCO ;
//   • 20 JOURS (calendaires) à compter de la réception pour que l'OPCO statue.
//
// ⚠️ Délais et modalités à revérifier à chaque campagne : ils ont déjà changé.

export const ETATS = {
  a_transmettre: { label: "À transmettre à l'OPCO", terminal: false },
  transmis: { label: "Transmis, en attente de décision", terminal: false },
  a_corriger: { label: "Retourné pour correction", terminal: false },
  accepte: { label: "Prise en charge accordée", terminal: true },
  refuse: { label: "Prise en charge refusée", terminal: true },
};

export const DELAI_TRANSMISSION_OUVRABLES = 5;
export const DELAI_DECISION_JOURS = 20;

const jour = 864e5;
const d = (iso) => new Date(iso + "T00:00:00Z");
export const joursEntre = (a, b) => (a && b ? Math.round((d(b) - d(a)) / jour) : null);

// Jours ouvrables : du lundi au samedi en droit du travail français, mais les
// délais de procédure s'entendent en pratique hors samedi et dimanche. On retient
// la lecture la plus PRUDENTE pour l'organisme — celle qui fait arriver
// l'échéance au plus tôt — et on laisse la liste des fériés paramétrable.
export function ajouterJoursOuvrables(dateISO, n, feries = []) {
  if (!dateISO) return null;
  let t = d(dateISO).getTime();
  let restants = n;
  const ferie = new Set(feries);
  while (restants > 0) {
    t += jour;
    const j = new Date(t);
    const wd = j.getUTCDay();
    const iso = j.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !ferie.has(iso)) restants--;
  }
  return new Date(t).toISOString().slice(0, 10);
}

export function validateDepot(dep = {}, contrat = {}) {
  const errors = [], warnings = [];
  if (dep.etat && !ETATS[dep.etat]) errors.push(`état inconnu (${Object.keys(ETATS).join(", ")})`);
  if (["transmis", "accepte", "refuse", "a_corriger"].includes(dep.etat) && !dep.dateTransmission) {
    errors.push("date de transmission requise dès que le dossier est parti");
  }
  if (dep.dateTransmission && contrat.dateDebut && dep.dateTransmission < contrat.dateDebut) {
    warnings.push("transmission datée avant le début du contrat — vérifier la saisie");
  }
  if (["accepte", "refuse"].includes(dep.etat) && !dep.dateDecision) {
    errors.push("date de décision requise pour un dossier clos");
  }
  if (dep.etat === "refuse" && !String(dep.motif || "").trim()) {
    warnings.push("refus sans motif enregistré : impossible de corriger ni de contester");
  }
  if (!String(dep.opco || "").trim()) warnings.push("OPCO non identifié");
  return { ok: errors.length === 0, errors, warnings };
}

// État d'un dépôt à une date donnée : échéances, retards, et la conséquence du
// silence.
export function etatDepot({ contrat = {}, depot = {}, aujourdhui, feries = [] } = {}) {
  const etat = ETATS[depot.etat] ? depot.etat : "a_transmettre";
  const debut = contrat.dateDebut || null;
  const echeanceTransmission = debut ? ajouterJoursOuvrables(debut, DELAI_TRANSMISSION_OUVRABLES, feries) : null;
  const echeanceDecision = depot.dateTransmission
    ? new Date(d(depot.dateTransmission).getTime() + DELAI_DECISION_JOURS * jour).toISOString().slice(0, 10)
    : null;

  const alertes = [];
  let risque = "aucun";

  if (etat === "a_transmettre") {
    if (echeanceTransmission && aujourdhui > echeanceTransmission) {
      risque = "eleve";
      alertes.push({
        code: "transmission_hors_delai",
        message: `Contrat non transmis à l'OPCO alors que le délai de ${DELAI_TRANSMISSION_OUVRABLES} jours ouvrables est dépassé depuis le ${echeanceTransmission}.`,
      });
    } else if (echeanceTransmission) {
      const reste = joursEntre(aujourdhui, echeanceTransmission);
      if (reste != null && reste <= 2) {
        risque = "moyen";
        alertes.push({ code: "transmission_imminente", message: `Transmission à l'OPCO à faire avant le ${echeanceTransmission} (${reste} jour(s)).` });
      }
    }
  }

  if (etat === "transmis" && echeanceDecision) {
    const depasse = aujourdhui > echeanceDecision;
    if (depasse) {
      // LE point du module : le silence n'est pas une absence de nouvelle.
      risque = "critique";
      alertes.push({
        code: "silence_vaut_refus",
        message: `Aucune décision au terme des ${DELAI_DECISION_JOURS} jours (échéance ${echeanceDecision}). Depuis le décret n° 2024-631 du 28 juin 2024, le silence de l'OPCO vaut REFUS de prise en charge : relancer sans attendre.`,
      });
    } else {
      const reste = joursEntre(aujourdhui, echeanceDecision);
      if (reste != null && reste <= 5) {
        risque = "moyen";
        alertes.push({ code: "decision_imminente", message: `Décision attendue avant le ${echeanceDecision} (${reste} jour(s)). Passé ce délai, le silence vaut refus.` });
      }
    }
  }

  if (etat === "a_corriger") {
    risque = "eleve";
    alertes.push({ code: "a_corriger", message: `Dossier retourné par l'OPCO${depot.motif ? ` : ${depot.motif}` : ""}. Le délai de décision recommence à la nouvelle transmission.` });
  }
  if (etat === "refuse") {
    risque = "critique";
    alertes.push({ code: "refuse", message: `Prise en charge refusée${depot.motif ? ` : ${depot.motif}` : ""}. La formation dispensée ne sera pas financée en l'état.` });
  }

  return {
    etat, etatLabel: ETATS[etat].label,
    opco: depot.opco || null,
    dateTransmission: depot.dateTransmission || null,
    dateDecision: depot.dateDecision || null,
    echeanceTransmission, echeanceDecision,
    joursDepuisTransmission: depot.dateTransmission ? joursEntre(depot.dateTransmission, aujourdhui) : null,
    risque, alertes,
    // On ne dit pas « conforme » : on dit ce qui est clos et ce qui ne l'est pas.
    clos: ETATS[etat].terminal,
    finance: etat === "accepte",
  };
}

// Vue d'ensemble : c'est elle qu'un directeur regarde le lundi matin.
export function tableauDeBord(contrats = [], { aujourdhui, feries = [] } = {}) {
  const lignes = contrats.map((c) => ({
    contratId: c.id,
    apprenant: c.apprenant || "",
    employeur: c.employeur || "",
    dateDebut: c.dateDebut || null,
    ...etatDepot({ contrat: c, depot: c.depot || {}, aujourdhui, feries }),
  }));
  const rang = { critique: 0, eleve: 1, moyen: 2, aucun: 3 };
  lignes.sort((a, b) => rang[a.risque] - rang[b.risque] || String(a.dateDebut).localeCompare(String(b.dateDebut)));
  return {
    total: lignes.length,
    aTraiter: lignes.filter((l) => l.risque === "critique" || l.risque === "eleve").length,
    finances: lignes.filter((l) => l.finance).length,
    // Le chiffre qui compte : des contrats exécutés dont le financement est
    // compromis. C'est de la trésorerie déjà engagée.
    financementCompromis: lignes.filter((l) => l.alertes.some((a) => a.code === "silence_vaut_refus" || a.code === "refuse")).length,
    lignes,
  };
}

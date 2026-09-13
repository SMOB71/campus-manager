// Préparation de la paie des intervenants — logique pure.
//
// LA DISTINCTION QUI COMMANDE TOUT LE MODULE, et qui n'est pas technique :
//
//   • Un intervenant SALARIÉ (vacataire, formateur en CDD d'usage) est payé par
//     la paie. Ses heures alimentent un bulletin de salaire.
//   • Un intervenant INDÉPENDANT (auto-entrepreneur, société) FACTURE. Ses
//     heures ne doivent JAMAIS entrer dans un export de paie.
//
// Les mélanger n'est pas une maladresse d'export : faire figurer un indépendant
// dans la paie, c'est produire la pièce qui servira à démontrer un lien de
// subordination et à requalifier le contrat. Le module refuse donc de sortir un
// indépendant dans un export de paie, et le dit.
//
// DEUXIÈME PIÈGE — LES HEURES DE FACE-À-FACE NE SONT PAS LES HEURES PAYÉES. Le
// temps de préparation, de correction et de réunion se paie aussi, selon le
// contrat ou la convention collective. Un export qui remonte les seules heures
// de cours sous-paie l'intervenant. Le module distingue donc les heures
// CONSTATÉES (issues du planning) des heures À PAYER, et exige que la règle de
// passage soit explicite plutôt que devinée.
//
// Le module PRÉPARE : il ne calcule ni cotisations, ni net, ni bulletin. C'est
// le logiciel de paie qui fait cela, et prétendre le remplacer serait à la fois
// faux et dangereux.

export const STATUTS = {
  salarie: { label: "Salarié", paie: true },
  independant: { label: "Indépendant (facture)", paie: false },
};

// Règles de passage des heures constatées aux heures payées. Aucune n'est
// « par défaut » au sens où elle irait de soi : c'est un choix contractuel.
export const REGLES_PREPARATION = {
  aucune: { label: "Heures de face-à-face uniquement", coefficient: 1 },
  forfait_10: { label: "Face-à-face + 10 % de préparation", coefficient: 1.1 },
  forfait_20: { label: "Face-à-face + 20 % de préparation", coefficient: 1.2 },
  forfait_25: { label: "Face-à-face + 25 % de préparation", coefficient: 1.25 },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Heures réellement assurées sur la période, d'après le planning. Une séance
// ANNULÉE n'est pas assurée : la compter reviendrait à payer un cours qui n'a
// pas eu lieu.
export function heuresConstatees(seances = [], { from = null, to = null } = {}) {
  let minutes = 0, nb = 0, annulees = 0, planifiees = 0;
  for (const s of seances) {
    if (from && s.date < from) continue;
    if (to && s.date > to) continue;
    const d = toMin(s.start), f = toMin(s.end);
    if (d == null || f == null || f <= d) continue;
    if (s.status === "cancelled") { annulees++; continue; }
    // Une séance encore « planifiée » n'est pas constatée : elle est à venir ou
    // personne n'a confirmé qu'elle avait eu lieu. On la compte à part.
    if (s.status !== "done") { planifiees++; continue; }
    minutes += f - d;
    nb++;
  }
  return { minutes, heures: round2(minutes / 60), seances: nb, annulees, planifiees };
}

export function validateIntervenant(t = {}) {
  const errors = [], warnings = [];
  if (!String(t.name || "").trim()) errors.push("nom de l'intervenant requis");
  if (t.statut && !STATUTS[t.statut]) errors.push(`statut inconnu (${Object.keys(STATUTS).join(", ")})`);
  if (!t.statut) warnings.push("statut non renseigné — impossible de savoir s'il relève de la paie ou de la facturation");
  if (t.statut === "salarie") {
    if (!t.tauxHoraire) warnings.push("aucun taux horaire : la ligne de paie sera incomplète");
    if (!t.matricule) warnings.push("aucun matricule — le rapprochement avec le logiciel de paie se fera à la main");
  }
  if (t.regle && !REGLES_PREPARATION[t.regle]) errors.push("règle de préparation inconnue");
  return { ok: errors.length === 0, errors, warnings };
}

// Ligne de paie d'UN intervenant. Renvoie null avec un motif quand la personne
// ne relève pas de la paie : c'est un refus argumenté, pas un oubli.
export function ligneDePaie(intervenant, seances, { from, to } = {}) {
  const statut = STATUTS[intervenant?.statut] || null;
  const constate = heuresConstatees(seances, { from, to });

  if (!statut) {
    return { exclu: true, motif: "statut non renseigné : impossible de trancher entre paie et facturation", intervenant: intervenant?.name || "", constate };
  }
  if (!statut.paie) {
    return {
      exclu: true,
      // Le motif est long à dessein : c'est lui qui empêche de « forcer ».
      motif: "intervenant indépendant : il facture. L'inscrire dans un export de paie fournirait une pièce à l'appui d'une requalification en contrat de travail.",
      intervenant: intervenant.name, constate,
    };
  }

  const regle = REGLES_PREPARATION[intervenant.regle] || REGLES_PREPARATION.aucune;
  const heuresPayees = round2(constate.heures * regle.coefficient);
  const taux = Number(intervenant.tauxHoraire) || 0;
  return {
    exclu: false,
    intervenantId: intervenant.id,
    matricule: intervenant.matricule || "",
    nom: intervenant.name,
    statut: statut.label,
    periode: { from, to },
    heuresConstatees: constate.heures,
    regle: regle.label,
    heuresPayees,
    tauxHoraire: taux,
    brut: round2(heuresPayees * taux),
    seances: constate.seances,
    // Ce qui n'est pas payé et qu'il faut pouvoir expliquer à l'intervenant.
    seancesAnnulees: constate.annulees,
    seancesNonConfirmees: constate.planifiees,
  };
}

// Export complet d'une période. `incomplets` porte ce qui empêche de transmettre
// tel quel : un export de paie faux se découvre sur le bulletin du salarié.
export function preparerExport({ intervenants = [], seancesParIntervenant = new Map(), from, to } = {}) {
  const lignes = [], exclus = [], incomplets = [];
  for (const t of intervenants) {
    const r = ligneDePaie(t, seancesParIntervenant.get(t.id) || [], { from, to });
    if (r.exclu) { exclus.push(r); continue; }
    if (!r.heuresConstatees) continue;      // rien à payer : on n'invente pas une ligne vide
    if (!r.tauxHoraire) incomplets.push(`${r.nom} : aucun taux horaire`);
    if (!r.matricule) incomplets.push(`${r.nom} : aucun matricule`);
    lignes.push(r);
  }
  lignes.sort((a, b) => a.nom.localeCompare(b.nom));
  return {
    periode: { from, to },
    lignes,
    exclus,
    incomplets,
    totalHeures: round2(lignes.reduce((s, l) => s + l.heuresPayees, 0)),
    totalBrut: round2(lignes.reduce((s, l) => s + l.brut, 0)),
    // Des séances non confirmées signifient que le planning n'a pas été tenu à
    // jour : payer sur cette base, c'est payer au jugé.
    seancesNonConfirmees: lignes.reduce((s, l) => s + l.seancesNonConfirmees, 0),
    transmettable: lignes.length > 0 && incomplets.length === 0,
  };
}

export const COLONNES_EXPORT = [
  { key: "matricule", label: "Matricule" },
  { key: "nom", label: "Nom" },
  { key: "statut", label: "Statut" },
  { key: "heuresConstatees", label: "Heures constatées" },
  { key: "regle", label: "Règle appliquée" },
  { key: "heuresPayees", label: "Heures à payer" },
  { key: "tauxHoraire", label: "Taux horaire" },
  { key: "brut", label: "Brut" },
  { key: "seances", label: "Séances" },
  { key: "seancesAnnulees", label: "Dont annulées (non payées)" },
];

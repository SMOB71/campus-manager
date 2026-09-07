// Financements et facturation — logique pure (aucune I/O), testable sans serveur.
//
// LA DISTINCTION QUI COMMANDE TOUT LE MODULE — deux modes de financement
// obéissent à des règles opposées, et les confondre produit des factures fausses :
//
//   • ALTERNANCE (apprentissage, professionnalisation) : le niveau de prise en
//     charge (NPEC) se verse au PRORATA TEMPORIS JOURNALIER du nombre de jours de
//     contrat réellement exécutés. L'assiduité de l'apprenti n'entre PAS dans ce
//     calcul : elle sert la preuve de réalisation et le contrôle, pas le montant.
//     Une rupture déclenche une régularisation sur les jours effectués.
//     (Vérifié sur travail-emploi.gouv.fr et France compétences, 7 septembre 2026.)
//
//   • CONVENTIONNÉ (CPF, plan de développement, actions hors alternance) : c'est
//     l'HEURE RÉALISÉE qui se facture, justifiée par le certificat de réalisation.
//     Là, l'assiduité détermine bien le montant.
//
// Se tromper de mode, c'est facturer un apprenti absent comme s'il avait été
// présent — ou l'inverse, sous-facturer un contrat d'apprentissage parfaitement dû.

export const FUNDING_MODES = {
  npec: {
    label: "Alternance — niveau de prise en charge (NPEC)",
    base: "prorata temporis des jours de contrat exécutés",
    assiduiteImpacte: false,
  },
  heures: {
    label: "Conventionné — heures réalisées",
    base: "heures effectivement réalisées, justifiées par le certificat de réalisation",
    assiduiteImpacte: true,
  },
  forfait: {
    label: "Forfait",
    base: "montant forfaitaire, indépendant de la durée et de l'assiduité",
    assiduiteImpacte: false,
  },
};

export const FUNDER_TYPES = ["opco", "cpf", "entreprise", "particulier", "region", "france_travail", "autre"];
export const INVOICE_STATUSES = ["brouillon", "emise", "payee", "annulee"];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const jour = 864e5;

export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = new Date(fromISO + "T00:00:00Z"), b = new Date(toISO + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / jour) + 1; // bornes incluses : un contrat d'un jour dure un jour
}

// Prorata temporis journalier. `arret` = rupture ou date d'arrêté intermédiaire.
export function prorataTemporis({ montant, dateDebut, dateFin, arret }) {
  const total = daysBetween(dateDebut, dateFin);
  if (!total || total <= 0 || montant == null) return null;
  const fin = arret && arret < dateFin ? arret : dateFin;
  const executes = Math.max(0, Math.min(daysBetween(dateDebut, fin) ?? 0, total));
  return {
    joursTotal: total, joursExecutes: executes,
    ratio: round2(executes / total),
    montantDu: round2((Number(montant) * executes) / total),
    montantInitial: round2(montant),
  };
}

// Échéancier : découpe le montant en versements réguliers sur la durée. Chaque
// échéance porte sa période, ce qui permet de facturer « ce qui est dû à ce jour »
// sans recalculer à la main.
export function buildSchedule({ montant, dateDebut, dateFin, cadence = "mensuelle", mode = "npec" }) {
  const total = daysBetween(dateDebut, dateFin);
  if (!total || total <= 0 || !montant) return [];
  const pas = cadence === "trimestrielle" ? 3 : cadence === "annuelle" ? 12 : 1;
  const echeances = [];
  let curseur = new Date(dateDebut + "T00:00:00Z");
  const fin = new Date(dateFin + "T00:00:00Z");
  while (curseur <= fin) {
    const debut = curseur.toISOString().slice(0, 10);
    const suivant = new Date(curseur);
    suivant.setUTCMonth(suivant.getUTCMonth() + pas);
    const borne = new Date(Math.min(suivant.getTime() - jour, fin.getTime()));
    const finPeriode = borne.toISOString().slice(0, 10);
    const jours = daysBetween(debut, finPeriode) || 0;
    echeances.push({
      debut, fin: finPeriode, jours,
      // Chaque échéance vaut sa part de jours : les mois courts et le dernier
      // mois incomplet ne sont pas surfacturés.
      montant: round2((Number(montant) * jours) / total),
      mode,
    });
    curseur = suivant;
  }
  // L'arrondi au centime peut faire dériver la somme : on ajuste la dernière
  // échéance pour que le total facturé égale exactement le montant convenu.
  const somme = round2(echeances.reduce((s, e) => s + e.montant, 0));
  const ecart = round2(Number(montant) - somme);
  if (ecart !== 0 && echeances.length) {
    echeances[echeances.length - 1].montant = round2(echeances[echeances.length - 1].montant + ecart);
  }
  return echeances;
}

// Montant dû pour une période, selon le mode de financement.
// `minutesRealisees` n'est utilisé QUE par le mode « heures ».
export function amountDue({ mode, echeance, prixHoraire, minutesRealisees, arret }) {
  if (mode === "heures") {
    const heures = round2((Number(minutesRealisees) || 0) / 60);
    return { base: "heures réalisées", heures, montant: round2(heures * (Number(prixHoraire) || 0)) };
  }
  if (mode === "forfait") {
    return { base: "forfait", montant: round2(echeance?.montant ?? 0) };
  }
  // NPEC : la part de l'échéance effectivement exécutée. Une rupture en cours de
  // période ne fait payer que les jours réalisés.
  const p = prorataTemporis({ montant: echeance?.montant, dateDebut: echeance?.debut, dateFin: echeance?.fin, arret });
  return {
    base: "prorata temporis des jours de contrat",
    jours: p?.joursExecutes ?? 0, joursPeriode: p?.joursTotal ?? 0,
    montant: p ? p.montantDu : 0,
  };
}

// Numérotation des factures : séquence continue, SANS TROU. C'est une obligation
// comptable — une facture annulée reste numérotée et se corrige par un avoir,
// elle ne disparaît jamais de la séquence.
export function invoiceNumber({ prefix = "FA", year, seq }) {
  return `${prefix}${year}-${String(seq).padStart(5, "0")}`;
}

// La formation professionnelle continue est exonérée de TVA pour un organisme
// détenteur de l'attestation (art. 261-4-4° a du CGI). L'exonération est donc un
// attribut de l'ORGANISME, pas de la ligne de facture.
export function computeTotals(lignes = [], { exonereTva = true, tauxTva = 20 } = {}) {
  const ht = round2(lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0));
  const tva = exonereTva ? 0 : round2((ht * tauxTva) / 100);
  return {
    totalHT: ht, tauxTva: exonereTva ? 0 : tauxTva, totalTVA: tva, totalTTC: round2(ht + tva),
    mentionExoneration: exonereTva ? "Exonération de TVA — article 261-4-4° a du CGI (formation professionnelle continue)" : null,
  };
}

// Solde d'un dossier de financement : ce qui est dû, facturé, encaissé.
export function balance({ montantDu, factures = [], reglements = [] }) {
  const facture = round2(factures.filter((f) => f.status !== "annulee").reduce((s, f) => s + (Number(f.totalTTC) || 0), 0));
  const encaisse = round2(reglements.reduce((s, r) => s + (Number(r.montant) || 0), 0));
  return {
    montantDu: round2(montantDu), facture, encaisse,
    resteAFacturer: round2(Number(montantDu) - facture),
    resteAEncaisser: round2(facture - encaisse),
  };
}

// Comparateur de bascule : confronte le montant calculé par Campus Manager au
// montant facturé par le système sortant, mois par mois. C'est LUI qui autorise
// l'abandon de l'ancien ERP — un écart non expliqué est un motif de report.
export function compareWithLegacy(nôtres = [], leurs = [], tolerance = 0.01) {
  const index = new Map(leurs.map((l) => [l.periode, Number(l.montant) || 0]));
  const lignes = [];
  for (const n of nôtres) {
    const ref = index.has(n.periode) ? index.get(n.periode) : null;
    const ecart = ref == null ? null : round2((Number(n.montant) || 0) - ref);
    lignes.push({
      periode: n.periode, calcule: round2(n.montant), reference: ref,
      ecart, conforme: ref != null && Math.abs(ecart) <= tolerance,
      motif: ref == null ? "absent du système sortant" : Math.abs(ecart) <= tolerance ? null : "écart de montant",
    });
    index.delete(n.periode);
  }
  // Ce que le système sortant facture et que nous ne facturons pas : le sens le
  // plus dangereux, car il signale une recette qu'on perdrait à la bascule.
  for (const [periode, montant] of index) {
    lignes.push({ periode, calcule: null, reference: round2(montant), ecart: round2(-montant),
      conforme: false, motif: "non facturé par Campus Manager" });
  }
  lignes.sort((a, b) => String(a.periode).localeCompare(String(b.periode)));
  const ecarts = lignes.filter((l) => !l.conforme);
  return {
    lignes, total: lignes.length, conformes: lignes.length - ecarts.length, ecarts: ecarts.length,
    ecartTotal: round2(lignes.reduce((s, l) => s + (l.ecart || 0), 0)),
    // La bascule ne s'autorise que si TOUT concorde : un seul écart inexpliqué
    // suffit à reporter, parce qu'il se répétera sur chaque dossier.
    basculeAutorisee: ecarts.length === 0 && lignes.length > 0,
  };
}

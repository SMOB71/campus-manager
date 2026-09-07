// Déclarations annuelles obligatoires — logique pure (aucune I/O).
//
// Deux obligations distinctes, souvent confondues :
//
//   • SIFA — Système d'information sur la formation des apprentis (décret
//     n° 2024-1223 du 30 décembre 2024). Enquête annuelle des CFA, arrêtée au
//     31 DÉCEMBRE, déposée sous forme de fichier. Une ligne par apprenti.
//     L'INE y est la clé : sans lui, la ligne est rejetée.
//
//   • BPF — Bilan pédagogique et financier (Cerfa 10443), déposé avant le
//     30 AVRIL auprès de la DREETS par tout organisme de formation. Il porte sur
//     l'EXERCICE COMPTABLE, pas sur l'année scolaire, et ses montants sont hors
//     taxes arrondis à l'euro.
//
// PARTI PRIS — ces modules PRÉPARENT la déclaration : ils produisent les données
// et signalent nommément ce qui manque. Ils ne se substituent pas au dépôt sur le
// portail officiel, et ne prétendent pas garantir l'acceptation du fichier.
// ⚠️ Formats et nomenclatures à revérifier à chaque campagne (veille trimestrielle).

const round0 = (n) => Math.round(Number(n) || 0);

// Date d'observation SIFA : 31 décembre de l'année de référence.
export const sifaObservationDate = (annee) => `${annee}-12-31`;

// Un apprenti entre dans l'enquête s'il était en formation au 31 décembre.
export function isInSifaScope({ enrollment, contract, dateObservation }) {
  if (!enrollment) return false;
  const debut = enrollment.dateDebut || contract?.dateDebut || "";
  const sortie = enrollment.dateSortie || "";
  if (debut && debut > dateObservation) return false;      // pas encore entré
  if (sortie && sortie < dateObservation) return false;     // déjà sorti
  // Un apprenti en rupture mais maintenu en formation (stagiaire) reste compté :
  // il est bien présent au CFA au 31 décembre.
  return ["inscrit", "stagiaire"].includes(enrollment.statut);
}

// Colonnes du fichier SIFA. `requis` désigne ce dont l'absence fait rejeter la
// ligne — le reste est attendu mais toléré.
export const SIFA_COLUMNS = [
  { key: "ine", label: "INE", requis: true },
  { key: "nom", label: "Nom", requis: true },
  { key: "prenom", label: "Prénom", requis: true },
  { key: "sexe", label: "Sexe", requis: true },
  { key: "dateNaissance", label: "Date de naissance", requis: true },
  { key: "lieuNaissance", label: "Commune de naissance", requis: false },
  { key: "deptNaissance", label: "Département de naissance", requis: false },
  { key: "nationalite", label: "Nationalité", requis: false },
  { key: "adresse", label: "Adresse", requis: false },
  { key: "rqth", label: "Travailleur handicapé", requis: false },
  { key: "diplomePrepare", label: "Diplôme préparé", requis: true },
  { key: "codeRncp", label: "Code RNCP", requis: false },
  { key: "anneeFormation", label: "Année de formation", requis: false },
  { key: "dureeFormation", label: "Durée de formation (heures)", requis: false },
  { key: "dateEntreeCfa", label: "Date d'entrée au CFA", requis: true },
  { key: "dateDebutContrat", label: "Date de début de contrat", requis: false },
  { key: "dateFinContrat", label: "Date de fin de contrat", requis: false },
  { key: "dateRupture", label: "Date de rupture", requis: false },
  { key: "siretEmployeur", label: "SIRET employeur", requis: false },
  { key: "nomEmployeur", label: "Employeur", requis: false },
  { key: "situationAvant", label: "Situation avant le contrat", requis: false },
  { key: "dernierDiplome", label: "Dernier diplôme obtenu", requis: false },
];

export function buildSifa({ annee, learners = [], enrollments = [], contracts = [], classes = [], curricula = [], companies = [] }) {
  const dateObservation = sifaObservationDate(annee);
  const parClasse = new Map(classes.map((k) => [k.id, k]));
  const parCursus = new Map(curricula.map((c) => [c.id, c]));
  const parEntreprise = new Map(companies.map((c) => [c.id, c]));
  const lignes = [];

  for (const l of learners) {
    // L'inscription retenue est celle en cours à la date d'observation.
    const inscriptions = enrollments.filter((e) => e.learnerId === l.id);
    const enr = inscriptions.find((e) => isInSifaScope({ enrollment: e, dateObservation }));
    if (!enr) continue;
    const contrat = contracts.find((c) => c.learnerId === l.id && (!c.dateFin || c.dateFin >= dateObservation))
      || contracts.find((c) => c.learnerId === l.id) || null;
    const classe = enr.classId ? parClasse.get(enr.classId) : null;
    const cursus = classe?.curriculumId ? parCursus.get(classe.curriculumId) : null;
    const entreprise = contrat?.companyId ? parEntreprise.get(contrat.companyId) : null;

    lignes.push({
      learnerId: l.id,
      ine: l.ine || "", nom: l.nom || "", prenom: l.prenom || "", sexe: l.sexe || "",
      dateNaissance: l.dateNaissance || "", lieuNaissance: l.lieuNaissance || "",
      deptNaissance: l.deptNaissance || "", nationalite: l.nationalite ?? "",
      adresse: l.adresse || "", rqth: l.rqth ? "1" : "0",
      diplomePrepare: cursus?.diploma || cursus?.name || classe?.name || "",
      codeRncp: cursus?.codeRncp || "", anneeFormation: classe?.year ?? "",
      dureeFormation: cursus?.dureeHeures ?? "",
      dateEntreeCfa: enr.dateDebut || contrat?.dateDebut || "",
      dateDebutContrat: contrat?.dateDebut || "", dateFinContrat: contrat?.dateFin || "",
      dateRupture: contrat?.rupture?.dateRupture || "",
      siretEmployeur: entreprise?.siret || "", nomEmployeur: entreprise?.name || "",
      situationAvant: l.situationAvant ?? "", dernierDiplome: l.diplomeLePlusEleve || "",
    });
  }

  // Contrôles AVANT dépôt : une ligne incomplète est rejetée par la plateforme,
  // et un rejet découvert le 31 décembre coûte une campagne.
  const anomalies = [];
  for (const ligne of lignes) {
    const manquants = SIFA_COLUMNS.filter((c) => c.requis && !String(ligne[c.key] ?? "").trim()).map((c) => c.label);
    if (manquants.length) {
      anomalies.push({ learnerId: ligne.learnerId, apprenant: `${ligne.prenom} ${ligne.nom}`.trim(), manquants });
    }
  }
  return {
    annee, dateObservation, lignes, anomalies,
    total: lignes.length,
    deposable: anomalies.length === 0 && lignes.length > 0,
  };
}

// Sérialisation tabulaire. Le séparateur point-virgule est l'usage des dépôts
// administratifs français, et les valeurs sont échappées pour ne pas casser le
// fichier sur un nom contenant un point-virgule ou un guillemet.
export function toCsv(colonnes, lignes, separateur = ";") {
  const echapper = (v) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const entete = colonnes.map((c) => echapper(c.label)).join(separateur);
  const corps = lignes.map((l) => colonnes.map((c) => echapper(l[c.key])).join(separateur));
  // BOM UTF-8 : sans lui, les accents s'affichent faux dans les tableurs français.
  return "﻿" + [entete, ...corps].join("\r\n") + "\r\n";
}

// --- BPF (Cerfa 10443) ---
// Structure par cadres. Les montants sont HORS TAXES et arrondis à l'euro.

export const BPF_FINANCEURS = {
  entreprises: "Entreprises pour leurs salariés",
  opco: "Organismes gestionnaires des fonds de la formation (OPCO)",
  publics: "Pouvoirs publics (État, régions, France Travail)",
  particuliers: "Contrats conclus avec des particuliers",
  autresOf: "Autres organismes de formation (sous-traitance)",
  autres: "Autres produits au titre de la formation",
};

export function buildBpf({ exerciceDebut, exerciceFin, invoices = [], fundings = [], sheets = [], stagiaires = 0, campus = null }) {
  const dansExercice = (d) => d && (!exerciceDebut || d >= exerciceDebut) && (!exerciceFin || d <= exerciceFin);
  const fundingParId = new Map(fundings.map((f) => [f.id, f]));

  // Cadre C — produits, ventilés par origine de financement. Les avoirs se
  // déduisent naturellement (montants négatifs) ; les factures annulées sortent.
  const produits = Object.fromEntries(Object.keys(BPF_FINANCEURS).map((k) => [k, 0]));
  for (const i of invoices) {
    if (i.status === "annulee" || i.status === "brouillon") continue;
    if (!dansExercice(i.date)) continue;
    const f = i.fundingId ? fundingParId.get(i.fundingId) : null;
    const type = f?.typeFinanceur || "opco";
    const cible = type === "entreprise" ? "entreprises"
      : type === "particulier" ? "particuliers"
      : ["region", "france_travail"].includes(type) ? "publics"
      : type === "cpf" ? "publics"
      : type === "autre" ? "autres" : "opco";
    produits[cible] += Number(i.totalHT) || 0;
  }
  const totalProduits = round0(Object.values(produits).reduce((s, v) => s + v, 0));

  // Cadre B — bilan pédagogique : heures et stagiaires. Les heures viennent des
  // feuilles d'émargement CLOSES, jamais d'une saisie déclarative.
  let heuresStagiaires = 0;
  for (const s of sheets) {
    if (!dansExercice(s.date)) continue;
    const duree = s.durationMinutes ?? 0;
    heuresStagiaires += (duree * (s.presents ?? 0)) / 60;
  }

  const manquantes = [];
  if (!campus?.numeroDeclaration) manquantes.push("numéro de déclaration d'activité");
  if (!campus?.siret) manquantes.push("SIRET de l'organisme");
  if (!campus?.dirigeant) manquantes.push("nom du représentant légal");
  if (!exerciceDebut || !exerciceFin) manquantes.push("dates de l'exercice comptable");
  if (!sheets.length) manquantes.push("aucune feuille d'émargement close — le nombre d'heures n'est pas justifiable");

  return {
    exerciceDebut, exerciceFin,
    organisme: {
      nom: campus?.name || "", siret: campus?.siret || "",
      numeroDeclaration: campus?.numeroDeclaration || "", dirigeant: campus?.dirigeant || "",
      adresse: campus?.address || "",
    },
    cadreB: { stagiaires, heuresStagiaires: Math.round(heuresStagiaires) },
    cadreC: { produits: Object.fromEntries(Object.entries(produits).map(([k, v]) => [k, round0(v)])), total: totalProduits },
    manquantes,
    deposable: manquantes.length === 0,
  };
}

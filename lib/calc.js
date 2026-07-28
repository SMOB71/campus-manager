// Logique métier PURE (sans I/O) — extraite de server.js pour être testable unitairement.

// Marge d'exploitation (EBIT campus) = CA − masse salariale − autres charges.
export const marginOf = (k) => (k && k.revenue != null ? k.revenue - (k.payroll || 0) - (k.charges || 0) : null);

// Score de santé composite (0-100) : moyenne pondérée des dimensions disponibles.
// Retourne { score, detail:[{label, score}] } (detail trié pire → meilleur) pour l'explicabilité.
export function healthScore({ occupancy, qualiopi, overdue, visitDue, satisfaction, openIncidents }) {
  const parts = []; // [poids, score, label, réel?]
  if (occupancy != null) parts.push([0.30, Math.min(100, occupancy), "Remplissage", true]);
  if (qualiopi != null) parts.push([0.30, qualiopi, "Qualiopi", true]);
  parts.push([0.15, overdue > 0 ? Math.max(0, 100 - overdue * 20) : 100, "Actions à jour", false]);
  parts.push([0.10, visitDue ? 50 : 100, "Cadence visites", false]);
  if (satisfaction != null) parts.push([0.10, Math.max(0, Math.min(100, satisfaction * 10)), "Satisfaction", true]);
  parts.push([0.05, Math.max(0, 100 - (openIncidents || 0) * 15), "Incidents", false]);
  const w = parts.reduce((s, p) => s + p[0], 0);
  if (!w) return { score: null, detail: [], insufficient: true };
  // "Données insuffisantes" si moins de 2 facteurs de fond (remplissage / Qualiopi / satisfaction) renseignés.
  const realCount = parts.filter((p) => p[3]).length;
  return {
    score: Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / w),
    detail: parts.map((p) => ({ label: p[2], score: Math.round(p[1]), weight: Math.round((p[0] / w) * 100), points: Math.round((p[0] / w) * p[1]) })).sort((a, b) => a.score - b.score),
    insufficient: realCount < 2,
  };
}

// Année scolaire (sept → août) contenant `now`.
export function schoolYearRange(now = new Date()) {
  const m = now.getMonth() + 1, y = now.getFullYear();
  const startY = m >= 9 ? y : y - 1;
  return { startY, from: `${startY}-09`, to: `${startY + 1}-08`, label: `${startY}‑${startY + 1}` };
}

// Extrait la ventilation chiffrée des postes depuis le bloc ```json d'un P&L.
export function extractPnlPostes(content) {
  const m = (content || "").match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const p = d.postes;
    if (!p || typeof p !== "object") return null;
    const clean = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && x.label && x.amount != null && !isNaN(Number(x.amount))).map((x) => ({ label: String(x.label).trim(), amount: Number(x.amount) })) : []);
    const out = { month: typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month) ? p.month : null, revenue: clean(p.revenue), payroll: clean(p.payroll), charges: clean(p.charges) };
    if (!out.revenue.length && !out.payroll.length && !out.charges.length) return null;
    return out;
  } catch { return null; }
}

// --- Ouvertures de campus (rétroplanning) ---
export const OPENING_LOTS = [
  { k: "etude", l: "Étude & décision" },
  { k: "immo", l: "Locaux & immobilier" },
  { k: "travaux", l: "Aménagement & travaux" },
  { k: "admin", l: "Administratif & juridique" },
  { k: "offre", l: "Offre & pédagogie" },
  { k: "rh", l: "Recrutement équipe" },
  { k: "marketing", l: "Marketing & admissions" },
  { k: "lancement", l: "Lancement & rentrée" },
];
// Modèle type — m = mois avant la rentrée (négatif = après). critical = chemin critique.
export const OPENING_TEMPLATE = [
  { lot: "etude", title: "Étude de marché local & analyse concurrentielle", m: 15, critical: true },
  { lot: "etude", title: "Business plan & budget d'ouverture", m: 14, critical: true },
  { lot: "etude", title: "Validation Go / No-Go direction", m: 13, critical: true },
  { lot: "immo", title: "Cahier des charges des locaux (surface, zone, ERP)", m: 13 },
  { lot: "immo", title: "Recherche & visites de locaux", m: 12, critical: true },
  { lot: "immo", title: "Négociation du bail commercial", m: 10 },
  { lot: "immo", title: "Signature du bail", m: 9, critical: true },
  { lot: "immo", title: "Dossier ERP & passage commission de sécurité", m: 7, critical: true },
  { lot: "immo", title: "Souscription des assurances (locaux, RC)", m: 6 },
  { lot: "travaux", title: "Plans d'aménagement & obtention des devis", m: 9 },
  { lot: "travaux", title: "Réalisation des travaux & second œuvre", m: 6, critical: true },
  { lot: "travaux", title: "Mobilier & équipement pédagogique", m: 4 },
  { lot: "travaux", title: "Informatique, réseau, wifi & téléphonie", m: 3, critical: true },
  { lot: "travaux", title: "Signalétique intérieure & extérieure", m: 2 },
  { lot: "admin", title: "Création établissement / SIRET secondaire", m: 12 },
  { lot: "admin", title: "Déclaration d'ouverture au rectorat", m: 6, critical: true },
  { lot: "admin", title: "Demande de numéro UAI", m: 6 },
  { lot: "admin", title: "Conformité RGPD & registre des traitements", m: 5 },
  { lot: "admin", title: "Démarche Qualiopi (extension de périmètre)", m: 5, critical: true },
  { lot: "offre", title: "Définition des filières & maquettes pédagogiques", m: 12, critical: true },
  { lot: "offre", title: "Titres RNCP / certifications & agréments", m: 11, critical: true },
  { lot: "offre", title: "Partenariats entreprises & alternance", m: 7 },
  { lot: "offre", title: "Calendrier académique & emplois du temps", m: 3 },
  { lot: "rh", title: "Recrutement du directeur de campus", m: 10, critical: true },
  { lot: "rh", title: "Recrutement de l'équipe pédagogique", m: 6, critical: true },
  { lot: "rh", title: "Recrutement administratif & admissions", m: 5 },
  { lot: "rh", title: "Sourcing vacataires & intervenants pro", m: 4 },
  { lot: "rh", title: "Onboarding & formation des équipes", m: 1 },
  { lot: "marketing", title: "Identité locale & supports de communication", m: 10 },
  { lot: "marketing", title: "Site / landing page du campus", m: 9 },
  { lot: "marketing", title: "Plan média & campagnes d'acquisition", m: 8, critical: true },
  { lot: "marketing", title: "Calendrier salons & référencement (Parcoursup, etc.)", m: 9, critical: true },
  { lot: "marketing", title: "CRM admissions & process de traitement", m: 7 },
  { lot: "marketing", title: "Journées Portes Ouvertes (série)", m: 5, critical: true },
  { lot: "marketing", title: "Objectif de recrutement & suivi du pipeline", m: 8, critical: true },
  { lot: "lancement", title: "Pré-rentrée (accueil, EDT, comptes, badges)", m: 1, critical: true },
  { lot: "lancement", title: "Logistique jour J & répétition", m: 0.5 },
  { lot: "lancement", title: "Communication de lancement & relations presse", m: 1 },
  { lot: "lancement", title: "Bilan d'ouverture & plan d'amélioration", m: -1 },
];
export function buildOpeningTasks(targetDate) {
  const base = new Date(targetDate);
  if (isNaN(base.getTime())) return [];
  return OPENING_TEMPLATE.map((t) => {
    const days = Math.round(t.m * 30.4);
    const d = new Date(base); d.setDate(d.getDate() - days);
    return { lot: t.lot, title: t.title, offset: days, dueDate: d.toISOString().slice(0, 10), critical: !!t.critical, status: "todo", owner: "" };
  });
}
export const OPENING_BUDGET_RATIOS = { travaux: 0.40, immo: 0.10, marketing: 0.18, rh: 0.12, offre: 0.05, admin: 0.05, etude: 0.03, lancement: 0.07 };
export function buildOpeningBudget(total) {
  if (!total) return [];
  return OPENING_LOTS.map((lot) => ({ lot: lot.k, label: lot.l, planned: Math.round((OPENING_BUDGET_RATIOS[lot.k] || 0) * total), committed: 0, spent: 0 }));
}

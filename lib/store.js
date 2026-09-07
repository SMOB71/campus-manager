// Store JSON persistant (mono-utilisateur). Ecriture atomique.
// Persiste dans DATA_DIR (monte sur un volume Docker en prod).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt, isEncrypted, encryptionEnabled } from "./crypto-store.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = { campuses: [], deliverables: [], actions: [], visits: [], kpi: [], briefs: [], incidents: [], documents: [], partners: [], networkObjectives: [], audit: [], scenarios: [], openings: [], emailPriority: [], emailMuted: [], decisions: [], reviews: [], events: [], recoveries: [], arbitrages: [], committees: [], si: [], learners: [], enrollments: [], candidates: [], contracts: [], assessments: [], grades: [], portalAccess: [], attendanceAnchors: [], teachers: [], curricula: [], rooms: [], classes: [], periods: [], financeProposals: {}, curriculumProposals: {}, settings: {} };

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, encrypt(EMPTY));
}

// Cache lecture : le store est déchiffré + parsé à CHAQUE read() (94 appels), et le hot path
// (buildNetworkRows + heatmap) lit ~4×N fois par affichage → coûteux. On mémorise le db lu et
// on l'invalide à toute écriture. Sûr car le store est synchrone (Node sérialise) et suit le
// pattern read()→mutate→write() (write() vide le cache). Les lectures qui trient copient d'abord
// (.slice()) pour ne pas muter le cache en place.
let _cache = null;
function read() {
  if (_cache) return _cache;
  ensure();
  try {
    _cache = { ...EMPTY, ...(decrypt(fs.readFileSync(DB_FILE, "utf8")) || {}) };
  } catch {
    _cache = { ...EMPTY };
  }
  return _cache;
}

// Migre les données existantes vers le chiffré (db.json + backups), une fois.
export function migrateEncryption() {
  if (!encryptionEnabled) return { migrated: 0 };
  ensure();
  let migrated = 0;
  const raw = fs.readFileSync(DB_FILE, "utf8");
  if (!isEncrypted(raw)) {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, encrypt(JSON.parse(raw)));
    fs.renameSync(tmp, DB_FILE);
    migrated++;
  }
  const bdir = path.join(DATA_DIR, "backups");
  if (fs.existsSync(bdir)) {
    for (const f of fs.readdirSync(bdir).filter((x) => x.endsWith(".json"))) {
      const p = path.join(bdir, f);
      const r = fs.readFileSync(p, "utf8");
      if (!isEncrypted(r)) { try { fs.writeFileSync(p, encrypt(JSON.parse(r))); migrated++; } catch { /* ignore */ } }
    }
  }
  _cache = null;   // écriture directe hors write() → invalider le cache
  return { migrated };
}

function write(db) {
  ensure();
  // Sauvegarde de la version precedente AVANT ecrasement (anti-perte de donnees).
  // Espacée dans le temps : au plus une sauvegarde par heure. Évite que, sous une rafale
  // d'écritures (seed finance, import…), les 30 copies datent toutes de la même minute →
  // la fenêtre de restauration utile s'effondrait à quelques secondes. On garde ~48 copies
  // horaires (~2 jours). La copie HORS-VOLUME est faite par un cron hôte (scripts/backup-offvolume.sh).
  try {
    if (fs.existsSync(DB_FILE)) {
      const bdir = path.join(DATA_DIR, "backups");
      if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
      const existing = fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
      let doBackup = true;
      if (existing.length) {
        try { if (Date.now() - fs.statSync(path.join(bdir, existing[existing.length - 1])).mtimeMs < 3600 * 1000) doBackup = false; }
        catch { /* en cas de doute on sauvegarde */ }
      }
      if (doBackup) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(DB_FILE, path.join(bdir, `db-${stamp}.json`));
        const files = fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
        for (const f of files.slice(0, -48)) fs.unlinkSync(path.join(bdir, f)); // ~48h d'historique horaire
      }
    }
  } catch { /* la sauvegarde ne doit jamais bloquer l'ecriture */ }
  // Écriture atomique + durable : write dans un tmp, fsync (survit à un crash), puis rename atomique.
  // NB : le store est synchrone → Node sérialise les écritures (pas d'entrelacement read-modify-write).
  const tmp = DB_FILE + ".tmp";
  const payload = encrypt(db);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, DB_FILE);
  _cache = null;   // invalide le cache lecture après toute écriture
}

// Restauration manuelle depuis la derniere sauvegarde (ou une sauvegarde donnee).
export function listBackups() {
  const bdir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort().reverse();
}
export function listBackupsMeta() {
  const bdir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort().reverse().map((f) => {
    const st = fs.statSync(path.join(bdir, f));
    return { name: f, size: st.size, mtime: st.mtime.toISOString() };
  });
}
export function backupNow() {
  ensure();
  const bdir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `db-${stamp}.json`;
  fs.copyFileSync(DB_FILE, path.join(bdir, name));
  const files = fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
  for (const f of files.slice(0, -30)) fs.unlinkSync(path.join(bdir, f));
  return name;
}
export function restoreBackup(name) {
  if (!/^db-[\w.\-:]+\.json$/.test(name)) return { error: "nom de sauvegarde invalide" };
  const p = path.join(DATA_DIR, "backups", name);
  if (!fs.existsSync(p)) return { error: "sauvegarde introuvable" };
  let data;
  try { data = decrypt(fs.readFileSync(p, "utf8")); } catch { return { error: "sauvegarde illisible (clé ?)" }; }
  if (!data || typeof data !== "object") return { error: "sauvegarde corrompue" };
  write({ ...EMPTY, ...data }); // write() sauvegarde d'abord la version courante
  return { ok: true };
}

export const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

// --- Campus ---
export function listCampuses() {
  return read().campuses.slice().sort((a, b) => a.name.localeCompare(b.name));
}
const CAMPUS_FIELDS = ["name", "address", "email", "phone", "city", "region", "network"];
const CAMPUS_NUM = ["capacity", "students", "visitCadenceMonths"];
export function addCampus(data = {}) {
  const db = read();
  const c = { id: id(), contacts: [], createdAt: now() };
  for (const f of CAMPUS_FIELDS) c[f] = String(data[f] || "").trim();
  for (const f of CAMPUS_NUM) c[f] = data[f] ? Number(data[f]) : null;
  db.campuses.push(c);
  write(db);
  return c;
}
export function updateCampus(cid, patch = {}) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  for (const f of CAMPUS_FIELDS) if (f in patch) c[f] = String(patch[f] || "").trim();
  for (const f of CAMPUS_NUM) if (f in patch) c[f] = patch[f] ? Number(patch[f]) : null;
  write(db);
  return c;
}
export function deleteCampus(cid) {
  const db = read();
  db.campuses = db.campuses.filter((c) => c.id !== cid);
  write(db);
}
// Met a jour un bloc objet du campus (objectives, admissions, directorReview).
export function updateCampusPart(cid, key, patch = {}, numFields = []) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  c[key] = c[key] || {};
  for (const [k, v] of Object.entries(patch)) {
    c[key][k] = numFields.includes(k) ? (v === "" || v == null ? null : Number(v)) : (typeof v === "string" ? v.trim() : v);
  }
  write(db);
  return c[key];
}
// Filières : type (BTS/Bachelor/…) + modalité (initial/alternance/mixte) — distinction clé pour un post-bac.
export const FILIERE_TYPES = ["BTS", "Bachelor", "Licence", "MBA", "Mastère", "Titre RNCP", "Autre"];
export const FILIERE_MODALITES = ["initial", "alternance", "mixte"];
// Effectifs par filiere (remplace la liste complete)
export function setFilieres(cid, filieres) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  c.filieres = (Array.isArray(filieres) ? filieres : []).filter((f) => f && f.nom).map((f) => ({
    id: f.id || id(), nom: String(f.nom).trim(), niveau: (f.niveau || "").trim(),
    type: FILIERE_TYPES.includes(f.type) ? f.type : "",
    modalite: FILIERE_MODALITES.includes(f.modalite) ? f.modalite : "initial",
    effectif: f.effectif ? Number(f.effectif) : null, capacite: f.capacite ? Number(f.capacite) : null,
    frais: f.frais ? Number(f.frais) : null,
  }));
  write(db);
  return c.filieres;
}

// --- Incidents & réclamations ---
export function listIncidents({ campusId, kind, status } = {}) {
  let items = read().incidents || [];
  if (campusId) items = items.filter((i) => i.campusId === campusId);
  if (kind) items = items.filter((i) => i.kind === kind);
  if (status) items = items.filter((i) => i.status === status);
  return items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export function addIncident(data = {}) {
  const db = read();
  db.incidents = db.incidents || [];
  const inc = {
    id: id(), kind: ["incident", "reclamation"].includes(data.kind) ? data.kind : "incident",
    campusId: data.campusId || null, campusName: data.campusName || null,
    category: (data.category || "").trim(), title: String(data.title || "").trim(), description: (data.description || "").trim(),
    severity: ["faible", "moyen", "eleve", "critique"].includes(data.severity) ? data.severity : "moyen",
    status: "open", date: data.date || now().slice(0, 10), resolution: "", createdAt: now(),
  };
  db.incidents.push(inc);
  write(db);
  return inc;
}
export function updateIncident(iid, patch = {}) {
  const db = read();
  const inc = (db.incidents || []).find((x) => x.id === iid);
  if (!inc) return null;
  for (const f of ["category", "title", "description", "severity", "status", "date", "resolution", "kind"]) if (f in patch) inc[f] = typeof patch[f] === "string" ? patch[f].trim() : patch[f];
  write(db);
  return inc;
}
export function deleteIncident(iid) {
  const db = read();
  db.incidents = (db.incidents || []).filter((i) => i.id !== iid);
  write(db);
}

export function addContact(cid, { role, firstName, lastName, email, phone, category }) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  if (!c.contacts) c.contacts = [];
  const cats = ["direction", "administratif", "professeur", "autre"];
  const contact = {
    id: id(), category: cats.includes(category) ? category : "autre",
    role: (role || "").trim(), firstName: (firstName || "").trim(), lastName: (lastName || "").trim(),
    email: (email || "").trim(), phone: (phone || "").trim(),
  };
  c.contacts.push(contact);
  write(db);
  return contact;
}
export function deleteContact(cid, contactId) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c || !c.contacts) return;
  c.contacts = c.contacts.filter((k) => k.id !== contactId);
  write(db);
}

// --- Livrables (historique) ---
export function listDeliverables({ campusId, task } = {}) {
  let items = read().deliverables;
  if (campusId) items = items.filter((d) => d.campusId === campusId);
  if (task) items = items.filter((d) => d.task === task);
  return items
    .map(({ content, ...meta }) => meta) // liste = metadata seulement
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getDeliverable(did) {
  return read().deliverables.find((d) => d.id === did) || null;
}
export function latestDeliverable(campusId, task) {
  const items = read().deliverables.filter((d) => (!campusId || d.campusId === campusId) && (!task || d.task === task));
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items[0] || null;
}
export function addDeliverable({ task, title, campusId, campusName, content, model, signature }) {
  const db = read();
  const d = { id: id(), task, title: title || "Sans titre", campusId: campusId || null, campusName: campusName || null, model: model || null, content, createdAt: now() };
  if (signature) d.signature = signature;
  db.deliverables.push(d);
  // Borne la croissance : les livrables stockent le contenu IA complet dans le db chiffré ;
  // sans limite, chaque read()/write() s'alourdit indéfiniment. On garde les 500 plus récents.
  if (db.deliverables.length > 500) db.deliverables = db.deliverables.slice(-500);
  write(db);
  return d;
}
export function deleteDeliverable(did) {
  const db = read();
  db.deliverables = db.deliverables.filter((d) => d.id !== did);
  write(db);
}

// --- Qualiopi (état par campus) ---
const QUALIOPI_META = ["certifier", "certifNumber", "lastAudit", "nextSurveillance", "renewalDate", "scope"];
export function getQualiopi(cid) {
  const c = read().campuses.find((x) => x.id === cid);
  if (!c) return null;
  return c.qualiopi || { indicators: {} };
}
export function updateQualiopi(cid, patch = {}) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  if (!c.qualiopi) c.qualiopi = { indicators: {} };
  for (const f of QUALIOPI_META) if (f in patch) c.qualiopi[f] = String(patch[f] || "").trim();
  if (patch.indicators && typeof patch.indicators === "object") {
    for (const [n, v] of Object.entries(patch.indicators)) {
      c.qualiopi.indicators[n] = { status: v.status || "a_verifier", note: (v.note || "").trim() };
    }
  }
  write(db);
  return c.qualiopi;
}

// --- Visites (cadence) ---
export function listVisits(cid) {
  const v = read().visits.filter((x) => !cid || x.campusId === cid);
  return v.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export function addVisit({ campusId, date, type, note }) {
  const db = read();
  const v = { id: id(), campusId, date: date || now().slice(0, 10), type: type || "", note: (note || "").trim(), createdAt: now() };
  db.visits.push(v);
  write(db);
  return v;
}
export function deleteVisit(vid) {
  const db = read();
  db.visits = db.visits.filter((v) => v.id !== vid);
  write(db);
}
export function lastVisitByCampus() {
  const map = {};
  for (const v of read().visits) {
    if (!map[v.campusId] || v.date > map[v.campusId].date) map[v.campusId] = v;
  }
  return map;
}

// --- KPI mensuels ---
export function listKpi(cid) {
  const k = read().kpi.filter((x) => !cid || x.campusId === cid);
  return k.sort((a, b) => (a.month || "").localeCompare(b.month || ""));
}
// Champs mensuels d'un campus. Fusion (merge) sur upsert (campus, mois) : la vue
// Indicateurs et la vue Finance écrivent des sous-ensembles distincts du même mois.
const KPI_FIELDS = ["students", "occupancy", "revenue", "satisfaction", "successRate", "insertionRate", "revenueBudget", "payroll", "charges", "alternants", "alternantsObjectif"];
export function addKpi(entry) {
  const db = read();
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const existing = db.kpi.find((x) => x.campusId === entry.campusId && x.month === entry.month);
  const k = existing || { id: id(), campusId: entry.campusId, month: entry.month, createdAt: now() };
  for (const f of KPI_FIELDS) if (f in entry) k[f] = num(entry[f]);
  k.updatedAt = now();
  if (!existing) db.kpi.push(k);
  write(db);
  return k;
}
export function latestKpi(cid) {
  const k = read().kpi.filter((x) => x.campusId === cid).sort((a, b) => (a.month || "").localeCompare(b.month || ""));
  return k[k.length - 1] || null;
}
// Détail d'un poste financier (revenue|payroll|charges) en sous-lignes ; l'agrégat = somme des lignes.
const POSTE_FIELD = { revenue: "revenue", payroll: "payroll", charges: "charges" };
export function setKpiPostes(campusId, month, poste, lines) {
  if (!POSTE_FIELD[poste]) return null;
  const db = read();
  let k = db.kpi.find((x) => x.campusId === campusId && x.month === month);
  if (!k) { k = { id: id(), campusId, month, createdAt: now() }; db.kpi.push(k); }
  k.postes = k.postes || {};
  const clean = (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.label || "").trim())
    .map((l) => ({ label: String(l.label).trim(), amount: l.amount === "" || l.amount == null ? 0 : Number(l.amount) }));
  k.postes[poste] = clean;
  k[POSTE_FIELD[poste]] = clean.length ? clean.reduce((s, l) => s + (l.amount || 0), 0) : k[POSTE_FIELD[poste]];
  k.updatedAt = now();
  write(db);
  return k;
}
export function deleteKpi(kid) {
  const db = read();
  db.kpi = db.kpi.filter((k) => k.id !== kid);
  write(db);
}

// --- Propositions de ventilation finance issues d'un P&L IA (À VALIDER) ---
// Zéro-hallucination : les chiffres produits par le modèle ne sont JAMAIS écrits en finance
// sans validation humaine. On stocke ici une proposition EN ATTENTE (par campus), que le
// directeur confirme (→ setKpiPostes) ou ignore. Tant qu'elle n'est pas confirmée, elle
// n'entre PAS dans les agrégats, la finance consolidée, ni le board pack.
export function setFinanceProposal(campusId, proposal) {
  const db = read();
  db.financeProposals = db.financeProposals || {};
  db.financeProposals[campusId] = { ...proposal, campusId, createdAt: now() };
  write(db);
  return db.financeProposals[campusId];
}
export function getFinanceProposal(campusId) {
  return (read().financeProposals || {})[campusId] || null;
}
export function clearFinanceProposal(campusId) {
  const db = read();
  if (db.financeProposals && db.financeProposals[campusId]) { delete db.financeProposals[campusId]; write(db); }
}

// --- Plans d'action ---
export function listActions({ status, campusId } = {}) {
  let items = read().actions;
  if (status) items = items.filter((a) => a.status === status);
  if (campusId) items = items.filter((a) => a.campusId === campusId);
  const order = { todo: 0, doing: 1, done: 2 };
  return items.sort((a, b) => (order[a.status] - order[b.status]) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}
export function addAction({ title, objectif, moyen, mesures, owner, dueDate, campusId, campusName, priority, sourceId, category, accountable, consulted, informed }) {
  const db = read();
  const a = {
    id: id(), title: String(title).trim(),
    // structure plan d'action : Objectif / Moyen / Mesures / Timing (dueDate) / Responsable (owner)
    objectif: objectif || "", moyen: moyen || "", mesures: mesures || "",
    owner: owner || "", dueDate: dueDate || "",
    campusId: campusId || null, campusName: campusName || null, priority: priority || "normal",
    category: category || "general",
    // RACI : owner = Responsable (R) ; accountable = Approbateur (A) ; consulted (C) ; informed (I)
    accountable: accountable || "", consulted: consulted || "", informed: informed || "",
    status: "todo", sourceId: sourceId || null, createdAt: now(),
  };
  db.actions.push(a);
  write(db);
  return a;
}
export function updateAction(aid, patch) {
  const db = read();
  const a = db.actions.find((x) => x.id === aid);
  if (!a) return null;
  Object.assign(a, patch);
  write(db);
  return a;
}
export function deleteAction(aid) {
  const db = read();
  db.actions = db.actions.filter((a) => a.id !== aid);
  write(db);
}

// --- Briefs email (persistance) ---
export function saveBrief({ md, count, agenda }) {
  const db = read();
  db.briefs = db.briefs || [];
  db.briefs.push({ id: id(), md, count: count ?? null, agenda: agenda ?? null, createdAt: now() });
  db.briefs = db.briefs.slice(-14); // garder les 14 derniers
  write(db);
  return db.briefs[db.briefs.length - 1];
}
export function latestBrief() {
  const b = read().briefs || [];
  return b.length ? b[b.length - 1] : null;
}

// ===================== Module Plannings =====================
// Professeurs, référentiels, salles, classes et calendrier scolaire.
// Les SÉANCES ne sont pas ici : elles vivent dans lib/sessionstore.js, sur leur propre
// fichier chiffré. Une année de cours pèse ~360 Ko par classe ; les loger dans db.json
// ferait payer ce poids à chaque lecture du réseau ou de la heatmap, qui ne s'en servent
// jamais. Voir l'en-tête de sessionstore.js.

// Coercition numérique qui PRÉSERVE le zéro. `v ? Number(v) : null` (utilisé par
// setFilieres) transforme 0 en null : pour un volume horaire, 0 h est une information.
const num = (v) => (v == null || v === "" ? null : Number(v));

// --- Professeurs ---
// « prestataire » = intervenant fourni par une société tierce : on suit alors la
// société de rattachement pour lire le coût et le volume par prestataire, et non
// seulement par personne physique.
export const TEACHER_STATUS = ["permanent", "vacataire", "intervenant", "prestataire"];
function normUnavail(u = {}) {
  return { id: u.id || id(), from: u.from || "", to: u.to || u.from || "", reason: String(u.reason || "").trim() };
}
// Disponibilités : { lun: [["09:00","12:30"], …] }. Un jour ABSENT = non renseigné
// (aucune contrainte) ; un jour présent mais VIDE = déclaré indisponible. La distinction
// est portée par withinAvailability (lib/schedule.js) et doit survivre à la sérialisation.
function normAvailability(a) {
  if (!a || typeof a !== "object") return {};
  const out = {};
  for (const d of ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]) {
    if (!(d in a)) continue;
    out[d] = Array.isArray(a[d])
      ? a[d].filter((r) => Array.isArray(r) && r[0] && r[1]).map((r) => [String(r[0]), String(r[1])])
      : [];
  }
  return out;
}
function normTeacher(t = {}) {
  return {
    id: t.id || id(), name: String(t.name || "").trim(),
    email: String(t.email || "").trim(), phone: String(t.phone || "").trim(),
    status: TEACHER_STATUS.includes(t.status) ? t.status : "vacataire",
    company: String(t.company || "").trim(),          // société, si prestataire
    contractRef: String(t.contractRef || "").trim(),  // référence du contrat / bon de commande
    campusIds: Array.isArray(t.campusIds) ? t.campusIds.filter(Boolean) : [],
    heuresAnnuelles: num(t.heuresAnnuelles), tauxHoraire: num(t.tauxHoraire),
    subjects: Array.isArray(t.subjects) ? t.subjects.map((s) => String(s).trim()).filter(Boolean) : [],
    availability: normAvailability(t.availability),
    unavailable: Array.isArray(t.unavailable) ? t.unavailable.map(normUnavail) : [],
    active: t.active === undefined ? true : !!t.active,
    createdAt: t.createdAt || now(),
  };
}
export function listTeachers({ campusId } = {}) {
  let items = (read().teachers || []).slice();
  if (campusId) items = items.filter((t) => (t.campusIds || []).includes(campusId));
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getTeacher(tid) { return (read().teachers || []).find((t) => t.id === tid) || null; }
export function addTeacher(data = {}) {
  const db = read();
  db.teachers = db.teachers || [];
  const t = normTeacher(data);
  db.teachers.push(t);
  write(db);
  return t;
}
export function updateTeacher(tid, patch = {}) {
  const db = read();
  const t = (db.teachers || []).find((x) => x.id === tid);
  if (!t) return null;
  for (const f of ["name", "email", "phone", "company", "contractRef"]) if (f in patch) t[f] = String(patch[f] || "").trim();
  if ("status" in patch && TEACHER_STATUS.includes(patch.status)) t.status = patch.status;
  if ("campusIds" in patch) t.campusIds = Array.isArray(patch.campusIds) ? patch.campusIds.filter(Boolean) : [];
  for (const f of ["heuresAnnuelles", "tauxHoraire"]) if (f in patch) t[f] = num(patch[f]);
  if ("subjects" in patch) t.subjects = Array.isArray(patch.subjects) ? patch.subjects.map((s) => String(s).trim()).filter(Boolean) : [];
  if ("availability" in patch) t.availability = normAvailability(patch.availability);
  if ("unavailable" in patch) t.unavailable = Array.isArray(patch.unavailable) ? patch.unavailable.map(normUnavail) : [];
  if ("active" in patch) t.active = !!patch.active;
  write(db);
  return t;
}
export function deleteTeacher(tid) {
  const db = read();
  db.teachers = (db.teachers || []).filter((t) => t.id !== tid);
  write(db);
}

// --- Référentiels de formation ---
// Une maquette de BTS se lit en HEURES PAR SEMAINE (U1 français 2 h, U42 optique 3 h…),
// pas en volume annuel : c'est la forme officielle, et celle que saisit un directeur.
// `heures` (annuel) reste accepté pour les formations décrites ainsi ; quand les deux
// existent, l'hebdomadaire fait foi car c'est l'entrée directe.
// `repartition` couvre les volumes qui changent dans l'année (renforcement avant
// examens, allègement pendant les périodes de stage).
function normRepartition(r = {}) {
  return {
    id: r.id || id(), label: String(r.label || "").trim(),
    from: r.from || "", to: r.to || "",
    heuresSemaine: num(r.heuresSemaine),
  };
}
function normModule(m = {}) {
  return {
    id: m.id || id(), code: String(m.code || "").trim(), label: String(m.label || "").trim(),
    heures: num(m.heures), heuresSemaine: num(m.heuresSemaine),
    repartition: Array.isArray(m.repartition) ? m.repartition.filter((r) => r && (r.from || r.heuresSemaine != null)).map(normRepartition) : [],
    year: num(m.year), semester: num(m.semester),
    // Coefficient de la matière dans la moyenne générale (défaut 1).
    coefficient: m.coefficient == null || m.coefficient === "" ? 1 : Number(m.coefficient),
    // Exigence de salle : un TP d'optique sans banc n'a pas lieu (lib/schedule.js).
    requiresRoom: String(m.requiresRoom || "").trim() || null,
  };
}
function normCurriculum(c = {}) {
  return {
    id: c.id || id(), name: String(c.name || "").trim(), diploma: String(c.diploma || "").trim(),
    level: String(c.level || "").trim(), source: String(c.source || "").trim(),
    modules: Array.isArray(c.modules) ? c.modules.filter((m) => m && (m.label || m.code)).map(normModule) : [],
    createdAt: c.createdAt || now(),
  };
}
export function listCurricula() {
  return (read().curricula || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getCurriculum(cid) { return (read().curricula || []).find((c) => c.id === cid) || null; }
export function addCurriculum(data = {}) {
  const db = read();
  db.curricula = db.curricula || [];
  const c = normCurriculum(data);
  db.curricula.push(c);
  write(db);
  return c;
}
export function updateCurriculum(cid, patch = {}) {
  const db = read();
  const c = (db.curricula || []).find((x) => x.id === cid);
  if (!c) return null;
  for (const f of ["name", "diploma", "level", "source"]) if (f in patch) c[f] = String(patch[f] || "").trim();
  if ("modules" in patch) c.modules = Array.isArray(patch.modules) ? patch.modules.filter((m) => m && (m.label || m.code)).map(normModule) : [];
  write(db);
  return c;
}
export function deleteCurriculum(cid) {
  const db = read();
  db.curricula = (db.curricula || []).filter((c) => c.id !== cid);
  write(db);
}
// Total réglementaire du référentiel : somme des volumes déclarés.
// Volume annuel total. Un module saisi en hebdomadaire est converti (x semaines) ;
// `weeks` par defaut 36, a ajuster selon la modalite de la classe.
export function curriculumHours(c, weeks = 36) {
  return (c?.modules || []).reduce((a, m) =>
    a + (m.heuresSemaine != null ? m.heuresSemaine * weeks : (m.heures || 0)), 0);
}
// Total hebdomadaire d'une annee : c'est le chiffre que verifie un directeur
// (33 h en 1re annee de BTS OL, 34 en 2e).
export function curriculumWeekly(c, year) {
  return (c?.modules || [])
    .filter((m) => year == null || m.year == null || Number(m.year) === Number(year))
    .reduce((a, m) => a + (m.heuresSemaine != null ? m.heuresSemaine : 0), 0);
}

// --- Horaires d'ouverture d'un campus ---
// L'amplitude n'est pas universelle : un campus ouvre à 8 h et ferme à 18 h, un autre
// accueille des cours du soir jusqu'à 21 h et ferme le mercredi après-midi. La grille
// de génération et la vérification des créneaux s'y calent, au lieu d'un 08:00–18:00
// codé en dur qui ne correspond à personne.
const DEFAULT_HOURS = {
  lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]],
  jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]], sam: [], dim: [],
};
export function getCampusHours(cid) {
  const c = (read().campuses || []).find((x) => x.id === cid);
  return c?.openingHours && Object.keys(c.openingHours).length ? c.openingHours : { ...DEFAULT_HOURS };
}
export function setCampusHours(cid, hours) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  c.openingHours = normAvailability(hours);   // même forme que les dispos professeurs
  write(db);
  return c.openingHours;
}
// Amplitude globale (min d'ouverture, max de fermeture) : ce que la détection de
// conflits compare pour refuser un cours à 6 h du matin.
export function campusAmplitude(cid) {
  const h = getCampusHours(cid);
  const all = Object.values(h).flat().filter((r) => Array.isArray(r) && r[0] && r[1]);
  if (!all.length) return { start: "08:00", end: "18:00" };
  return { start: all.map((r) => r[0]).sort()[0], end: all.map((r) => r[1]).sort().at(-1) };
}

// --- Salles ---
// `places` et non `capacity` : `capacity` est déjà borné globalement par validateBody
// pour la fiche campus, et la confusion des deux sens serait durable.
function normRoom(r = {}) {
  return {
    id: r.id || id(), campusId: r.campusId || null, name: String(r.name || "").trim(),
    places: num(r.places), kind: String(r.kind || "standard").trim(),
    equipment: Array.isArray(r.equipment) ? r.equipment.map((e) => String(e).trim()).filter(Boolean) : [],
    createdAt: r.createdAt || now(),
  };
}
export function listRooms({ campusId } = {}) {
  let items = (read().rooms || []).slice();
  if (campusId) items = items.filter((r) => r.campusId === campusId);
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getRoom(rid) { return (read().rooms || []).find((r) => r.id === rid) || null; }
export function addRoom(data = {}) {
  const db = read();
  db.rooms = db.rooms || [];
  const r = normRoom(data);
  db.rooms.push(r);
  write(db);
  return r;
}
export function updateRoom(rid, patch = {}) {
  const db = read();
  const r = (db.rooms || []).find((x) => x.id === rid);
  if (!r) return null;
  for (const f of ["name", "kind"]) if (f in patch) r[f] = String(patch[f] || "").trim();
  if ("places" in patch) r.places = num(patch.places);
  if ("equipment" in patch) r.equipment = Array.isArray(patch.equipment) ? patch.equipment.map((e) => String(e).trim()).filter(Boolean) : [];
  write(db);
  return r;
}
export function deleteRoom(rid) {
  const db = read();
  db.rooms = (db.rooms || []).filter((r) => r.id !== rid);
  write(db);
}

// --- Classes (groupes) ---
// L'effectif n'est pas dupliqué : il vient de la filière rattachée (source de vérité
// des effectifs, cf. buildNetworkRows). `size` ne sert qu'en dérogation explicite.
function normClass(k = {}) {
  return {
    id: k.id || id(), campusId: k.campusId || null, curriculumId: k.curriculumId || null,
    filiereId: k.filiereId || null, name: String(k.name || "").trim(),
    year: num(k.year), size: num(k.size),
    // Alternance : la classe n'est à l'école qu'une partie de l'année. Le volume du
    // référentiel ne change pas, il doit tenir dans moins de semaines — d'où un
    // rythme hebdomadaire plus dense, que le générateur doit connaître.
    modalite: ["initial", "alternance", "mixte"].includes(k.modalite) ? k.modalite : "initial",
    rythme: String(k.rythme || "").trim(),          // « 2 sem. / 2 sem. », « 3j-2j »…
    weeksAtSchool: num(k.weeksAtSchool),            // vide = valeur par défaut du générateur
    createdAt: k.createdAt || now(),
  };
}
export function listClasses({ campusId } = {}) {
  let items = (read().classes || []).slice();
  if (campusId) items = items.filter((k) => k.campusId === campusId);
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getClass(kid) { return (read().classes || []).find((k) => k.id === kid) || null; }
export function addClass(data = {}) {
  const db = read();
  db.classes = db.classes || [];
  const k = normClass(data);
  db.classes.push(k);
  write(db);
  return k;
}
export function updateClass(kid, patch = {}) {
  const db = read();
  const k = (db.classes || []).find((x) => x.id === kid);
  if (!k) return null;
  if ("name" in patch) k.name = String(patch.name || "").trim();
  for (const f of ["curriculumId", "filiereId"]) if (f in patch) k[f] = patch[f] || null;
  for (const f of ["year", "size", "weeksAtSchool"]) if (f in patch) k[f] = num(patch[f]);
  if ("modalite" in patch && ["initial", "alternance", "mixte"].includes(patch.modalite)) k.modalite = patch.modalite;
  if ("rythme" in patch) k.rythme = String(patch.rythme || "").trim();
  write(db);
  return k;
}
// Supprimer une classe ne doit pas laisser des inscriptions et des évaluations
// pointer dans le vide : les inscriptions sont détachées (l'apprenant reste
// inscrit à l'établissement), les évaluations de la classe sont supprimées avec
// leurs notes.
export function deleteClass(kid) {
  const db = read();
  db.classes = (db.classes || []).filter((k) => k.id !== kid);
  for (const e of db.enrollments || []) if (e.classId === kid) e.classId = null;
  const evalIds = new Set((db.assessments || []).filter((a) => a.classId === kid).map((a) => a.id));
  db.assessments = (db.assessments || []).filter((a) => a.classId !== kid);
  db.grades = (db.grades || []).filter((g) => !evalIds.has(g.assessmentId));
  write(db);
}
// Effectif effectif : dérogation explicite, sinon la filière rattachée.
export function classSize(k) {
  if (!k) return null;
  if (k.size != null) return k.size;
  const c = (read().campuses || []).find((x) => x.id === k.campusId);
  const f = (c?.filieres || []).find((x) => x.id === k.filiereId);
  return f?.effectif ?? null;
}

// --- Proposition de référentiel importé, en attente de validation ---
// Décalque de setFinanceProposal : l'extraction IA d'un document ne s'écrit jamais
// directement. Un volume horaire inventé est un risque réglementaire, le volume
// d'un BTS étant opposable — il faut un clic humain, comme pour la finance.
// Clé = utilisateur (et non campus) : un référentiel est une donnée réseau.
export function setCurriculumProposal(userId, proposal) {
  const db = read();
  db.curriculumProposals = db.curriculumProposals || {};
  db.curriculumProposals[userId] = { ...proposal, at: proposal.at || now() };
  write(db);
  return db.curriculumProposals[userId];
}
export function getCurriculumProposal(userId) { return (read().curriculumProposals || {})[userId] || null; }
export function clearCurriculumProposal(userId) {
  const db = read();
  if (db.curriculumProposals) delete db.curriculumProposals[userId];
  write(db);
}

// --- Calendrier scolaire (vacances, fériés, examens, stages) ---
export const PERIOD_KINDS = ["vacances", "ferie", "examens", "stage", "entreprise"];
function normPeriod(p = {}) {
  return {
    id: p.id || id(), campusId: p.campusId || null,
    kind: PERIOD_KINDS.includes(p.kind) ? p.kind : "vacances",
    label: String(p.label || "").trim(),
    from: p.from || "", to: p.to || p.from || "",
    classId: p.classId || null,        // un stage ne concerne qu'une classe
    createdAt: p.createdAt || now(),
  };
}
export function listPeriods({ campusId } = {}) {
  let items = (read().periods || []).slice();
  if (campusId) items = items.filter((p) => !p.campusId || p.campusId === campusId);
  return items.sort((a, b) => (a.from || "").localeCompare(b.from || ""));
}
export function addPeriod(data = {}) {
  const db = read();
  db.periods = db.periods || [];
  const p = normPeriod(data);
  db.periods.push(p);
  write(db);
  return p;
}
export function updatePeriod(pid, patch = {}) {
  const db = read();
  const p = (db.periods || []).find((x) => x.id === pid);
  if (!p) return null;
  if ("kind" in patch && PERIOD_KINDS.includes(patch.kind)) p.kind = patch.kind;
  if ("label" in patch) p.label = String(patch.label || "").trim();
  for (const f of ["from", "to"]) if (f in patch) p[f] = patch[f] || "";
  if ("classId" in patch) p.classId = patch.classId || null;
  write(db);
  return p;
}
export function deletePeriod(pid) {
  const db = read();
  db.periods = (db.periods || []).filter((p) => p.id !== pid);
  write(db);
}

// --- Documents (GED par campus) — métadonnées ; le binaire est sur disque (chiffré) ---
export function listDocuments(cid, indicator, learnerId) {
  let d = (read().documents || []).filter((x) => !cid || x.campusId === cid);
  if (indicator != null && indicator !== "") d = d.filter((x) => String(x.indicator || "") === String(indicator));
  if (learnerId) d = d.filter((x) => x.learnerId === learnerId);
  return d.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function getDocument(docId) { return (read().documents || []).find((d) => d.id === docId) || null; }
export function addDocument({ campusId, campusName, name, size, mime, category, file, indicator, learnerId }) {
  const db = read();
  db.documents = db.documents || [];
  const doc = {
    id: id(), campusId: campusId || null, campusName: campusName || null,
    name: String(name || "document").trim(), size: size || 0, mime: mime || "application/octet-stream",
    category: (category || "autre").trim(), indicator: indicator ? String(indicator).trim() : null,
    learnerId: learnerId || null,
    file: file || null, createdAt: now(),
  };
  db.documents.push(doc);
  write(db);
  return doc;
}
export function deleteDocument(docId) {
  const db = read();
  const doc = (db.documents || []).find((d) => d.id === docId);
  db.documents = (db.documents || []).filter((d) => d.id !== docId);
  write(db);
  return doc || null;
}

// --- Entreprises partenaires & alternance ---
// Champs employeur : les premiers servent la relation, les suivants sont exigés
// par le Cerfa d'alternance (SIRET, NAF, convention collective, adresse).
const PARTNER_FIELDS = ["name", "sector", "contactName", "contactEmail", "contactPhone", "status", "notes",
  "siret", "naf", "formeJuridique", "conventionCollective", "adresse", "codePostal", "ville", "effectif"];
export function listPartners(cid) {
  const p = (read().partners || []).filter((x) => !cid || x.campusId === cid);
  return p.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function addPartner(data = {}) {
  const db = read();
  db.partners = db.partners || [];
  const p = { id: id(), campusId: data.campusId || null, campusName: data.campusName || null, alternants: data.alternants ? Number(data.alternants) : 0, createdAt: now() };
  for (const f of PARTNER_FIELDS) p[f] = String(data[f] || "").trim();
  if (!["actif", "prospect", "inactif"].includes(p.status)) p.status = "actif";
  db.partners.push(p);
  write(db);
  return p;
}
export function updatePartner(pid, patch = {}) {
  const db = read();
  const p = (db.partners || []).find((x) => x.id === pid);
  if (!p) return null;
  for (const f of PARTNER_FIELDS) if (f in patch) p[f] = String(patch[f] || "").trim();
  if ("alternants" in patch) p.alternants = patch.alternants ? Number(patch.alternants) : 0;
  write(db);
  return p;
}
export function deletePartner(pid) {
  const db = read();
  db.partners = (db.partners || []).filter((p) => p.id !== pid);
  write(db);
}

// --- Objectifs réseau (OKR en cascade réseau → campus) ---
export function listNetworkObjectives() { return read().networkObjectives || []; }
export function setNetworkObjectives(list) {
  const db = read();
  db.networkObjectives = (Array.isArray(list) ? list : []).filter((o) => o && o.titre).map((o) => ({
    id: o.id || id(),
    titre: String(o.titre).trim(), cible: String(o.cible || "").trim(), echeance: String(o.echeance || "").trim(),
    resultats: (Array.isArray(o.resultats) ? o.resultats : []).filter((r) => r && r.libelle).map((r) => ({
      id: r.id || id(), libelle: String(r.libelle).trim(), campusId: r.campusId || null,
      cible: String(r.cible || "").trim(), avancement: r.avancement == null || r.avancement === "" ? null : Number(r.avancement),
    })),
  }));
  write(db);
  return db.networkObjectives;
}

// --- Scénarios de prospective (EBIT) ---
export function listScenarios() {
  return (read().scenarios || []).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function addScenario({ name, target, rows }) {
  const db = read();
  db.scenarios = db.scenarios || [];
  const s = {
    id: id(), name: String(name || "Scénario").trim(), target: Number(target) || 0,
    rows: (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, name: String(r.name || ""), rev: Number(r.rev) || 0, pay: Number(r.pay) || 0, chg: Number(r.chg) || 0 })),
    createdAt: now(),
  };
  db.scenarios.push(s);
  if (db.scenarios.length > 50) db.scenarios = db.scenarios.slice(-50);
  write(db);
  return s;
}
export function deleteScenario(sid) {
  const db = read();
  db.scenarios = (db.scenarios || []).filter((s) => s.id !== sid);
  write(db);
}

// --- Ouvertures de campus (rétroplanning) ---
const OPENING_FIELDS = ["name", "city", "region", "address", "notes"];
const OPENING_STATUS = ["etude", "preparation", "travaux", "lancement", "ouvert", "abandonne"];
export function listOpenings() {
  return (read().openings || []).slice().sort((a, b) => (a.targetDate || "9999").localeCompare(b.targetDate || "9999"));
}
export function getOpening(oid) { return (read().openings || []).find((o) => o.id === oid) || null; }
export function addOpening(data = {}) {
  const db = read();
  db.openings = db.openings || [];
  const o = { id: id(), status: OPENING_STATUS.includes(data.status) ? data.status : "etude", tasks: [], budgetLines: [], campusId: null, budget: data.budget ? Number(data.budget) : null, targetDate: data.targetDate || "", createdAt: now() };
  for (const f of OPENING_FIELDS) o[f] = String(data[f] || "").trim();
  db.openings.push(o);
  write(db);
  return o;
}
function normBudgetLine(l) {
  return { id: l.id || id(), lot: l.lot || "autre", label: String(l.label || "").trim(), planned: Number(l.planned) || 0, committed: Number(l.committed) || 0, spent: Number(l.spent) || 0 };
}
export function setOpeningBudget(oid, lines) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  o.budgetLines = (Array.isArray(lines) ? lines : []).filter((l) => l && (l.label || l.planned || l.committed || l.spent)).map(normBudgetLine);
  write(db);
  return o.budgetLines;
}
export function setOpeningCampus(oid, campusId) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  o.campusId = campusId;
  write(db);
  return o;
}
export function updateOpening(oid, patch = {}) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  for (const f of OPENING_FIELDS) if (f in patch) o[f] = String(patch[f] || "").trim();
  if ("status" in patch && OPENING_STATUS.includes(patch.status)) o.status = patch.status;
  if ("targetDate" in patch) o.targetDate = patch.targetDate || "";
  if ("budget" in patch) o.budget = patch.budget ? Number(patch.budget) : null;
  write(db);
  return o;
}
export function deleteOpening(oid) {
  const db = read();
  db.openings = (db.openings || []).filter((o) => o.id !== oid);
  write(db);
}
// Livrable attendu d'une action. Nommé `outputs` et NON `deliverables` : la collection
// racine `deliverables` désigne déjà l'historique des livrables IA de l'atelier.
// `documentId` pointe vers la GED (store.addDocument) quand le fichier a été déposé ;
// le suivi fonctionne sans fichier, l'attendu se déclare avant d'exister.
export const OUTPUT_STATUS = ["todo", "produced", "validated"];
function normOutput(o = {}) {
  return {
    id: o.id || id(), label: String(o.label || "").trim(),
    status: OUTPUT_STATUS.includes(o.status) ? o.status : "todo",
    owner: String(o.owner || "").trim(), dueDate: o.dueDate || "",
    documentId: o.documentId || null,
  };
}
function normComment(c = {}) {
  return { id: c.id || id(), at: c.at || now(), by: String(c.by || "").trim(), text: String(c.text || "").trim() };
}
// Étape d'une action : la checklist du « comment », là où le livrable est le « quoi ».
function normStep(s = {}) {
  return { id: s.id || id(), text: String(s.text || "").trim(), done: !!s.done };
}
// Dès qu'une action a des étapes, son avancement en découle : le saisir à la main en
// parallèle produirait deux vérités divergentes. Sans étape, il reste saisi librement.
function syncProgress(t) {
  if (!t.steps || !t.steps.length) return t;
  t.progress = Math.round((t.steps.filter((s) => s.done).length / t.steps.length) * 100);
  return t;
}

// ATTENTION : normTask est réappliqué à TOUTES les tâches par setOpeningTasks. Tout champ
// absent d'ici est effacé en silence — c'est pourquoi les sous-tableaux sont explicitement
// repris, et pourquoi la liste blanche d'updateOpeningTask doit rester alignée.
function normTask(t) {
  return {
    id: t.id || id(), lot: t.lot || "autre", title: String(t.title || "").trim(), owner: String(t.owner || "").trim(),
    dueDate: t.dueDate || "", offset: t.offset == null ? null : Number(t.offset),
    status: ["todo", "doing", "done", "blocked"].includes(t.status) ? t.status : "todo",
    critical: !!t.critical, notes: String(t.notes || "").trim(),
    // Fiche détaillée : contexte, RACI (mêmes noms que store.addAction), origine en comité.
    description: String(t.description || "").trim(),
    accountable: String(t.accountable || "").trim(),
    consulted: String(t.consulted || "").trim(),
    informed: String(t.informed || "").trim(),
    committeeId: t.committeeId || null, sessionId: t.sessionId || null,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(Boolean) : [],
    progress: t.progress == null ? null : Math.max(0, Math.min(100, Number(t.progress) || 0)),
    outputs: Array.isArray(t.outputs) ? t.outputs.map(normOutput) : [],
    comments: Array.isArray(t.comments) ? t.comments.map(normComment) : [],
    steps: Array.isArray(t.steps) ? t.steps.map(normStep) : [],
  };
}
export function setOpeningTasks(oid, tasks) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  o.tasks = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.title).map(normTask);
  write(db);
  return o.tasks;
}
export function addOpeningTask(oid, t) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  o.tasks = o.tasks || [];
  const task = normTask(t);
  o.tasks.push(task);
  write(db);
  return task;
}
export function updateOpeningTask(oid, tid, patch = {}) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return null;
  const t = (o.tasks || []).find((x) => x.id === tid);
  if (!t) return null;
  for (const f of ["lot", "title", "owner", "dueDate", "status", "notes",
                   "description", "accountable", "consulted", "informed"]) {
    if (f in patch) t[f] = typeof patch[f] === "string" ? patch[f].trim() : patch[f];
  }
  if ("critical" in patch) t.critical = !!patch.critical;
  // L'avancement saisi n'est retenu que si l'action n'a pas d'étapes : sinon il est
  // dérivé de la checklist, et accepter les deux ferait diverger l'affichage du réel.
  if ("progress" in patch && !(t.steps || []).length) {
    t.progress = patch.progress == null || patch.progress === "" ? null : Math.max(0, Math.min(100, Number(patch.progress) || 0));
  }
  syncProgress(t);
  if ("dependsOn" in patch) t.dependsOn = Array.isArray(patch.dependsOn) ? patch.dependsOn.filter(Boolean) : [];
  if ("committeeId" in patch) t.committeeId = patch.committeeId || null;
  if ("sessionId" in patch) t.sessionId = patch.sessionId || null;
  write(db);
  return t;
}
export function deleteOpeningTask(oid, tid) {
  const db = read();
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return;
  o.tasks = (o.tasks || []).filter((t) => t.id !== tid);
  write(db);
}

// --- Livrables attendus et échanges, portés par une action d'ouverture ---
function findTask(db, oid, tid) {
  const o = (db.openings || []).find((x) => x.id === oid);
  if (!o) return [null, null];
  return [o, (o.tasks || []).find((t) => t.id === tid) || null];
}
export function addTaskOutput(oid, tid, data = {}) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return null;
  t.outputs = t.outputs || [];
  const out = normOutput(data);
  t.outputs.push(out);
  write(db);
  return out;
}
export function updateTaskOutput(oid, tid, outId, patch = {}) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return null;
  const out = (t.outputs || []).find((x) => x.id === outId);
  if (!out) return null;
  for (const f of ["label", "owner"]) if (f in patch) out[f] = String(patch[f] || "").trim();
  if ("dueDate" in patch) out.dueDate = patch.dueDate || "";
  if ("status" in patch && OUTPUT_STATUS.includes(patch.status)) out.status = patch.status;
  if ("documentId" in patch) out.documentId = patch.documentId || null;
  write(db);
  return out;
}
export function deleteTaskOutput(oid, tid, outId) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return;
  t.outputs = (t.outputs || []).filter((x) => x.id !== outId);
  write(db);
}
export function addTaskStep(oid, tid, data = {}) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return null;
  t.steps = t.steps || [];
  const s = normStep(data);
  t.steps.push(s);
  syncProgress(t);
  write(db);
  return s;
}
export function updateTaskStep(oid, tid, sid, patch = {}) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return null;
  const s = (t.steps || []).find((x) => x.id === sid);
  if (!s) return null;
  if ("text" in patch) s.text = String(patch.text || "").trim();
  if ("done" in patch) s.done = !!patch.done;
  syncProgress(t);
  write(db);
  return s;
}
export function deleteTaskStep(oid, tid, sid) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return;
  t.steps = (t.steps || []).filter((s) => s.id !== sid);
  syncProgress(t);
  write(db);
}
export function addTaskComment(oid, tid, { by, text }) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return null;
  t.comments = t.comments || [];
  const c = normComment({ by, text });
  t.comments.push(c);
  write(db);
  return c;
}
export function deleteTaskComment(oid, tid, cid) {
  const db = read();
  const [, t] = findTask(db, oid, tid);
  if (!t) return;
  t.comments = (t.comments || []).filter((c) => c.id !== cid);
  write(db);
}

// --- Comités de pilotage (générique : ouverture, campus ou réseau) ---
// Un comité est l'instance qui décide ; ses séances portent l'ordre du jour, les présents,
// le compte rendu et les décisions. Rattachable à une ouverture (scope "opening"), à un
// campus ("campus") ou au réseau ("network") — le même objet sert les trois.
export const COMMITTEE_SCOPES = ["opening", "campus", "network"];
export const SESSION_STATUS = ["planned", "held"];

function normMember(m = {}) {
  return {
    id: m.id || id(), name: String(m.name || "").trim(), role: String(m.role || "").trim(),
    email: String(m.email || "").trim(),
    // Rattachement facultatif à un compte applicatif : le membre qui en a un retrouve
    // ses actions dans l'app ; les autres restent de simples participants nommés.
    userId: m.userId || null,
  };
}
function normAgendaItem(a = {}) {
  return { id: a.id || id(), text: String(a.text || "").trim(), owner: String(a.owner || "").trim() };
}
function normResolution(r = {}) {
  return { id: r.id || id(), text: String(r.text || "").trim(), owner: String(r.owner || "").trim(), dueDate: r.dueDate || "" };
}
function normSession(s = {}) {
  return {
    id: s.id || id(), date: s.date || "",
    status: SESSION_STATUS.includes(s.status) ? s.status : "planned",
    agendaItems: Array.isArray(s.agendaItems) ? s.agendaItems.map(normAgendaItem) : [],
    presentIds: Array.isArray(s.presentIds) ? s.presentIds.filter(Boolean) : [],
    excusedIds: Array.isArray(s.excusedIds) ? s.excusedIds.filter(Boolean) : [],
    minutes: String(s.minutes || ""),
    resolutions: Array.isArray(s.resolutions) ? s.resolutions.map(normResolution) : [],
    taskIds: Array.isArray(s.taskIds) ? s.taskIds.filter(Boolean) : [],
    createdAt: s.createdAt || now(),
  };
}

export function listCommittees({ scope, scopeId } = {}) {
  let items = (read().committees || []).slice();
  if (scope) items = items.filter((c) => c.scope === scope);
  if (scopeId !== undefined) items = items.filter((c) => (c.scopeId || null) === (scopeId || null));
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export function getCommittee(cid) { return (read().committees || []).find((c) => c.id === cid) || null; }
export function addCommittee(data = {}) {
  const db = read();
  db.committees = db.committees || [];
  const c = {
    id: id(),
    scope: COMMITTEE_SCOPES.includes(data.scope) ? data.scope : "opening",
    scopeId: data.scopeId || null,
    name: String(data.name || "Comité de pilotage").trim(),
    cadence: String(data.cadence || "").trim(),
    members: Array.isArray(data.members) ? data.members.map(normMember) : [],
    sessions: [], createdAt: now(),
  };
  db.committees.push(c);
  write(db);
  return c;
}
export function updateCommittee(cid, patch = {}) {
  const db = read();
  const c = (db.committees || []).find((x) => x.id === cid);
  if (!c) return null;
  for (const f of ["name", "cadence"]) if (f in patch) c[f] = String(patch[f] || "").trim();
  if ("members" in patch) c.members = Array.isArray(patch.members) ? patch.members.map(normMember) : [];
  write(db);
  return c;
}
export function deleteCommittee(cid) {
  const db = read();
  db.committees = (db.committees || []).filter((c) => c.id !== cid);
  write(db);
}
export function addSession(cid, data = {}) {
  const db = read();
  const c = (db.committees || []).find((x) => x.id === cid);
  if (!c) return null;
  c.sessions = c.sessions || [];
  const s = normSession(data);
  c.sessions.push(s);
  write(db);
  return s;
}
export function updateSession(cid, sid, patch = {}) {
  const db = read();
  const c = (db.committees || []).find((x) => x.id === cid);
  if (!c) return null;
  const s = (c.sessions || []).find((x) => x.id === sid);
  if (!s) return null;
  if ("date" in patch) s.date = patch.date || "";
  if ("status" in patch && SESSION_STATUS.includes(patch.status)) s.status = patch.status;
  if ("minutes" in patch) s.minutes = String(patch.minutes || "");
  for (const [f, norm] of [["agendaItems", normAgendaItem], ["resolutions", normResolution]]) {
    if (f in patch) s[f] = Array.isArray(patch[f]) ? patch[f].map(norm) : [];
  }
  for (const f of ["presentIds", "excusedIds"]) {
    if (f in patch) s[f] = Array.isArray(patch[f]) ? patch[f].filter(Boolean) : [];
  }
  write(db);
  return s;
}
export function deleteSession(cid, sid) {
  const db = read();
  const c = (db.committees || []).find((x) => x.id === cid);
  if (!c) return;
  c.sessions = (c.sessions || []).filter((s) => s.id !== sid);
  write(db);
}
// Trace qu'une action est née d'une séance (sans dupliquer l'action elle-même).
export function linkSessionTask(cid, sid, taskId) {
  const db = read();
  const c = (db.committees || []).find((x) => x.id === cid);
  if (!c) return null;
  const s = (c.sessions || []).find((x) => x.id === sid);
  if (!s) return null;
  s.taskIds = s.taskIds || [];
  if (!s.taskIds.includes(taskId)) s.taskIds.push(taskId);
  write(db);
  return s;
}

// --- Expéditeurs email prioritaires (pilotent le tri du brief) ---
export function listPrioritySenders() {
  return (read().emailPriority || []).slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
export function addPrioritySender({ email, name, note }) {
  const db = read();
  db.emailPriority = db.emailPriority || [];
  const e = String(email || "").trim().toLowerCase();
  if (!e) return db.emailPriority;
  if (db.emailPriority.some((x) => x.email === e)) return db.emailPriority;
  db.emailPriority.push({ id: id(), email: e, name: String(name || "").trim(), note: String(note || "").trim(), createdAt: now() });
  write(db);
  return db.emailPriority;
}
export function deletePrioritySender(pid) {
  const db = read();
  db.emailPriority = (db.emailPriority || []).filter((x) => x.id !== pid);
  write(db);
}
// Expéditeurs à faible priorité / à ignorer (newsletters, notifs auto)
export function listMutedSenders() {
  return (read().emailMuted || []).slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
export function addMutedSender({ email, name, note }) {
  const db = read();
  db.emailMuted = db.emailMuted || [];
  const e = String(email || "").trim().toLowerCase();
  if (!e) return db.emailMuted;
  if (db.emailMuted.some((x) => x.email === e)) return db.emailMuted;
  db.emailMuted.push({ id: id(), email: e, name: String(name || "").trim(), note: String(note || "").trim(), createdAt: now() });
  write(db);
  return db.emailMuted;
}
export function deleteMutedSender(pid) {
  const db = read();
  db.emailMuted = (db.emailMuted || []).filter((x) => x.id !== pid);
  write(db);
}

// --- Registre de décisions (CODIR) ---
const DECISION_STATUS = ["open", "done", "dropped"];
export function listDecisions() {
  return (read().decisions || []).slice().sort((a, b) => (b.decidedAt || b.createdAt || "").localeCompare(a.decidedAt || a.createdAt || ""));
}
export function addDecision(d = {}) {
  const db = read(); db.decisions = db.decisions || [];
  const o = { id: id(), title: String(d.title || "").trim(), description: String(d.description || "").trim(), owner: String(d.owner || "").trim(), decidedAt: d.decidedAt || now().slice(0, 10), dueDate: d.dueDate || "", status: DECISION_STATUS.includes(d.status) ? d.status : "open", campusId: d.campusId || null, campusName: d.campusName || null, createdAt: now() };
  db.decisions.push(o); write(db); return o;
}
export function updateDecision(did, patch = {}) {
  const db = read(); const o = (db.decisions || []).find((x) => x.id === did); if (!o) return null;
  for (const f of ["title", "description", "owner", "decidedAt", "dueDate", "status", "campusId", "campusName"]) if (f in patch) o[f] = typeof patch[f] === "string" ? patch[f].trim() : patch[f];
  write(db); return o;
}
export function deleteDecision(did) { const db = read(); db.decisions = (db.decisions || []).filter((x) => x.id !== did); write(db); }

// --- Revues mensuelles par campus ---
export function listReviews(cid) {
  const r = (read().reviews || []).filter((x) => !cid || x.campusId === cid);
  return r.sort((a, b) => (b.month || b.createdAt || "").localeCompare(a.month || a.createdAt || ""));
}
export function addReview(d = {}) {
  const db = read(); db.reviews = db.reviews || [];
  const o = { id: id(), campusId: d.campusId || null, campusName: d.campusName || null, month: d.month || now().slice(0, 7), notes: String(d.notes || "").trim(), snapshot: d.snapshot || null, createdAt: now() };
  db.reviews.push(o); write(db); return o;
}
export function deleteReview(rid) { const db = read(); db.reviews = (db.reviews || []).filter((x) => x.id !== rid); write(db); }
export function lastReviewByCampus() {
  const m = {};
  for (const r of read().reviews || []) { if (!m[r.campusId] || (r.month || "") > (m[r.campusId].month || "")) m[r.campusId] = r; }
  return m;
}

// --- JPO & événements de recrutement ---
const EVENT_FIELDS = ["title", "type", "note", "status"];
export function listEvents(cid) {
  const e = (read().events || []).filter((x) => !cid || x.campusId === cid);
  return e.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}
export function addEvent(d = {}) {
  const db = read(); db.events = db.events || [];
  const o = { id: id(), campusId: d.campusId || null, campusName: d.campusName || null, date: d.date || "", target: d.target ? Number(d.target) : null, attendees: d.attendees ? Number(d.attendees) : null, leads: d.leads ? Number(d.leads) : null, inscrits: d.inscrits ? Number(d.inscrits) : null, createdAt: now() };
  for (const f of EVENT_FIELDS) o[f] = String(d[f] || "").trim();
  if (!["jpo", "salon", "immersion", "webinaire", "autre"].includes(o.type)) o.type = "jpo";
  if (!["prevu", "realise", "annule"].includes(o.status)) o.status = "prevu";
  db.events.push(o); write(db); return o;
}
export function updateEvent(eid, patch = {}) {
  const db = read(); const o = (db.events || []).find((x) => x.id === eid); if (!o) return null;
  for (const f of [...EVENT_FIELDS, "date"]) if (f in patch) o[f] = String(patch[f] || "").trim();
  for (const f of ["target", "attendees", "leads", "inscrits"]) if (f in patch) o[f] = patch[f] === "" || patch[f] == null ? null : Number(patch[f]);
  write(db); return o;
}
export function deleteEvent(eid) { const db = read(); db.events = (db.events || []).filter((x) => x.id !== eid); write(db); }

// --- Plans de redressement campus (30/60/90 jours) ---
const HORIZON_KEYS = ["h30", "h60", "h90"];
function cleanHorizon(list) {
  return (Array.isArray(list) ? list : []).filter((it) => it && String(it.text || "").trim()).map((it) => ({ text: String(it.text).trim(), owner: String(it.owner || "").trim(), done: !!it.done }));
}
export function listRecoveries(cid) {
  const r = (read().recoveries || []).filter((x) => !cid || x.campusId === cid);
  return r.sort((a, b) => (a.status === b.status ? (b.createdAt || "").localeCompare(a.createdAt || "") : a.status === "active" ? -1 : 1));
}
export function addRecovery(d = {}) {
  const db = read(); db.recoveries = db.recoveries || [];
  const o = { id: id(), campusId: d.campusId || null, campusName: d.campusName || null, status: "active", diagnostic: String(d.diagnostic || "").trim(), h30: cleanHorizon(d.h30), h60: cleanHorizon(d.h60), h90: cleanHorizon(d.h90), exitCriteria: String(d.exitCriteria || "").trim(), createdAt: now(), closedAt: null };
  db.recoveries.push(o); write(db); return o;
}
export function updateRecovery(rid, patch = {}) {
  const db = read(); const o = (db.recoveries || []).find((x) => x.id === rid); if (!o) return null;
  if ("diagnostic" in patch) o.diagnostic = String(patch.diagnostic || "").trim();
  if ("exitCriteria" in patch) o.exitCriteria = String(patch.exitCriteria || "").trim();
  if ("status" in patch && ["active", "closed"].includes(patch.status)) { o.status = patch.status; o.closedAt = patch.status === "closed" ? now() : null; }
  for (const h of HORIZON_KEYS) if (h in patch) o[h] = cleanHorizon(patch[h]);
  write(db); return o;
}
export function deleteRecovery(rid) { const db = read(); db.recoveries = (db.recoveries || []).filter((x) => x.id !== rid); write(db); }

// --- Arbitrages CODIR (fiches de décision structurées) ---
const ARB_STATUS = ["toprepare", "pending", "decided", "executed"];
const ARB_TEXT = ["title", "context", "problem", "options", "recommendation", "impactFin", "impactOp", "riskNoDecision", "decision", "owner", "campusName"];
export function listArbitrages() {
  const order = { toprepare: 0, pending: 1, decided: 2, executed: 3 };
  return (read().arbitrages || []).slice().sort((a, b) => (order[a.status] - order[b.status]) || (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function addArbitrage(d = {}) {
  const db = read(); db.arbitrages = db.arbitrages || [];
  const o = { id: id(), status: ARB_STATUS.includes(d.status) ? d.status : "toprepare", campusId: d.campusId || null, dueDate: d.dueDate || "", createdAt: now(), decidedAt: null };
  for (const f of ARB_TEXT) o[f] = String(d[f] || "").trim();
  db.arbitrages.push(o); write(db); return o;
}
export function updateArbitrage(aid, patch = {}) {
  const db = read(); const o = (db.arbitrages || []).find((x) => x.id === aid); if (!o) return null;
  for (const f of ARB_TEXT) if (f in patch) o[f] = String(patch[f] || "").trim();
  if ("campusId" in patch) o.campusId = patch.campusId || null;
  if ("dueDate" in patch) o.dueDate = patch.dueDate || "";
  if ("status" in patch && ARB_STATUS.includes(patch.status)) { o.status = patch.status; if (patch.status === "decided" && !o.decidedAt) o.decidedAt = now(); }
  write(db); return o;
}
export function deleteArbitrage(aid) { const db = read(); db.arbitrages = (db.arbitrages || []).filter((x) => x.id !== aid); write(db); }

// --- Paramètres (seuils d'alerte, board pack) ---
export function getSettings() { return read().settings || {}; }
export function updateSettings(patch = {}) { const db = read(); db.settings = { ...(db.settings || {}), ...patch }; write(db); return db.settings; }

// --- Journal d'audit (traçabilité mutations) ---
export function addAudit({ userId, userName, action, target, detail }) {
  const db = read();
  db.audit = db.audit || [];
  db.audit.push({ id: id(), userId: userId || null, userName: userName || "", action: action || "", target: target || "", detail: detail || "", at: now() });
  if (db.audit.length > 2000) db.audit = db.audit.slice(-2000);
  write(db);
}
export function listAudit(limit = 300) {
  const a = read().audit || [];
  return a.slice(-limit).reverse();
}
// Purge RGPD : supprime les entrées du journal d'audit antérieures à la date ISO donnée.
export function purgeAuditBefore(isoCutoff) {
  const db = read();
  const before = (db.audit || []).length;
  db.audit = (db.audit || []).filter((a) => (a.at || "") >= isoCutoff);
  const removed = before - db.audit.length;
  if (removed) write(db);
  return removed;
}

// ---------- Apprenants & inscriptions (ERP Bloc 1) ----------
// Le dossier apprenant est la colonne vertébrale de l'ERP : l'inscription le relie
// aux classes du module planning (une classe = une promotion/année), les documents
// de la GED peuvent lui être rattachés (learnerId), et la timeline agrège le tout.

export const ENROLLMENT_STATUSES = ["inscrit", "sorti", "diplome", "rupture", "abandon"];

function normLearner(l = {}) {
  const s = (v) => String(v || "").trim();
  return {
    id: l.id || id(), campusId: l.campusId || null,
    civilite: ["M.", "Mme", "Autre"].includes(l.civilite) ? l.civilite : "",
    nom: s(l.nom), prenom: s(l.prenom),
    dateNaissance: isoDate(l.dateNaissance), lieuNaissance: s(l.lieuNaissance),
    ine: s(l.ine).toUpperCase(), email: s(l.email), telephone: s(l.telephone),
    adresse: s(l.adresse),
    // RQTH → obligations d'accompagnement (référent handicap, Qualiopi ind. 26)
    rqth: !!l.rqth,
    repLegalNom: s(l.repLegalNom), repLegalTel: s(l.repLegalTel), repLegalEmail: s(l.repLegalEmail),
    notes: s(l.notes),
    createdAt: l.createdAt || now(), updatedAt: now(),
  };
}

export function listLearners({ campusId, q } = {}) {
  let items = (read().learners || []).slice();
  if (campusId) items = items.filter((l) => l.campusId === campusId);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter((l) => [l.nom, l.prenom, l.ine, l.email].some((v) => (v || "").toLowerCase().includes(needle)));
  }
  return items.sort((a, b) => (a.nom || "").localeCompare(b.nom || "") || (a.prenom || "").localeCompare(b.prenom || ""));
}
export function getLearner(lid) { return (read().learners || []).find((l) => l.id === lid) || null; }
export function addLearner(data = {}) {
  const db = read();
  db.learners = db.learners || [];
  const l = normLearner(data);
  db.learners.push(l);
  write(db);
  return l;
}
export function updateLearner(lid, patch = {}) {
  const db = read();
  const l = (db.learners || []).find((x) => x.id === lid);
  if (!l) return null;
  const upd = normLearner({ ...l, ...patch, id: l.id, campusId: patch.campusId || l.campusId, createdAt: l.createdAt });
  Object.assign(l, upd);
  write(db);
  return l;
}
// Droit à l'effacement (RGPD art. 17) — suppression RÉELLE, en cascade.
//
// Ce qui est supprimé : le dossier, ses inscriptions, ses notes, ses contrats, sa
// candidature d'origine, ses accès portail, et ses documents personnels (fichiers
// chiffrés compris). Les images de signature manuscrite sont supprimées par
// l'appelant (voir server.js, qui a accès au stockage des feuilles).
//
// Ce qui SUBSISTE, et pourquoi : les lignes d'émargement des feuilles déjà closes.
// Elles sont scellées par empreinte chaînée et constituent la preuve de réalisation
// de l'action de formation, que l'établissement doit conserver (art. 17.3.b : le
// droit à l'effacement cède devant une obligation légale de conservation). Elles ne
// contiennent qu'un identifiant technique, plus aucun nom une fois le dossier
// supprimé. Elles disparaîtront à l'échéance de conservation des feuilles.
//
// `documentIds` est renvoyé pour que l'appelant supprime les fichiers sur disque.
export function deleteLearner(lid) {
  const db = read();
  const learner = (db.learners || []).find((l) => l.id === lid);
  const documentIds = (db.documents || []).filter((d) => d.learnerId === lid).map((d) => ({ id: d.id, file: d.file }));
  const contractIds = (db.contracts || []).filter((c) => c.learnerId === lid).map((c) => c.id);

  db.learners = (db.learners || []).filter((l) => l.id !== lid);
  db.enrollments = (db.enrollments || []).filter((e) => e.learnerId !== lid);
  db.grades = (db.grades || []).filter((g) => g.learnerId !== lid);
  db.contracts = (db.contracts || []).filter((c) => c.learnerId !== lid);
  db.candidates = (db.candidates || []).filter((c) => c.learnerId !== lid);
  db.portalAccess = (db.portalAccess || []).filter((a) => !(a.kind === "learner" && a.subjectId === lid));
  db.documents = (db.documents || []).filter((d) => d.learnerId !== lid);
  write(db);
  return { documentIds, contractIds, name: learner ? `${learner.prenom} ${learner.nom}` : null };
}

function normEnrollment(e = {}) {
  const s = (v) => String(v || "").trim();
  return {
    id: e.id || id(), learnerId: e.learnerId, campusId: e.campusId || null,
    classId: e.classId || null, schoolYear: s(e.schoolYear),
    statut: ENROLLMENT_STATUSES.includes(e.statut) ? e.statut : "inscrit",
    dateDebut: s(e.dateDebut), dateSortie: s(e.dateSortie), motifSortie: s(e.motifSortie),
    createdAt: e.createdAt || now(), updatedAt: now(),
  };
}

export function listEnrollments({ learnerId, classId, campusId, statut } = {}) {
  let items = (read().enrollments || []).slice();
  if (learnerId) items = items.filter((e) => e.learnerId === learnerId);
  if (classId) items = items.filter((e) => e.classId === classId);
  if (campusId) items = items.filter((e) => e.campusId === campusId);
  if (statut) items = items.filter((e) => e.statut === statut);
  return items.sort((a, b) => (b.schoolYear || "").localeCompare(a.schoolYear || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function addEnrollment(data = {}) {
  const db = read();
  const learner = (db.learners || []).find((l) => l.id === data.learnerId);
  if (!learner) return null;
  db.enrollments = db.enrollments || [];
  // Une seule inscription active par apprenant et par année scolaire.
  const dup = db.enrollments.find((e) => e.learnerId === data.learnerId && e.schoolYear === String(data.schoolYear || "").trim() && e.statut === "inscrit");
  if (dup && (data.statut || "inscrit") === "inscrit") return { error: "déjà inscrit sur cette année scolaire" };
  const e = normEnrollment({ ...data, campusId: data.campusId || learner.campusId });
  db.enrollments.push(e);
  write(db);
  return e;
}
export function updateEnrollment(eid, patch = {}) {
  const db = read();
  const e = (db.enrollments || []).find((x) => x.id === eid);
  if (!e) return null;
  Object.assign(e, normEnrollment({ ...e, ...patch, id: e.id, learnerId: e.learnerId, campusId: e.campusId, createdAt: e.createdAt }));
  write(db);
  return e;
}
export function deleteEnrollment(eid) {
  const db = read();
  db.enrollments = (db.enrollments || []).filter((e) => e.id !== eid);
  write(db);
}

// Timeline du dossier : tout événement daté, du plus récent au plus ancien.
export function learnerTimeline(lid) {
  const db = read();
  const events = [];
  for (const e of (db.enrollments || []).filter((x) => x.learnerId === lid)) {
    const k = (db.classes || []).find((c) => c.id === e.classId);
    events.push({ type: "inscription", date: e.dateDebut || e.createdAt.slice(0, 10), label: `Inscription ${e.schoolYear}${k ? " — " + k.name : ""}`, statut: e.statut });
    if (e.dateSortie) events.push({ type: e.statut, date: e.dateSortie, label: `${e.statut === "diplome" ? "Diplômé" : e.statut === "rupture" ? "Rupture" : e.statut === "abandon" ? "Abandon" : "Sortie"}${e.motifSortie ? " — " + e.motifSortie : ""}`, statut: e.statut });
  }
  for (const d of (db.documents || []).filter((x) => x.learnerId === lid)) {
    events.push({ type: "document", date: (d.createdAt || "").slice(0, 10), label: `Document : ${d.name}`, documentId: d.id });
  }
  return events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// ---------- Candidatures (funnel admissions, ERP M4) ----------
// Le funnel individuel : saisie manuelle ou synchronisation Salesforce (sfId =
// identifiant externe, un upsert par lead). La conversion « admis → inscrit »
// crée le dossier apprenant sans re-saisie et lie les deux (learnerId).

export const CANDIDATE_STAGES = ["nouveau", "contacte", "entretien", "admis", "inscrit", "refuse", "perdu"];

function normCandidate(c = {}) {
  const s = (v) => String(v || "").trim();
  return {
    id: c.id || id(), campusId: c.campusId || null,
    nom: s(c.nom), prenom: s(c.prenom), email: s(c.email), telephone: s(c.telephone),
    formationSouhaitee: s(c.formationSouhaitee),
    stage: CANDIDATE_STAGES.includes(c.stage) ? c.stage : "nouveau",
    source: c.source === "salesforce" ? "salesforce" : "manuel",
    sfId: c.sfId || null, sfStatut: s(c.sfStatut),
    learnerId: c.learnerId || null, notes: s(c.notes),
    createdAt: c.createdAt || now(), updatedAt: now(),
  };
}

export function listCandidates({ campusId, stage, q } = {}) {
  let items = (read().candidates || []).slice();
  if (campusId) items = items.filter((c) => c.campusId === campusId);
  if (stage) items = items.filter((c) => c.stage === stage);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter((c) => [c.nom, c.prenom, c.email, c.formationSouhaitee].some((v) => (v || "").toLowerCase().includes(needle)));
  }
  return items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
export function getCandidate(cid) { return (read().candidates || []).find((c) => c.id === cid) || null; }
export function addCandidate(data = {}) {
  const db = read();
  db.candidates = db.candidates || [];
  const c = normCandidate(data);
  db.candidates.push(c);
  write(db);
  return c;
}
export function updateCandidate(cid, patch = {}) {
  const db = read();
  const c = (db.candidates || []).find((x) => x.id === cid);
  if (!c) return null;
  Object.assign(c, normCandidate({ ...c, ...patch, id: c.id, source: patch.source || c.source, createdAt: c.createdAt }));
  write(db);
  return c;
}
export function deleteCandidate(cid) {
  const db = read();
  db.candidates = (db.candidates || []).filter((c) => c.id !== cid);
  write(db);
}

// Upsert depuis Salesforce (clé sfId). Un candidat déjà converti (learnerId posé)
// n'est jamais rétrogradé par le CRM : le dossier local fait foi après conversion.
export function upsertCandidateFromSf(row) {
  const db = read();
  db.candidates = db.candidates || [];
  const c = db.candidates.find((x) => x.sfId && x.sfId === row.sfId);
  if (!c) {
    const created = normCandidate({ ...row, source: "salesforce" });
    db.candidates.push(created);
    write(db);
    return { action: "created", candidate: created };
  }
  const patch = { nom: row.nom, prenom: row.prenom, email: row.email, telephone: row.telephone, formationSouhaitee: row.formationSouhaitee, sfStatut: row.sfStatut, campusId: row.campusId || c.campusId };
  if (!c.learnerId) patch.stage = row.stage;
  Object.assign(c, normCandidate({ ...c, ...patch, id: c.id, source: "salesforce", createdAt: c.createdAt }));
  write(db);
  return { action: "updated", candidate: c };
}

// Conversion admis → dossier apprenant (+ inscription si année fournie).
// Si un dossier existe déjà (même nom+prénom+email sur le campus), on le lie au
// lieu d'en créer un second.
export function convertCandidate(cid, { classId, schoolYear } = {}) {
  const db = read();
  const c = (db.candidates || []).find((x) => x.id === cid);
  if (!c) return null;
  if (c.learnerId) return { error: "candidature déjà convertie" };
  if (!c.campusId) return { error: "candidature sans campus — l'affecter d'abord" };
  const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  let learner = (db.learners || []).find((l) => l.campusId === c.campusId && same(l.nom, c.nom) && same(l.prenom, c.prenom) && (!l.email || !c.email || same(l.email, c.email)));
  let learnerCreated = false;
  if (!learner) {
    learner = normLearner({ campusId: c.campusId, nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, notes: c.formationSouhaitee ? `Candidature : ${c.formationSouhaitee}` : "" });
    db.learners = db.learners || [];
    db.learners.push(learner);
    learnerCreated = true;
  }
  c.learnerId = learner.id;
  c.stage = "inscrit";
  c.updatedAt = now();
  let enrollment = null;
  if (schoolYear) {
    const dup = (db.enrollments || []).find((e) => e.learnerId === learner.id && e.schoolYear === String(schoolYear).trim() && e.statut === "inscrit");
    if (!dup) {
      enrollment = normEnrollment({ learnerId: learner.id, campusId: c.campusId, classId: classId || null, schoolYear });
      db.enrollments = db.enrollments || [];
      db.enrollments.push(enrollment);
    }
  }
  write(db);
  return { candidate: c, learner, learnerCreated, enrollment };
}

// ---------- Contrats d'alternance (ERP Bloc 3) ----------
// Un contrat lie un apprenant, une entreprise et une formation. Son cycle de vie
// va du brouillon au dépôt, puis à la validation du financeur — et, quand ça se
// passe mal, à un workflow de RUPTURE qui ne se contente pas de constater.

export const CONTRACT_STATUSES = ["brouillon", "a_deposer", "depose", "valide", "rompu", "termine"];
export const RUPTURE_STAGES = ["signalee", "mediation", "replacement", "resolue", "confirmee"];

// Les dates sont comparées lexicalement (ISO) dans toute la logique métier :
// accepter « 31/12/2026 » rendrait ces comparaisons silencieusement fausses.
const isoDate = (v) => {
  const x = String(v || "").trim();
  if (!x) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return "";
  const d = new Date(x + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== x ? "" : x;
};

function normContract(c = {}) {
  const s = (v) => String(v || "").trim();
  const n = (v) => (v === "" || v == null ? null : Number(v));
  return {
    id: c.id || id(), campusId: c.campusId || null,
    learnerId: c.learnerId || null, companyId: c.companyId || null, classId: c.classId || null,
    type: ["apprentissage", "professionnalisation"].includes(c.type) ? c.type : "apprentissage",
    status: CONTRACT_STATUSES.includes(c.status) ? c.status : "brouillon",
    dateDebut: isoDate(c.dateDebut), dateFin: isoDate(c.dateFin), dateSignature: isoDate(c.dateSignature),
    anneeExecution: n(c.anneeExecution) || 1,
    remunerationMensuelle: n(c.remunerationMensuelle),
    derogationAge: !!c.derogationAge,
    // Déterminants du minimum légal : sans eux, la majoration « titulaire d'un bac
    // professionnel » (65 %/80 % en professionnalisation) et le plancher
    // conventionnel de branche ne s'appliquent jamais.
    qualifieBacPro: !!c.qualifieBacPro,
    smcBranche: n(c.smcBranche),
    // Contrat de durée réduite : durée normale du diplôme et, si elle est connue,
    // l'année du cycle dans laquelle l'apprenti entre réellement.
    dureeCycleAnnees: n(c.dureeCycleAnnees),
    anneeEntreeCycle: n(c.anneeEntreeCycle),
    // Maître d'apprentissage : personne physique, distincte du contact commercial.
    maitreNom: s(c.maitreNom), maitreEmail: s(c.maitreEmail), maitreTel: s(c.maitreTel), maitreFonction: s(c.maitreFonction),
    // Financement : NPEC (niveau de prise en charge) et suivi du dossier financeur.
    npec: n(c.npec), financeur: s(c.financeur), numeroDossier: s(c.numeroDossier), numeroDepot: s(c.numeroDepot),
    dateDepot: isoDate(c.dateDepot), dateValidation: isoDate(c.dateValidation),
    rupture: c.rupture || null,
    notes: s(c.notes),
    createdAt: c.createdAt || now(), updatedAt: now(),
  };
}

export function listContracts({ campusId, learnerId, companyId, status, enRupture } = {}) {
  let items = (read().contracts || []).slice();
  if (campusId) items = items.filter((c) => c.campusId === campusId);
  if (learnerId) items = items.filter((c) => c.learnerId === learnerId);
  if (companyId) items = items.filter((c) => c.companyId === companyId);
  if (status) items = items.filter((c) => c.status === status);
  if (enRupture) items = items.filter((c) => c.rupture && !["resolue", "confirmee"].includes(c.rupture.stage));
  return items.sort((a, b) => (b.dateDebut || "").localeCompare(a.dateDebut || ""));
}
export function getContract(cid) { return (read().contracts || []).find((c) => c.id === cid) || null; }
export function addContract(data = {}) {
  const db = read();
  db.contracts = db.contracts || [];
  const c = normContract(data);
  db.contracts.push(c);
  write(db);
  return c;
}
// Transitions autorisées. Sans cette table, on pouvait repasser un contrat rompu
// en « validé », ou le redéposer indéfiniment — états incohérents et lignes
// d'audit trompeuses sur une pièce contractuelle.
const CONTRACT_TRANSITIONS = {
  brouillon: ["brouillon", "a_deposer", "depose"],
  a_deposer: ["a_deposer", "brouillon", "depose"],
  depose: ["depose", "valide", "brouillon"],   // retour en brouillon = correction avant instruction
  valide: ["valide", "termine", "rompu"],
  rompu: ["rompu"],                             // terminal
  termine: ["termine"],                         // terminal
};
export function updateContract(cid, patch = {}) {
  const db = read();
  const c = (db.contracts || []).find((x) => x.id === cid);
  if (!c) return null;
  if (patch.status && patch.status !== c.status) {
    const permis = CONTRACT_TRANSITIONS[c.status] || [];
    if (!permis.includes(patch.status)) {
      return { error: `transition impossible : « ${c.status} » vers « ${patch.status} »` };
    }
  }
  Object.assign(c, normContract({ ...c, ...patch, id: c.id, rupture: c.rupture, createdAt: c.createdAt }));
  write(db);
  return c;
}
export function deleteContract(cid) {
  const db = read();
  db.contracts = (db.contracts || []).filter((c) => c.id !== cid);
  write(db);
}

// Workflow de rupture : signalement, puis étapes traçées jusqu'à la sortie.
// Une rupture « résolue » (maintien en entreprise) est le résultat qu'on cherche ;
// une rupture « confirmée » bascule le contrat en rompu et l'inscription en rupture.
export function openRupture(cid, { origine, motif, by }) {
  const db = read();
  const c = (db.contracts || []).find((x) => x.id === cid);
  if (!c) return null;
  if (c.rupture && !["resolue", "confirmee"].includes(c.rupture.stage)) return { error: "une rupture est déjà en cours sur ce contrat" };
  c.rupture = {
    stage: "signalee", since: now().slice(0, 10),
    origine: String(origine || "").trim(), motif: String(motif || "").trim(),
    owner: "", events: [{ at: now(), by: String(by || ""), stage: "signalee", note: String(motif || "").trim() }],
  };
  c.updatedAt = now();
  write(db);
  return c;
}
export function advanceRupture(cid, { stage, note, owner, by }) {
  const db = read();
  const c = (db.contracts || []).find((x) => x.id === cid);
  if (!c || !c.rupture) return null;
  if (!RUPTURE_STAGES.includes(stage)) return { error: "étape de rupture inconnue" };
  // Une rupture confirmée est terminale : le contrat est rompu et l'inscription a
  // basculé. Revenir en arrière laisserait le contrat et l'inscription incohérents.
  if (c.rupture.stage === "confirmee") return { error: "rupture déjà confirmée — elle ne peut plus être modifiée" };
  if (c.rupture.stage === "resolue" && stage !== "resolue") return { error: "rupture déjà résolue — rouvrir un nouveau signalement si nécessaire" };
  c.rupture.stage = stage;
  if (owner !== undefined) c.rupture.owner = String(owner || "").trim();
  c.rupture.events = c.rupture.events || [];
  c.rupture.events.push({ at: now(), by: String(by || ""), stage, note: String(note || "").trim() });
  // La confirmation rompt le contrat et répercute sur l'inscription en cours.
  if (stage === "confirmee") {
    c.status = "rompu";
    c.rupture.dateRupture = now().slice(0, 10);
    for (const e of db.enrollments || []) {
      if (e.learnerId === c.learnerId && e.statut === "inscrit") {
        e.statut = "rupture";
        e.dateSortie = c.rupture.dateRupture;
        e.motifSortie = c.rupture.motif || "Rupture de contrat";
        e.updatedAt = now();
      }
    }
  }
  c.updatedAt = now();
  write(db);
  return c;
}

// ---------- Évaluations & notes (ERP Bloc 3) ----------
// Volume : ~30 évaluations par classe et par an, soit quelques centaines de notes —
// deux ordres de grandeur sous les séances, donc le store principal suffit. Si un
// client dépasse la dizaine de milliers de notes, les sortir dans un fichier dédié
// comme les séances et l'émargement.

export const ASSESSMENT_TYPES = ["devoir", "examen", "tp", "oral", "projet", "cco"];

function normAssessment(a = {}) {
  const s = (v) => String(v || "").trim();
  const n = (v) => (v === "" || v == null ? null : Number(v));
  return {
    id: a.id || id(), campusId: a.campusId || null, classId: a.classId || null,
    moduleId: a.moduleId || null, label: s(a.label), date: s(a.date),
    type: ASSESSMENT_TYPES.includes(a.type) ? a.type : "devoir",
    coefficient: a.coefficient == null || a.coefficient === "" ? 1 : Number(a.coefficient),
    maxScore: n(a.maxScore) || 20,
    published: !!a.published,
    createdAt: a.createdAt || now(), updatedAt: now(),
  };
}

export function listAssessments({ campusId, classId, moduleId } = {}) {
  let items = (read().assessments || []).slice();
  if (campusId) items = items.filter((a) => a.campusId === campusId);
  if (classId) items = items.filter((a) => a.classId === classId);
  if (moduleId) items = items.filter((a) => a.moduleId === moduleId);
  return items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export function getAssessment(aid) { return (read().assessments || []).find((a) => a.id === aid) || null; }
export function addAssessment(data = {}) {
  const db = read();
  db.assessments = db.assessments || [];
  const a = normAssessment(data);
  db.assessments.push(a);
  write(db);
  return a;
}
export function updateAssessment(aid, patch = {}) {
  const db = read();
  const a = (db.assessments || []).find((x) => x.id === aid);
  if (!a) return null;
  Object.assign(a, normAssessment({ ...a, ...patch, id: a.id, createdAt: a.createdAt }));
  write(db);
  return a;
}
export function deleteAssessment(aid) {
  const db = read();
  db.assessments = (db.assessments || []).filter((a) => a.id !== aid);
  db.grades = (db.grades || []).filter((g) => g.assessmentId !== aid);
  write(db);
}

export function listGrades({ assessmentId, learnerId } = {}) {
  let items = (read().grades || []).slice();
  if (assessmentId) items = items.filter((g) => g.assessmentId === assessmentId);
  if (learnerId) items = items.filter((g) => g.learnerId === learnerId);
  return items;
}
// Saisie par lot d'une évaluation : une note par apprenant, upsert.
export function setGrades(assessmentId, entries = []) {
  const db = read();
  db.grades = db.grades || [];
  const byLearner = new Map(db.grades.filter((g) => g.assessmentId === assessmentId).map((g) => [g.learnerId, g]));
  for (const e of entries) {
    if (!e?.learnerId) continue;
    const g = byLearner.get(e.learnerId) || { id: id(), assessmentId, learnerId: e.learnerId, createdAt: now() };
    g.score = e.score === "" || e.score == null ? null : Number(e.score);
    g.absent = !!e.absent;
    g.zeroSiAbsent = !!e.zeroSiAbsent;
    g.comment = String(e.comment || "").trim();
    g.updatedAt = now();
    if (!byLearner.has(e.learnerId)) { db.grades.push(g); byLearner.set(e.learnerId, g); }
  }
  write(db);
  return db.grades.filter((g) => g.assessmentId === assessmentId);
}

// ---------- Accès portails (apprenant / formateur / tuteur) ----------
// Le jeton n'est JAMAIS stocké en clair : seule son empreinte est conservée, et
// il n'est montré qu'une fois, à la création. Perdu = régénéré, jamais retrouvé.

export function listPortalAccess({ campusId, kind, subjectId } = {}) {
  let items = (read().portalAccess || []).slice();
  if (campusId) items = items.filter((a) => a.campusId === campusId);
  if (kind) items = items.filter((a) => a.kind === kind);
  if (subjectId) items = items.filter((a) => a.subjectId === subjectId);
  return items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function findPortalAccessByHash(tokenHash) {
  return (read().portalAccess || []).find((a) => a.tokenHash === tokenHash) || null;
}

// Créer un accès révoque le précédent du même sujet : un seul lien vivant à la
// fois, sinon un lien transmis par erreur reste utilisable indéfiniment.
export function createPortalAccess({ kind, subjectId, campusId, label, tokenHash, expiresAt, createdBy }) {
  const db = read();
  db.portalAccess = db.portalAccess || [];
  for (const a of db.portalAccess) {
    if (a.kind === kind && a.subjectId === subjectId && !a.revokedAt) {
      a.revokedAt = now();
      a.revokedReason = "remplacé par un nouveau lien";
    }
  }
  const access = {
    id: id(), kind, subjectId, campusId: campusId || null, label: String(label || "").trim(),
    tokenHash, expiresAt: expiresAt || null,
    createdAt: now(), createdBy: String(createdBy || ""),
    lastUsedAt: null, useCount: 0, revokedAt: null, revokedReason: null,
  };
  db.portalAccess.push(access);
  write(db);
  return access;
}

export function touchPortalAccess(accessId) {
  const db = read();
  const a = (db.portalAccess || []).find((x) => x.id === accessId);
  if (!a) return null;
  a.lastUsedAt = now();
  a.useCount = (a.useCount || 0) + 1;
  write(db);
  return a;
}

export function revokePortalAccess(accessId, reason) {
  const db = read();
  const a = (db.portalAccess || []).find((x) => x.id === accessId);
  if (!a) return null;
  a.revokedAt = now();
  a.revokedReason = String(reason || "révoqué manuellement").trim();
  write(db);
  return a;
}

// ---------- Ancrages de la chaîne d'émargement (S-1) ----------
// Le chaînage détecte une modification silencieuse, mais quelqu'un ayant un accès
// complet au serveur pourrait recalculer TOUTE la chaîne. La parade est de publier
// l'empreinte de tête HORS de la machine : l'email d'ancrage quotidien est horodaté
// par un serveur de messagerie tiers, et la copie off-site des sauvegardes le fige
// une seconde fois. Falsifier a posteriori exigerait alors de réécrire aussi ces
// témoins externes.
//
// Le journal ci-dessous n'est qu'une TRACE LOCALE de ce qui a été publié : sa valeur
// probante vient de l'envoi externe, pas de lui-même.

export function listAnchors({ campusId, limit = 100 } = {}) {
  let items = (read().attendanceAnchors || []).slice();
  if (campusId) items = items.filter((a) => a.campusId === campusId);
  return items.sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, limit);
}

export function addAnchor({ campusId, hash, count, sentTo, ok }) {
  const db = read();
  db.attendanceAnchors = db.attendanceAnchors || [];
  const a = { id: id(), campusId: campusId || null, at: now(), hash: hash || null, count: count || 0,
    sentTo: String(sentTo || ""), ok: ok !== false };
  db.attendanceAnchors.push(a);
  if (db.attendanceAnchors.length > 3000) db.attendanceAnchors = db.attendanceAnchors.slice(-3000);
  write(db);
  return a;
}

// ---------- Connecteur SI campus ----------
// La config vit sur la fiche campus (campus.si) : jeton chiffré au repos avec le
// reste du store (DATA_KEY). Les snapshots vivent dans la collection racine `si`
// (1 entrée par campus : dernière synthèse + petit historique de tendance).

export function setSiConfig(cid, cfg = {}) {
  const db = read();
  const c = db.campuses.find((x) => x.id === cid);
  if (!c) return null;
  const prev = c.si || {};
  c.si = {
    baseUrl: String(cfg.baseUrl ?? prev.baseUrl ?? "").trim().replace(/\/+$/, ""),
    // Jeton : champ vide dans le formulaire = « ne pas changer » (il n'est jamais renvoyé au client).
    token: cfg.token ? String(cfg.token).trim() : (prev.token || ""),
    codesSite: String(cfg.codesSite ?? prev.codesSite ?? "").trim(),
    enabled: cfg.enabled !== undefined ? !!cfg.enabled : (prev.enabled ?? true),
  };
  c.updatedAt = now();
  write(db);
  return c.si;
}

export function getSiConfig(cid) {
  const c = read().campuses.find((x) => x.id === cid);
  return c?.si && c.si.baseUrl && c.si.token ? c.si : null;
}

// Vue « publique » de la config : jamais le jeton lui-même.
export function maskSiConfig(cid) {
  const c = read().campuses.find((x) => x.id === cid);
  const y = c?.si || {};
  return {
    configured: !!(y.baseUrl && y.token), enabled: y.enabled ?? true,
    baseUrl: y.baseUrl || "", codesSite: y.codesSite || "",
    tokenMask: y.token ? "•••" + String(y.token).slice(-4) : "",
  };
}

export function setSiSnapshot(cid, summary) {
  const db = read();
  db.si = db.si || [];
  let s = db.si.find((x) => x.campusId === cid);
  if (!s) { s = { id: id(), campusId: cid, history: [] }; db.si.push(s); }
  s.summary = summary;
  s.lastError = null;
  s.syncedAt = now();
  const day = s.syncedAt.slice(0, 10);
  s.history = (s.history || []).filter((h) => h.date !== day);
  s.history.push({
    date: day, effectif: summary.effectif,
    absentRate: summary.assiduite?.absentRate ?? null,
    rupturesEnCours: summary.contrats?.rupturesEnCours?.length ?? null,
    ecart: summary.finance?.ecart ?? null,
  });
  if (s.history.length > 120) s.history = s.history.slice(-120);
  write(db);
  return s;
}

export function setSiError(cid, message) {
  const db = read();
  db.si = db.si || [];
  let s = db.si.find((x) => x.campusId === cid);
  if (!s) { s = { id: id(), campusId: cid, history: [] }; db.si.push(s); }
  s.lastError = { message: String(message || ""), at: now() };
  write(db);
  return s;
}

export function getSiSnapshot(cid) {
  return read().si?.find((x) => x.campusId === cid) || null;
}

// --- Purges de conservation (politique dans lib/retention.js) ---
// Chaque purge accepte un mode « à blanc » : une suppression irréversible ne doit
// jamais être une surprise pour l'exploitant.

// Une candidature CONVERTIE en dossier apprenant suit le sort de ce dossier :
// seules les candidatures jamais converties sont purgées par ancienneté.
export function purgeCandidatesBefore(cutoffISO, { dryRun = false } = {}) {
  const db = read();
  const cibles = (db.candidates || []).filter((c) => !c.learnerId && (c.updatedAt || c.createdAt || "") < cutoffISO);
  if (dryRun) return cibles.length;
  if (!cibles.length) return 0;
  const ids = new Set(cibles.map((c) => c.id));
  db.candidates = (db.candidates || []).filter((c) => !ids.has(c.id));
  write(db);
  return ids.size;
}

export function purgeRevokedPortalAccessBefore(cutoffISO, { dryRun = false } = {}) {
  const db = read();
  const cibles = (db.portalAccess || []).filter((a) => {
    const fini = a.revokedAt || (a.expiresAt && a.expiresAt < new Date().toISOString() ? a.expiresAt : null);
    return fini && fini < cutoffISO;
  });
  if (dryRun) return cibles.length;
  if (!cibles.length) return 0;
  const ids = new Set(cibles.map((a) => a.id));
  db.portalAccess = (db.portalAccess || []).filter((a) => !ids.has(a.id));
  write(db);
  return ids.size;
}

export function purgeAnchorsBefore(cutoffISO, { dryRun = false } = {}) {
  const db = read();
  const cibles = (db.attendanceAnchors || []).filter((a) => (a.at || "") < cutoffISO);
  if (dryRun) return cibles.length;
  if (!cibles.length) return 0;
  const ids = new Set(cibles.map((a) => a.id));
  db.attendanceAnchors = (db.attendanceAnchors || []).filter((a) => !ids.has(a.id));
  write(db);
  return ids.size;
}

// --- Stats tableau de bord ---
export function stats() {
  const db = read();
  return {
    campuses: db.campuses.length,
    deliverables: db.deliverables.length,
    actionsOpen: db.actions.filter((a) => a.status !== "done").length,
    actionsOverdue: db.actions.filter((a) => a.status !== "done" && a.dueDate && a.dueDate < now().slice(0, 10)).length,
  };
}

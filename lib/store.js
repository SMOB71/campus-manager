// Store JSON persistant (mono-utilisateur). Ecriture atomique.
// Persiste dans DATA_DIR (monte sur un volume Docker en prod).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt, isEncrypted, encryptionEnabled } from "./crypto-store.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = { campuses: [], deliverables: [], actions: [], visits: [], kpi: [], briefs: [], incidents: [], documents: [], partners: [], networkObjectives: [], audit: [], scenarios: [], openings: [], emailPriority: [], emailMuted: [], decisions: [], reviews: [], events: [], recoveries: [], arbitrages: [], settings: {} };

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, encrypt(EMPTY));
}

function read() {
  ensure();
  try {
    return { ...EMPTY, ...(decrypt(fs.readFileSync(DB_FILE, "utf8")) || {}) };
  } catch {
    return { ...EMPTY };
  }
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
  return { migrated };
}

function write(db) {
  ensure();
  // Sauvegarde de la version precedente AVANT ecrasement (anti-perte de donnees).
  try {
    if (fs.existsSync(DB_FILE)) {
      const bdir = path.join(DATA_DIR, "backups");
      if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(DB_FILE, path.join(bdir, `db-${stamp}.json`));
      const files = fs.readdirSync(bdir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
      for (const f of files.slice(0, -30)) fs.unlinkSync(path.join(bdir, f)); // ne garder que 30
    }
  } catch { /* la sauvegarde ne doit jamais bloquer l'ecriture */ }
  // Écriture atomique + durable : write dans un tmp, fsync (survit à un crash), puis rename atomique.
  // NB : le store est synchrone → Node sérialise les écritures (pas d'entrelacement read-modify-write).
  const tmp = DB_FILE + ".tmp";
  const payload = encrypt(db);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, DB_FILE);
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
  return read().campuses.sort((a, b) => a.name.localeCompare(b.name));
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

// --- Documents (GED par campus) — métadonnées ; le binaire est sur disque (chiffré) ---
export function listDocuments(cid, indicator) {
  let d = (read().documents || []).filter((x) => !cid || x.campusId === cid);
  if (indicator != null && indicator !== "") d = d.filter((x) => String(x.indicator || "") === String(indicator));
  return d.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function getDocument(docId) { return (read().documents || []).find((d) => d.id === docId) || null; }
export function addDocument({ campusId, campusName, name, size, mime, category, file, indicator }) {
  const db = read();
  db.documents = db.documents || [];
  const doc = {
    id: id(), campusId: campusId || null, campusName: campusName || null,
    name: String(name || "document").trim(), size: size || 0, mime: mime || "application/octet-stream",
    category: (category || "autre").trim(), indicator: indicator ? String(indicator).trim() : null,
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
const PARTNER_FIELDS = ["name", "sector", "contactName", "contactEmail", "contactPhone", "status", "notes"];
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
function normTask(t) {
  return {
    id: t.id || id(), lot: t.lot || "autre", title: String(t.title || "").trim(), owner: String(t.owner || "").trim(),
    dueDate: t.dueDate || "", offset: t.offset == null ? null : Number(t.offset),
    status: ["todo", "doing", "done", "blocked"].includes(t.status) ? t.status : "todo",
    critical: !!t.critical, notes: String(t.notes || "").trim(),
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
  for (const f of ["lot", "title", "owner", "dueDate", "status", "notes"]) if (f in patch) t[f] = typeof patch[f] === "string" ? patch[f].trim() : patch[f];
  if ("critical" in patch) t.critical = !!patch.critical;
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
  const o = { id: id(), campusId: d.campusId || null, campusName: d.campusName || null, status: "active", diagnostic: String(d.diagnostic || "").trim(), h30: [], h60: [], h90: [], exitCriteria: String(d.exitCriteria || "").trim(), createdAt: now(), closedAt: null };
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

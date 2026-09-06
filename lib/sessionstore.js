// Séances de cours — stockage séparé de db.json.
//
// POURQUOI UN FICHIER À PART : une séance pèse ~310 octets ; une classe consomme
// ~1 200 séances par année scolaire, soit 360 Ko, et quatre classes sur trois ans
// dépassent 4 Mo. Or db.json est déchiffré et reparsé à chaque lecture non mise en
// cache, et réécrit AVEC sauvegarde préalable à chaque écriture. Le chemin chaud
// (buildNetworkRows, heatmap, notifications) paierait ce poids à chaque affichage
// pour une donnée qu'il n'ouvre jamais. Le planning a donc son propre fichier, son
// propre cache et son propre rythme d'écriture.
//
// Même chiffrement au repos que le store principal (crypto-store, AES-256-GCM).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt } from "./crypto-store.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "sessions.json");
const EMPTY = { sessions: [] };

export const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

let _cache = null;
function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, encrypt(EMPTY));
}
function read() {
  if (_cache) return _cache;
  ensure();
  try { _cache = { ...EMPTY, ...(decrypt(fs.readFileSync(FILE, "utf8")) || {}) }; }
  catch { _cache = { ...EMPTY }; }
  return _cache;
}
function write(db) {
  ensure();
  // Écriture atomique et durable, comme le store principal : tmp → fsync → rename.
  const tmp = FILE + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, encrypt(db)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
  _cache = null;
}

export const SESSION_STATUS = ["planned", "done", "cancelled"];
export const SESSION_KINDS = ["cours", "examen", "rattrapage", "reunion"];

const num = (v) => (v == null || v === "" ? null : Number(v));

function normSession(s = {}) {
  return {
    id: s.id || id(),
    campusId: s.campusId || null, classId: s.classId || null,
    moduleId: s.moduleId || null, teacherId: s.teacherId || null, roomId: s.roomId || null,
    date: s.date || "", start: s.start || "", end: s.end || "",
    status: SESSION_STATUS.includes(s.status) ? s.status : "planned",
    kind: SESSION_KINDS.includes(s.kind) ? s.kind : "cours",
    seriesId: s.seriesId || null,
    // Conserve la trace d'un conflit assumé : sans elle, l'arbitrage se perd et
    // le professeur découvre son cours la veille.
    forced: Array.isArray(s.forced) ? s.forced.map((f) => String(f)) : [],
    notes: String(s.notes || "").trim(),
    createdAt: s.createdAt || now(),
  };
}

// Lecture filtrée. `from`/`to` bornent sur la date (comparaison lexicale sûre en ISO).
export function listSessions({ campusId, classId, teacherId, roomId, from, to, seriesId } = {}) {
  let items = (read().sessions || []).slice();
  if (campusId) items = items.filter((s) => s.campusId === campusId);
  if (classId) items = items.filter((s) => s.classId === classId);
  if (teacherId) items = items.filter((s) => s.teacherId === teacherId);
  if (roomId) items = items.filter((s) => s.roomId === roomId);
  if (seriesId) items = items.filter((s) => s.seriesId === seriesId);
  if (from) items = items.filter((s) => (s.date || "") >= from);
  if (to) items = items.filter((s) => (s.date || "") <= to);
  return items.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || ""));
}
export function getSession(sid) { return (read().sessions || []).find((s) => s.id === sid) || null; }

export function addSession(data = {}) {
  const db = read();
  db.sessions = db.sessions || [];
  const s = normSession(data);
  db.sessions.push(s);
  write(db);
  return s;
}
// Pose d'une série : une seule écriture pour N séances, sinon poser une année
// déclencherait 40 réécritures chiffrées du fichier.
export function addSessions(list = []) {
  const db = read();
  db.sessions = db.sessions || [];
  const made = list.map(normSession);
  db.sessions.push(...made);
  write(db);
  return made;
}
export function updateSession(sid, patch = {}) {
  const db = read();
  const s = (db.sessions || []).find((x) => x.id === sid);
  if (!s) return null;
  for (const f of ["classId", "moduleId", "teacherId", "roomId", "seriesId"]) if (f in patch) s[f] = patch[f] || null;
  for (const f of ["date", "start", "end"]) if (f in patch) s[f] = patch[f] || "";
  if ("status" in patch && SESSION_STATUS.includes(patch.status)) s.status = patch.status;
  if ("kind" in patch && SESSION_KINDS.includes(patch.kind)) s.kind = patch.kind;
  if ("notes" in patch) s.notes = String(patch.notes || "").trim();
  if ("forced" in patch) s.forced = Array.isArray(patch.forced) ? patch.forced.map((f) => String(f)) : [];
  write(db);
  return s;
}
// Applique un même correctif à toute une série (« toute la série » vs « cette séance »).
export function updateSeries(seriesId, patch = {}) {
  const db = read();
  const hits = (db.sessions || []).filter((s) => s.seriesId === seriesId);
  for (const s of hits) {
    for (const f of ["moduleId", "teacherId", "roomId"]) if (f in patch) s[f] = patch[f] || null;
    for (const f of ["start", "end"]) if (f in patch) s[f] = patch[f] || "";
    if ("status" in patch && SESSION_STATUS.includes(patch.status)) s.status = patch.status;
    if ("notes" in patch) s.notes = String(patch.notes || "").trim();
  }
  write(db);
  return hits;
}
export function deleteSession(sid) {
  const db = read();
  db.sessions = (db.sessions || []).filter((s) => s.id !== sid);
  write(db);
}
export function deleteSeries(seriesId) {
  const db = read();
  const before = (db.sessions || []).length;
  db.sessions = (db.sessions || []).filter((s) => s.seriesId !== seriesId);
  write(db);
  return before - db.sessions.length;
}

// Purge des années scolaires anciennes : le fichier ne doit pas croître sans fin.
export function purgeBefore(dateISO) {
  const db = read();
  const before = (db.sessions || []).length;
  db.sessions = (db.sessions || []).filter((s) => (s.date || "") >= dateISO);
  write(db);
  return before - db.sessions.length;
}
export function countSessions() { return (read().sessions || []).length; }

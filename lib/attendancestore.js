// Feuilles d'émargement — stockage séparé, comme les séances.
//
// VOLUME : une feuille porte une ligne par apprenant. Une classe de 25 sur une
// année de 1 200 séances produit 30 000 lignes ; le fichier vit donc à part de
// db.json, qui est relu et réécrit sur le chemin chaud du cockpit.
//
// Les signatures manuscrites (data URI PNG) sont volumineuses : elles sont
// stockées dans un fichier annexe par feuille, seule leur empreinte reste dans
// l'index. Même chiffrement au repos que le reste (AES-256-GCM).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt, encryptBuffer, decryptBuffer } from "./crypto-store.js";
import { ATTENDANCE_STATUSES, SIGN_MODES, GENESIS_HASH, hashSheet, hashSignature, verifyChain, generateSessionCode } from "./attendance.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "attendance.json");
const SIGN_DIR = path.join(DATA_DIR, "signatures");
const EMPTY = { sheets: [] };

export const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

let _cache = null;
function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGN_DIR)) fs.mkdirSync(SIGN_DIR, { recursive: true });
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
  const tmp = FILE + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, encrypt(db)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
  _cache = null;
}

function normEntry(e = {}) {
  return {
    learnerId: e.learnerId || null,
    status: ATTENDANCE_STATUSES.includes(e.status) ? e.status : "present",
    minutesLate: Number(e.minutesLate) || 0,
    justified: !!e.justified,
    reason: String(e.reason || "").trim(),
    signedAt: e.signedAt || "",
    signatureHash: e.signatureHash || "",
  };
}

export function listSheets({ campusId, classId, sessionId, from, to, status } = {}) {
  let items = (read().sheets || []).slice();
  if (campusId) items = items.filter((s) => s.campusId === campusId);
  if (classId) items = items.filter((s) => s.classId === classId);
  if (sessionId) items = items.filter((s) => s.sessionId === sessionId);
  if (status) items = items.filter((s) => s.status === status);
  if (from) items = items.filter((s) => (s.date || "") >= from);
  if (to) items = items.filter((s) => (s.date || "") <= to);
  return items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.start || "").localeCompare(a.start || ""));
}
export function getSheet(sid) { return (read().sheets || []).find((s) => s.id === sid) || null; }
export function getSheetBySession(sessionId) { return (read().sheets || []).find((s) => s.sessionId === sessionId) || null; }
export function getSheetByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return c ? (read().sheets || []).find((s) => s.code === c && s.status === "open") || null : null;
}

// Ouvre la feuille d'une séance (idempotent : rappeler renvoie la feuille existante).
// `learners` = [{id}] présents à l'appel, pré-remplis en « présent ».
export function openSheet({ session, learners = [], signMode = "signature", openedBy = "" }) {
  const existing = getSheetBySession(session.id);
  if (existing) return existing;
  const db = read();
  db.sheets = db.sheets || [];
  const sheet = {
    id: id(), sessionId: session.id, campusId: session.campusId || null,
    classId: session.classId || null, teacherId: session.teacherId || null,
    moduleId: session.moduleId || null,
    date: session.date || "", start: session.start || "", end: session.end || "",
    signMode: SIGN_MODES.includes(signMode) ? signMode : "signature",
    code: generateSessionCode(),
    status: "open",
    entries: learners.map((l) => normEntry({ learnerId: l.id, status: "present" })),
    amendments: [],
    openedAt: now(), openedBy: String(openedBy || ""),
    lockedAt: null, lockedBy: null, seq: null, prevHash: null, hash: null,
  };
  db.sheets.push(sheet);
  write(db);
  return sheet;
}

// Saisie de l'appel (feuille ouverte uniquement).
export function setEntries(sheetId, entries = []) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status === "locked") return { error: "feuille close — passer par un avenant" };
  const byLearner = new Map((sheet.entries || []).map((e) => [e.learnerId, e]));
  for (const raw of entries) {
    const prev = byLearner.get(raw.learnerId) || {};
    byLearner.set(raw.learnerId, normEntry({ ...prev, ...raw }));
  }
  sheet.entries = [...byLearner.values()];
  write(db);
  return sheet;
}

// Signature d'un apprenant. L'horodatage est SERVEUR (jamais le poste client) et
// l'image est stockée à part, seule son empreinte entre dans la chaîne.
export function signEntry(sheetId, learnerId, signatureDataUri) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status === "locked") return { error: "feuille close — passer par un avenant" };
  const entry = (sheet.entries || []).find((e) => e.learnerId === learnerId);
  if (!entry) return { error: "apprenant absent de la feuille" };
  entry.signedAt = now();
  entry.status = entry.status === "absent" || entry.status === "excuse" ? "present" : entry.status;
  if (signatureDataUri) {
    entry.signatureHash = hashSignature(signatureDataUri);
    ensure();
    fs.writeFileSync(path.join(SIGN_DIR, `${sheet.id}_${learnerId}`), encryptBuffer(Buffer.from(String(signatureDataUri), "utf8")));
  }
  write(db);
  return sheet;
}

export function readSignature(sheetId, learnerId) {
  const f = path.join(SIGN_DIR, `${sheetId}_${learnerId}`);
  if (!fs.existsSync(f)) return null;
  try { return decryptBuffer(fs.readFileSync(f)).toString("utf8"); } catch { return null; }
}

// Clôture : fige la feuille et l'accroche à la chaîne du campus.
export function lockSheet(sheetId, lockedBy) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status === "locked") return { error: "feuille déjà close" };
  const chain = (db.sheets || []).filter((s) => s.campusId === sheet.campusId && s.status === "locked");
  const last = chain.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[chain.length - 1] || null;
  sheet.seq = last ? (last.seq ?? 0) + 1 : 1;
  sheet.prevHash = last ? last.hash : GENESIS_HASH;
  sheet.lockedAt = now();
  sheet.lockedBy = String(lockedBy || "");
  sheet.status = "locked";
  sheet.hash = hashSheet(sheet, sheet.prevHash);
  write(db);
  return sheet;
}

// Correction après clôture : jamais de réécriture silencieuse. L'avenant est ajouté,
// la feuille est re-scellée, et TOUTE la suite de la chaîne du campus est recalculée
// (les empreintes suivantes dépendent de celle-ci).
export function amendSheet(sheetId, { learnerId, status, justified, reason, by }) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status !== "locked") return { error: "feuille non close — la modifier directement" };
  const entry = (sheet.entries || []).find((e) => e.learnerId === learnerId);
  if (!entry) return { error: "apprenant absent de la feuille" };
  if (!String(reason || "").trim()) return { error: "motif de correction obligatoire" };
  const from = entry.status;
  if (status && ATTENDANCE_STATUSES.includes(status)) entry.status = status;
  if (justified !== undefined) entry.justified = !!justified;
  sheet.amendments = sheet.amendments || [];
  sheet.amendments.push({ at: now(), by: String(by || ""), learnerId, from, to: entry.status, reason: String(reason).trim() });
  // Re-scellement en cascade sur le campus, par ordre de séquence.
  const chain = (db.sheets || []).filter((s) => s.campusId === sheet.campusId && s.status === "locked")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let prev = GENESIS_HASH;
  for (const s of chain) {
    s.prevHash = prev;
    s.hash = hashSheet(s, prev);
    prev = s.hash;
  }
  write(db);
  return sheet;
}

export function verifyCampusChain(campusId) {
  return verifyChain((read().sheets || []).filter((s) => s.campusId === campusId && s.status === "locked"));
}

export function countSheets() { return (read().sheets || []).length; }

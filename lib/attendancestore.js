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
import { ATTENDANCE_STATUSES, SIGN_MODES, GENESIS_HASH, hashSheet, hashAmendment, hashSignature, verifyChain, effectiveEntries, generateSessionCode } from "./attendance.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "attendance.json");
const SIGN_DIR = path.join(DATA_DIR, "signatures");
const EMPTY = { sheets: [], amendments: [] };

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
  // La feuille est une pièce probante : on ne modifie QUE des lignes déjà présentes,
  // c'est-à-dire des apprenants réellement inscrits à l'ouverture de l'appel.
  // Accepter un identifiant arbitraire permettrait d'injecter des lignes fantômes
  // dans un document destiné à un financeur, puis de les sceller.
  const inconnus = [];
  for (const raw of entries) {
    if (!byLearner.has(raw.learnerId)) { inconnus.push(raw.learnerId); continue; }
    byLearner.set(raw.learnerId, normEntry({ ...byLearner.get(raw.learnerId), ...raw }));
  }
  if (inconnus.length) return { error: `apprenant(s) absent(s) de la feuille : ${inconnus.join(", ")}` };
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
  // Une absence CONSTATÉE par le formateur ne doit pas être effacée par une
  // signature arrivée ensuite : on enregistre la signature, on marque le conflit,
  // et c'est l'équipe qui tranche. Sinon un appel fait en début de séance peut
  // être contredit sans laisser de trace.
  if (entry.status === "absent" || entry.status === "excuse") entry.signatureApresAbsence = true;
  else entry.status = entry.status || "present";
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

// Maillons de la chaîne d'un campus : feuilles closes ET avenants, ordonnés.
function chainOf(db, campusId) {
  const sheets = (db.sheets || []).filter((s) => s.campusId === campusId && s.status === "locked");
  const ams = (db.amendments || []).filter((a) => a.campusId === campusId);
  return [...sheets, ...ams].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
function chainTail(db, campusId) {
  const c = chainOf(db, campusId);
  const last = c[c.length - 1];
  return { seq: last ? (last.seq ?? 0) + 1 : 1, prevHash: last ? last.hash : GENESIS_HASH };
}

// Clôture : fige la feuille et l'accroche à la chaîne du campus.
export function lockSheet(sheetId, lockedBy) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status === "locked") return { error: "feuille déjà close" };
  const tail = chainTail(db, sheet.campusId);
  sheet.seq = tail.seq;
  sheet.prevHash = tail.prevHash;
  sheet.lockedAt = now();
  sheet.lockedBy = String(lockedBy || "");
  sheet.status = "locked";
  sheet.hash = hashSheet(sheet, sheet.prevHash);
  write(db);
  return sheet;
}

// Correction après clôture : le passé n'est JAMAIS réécrit.
//
// L'avenant est un maillon SUPPLÉMENTAIRE de la chaîne, avec sa propre empreinte.
// La feuille corrigée garde l'empreinte qu'elle avait au moment de sa clôture :
// elle reste vérifiable, et tous les ancrages externes publiés avant la correction
// restent vrais. L'état affiché est l'appel scellé + les avenants appliqués
// (effectiveEntries) : un contrôleur voit ce qui a été constaté ET ce qui a été
// corrigé, avec le motif et l'auteur de chaque correction.
//
// La version précédente re-scellait toute la chaîne du campus : une correction
// légitime devenait alors indiscernable d'une réécriture malveillante, et la
// vérification d'intégrité répondait « intègre » quoi qu'il arrive.
export function amendSheet(sheetId, { learnerId, status, justified, reason, by }) {
  const db = read();
  const sheet = (db.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return null;
  if (sheet.status !== "locked") return { error: "feuille non close — la modifier directement" };
  const entry = (sheet.entries || []).find((e) => e.learnerId === learnerId);
  if (!entry) return { error: "apprenant absent de la feuille" };
  if (!String(reason || "").trim()) return { error: "motif de correction obligatoire" };
  if (status && !ATTENDANCE_STATUSES.includes(status)) return { error: "statut de correction invalide" };

  // État courant (appel + avenants déjà posés) pour ne pas enregistrer un avenant
  // qui ne change rien, et pour tracer la vraie valeur de départ.
  const courant = effectiveEntries(sheet).find((e) => e.learnerId === learnerId) || entry;
  const to = status || courant.status;
  const justifieCible = justified === undefined ? courant.justified : !!justified;
  if (to === courant.status && justifieCible === !!courant.justified) {
    return { error: "cet avenant ne change rien à l'état de la feuille" };
  }

  const tail = chainTail(db, sheet.campusId);
  const am = {
    id: id(), kind: "amendment", campusId: sheet.campusId, sheetId: sheet.id,
    learnerId, from: courant.status, to,
    justified: justified === undefined ? null : !!justified,
    reason: String(reason).trim(), at: now(), by: String(by || ""),
    seq: tail.seq, prevHash: tail.prevHash, hash: null,
  };
  am.hash = hashAmendment(am, am.prevHash);
  db.amendments = db.amendments || [];
  db.amendments.push(am);
  // Copie de lecture sur la feuille, pour l'affichage et les calculs. Elle n'entre
  // PAS dans le sceau de la feuille (le sceau est figé) : la preuve de l'avenant,
  // c'est son propre maillon.
  sheet.amendments = sheet.amendments || [];
  sheet.amendments.push({ id: am.id, at: am.at, by: am.by, learnerId, from: am.from, to: am.to, justified: am.justified, reason: am.reason, seq: am.seq, hash: am.hash });
  write(db);
  return sheet;
}

export function listAmendments(campusId) {
  return (read().amendments || []).filter((a) => !campusId || a.campusId === campusId).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function verifyCampusChain(campusId) {
  return verifyChain(chainOf(read(), campusId));
}

// Suppression des images de signature d'un apprenant (droit à l'effacement).
// L'empreinte reste dans la feuille scellée : l'intégrité de la chaîne n'est pas
// affectée, seule l'image identifiante disparaît.
export function deleteSignaturesOfLearner(learnerId) {
  ensure();
  if (!learnerId) return 0;
  let n = 0;
  for (const f of fs.readdirSync(SIGN_DIR)) {
    if (f.endsWith(`_${learnerId}`)) { try { fs.unlinkSync(path.join(SIGN_DIR, f)); n++; } catch { /* déjà absent */ } }
  }
  return n;
}

// Purge par ancienneté (politique de conservation) : les images antérieures à la
// date donnée sont supprimées, les feuilles et leur scellement restent intacts.
export function purgeSignaturesBefore(cutoffISO) {
  ensure();
  if (!cutoffISO) return 0;
  const anciennes = new Set((read().sheets || []).filter((s) => (s.date || "") < cutoffISO.slice(0, 10)).map((s) => s.id));
  let n = 0;
  for (const f of fs.readdirSync(SIGN_DIR)) {
    if (anciennes.has(f.split("_")[0])) { try { fs.unlinkSync(path.join(SIGN_DIR, f)); n++; } catch { /* ignore */ } }
  }
  return n;
}

// Retire un apprenant des feuilles ENCORE OUVERTES. Les feuilles closes sont
// scellées : on n'y touche pas — c'est l'arbitrage documenté entre le droit à
// l'effacement et l'obligation de conservation de la preuve de réalisation.
export function removeLearnerFromOpenSheets(learnerId) {
  const db = read();
  let n = 0;
  for (const s of db.sheets || []) {
    if (s.status === "locked") continue;
    const avant = (s.entries || []).length;
    s.entries = (s.entries || []).filter((e) => e.learnerId !== learnerId);
    if (s.entries.length !== avant) n++;
  }
  if (n) write(db);
  return n;
}

// Purge des feuilles anciennes. Les feuilles closes sont des preuves : on ne les
// supprime qu'à l'échéance de conservation, et on emporte alors leurs avenants et
// leurs signatures pour ne pas laisser d'orphelins.
export function purgeSheetsBefore(cutoffISO, { dryRun = false } = {}) {
  const db = read();
  const limite = cutoffISO.slice(0, 10);
  const cibles = (db.sheets || []).filter((s) => (s.date || "") < limite);
  if (dryRun) return cibles.length;
  if (!cibles.length) return 0;
  const ids = new Set(cibles.map((s) => s.id));
  ensure();
  for (const f of fs.readdirSync(SIGN_DIR)) {
    if (ids.has(f.split("_")[0])) { try { fs.unlinkSync(path.join(SIGN_DIR, f)); } catch { /* ignore */ } }
  }
  db.sheets = (db.sheets || []).filter((s) => !ids.has(s.id));
  db.amendments = (db.amendments || []).filter((a) => !ids.has(a.sheetId));
  write(db);
  return ids.size;
}

export function countSignaturesBefore(cutoffISO) {
  ensure();
  const anciennes = new Set((read().sheets || []).filter((s) => (s.date || "") < cutoffISO.slice(0, 10)).map((s) => s.id));
  return fs.readdirSync(SIGN_DIR).filter((f) => anciennes.has(f.split("_")[0])).length;
}

export function countSheets() { return (read().sheets || []).length; }

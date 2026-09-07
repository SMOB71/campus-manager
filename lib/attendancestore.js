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
const LEGACY_FILE = path.join(DATA_DIR, "attendance.json");
const PART_DIR = path.join(DATA_DIR, "attendance");
const SIGN_DIR = path.join(DATA_DIR, "signatures");
const EMPTY = { sheets: [], amendments: [] };

export const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

// PARTITIONNEMENT — un fichier par campus et par année scolaire.
//
// POURQUOI : la version précédente réécrivait, re-chiffrait et fsyncait le fichier
// ENTIER à chaque signature, puis vidait tout le cache. Une classe de 25 qui signe
// l'une après l'autre déclenchait donc 25 cycles complets sur un fichier qui, pour
// un réseau de 10 campus, dépasse le million de lignes. C'était le prochain mur.
//
// Une partition = un campus × une année scolaire (septembre → août). Une signature
// ne touche plus que la partition concernée, et le cache des autres reste chaud.
// La chaîne d'empreintes, elle, reste par CAMPUS et traverse les années : les
// lectures de chaîne rechargent donc toutes les partitions du campus.

export function schoolYearOf(dateISO) {
  const d = String(dateISO || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "0000";
  const [y, m] = d.split("-").map(Number);
  return String(m >= 9 ? y : y - 1);
}
const partKey = (campusId, year) => `${campusId || "_sans"}__${year}`;
const partPath = (key) => path.join(PART_DIR, key + ".json");

const _cache = new Map();          // clé de partition -> contenu déchiffré
let _index = null;                 // liste des clés de partition existantes

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGN_DIR)) fs.mkdirSync(SIGN_DIR, { recursive: true });
  if (!fs.existsSync(PART_DIR)) fs.mkdirSync(PART_DIR, { recursive: true });
  migrateLegacy();
}

// Reprise du fichier unique historique : il est éclaté en partitions une seule
// fois, puis renommé pour ne plus être relu.
function migrateLegacy() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  let ancien = null;
  try { ancien = decrypt(fs.readFileSync(LEGACY_FILE, "utf8")); } catch { ancien = null; }
  if (ancien) {
    const parts = new Map();
    const bucket = (campusId, date) => {
      const k = partKey(campusId, schoolYearOf(date));
      if (!parts.has(k)) parts.set(k, { sheets: [], amendments: [] });
      return parts.get(k);
    };
    for (const s of ancien.sheets || []) bucket(s.campusId, s.date).sheets.push(s);
    for (const a of ancien.amendments || []) {
      const s = (ancien.sheets || []).find((x) => x.id === a.sheetId);
      bucket(a.campusId, s?.date || a.at).amendments.push(a);
    }
    for (const [k, contenu] of parts) writePart(k, contenu);
  }
  fs.renameSync(LEGACY_FILE, LEGACY_FILE + ".migre");
  _index = null;
}

function listPartKeys() {
  if (_index) return _index;
  ensure();
  _index = fs.existsSync(PART_DIR)
    ? fs.readdirSync(PART_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
    : [];
  return _index;
}

function readPart(key) {
  if (_cache.has(key)) return _cache.get(key);
  ensure();
  let data = { ...EMPTY };
  const f = partPath(key);
  if (fs.existsSync(f)) {
    try { data = { ...EMPTY, ...(decrypt(fs.readFileSync(f, "utf8")) || {}) }; } catch { data = { ...EMPTY }; }
  }
  _cache.set(key, data);
  return data;
}

function writePart(key, data) {
  if (!fs.existsSync(PART_DIR)) fs.mkdirSync(PART_DIR, { recursive: true });
  const f = partPath(key);
  const tmp = f + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, encrypt(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
  // Seule la partition écrite est invalidée : le reste du cache demeure chaud.
  _cache.delete(key);
  _index = null;
}

// Vue agrégée sur plusieurs partitions (lecture seule).
function readAll(keys) {
  const out = { sheets: [], amendments: [] };
  for (const k of keys) {
    const p = readPart(k);
    out.sheets.push(...(p.sheets || []));
    out.amendments.push(...(p.amendments || []));
  }
  return out;
}
const keysOfCampus = (campusId) => listPartKeys().filter((k) => k.startsWith(`${campusId || "_sans"}__`));
function read(campusId) { return campusId ? readAll(keysOfCampus(campusId)) : readAll(listPartKeys()); }

// Localise la partition d'une feuille ou d'un avenant, puis applique la mutation
// et ne réécrit QUE cette partition.
function mutateSheet(sheetId, fn) {
  for (const k of listPartKeys()) {
    const part = readPart(k);
    const sheet = (part.sheets || []).find((s) => s.id === sheetId);
    if (!sheet) continue;
    const r = fn(sheet, part, k);
    if (r?.error) return r;
    writePart(k, part);
    return r === undefined ? sheet : r;
  }
  return null;
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
  // Lecture ciblée : un filtre de campus ne charge que ses partitions.
  let items = (read(campusId).sheets || []).slice();
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
  const key = partKey(session.campusId, schoolYearOf(session.date));
  const part = readPart(key);
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
  part.sheets.push(sheet);
  writePart(key, part);
  return sheet;
}

// Saisie de l'appel (feuille ouverte uniquement).
export function setEntries(sheetId, entries = []) {
  return mutateSheet(sheetId, (sheet) => {
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
  });
}

// Signature d'un apprenant. L'horodatage est SERVEUR (jamais le poste client) et
// l'image est stockée à part, seule son empreinte entre dans la chaîne.
export function signEntry(sheetId, learnerId, signatureDataUri) {
  return mutateSheet(sheetId, (sheet) => {
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
  });
}

export function readSignature(sheetId, learnerId) {
  const f = path.join(SIGN_DIR, `${sheetId}_${learnerId}`);
  if (!fs.existsSync(f)) return null;
  try { return decryptBuffer(fs.readFileSync(f)).toString("utf8"); } catch { return null; }
}

// Maillons de la chaîne d'un campus : feuilles closes ET avenants, ordonnés.
// La chaîne est par CAMPUS et traverse les années scolaires : on lit donc toutes
// les partitions du campus, pas seulement celle de l'année en cours.
function chainOf(campusId) {
  const db = read(campusId);
  const sheets = (db.sheets || []).filter((s) => s.campusId === campusId && s.status === "locked");
  const ams = (db.amendments || []).filter((a) => a.campusId === campusId);
  return [...sheets, ...ams].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
function chainTail(campusId) {
  const c = chainOf(campusId);
  const last = c[c.length - 1];
  return { seq: last ? (last.seq ?? 0) + 1 : 1, prevHash: last ? last.hash : GENESIS_HASH };
}

// Clôture : fige la feuille et l'accroche à la chaîne du campus.
export function lockSheet(sheetId, lockedBy) {
  return mutateSheet(sheetId, (sheet) => {
  if (sheet.status === "locked") return { error: "feuille déjà close" };
  const tail = chainTail(sheet.campusId);
  sheet.seq = tail.seq;
  sheet.prevHash = tail.prevHash;
  sheet.lockedAt = now();
  sheet.lockedBy = String(lockedBy || "");
  sheet.status = "locked";
  sheet.hash = hashSheet(sheet, sheet.prevHash);
  });
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
  return mutateSheet(sheetId, (sheet, part) => {
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

  const tail = chainTail(sheet.campusId);
  const am = {
    id: id(), kind: "amendment", campusId: sheet.campusId, sheetId: sheet.id,
    learnerId, from: courant.status, to,
    justified: justified === undefined ? null : !!justified,
    reason: String(reason).trim(), at: now(), by: String(by || ""),
    seq: tail.seq, prevHash: tail.prevHash, hash: null,
  };
  am.hash = hashAmendment(am, am.prevHash);
  // L'avenant vit dans la partition de la feuille qu'il corrige.
  part.amendments = part.amendments || [];
  part.amendments.push(am);
  // Copie de lecture sur la feuille, pour l'affichage et les calculs. Elle n'entre
  // PAS dans le sceau de la feuille (le sceau est figé) : la preuve de l'avenant,
  // c'est son propre maillon.
  sheet.amendments = sheet.amendments || [];
  sheet.amendments.push({ id: am.id, at: am.at, by: am.by, learnerId, from: am.from, to: am.to, justified: am.justified, reason: am.reason, seq: am.seq, hash: am.hash });
  });
}

export function listAmendments(campusId) {
  return (read(campusId).amendments || []).filter((a) => !campusId || a.campusId === campusId).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function verifyCampusChain(campusId) {
  return verifyChain(chainOf(campusId));
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
  let n = 0;
  // Parcours partition par partition : seules celles réellement modifiées sont
  // réécrites, au lieu de tout le corpus d'émargement.
  for (const k of listPartKeys()) {
    const part = readPart(k);
    let touche = 0;
    for (const s of part.sheets || []) {
      if (s.status === "locked") continue;
      const avant = (s.entries || []).length;
      s.entries = (s.entries || []).filter((e) => e.learnerId !== learnerId);
      if (s.entries.length !== avant) touche++;
    }
    if (touche) { writePart(k, part); n += touche; }
  }
  return n;
}

// Purge des feuilles anciennes. Les feuilles closes sont des preuves : on ne les
// supprime qu'à l'échéance de conservation, et on emporte alors leurs avenants et
// leurs signatures pour ne pas laisser d'orphelins.
export function purgeSheetsBefore(cutoffISO, { dryRun = false } = {}) {
  const limite = cutoffISO.slice(0, 10);
  let total = 0;
  for (const k of listPartKeys()) {
    const part = readPart(k);
    const cibles = (part.sheets || []).filter((s) => (s.date || "") < limite);
    if (!cibles.length) continue;
    total += cibles.length;
    if (dryRun) continue;
    const ids = new Set(cibles.map((s) => s.id));
    ensure();
    for (const f of fs.readdirSync(SIGN_DIR)) {
      if (ids.has(f.split("_")[0])) { try { fs.unlinkSync(path.join(SIGN_DIR, f)); } catch { /* ignore */ } }
    }
    part.sheets = (part.sheets || []).filter((s) => !ids.has(s.id));
    part.amendments = (part.amendments || []).filter((a) => !ids.has(a.sheetId));
    // Une partition vidée est supprimée : une année purgée ne laisse pas de fichier.
    if (!part.sheets.length && !part.amendments.length) {
      try { fs.unlinkSync(partPath(k)); } catch { /* ignore */ }
      _cache.delete(k); _index = null;
    } else writePart(k, part);
  }
  return total;
}

export function countSignaturesBefore(cutoffISO) {
  ensure();
  const anciennes = new Set((read().sheets || []).filter((s) => (s.date || "") < cutoffISO.slice(0, 10)).map((s) => s.id));
  return fs.readdirSync(SIGN_DIR).filter((f) => anciennes.has(f.split("_")[0])).length;
}

export function countSheets() { return (read().sheets || []).length; }

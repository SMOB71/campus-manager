// Comptes utilisateurs (multi-utilisateurs, roles). Mots de passe haches (scrypt).
// Chiffre au repos comme le reste. Roles : "admin" (DO, voit tout) / "directeur" (scope campus).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt, isEncrypted, encryptionEnabled } from "./crypto-store.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "users.json");

function read() {
  try { return decrypt(fs.readFileSync(FILE, "utf8")) || { users: [] }; } catch { return { users: [] }; }
}
function write(o) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, encrypt(o));
  fs.renameSync(tmp, FILE);
}
const uid = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();
function hash(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString("hex"); }
function eqHex(a, b) { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); }
const norm = (e) => String(e || "").trim().toLowerCase();
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, campusIds: u.campusIds || [], active: u.active !== false, createdAt: u.createdAt });

export function listUsers() { return read().users.map(publicUser).sort((a, b) => a.email.localeCompare(b.email)); }
export function getUser(id) { const u = read().users.find((x) => x.id === id); return u ? publicUser(u) : null; }
export function getUserFull(id) { return read().users.find((x) => x.id === id) || null; }
export function getUserByEmail(email) { return read().users.find((x) => norm(x.email) === norm(email)) || null; }
export function countUsers() { return read().users.length; }

export function verifyUserPassword(user, pw) {
  if (!user || user.active === false || !user.hash || !user.salt) return false;
  return eqHex(hash(pw, user.salt), user.hash);
}

export function addUser({ email, name, role, campusIds, password }) {
  const db = read();
  if (db.users.some((x) => norm(x.email) === norm(email))) throw new Error("Un compte existe déjà avec cet email");
  const salt = crypto.randomBytes(16).toString("hex");
  const u = {
    id: uid(), email: norm(email), name: (name || "").trim(),
    role: role === "admin" ? "admin" : "directeur",
    campusIds: Array.isArray(campusIds) ? campusIds : [],
    salt, hash: hash(password || crypto.randomBytes(6).toString("hex"), salt),
    active: true, createdAt: now(),
  };
  db.users.push(u);
  write(db);
  return publicUser(u);
}

export function updateUser(id, patch = {}) {
  const db = read();
  const u = db.users.find((x) => x.id === id);
  if (!u) return null;
  if ("name" in patch) u.name = String(patch.name || "").trim();
  if ("role" in patch) u.role = patch.role === "admin" ? "admin" : "directeur";
  if ("campusIds" in patch) u.campusIds = Array.isArray(patch.campusIds) ? patch.campusIds : [];
  if ("active" in patch) u.active = !!patch.active;
  if ("email" in patch && patch.email) {
    const e = norm(patch.email);
    if (db.users.some((x) => x.id !== id && norm(x.email) === e)) throw new Error("Email déjà utilisé");
    u.email = e;
  }
  if (patch.password) { const salt = crypto.randomBytes(16).toString("hex"); u.salt = salt; u.hash = hash(patch.password, salt); }
  write(db);
  return publicUser(u);
}

export function setUserPasswordById(id, password) {
  const db = read();
  const u = db.users.find((x) => x.id === id);
  if (!u) return false;
  const salt = crypto.randomBytes(16).toString("hex");
  u.salt = salt; u.hash = hash(password, salt);
  write(db);
  return true;
}

export function deleteUser(id) {
  const db = read();
  db.users = db.users.filter((x) => x.id !== id);
  write(db);
}

// Cree le compte admin initial si aucun utilisateur (a partir de l'env).
export function seedAdmin({ email, password }) {
  const db = read();
  if (db.users.length || !email || !password) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  const u = { id: uid(), email: norm(email), name: "Administrateur", role: "admin", campusIds: [], salt, hash: hash(password, salt), active: true, createdAt: now() };
  db.users.push(u);
  write(db);
  return publicUser(u);
}

// --- Passkeys / Face ID (WebAuthn) ---
export function listCredentials(userId) {
  const u = read().users.find((x) => x.id === userId);
  return (u?.credentials || []).map((c) => ({ id: c.id, deviceName: c.deviceName || "Appareil", createdAt: c.createdAt }));
}
export function getUserCredentials(userId) {
  const u = read().users.find((x) => x.id === userId);
  return u?.credentials || [];
}
export function addCredential(userId, cred) {
  const db = read();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return null;
  u.credentials = u.credentials || [];
  if (u.credentials.some((c) => c.id === cred.id)) return u.credentials;
  u.credentials.push({ id: cred.id, publicKey: cred.publicKey, counter: cred.counter || 0, transports: cred.transports || [], deviceName: (cred.deviceName || "Appareil").trim(), createdAt: now() });
  write(db);
  return u.credentials;
}
export function findUserByCredential(credId) {
  return read().users.find((u) => (u.credentials || []).some((c) => c.id === credId)) || null;
}
export function updateCredentialCounter(userId, credId, counter) {
  const db = read();
  const u = db.users.find((x) => x.id === userId);
  const c = u?.credentials?.find((x) => x.id === credId);
  if (c) { c.counter = counter; write(db); }
}
export function deleteCredential(userId, credId) {
  const db = read();
  const u = db.users.find((x) => x.id === userId);
  if (u && u.credentials) { u.credentials = u.credentials.filter((c) => c.id !== credId); write(db); }
}

export function migrateEncryption() {
  if (!encryptionEnabled || !fs.existsSync(FILE)) return;
  const raw = fs.readFileSync(FILE, "utf8");
  if (!isEncrypted(raw)) { try { write(JSON.parse(raw)); } catch { /* ignore */ } }
}

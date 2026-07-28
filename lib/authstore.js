// Stockage du mot de passe (hache scrypt) + code de reinitialisation, dans DATA_DIR/auth.json.
// Permet de changer / reinitialiser le mot de passe a l'execution (l'env APP_PASSWORD
// ne sert que de valeur initiale si rien n'est encore stocke).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt, isEncrypted, encryptionEnabled } from "./crypto-store.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "auth.json");

function read() {
  try { return decrypt(fs.readFileSync(FILE, "utf8")) || {}; } catch { return {}; }
}
function write(o) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, encrypt(o));
  fs.renameSync(tmp, FILE);
}
export function migrateEncryption() {
  if (!encryptionEnabled || !fs.existsSync(FILE)) return;
  const raw = fs.readFileSync(FILE, "utf8");
  if (!isEncrypted(raw)) { try { write(JSON.parse(raw)); } catch { /* ignore */ } }
}
function hash(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString("hex"); }
function eqHex(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function hasStoredPassword() { return !!read().hash; }

export function setPassword(pw) {
  const a = read();
  const salt = crypto.randomBytes(16).toString("hex");
  a.salt = salt; a.hash = hash(pw, salt);
  delete a.reset;
  write(a);
}

export function verifyPassword(pw) {
  const a = read();
  if (a.hash && a.salt) return eqHex(hash(pw, a.salt), a.hash);
  const env = process.env.APP_PASSWORD || "";
  return env ? eqHex(pw, env) : false;
}

// Code de reinitialisation a usage unique (15 min)
export function setResetCode(code) {
  const a = read();
  a.reset = { hash: hash(code, "reset-salt"), exp: Date.now() + 15 * 60 * 1000, tries: 0 };
  write(a);
}
export function verifyResetCode(code) {
  const a = read();
  if (!a.reset || Date.now() > a.reset.exp) return false;
  a.reset.tries = (a.reset.tries || 0) + 1;
  if (a.reset.tries > 6) { delete a.reset; write(a); return false; }
  write(a);
  return eqHex(hash(code, "reset-salt"), a.reset.hash);
}
export function clearReset() { const a = read(); delete a.reset; write(a); }

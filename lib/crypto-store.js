// Chiffrement au repos AES-256-GCM. Clé dérivée de DATA_KEY (env) via scrypt.
// Format sur disque : "ENC1:<iv b64>:<tag b64>:<ciphertext b64>".
// Rétro-compatible : un fichier en clair (JSON) est lu tel quel (migration transparente).
import crypto from "crypto";

const PASS = process.env.DATA_KEY || "";
export const encryptionEnabled = !!PASS;
const KEY = PASS ? crypto.scryptSync(PASS, "campus-manager-v1", 32) : null;
const MAGIC = "ENC1:";

export function isEncrypted(raw) {
  return typeof raw === "string" && raw.startsWith(MAGIC);
}

export function encrypt(obj) {
  const plain = JSON.stringify(obj, null, 2);
  if (!KEY) return plain; // pas de clé => on reste en clair
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return MAGIC + iv.toString("base64") + ":" + tag.toString("base64") + ":" + enc.toString("base64");
}

export function decrypt(raw) {
  if (raw == null || raw === "") return null;
  if (!isEncrypted(raw)) return JSON.parse(raw); // clair (ou pas de clé)
  if (!KEY) throw new Error("DATA_KEY requise pour lire des données chiffrées");
  const [, ivb, tagb, encb] = raw.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivb, "base64"));
  d.setAuthTag(Buffer.from(tagb, "base64"));
  const dec = Buffer.concat([d.update(Buffer.from(encb, "base64")), d.final()]);
  return JSON.parse(dec.toString("utf8"));
}

// --- Fichiers binaires (GED) : format [4o magic "ENCB"][12o iv][16o tag][ct] ---
const BMAGIC = Buffer.from("ENCB");
export function encryptBuffer(buf) {
  if (!KEY) return buf; // pas de clé => brut
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([BMAGIC, iv, c.getAuthTag(), enc]);
}
export function decryptBuffer(buf) {
  if (!buf || buf.length < 32 || !buf.subarray(0, 4).equals(BMAGIC)) return buf; // brut
  if (!KEY) throw new Error("DATA_KEY requise pour lire un fichier chiffré");
  const iv = buf.subarray(4, 16), tag = buf.subarray(16, 32), ct = buf.subarray(32);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

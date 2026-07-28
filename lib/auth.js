// Session signee HMAC portant l'identifiant utilisateur : payload = "<userId>.<exp>".
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "";
const COOKIE = "ac_session";
const CSRF_COOKIE = "ac_csrf";
const MAX_AGE_MS = 1000 * 60 * 60 * Number(process.env.SESSION_HOURS || 8); // defaut 8h

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function issueCookie(res, userId) {
  const exp = Date.now() + MAX_AGE_MS;
  const payload = `${userId}.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE);
  res.clearCookie(CSRF_COOKIE);
}

// --- Protection CSRF (double-submit token) ---
// Cookie LISIBLE par le JS (pas httpOnly) : le SPA le renvoie dans l'en-tête X-CSRF-Token.
// SameSite=lax + impossibilité de lire le cookie / poser l'en-tête cross-site => CSRF bloqué.
export function issueCsrf(req, res) {
  let tok = req.cookies?.[CSRF_COOKIE];
  if (!tok || !/^[a-f0-9]{48}$/.test(tok)) tok = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE, tok, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
  return tok;
}

// Vrai si l'en-tête X-CSRF-Token correspond au cookie double-submit.
export function csrfValid(req) {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("X-CSRF-Token");
  return !!cookie && !!header && safeEqual(cookie, header);
}

// Retourne l'userId si la session est valide, sinon null.
export function sessionUserId(req) {
  if (!SECRET) return null;
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  if (!safeEqual(mac, sign(`${userId}.${exp}`))) return null;
  const e = Number(exp);
  if (!Number.isFinite(e) || e <= Date.now()) return null;
  return userId;
}

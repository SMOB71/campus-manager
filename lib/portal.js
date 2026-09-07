// Portails externes (apprenant, formateur, tuteur entreprise) — logique pure.
//
// SURFACE EXPOSÉE : c'est la première fois que l'application s'ouvre à des gens
// qui ne sont pas salariés de l'organisme. Les choix de sécurité sont donc
// délibérés et documentés ici (point S-3 du backlog sécurité) :
//
// 1. ACCÈS PAR LIEN SIGNÉ, PAS PAR MOT DE PASSE. Demander à 400 apprentis et à
//    leurs tuteurs de gérer un mot de passe produit des mots de passe faibles,
//    partagés et jamais renouvelés. Un lien long, aléatoire et révocable est plus
//    sûr en pratique — c'est le modèle des portails de santé et de scolarité.
// 2. LE JETON N'EST JAMAIS STOCKÉ EN CLAIR. Seule son empreinte SHA-256 est
//    conservée : une fuite du store ne donne accès à rien (même raisonnement que
//    pour un mot de passe).
// 3. RÉVOCABLE ET DATÉ. Chaque accès porte une expiration et peut être révoqué
//    individuellement — contrairement à un jeton purement stateless.
// 4. PORTÉE MINIMALE. Un jeton ne désigne qu'un sujet (un apprenant, un
//    formateur, un tuteur) ; toute donnée renvoyée est filtrée sur ce sujet.

import crypto from "crypto";

export const PORTAL_KINDS = ["learner", "teacher", "tutor", "guardian"];
export const KIND_LABEL = { learner: "Apprenant", teacher: "Formateur", tutor: "Tuteur entreprise", guardian: "Représentant légal" };

// Le représentant légal d'un mineur a un accès en LECTURE au dossier de l'enfant.
// Il ne signe pas à sa place et ne modifie rien : il consulte et justifie une
// absence, ce qui relève bien de l'autorité parentale.
export const GUARDIAN_READONLY = true;

// Durées par défaut : un apprenant garde son accès l'année scolaire, un tuteur
// le temps du contrat, un formateur l'année. Surchargeable à la création.
export const DEFAULT_TTL_DAYS = { learner: 365, teacher: 365, tutor: 400, guardian: 365 };

// 32 octets d'aléa en base64url : impraticable à deviner, court à copier.
export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export const hashToken = (token) => crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");

// Comparaison à temps constant : évite qu'un attaquant déduise le jeton octet
// par octet en mesurant les temps de réponse.
export function tokenMatches(token, storedHash) {
  const a = Buffer.from(hashToken(token), "utf8");
  const b = Buffer.from(String(storedHash || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function expiryFor(kind, days) {
  const d = Number(days) || DEFAULT_TTL_DAYS[kind] || 365;
  return new Date(Date.now() + d * 864e5).toISOString();
}

// Un accès n'est valable que s'il existe, n'est pas révoqué et n'est pas expiré.
export function accessState(access, nowISO) {
  const now = nowISO || new Date().toISOString();
  if (!access) return { valid: false, reason: "inconnu" };
  if (access.revokedAt) return { valid: false, reason: "révoqué" };
  if (access.expiresAt && access.expiresAt < now) return { valid: false, reason: "expiré" };
  return { valid: true };
}

// Limitation de débit propre au portail : une adresse qui essaie des jetons au
// hasard est bloquée avant d'en trouver un. Fenêtre glissante en mémoire.
export function makeRateLimiter({ max = 20, windowMs = 60000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(key, list);
      // Purge opportuniste pour que la Map ne grossisse pas indéfiniment.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return { allowed: list.length <= max, remaining: Math.max(0, max - list.length) };
    },
    reset() { hits.clear(); },
  };
}

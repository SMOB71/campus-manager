// Clés d'API — logique pure (aucune I/O).
//
// POURQUOI CE MODULE EXISTE AVANT LA DOCUMENTATION — l'application
// s'authentifiait uniquement par cookie de session, avec jeton anti-CSRF.
// Parfait pour un navigateur, inutilisable par un programme tiers. Publier une
// « documentation d'API publique » sur cette base aurait documenté quelque
// chose que personne ne peut appeler.
//
// TROIS PROPRIÉTÉS DE SÛRETÉ, dans l'ordre d'importance :
//
//   1. UNE CLÉ NE PEUT JAMAIS DÉPASSER LES DROITS DE CELUI QUI LA CRÉE. Sans
//      cette règle, un directeur limité à son campus émettrait une clé sans
//      restriction et s'octroierait le réseau entier. C'est une élévation de
//      privilèges déguisée en fonctionnalité d'intégration.
//
//   2. LA CLÉ N'EST MONTRÉE QU'UNE FOIS. Seule son empreinte est conservée,
//      comme pour les jetons de portail. Une clé qu'on peut relire dans une
//      interface est une clé qu'un accès en lecture à la base suffit à voler.
//
//   3. TOUT ÉCHEC EST FERMANT. Clé inconnue, révoquée, expirée, portée
//      insuffisante, campus hors périmètre : refus. Jamais de repli permissif.
//
// Le préfixe visible (`cm_live_a1b2c3d4…`) sert à identifier une clé dans une
// liste et dans les journaux sans jamais exposer le secret : on peut dire « la
// clé a1b2c3d4 a été utilisée » sans rien révéler.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export const PREFIXE = "cm_live_";
export const LONGUEUR_IDENTIFIANT = 8;

// Portées par ressource. `:write` implique `:read` sur la MÊME ressource : une
// intégration qui crée des apprenants a toujours besoin de les relire, et
// exiger les deux ne protège de rien — cela produit seulement des clés mal
// configurées et des tickets de support.
export const SCOPES = {
  "learners:read": "Lire les dossiers apprenants et leurs inscriptions",
  "learners:write": "Créer et modifier des dossiers apprenants",
  "attendance:read": "Lire les feuilles d'émargement closes et les attestations",
  "contracts:read": "Lire les contrats d'alternance",
  "billing:read": "Lire les financements, factures et règlements",
  "declarations:read": "Lire les données de déclaration (SIFA, BPF)",
};

export const SCOPE_IDS = Object.keys(SCOPES);

export function scopesEffectifs(scopes = []) {
  const out = new Set();
  for (const s of scopes) {
    if (!SCOPE_IDS.includes(s)) continue;
    out.add(s);
    if (s.endsWith(":write")) {
      const lecture = s.replace(/:write$/, ":read");
      if (SCOPE_IDS.includes(lecture)) out.add(lecture);
    }
  }
  return [...out].sort();
}

export function generate() {
  const secret = randomBytes(32).toString("base64url");
  const cle = PREFIXE + secret;
  return { cle, identifiant: secret.slice(0, LONGUEUR_IDENTIFIANT), hash: hash(cle) };
}

export const hash = (cle) => createHash("sha256").update(String(cle || ""), "utf8").digest("hex");

// Comparaison à temps constant : une comparaison naïve laisse fuir l'empreinte
// octet par octet à celui qui sait mesurer.
export function correspond(cle, hashStocke) {
  if (!cle || !hashStocke) return false;
  const a = Buffer.from(hash(cle), "utf8");
  const b = Buffer.from(String(hashStocke), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Extraction de l'en-tête. On accepte `Authorization: Bearer <clé>` — la forme
// qu'attend tout client HTTP — et rien d'autre : une clé passée en paramètre
// d'URL finirait dans les journaux du proxy et l'historique du navigateur.
export function depuisEntete(authorization) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(authorization || ""));
  const cle = m ? m[1] : null;
  return cle && cle.startsWith(PREFIXE) ? cle : null;
}

export function validateCreation(demande = {}, createur = {}) {
  const errors = [];
  const nom = String(demande.nom || "").trim();
  if (!nom) errors.push("nom de la clé requis — il servira à l'identifier et à la révoquer");

  const demandes = Array.isArray(demande.scopes) ? demande.scopes : [];
  const inconnues = demandes.filter((s) => !SCOPE_IDS.includes(s));
  if (inconnues.length) errors.push(`portée inconnue : ${inconnues.join(", ")}`);
  if (!demandes.length) errors.push("au moins une portée requise");

  // Propriété n° 1 : le plafond, c'est le créateur.
  // `campusIds` du créateur à null = accès total (administrateur).
  const campusCreateur = createur.campusIds ?? null;
  let campusIds = Array.isArray(demande.campusIds) && demande.campusIds.length ? demande.campusIds : null;
  if (campusCreateur !== null) {
    if (!campusIds) {
      // Une clé sans restriction demandée par un compte restreint hérite du
      // périmètre du compte, elle ne l'élargit pas.
      campusIds = [...campusCreateur];
    } else {
      const horsPerimetre = campusIds.filter((c) => !campusCreateur.includes(c));
      if (horsPerimetre.length) {
        errors.push(`campus hors de votre périmètre : ${horsPerimetre.join(", ")} — une clé ne peut pas dépasser les droits de celui qui la crée`);
      }
    }
  }
  if (demande.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(demande.expiresAt)) {
    errors.push("date d'expiration attendue au format AAAA-MM-JJ");
  }

  return {
    ok: errors.length === 0, errors,
    demande: { nom, scopes: scopesEffectifs(demandes), campusIds, expiresAt: demande.expiresAt || null },
  };
}

export function etat(cle = {}, aujourdhui) {
  if (cle.revokedAt) return { actif: false, motif: "clé révoquée" };
  if (cle.expiresAt && aujourdhui && cle.expiresAt < aujourdhui) return { actif: false, motif: "clé expirée" };
  return { actif: true, motif: null };
}

// Autorisation d'un appel. Renvoie un motif exploitable : une intégration qui
// reçoit « 403 » sans rien d'autre coûte une demi-journée à son auteur.
export function autorise(cle, { scope = null, campusId = null, aujourdhui = null, verifierCampus = true } = {}) {
  if (!cle) return { ok: false, code: "cle_inconnue", error: "clé d'API inconnue" };
  const e = etat(cle, aujourdhui);
  if (!e.actif) return { ok: false, code: "cle_inactive", error: e.motif };

  if (scope && !(cle.scopes || []).includes(scope)) {
    return { ok: false, code: "portee_insuffisante", error: `cette clé ne porte pas la portée « ${scope} »` };
  }
  // Une clé restreinte à des campus ne voit rien ailleurs, et un appel sans
  // campus sur une clé restreinte est refusé plutôt qu'élargi silencieusement.
  // `verifierCampus: false` pour les points d'entrée qui ne touchent aucune
  // donnée d'organisme — /v1/me décrit la clé elle-même, exiger un campus pour
  // la lire empêcherait une intégration restreinte de vérifier sa configuration.
  if (cle.campusIds && verifierCampus) {
    if (!campusId) return { ok: false, code: "campus_requis", error: "cette clé est limitée à certains campus : préciser campusId" };
    if (!cle.campusIds.includes(campusId)) {
      return { ok: false, code: "campus_hors_perimetre", error: "campus hors du périmètre de cette clé" };
    }
  }
  return { ok: true };
}

// Ce qu'on peut afficher : jamais le secret, jamais son empreinte.
export function publique(cle = {}) {
  return {
    id: cle.id, nom: cle.nom, identifiant: cle.identifiant,
    apercu: cle.identifiant ? `${PREFIXE}${cle.identifiant}…` : null,
    scopes: cle.scopes || [], campusIds: cle.campusIds || null,
    createdAt: cle.createdAt || null, createdBy: cle.createdBy || null,
    expiresAt: cle.expiresAt || null, revokedAt: cle.revokedAt || null,
    lastUsedAt: cle.lastUsedAt || null,
    // Une clé jamais utilisée depuis des mois est une clé à révoquer : c'est la
    // seule information qui permet de faire le ménage sans rien casser.
    jamaisUtilisee: !cle.lastUsedAt,
  };
}

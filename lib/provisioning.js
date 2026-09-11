// Provisioning d'instances clientes — logique pure (aucune I/O, aucun Docker).
//
// Chaque client a SON instance : son conteneur, son volume, sa clé de
// chiffrement, son sous-domaine. Pas de base partagée, donc pas de fuite
// possible d'un organisme vers un autre par une requête mal filtrée.
//
// LA PROPRIÉTÉ DE SÛRETÉ QUI PRIME SUR TOUT — la clé `DATA_KEY` chiffre les
// données au repos. La régénérer sur une instance existante rend l'intégralité
// de ses données définitivement illisibles : émargements scellés, contrats,
// factures. Aucun chemin de ce module ne produit une nouvelle clé pour un slug
// déjà présent au registre ; `planCreate` refuse, et c'est un refus, pas un
// avertissement.
//
// Le registre décrit la flotte. Il ne contient JAMAIS de secret : les clés et
// mots de passe vivent uniquement dans le fichier `.env` de l'instance, en 600.

import { randomBytes } from "node:crypto";
import { PLANS, PLAN_IDS } from "./licence.js";

export const PORT_BASE = 3300;
export const PORT_MAX = 3399;
export const RACINE = "/opt/campus-clients";
export const DOMAINE = "campusmanager.fr";
export const IMAGE = "assistant-campus:local";
// L'IP de la passerelle Docker sur laquelle le reverse proxy vient chercher les
// conteneurs. Exposer sur 0.0.0.0 rendrait chaque instance joignable depuis
// l'extérieur en clair, hors du proxy et donc hors TLS.
export const BIND_IP = "172.19.0.1";
// Réseau et base partagés par la flotte. L'isolation entre organismes n'est pas
// logique mais PHYSIQUE : une base de données par client, un rôle par client,
// aucun droit sur les autres. Une requête mal filtrée ne peut pas franchir une
// frontière qui n'existe pas au niveau SQL.
export const RESEAU = "campus-net";
export const PG_HOTE = "campus-pg";
export const dbName = (slug) => "cm_" + slug.replace(/-/g, "_");
export const dbRole = (slug) => "cm_" + slug.replace(/-/g, "_");

// Un slug devient un sous-domaine, un nom de conteneur ET un nom de dossier.
// Il doit donc être sûr dans les trois mondes à la fois : pas de point (qui
// créerait un niveau de sous-domaine), pas de séparateur de chemin, pas de
// majuscule (les noms de conteneurs et les DNS n'en veulent pas).
export const SLUG_RE = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/;

// Réservés parce qu'ils désignent déjà quelque chose sur le domaine, ou parce
// qu'ils prêteraient à confusion dans un email de phishing.
export const SLUGS_RESERVES = [
  "www", "app", "api", "admin", "mail", "smtp", "imap", "webmail", "mx", "ns",
  "static", "cdn", "assets", "status", "docs", "doc", "support", "aide", "help",
  "compte", "comptes", "login", "auth", "sso", "billing", "facturation",
  "stripe", "demo", "test", "staging", "preprod", "prod", "backup", "backups",
  "campusmanager", "monitoring", "grafana", "metrics",
];

export function validateSlug(slug) {
  const s = String(slug || "");
  if (!s) return { ok: false, error: "identifiant requis" };
  if (s !== s.toLowerCase()) return { ok: false, error: "identifiant en minuscules uniquement" };
  if (!SLUG_RE.test(s)) {
    return { ok: false, error: "identifiant invalide : 3 à 30 caractères, lettres minuscules, chiffres et tirets, commençant par une lettre" };
  }
  if (s.includes("--")) return { ok: false, error: "deux tirets consécutifs ne sont pas autorisés" };
  if (SLUGS_RESERVES.includes(s)) return { ok: false, error: `« ${s} » est un identifiant réservé` };
  return { ok: true };
}

// Secret aléatoire cryptographique. base64url : sûr dans un fichier .env sans
// guillemets, sans caractère que le shell interpréterait.
export function secret(octets = 32) {
  return randomBytes(octets).toString("base64url");
}

// Mot de passe initial lisible à l'oral : on l'épelle au téléphone lors de la
// mise en service. Alphabet sans 0/O/1/I/l, qui se confondent.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
export function motDePasseInitial(longueur = 16) {
  const octets = randomBytes(longueur);
  let out = "";
  for (const o of octets) out += ALPHABET[o % ALPHABET.length];
  return out;
}

// Le port est alloué au plus bas libre : la flotte reste compacte et lisible,
// et un port libéré par une résiliation se réutilise.
export function allocatePort(registre = [], { base = PORT_BASE, max = PORT_MAX } = {}) {
  const pris = new Set(registre.map((i) => Number(i.port)).filter(Boolean));
  for (let p = base; p <= max; p++) if (!pris.has(p)) return p;
  return null;
}

export const instanceDir = (slug, racine = RACINE) => `${racine}/${slug}`;
export const conteneurName = (slug) => `cm-${slug}`;
export const hostFor = (slug, domaine = DOMAINE) => `${slug}.${domaine}`;

// Rendu du .env de l'instance. Les valeurs sont écrites telles quelles : c'est
// pour cela que les secrets sont en base64url et que le reste est validé en
// amont — une valeur contenant un saut de ligne casserait le fichier.
export function renderEnv(inst, { extra = {} } = {}) {
  const lignes = [
    "# Instance Campus Manager — généré par scripts/provision.mjs",
    `# Client : ${inst.nom}`,
    `# Créée le : ${inst.creeLe}`,
    "# NE JAMAIS committer ce fichier. NE JAMAIS régénérer DATA_KEY :",
    "# les données chiffrées au repos deviendraient définitivement illisibles.",
    "",
    `NODE_ENV=production`,
    `PORT=3200`,
    `DATA_DIR=/app/data`,
    `DATA_KEY=${inst.dataKey}`,
    `SESSION_SECRET=${inst.sessionSecret}`,
    `ADMIN_EMAIL=${inst.adminEmail}`,
    `APP_PASSWORD=${inst.adminPassword}`,
    `RP_ID=${inst.host}`,
    `DATABASE_URL=postgres://${dbRole(inst.slug)}:${inst.dbPassword}@${PG_HOTE}:5432/${dbName(inst.slug)}`,
    "",
    "# Licence — lue au démarrage, pilotée par l'abonnement Stripe",
    `LICENCE_PLAN=${inst.plan}`,
    `LICENCE_CLIENT=${inst.nom}`,
    inst.validUntil ? `LICENCE_VALID_UNTIL=${inst.validUntil}` : "# LICENCE_VALID_UNTIL= (aucune échéance)",
    "",
    "# À compléter à la mise en service",
    "# OPENAI_API_KEY=",
    "# MAIL_HOST= / MAIL_USER= / MAIL_PASS= / MAIL_FROM=",
  ];
  for (const [k, v] of Object.entries(extra)) lignes.push(`${k}=${v}`);
  return lignes.join("\n") + "\n";
}

// Vhost nginx de l'instance. Le certificat est celui du sous-domaine ; tant
// qu'il n'est pas émis, servir le vhost en HTTPS ferait échouer le rechargement
// de nginx et couperait TOUTES les autres instances — d'où l'étape ACME séparée
// dans le script, en HTTP d'abord.
export function renderNginx(inst, { domaine = DOMAINE, bindIp = BIND_IP, tls = true } = {}) {
  const host = inst.host || hostFor(inst.slug, domaine);
  const amont = `http://${bindIp}:${inst.port}`;
  const proxy = `        proxy_pass ${amont};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;`;
  if (!tls) {
    return `# Campus Manager — ${inst.nom} (${host}) — phase ACME, avant émission du certificat
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / {
${proxy}
    }
}
`;
  }
  return `# Campus Manager — ${inst.nom} (${host})
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${host};

    ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
${proxy}
    }
}
`;
}

// Commande de démarrage du conteneur. Le volume porte les données du client ;
// il n'est jamais recréé, seule l'image change à chaque mise à jour.
export function dockerRunArgs(inst, { racine = RACINE, image = IMAGE, bindIp = BIND_IP } = {}) {
  return [
    "run", "-d",
    "--name", conteneurName(inst.slug),
    "--network", RESEAU,
    "--restart", "unless-stopped",
    "--env-file", `${instanceDir(inst.slug, racine)}/.env`,
    "-v", `${instanceDir(inst.slug, racine)}/data:/app/data`,
    "-p", `${bindIp}:${inst.port}:3200`,
    image,
  ];
}

// Plan de création. Fonction PURE : elle ne crée rien, elle décrit ce qui sera
// fait et refuse tout ce qui serait destructeur. Le script exécute ensuite.
export function planCreate(registre = [], entree = {}, { racine = RACINE, domaine = DOMAINE, aujourdhui = null } = {}) {
  const slug = String(entree.slug || "").trim();
  const v = validateSlug(slug);
  if (!v.ok) return { ok: false, error: v.error };

  // Le garde-fou central : un slug déjà servi ne se recrée pas. Repartir de zéro
  // signifierait une nouvelle DATA_KEY, donc la perte de toutes les données.
  const existant = registre.find((i) => i.slug === slug);
  if (existant) {
    return {
      ok: false, code: "instance_existante",
      error: `L'instance « ${slug} » existe déjà (port ${existant.port}, créée le ${existant.creeLe}). ` +
        "La recréer régénérerait sa clé de chiffrement et rendrait ses données définitivement illisibles. " +
        "Utiliser une mise à jour, ou choisir un autre identifiant.",
      existant,
    };
  }
  // Un port encore occupé par une instance archivée reste réservé : le
  // conteneur ou le volume peuvent survivre à la résiliation.
  const port = allocatePort(registre);
  if (!port) return { ok: false, error: `plus de port disponible dans la plage ${PORT_BASE}-${PORT_MAX}` };

  const nom = String(entree.nom || "").trim();
  if (!nom) return { ok: false, error: "nom du client requis" };
  const adminEmail = String(entree.adminEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail)) return { ok: false, error: "email d'administrateur invalide" };
  const plan = String(entree.plan || "essentiel");
  if (!PLAN_IDS.includes(plan)) return { ok: false, error: `plan inconnu : ${plan} (attendu : ${PLAN_IDS.join(", ")})` };
  if (entree.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(entree.validUntil)) {
    return { ok: false, error: "date de fin de licence attendue au format AAAA-MM-JJ" };
  }

  const instance = {
    slug, nom, plan, port,
    host: hostFor(slug, domaine),
    adminEmail,
    adminPassword: entree.adminPassword || motDePasseInitial(),
    dataKey: secret(32),
    sessionSecret: secret(32),
    // Mot de passe de la base : base64url, donc sûr dans une URL de connexion
    // sans encodage — un « / » ou un « @ » y couperait la chaîne en deux.
    dbPassword: secret(24),
    validUntil: entree.validUntil || null,
    creeLe: aujourdhui || new Date().toISOString().slice(0, 10),
    dossier: instanceDir(slug, racine),
    conteneur: conteneurName(slug),
    statut: "actif",
  };
  return { ok: true, instance, plafonds: PLANS[plan] };
}

// Ce qui entre au registre : tout sauf les secrets. Le registre est lisible par
// l'exploitation et sauvegardé ; les secrets n'y ont pas leur place.
const CHAMPS_PUBLICS = ["slug", "nom", "plan", "port", "host", "adminEmail", "validUntil", "creeLe", "dossier", "conteneur", "statut", "stripeCustomerId", "stripeSubscriptionId", "archiveLe"];
export function toRegistry(instance) {
  const out = {};
  for (const k of CHAMPS_PUBLICS) if (instance[k] !== undefined) out[k] = instance[k];
  return out;
}

// Contrôle de cohérence de la flotte : deux instances sur le même port, ou deux
// slugs identiques, se traduiraient par une instance injoignable ou, pire, par
// un client servi à la place d'un autre.
export function auditRegistry(registre = []) {
  const problemes = [];
  const parPort = new Map(), parSlug = new Map(), parHost = new Map();
  for (const i of registre) {
    for (const [carte, cle, libelle] of [[parPort, i.port, "port"], [parSlug, i.slug, "identifiant"], [parHost, i.host, "sous-domaine"]]) {
      if (cle == null) continue;
      if (carte.has(cle)) problemes.push({ gravite: "critique", message: `${libelle} ${cle} partagé par « ${carte.get(cle)} » et « ${i.slug} »` });
      else carte.set(cle, i.slug);
    }
    const v = validateSlug(i.slug);
    if (!v.ok) problemes.push({ gravite: "critique", message: `identifiant invalide au registre : ${i.slug} — ${v.error}` });
    if (i.port != null && (i.port < PORT_BASE || i.port > PORT_MAX)) {
      problemes.push({ gravite: "avertissement", message: `port hors plage pour « ${i.slug} » : ${i.port}` });
    }
    if (i.plan && !PLAN_IDS.includes(i.plan)) {
      problemes.push({ gravite: "avertissement", message: `plan inconnu pour « ${i.slug} » : ${i.plan}` });
    }
  }
  return { ok: problemes.filter((p) => p.gravite === "critique").length === 0, problemes, total: registre.length };
}

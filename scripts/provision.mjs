#!/usr/bin/env node
// Provisioning d'une instance cliente Campus Manager.
//
// La logique de décision vit dans lib/provisioning.js et elle est testée ; ce
// script n'est que le bras : il exécute ce que le plan a autorisé, dans l'ordre,
// en s'arrêtant à la première anomalie.
//
// SÉCURITÉ D'EXÉCUTION — rien ne s'exécute sans `--apply`. Par défaut la
// commande affiche ce qu'elle ferait. Un outil qui crée des conteneurs, écrit
// des vhosts et recharge le proxy de TOUS les clients ne doit pas pouvoir
// partir sur une faute de frappe.
//
// Usage :
//   node scripts/provision.mjs list
//   node scripts/provision.mjs audit
//   node scripts/provision.mjs create --slug=cfa-lumiere --nom="CFA Lumière" \
//        --email=direction@cfa-lumiere.fr --plan=reseau [--valid-until=2027-09-30] [--apply]
//   node scripts/provision.mjs update <slug> [--apply]     # nouvelle image, données conservées
//   node scripts/provision.mjs suspend|resume <slug> [--apply]
//
// PRÉREQUIS DNS — le sous-domaine doit résoudre vers ce VPS AVANT la création :
// le challenge HTTP-01 de Let's Encrypt passe par lui. Un enregistrement
// générique `*.campusmanager.fr A <ip>` couvre tous les clients d'un coup.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  planCreate, renderEnv, renderNginx, dockerRunArgs, toRegistry, auditRegistry,
  validateSlug, instanceDir, conteneurName, RACINE, IMAGE,
} from "../lib/provisioning.js";
import { PLANS } from "../lib/licence.js";

const RACINE_FLOTTE = process.env.CM_RACINE || RACINE;
const REGISTRE = path.join(RACINE_FLOTTE, "registry.json");
const NGINX_DIR = process.env.CM_NGINX_DIR || "/opt/iarbiter/docker/nginx/conf.d";
const NGINX_CONTAINER = process.env.CM_NGINX_CONTAINER || "iarbiter-nginx";
const CERTBOT_CONF = process.env.CM_CERTBOT_CONF || "/opt/iarbiter/docker/certbot/conf";
const CERTBOT_WWW = process.env.CM_CERTBOT_WWW || "/opt/iarbiter/docker/certbot/www";
const SOURCE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const args = process.argv.slice(2);
const commande = args[0];
const positionnels = args.slice(1).filter((a) => !a.startsWith("--"));
const flag = (nom, defaut = null) => {
  const trouve = args.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : args.includes(`--${nom}`) ? true : defaut;
};
const APPLY = flag("apply") === true;

const c = { g: "\x1b[32m", r: "\x1b[31m", j: "\x1b[33m", d: "\x1b[2m", n: "\x1b[0m", b: "\x1b[1m" };
const dire = (...m) => console.log(...m);
const etape = (n, t) => dire(`${c.b}[${n}]${c.n} ${t}`);
const mourir = (m) => { console.error(`${c.r}✗ ${m}${c.n}`); process.exit(1); };

function lireRegistre() {
  if (!existsSync(REGISTRE)) return [];
  try { const j = JSON.parse(readFileSync(REGISTRE, "utf8")); return Array.isArray(j) ? j : j.instances || []; }
  catch (e) { mourir(`registre illisible (${REGISTRE}) : ${e.message} — ne pas continuer, une écriture écraserait la flotte`); }
}
function ecrireRegistre(liste) {
  mkdirSync(RACINE_FLOTTE, { recursive: true });
  writeFileSync(REGISTRE, JSON.stringify(liste, null, 2) + "\n");
}

// Toute commande externe passe par ici : jamais de shell, donc jamais
// d'interprétation d'un nom de client dans une ligne de commande.
function run(bin, argv, { silencieux = false } = {}) {
  if (!APPLY) { dire(`${c.d}    (simulé) ${bin} ${argv.join(" ")}${c.n}`); return ""; }
  try {
    return execFileSync(bin, argv, { encoding: "utf8", stdio: silencieux ? "pipe" : ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`${bin} ${argv.slice(0, 3).join(" ")} → ${(e.stderr || e.message || "").toString().trim().slice(0, 400)}`);
  }
}

// Le rechargement du proxy est le geste le plus dangereux du script : il porte
// TOUS les clients. On teste la configuration d'abord, et on restaure le vhost
// précédent si le test échoue — sinon le prochain redémarrage de nginx couperait
// l'ensemble de la flotte, pas seulement le client en cours de création.
function rechargerNginx(vhostEcrit = null, contenuPrecedent = null) {
  if (!APPLY) { dire(`${c.d}    (simulé) nginx -t && nginx -s reload${c.n}`); return; }
  try {
    execFileSync("docker", ["exec", NGINX_CONTAINER, "nginx", "-t"], { stdio: "pipe" });
  } catch (e) {
    if (vhostEcrit) {
      if (contenuPrecedent == null) execFileSync("rm", ["-f", vhostEcrit]);
      else writeFileSync(vhostEcrit, contenuPrecedent);
      dire(`${c.j}    vhost retiré : la configuration nginx était invalide${c.n}`);
    }
    throw new Error(`configuration nginx invalide, rechargement annulé : ${(e.stderr || "").toString().trim().slice(0, 300)}`);
  }
  execFileSync("docker", ["exec", NGINX_CONTAINER, "nginx", "-s", "reload"], { stdio: "pipe" });
}

// ---------------------------------------------------------------- list / audit

function cmdList() {
  const registre = lireRegistre();
  if (!registre.length) return dire(`${c.d}aucune instance (${REGISTRE})${c.n}`);
  dire(`${c.b}${"IDENTIFIANT".padEnd(20)}${"PLAN".padEnd(11)}${"PORT".padEnd(7)}${"STATUT".padEnd(10)}SOUS-DOMAINE${c.n}`);
  for (const i of registre) {
    const teinte = i.statut === "actif" ? c.g : i.statut === "suspendu" ? c.j : c.d;
    dire(`${i.slug.padEnd(20)}${(i.plan || "?").padEnd(11)}${String(i.port).padEnd(7)}${teinte}${(i.statut || "?").padEnd(10)}${c.n}${i.host}`);
  }
  dire(`\n${registre.length} instance(s).`);
}

function cmdAudit() {
  const registre = lireRegistre();
  const a = auditRegistry(registre);
  dire(`${registre.length} instance(s) au registre.`);
  // Le registre dit ce qui devrait tourner ; docker dit ce qui tourne. L'écart
  // entre les deux est exactement ce qu'un audit doit faire remonter.
  let vivants = [];
  try { vivants = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n"); } catch { /* docker absent */ }
  for (const i of registre) {
    const attendu = i.statut === "actif";
    const tourne = vivants.includes(conteneurName(i.slug));
    if (attendu && !tourne) a.problemes.push({ gravite: "critique", message: `« ${i.slug} » est actif au registre mais son conteneur ne tourne pas` });
    if (!attendu && tourne) a.problemes.push({ gravite: "avertissement", message: `« ${i.slug} » est ${i.statut} au registre mais son conteneur tourne` });
    const env = path.join(i.dossier || instanceDir(i.slug, RACINE_FLOTTE), ".env");
    if (!existsSync(env)) a.problemes.push({ gravite: "critique", message: `« ${i.slug} » n'a pas de fichier .env (${env})` });
  }
  if (!a.problemes.length) return dire(`${c.g}✓ flotte cohérente${c.n}`);
  for (const p of a.problemes) {
    dire(`${p.gravite === "critique" ? c.r + "✗" : c.j + "!"} ${p.message}${c.n}`);
  }
  process.exit(a.problemes.some((p) => p.gravite === "critique") ? 1 : 0);
}

// ---------------------------------------------------------------------- create

function cmdCreate() {
  const registre = lireRegistre();
  const entree = {
    slug: flag("slug"), nom: flag("nom"), adminEmail: flag("email"),
    plan: flag("plan", "essentiel"), validUntil: flag("valid-until"),
  };
  const plan = planCreate(registre, entree, { racine: RACINE_FLOTTE });
  if (!plan.ok) mourir(plan.error);
  const inst = plan.instance;

  // Deuxième garde-fou, indépendant du registre : si le dossier existe déjà avec
  // un .env, une clé de chiffrement est déjà en service quelque part. Un registre
  // perdu ou tronqué ne doit pas suffire à écraser des données.
  const envPath = path.join(inst.dossier, ".env");
  if (existsSync(envPath)) {
    mourir(`${envPath} existe déjà alors que « ${inst.slug} » est absent du registre. ` +
      "Une clé de chiffrement est donc déjà en service : écrire ici rendrait les données illisibles. " +
      "Vérifier l'état réel de l'instance avant toute action.");
  }

  dire(`\n${c.b}Instance ${inst.slug}${c.n}`);
  dire(`  client      ${inst.nom}`);
  dire(`  plan        ${plan.plafonds.label} — ${plan.plafonds.campusMax ?? "∞"} campus, ${plan.plafonds.apprenantsMax ?? "∞"} apprenants, ${plan.plafonds.utilisateursMax ?? "∞"} utilisateurs`);
  dire(`  adresse     https://${inst.host}`);
  dire(`  port        ${inst.port}   conteneur ${inst.conteneur}`);
  dire(`  licence     ${inst.validUntil || "sans échéance"}`);
  if (!APPLY) dire(`\n${c.j}Simulation. Ajouter --apply pour exécuter.${c.n}`);
  dire("");

  let vhost = null, vhostPrecedent = null;
  try {
    etape(1, "dossiers");
    if (APPLY) { mkdirSync(path.join(inst.dossier, "data"), { recursive: true }); chmodSync(inst.dossier, 0o750); }
    else dire(`${c.d}    (simulé) mkdir -p ${inst.dossier}/data${c.n}`);

    etape(2, "fichier .env (600 — il porte la clé de chiffrement)");
    if (APPLY) { writeFileSync(envPath, renderEnv(inst), { mode: 0o600 }); chmodSync(envPath, 0o600); }
    else dire(`${c.d}    (simulé) écriture ${envPath}${c.n}`);

    etape(3, "vhost nginx en HTTP (phase ACME)");
    vhost = path.join(NGINX_DIR, `cm-${inst.slug}.conf`);
    vhostPrecedent = existsSync(vhost) ? readFileSync(vhost, "utf8") : null;
    if (APPLY) writeFileSync(vhost, renderNginx(inst, { tls: false }));
    rechargerNginx(vhost, vhostPrecedent);

    etape(4, `certificat Let's Encrypt pour ${inst.host}`);
    // Passage obligé par le conteneur : les fichiers de renouvellement portent
    // des chemins /etc/letsencrypt/... qui n'existent que dans ce montage.
    run("docker", ["run", "--rm",
      "-v", `${CERTBOT_CONF}:/etc/letsencrypt`, "-v", `${CERTBOT_WWW}:/var/www/certbot`,
      "certbot/certbot:latest", "certonly", "--webroot", "-w", "/var/www/certbot",
      "-d", inst.host, "--key-type", "ecdsa", "-n", "--agree-tos", "-m", inst.adminEmail]);

    etape(5, "vhost nginx en HTTPS");
    if (APPLY) writeFileSync(vhost, renderNginx(inst, { tls: true }));
    rechargerNginx(vhost, vhostPrecedent);

    etape(6, `image ${IMAGE}`);
    // On ne reconstruit pas ici : l'image est commune à la flotte et se met à
    // jour par `update`. La construire à chaque création ferait diverger les
    // instances entre elles selon leur date de mise en service.
    if (APPLY) {
      const images = execFileSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" }).trim();
      if (!images) throw new Error(`image ${IMAGE} absente — la construire d'abord depuis ${SOURCE}`);
    }

    etape(7, "démarrage du conteneur");
    run("docker", dockerRunArgs(inst, { racine: RACINE_FLOTTE }));

    etape(8, "enregistrement au registre");
    if (APPLY) ecrireRegistre([...registre, toRegistry(inst)]);

    dire(`\n${c.g}✓ instance ${inst.slug} ${APPLY ? "créée" : "simulée"}${c.n}`);
    if (APPLY) {
      // Affiché UNE fois, jamais stocké en clair ailleurs que dans le .env.
      dire(`\n${c.b}Accès initial — à transmettre par un canal séparé, puis à changer :${c.n}`);
      dire(`  URL          https://${inst.host}`);
      dire(`  identifiant  ${inst.adminEmail}`);
      dire(`  mot de passe ${inst.adminPassword}`);
      dire(`\n${c.d}Ce mot de passe n'est affiché qu'ici. Il n'entre pas au registre.${c.n}`);
    }
  } catch (e) {
    // Sortie partielle assumée : on dit précisément où on s'est arrêté plutôt
    // que de « nettoyer » automatiquement — un rollback automatique qui se
    // trompe de cible détruirait les données d'un autre client.
    dire(`\n${c.r}✗ interrompu : ${e.message}${c.n}`);
    dire(`${c.j}L'instance n'est PAS au registre. État partiel à vérifier à la main :${c.n}`);
    dire(`  dossier   ${inst.dossier}`);
    dire(`  vhost     ${vhost || "(non écrit)"}`);
    dire(`  conteneur ${inst.conteneur}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------ update / statut

function cmdUpdate() {
  const slug = positionnels[0];
  if (!validateSlug(slug).ok) mourir("identifiant d'instance requis");
  const registre = lireRegistre();
  const inst = registre.find((i) => i.slug === slug);
  if (!inst) mourir(`instance « ${slug} » inconnue`);

  dire(`${c.b}Mise à jour de ${slug}${c.n} — image ${IMAGE}, données conservées`);
  if (!APPLY) dire(`${c.j}Simulation. Ajouter --apply pour exécuter.${c.n}`);
  // Le volume n'est jamais touché : seul le conteneur est remplacé. C'est ce
  // qui rend la mise à jour sans risque pour les données du client.
  etape(1, "arrêt du conteneur");
  run("docker", ["rm", "-f", conteneurName(slug)]);
  etape(2, "redémarrage sur la nouvelle image");
  run("docker", dockerRunArgs(inst, { racine: RACINE_FLOTTE }));
  dire(`${c.g}✓ ${slug} ${APPLY ? "à jour" : "simulé"}${c.n}`);
}

function cmdStatut(nouveau) {
  const slug = positionnels[0];
  if (!validateSlug(slug).ok) mourir("identifiant d'instance requis");
  const registre = lireRegistre();
  const inst = registre.find((i) => i.slug === slug);
  if (!inst) mourir(`instance « ${slug} » inconnue`);

  dire(`${c.b}${slug} : ${inst.statut} → ${nouveau}${c.n}`);
  if (!APPLY) dire(`${c.j}Simulation. Ajouter --apply pour exécuter.${c.n}`);
  // Une suspension NE STOPPE PAS le conteneur : l'application passe en lecture
  // seule et le client garde l'accès à ses données et à ses exports. Éteindre
  // l'instance d'un organisme de formation le priverait des pièces dont il
  // répond devant un contrôleur — voir lib/licence.js.
  const envPath = path.join(inst.dossier || instanceDir(slug, RACINE_FLOTTE), ".env");
  if (APPLY) {
    const env = readFileSync(envPath, "utf8");
    const sans = env.split("\n").filter((l) => !l.startsWith("LICENCE_SUSPENDUE=")).join("\n");
    writeFileSync(envPath, sans.replace(/\n*$/, "\n") + `LICENCE_SUSPENDUE=${nouveau === "suspendu" ? "1" : "0"}\n`, { mode: 0o600 });
    run("docker", ["rm", "-f", conteneurName(slug)]);
    run("docker", dockerRunArgs(inst, { racine: RACINE_FLOTTE }));
    ecrireRegistre(registre.map((i) => (i.slug === slug ? { ...i, statut: nouveau } : i)));
  }
  dire(`${c.g}✓ ${slug} ${nouveau}${c.n} — consultation et export restent ouverts.`);
}

// ------------------------------------------------------------------------ main

const aide = `Provisioning Campus Manager

  list                          la flotte
  audit                         cohérence registre / conteneurs / fichiers
  create --slug= --nom= --email= [--plan=${Object.keys(PLANS).join("|")}] [--valid-until=AAAA-MM-JJ]
  update <slug>                 redémarre sur l'image courante (données conservées)
  suspend <slug> / resume <slug>

Rien ne s'exécute sans --apply.
Prérequis : *.campusmanager.fr doit résoudre vers ce VPS (challenge HTTP-01).`;

switch (commande) {
  case "list": cmdList(); break;
  case "audit": cmdAudit(); break;
  case "create": cmdCreate(); break;
  case "update": cmdUpdate(); break;
  case "suspend": cmdStatut("suspendu"); break;
  case "resume": cmdStatut("actif"); break;
  default: dire(aide); process.exit(commande ? 1 : 0);
}

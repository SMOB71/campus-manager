// Sauvegardes paramétrables : archive complète, dossier local, serveur externe.
//
// POURQUOI CE MODULE EXISTE
// La sauvegarde de l'interface portait sur db.json, figé depuis le passage en base : elle
// produisait un instantané périmé horodaté du jour, et sa restauration réécrivait TOUTE la
// base de production. Elle est désormais refusée en base (lib/store.js). Reste à faire le
// vrai travail : une sauvegarde qui prend l'état réel, qu'on puisse emporter, vérifier et
// restaurer — et qui ne vit pas uniquement sur la machine qu'elle est censée protéger.
//
// L'ARCHIVE EST LOGIQUE, PAS UN pg_dump. Le conteneur n'a ni pg_dump ni client SSH : on lit
// l'état par le même chemin que l'application et on l'écrit en JSON. C'est plus portable
// (restaurable en mode fichier comme en base, d'une version à l'autre) et surtout
// VÉRIFIABLE : l'enveloppe porte les effectifs par collection et une empreinte SHA-256.
//
// L'ENVELOPPE EST EN CLAIR, LE CONTENU CHIFFRÉ. On doit pouvoir lister, dater et comparer
// des archives sans détenir la clé ; on ne doit pas pouvoir en lire les données
// personnelles. D'où { format, createdAt, counts, sha256, payload: <chiffré> }.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encrypt, decrypt, encryptionEnabled } from "./crypto-store.js";
import * as pg from "./db.js";
import * as store from "./store.js";

const execFileP = promisify(execFile);
const FORMAT = "campus-backup/1";
const nomFichier = (d) => `campus-${d.replace(/[:.]/g, "-")}.cmbak`;
const empreinte = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Réglages par défaut. `dossier` vit dans DATA_DIR, donc dans le volume monté : une
// archive écrite ailleurs dans le conteneur disparaîtrait à la première recréation.
export const DEFAUTS = {
  actif: true,
  heure: "03:10",
  dossier: path.join(process.env.DATA_DIR || "./data", "archives"),
  retention: 30,
  alerteEmail: "",
  distant: { actif: false, hote: "", port: 22, utilisateur: "root", chemin: "", cle: "/app/data/.ssh/backup_key" },
};

export function config() {
  const c = store.getSettings().backup || {};
  return { ...DEFAUTS, ...c, distant: { ...DEFAUTS.distant, ...(c.distant || {}) } };
}

export function setConfig(patch = {}) {
  const a = config();
  const n = {
    actif: patch.actif !== undefined ? !!patch.actif : a.actif,
    heure: /^\d{1,2}:\d{2}$/.test(String(patch.heure || "")) ? patch.heure : a.heure,
    dossier: String(patch.dossier || a.dossier).trim(),
    // Une rétention à 0 effacerait l'archive à peine écrite : on plafonne à 1. Il faut
    // distinguer « non transmis » (on garde l'existant) de « 0 » — `|| a.retention`
    // confondait les deux et rendait la borne inopérante, donc le garde inutile.
    retention: patch.retention === undefined || patch.retention === "" || isNaN(Number(patch.retention))
      ? a.retention : Math.max(1, Math.min(365, Math.round(Number(patch.retention)))),
    alerteEmail: String(patch.alerteEmail ?? a.alerteEmail).trim(),
    distant: {
      actif: patch.distant?.actif !== undefined ? !!patch.distant.actif : a.distant.actif,
      hote: String(patch.distant?.hote ?? a.distant.hote).trim(),
      port: patch.distant?.port === undefined || patch.distant.port === "" || isNaN(Number(patch.distant.port))
      ? a.distant.port : Math.max(1, Math.min(65535, Math.round(Number(patch.distant.port)))),
      utilisateur: String(patch.distant?.utilisateur ?? a.distant.utilisateur).trim(),
      chemin: String(patch.distant?.chemin ?? a.distant.chemin).trim(),
      cle: String(patch.distant?.cle ?? a.distant.cle).trim(),
    },
  };
  store.updateSettings({ backup: n });
  return n;
}

// --- Lecture de l'état réel -------------------------------------------------
// En base on interroge PostgreSQL ; en mode fichier on relit le magasin. Les deux
// produisent la même structure, donc une archive prise dans un mode se restaure dans
// l'autre — c'est ce qui rend la migration réversible.
async function etatComplet() {
  if (pg.configured()) {
    const tout = await pg.loadAll();
    return { mode: "postgres", donnees: tout };
  }
  const { readFileSync } = fs;
  const f = path.join(process.env.DATA_DIR || "./data", "db.json");
  const brut = readFileSync(f, "utf8");
  return { mode: "fichier", donnees: decrypt(brut) || {} };
}

export async function creerArchive() {
  const { mode, donnees } = await etatComplet();
  const counts = {};
  for (const [k, v] of Object.entries(donnees)) if (Array.isArray(v)) counts[k] = v.length;
  const contenu = JSON.stringify(donnees);
  const createdAt = new Date().toISOString();
  const enveloppe = {
    format: FORMAT,
    createdAt,
    mode,
    chiffre: encryptionEnabled,
    counts,
    total: Object.values(counts).reduce((s, n) => s + n, 0),
    sha256: empreinte(contenu),
    // `encrypt` renvoie déjà une chaîne (ciphertext + entête) quand une clé existe ;
    // sans clé, on stocke le JSON tel quel plutôt que de refuser : une archive en clair
    // vaut mieux qu'aucune archive, et `chiffre:false` le dit sans ambiguïté.
    payload: encryptionEnabled ? encrypt(donnees) : contenu,
  };
  return { nom: nomFichier(createdAt), enveloppe, octets: Buffer.from(JSON.stringify(enveloppe)) };
}

// --- Vérification -----------------------------------------------------------
// Une archive qu'on n'a pas relue n'est pas une sauvegarde, c'est un espoir. On vérifie
// le format, l'empreinte du contenu et la cohérence des effectifs annoncés.
export function ouvrirArchive(octets) {
  let e;
  try { e = JSON.parse(Buffer.isBuffer(octets) ? octets.toString("utf8") : String(octets)); }
  catch { return { error: "archive illisible (JSON invalide)" }; }
  if (e?.format !== FORMAT) return { error: `format inconnu : ${e?.format || "absent"}` };
  let donnees;
  try { donnees = e.chiffre ? decrypt(e.payload) : JSON.parse(e.payload); }
  catch { return { error: "déchiffrement impossible — clé DATA_KEY différente de celle de l'archive ?" }; }
  if (!donnees || typeof donnees !== "object") return { error: "contenu d'archive corrompu" };
  const sha = empreinte(JSON.stringify(donnees));
  if (e.sha256 && sha !== e.sha256) return { error: "empreinte SHA-256 non conforme — archive altérée" };
  return { enveloppe: e, donnees };
}

// --- Écriture locale --------------------------------------------------------
export function listerArchives(cfg = config()) {
  try {
    return fs.readdirSync(cfg.dossier)
      .filter((f) => f.endsWith(".cmbak"))
      .sort().reverse()
      .map((f) => {
        const p = path.join(cfg.dossier, f);
        const st = fs.statSync(p);
        let meta = {};
        // On lit l'entête sans déchiffrer : lister ne doit pas exiger la clé.
        try {
          const e = JSON.parse(fs.readFileSync(p, "utf8"));
          meta = { createdAt: e.createdAt, mode: e.mode, total: e.total, counts: e.counts, chiffre: e.chiffre };
        } catch { meta = { illisible: true }; }
        return { nom: f, octets: st.size, mtime: st.mtime.toISOString(), ...meta };
      });
  } catch { return []; }
}

function purger(cfg) {
  const f = listerArchives(cfg);
  const trop = f.slice(cfg.retention);
  for (const a of trop) { try { fs.unlinkSync(path.join(cfg.dossier, a.nom)); } catch { /* ignore */ } }
  return trop.length;
}

// --- Copie vers un serveur externe ------------------------------------------
// Une sauvegarde qui ne vit que sur la machine qu'elle protège ne protège de rien. Le
// transfert passe par rsync/ssh avec une CLÉ MONTÉE sur l'hôte : la clé privée n'entre
// jamais dans la base de l'application, seul son chemin est un réglage.
export async function copierVersDistant(fichier, cfg = config()) {
  const d = cfg.distant;
  if (!d.actif) return { envoye: false, raison: "désactivé" };
  for (const [champ, val] of [["hote", d.hote], ["chemin", d.chemin], ["utilisateur", d.utilisateur]]) {
    if (!val) return { envoye: false, error: `serveur externe : ${champ} non renseigné` };
  }
  if (d.cle && !fs.existsSync(d.cle)) return { envoye: false, error: `clé SSH introuvable : ${d.cle}` };
  const ssh = ["ssh", "-p", String(d.port), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
    ...(d.cle ? ["-i", d.cle] : [])].join(" ");
  try {
    await execFileP("rsync", ["-az", "--timeout=60", "-e", ssh, fichier, `${d.utilisateur}@${d.hote}:${d.chemin.replace(/\/?$/, "/")}`],
      { timeout: 120000 });
    return { envoye: true, cible: `${d.utilisateur}@${d.hote}:${d.chemin}` };
  } catch (e) {
    // On remonte stderr : « rsync a échoué » sans la raison oblige à aller la chercher
    // sur le serveur, ce que personne ne fait avant l'incident.
    return { envoye: false, error: (e.stderr || e.message || "").toString().trim().slice(-400) || "rsync a échoué" };
  }
}

export async function verifierDistant(cfg = config()) {
  const d = cfg.distant;
  if (!d.hote || !d.chemin) return { ok: false, error: "hôte et chemin requis" };
  if (d.cle && !fs.existsSync(d.cle)) return { ok: false, error: `clé SSH introuvable : ${d.cle}` };
  try {
    const { stdout } = await execFileP("ssh", ["-p", String(d.port), "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10",
      ...(d.cle ? ["-i", d.cle] : []), `${d.utilisateur}@${d.hote}`,
      `mkdir -p ${JSON.stringify(d.chemin)} && df -Pk ${JSON.stringify(d.chemin)} | tail -1`], { timeout: 20000 });
    return { ok: true, detail: stdout.trim() };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || "").toString().trim().slice(-400) };
  }
}

// --- Exécution --------------------------------------------------------------
// Sans DATA_KEY, l'archive est écrite EN CLAIR. On le remonte dans le rapport plutôt que
// de le laisser deviner : une sauvegarde non chiffrée déposée sur un serveur externe est
// une fuite de données personnelles, pas une sauvegarde.
export const chiffrementActif = () => encryptionEnabled;

export async function executerSauvegarde({ cfg = config(), envoyer = null } = {}) {
  const debut = Date.now();
  const rapport = { at: new Date().toISOString(), ok: false };
  try {
    const { nom, enveloppe, octets } = await creerArchive();
    fs.mkdirSync(cfg.dossier, { recursive: true });
    const cible = path.join(cfg.dossier, nom);
    fs.writeFileSync(cible, octets);

    // On RELIT ce qu'on vient d'écrire. Une archive jamais relue n'est pas une sauvegarde.
    const relu = ouvrirArchive(fs.readFileSync(cible));
    if (relu.error) { fs.unlinkSync(cible); throw new Error(`archive rejetée à la relecture : ${relu.error}`); }

    Object.assign(rapport, {
      ok: true, nom, octets: octets.length, total: enveloppe.total,
      collections: Object.keys(enveloppe.counts).length, mode: enveloppe.mode,
      purgees: purger(cfg), ms: Date.now() - debut, chiffre: enveloppe.chiffre,
    });
    if (!enveloppe.chiffre) rapport.avertissement = "DATA_KEY absent : archive écrite EN CLAIR (données personnelles non protégées).";
    rapport.distant = await copierVersDistant(cible, cfg);
    if (rapport.distant.error) rapport.avertissement = rapport.distant.error;
  } catch (e) {
    rapport.error = e?.message || String(e);
  }
  if (envoyer && cfg.alerteEmail && (!rapport.ok || rapport.avertissement)) {
    const sujet = rapport.ok ? "Sauvegarde Campus Manager — copie externe en échec" : "ÉCHEC de la sauvegarde Campus Manager";
    await envoyer({
      to: cfg.alerteEmail, subject: sujet,
      html: `<p style="font-family:sans-serif;font-size:14px;">${sujet}.</p><pre style="font-size:12px;">${
        String(rapport.error || rapport.avertissement).replace(/[<>&]/g, "")}</pre>`,
    }).catch(() => { /* l'alerte ne doit jamais masquer le rapport */ });
  }
  return rapport;
}

// --- Restauration -----------------------------------------------------------
// Toujours en deux temps. `dryRun` compare l'archive à l'état courant et rend le détail
// collection par collection : restaurer sans savoir ce qu'on écrase est le geste qui
// transforme un incident en catastrophe.
export async function restaurer(octets, { dryRun = true } = {}) {
  const lu = ouvrirArchive(octets);
  if (lu.error) return { error: lu.error };
  const { enveloppe, donnees } = lu;

  const actuel = (await etatComplet()).donnees;
  const diff = [];
  const cles = new Set([...Object.keys(donnees), ...Object.keys(actuel)].filter((k) => Array.isArray(donnees[k]) || Array.isArray(actuel[k])));
  for (const k of [...cles].sort()) {
    const av = (actuel[k] || []).length, ap = (donnees[k] || []).length;
    if (av !== ap) diff.push({ collection: k, actuel: av, archive: ap, delta: ap - av });
  }
  const perdus = diff.filter((d) => d.delta < 0).reduce((s, d) => s - d.delta, 0);
  if (dryRun) return { dryRun: true, enveloppe: { createdAt: enveloppe.createdAt, mode: enveloppe.mode, total: enveloppe.total }, diff, perdus };

  // Filet : on archive l'état courant AVANT d'écrire. Sans lui, une restauration
  // erronée est irréversible.
  const filet = await creerArchive();
  const cfg = config();
  fs.mkdirSync(cfg.dossier, { recursive: true });
  const cheminFilet = path.join(cfg.dossier, filet.nom.replace(".cmbak", "-avant-restauration.cmbak"));
  fs.writeFileSync(cheminFilet, filet.octets);

  if (pg.configured()) {
    for (const c of pg.COLLECTION_NAMES) await pg.replaceCollection(c, donnees[c] || []);
    for (const s of pg.SINGLETONS) await pg.putSingleton(s, donnees[s] ?? {});
  } else {
    const f = path.join(process.env.DATA_DIR || "./data", "db.json");
    fs.writeFileSync(f, encryptionEnabled ? encrypt(donnees) : JSON.stringify(donnees));
  }
  return { ok: true, restaure: enveloppe.createdAt, diff, perdus, filet: path.basename(cheminFilet), redemarrageRequis: pg.configured() };
}

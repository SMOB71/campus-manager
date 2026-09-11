#!/usr/bin/env node
// Reprise du magasin JSON vers PostgreSQL.
//
// DEUX PRINCIPES, parce qu'une reprise ratée est une perte de données :
//
//   1. LE FICHIER N'EST JAMAIS TOUCHÉ. Il reste la source de vérité jusqu'à ce
//      qu'on décide le contraire. Retirer DATABASE_URL suffit à revenir en
//      arrière, à tout moment, sans rien restaurer.
//
//   2. ON COMPTE AVANT ET APRÈS, et on refuse de déclarer le succès si les
//      comptes ne correspondent pas. Une reprise « probablement bonne » n'a
//      aucune valeur.
//
// Usage :
//   DATA_DIR=/chemin/data DATABASE_URL=postgres://… node scripts/migrate-to-pg.mjs [--apply]
// Sans --apply : simulation, rien n'est écrit.

import fs from "node:fs";
import path from "node:path";
import { decrypt } from "../lib/crypto-store.js";
import * as pg from "../lib/db.js";

const APPLY = process.argv.includes("--apply");
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const c = { g: "\x1b[32m", r: "\x1b[31m", j: "\x1b[33m", d: "\x1b[2m", n: "\x1b[0m", b: "\x1b[1m" };
const mourir = (m) => { console.error(`${c.r}✗ ${m}${c.n}`); process.exit(1); };

if (!process.env.DATABASE_URL) mourir("DATABASE_URL absent");
if (!fs.existsSync(DB_FILE)) mourir(`fichier introuvable : ${DB_FILE}`);

let source;
try {
  source = decrypt(fs.readFileSync(DB_FILE, "utf8")) || {};
} catch (e) {
  mourir(`lecture impossible (DATA_KEY correcte ?) : ${e.message}`);
}

console.log(`${c.b}Reprise ${DB_FILE} → PostgreSQL${c.n}`);
if (!APPLY) console.log(`${c.j}Simulation. Ajouter --apply pour écrire.${c.n}`);
console.log();

const attendus = {};
let total = 0;
for (const nom of pg.COLLECTION_NAMES) {
  const lignes = Array.isArray(source[nom]) ? source[nom] : [];
  // Une ligne sans identifiant ne peut pas être reprise : on la signale plutôt
  // que de l'inventer un identifiant qui casserait les références croisées.
  const sansId = lignes.filter((l) => !l?.id).length;
  if (sansId) console.log(`${c.j}!${c.n} ${nom} : ${sansId} ligne(s) sans identifiant — NON reprises`);
  attendus[nom] = lignes.filter((l) => l?.id).length;
  total += attendus[nom];
  if (attendus[nom]) console.log(`  ${nom.padEnd(20)} ${String(attendus[nom]).padStart(7)}`);
}
console.log(`\n  ${"TOTAL".padEnd(20)} ${String(total).padStart(7)} ligne(s)\n`);

if (!APPLY) { console.log(`${c.d}Aucune écriture effectuée.${c.n}`); process.exit(0); }

await pg.ensureSchema();
// Sur une base déjà peuplée, on refuse : reprendre deux fois écraserait des
// écritures faites depuis la première reprise.
const avant = await pg.counts();
const dejaLa = Object.entries(avant).filter(([, n]) => n > 0);
if (dejaLa.length) {
  mourir(`la base contient déjà des données (${dejaLa.map(([k, n]) => `${k}: ${n}`).join(", ")}). ` +
    "Reprendre par-dessus écraserait ce qui a été écrit depuis. Vider la base d'abord si c'est bien l'intention.");
}

for (const nom of pg.COLLECTION_NAMES) {
  const lignes = (Array.isArray(source[nom]) ? source[nom] : []).filter((l) => l?.id);
  if (lignes.length) await pg.putMany(nom, lignes);
}
for (const s of pg.SINGLETONS) {
  if (source[s] !== undefined) await pg.putSingleton(s, source[s]);
}

// Contrôle : on ne déclare le succès que si les comptes concordent, collection
// par collection.
const apres = await pg.counts();
const ecarts = pg.COLLECTION_NAMES.filter((nom) => apres[nom] !== attendus[nom]);
if (ecarts.length) {
  for (const nom of ecarts) console.error(`${c.r}✗${c.n} ${nom} : attendu ${attendus[nom]}, trouvé ${apres[nom]}`);
  await pg.close();
  mourir("reprise incomplète — NE PAS basculer l'instance");
}

console.log(`${c.g}✓ reprise vérifiée : ${total} ligne(s), comptes identiques collection par collection${c.n}`);
console.log(`${c.d}Le fichier ${DB_FILE} n'a pas été modifié : retirer DATABASE_URL suffit à revenir en arrière.${c.n}`);
await pg.close();

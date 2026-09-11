// Persistance PostgreSQL — la couche qui remplace la réécriture de fichier.
//
// LE PROBLÈME QU'ELLE RÉSOUT, MESURÉ AVANT D'ÊTRE TRAITÉ — le magasin JSON
// réécrivait la TOTALITÉ du fichier à chaque mutation. Benchmark sur la machine
// de développement :
//
//     2 000 apprenants +  80 000 notes → 33,7 Mo → 123 ms par écriture
//     2 000 apprenants + 120 000 notes → 49,6 Mo → 159 ms par écriture
//
// 80 000 notes, c'est un réseau de 2 000 apprenants après UNE année. À 123 ms,
// un formateur qui saisit trente notes déclenche quatre secondes de réécriture,
// et les écritures concurrentes se mettent en file. Le coût croît linéairement
// et ne redescend jamais. C'est le plafond qui interdisait le multi-site.
//
// CE QUI CHANGE, ET CE QUI NE CHANGE PAS — les lectures étaient déjà servies
// depuis un cache mémoire (`_cache` dans store.js) : elles ne changent pas d'un
// octet, et les 526 appels de lecture de server.js restent intacts. Seule la
// PERSISTANCE des écritures change : une ligne modifiée écrit une ligne, au
// lieu de réécrire la base.
//
// FORME DU SCHÉMA — une table par collection, `id` + `data jsonb`, avec des
// colonnes générées pour les filtres réellement utilisés (campus, apprenant,
// date). C'est délibéré : les documents de ce domaine ont des formes qui
// évoluent (un contrat gagne un champ à chaque campagne réglementaire), et
// jsonb absorbe cette évolution sans migration de schéma, tout en restant
// indexable et interrogeable en SQL — ce qu'un fichier chiffré ne permettait
// pas du tout.
//
// CHIFFREMENT — arbitrage assumé et signalé. Le fichier JSON était chiffré au
// repos par DATA_KEY. Chiffrer chaque ligne en base rendrait la base
// inutilisable pour ce à quoi elle sert (index, requêtes, sauvegardes
// cohérentes, reprise au point dans le temps). On s'appuie donc sur les
// protections du niveau en dessous : volume chiffré, écoute sur réseau privé,
// et surtout UNE BASE PAR CLIENT — l'isolation entre organismes reste
// physique, comme avec les instances dédiées.

import pg from "pg";

const { Pool } = pg;

// Collections et colonnes générées indexées. Ne sont extraites que les clés sur
// lesquelles le code filtre réellement : un index qui ne sert à rien coûte à
// chaque écriture.
export const COLLECTIONS = {
  campuses: [],
  deliverables: ["campusId"],
  actions: ["campusId"],
  visits: ["campusId"],
  kpi: ["campusId"],
  briefs: [],
  incidents: ["campusId"],
  documents: ["campusId", "learnerId"],
  partners: ["campusId"],
  networkObjectives: [],
  audit: [],
  scenarios: ["campusId"],
  openings: [],
  emailPriority: [],
  emailMuted: [],
  decisions: ["campusId"],
  reviews: ["campusId"],
  events: ["campusId"],
  recoveries: ["campusId"],
  arbitrages: [],
  committees: [],
  si: ["campusId"],
  learners: ["campusId"],
  enrollments: ["campusId", "learnerId"],
  candidates: ["campusId", "learnerId"],
  contracts: ["campusId", "learnerId"],
  assessments: ["campusId", "classId"],
  grades: ["learnerId", "assessmentId"],
  portalAccess: ["campusId"],
  fundings: ["campusId", "learnerId"],
  invoices: ["campusId", "fundingId"],
  payments: ["invoiceId"],
  attendanceAnchors: ["campusId"],
  teachers: ["campusId"],
  curricula: [],
  rooms: ["campusId"],
  classes: ["campusId"],
  periods: ["campusId"],
  blockExemptions: ["learnerId"],
  positionnements: ["learnerId"],
  amenagements: ["learnerId"],
  suivis: ["learnerId"],
  reclamations: ["campusId"],
  sousTraitants: ["campusId"],
  jurySessions: ["campusId"],
  apiKeys: [],
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

// Les singletons (objets, pas listes) vivent dans une table clé-valeur : il n'y
// a aucune raison de leur donner une table chacun.
export const SINGLETONS = ["settings", "financeProposals", "curriculumProposals"];

// camelCase → snake_case : les identifiants PostgreSQL non cités sont repliés
// en minuscules, autant l'assumer explicitement.
export const tableName = (c) => c.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const colName = (k) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

let pool = null;

export function configured() {
  return !!process.env.DATABASE_URL;
}

export function getPool() {
  if (!pool) {
    if (!configured()) throw new Error("DATABASE_URL absent");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX) || 10,
      // Un ERP répond à des humains : mieux vaut échouer vite et clairement
      // qu'empiler des requêtes derrière une base injoignable.
      connectionTimeoutMillis: 5000,
      idle_in_transaction_session_timeout: 30000,
    });
    pool.on("error", (e) => console.error(new Date().toISOString(), "pool postgres :", e.message));
    // Un schéma dédié permet à plusieurs instances de cohabiter dans la même
    // base — indispensable pour que la suite de tests démarre plusieurs
    // serveurs en parallèle sans qu'ils se marchent dessus.
    const schema = process.env.DB_SCHEMA;
    if (schema) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`DB_SCHEMA invalide : ${schema}`);
      pool.on("connect", (c) => c.query(`set search_path to ${schema}`));
    }
  }
  return pool;
}

export async function close() {
  if (pool) { await pool.end(); pool = null; }
}

// Création du schéma. Idempotente : on la rejoue à chaque démarrage, ce qui
// évite une étape de migration manuelle à la mise en service d'une instance.
export async function ensureSchema() {
  const p = getPool();
  if (process.env.DB_SCHEMA) {
    await p.query(`create schema if not exists ${process.env.DB_SCHEMA}`);
    await p.query(`set search_path to ${process.env.DB_SCHEMA}`);
  }
  for (const [collection, cles] of Object.entries(COLLECTIONS)) {
    const t = tableName(collection);
    const generees = cles.map((k) => `${colName(k)} text generated always as (data->>'${k}') stored`).join(",\n      ");
    await p.query(`
      create table if not exists ${t} (
        id text primary key,
        data jsonb not null,
        ${generees ? generees + "," : ""}
        updated_at timestamptz not null default now()
      )`);
    for (const k of cles) {
      await p.query(`create index if not exists ${t}_${colName(k)}_idx on ${t} (${colName(k)})`);
    }
  }
  await p.query(`
    create table if not exists singletons (
      cle text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`);
  // Ordre de lecture stable : sans lui, deux démarrages successifs pourraient
  // présenter les listes dans un ordre différent, et des tests passeraient ou
  // échoueraient au hasard.
  await p.query("create index if not exists audit_updated_idx on audit (updated_at)");
}

// Chargement complet en mémoire au démarrage. C'est l'opération la plus lourde
// du cycle de vie — une fois, au boot, et jamais pendant le service.
export async function loadAll() {
  const p = getPool();
  const out = {};
  for (const collection of COLLECTION_NAMES) {
    const { rows } = await p.query(`select data from ${tableName(collection)} order by updated_at, id`);
    out[collection] = rows.map((r) => r.data);
  }
  const { rows: singles } = await p.query("select cle, data from singletons");
  for (const s of singles) out[s.cle] = s.data;
  return out;
}

// Écriture d'UNE ligne. C'est la fonction qui remplace la réécriture du
// fichier, et tout l'intérêt du chantier tient dans son coût : constant.
export async function put(collection, row) {
  if (!COLLECTIONS[collection]) throw new Error(`collection inconnue : ${collection}`);
  if (!row?.id) throw new Error(`ligne sans id dans ${collection}`);
  await getPool().query(
    `insert into ${tableName(collection)} (id, data, updated_at) values ($1, $2, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [row.id, row],
  );
  return row;
}

// Écriture groupée : un import de 300 apprenants doit coûter un aller-retour,
// pas trois cents.
export async function putMany(collection, rows = []) {
  if (!rows.length) return 0;
  if (!COLLECTIONS[collection]) throw new Error(`collection inconnue : ${collection}`);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    for (const row of rows) {
      if (!row?.id) continue;
      await client.query(
        `insert into ${tableName(collection)} (id, data, updated_at) values ($1, $2, now())
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [row.id, row],
      );
    }
    await client.query("commit");
    return rows.length;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function del(collection, id) {
  if (!COLLECTIONS[collection]) throw new Error(`collection inconnue : ${collection}`);
  const { rowCount } = await getPool().query(`delete from ${tableName(collection)} where id = $1`, [id]);
  return rowCount;
}

export async function delMany(collection, ids = []) {
  if (!ids.length) return 0;
  if (!COLLECTIONS[collection]) throw new Error(`collection inconnue : ${collection}`);
  const { rowCount } = await getPool().query(`delete from ${tableName(collection)} where id = any($1::text[])`, [ids]);
  return rowCount;
}

// Remplacement intégral d'une collection. Réservé aux cas où c'est vraiment ce
// qu'on veut dire (restauration d'une sauvegarde), jamais pour une mutation
// ordinaire — c'est précisément ce qu'on cherchait à éliminer.
export async function replaceCollection(collection, rows = []) {
  if (!COLLECTIONS[collection]) throw new Error(`collection inconnue : ${collection}`);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(`delete from ${tableName(collection)}`);
    for (const row of rows) {
      if (!row?.id) continue;
      await client.query(`insert into ${tableName(collection)} (id, data) values ($1, $2)`, [row.id, row]);
    }
    await client.query("commit");
    return rows.length;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function putSingleton(cle, valeur) {
  await getPool().query(
    `insert into singletons (cle, data, updated_at) values ($1, $2, now())
     on conflict (cle) do update set data = excluded.data, updated_at = now()`,
    [cle, valeur ?? {}],
  );
  return valeur;
}

export async function ping() {
  const t0 = process.hrtime.bigint();
  await getPool().query("select 1");
  return { ok: true, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

// Compte par collection : sert au contrôle d'une migration et au diagnostic.
export async function counts() {
  const p = getPool();
  const out = {};
  for (const c of COLLECTION_NAMES) {
    const { rows } = await p.query(`select count(*)::int as n from ${tableName(c)}`);
    out[c] = rows[0].n;
  }
  return out;
}

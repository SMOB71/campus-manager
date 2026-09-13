// Moteur de persistance partagé — extrait du magasin principal pour servir aussi
// le planning, qui souffrait exactement du même mal : un fichier unique réécrit
// en entier à chaque écriture.
//
// Dupliquer cette mécanique aurait été pire que de l'extraire : elle porte trois
// subtilités qui se paient cher quand on les oublie, et deux copies divergent
// toujours. Les voici, une fois pour toutes.
//
//   1. UNE MODIFICATION SUR PLACE EST INVISIBLE. `Object.assign(ligne, patch)` ou
//      `ligne.champ = x` ne change pas la RÉFÉRENCE de la ligne. Une détection
//      par pointeurs ne la voit pas : la mémoire porterait la nouvelle valeur, la
//      base l'ancienne, et personne ne s'en apercevrait avant un redémarrage.
//      D'où `touch(collection, ligne)`, obligatoire, et deux tests qui en
//      vérifient la couverture.
//
//   2. LE MARQUAGE PORTE LA LIGNE, PAS SON IDENTIFIANT. Aller la rechercher au
//      moment d'écrire renvoie l'ANCIENNE version quand elle a été remplacée par
//      index (`db.x[i] = nouvelle`). C'est un défaut que seuls les tests ont
//      attrapé.
//
//   3. LES ÉCRITURES SONT ENCHAÎNÉES, JAMAIS PARALLÉLISÉES. Deux mises à jour de
//      la même ligne doivent atterrir dans l'ordre demandé, et un pool de
//      connexions ne le garantit pas.
//
// Le coût d'une écriture est proportionnel aux CHANGEMENTS, pas au volume : une
// collection dont la référence de tableau et la longueur n'ont pas bougé, et
// dont aucune ligne n'est marquée, se démontre inchangée sans être parcourue.

import * as pg from "./db.js";

// Sérialisation canonique : PostgreSQL normalise le jsonb et en réordonne les
// clés. Comparer deux JSON.stringify bruts signalerait une divergence sur des
// valeurs identiques — et masquerait les vraies.
export function canonique(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonique).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonique(v[k])).join(",") + "}";
}

export function creerMoteur({ collections = [], singletons = [], nom = "magasin" } = {}) {
  let reflet = null;
  let marquees = new Map();      // collection -> Map(id -> ligne)
  let chaine = Promise.resolve();
  let desynchronise = null;
  let resync = null;             // fourni par le magasin : recharge son cache

  const actif = () => pg.configured();

  function prendreReflet(db) {
    const r = {};
    for (const c of collections) {
      const arr = db[c] || [];
      const ids = new Map();
      for (const row of arr) if (row?.id) ids.set(row.id, row);
      r[c] = { arr, len: arr.length, ids };
    }
    for (const s of singletons) r[s] = canonique(db[s] ?? {});
    return r;
  }

  function touch(collection, row) {
    if (!row?.id || !actif()) return row;
    if (!marquees.has(collection)) marquees.set(collection, new Map());
    marquees.get(collection).set(row.id, row);
    return row;
  }

  function diff(db) {
    const maj = [], sup = [], singles = [];
    for (const c of collections) {
      const r = reflet[c] || (reflet[c] = { arr: [], len: 0, ids: new Map() });
      const cur = db[c] || [];
      const mq = marquees.get(c);
      const memeTableau = cur === r.arr;

      if (memeTableau && cur.length === r.len) {
        if (mq) for (const row of mq.values()) maj.push([c, row]);
        continue;
      }
      if (memeTableau && cur.length > r.len) {
        for (let i = r.len; i < cur.length; i++) if (cur[i]?.id) maj.push([c, cur[i]]);
        if (mq) for (const row of mq.values()) maj.push([c, row]);
        continue;
      }
      const vus = new Set();
      for (const row of cur) {
        if (!row?.id) continue;
        vus.add(row.id);
        if (r.ids.get(row.id) !== row || mq?.has(row.id)) maj.push([c, row]);
      }
      for (const id of r.ids.keys()) if (!vus.has(id)) sup.push([c, id]);
    }
    for (const s of singletons) {
      const v = canonique(db[s] ?? {});
      if (reflet[s] !== v) singles.push([s, db[s] ?? {}]);
    }
    return { maj, sup, singles };
  }

  function persister(db) {
    const { maj, sup, singles } = diff(db);
    marquees = new Map();
    if (!maj.length && !sup.length && !singles.length) return;
    if (process.env.DB_TRACE && maj.length + sup.length > 50) {
      const parCollection = {};
      for (const [c] of maj) parCollection[c] = (parCollection[c] || 0) + 1;
      console.log(new Date().toISOString(), `DB_TRACE ${nom} écriture massive :`, maj.length, "maj", sup.length, "sup", JSON.stringify(parCollection));
    }
    for (const [c, row] of maj) reflet[c].ids.set(row.id, row);
    for (const [c, id] of sup) reflet[c].ids.delete(id);
    for (const c of collections) { const arr = db[c] || []; reflet[c].arr = arr; reflet[c].len = arr.length; }
    for (const [s, v] of singles) reflet[s] = canonique(v);

    chaine = chaine.then(async () => {
      for (const [c, row] of maj) await pg.put(c, row);
      for (const [c, id] of sup) await pg.del(c, id);
      for (const [s, v] of singles) await pg.putSingleton(s, v);
    }).catch(async (e) => {
      // Une écriture perdue laisserait la mémoire en avance sur la base. On le
      // dit fort et on resynchronise plutôt que de servir un état divergent : la
      // mutation est perdue, la cohérence est sauvée.
      desynchronise = e.message;
      console.error(new Date().toISOString(), `ÉCRITURE POSTGRESQL ÉCHOUÉE (${nom}) :`, e.message);
      try {
        const frais = await charger();
        if (resync) { const c = resync(frais); reflet = prendreReflet(c); }
        desynchronise = null;
      } catch (e2) { console.error("resynchronisation impossible :", e2.message); }
    });
  }

  async function charger() {
    const tout = await pg.loadAll();
    const out = {};
    for (const c of collections) out[c] = tout[c] || [];
    for (const s of singletons) if (tout[s] !== undefined) out[s] = tout[s];
    return out;
  }

  async function flush() {
    await chaine;
    if (desynchronise) { const m = desynchronise; desynchronise = null; throw new Error(m); }
  }

  // `appliquer` reçoit l'état chargé et doit installer le cache du magasin, puis
  // le renvoyer — c'est lui qui connaît la forme de son propre cache.
  async function init(appliquer) {
    if (!actif()) return { mode: "fichier" };
    await pg.ensureSchema();
    resync = appliquer;
    const cache = appliquer(await charger());
    reflet = prendreReflet(cache);
    marquees = new Map();
    return { mode: "postgres", collections: collections.length };
  }

  // Contrôle de complétude, réservé aux tests : une modification sur place non
  // marquée apparaît ici, et nulle part ailleurs avant un redémarrage.
  async function verifierCoherence(cache) {
    if (!actif()) return { ok: true, ecarts: [] };
    await flush();
    const enBase = await pg.loadAll();
    const ecarts = [];
    for (const c of collections) {
      const base = new Map((enBase[c] || []).map((r) => [r.id, canonique(r)]));
      for (const row of (cache?.[c] || [])) {
        if (!row?.id) continue;
        const b = base.get(row.id);
        if (b === undefined) ecarts.push({ collection: c, id: row.id, motif: "absente de la base" });
        else if (b !== canonique(row)) ecarts.push({ collection: c, id: row.id, motif: "valeur divergente — modification sur place non marquée par touch()" });
      }
    }
    return { ok: ecarts.length === 0, ecarts };
  }

  return { actif, init, persister, touch, flush, verifierCoherence, canonique };
}

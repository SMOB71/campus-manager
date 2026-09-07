// Connecteur Salesforce — alimente le funnel d'admissions depuis le CRM.
// Auth : OAuth 2.0 « client credentials » d'une Connected App (server-to-server,
// pas de mot de passe utilisateur). Lecture par SOQL via l'API REST, paginée.
// Le réseau = un seul org Salesforce ; le campus est porté par un champ du Lead.

const TOKEN_TTL_MS = 25 * 60 * 1000;
const tokenCache = new Map(); // instanceUrl|clientId -> { token, instanceUrl, at }
export function clearTokenCache() { tokenCache.clear(); }

const baseOf = (u) => String(u || "").trim().replace(/\/+$/, "");

export async function sfToken(cfg) {
  const key = `${baseOf(cfg.instanceUrl)}|${cfg.clientId}`;
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit;
  let r;
  try {
    r = await fetch(`${baseOf(cfg.instanceUrl)}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId || "", client_secret: cfg.clientSecret || "" }),
      signal: AbortSignal.timeout(cfg.timeoutMs || 20000),
    });
  } catch (e) {
    throw new Error(`Salesforce injoignable (${e.name === "TimeoutError" ? "timeout" : e.message})`);
  }
  if (!r.ok) throw new Error(`Authentification Salesforce refusée (${r.status}) — vérifier la Connected App (flux « client credentials » activé + utilisateur d'exécution)`);
  const j = await r.json();
  const tok = { token: j.access_token, instanceUrl: baseOf(j.instance_url) || baseOf(cfg.instanceUrl), at: Date.now() };
  tokenCache.set(key, tok);
  return tok;
}

// La pagination suit nextRecordsUrl jusqu'au bout. Un plafond SOQL fixe (l'ancien
// LIMIT 2000) tronquait en silence : au-delà, les candidatures les plus anciennes
// n'étaient plus jamais mises à jour, sans le moindre avertissement.
export async function sfQuery(cfg, soql) {
  const t = await sfToken(cfg);
  const api = cfg.apiVersion || "v59.0";
  let url = `${t.instanceUrl}/services/data/${api}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(cfg.timeoutMs || 30000) });
    if (r.status === 401) { tokenCache.delete(`${baseOf(cfg.instanceUrl)}|${cfg.clientId}`); throw new Error("Session Salesforce expirée — relancer la synchronisation"); }
    if (!r.ok) throw new Error(`Salesforce ${r.status} : ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    out.push(...(j.records || []));
    url = j.nextRecordsUrl ? t.instanceUrl + j.nextRecordsUrl : null;
    // Garde-fou mémoire, mais EXPLICITE : on signale la troncature au lieu de la subir.
    if (out.length >= (cfg.maxRecords || 20000)) { out.truncated = true; break; }
  }
  return out;
}

export async function testConnection(cfg) {
  const t = await sfToken(cfg);
  const r = await fetch(`${t.instanceUrl}/services/data/`, { headers: { Authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(cfg.timeoutMs || 20000) });
  if (!r.ok) throw new Error(`Salesforce répond ${r.status} après authentification`);
  const versions = await r.json();
  return { ok: true, instanceUrl: t.instanceUrl, latestApi: Array.isArray(versions) && versions.length ? versions[versions.length - 1].version : null };
}

// ---------- Configuration du mapping (pur, testable) ----------

// Champs Salesforce par défaut pour l'objet Lead. `formation` et `campus` sont des
// champs custom propres à chaque org — à renseigner dans la config.
export const DEFAULT_FIELDS = { nom: "LastName", prenom: "FirstName", email: "Email", telephone: "Phone", statut: "Status", formation: "", campus: "" };

export const CANDIDATE_STAGES = ["nouveau", "contacte", "entretien", "admis", "inscrit", "refuse", "perdu"];

// Mapping par défaut des statuts Lead standard → étapes du funnel.
const DEFAULT_STATUS_MAP = {
  "open - not contacted": "nouveau", "open": "nouveau", "nouveau": "nouveau",
  "working - contacted": "contacte", "contacted": "contacte", "contacté": "contacte",
  "qualified": "entretien", "entretien": "entretien",
  "admis": "admis", "admitted": "admis",
  "closed - converted": "inscrit", "converted": "inscrit", "inscrit": "inscrit",
  "closed - not converted": "perdu", "unqualified": "refuse", "refusé": "refuse", "perdu": "perdu",
};

// Lignes « valeur = cible », insensibles à la casse. Sert au mapping statuts et campus.
export function parseMapLines(text) {
  const map = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k && v) map[k] = v;
  }
  return map;
}

export function buildSoql(cfg) {
  const f = { ...DEFAULT_FIELDS, ...(cfg.fields || {}) };
  const cols = [...new Set(["Id", ...Object.values(f).filter(Boolean)])];
  let soql = `SELECT ${cols.join(", ")} FROM ${cfg.object || "Lead"}`;
  if (cfg.where) soql += ` WHERE ${cfg.where}`;
  soql += " ORDER BY LastModifiedDate DESC";
  return soql;
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Enregistrements Salesforce → candidatures normalisées.
// campuses = [{id, name}] ; campusMap = { valeur SF (minuscules) : nom de campus }.
export function normalizeRecords(records, cfg, campuses = []) {
  const f = { ...DEFAULT_FIELDS, ...(cfg.fields || {}) };
  const statusMap = { ...DEFAULT_STATUS_MAP, ...Object.fromEntries(Object.entries(parseMapLines(cfg.statusMapText)).map(([k, v]) => [k, norm(v)])) };
  const campusMap = parseMapLines(cfg.campusMapText);
  const byName = new Map(campuses.map((c) => [norm(c.name), c.id]));
  const rows = [];
  for (const rec of records || []) {
    const get = (key) => (f[key] ? String(rec[f[key]] ?? "").trim() : "");
    const sfStatut = get("statut");
    let stage = statusMap[norm(sfStatut)] || "nouveau";
    if (!CANDIDATE_STAGES.includes(stage)) stage = "nouveau";
    const campusValue = get("campus");
    const campusId = byName.get(norm(campusMap[norm(campusValue)] || campusValue)) || null;
    rows.push({
      sfId: rec.Id || null,
      nom: get("nom"), prenom: get("prenom"), email: get("email"), telephone: get("telephone"),
      formationSouhaitee: get("formation"), sfStatut, stage, campusValue, campusId,
    });
  }
  return rows;
}

// Collecte complète : SOQL construit depuis la config, enregistrements normalisés.
export async function fetchCandidates(cfg, campuses) {
  const records = await sfQuery(cfg, buildSoql(cfg));
  return normalizeRecords(records, cfg, campuses);
}

// Connecteur SI campus — client REST + agrégations cockpit.
// Le SI de gestion des campus s'authentifie par jeton « prestataire webservices
// REST » passé en header X-Auth-Token (créé côté campus dans le module
// prestataires du SI). Les dates de l'API sont au format français et les durées
// en MINUTES (spec OpenAPI du SI, conservée hors repo).

// Certaines instances renvoient un tableau, d'autres un objet indexé par code.
export const asList = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

// Le SI mélange JJ-MM-AAAA et JJ/MM/AAAA selon les endpoints.
export function parseFrDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Les paths d'URL attendent JJ-MM-AAAA (« Les dates doivent être au format JJ-MM-AAAA »).
export function frDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(x.getDate())}-${p(x.getMonth() + 1)}-${x.getFullYear()}`;
}

export function normalizeBaseUrl(u) {
  return String(u || "").trim().replace(/\/+$/, "");
}

function siteQuery(cfg) {
  const sites = String(cfg.codesSite || "").split(",").map((s) => s.trim()).filter(Boolean);
  return sites.length ? `?codesSite=${sites.join("%2C")}` : "";
}

export async function siGet(cfg, path) {
  const url = normalizeBaseUrl(cfg.baseUrl) + path;
  let r;
  try {
    r = await fetch(url, {
      headers: { "X-Auth-Token": cfg.token || "", Accept: "application/json" },
      signal: AbortSignal.timeout(cfg.timeoutMs || 30000),
    });
  } catch (e) {
    throw new Error(`SI injoignable (${e.name === "TimeoutError" ? "timeout" : e.message})`);
  }
  if (r.status === 401 || r.status === 403) throw new Error("Jeton refusé par le SI (401/403) — vérifier le jeton et les endpoints autorisés");
  if (!r.ok) throw new Error(`SI HTTP ${r.status} sur ${path}`);
  return r.json();
}

export async function testConnection(cfg) {
  const sites = asList(await siGet(cfg, "/r/v1/sites"));
  return { ok: true, sites: sites.map((s) => ({ code: s.codeSite ?? s.code, nom: s.nomSite ?? s.nom ?? "" })).slice(0, 30) };
}

// Récupère la matière première du snapshot. Les 4 appels sont indépendants ; un échec
// sur l'un (endpoint non coché dans le jeton) ne doit pas faire perdre les autres.
export async function collectCampusData(cfg, { now = new Date(), windowDays = 30 } = {}) {
  const d1 = new Date(now.getTime() - windowDays * 864e5);
  const q = siteQuery(cfg);
  const calls = {
    apprenants: `/r/v1/formation-longue/apprenants${q}`,
    absences: `/r/v1/absences/${frDate(d1)}/${frDate(now)}${q}`,
    contrats: `/r/v1/contrats${q}`,
    statsFin: `/r/v1/stats-financieres/${frDate(d1)}/${frDate(now)}${q}`,
  };
  const out = { errors: {} };
  await Promise.all(Object.entries(calls).map(async ([k, path]) => {
    try { out[k] = await siGet(cfg, path); } catch (e) { out[k] = null; out.errors[k] = e.message; }
  }));
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

// Agrégation pure (testable sans réseau) : matière brute du SI → synthèse cockpit.
export function summarize(raw, { now = new Date(), windowDays = 30 } = {}) {
  const today = now.toISOString().slice(0, 10);
  const sinceIso = new Date(now.getTime() - windowDays * 864e5).toISOString().slice(0, 10);

  const apprenants = asList(raw.apprenants);
  const names = new Map();
  for (const a of apprenants) {
    if (a?.codeApprenant != null) names.set(String(a.codeApprenant), `${a.prenomApprenant || ""} ${a.nomApprenant || ""}`.trim());
  }
  const effectif = raw.apprenants == null ? null : new Set(apprenants.map((a) => String(a?.codeApprenant)).filter((c) => c !== "undefined")).size;

  // Absences (fenêtre) — durées en minutes ; « non justifiée » = le signal d'alerte.
  const absList = asList(raw.absences).filter((a) => !a?.isRetard);
  const retards = asList(raw.absences).filter((a) => a?.isRetard).length;
  const perApp = new Map();
  let totalMin = 0, unjustifiedMin = 0;
  for (const a of absList) {
    const dur = Number(a?.duree) || 0;
    totalMin += dur;
    if (!a?.isJustifie) unjustifiedMin += dur;
    const key = String(a?.codeApprenant ?? "?");
    const cur = perApp.get(key) || { code: key, totalMin: 0, unjustifiedMin: 0, count: 0 };
    cur.totalMin += dur; cur.count += 1;
    if (!a?.isJustifie) cur.unjustifiedMin += dur;
    perApp.set(key, cur);
  }
  const topAbsents = [...perApp.values()].sort((x, y) => y.totalMin - x.totalMin).slice(0, 8)
    .map((x) => ({ ...x, nom: names.get(x.code) || `Apprenant ${x.code}` }));

  // Taux d'absentéisme fiable : minutes prévues vs minutes d'assiduité des stats
  // financières (c'est la base de la facturation OPCO, pas un simple comptage).
  const stats = asList(raw.statsFin);
  let minutePrevu = 0, minuteAssiduite = 0, facture = 0, assiduiteEur = 0, vente = 0, charge = 0;
  for (const s of stats) {
    minutePrevu += Number(s?.minutePrevu) || 0;
    minuteAssiduite += Number(s?.minuteAssiduite) || 0;
    facture += Number(s?.montantFacture) || 0;
    assiduiteEur += Number(s?.montantAssiduite) || 0;
    vente += Number(s?.montantVente) || 0;
    charge += Number(s?.montantCharge) || 0;
  }
  const absentRate = minutePrevu > 0 ? round1(Math.max(0, (1 - minuteAssiduite / minutePrevu)) * 100) : null;

  // Contrats : actifs, résiliations en cours (signal précoce), ruptures de la fenêtre.
  const contrats = asList(raw.contrats);
  const contratRow = (c) => ({
    code: c?.codeContrat ?? null,
    apprenant: names.get(String(c?.codeApprenant)) || `Apprenant ${c?.codeApprenant}`,
    codeEntreprise: c?.codeEntreprise ?? null,
    dateDeb: parseFrDate(c?.dateDebContrat), dateFin: parseFrDate(c?.dateFinContrat),
    dateResiliation: parseFrDate(c?.dateResiliation), motif: c?.nomMotifResiliation || "",
    npecOpco: c?.npecOpco ?? null,
  });
  let actifs = 0;
  const rupturesEnCours = [], rupturesPeriode = [];
  for (const c of contrats) {
    const fin = parseFrDate(c?.dateFinContrat);
    const resil = parseFrDate(c?.dateResiliation);
    if (!resil && (!fin || fin >= today) && (parseFrDate(c?.dateDebContrat) || "") <= today) actifs++;
    if (Number(c?.resilEnCours)) rupturesEnCours.push(contratRow(c));
    else if (resil && resil >= sinceIso && resil <= today) rupturesPeriode.push(contratRow(c));
  }

  return {
    fetchedAt: now.toISOString(), windowDays,
    effectif,
    absences: raw.absences == null ? null : {
      totalMin, unjustifiedMin, count: absList.length, retards,
      totalH: round1(totalMin / 60), unjustifiedH: round1(unjustifiedMin / 60), topAbsents,
    },
    assiduite: raw.statsFin == null ? null : { minutePrevu, minuteAssiduite, absentRate },
    contrats: raw.contrats == null ? null : {
      total: contrats.length, actifs,
      rupturesEnCours: rupturesEnCours.slice(0, 30), rupturesPeriode: rupturesPeriode.slice(0, 30),
    },
    finance: raw.statsFin == null ? null : {
      facture: Math.round(facture), assiduite: Math.round(assiduiteEur),
      ecart: Math.round(facture - assiduiteEur), vente: Math.round(vente), charge: Math.round(charge),
    },
    errors: raw.errors && Object.keys(raw.errors).length ? raw.errors : null,
  };
}

// Sync complète d'un campus : collecte + agrégation.
export async function syncCampus(cfg, opts = {}) {
  const raw = await collectCampusData(cfg, opts);
  if (raw.apprenants == null && raw.absences == null && raw.contrats == null && raw.statsFin == null) {
    throw new Error(Object.values(raw.errors)[0] || "Aucune donnée du SI accessible");
  }
  return summarize(raw, opts);
}

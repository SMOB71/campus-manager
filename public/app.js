const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Heures : une décimale suffit, et « 12.000000000000002 h » discrédite un tableau.
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
// Markdown -> HTML SÛR : marked + DOMPurify (défense XSS sur tout contenu rendu, dont le brief email externe).
function mdSafe(md) {
  if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(String(md ?? "")));
  return `<pre>${esc(md)}</pre>`;
}

window.addEventListener("error", (ev) => {
  const err = $("#login-error");
  if (err && !$("#login").hidden) { err.textContent = "Erreur JS : " + (ev.message || "inconnue"); err.hidden = false; }
});

// ---------- API ----------
const csrfToken = () => (document.cookie.match(/(?:^|;\s*)ac_csrf=([a-f0-9]+)/) || [])[1] || "";
const jsonHeaders = () => ({ "Content-Type": "application/json", "X-CSRF-Token": csrfToken() });
// Toute réponse passe par ici : une erreur serveur (500, 502, passerelle qui
// renvoie du HTML au lieu de JSON) doit produire un objet {error} lisible, jamais
// une exception silencieuse qui laisse la vue figée sur « Chargement… ».
async function parseResponse(r) {
  if (r.status === 401) return logout(true);
  const brut = await r.text();
  let data = null;
  try { data = brut ? JSON.parse(brut) : {}; } catch { data = null; }
  if (data && typeof data === "object") {
    if (!r.ok && !data.error) data.error = `Erreur serveur (${r.status})`;
    return data;
  }
  return { error: r.ok ? "Réponse illisible du serveur" : `Erreur serveur (${r.status}) — réessaie dans un instant` };
}
const netErr = (e) => ({ error: e?.name === "TypeError" ? "Connexion perdue — vérifie ton réseau" : `Erreur réseau : ${e?.message || e}` });
const api = {
  async get(u) { try { return await parseResponse(await fetch(u)); } catch (e) { return netErr(e); } },
  async post(u, b) { try { return await parseResponse(await fetch(u, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(b || {}) })); } catch (e) { return netErr(e); } },
  async patch(u, b) { try { return await parseResponse(await fetch(u, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(b || {}) })); } catch (e) { return netErr(e); } },
  async put(u, b) { try { return await parseResponse(await fetch(u, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(b || {}) })); } catch (e) { return netErr(e); } },
  async del(u) { try { return await parseResponse(await fetch(u, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken() } })); } catch (e) { return netErr(e); } },
  async upload(file) { const fd = new FormData(); fd.append("file", file); try { return await parseResponse(await fetch("/api/upload", { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd })); } catch (e) { return netErr(e); } },
};

// Anti-double-clic : le bouton reste désactivé jusqu'à la FIN du handler, refetch
// compris. Sans cela, un double-clic sur réseau lent crée deux dossiers apprenants,
// ou envoie deux emails d'ancrage horodatés dans un dossier de contrôle.
async function guard(btn, fn) {
  if (!btn || btn.disabled) return;
  const libelle = btn.innerHTML;
  btn.disabled = true;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = libelle; }
}

// Une erreur non rattrapée ne doit jamais laisser l'écran muet.
window.addEventListener("unhandledrejection", (e) => {
  console.error("[promesse rejetée]", e.reason);
  const v = document.querySelector("#view");
  if (v && /Chargement/.test(v.textContent || "") && v.children.length <= 1) {
    v.innerHTML = `<div class="card card-pad"><b>Impossible d'afficher cette page.</b><p class="sub muted">${esc(e.reason?.message || "Erreur inattendue")}</p><button class="btn-primary btn-sm" id="err-reload">Recharger</button></div>`;
    document.querySelector("#err-reload")?.addEventListener("click", () => location.reload());
  }
});

// ---------- Icônes ----------
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  pnl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7"/></svg>',
  cr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3v5h5"/><path d="M19 8v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/></svg>',
  hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4M12 8v4l3 2"/></svg>',
  actions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/><path d="M18 16l2 2 3-3" transform="translate(-4 0)"/></svg>',
  campus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V9l7-4 7 4v12"/><path d="M9 21v-6h6v6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  funnel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>',
  grad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4L2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v5"/></svg>',
  sign: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-4 6-4"/><path d="M3 21h18"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17.5v.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V4M4 20h16"/><path d="M8 16l3-4 3 2 4-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 7a7 7 0 1 0 0 10M4 10h9M4 14h8"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21C7 17 3 13.5 3 9a4 4 0 0 1 7-2.5A4 4 0 0 1 17 5a4 4 0 0 1 4 4c0 4.5-4 8-9 12z"/></svg>',
  brief: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.5 21a2 2 0 0 1-3 0"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4M12 7v5l3 2"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12a5 5 0 0 1 1-3c2.5-3.5 7-4 9-4 0 2-.5 6.5-4 9a5 5 0 0 1-3 1z"/><circle cx="15" cy="9" r="1.2"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3l7 7-3 3-7-7zM10 7l4 4-6 6-4-4zM3 21h9"/></svg>',
  mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>',
};
const TASK_ICON = { pnl: I.pnl, compte_rendu: I.cr, ordre_du_jour: I.agenda, note_cadrage: I.note };
const TASK_DESC = {
  pnl: "P&L campus → indicateurs, diagnostic, plan d'action",
  compte_rendu: "Notes de réunion → CR structuré + actions",
  ordre_du_jour: "Réunion / visite → ordre du jour",
  note_cadrage: "Projet / décision → note pour comité",
};

const CONTACT_CATS = [
  { k: "direction", l: "Direction" },
  { k: "administratif", l: "Équipe administrative" },
  { k: "professeur", l: "Professeurs" },
  { k: "autre", l: "Autres" },
];
function renderContactGroups(c) {
  const contacts = c.contacts || [];
  if (!contacts.length) return `<p class="muted" style="font-size:13px;padding:2px 0;">Aucun interlocuteur.</p>`;
  return CONTACT_CATS.map((cat) => {
    const grp = contacts.filter((k) => (k.category || "autre") === cat.k);
    if (!grp.length) return "";
    return `<div class="cat-group"><div class="cat-label">${cat.l}</div>` + grp.map((k) => `
      <div class="item" style="padding:8px 12px;">
        <div class="grow"><div class="ttl">${esc([k.firstName, k.lastName].filter(Boolean).join(" ")) || "—"}</div>
        <div class="sub">${esc(k.role || "")}${k.email ? " · " + esc(k.email) : ""}${k.phone ? " · " + esc(k.phone) : ""}</div></div>
        <button class="btn-ghost btn-sm btn-danger dl-contact" data-c="${c.id}" data-k="${k.id}">✕</button>
      </div>`).join("") + `</div>`;
  }).filter(Boolean).join("");
}

const FILIERE_TYPES = ["BTS", "Bachelor", "Licence", "MBA", "Mastère", "Titre RNCP", "Autre"];
const FILIERE_MODALITES = [["initial", "Initial"], ["alternance", "Alternance"], ["mixte", "Mixte"]];
function filiereRow(f) {
  f = f || {};
  const typeOpts = `<option value="">Type…</option>` + FILIERE_TYPES.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`).join("");
  const modOpts = FILIERE_MODALITES.map(([k, l]) => `<option value="${k}" ${(f.modalite || "initial") === k ? "selected" : ""}>${l}</option>`).join("");
  return `<div class="fil-row" style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;">
    <select class="flf" data-f="type" style="width:104px;">${typeOpts}</select>
    <select class="flf" data-f="modalite" style="width:110px;">${modOpts}</select>
    <input class="txt flf" data-f="nom" value="${esc(f.nom || "")}" placeholder="Intitulé (ex. BTS Opticien-Lunetier)" style="flex:2;min-width:150px;">
    <input class="txt flf" data-f="niveau" value="${esc(f.niveau || "")}" placeholder="Année (1A/2A)" style="width:88px;">
    <input class="txt flf" data-f="effectif" type="number" value="${f.effectif ?? ""}" placeholder="Effectif" style="width:84px;">
    <input class="txt flf" data-f="capacite" type="number" value="${f.capacite ?? ""}" placeholder="Capacité" style="width:84px;">
    <input class="txt flf" data-f="frais" type="number" value="${f.frais ?? ""}" placeholder="€/an" style="width:80px;" title="Produit par étudiant/an : scolarité (initial) ou financement OPCO (alternance)">
    <button class="btn-ghost btn-sm btn-danger del-fil" type="button">✕</button>
  </div>`;
}
const MODALITE_BADGE = { initial: '<span class="mod-badge mod-initial">Initial</span>', alternance: '<span class="mod-badge mod-alt">Alternance</span>', mixte: '<span class="mod-badge mod-mixte">Mixte</span>' };
const filiereLabel = (f) => `${f.type ? esc(f.type) + " " : ""}${esc(f.nom || "")}${f.niveau ? " (" + esc(f.niveau) + ")" : ""}`;
function filiereMix(filieres) {
  const fs = filieres || [];
  const tot = fs.reduce((s, f) => s + (f.effectif || 0), 0);
  if (!tot) return "";
  const sum = (mod) => fs.filter((f) => (f.modalite || "initial") === mod).reduce((s, f) => s + (f.effectif || 0), 0);
  const pct = (n) => Math.round((n / tot) * 100);
  const ini = sum("initial"), alt = sum("alternance"), mix = sum("mixte");
  return `<div class="mix-line">Mix : <b>${ini}</b> initial (${pct(ini)}%) · <b>${alt}</b> alternance (${pct(alt)}%)${mix ? ` · <b>${mix}</b> mixte (${pct(mix)}%)` : ""} · <span class="muted">${tot} étudiants au total</span></div>`;
}

// ---------- État ----------
const state = { tasks: {}, variants: [], campuses: [], user: null, view: "accueil", task: "pnl", variant: "", campus: "", uploaded: "", busy: false, lastMd: "", lastId: null, lastActions: [], chat: [] };
let controller = null;
let qCampus = "", kCampus = "", qualiopiRef = null;

// ---------- Boot ----------
async function boot() {
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ authed: false }));
  state.tasks = me.tasks || {};
  state.variants = me.visitVariants || [];
  state.user = me.user || null;
  if (me.authed) enterApp(); else showLogin();
}
function showLogin() { $("#app").hidden = true; $("#login").hidden = false; setGreeting(); $("#pw").focus(); }
function setGreeting() {
  const h = new Date().getHours();
  const hello = h < 6 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  const el = $("#lg-hello"); if (el) el.textContent = hello;
  const d = $("#lg-date"); if (d) d.textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
async function enterApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  const me = await api.get("/api/me");
  state.user = me?.user || state.user;
  state.tasks = me?.tasks || state.tasks;
  state.variants = me?.visitVariants || state.variants;
  state.campuses = await api.get("/api/campuses") || [];
  state.licence = await api.get("/api/licence").catch(() => null);
  navOpen = Object.fromEntries(NAV_GROUPS.map((g) => [g, false])); saveNavOpen(); // dropdowns repliés à la connexion
  renderNav();
  setView("accueil");
  startSessionGuards();
  refreshNotifCount();
}
async function refreshNotifCount() {
  try { const n = await fetch("/api/notifications").then((r) => r.ok ? r.json() : []); notifCount = Array.isArray(n) ? n.length : 0; renderNav(); } catch { /* ignore */ }
}
const isAdmin = () => state.user?.role === "admin";
// Envoi programmatique d'une question à l'assistant (boutons métier / point hebdo).
let pendingAsk = null;
function askAssistant(q) { pendingAsk = q; setView("assistant"); }

// --- Déconnexion automatique (inactivité + expiration de session) ---
let idleTimer = null, warnTimer = null, sessionInterval = null;
const IDLE_MS = 30 * 60 * 1000; // 30 min d'inactivité
const WARN_MS = 60 * 1000;      // avertissement 1 min avant
function hideIdleWarn() { $("#idle-warn")?.remove(); }
function showIdleWarn() {
  if ($("#idle-warn")) return;
  const el = document.createElement("div");
  el.id = "idle-warn"; el.className = "idle-warn";
  el.innerHTML = `<span>Déconnexion automatique dans 1 min (inactivité).</span> <button class="btn-primary btn-sm" id="idle-stay">Rester connecté</button>`;
  document.body.appendChild(el);
  $("#idle-stay").addEventListener("click", () => { hideIdleWarn(); window._idleReset?.(); });
}
function startSessionGuards() {
  clearTimeout(idleTimer); clearTimeout(warnTimer); clearInterval(sessionInterval);
  const reset = () => {
    clearTimeout(idleTimer); clearTimeout(warnTimer); hideIdleWarn();
    warnTimer = setTimeout(showIdleWarn, IDLE_MS - WARN_MS);
    idleTimer = setTimeout(() => logout(false), IDLE_MS);
  };
  window._idleReset = reset;
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
  reset();
  sessionInterval = setInterval(async () => {
    try { const me = await fetch("/api/me").then((r) => r.json()); if (!me.authed) logout(true); } catch { /* réseau : on ignore */ }
  }, 5 * 60 * 1000);
}

// --- Mot de passe : afficher/masquer, changer, oublié ---
$("#pw-toggle")?.addEventListener("click", () => { const p = $("#pw"); p.type = p.type === "password" ? "text" : "password"; p.focus(); });
$("#forgot-link")?.addEventListener("click", openForgot);
document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !$("#app").hidden) { e.preventDefault(); openPalette(); } });

function openChangePassword() {
  openModal("Sécurité — mot de passe & Face ID", `
    <div class="section-title" style="margin-top:0;">Mot de passe</div>
    <div class="field"><label class="field-label">Mot de passe actuel</label><input class="txt" id="cp-cur" type="password"></div>
    <div class="field"><label class="field-label">Nouveau mot de passe <span class="muted">(min. 8 caractères)</span></label><input class="txt" id="cp-new" type="password"></div>
    <div class="actions"><button class="btn-primary" id="cp-save">Enregistrer</button> <span id="cp-msg" class="status"></span></div>
    <div class="section-title">Face ID / Touch ID (passkey)</div>
    <p class="hint muted" style="margin-top:0;">Active la connexion biométrique de cet appareil (Touch ID sur Mac, Face ID sur iPhone/iPad, Windows Hello sur PC). La passkey se synchronise via iCloud pour retrouver Face ID sur ton iPhone.</p>
    <div id="pk-list" class="list" style="margin-bottom:10px;"></div>
    <button class="btn-ghost btn-sm" id="pk-add">Activer sur cet appareil</button> <span id="pk-msg" class="status"></span>`);
  $("#cp-save").onclick = async () => {
    const r = await api.post("/api/change-password", { current: $("#cp-cur").value, next: $("#cp-new").value });
    const m = $("#cp-msg");
    if (r.ok) { m.textContent = "✓ Mot de passe changé"; m.classList.add("saved"); }
    else m.textContent = r.error || "Erreur";
  };
  const renderPk = async () => {
    const list = await api.get("/api/webauthn/credentials") || [];
    $("#pk-list").innerHTML = list.length ? list.map((c) => `<div class="item"><span class="pill good">Face ID</span><div class="grow"><div class="ttl">${esc(c.deviceName)}</div><div class="sub muted">activé le ${frDate(c.createdAt)}</div></div><button class="btn-ghost btn-sm btn-danger pk-del" data-id="${esc(c.id)}">Retirer</button></div>`).join("") : `<p class="muted" style="font-size:13px;">Aucun appareil biométrique enregistré.</p>`;
    $$(".pk-del").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/webauthn/credentials/${encodeURIComponent(b.dataset.id)}`); renderPk(); }));
  };
  $("#pk-add").onclick = async () => {
    $("#pk-msg").textContent = "Suis l'invite biométrique…";
    try { await registerPasskey(); $("#pk-msg").textContent = "✓ Face ID activé"; renderPk(); }
    catch (e) { $("#pk-msg").textContent = e.message || "Échec"; }
  };
  if (!WA || !WA.browserSupportsWebAuthn?.()) { $("#pk-add").disabled = true; $("#pk-msg").textContent = "Non supporté sur ce navigateur"; }
  renderPk();
}

function openForgot() {
  openModal("Mot de passe oublié", `
    <div class="field"><label class="field-label">Email du compte</label><input class="txt" id="fg-email" type="email" value="${esc($("#email")?.value || "")}" placeholder="prenom@exemple.fr"></div>
    <div class="actions"><button class="btn-primary" id="fg-send">Envoyer le code</button> <span id="fg-msg" class="status"></span></div>
    <div id="fg-step2" hidden style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px;">
      <div class="field"><label class="field-label">Code reçu (6 chiffres)</label><input class="txt" id="fg-code" inputmode="numeric" placeholder="000000"></div>
      <div class="field"><label class="field-label">Nouveau mot de passe <span class="muted">(min. 8)</span></label><input class="txt" id="fg-pw" type="password"></div>
      <div class="actions"><button class="btn-primary" id="fg-reset">Réinitialiser</button> <span id="fg-msg2" class="status"></span></div>
    </div>`);
  $("#fg-send").onclick = async () => {
    const email = $("#fg-email").value.trim();
    if (!email) { $("#fg-msg").textContent = "Renseigne ton email"; return; }
    $("#fg-msg").textContent = "Envoi…";
    const r = await api.post("/api/forgot", { email });
    if (r.ok) { $("#fg-msg").textContent = r.hint || "Code envoyé"; $("#fg-step2").hidden = false; }
    else $("#fg-msg").textContent = r.error || "Erreur";
  };
  $("#fg-reset").onclick = async () => {
    const r = await api.post("/api/reset", { email: $("#fg-email").value.trim(), code: $("#fg-code").value.trim(), password: $("#fg-pw").value });
    const m = $("#fg-msg2");
    if (r.ok) { m.textContent = "✓ Mot de passe changé — connecte-toi"; m.classList.add("saved"); setTimeout(() => document.querySelector(".modal-bg")?.remove(), 1500); }
    else m.textContent = r.error || "Erreur";
  };
}
async function logout(silent) {
  if (!silent) await api.post("/api/logout");
  location.reload();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error"); err.hidden = true;
  const btn = e.submitter || $("#login-form button[type=submit]"); const lbl = btn?.textContent;
  if (btn) { btn.textContent = "Connexion…"; btn.disabled = true; }
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#email").value.trim(), password: $("#pw").value }) });
    if (r.ok) { $("#pw").value = ""; enterApp(); }
    else { err.textContent = r.status === 401 ? "Mot de passe incorrect." : `Erreur ${r.status}.`; err.hidden = false; }
  } catch (ex) { err.textContent = `Connexion impossible : ${ex?.message || ex}.`; err.hidden = false; }
  finally { if (btn) { btn.textContent = lbl; btn.disabled = false; } }
});
$("#logout").addEventListener("click", () => logout(false));
$("#nav-toggle")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("#nav-overlay")?.addEventListener("click", () => document.body.classList.remove("nav-open"));

// --- Face ID / passkey (WebAuthn) ---
const WA = window.SimpleWebAuthnBrowser;
async function loginPasskey() {
  const err = $("#login-error"); if (err) err.hidden = true;
  const btn = $("#faceid-login"); if (btn) btn.disabled = true;
  try {
    const { options, waid } = await api.post("/api/webauthn/login/options", {});
    const asr = await WA.startAuthentication(options);
    const r = await api.post("/api/webauthn/login/verify", { response: asr, waid });
    if (r.ok) { state.user = r.user; enterApp(); }
    else if (err) { err.textContent = r.error || "Face ID échoué."; err.hidden = false; }
  } catch (ex) {
    if (err && ex?.name !== "NotAllowedError" && ex?.name !== "AbortError") { err.textContent = "Face ID : " + (ex?.message || ex); err.hidden = false; }
  } finally { if (btn) btn.disabled = false; }
}
(async () => {
  if (!WA || !WA.browserSupportsWebAuthn?.()) return;
  try { if (WA.platformAuthenticatorIsAvailable && !(await WA.platformAuthenticatorIsAvailable())) return; } catch { /* ignore */ }
  const btn = $("#faceid-login"); if (btn) { btn.hidden = false; btn.addEventListener("click", loginPasskey); }
})();
async function registerPasskey(deviceName) {
  if (!WA) throw new Error("Face ID non supporté sur ce navigateur.");
  const opts = await api.post("/api/webauthn/register/options", {});
  if (opts.error) throw new Error(opts.error);
  const att = await WA.startRegistration(opts);
  const r = await api.post("/api/webauthn/register/verify", { response: att, deviceName: deviceName || navigator.userAgentData?.platform || navigator.platform || "Cet appareil" });
  if (!r.ok) throw new Error(r.error || "Activation échouée");
  return r;
}

// ---------- Navigation ----------
const NAV_GROUPS = ["Chantier 2026", "Pilotage", "Projets", "Ouverture de campus", "Décisions", "Réseau", "Enseignement", "LMS", "Recrutement", "Performance", "Conformité", "Atelier", "Administration"];
// Rubriques rendues À PLAT, sans repli ni intitulé de groupe. Une ouverture de campus
// n'est pas une entrée parmi dix : c'est un projet de quinze mois consulté tous les jours,
// et le ranger dans « Réseau » entre Tournée et SI campus le rendait introuvable.
const NAV_SOLO = new Set(["Ouverture de campus", "Projets"]);
const NAV = [
  { id: "accueil", label: "Accueil", icon: I.home, group: "Pilotage" },
  { id: "demarrage", label: "Prêt à exploiter ?", icon: I.shield, admin: true, group: "Pilotage" },
  { id: "heatmap", label: "Heatmap réseau", icon: I.net, admin: true, group: "Pilotage" },
  // Nav #3 : « Notifications » fusionné dans « Priorités & alertes » (une seule file
  // d'action au lieu de 3 vues redondantes Accueil/Notifications/Priorités).
  { id: "priorites", label: "Priorités & alertes", icon: I.target, group: "Pilotage" },
  { id: "assistant", label: "Assistant", icon: I.chat, group: "Pilotage" },
  // Rubrique à plat, comme les ouvertures : un portefeuille de projets se
  // consulte tous les jours, il n'a rien à faire replié dans un groupe.
  { id: "projets", label: "Projets", icon: I.route, group: "Projets" },
  { id: "decisions", label: "Décisions (CODIR)", icon: I.gavel, admin: true, group: "Décisions" },
  { id: "arbitrages", label: "Arbitrages CODIR", icon: I.clip, admin: true, group: "Décisions" },
  { id: "redressements", label: "Plans de redressement", icon: I.rocket, admin: true, group: "Décisions" },
  { id: "revues", label: "Revues mensuelles", icon: I.hist, admin: true, group: "Décisions" },
  { id: "reseau", label: "Réseau", icon: I.net, admin: true, group: "Réseau" },
  { id: "campus", label: "Campus", icon: I.campus, group: "Réseau" },
  { id: "apprenants", label: "Apprenants", icon: I.grad, group: "Réseau" },
  { id: "directeurs", label: "Directeurs", icon: I.users, admin: true, group: "Réseau" },
  { id: "tournee", label: "Tournée", icon: I.route, group: "Réseau" },
  { id: "ouvertures", label: "Ouverture de campus", icon: I.rocket, admin: true, group: "Ouverture de campus" },
  { id: "si", label: "SI campus (ERP)", icon: I.plug, group: "Réseau" },
  { id: "documents", label: "Documents", icon: I.folder, group: "Réseau" },
  // Répertoire projet : une seule liste alimente les comités ET les
  // responsabilités des étapes. On ne convoque pas une chaîne de caractères.
  { id: "repertoire", label: "Répertoire du projet", icon: I.campus, group: "Réseau" },
  { id: "exploitation", label: "Exports & tableaux croisés", icon: I.chart, admin: true, group: "Performance" },
  { id: "admissions", label: "Admissions", icon: I.funnel, group: "Recrutement" },
  { id: "evenements", label: "JPO & événements", icon: I.mega, group: "Recrutement" },
  { id: "finance", label: "Finance", icon: I.euro, group: "Performance" },
  { id: "facturation", label: "Facturation", icon: I.euro, group: "Performance" },
  { id: "exports", label: "Comptabilité & paie", icon: I.euro, admin: true, group: "Performance" },
  { id: "deca", label: "Dépôts OPCO", icon: I.brief, group: "Réseau" },
  { id: "taxe", label: "Taxe d'apprentissage", icon: I.euro, admin: true, group: "Performance" },
  { id: "indicateurs-publies", label: "Indicateurs publiés (L. 6111-8)", icon: I.chart, group: "Conformité" },
  { id: "mobilite", label: "Mobilité internationale", icon: I.route, group: "Enseignement" },
  { id: "objectifs", label: "Objectifs réseau", icon: I.target, group: "Performance" },
  { id: "prevision", label: "Prévision consolidée", icon: I.chart, admin: true, group: "Performance" },
  { id: "indicateurs", label: "Indicateurs", icon: I.chart, group: "Performance" },
  { id: "insertion", label: "Insertion & satisfaction", icon: I.heart, group: "Performance" },
  { id: "contrats", label: "Contrats d'alternance", icon: I.brief, group: "Réseau" },
  // Chaîne commerciale : offre → devis → convention. Le pipeline EST la liste
  // des devis, il n'y a pas d'entité « opportunité » à tenir synchronisée.
  { id: "catalogue", label: "Catalogue & devis", icon: I.brief, group: "Performance" },
  { id: "cpf", label: "Financement individuel (CPF)", icon: I.euro, group: "Performance" },
  { id: "entreprises", label: "Entreprises & alternance", icon: I.brief, group: "Performance" },
  { id: "qualiopi", label: "Qualiopi", icon: I.shield, group: "Conformité" },
  { id: "enquetes", label: "Enquêtes", icon: I.shield, group: "Conformité" },
  // Chantier 2026 — les trois dispositifs livrés en septembre 2026 et pas
  // encore mis en service. Ils restent atteignables depuis leur écran métier
  // (le rythme depuis le planning, la bascule depuis Qualiopi) : ce groupe
  // les rassemble pour les piloter, il ne les déplace pas.
  { id: "chantier", label: "Ce qui reste à mettre en service", icon: I.alert, group: "Chantier 2026" },
  // LMS — la partie « diffusion et suivi à distance », distincte du suivi
  // administratif. Ce n'est pas une bibliothèque de contenus : c'est le
  // système de preuve des heures à distance (indicateur 19, art. D. 6313-3-1).
  { id: "ressources", label: "Ressources pédagogiques", icon: I.note, group: "LMS" },
  { id: "suivi-distance", label: "Suivi à distance", icon: I.chart, group: "LMS" },
  { id: "dispositif-foad", label: "Dispositif à distance", icon: I.shield, group: "LMS" },
  // Documents obligatoires de l'OF : leur absence est relevable en contrôle,
  // ils ne relèvent pas du confort.
  { id: "documents-of", label: "Documents obligatoires", icon: I.journal, group: "Conformité" },
  { id: "certification", label: "Présentation à la certification", icon: I.note, group: "Conformité" },
  { id: "insertion-actions", label: "Insertion & poursuite d'études", icon: I.heart, group: "Conformité" },
  { id: "declarations", label: "Déclarations (SIFA, BPF)", icon: I.journal, admin: true, group: "Conformité" },
  { id: "qualite", label: "Réclamations & sous-traitance", icon: I.shield, group: "Conformité" },
  { id: "decrochage", label: "Risque de décrochage", icon: I.alert, group: "Enseignement" },
  { id: "jury", label: "Sessions d'examen & jury", icon: I.note, group: "Enseignement" },
  { id: "planning", label: "Emploi du temps", icon: I.agenda, group: "Enseignement" },
  { id: "emargement", label: "Émargement", icon: I.sign, group: "Enseignement" },
  { id: "notes", label: "Notes & bulletins", icon: I.note, group: "Enseignement" },
  { id: "professeurs", label: "Professeurs", icon: I.campus, group: "Enseignement" },
  // Dossiers RH et masse horaire : le volume contractuel est DÉRIVÉ du
  // planning, jamais saisi — c'est ce qui garantit que le contrat rédigé et
  // l'emploi du temps parlent du même nombre d'heures.
  { id: "dossiers-rh", label: "Dossiers RH intervenants", icon: I.brief, group: "Enseignement" },
  { id: "contrats-profs", label: "Contrats intervenants", icon: I.brief, group: "Enseignement" },
  { id: "masse-horaire", label: "Masse horaire & budget", icon: I.euro, admin: true, group: "Performance" },
  { id: "referentiels", label: "Référentiels", icon: I.note, admin: true, group: "Enseignement" },
  { id: "sallesclasses", label: "Salles & classes", icon: I.net, group: "Enseignement" },
  { id: "risques", label: "Risques", icon: I.alert, group: "Conformité" },
  { id: "actions", label: "Plans d'action", icon: I.actions, group: "Conformité" },
  { id: "atelier", label: "Atelier", icon: I.pnl, group: "Atelier" },
  { id: "calendrier", label: "Timeline", icon: I.cal, group: "Atelier" },
  { id: "historique", label: "Historique", icon: I.hist, group: "Atelier" },
  { id: "emails", label: "Emails", icon: I.mail, admin: true, group: "Administration" },
  { id: "utilisateurs", label: "Utilisateurs", icon: I.users, admin: true, group: "Administration" },
  { id: "licence", label: "Licence & abonnement", icon: I.shield, admin: true, group: "Administration" },
  { id: "apikeys", label: "Clés d'API", icon: I.plug, admin: true, group: "Administration" },
  { id: "journal", label: "Journal d'audit", icon: I.journal, admin: true, group: "Administration" },
  { id: "backups", label: "Sauvegardes", icon: I.save, admin: true, group: "Administration" },
  { id: "parametres", label: "Paramètres", icon: I.sliders, admin: true, group: "Administration" },
  { id: "rgpd", label: "RGPD & conformité", icon: I.shield, admin: true, group: "Administration" },
  { id: "change-pw", label: "Changer le mot de passe", icon: I.lock, group: "Administration", action: "changePassword" },
];
// Bandeau de licence : affiché en haut de chaque vue dès qu'il y a quelque chose
// à dire. Découvrir un plafond au moment d'inscrire un apprenant, c'est le
// découvrir trop tard — on prévient avant, pas pendant.
function renderLicenceBanner() {
  const l = state.licence;
  const hote = $("#licence-banner");
  if (!hote) return;
  const quotaChaud = (l?.quotas || []).filter((q) => q.depasse || q.proche);
  if (!l || (!l.alerte && !quotaChaud.length)) { hote.innerHTML = ""; hote.hidden = true; return; }
  const grave = l.lectureSeule || quotaChaud.some((q) => q.depasse);
  const messages = [];
  if (l.alerte) messages.push(esc(l.alerte));
  for (const q of quotaChaud) {
    messages.push(q.depasse
      ? `Plafond atteint : ${q.utilise}/${q.plafond} ${esc(q.label)}.`
      : `Bientôt au plafond : ${q.utilise}/${q.plafond} ${esc(q.label)}.`);
  }
  hote.hidden = false;
  hote.innerHTML = `<div class="licence-banner${grave ? " grave" : ""}">
    <div class="grow">${messages.join(" ")}</div>
    ${isAdmin() ? '<button class="btn-ghost btn-sm" id="lic-go">Voir la licence</button>' : ""}</div>`;
  $("#lic-go")?.addEventListener("click", () => setView("licence"));
}

function navItems() { return NAV.filter((n) => !n.admin || isAdmin()); }
const NAV_CHEV = '<svg class="nav-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg>';
let navOpen = null;
function loadNavOpen() {
  if (navOpen) return navOpen;
  try { navOpen = JSON.parse(localStorage.getItem("cm_nav_open") || "null"); } catch (e) {}
  if (!navOpen || typeof navOpen !== "object") navOpen = Object.fromEntries(NAV_GROUPS.map((g) => [g, true]));
  return navOpen;
}
function saveNavOpen() { try { localStorage.setItem("cm_nav_open", JSON.stringify(loadNavOpen())); } catch (e) {} }
function toggleNavGroup(g) { const o = loadNavOpen(); o[g] = o[g] === false; saveNavOpen(); renderNav(); }
let notifCount = 0;
function renderNav() {
  const items = navItems(); const open = loadNavOpen();
  $("#nav").innerHTML = NAV_GROUPS.map((g) => {
    const gi = items.filter((n) => n.group === g);
    if (!gi.length) return "";
    // Une rubrique isolée se rend comme un accès direct : ni chevron, ni repli — un menu
    // déroulant qui ne contient qu'une ligne est une friction sans contrepartie.
    if (NAV_SOLO.has(g)) return `<div class="nav-group open nav-solo"><div class="nav-group-items">${
      gi.map((n) => `<button data-view="${n.id}"${n.id === state.view ? ' class="active"' : ""}>${n.icon}<span>${n.label}</span></button>`).join("")}</div></div>`;
    const isOpen = open[g] !== false;
    return `<div class="nav-group${isOpen ? " open" : ""}">
      <button class="nav-group-label" data-group="${g}"><span>${g}</span>${NAV_CHEV}</button>
      <div class="nav-group-items">${gi.map((n) => `<button data-view="${n.id}"${n.id === state.view ? ' class="active"' : ""}>${n.icon}<span>${n.label}</span>${n.id === "priorites" && notifCount ? `<span class="nav-badge">${notifCount}</span>` : ""}</button>`).join("")}</div>
    </div>`;
  }).join("");
  $$("#nav .nav-group-label").forEach((b) => b.addEventListener("click", () => toggleNavGroup(b.dataset.group)));
  $$("#nav .nav-group-items button").forEach((b) => b.addEventListener("click", () => {
    const it = NAV.find((n) => n.id === b.dataset.view);
    if (it?.action === "changePassword") return openChangePassword();
    setView(b.dataset.view);
  }));
}
function setView(v) {
  const item = NAV.find((n) => n.id === v);
  if (item?.admin && !isAdmin()) v = "accueil"; // garde-fou côté client (le serveur bloque aussi)
  document.body.classList.remove("nav-open"); // referme le tiroir mobile à la navigation
  state.view = v;
  const grp = NAV.find((n) => n.id === v)?.group; // ouvre le dropdown de la vue courante
  if (grp) { const o = loadNavOpen(); if (o[grp] === false) { o[grp] = true; saveNavOpen(); } }
  renderNav();
  $("#view-title").textContent = NAV.find((n) => n.id === v)?.label || "";
  renderLicenceBanner();
  $("#topbar-actions").innerHTML = "";
  ({ projets: renderProjets, accueil: renderAccueil, assistant: renderAssistant, notifications: renderNotifications, emails: renderEmails, reseau: renderReseau, admissions: renderAdmissions, calendrier: renderCalendrier, atelier: renderAtelier, qualiopi: renderQualiopi, enquetes: renderEnquetes, chantier: renderChantier, ressources: renderRessources, "suivi-distance": renderSuiviDistance, "dispositif-foad": renderDispositifFoad, "documents-of": renderDocumentsOf, certification: renderCertification, "insertion-actions": renderInsertionActions, indicateurs: renderIndicateurs, risques: renderRisques, directeurs: renderDirecteurs, utilisateurs: renderUtilisateurs, historique: renderHistorique, actions: renderActions, campus: renderCampus, objectifs: renderObjectifs, tournee: renderTournee, documents: renderDocuments, finance: renderFinance, insertion: renderInsertion, catalogue: renderCatalogue, cpf: renderCpf, repertoire: renderRepertoire, exploitation: renderExploitation, entreprises: renderEntreprises, journal: renderJournal, ouvertures: renderOuvertures, backups: renderBackups, decisions: renderDecisions, revues: renderRevues, evenements: renderEvenements, parametres: renderParametres, rgpd: renderRGPD, heatmap: renderHeatmap, priorites: renderPriorites, redressements: renderRedressements, prevision: renderPrevision, arbitrages: renderArbitrages, si: renderSi, apprenants: renderApprenants, contrats: renderContrats, facturation: renderFacturation, planning: renderPlanning, emargement: renderEmargement, notes: renderNotes, professeurs: renderProfesseurs, "dossiers-rh": renderDossiersRh, "contrats-profs": renderContratsProfs, "masse-horaire": renderMasseHoraire, referentiels: renderReferentiels, sallesclasses: renderSallesClasses, declarations: renderDeclarations, licence: renderLicence, exports: renderExports, deca: renderDeca, taxe: renderTaxe, demarrage: renderDemarrage, "indicateurs-publies": renderIndicateursPublies, mobilite: renderMobilite, apikeys: renderApiKeys, qualite: renderQualite, decrochage: renderDecrochage, jury: renderJury }[v] || renderAccueil)();
}

const campusName = (id) => state.campuses.find((c) => c.id === id)?.name || "";
const taskLabel = (t) => state.tasks[t]?.label || ({ synthese_reseau: "Synthèse réseau" })[t] || t;
const frDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
function campusOptions(sel) {
  return `<option value="">— Aucun campus —</option>` + state.campuses.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

// ---------- Vue : Accueil (cockpit) ----------
async function renderAccueil() {
  const view = $("#view");
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="ac-hebdo">📋 Préparer mon point hebdo</button>`;
  $("#ac-hebdo").addEventListener("click", () => askAssistant(isAdmin() ? "Prépare mon point hebdo réseau (5 min de lecture) : campus à risque, actions en retard, échéances, arbitrages." : "Prépare mon point hebdo sur mon campus : situation, actions en retard, échéances, points à remonter."));
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">${isAdmin() ? "Cockpit du jour" : "Mon cockpit du jour"}</div>
    <div class="signals" id="signals"><p class="muted">Chargement…</p></div>
    <div class="section-title">Ce qui mérite ton attention</div>
    <div id="attention"><p class="muted">Chargement…</p></div>
    <div class="section-title">À compléter</div>
    <div id="todo-fiches"></div>
    <div class="section-title">Créer un livrable</div>
    <div class="tasks" id="quick"></div>
    <div class="section-title">Derniers livrables</div>
    <div class="list" id="recent"><p class="muted">Chargement…</p></div>`;
  const [recent, att, net, fin, notifs] = await Promise.all([
    api.get("/api/deliverables"), api.get("/api/attention"),
    api.get("/api/network"), api.get("/api/finance"), api.get("/api/notifications"),
  ]);
  notifCount = (notifs || []).length; renderNav();
  const rows = net || [];
  const worst = rows.filter((r) => r.health != null).sort((a, b) => a.health - b.health)[0];
  const dueVisits = rows.filter((r) => r.visitDue).length;
  const totRev = (fin || []).reduce((s, r) => s + (r.revenue || 0), 0);
  const totBud = (fin || []).reduce((s, r) => s + (r.budget || 0), 0);
  const ecart = totBud ? Math.round(((totRev - totBud) / totBud) * 100) : null;
  const sig = (v, l, go, tone) => `<button class="signal${tone ? " sig-" + tone : ""}" data-go="${go}"><div class="sig-v">${v}</div><div class="sig-l">${l}</div></button>`;
  const hb = (v) => `<span class="sig-badge h-${v >= 75 ? "good" : v >= 50 ? "warn" : "bad"}">${v}</span>`;
  $("#signals").innerHTML = [
    sig(notifCount, notifCount ? "alerte" + (notifCount > 1 ? "s" : "") + " à traiter" : "tout est calme", "priorites:alertes", notifCount ? "warn" : ""),
    worst ? sig(`${esc(worst.name)} ${hb(worst.health)}`, "campus le plus à risque", "reseau", worst.health < 50 ? "bad" : "") : sig("—", "santé campus", "reseau"),
    ecart != null ? sig((ecart > 0 ? "+" : "") + ecart + " %", "écart budgétaire réseau", "finance", ecart < 0 ? "bad" : "good") : sig("—", "finance à renseigner", "finance"),
    sig(dueVisits, "visite" + (dueVisits > 1 ? "s" : "") + " à planifier", "tournee", dueVisits ? "warn" : ""),
  ].join("");
  $$("#signals .signal").forEach((b) => b.addEventListener("click", () => {
    let go = b.dataset.go;
    if (go === "priorites:alertes") { prioTab = "alertes"; go = "priorites"; }
    setView(go);
  }));
  renderAttention(att);
  // Checklist de complétude des fiches
  const todo = [];
  rows.forEach((r) => {
    const miss = [];
    if (r.students == null) miss.push("effectif");
    if (r.qualiopi == null) miss.push("Qualiopi");
    if (!r.director) miss.push("directeur");
    const f = (fin || []).find((x) => x.id === r.id);
    if (!f || f.month == null) miss.push("finance");
    if (miss.length) todo.push({ id: r.id, name: r.name, miss });
  });
  $("#todo-fiches").innerHTML = todo.length
    ? `<div class="list">${todo.map((t) => `<div class="item"><div class="grow"><div class="ttl">${esc(t.name)}</div><div class="sub">${t.miss.map((m) => `<span class="pill warn" style="margin-right:4px;">${esc(m)}</span>`).join("")}</div></div><button class="btn-ghost btn-sm todo-open" data-id="${t.id}">Compléter</button></div>`).join("")}</div>`
    : `<div class="card card-pad"><p class="muted" style="margin:0;">Toutes les fiches sont complètes. 👌</p></div>`;
  $$("#todo-fiches .todo-open").forEach((b) => b.addEventListener("click", () => openCampus360(b.dataset.id)));
  $("#quick").innerHTML = Object.entries(state.tasks).map(([k, t]) =>
    `<button class="task-card" data-task="${k}"><div class="ic">${TASK_ICON[k] || I.note}</div><div class="t">${esc(t.label)}</div><div class="d">${TASK_DESC[k] || ""}</div></button>`).join("");
  $$("#quick .task-card").forEach((b) => b.addEventListener("click", () => { state.task = b.dataset.task; setView("atelier"); }));
  const items = (recent || []).slice(0, 6);
  $("#recent").innerHTML = items.length ? items.map(delivItem).join("") : `<p class="empty">Aucun livrable pour l'instant.</p>`;
  bindDelivItems();
}

function renderAttention(a) {
  const el = $("#attention"); if (!el) return;
  a = a || {};
  const nOver = a.overdueActions?.length || 0, nRisk = a.atRisk?.length || 0, nSoon = a.dueSoon?.length || 0, nInc = a.openIncidents || 0;
  if (!nOver && !nRisk && !nSoon && !nInc) { el.innerHTML = `<div class="card card-pad"><p class="muted" style="margin:0;">Rien d'urgent aujourd'hui. 👍 Tout est sous contrôle.</p></div>`; return; }
  const card = (n, l, alert) => `<div class="stat ${alert && n ? "alert" : ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  // Nav #3 : l'accueil ne duplique plus les listes détaillées (elles vivent dans la
  // file unique « Priorités & alertes ») — il donne le pouls + un accès direct.
  el.innerHTML = `
    <div class="stats">
      ${card(nOver, "Actions en retard", true)}
      ${card(nSoon, "Échéances < 14 jours", false)}
      ${card(nRisk, "Campus à surveiller", true)}
      ${card(nInc, "Incidents ouverts", true)}
    </div>
    <div class="actions" style="margin-top:10px;"><button class="btn-primary btn-sm" id="att-go">🎯 Traiter dans Priorités &amp; alertes</button></div>`;
  const go = $("#att-go");
  if (go) go.onclick = () => setView("priorites");
}

// ---------- Vue : Atelier ----------
function renderAtelier() {
  const view = $("#view");
  view.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="tasks" id="tasks"></div>
    </div>
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="field">
          <label class="field-label" for="campus-sel">Campus <span class="muted">(facultatif)</span></label>
          <select id="campus-sel">${campusOptions(state.campus)}</select>
        </div>
        <div id="variant-zone"></div>
        <div class="field">
          <label class="field-label">Importer un fichier <span class="muted">(Excel, PDF, texte)</span></label>
          <div class="drop" id="drop">${I.upload}<div>Clique ou dépose un fichier ici</div></div>
          <input type="file" id="file" accept=".xlsx,.xls,.csv,.pdf,.txt,.md" hidden>
          <div id="file-info" style="margin-top:8px;"></div>
        </div>
        <div class="field">
          <label class="field-label" for="contexte">Contexte <span class="muted">(période, effectifs connus…)</span></label>
          <textarea id="contexte" rows="3" placeholder="Ex. Clôture juin 2026, capacité 420 places."></textarea>
        </div>
        <div class="field">
          <label class="field-label" for="input">Données à traiter</label>
          <textarea id="input" rows="12" placeholder="Colle ici le P&L, les notes de réunion, ou le contexte…"></textarea>
        </div>
        <div class="actions">
          <button id="run" class="btn-primary">Générer</button>
          <button id="stop" class="btn-ghost" hidden>Arrêter</button>
          <span id="status" class="status"></span>
        </div>
        <p class="hint muted" style="margin-top:10px;">⚠️ Aucun chiffre inventé : toute donnée absente est signalée <code>[DONNÉE MANQUANTE]</code>.</p>
      </div>
      <div class="card card-pad">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 id="res-title">Résultat</h3>
          <div id="res-tools"></div>
        </div>
        <div id="kpi-zone"></div>
        <div id="output" class="output"><p class="empty">Le livrable s'affichera ici.</p></div>
      </div>
    </div>`;

  renderTaskCards();
  updateVariantUI();
  $("#campus-sel").addEventListener("change", (e) => (state.campus = e.target.value));
  const fileInput = $("#file");
  $("#drop").addEventListener("click", () => fileInput.click());
  ["dragover", "dragleave", "drop"].forEach((ev) => $("#drop").addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }));
  fileInput.addEventListener("change", () => fileInput.files[0] && handleFile(fileInput.files[0]));
  $("#run").addEventListener("click", () => run(false));
  $("#stop").addEventListener("click", () => controller && controller.abort());
}
function renderTaskCards() {
  $("#tasks").innerHTML = Object.entries(state.tasks).map(([k, t]) =>
    `<button class="task-card ${k === state.task ? "active" : ""}" data-task="${k}"><div class="ic">${TASK_ICON[k] || I.note}</div><div class="t">${esc(t.label)}</div><div class="d">${TASK_DESC[k] || ""}</div></button>`).join("");
  $$("#tasks .task-card").forEach((b) => b.addEventListener("click", () => { state.task = b.dataset.task; renderTaskCards(); updateVariantUI(); }));
}
function updateVariantUI() {
  const zone = $("#variant-zone");
  if (!zone) return;
  if (state.task !== "ordre_du_jour" || !state.variants.length) { zone.innerHTML = ""; state.variant = ""; updateInputHint(); return; }
  zone.innerHTML = `<div class="field"><label class="field-label">Type de visite <span class="muted">(l'assistant propose la trame adaptée)</span></label>
    <div class="chips" id="chips">
      <button type="button" class="chip ${state.variant === "" ? "active" : ""}" data-v="">Générique</button>
      ${state.variants.map((v) => `<button type="button" class="chip ${state.variant === v.key ? "active" : ""}" data-v="${v.key}">${esc(v.label)}</button>`).join("")}
    </div></div>`;
  $$("#chips .chip").forEach((c) => c.addEventListener("click", () => { state.variant = c.dataset.v; updateVariantUI(); }));
  updateInputHint();
}
function updateInputHint() {
  const ta = $("#input");
  if (!ta) return;
  if (state.task === "ordre_du_jour" && state.variant) ta.placeholder = "Facultatif : ajoute des éléments spécifiques (points à traiter, dossiers en cours…). Sinon, l'assistant propose la trame standard de ce type de visite.";
  else if (state.task === "ordre_du_jour") ta.placeholder = "Contexte de la réunion / visite à préparer…";
  else ta.placeholder = "Colle ici le P&L, les notes de réunion, ou le contexte…";
}
async function handleFile(file) {
  const info = $("#file-info");
  info.innerHTML = `<span class="status">Extraction de ${esc(file.name)}…</span>`;
  const r = await api.upload(file);
  if (r.error) { info.innerHTML = `<span class="error">${esc(r.error)}</span>`; return; }
  const ta = $("#input");
  ta.value = (ta.value ? ta.value + "\n\n" : "") + r.text;
  info.innerHTML = `<span class="file-tag">✓ ${esc(r.filename)} — ${r.chars.toLocaleString("fr-FR")} caractères importés</span>`;
}

async function run(force) {
  const input = $("#input").value.trim();
  const isProposal = state.task === "ordre_du_jour" && state.variant;
  if (!input && !isProposal) { $("#status").textContent = "Colle ou importe des données."; return; }
  const out = $("#output"); const kz = $("#kpi-zone");
  kz.innerHTML = ""; state.lastMd = ""; state.lastId = null;
  out.innerHTML = '<div class="streaming"></div>';
  const live = out.querySelector(".streaming");
  setBusy(true);
  controller = new AbortController();
  try {
    const resp = await fetch("/api/generate", {
      method: "POST", headers: jsonHeaders(), signal: controller.signal,
      body: JSON.stringify({ task: state.task, input, contexte: $("#contexte").value.trim(), campusId: state.campus, variant: state.variant, force: !!force }),
    });
    if (resp.status === 401) return logout(true);
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await resp.json();
      if (j.upToDate) {
        out.innerHTML = `<p class="muted">Ce campus a déjà été analysé avec ces mêmes données (le <strong>${new Date(j.createdAt).toLocaleString("fr-FR")}</strong>). Inutile de régénérer.</p>`;
        state.lastId = j.id;
        $("#res-tools").innerHTML = `<button class="btn-primary btn-sm" id="pnl-view">Voir l'analyse</button> <button class="btn-ghost btn-sm" id="pnl-force">Régénérer quand même</button>`;
        $("#pnl-view").onclick = () => openDeliverable(j.id);
        $("#pnl-force").onclick = () => run(true);
        if (state.task === "pnl") showFinanceProposal(state.campus);   // proposition en attente éventuelle
        return;
      }
      out.innerHTML = `<p class="error">${esc(j.error || "Erreur")}</p>`;
      return;
    }
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    let raw = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; raw += dec.decode(value, { stream: true }); live.textContent = raw; out.scrollTop = out.scrollHeight; }
    // extraire id livrable + KPIs
    const idm = raw.match(/<!--deliverable:([a-f0-9]+)-->/);
    state.lastId = idm ? idm[1] : null;
    raw = raw.replace(/\n?<!--deliverable:[a-f0-9]+-->/, "");
    const wasTruncated = /<!--truncated-->/.test(raw);   // livrable coupé sur la longueur
    raw = raw.replace(/\n?<!--truncated-->/, "");
    const { md, kpis, chart, actions } = extractKpis(raw);
    state.lastMd = md; state.lastActions = actions || [];
    if (kpis || chart) kz.innerHTML = renderKpis(kpis) + renderChart(chart);
    out.innerHTML = mdSafe(md);
    renderResTools();
    // Livrable tronqué → le serveur n'a PAS créé de proposition finance (chiffres non fiables).
    if (state.task === "pnl" && !wasTruncated) showFinanceProposal(state.campus);   // chiffres IA à valider
    state.campuses = await api.get("/api/campuses") || state.campuses; // refresh count
  } catch (e) {
    if (e.name === "AbortError") $("#status").textContent = "Arrêté.";
    else out.innerHTML = `<p class="error">${esc(e.message || "Erreur")}</p>`;
  } finally { setBusy(false); controller = null; }
}
function setBusy(b) { state.busy = b; $("#run").disabled = b; $("#stop").hidden = !b; $("#status").textContent = b ? "Génération en cours…" : ($("#status").textContent === "Génération en cours…" ? "" : $("#status").textContent); if (b) $("#status").textContent = "Génération en cours…"; }

// Chiffres extraits par l'IA d'un P&L : bannière À VALIDER (zéro-hallucination).
// Rien n'entre en finance/board pack tant que le directeur n'a pas confirmé.
async function showFinanceProposal(campusId) {
  const old = document.getElementById("fin-proposal"); if (old) old.remove();
  if (!campusId) return;
  let p; try { p = await api.get(`/api/campuses/${campusId}/finance-proposal`); } catch { return; }
  if (!p || !p.pending) return;
  const fmt = (v) => Number(v || 0).toLocaleString("fr-FR");
  const s = p.summary || {};
  const banner = document.createElement("div");
  banner.id = "fin-proposal";
  banner.style.cssText = "border:1px solid #E2DACD;border-left:4px solid #FF6A4D;background:#FBF9F5;border-radius:10px;padding:12px 14px;margin:0 0 14px";
  banner.innerHTML = `
    <div style="font-weight:700;color:#0D1B2A;margin-bottom:6px">📊 Chiffres extraits par l'IA — <span style="color:#C94B33">à valider</span> <span style="color:#5A6672;font-weight:400">(${esc(p.month || "")})</span></div>
    <div style="font-size:13px;color:#0D1B2A">Produit <b>${fmt(s.revenue && s.revenue.total)} €</b> · Masse salariale <b>${fmt(s.payroll && s.payroll.total)} €</b> · Charges <b>${fmt(s.charges && s.charges.total)} €</b></div>
    <div style="font-size:12px;color:#5A6672;margin:6px 0 10px">Ces montants viennent du modèle. Rien n'est écrit en finance (ni au board pack) tant que tu n'as pas validé.</div>
    <div style="display:flex;gap:8px"><button class="btn-primary btn-sm" id="fp-confirm">✓ Valider et intégrer</button><button class="btn-ghost btn-sm" id="fp-discard">Ignorer</button></div>`;
  const out = $("#output"); out.parentNode.insertBefore(banner, out);
  $("#fp-confirm").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Intégration…";
    try { await api.post(`/api/campuses/${campusId}/finance-proposal/confirm`, {}); banner.innerHTML = `<div style="font-weight:700;color:#0B6E5F">✓ Chiffres validés et intégrés à la finance.</div>`; }
    catch { btn.disabled = false; btn.textContent = "✓ Valider et intégrer"; }
  };
  $("#fp-discard").onclick = async () => {
    try { await api.post(`/api/campuses/${campusId}/finance-proposal/discard`, {}); } catch { /* ignore */ }
    banner.remove();
  };
}

function extractKpis(md) {
  const m = md.match(/```json\s*([\s\S]*?)```/);
  if (!m) return { md: md.trim() };
  let data = null;
  try { data = JSON.parse(m[1]); } catch { return { md: md.trim() }; }
  return { md: md.replace(m[0], "").trim(), kpis: data.kpis, chart: data.chart, actions: data.actions };
}
async function addActionsToTracker(actions, campusId, sourceId, btn) {
  const list = (actions || []).filter((a) => a && (a.title || a.mesures || a.objectif));
  if (!list.length) return;
  if (btn) { btn.disabled = true; btn.textContent = "Ajout…"; }
  const campus = state.campuses.find((c) => c.id === campusId);
  for (const a of list) {
    await api.post("/api/actions", {
      title: a.title || a.mesures || a.objectif,
      objectif: a.objectif || "", moyen: a.moyen || "", mesures: a.mesures || "",
      owner: a.owner || "", dueDate: a.dueDate || "",
      campusId: campusId || "", campusName: campus?.name || "", sourceId: sourceId || null,
    });
  }
  if (btn) btn.textContent = `✓ ${list.length} ajoutée${list.length > 1 ? "s" : ""} au suivi`;
}
function renderKpis(kpis) {
  if (!Array.isArray(kpis) || !kpis.length) return "";
  return `<div class="kpis">` + kpis.map((k) => `<div class="kpi"><div class="v">${esc(k.value)}</div><div class="k">${esc(k.label)}</div>${k.hint ? `<div class="h">${esc(k.hint)}</div>` : ""}</div>`).join("") + `</div>`;
}
function renderChart(chart) {
  if (!chart || !Array.isArray(chart.bars) || !chart.bars.length) return "";
  const max = Math.max(...chart.bars.map((b) => Number(b.value) || 0)) || 1;
  const fmt = (v) => Number(v).toLocaleString("fr-FR");
  return `<div class="chart"><div class="ct">${esc(chart.title || "")}</div>` +
    chart.bars.map((b) => `<div class="bar-row"><span>${esc(b.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (Number(b.value) / max) * 100)}%"></div></div><span class="bar-val">${fmt(b.value)} ${esc(chart.unit || "")}</span></div>`).join("") +
    `</div>`;
}
function renderResTools() {
  if (!state.lastId) { $("#res-tools").innerHTML = ""; return; }
  const n = (state.lastActions || []).length;
  $("#res-tools").innerHTML = `
    ${n ? `<button class="btn-primary btn-sm" id="add-actions">➕ ${n} action${n > 1 ? "s" : ""} au suivi</button>` : ""}
    <button class="btn-ghost btn-sm" id="exp-docx">Word</button>
    <button class="btn-ghost btn-sm" id="exp-md">Markdown</button>
    <button class="btn-ghost btn-sm" id="exp-print">Imprimer / PDF</button>`;
  if (n) $("#add-actions").onclick = (e) => addActionsToTracker(state.lastActions, state.campus, state.lastId, e.currentTarget);
  $("#exp-docx").onclick = () => (location.href = `/api/deliverables/${state.lastId}/export?format=docx`);
  $("#exp-md").onclick = () => (location.href = `/api/deliverables/${state.lastId}/export?format=md`);
  $("#exp-print").onclick = () => window.open(`/api/deliverables/${state.lastId}/export?format=print`, "_blank");
}

// ---------- Vue : Historique ----------
async function renderHistorique() {
  const view = $("#view");
  view.innerHTML = `<div class="row" style="margin-bottom:16px;">
      <div><label class="field-label">Campus</label><select id="f-campus">${campusOptions("")}</select></div>
      <div><label class="field-label">Type</label><select id="f-task"><option value="">Tous</option>${Object.entries(state.tasks).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select></div>
    </div><div class="list" id="hist"><p class="muted">Chargement…</p></div>`;
  const load = async () => {
    const q = new URLSearchParams();
    if ($("#f-campus").value) q.set("campusId", $("#f-campus").value);
    if ($("#f-task").value) q.set("task", $("#f-task").value);
    const items = await api.get("/api/deliverables?" + q);
    $("#hist").innerHTML = items.length ? items.map(delivItem).join("") : `<p class="empty">Aucun livrable.</p>`;
    bindDelivItems();
  };
  $("#f-campus").addEventListener("change", load);
  $("#f-task").addEventListener("change", load);
  load();
}
function delivItem(d) {
  return `<div class="item" data-id="${d.id}">
    <span class="pill ${d.task}">${esc(taskLabel(d.task))}</span>
    <div class="grow"><div class="ttl">${esc(d.title)}</div><div class="sub">${d.campusName ? esc(d.campusName) + " · " : ""}${frDate(d.createdAt)}</div></div>
    <button class="btn-ghost btn-sm act-open">Ouvrir</button>
    <button class="btn-ghost btn-sm btn-danger act-del">Suppr.</button>
  </div>`;
}
function bindDelivItems() {
  $$(".item .act-open").forEach((b) => b.addEventListener("click", () => openDeliverable(b.closest(".item").dataset.id)));
  $$(".item .act-del").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ce livrable ?")) { await api.del(`/api/deliverables/${b.closest(".item").dataset.id}`); setView(state.view); } }));
}
async function openDeliverable(id) {
  const d = await api.get(`/api/deliverables/${id}`);
  if (!d || d.error) return;
  const { md, kpis, chart, actions } = extractKpis(d.content);
  const body = (kpis || chart ? renderKpis(kpis) + renderChart(chart) : "") + `<div class="output">${mdSafe(md)}</div>`;
  const nAct = (actions || []).length;
  const actBtn = nAct ? `<button class="btn-primary btn-sm" id="modal-add-actions">➕ ${nAct} au suivi</button>` : "";
  openModal(d.title, body, `${actBtn}
    <button class="btn-ghost btn-sm" data-export="docx">Word</button>
    <button class="btn-ghost btn-sm" data-export="md">Markdown</button>
    <button class="btn-ghost btn-sm" data-export="print">Imprimer</button>`);
  $$('.modal [data-export]').forEach((b) => b.addEventListener("click", () => { const f = b.dataset.export; if (f === "print") window.open(`/api/deliverables/${id}/export?format=print`, "_blank"); else location.href = `/api/deliverables/${id}/export?format=${f}`; }));
  if (nAct) $("#modal-add-actions").onclick = (e) => addActionsToTracker(actions, d.campusId, d.id, e.currentTarget);
}

// ---------- Vue : Plans d'action ----------
async function renderActions() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-action">${I.plus}<span>Action</span></button>`;
  $("#add-action").addEventListener("click", () => openActionForm(null));
  const view = $("#view");
  const actions = await api.get("/api/actions");
  const cols = [{ k: "todo", t: "À faire" }, { k: "doing", t: "En cours" }, { k: "done", t: "Fait" }];
  const today = new Date().toISOString().slice(0, 10);
  const raciLine = (a) => {
    const parts = [a.owner && `R : ${esc(a.owner)}`, a.accountable && `A : ${esc(a.accountable)}`, a.consulted && `C : ${esc(a.consulted)}`, a.informed && `I : ${esc(a.informed)}`].filter(Boolean);
    return parts.length ? `<div class="raci">${parts.join(" · ")}</div>` : "";
  };
  view.innerHTML = `<div class="cols">` + cols.map((col) => {
    const items = actions.filter((a) => a.status === col.k);
    return `<div class="col"><h3>${col.t} <span class="pill ${col.k}">${items.length}</span></h3><div class="list">` +
      (items.length ? items.map((a) => {
        const overdue = a.status !== "done" && a.dueDate && a.dueDate < today;
        return `<div class="item" style="align-items:flex-start;flex-direction:column;gap:6px;">
          <div class="grow" style="width:100%;">
            <div class="ttl">${a.category === "qualiopi" ? '<span class="pill" style="background:var(--good-bg);color:var(--marine);margin-right:6px;">Qualiopi</span>' : ""}${esc(a.title)}</div>
            <div class="sub">${a.dueDate ? `<span class="${overdue ? "pill overdue" : ""}">${overdue ? "⏰ " : "📅 "}${esc(a.dueDate)}</span>` : "<span class='muted'>sans échéance</span>"}${a.campusName ? " · " + esc(a.campusName) : ""}</div>
            ${(a.objectif || a.moyen || a.mesures) ? `<div class="act-omm">${a.objectif ? `<b>Objectif :</b> ${esc(a.objectif)}` : ""}${a.moyen ? `${a.objectif ? " · " : ""}<b>Moyen :</b> ${esc(a.moyen)}` : ""}${a.mesures ? `${(a.objectif || a.moyen) ? " · " : ""}<b>Mesures :</b> ${esc(a.mesures)}` : ""}</div>` : ""}
            ${raciLine(a)}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${a.status !== "todo" ? `<button class="btn-ghost btn-sm mv" data-id="${a.id}" data-s="todo">←</button>` : ""}
            ${a.status !== "doing" ? `<button class="btn-ghost btn-sm mv" data-id="${a.id}" data-s="doing">En cours</button>` : ""}
            ${a.status !== "done" ? `<button class="btn-ghost btn-sm mv" data-id="${a.id}" data-s="done">✓ Fait</button>` : ""}
            <button class="btn-ghost btn-sm ed" data-id="${a.id}">Éditer</button>
            <button class="btn-ghost btn-sm btn-danger dl" data-id="${a.id}">Suppr.</button>
          </div></div>`;
      }).join("") : `<p class="empty" style="padding:14px;">—</p>`) + `</div></div>`;
  }).join("") + `</div>`;
  $$(".mv").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/actions/${b.dataset.id}`, { status: b.dataset.s }); renderActions(); }));
  $$(".ed").forEach((b) => b.addEventListener("click", () => openActionForm(actions.find((a) => a.id === b.dataset.id))));
  $$(".dl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ?")) { await api.del(`/api/actions/${b.dataset.id}`); renderActions(); } }));
}
function openActionForm(action) {
  const a = action || {};
  const isEdit = !!(action && action.id);
  const body = `
    <div class="field"><label class="field-label">Intitulé de l'action</label><input class="txt af" data-f="title" value="${esc(a.title || "")}"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Objectif</label><input class="txt af" data-f="objectif" value="${esc(a.objectif || "")}" placeholder="Résultat visé"></div>
      <div><label class="field-label">Moyen</label><input class="txt af" data-f="moyen" value="${esc(a.moyen || "")}" placeholder="Ressources / levier"></div>
    </div>
    <div class="field"><label class="field-label">Mesures</label><textarea class="af" data-f="mesures" rows="2" placeholder="Actions concrètes à mener">${esc(a.mesures || "")}</textarea></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Campus</label><select class="af" data-f="campusId">${campusOptions(a.campusId || state.campus || "")}</select></div>
      <div><label class="field-label">Échéance (timing)</label><input class="txt af" data-f="dueDate" type="date" value="${esc(a.dueDate || "")}"></div>
    </div>
    <div class="section-title">RACI</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Responsable (R) <span class="muted">— exécute</span></label><input class="txt af" data-f="owner" value="${esc(a.owner || "")}"></div>
      <div><label class="field-label">Approbateur (A) <span class="muted">— rend compte</span></label><input class="txt af" data-f="accountable" value="${esc(a.accountable || "")}"></div>
      <div><label class="field-label">Consulté (C)</label><input class="txt af" data-f="consulted" value="${esc(a.consulted || "")}"></div>
      <div><label class="field-label">Informé (I)</label><input class="txt af" data-f="informed" value="${esc(a.informed || "")}"></div>
    </div>
    <div class="actions" style="margin-top:16px;"><button class="btn-primary" id="af-save">${isEdit ? "Enregistrer" : "Créer l'action"}</button></div>`;
  openModal(isEdit ? "Modifier l'action" : "Nouvelle action", body);
  $("#af-save").onclick = async () => {
    const patch = {}; $$(".af").forEach((i) => (patch[i.dataset.f] = i.value.trim()));
    if (!patch.title) return;
    patch.campusName = state.campuses.find((c) => c.id === patch.campusId)?.name || "";
    if (!isEdit && a.category) patch.category = a.category;
    if (isEdit) await api.patch(`/api/actions/${a.id}`, patch);
    else await api.post("/api/actions", patch);
    closeModals();
    if (state.view === "actions") renderActions();
    else if (state.view === "notifications") renderNotifications();
    else refreshNotifCount();
  };
}

// ---------- Vue : Décisions (CODIR) ----------
const DEC_STATUS = { open: "En cours", done: "Actée / faite", dropped: "Abandonnée" };
async function renderDecisions() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-dec">${I.plus}<span>Décision</span></button>`;
  $("#add-dec").addEventListener("click", () => openDecisionForm(null));
  const view = $("#view");
  const decisions = await api.get("/api/decisions");
  const today = new Date().toISOString().slice(0, 10);
  const open = decisions.filter((d) => d.status === "open");
  const overdue = open.filter((d) => d.dueDate && d.dueDate < today).length;
  const kpi = (v, l) => `<div class="k"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const badge = (s) => `<span class="pill ${s === "done" ? "done" : s === "dropped" ? "" : "doing"}">${DEC_STATUS[s] || s}</span>`;
  const row = (d) => {
    const late = d.status === "open" && d.dueDate && d.dueDate < today;
    return `<div class="item" style="align-items:flex-start;flex-direction:column;gap:6px;">
      <div class="grow" style="width:100%;">
        <div class="ttl">${badge(d.status)} ${esc(d.title)}</div>
        <div class="sub">${d.owner ? "👤 " + esc(d.owner) : "<span class='muted'>sans pilote</span>"}${d.campusName ? " · " + esc(d.campusName) : ""} · décidée le ${esc(d.decidedAt || "—")}${d.dueDate ? ` · <span class="${late ? "pill overdue" : ""}">${late ? "⏰ " : "📅 "}échéance ${esc(d.dueDate)}</span>` : ""}</div>
        ${d.description ? `<div class="act-omm">${esc(d.description)}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${d.status !== "done" ? `<button class="btn-ghost btn-sm dec-mv" data-id="${d.id}" data-s="done">✓ Actée</button>` : ""}
        ${d.status !== "open" ? `<button class="btn-ghost btn-sm dec-mv" data-id="${d.id}" data-s="open">Rouvrir</button>` : ""}
        ${d.status !== "dropped" ? `<button class="btn-ghost btn-sm dec-mv" data-id="${d.id}" data-s="dropped">Abandonner</button>` : ""}
        <button class="btn-ghost btn-sm dec-ed" data-id="${d.id}">Éditer</button>
        <button class="btn-ghost btn-sm btn-danger dec-dl" data-id="${d.id}">Suppr.</button>
      </div></div>`;
  };
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:12px;">${kpi(open.length, "en cours")}${kpi(overdue, "en retard")}${kpi(decisions.filter((d) => d.status === "done").length, "actées")}</div>
    <div class="section-title" style="margin-top:0;">Décisions à suivre</div>
    <div class="list">${open.length ? open.map(row).join("") : `<p class="empty" style="padding:14px;">Aucune décision en cours. Trace ici les arbitrages du CODIR pour ne rien perdre.</p>`}</div>
    ${decisions.some((d) => d.status !== "open") ? `<div class="section-title">Historique</div><div class="list">${decisions.filter((d) => d.status !== "open").map(row).join("")}</div>` : ""}`;
  $$(".dec-mv").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/decisions/${b.dataset.id}`, { status: b.dataset.s }); renderDecisions(); refreshNotifCount(); }));
  $$(".dec-ed").forEach((b) => b.addEventListener("click", () => openDecisionForm(decisions.find((d) => d.id === b.dataset.id))));
  $$(".dec-dl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer cette décision ?")) { await api.del(`/api/decisions/${b.dataset.id}`); renderDecisions(); refreshNotifCount(); } }));
}
function openDecisionForm(decision) {
  const d = decision || {};
  const isEdit = !!(decision && decision.id);
  const body = `
    <div class="field"><label class="field-label">Décision prise</label><input class="txt df" data-f="title" value="${esc(d.title || "")}" placeholder="Ex. Fermer la filière X à Lille à la rentrée 2027"></div>
    <div class="field"><label class="field-label">Contexte / justification</label><textarea class="df" data-f="description" rows="2" placeholder="Pourquoi, alternatives écartées…">${esc(d.description || "")}</textarea></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Pilote (responsable)</label><input class="txt df" data-f="owner" value="${esc(d.owner || "")}"></div>
      <div><label class="field-label">Campus concerné</label><select class="df" data-f="campusId">${campusOptions(d.campusId || "")}</select></div>
      <div><label class="field-label">Date de décision</label><input class="txt df" data-f="decidedAt" type="date" value="${esc(d.decidedAt || new Date().toISOString().slice(0, 10))}"></div>
      <div><label class="field-label">Échéance de mise en œuvre</label><input class="txt df" data-f="dueDate" type="date" value="${esc(d.dueDate || "")}"></div>
      <div><label class="field-label">Statut</label><select class="df" data-f="status">${Object.entries(DEC_STATUS).map(([k, v]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="actions" style="margin-top:16px;"><button class="btn-primary" id="df-save">${isEdit ? "Enregistrer" : "Enregistrer la décision"}</button></div>`;
  openModal(isEdit ? "Modifier la décision" : "Nouvelle décision CODIR", body);
  $("#df-save").onclick = async () => {
    const patch = {}; $$(".df").forEach((i) => (patch[i.dataset.f] = i.value.trim ? i.value.trim() : i.value));
    if (!patch.title) return;
    patch.campusName = state.campuses.find((c) => c.id === patch.campusId)?.name || null;
    if (isEdit) await api.patch(`/api/decisions/${d.id}`, patch);
    else await api.post("/api/decisions", patch);
    closeModals(); renderDecisions(); refreshNotifCount();
  };
}

// ---------- Vue : Revues mensuelles par campus ----------
function snapshotGrid(s) {
  if (!s) return "";
  const cell = (v, l, suf = "") => `<div class="k"><div class="v">${v == null ? "—" : v + suf}</div><div class="l">${l}</div></div>`;
  const money = (v) => (v == null ? null : Math.round(v).toLocaleString("fr-FR") + " €");
  return `<div class="kpis" style="margin:6px 0;">
    ${cell(s.health, "Santé", "/100")}${cell(s.occupancy, "Remplissage", " %")}${cell(s.qualiopi, "Qualiopi", " %")}
    ${cell(s.satisfaction, "Satisfaction", "/10")}${cell(money(s.revenue), "CA")}${cell(money(s.margin), "Marge")}
    ${cell(s.openActions, "Actions ouvertes")}${cell(s.overdueActions, "En retard")}${cell(s.openIncidents, "Incidents")}</div>`;
}
async function renderRevues() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [cadence, reviews] = await Promise.all([api.get("/api/reviews/cadence"), api.get("/api/reviews")]);
  const cadRow = (c) => `<div class="item">
    <div class="grow"><div class="ttl">${esc(c.campus)}</div><div class="sub">${c.lastMonth ? "Dernière revue : " + esc(c.lastMonth) + (c.monthsSince != null ? ` (il y a ${c.monthsSince} mois)` : "") : "<span class='pill warn'>jamais réalisée</span>"}</div></div>
    <button class="btn-primary btn-sm rev-do" data-cid="${c.campusId}" data-name="${esc(c.campus)}">${c.due ? "Faire la revue" : "Nouvelle revue"}</button></div>`;
  const due = cadence.filter((c) => c.due);
  const revItem = (r) => `<div class="item" style="align-items:flex-start;flex-direction:column;gap:6px;">
    <div class="grow" style="width:100%;"><div class="ttl">${esc(r.campusName || "")} — ${esc(r.month)}</div>
    ${snapshotGrid(r.snapshot)}
    ${r.notes ? `<div class="act-omm">${esc(r.notes)}</div>` : "<span class='muted'>sans note</span>"}</div>
    <button class="btn-ghost btn-sm btn-danger rev-dl" data-id="${r.id}">Supprimer</button></div>`;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Cadence — revues à faire</div>
    <div class="list">${due.length ? due.map(cadRow).join("") : `<p class="empty" style="padding:14px;">Toutes les revues sont à jour ce mois-ci. 👌</p>`}</div>
    <div class="section-title">Tous les campus</div>
    <div class="list">${cadence.map(cadRow).join("")}</div>
    <div class="section-title">Historique des revues</div>
    <div class="list">${reviews.length ? reviews.map(revItem).join("") : `<p class="empty" style="padding:14px;">Aucune revue enregistrée.</p>`}</div>`;
  $$(".rev-do").forEach((b) => b.addEventListener("click", () => openReviewForm(b.dataset.cid, b.dataset.name)));
  $$(".rev-dl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer cette revue ?")) { await api.del(`/api/reviews/${b.dataset.id}`); renderRevues(); refreshNotifCount(); } }));
}
async function openReviewForm(campusId, campusName) {
  const month = new Date().toISOString().slice(0, 7);
  const body = `
    <p class="muted" style="margin-top:0;">Instantané des indicateurs de <b>${esc(campusName)}</b> qui sera figé dans la revue :</p>
    <div id="rvf-snap"><p class="muted">Chargement des indicateurs…</p></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
      <div><label class="field-label">Mois</label><input class="txt rvf" data-f="month" type="month" value="${month}"></div>
    </div>
    <div class="field"><label class="field-label" style="display:flex;justify-content:space-between;align-items:center;">Notes de revue <button type="button" class="btn-ghost btn-sm" id="rvf-ai">✨ Rédiger (IA)</button></label><textarea class="rvf" data-f="notes" rows="7" placeholder="Points marquants, décisions, points de vigilance, engagements pris avec le directeur…"></textarea><span id="rvf-ai-msg" class="status"></span></div>
    <div class="actions" style="margin-top:16px;"><button class="btn-primary" id="rvf-save">Enregistrer la revue</button></div>`;
  openModal(`Revue mensuelle — ${campusName}`, body);
  // Premier jet IA depuis le snapshot chiffré + la revue précédente (relire/éditer avant d'enregistrer).
  $("#rvf-ai").onclick = async () => {
    const btn = $("#rvf-ai"); btn.disabled = true; $("#rvf-ai-msg").textContent = "Rédaction… (~15 s)";
    try {
      const month = document.querySelector('.rvf[data-f="month"]')?.value || "";
      const r = await api.post("/api/reviews/draft-notes", { campusId, month });
      if (r?.draft) {
        document.querySelector('.rvf[data-f="notes"]').value = r.draft;
        $("#rvf-ai-msg").textContent = r.truncated ? "⚠️ Jet tronqué — à compléter." : "Premier jet — relis et ajuste.";
      } else $("#rvf-ai-msg").textContent = r?.error || "Échec de la rédaction";
    } catch { $("#rvf-ai-msg").textContent = "Erreur réseau"; }
    btn.disabled = false;
  };
  let snapshot = null;
  try {
    snapshot = await api.get(`/api/reviews/snapshot/${campusId}`);
    if (snapshot && !snapshot.error) {
      const allEmpty = ["health", "occupancy", "qualiopi", "satisfaction", "revenue", "margin"].every((k) => snapshot[k] == null);
      $("#rvf-snap").innerHTML = allEmpty
        ? `<p class="empty" style="padding:12px;">Aucun indicateur renseigné pour ce campus. Complète d'abord sa fiche (Réseau / Finance / Indicateurs) pour figer des chiffres.</p>`
        : snapshotGrid(snapshot);
    } else { $("#rvf-snap").innerHTML = `<p class="empty" style="padding:12px;">Indicateurs indisponibles.</p>`; snapshot = null; }
  } catch { $("#rvf-snap").innerHTML = `<p class="empty" style="padding:12px;">Indicateurs indisponibles.</p>`; }
  $("#rvf-save").onclick = async () => {
    const patch = { campusId }; $$(".rvf").forEach((i) => (patch[i.dataset.f] = i.value));
    if (snapshot) patch.snapshot = snapshot;
    await api.post("/api/reviews", patch);
    closeModals(); renderRevues(); refreshNotifCount();
  };
}

// ---------- Vue : JPO & événements de recrutement ----------
const EVT_TYPE = { jpo: "JPO", salon: "Salon", immersion: "Immersion", webinaire: "Webinaire", autre: "Autre" };
const EVT_STATUS = { prevu: "Prévu", realise: "Réalisé", annule: "Annulé" };
async function renderEvenements() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-evt">${I.plus}<span>Événement</span></button>`;
  $("#add-evt").addEventListener("click", () => openEventForm(null));
  const view = $("#view");
  const events = await api.get("/api/events");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.status !== "annule" && (!e.date || e.date >= today));
  const past = events.filter((e) => !(e.status !== "annule" && (!e.date || e.date >= today)));
  const conv = (e) => (e.attendees && e.inscrits != null) ? Math.round((e.inscrits / e.attendees) * 100) + " %" : "—";
  const badge = (s) => `<span class="pill ${s === "realise" ? "done" : s === "annule" ? "" : "doing"}">${EVT_STATUS[s] || s}</span>`;
  const row = (e) => `<div class="item" style="align-items:flex-start;flex-direction:column;gap:6px;">
    <div class="grow" style="width:100%;">
      <div class="ttl">${badge(e.status)} <span class="pill" style="background:var(--good-bg);color:var(--marine);">${EVT_TYPE[e.type] || e.type}</span> ${esc(e.title || EVT_TYPE[e.type])}</div>
      <div class="sub">${e.date ? "📅 " + esc(e.date) : "<span class='muted'>date à définir</span>"}${e.campusName ? " · " + esc(e.campusName) : ""}</div>
      <div class="act-omm">${[e.target != null && `🎯 objectif ${e.target}`, e.attendees != null && `👥 ${e.attendees} présents`, e.leads != null && `📇 ${e.leads} contacts`, e.inscrits != null && `✅ ${e.inscrits} inscrits`, `↗ conversion ${conv(e)}`].filter(Boolean).join(" · ")}</div>
      ${e.note ? `<div class="sub">${esc(e.note)}</div>` : ""}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn-ghost btn-sm evt-ed" data-id="${e.id}">Éditer</button>
      <button class="btn-ghost btn-sm btn-danger evt-dl" data-id="${e.id}">Suppr.</button>
    </div></div>`;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">À venir</div>
    <div class="list">${upcoming.length ? upcoming.map(row).join("") : `<p class="empty" style="padding:14px;">Aucun événement à venir. Planifie tes JPO et salons pour piloter le recrutement.</p>`}</div>
    ${past.length ? `<div class="section-title">Passés</div><div class="list">${past.map(row).join("")}</div>` : ""}`;
  $$(".evt-ed").forEach((b) => b.addEventListener("click", () => openEventForm(events.find((e) => e.id === b.dataset.id))));
  $$(".evt-dl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer cet événement ?")) { await api.del(`/api/events/${b.dataset.id}`); renderEvenements(); } }));
}
function openEventForm(event) {
  const e = event || {};
  const isEdit = !!(event && event.id);
  const num = (v) => (v == null ? "" : v);
  const body = `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Campus</label><select class="evf" data-f="campusId">${campusOptions(e.campusId || state.campus || "")}</select></div>
      <div><label class="field-label">Type</label><select class="evf" data-f="type">${Object.entries(EVT_TYPE).map(([k, v]) => `<option value="${k}" ${e.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label class="field-label">Titre</label><input class="txt evf" data-f="title" value="${esc(e.title || "")}" placeholder="Ex. JPO de printemps"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Date</label><input class="txt evf" data-f="date" type="date" value="${esc(e.date || "")}"></div>
      <div><label class="field-label">Statut</label><select class="evf" data-f="status">${Object.entries(EVT_STATUS).map(([k, v]) => `<option value="${k}" ${e.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div><label class="field-label">Objectif présents</label><input class="txt evf" data-f="target" type="number" min="0" value="${num(e.target)}"></div>
      <div><label class="field-label">Présents (réalisé)</label><input class="txt evf" data-f="attendees" type="number" min="0" value="${num(e.attendees)}"></div>
      <div><label class="field-label">Contacts / leads</label><input class="txt evf" data-f="leads" type="number" min="0" value="${num(e.leads)}"></div>
      <div><label class="field-label">Inscrits générés</label><input class="txt evf" data-f="inscrits" type="number" min="0" value="${num(e.inscrits)}"></div>
    </div>
    <div class="field"><label class="field-label">Note</label><textarea class="evf" data-f="note" rows="2">${esc(e.note || "")}</textarea></div>
    <div class="actions" style="margin-top:16px;"><button class="btn-primary" id="evf-save">${isEdit ? "Enregistrer" : "Créer l'événement"}</button></div>`;
  openModal(isEdit ? "Modifier l'événement" : "Nouvel événement de recrutement", body);
  $("#evf-save").onclick = async () => {
    const patch = {}; $$(".evf").forEach((i) => (patch[i.dataset.f] = i.type === "number" ? (i.value === "" ? null : Number(i.value)) : (i.value.trim ? i.value.trim() : i.value)));
    if (!patch.campusId) { alert("Choisis un campus."); return; }
    if (isEdit) await api.patch(`/api/events/${e.id}`, patch);
    else await api.post("/api/events", patch);
    closeModals(); renderEvenements();
  };
}

// ---------- Vue : Paramètres (seuils + board pack) ----------
const TH_FIELDS = [
  { k: "occupancy", l: "Remplissage minimal", suf: "%", help: "Alerte si un campus est sous ce taux d'occupation" },
  { k: "admissionsWarn", l: "Recrutement — alerte", suf: "%", help: "Alerte si l'atteinte de l'objectif est sous ce seuil" },
  { k: "admissionsCrit", l: "Recrutement — critique", suf: "%", help: "Alerte rouge sous ce seuil" },
  { k: "satisfaction", l: "Satisfaction minimale", suf: "/10", help: "Alerte si la satisfaction est sous cette note" },
  { k: "marginPct", l: "Marge minimale", suf: "%", help: "Alerte si la marge d'un campus est sous ce pourcentage" },
  { k: "qualiopiMonths", l: "Horizon Qualiopi", suf: "mois", help: "Alerte quand un audit Qualiopi arrive dans ce délai" },
  { k: "absenteeism", l: "Absentéisme maximal", suf: "%", help: "Alerte si le taux d'absentéisme du SI campus (minutes prévues vs assiduité) dépasse ce seuil" },
];
async function renderParametres() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const s = await api.get("/api/settings");
  const th = s.thresholds || {};
  const board = s.board || { enabled: false, recipients: "" };
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Seuils d'alerte</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Ces seuils pilotent les alertes de la page <b>Notifications</b> et du cockpit.</p>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px;">
        ${TH_FIELDS.map((f) => `<div><label class="field-label">${f.l} <span class="muted">(${f.suf})</span></label><input class="txt thf" data-f="${f.k}" type="number" step="any" value="${th[f.k] ?? ""}"><div class="sub muted">${f.help}</div></div>`).join("")}
      </div>
      <div class="actions" style="margin-top:14px;"><button class="btn-primary" id="th-save">Enregistrer les seuils</button></div>
    </div>
    <div class="section-title">Rémunération de référence</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Le SMIC mensuel brut sert de base à tous les contrôles de rémunération des contrats d'alternance. <b>À mettre à jour à chaque revalorisation</b>, sinon l'application valide des salaires inférieurs au minimum légal.</p>
      <div class="field" style="max-width:280px;"><label class="field-label">SMIC mensuel brut (€)</label>
        <input class="txt" id="smic-val" type="number" step="0.01" value="${s.smicMensuel ?? ""}" placeholder="${s.smicDefaut}">
        <div class="sub muted">Valeur de référence intégrée : ${s.smicDefaut} €. Laisser vide pour l'utiliser.</div></div>
      <div class="actions" style="margin-top:10px;"><button class="btn-primary btn-sm" id="smic-save">Enregistrer</button></div>
    </div>
    <div class="section-title">Assistance IA</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Les fonctions d'assistance (rédaction, synthèses, suggestions) transmettent le contenu soumis à un fournisseur d'IA tiers, potentiellement hors Union européenne. ${s.iaDisponible ? "" : "<b>Aucune clé n'est configurée sur cette instance : l'assistance est indisponible.</b>"}</p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><input type="checkbox" id="ia-off" ${s.iaDesactivee ? "checked" : ""}> <span>Désactiver l'assistance IA sur cette instance</span></label>
      <div class="sub muted">Le reste de l'application continue de fonctionner normalement. Ce traitement figure au registre RGPD.</div>
      <div class="actions" style="margin-top:10px;"><button class="btn-primary btn-sm" id="ia-save">Enregistrer</button></div>
      <div id="ia-msg" class="sub" style="margin-top:8px;"></div>
    </div>
    <div class="section-title">Board pack mensuel</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Rapport de pilotage réseau envoyé automatiquement le 1er de chaque mois (7h) aux destinataires ci-dessous.</p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><input type="checkbox" id="bp-enabled" ${board.enabled ? "checked" : ""}> <span>Activer l'envoi automatique mensuel</span></label>
      <div class="field"><label class="field-label">Destinataires <span class="muted">(emails séparés par des virgules)</span></label><input class="txt" id="bp-recipients" value="${esc(board.recipients || "")}" placeholder="direction@…, associes@…"></div>
      <div class="actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-primary" id="bp-save">Enregistrer</button>
        <button class="btn-ghost" id="bp-send">Envoyer maintenant</button>
        <button class="btn-ghost" id="bp-preview">Prévisualiser le rapport</button>
      </div>
      <div id="bp-msg" class="sub" style="margin-top:8px;"></div>
    </div>`;
  $("#smic-save").onclick = () => guard($("#smic-save"), async () => {
    const r = await api.put("/api/settings", { smicMensuel: $("#smic-val").value === "" ? null : $("#smic-val").value });
    $("#bp-msg").textContent = r.error || "SMIC enregistré.";
    $("#bp-msg").style.color = r.error ? "var(--bad)" : "var(--good)";
  });
  $("#ia-save").onclick = () => guard($("#ia-save"), async () => {
    const r = await api.put("/api/settings", { iaDesactivee: $("#ia-off").checked });
    $("#ia-msg").textContent = r.error || ($("#ia-off").checked ? "Assistance IA désactivée." : "Assistance IA réactivée.");
    $("#ia-msg").style.color = r.error ? "var(--bad)" : "var(--good)";
  });
  $("#th-save").onclick = async () => {
    const thresholds = {}; $$(".thf").forEach((i) => { if (i.value !== "") thresholds[i.dataset.f] = Number(i.value); });
    await api.put("/api/settings", { thresholds });
    $("#bp-msg").textContent = "Seuils enregistrés."; $("#bp-msg").style.color = "var(--good)";
  };
  const saveBoard = () => api.put("/api/settings", { board: { enabled: $("#bp-enabled").checked, recipients: $("#bp-recipients").value.trim() } });
  $("#bp-save").onclick = async () => { await saveBoard(); $("#bp-msg").textContent = "Configuration enregistrée."; $("#bp-msg").style.color = "var(--good)"; };
  $("#bp-send").onclick = async () => {
    await saveBoard();
    const msg = $("#bp-msg"); msg.textContent = "Envoi en cours…"; msg.style.color = "var(--muted)";
    const r = await api.post("/api/board/send", { recipients: $("#bp-recipients").value.trim() });
    if (r?.error) { msg.textContent = "Échec : " + r.error; msg.style.color = "var(--danger)"; }
    else { msg.textContent = `Board pack envoyé à ${r.recipients} destinataire(s).`; msg.style.color = "var(--good)"; }
  };
  $("#bp-preview").onclick = () => window.open("/api/report", "_blank");
}

// ---------- Vue : RGPD & conformité ----------
async function renderRGPD() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [cfg, users] = await Promise.all([api.get("/api/rgpd"), api.get("/api/users")]);
  const reg = cfg.register || [];
  const regRows = reg.map((r, i) => `<tr data-i="${i}">
    <td><input class="txt rg" data-f="data" value="${esc(r.data)}"></td>
    <td><input class="txt rg" data-f="purpose" value="${esc(r.purpose)}"></td>
    <td><input class="txt rg" data-f="basis" value="${esc(r.basis)}"></td>
    <td><input class="txt rg" data-f="retention" value="${esc(r.retention)}"></td>
    <td><button class="btn-ghost btn-sm btn-danger rg-del">✕</button></td></tr>`).join("");
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Registre des traitements</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table" id="rg-table">
      <thead><tr><th>Donnée traitée</th><th>Finalité</th><th>Base légale</th><th>Conservation</th><th></th></tr></thead>
      <tbody>${regRows}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <button class="btn-ghost btn-sm" id="rg-add">+ Ligne</button>
      <button class="btn-primary btn-sm" id="rg-save">Enregistrer le registre</button>
      <button class="btn-ghost btn-sm" id="rg-print">Imprimer / PDF</button>
    </div>
    <div id="rg-msg" class="sub" style="margin-top:6px;"></div>

    <div class="section-title">Droits des personnes</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Export des données personnelles d'un compte (droit d'accès & portabilité). La suppression d'un compte (droit à l'effacement) se fait dans l'onglet <b>Utilisateurs</b>.</p>
      <div class="list">${users.map((u) => `<div class="item"><div class="grow"><div class="ttl">${esc(u.name || u.email)}</div><div class="sub">${esc(u.email)} · ${u.role}</div></div><button class="btn-ghost btn-sm rg-export" data-id="${u.id}">Exporter ses données (JSON)</button></div>`).join("")}</div>
    </div>

    <div class="section-title">Politique de rétention</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Le journal d'audit est conservé <b>${cfg.retentionMonths} mois</b>, puis purgé. Briefs limités aux 14 derniers.</p>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div><label class="field-label">Durée de conservation du journal (mois)</label><input class="txt" id="rg-months" type="number" min="1" max="120" value="${cfg.retentionMonths}" style="width:120px;"></div>
        <button class="btn-ghost" id="rg-purge">Purger le journal maintenant</button>
      </div>
      <div id="rg-purge-msg" class="sub" style="margin-top:8px;"></div>
    </div>`;
  const collect = () => [...document.querySelectorAll("#rg-table tbody tr")].map((tr) => { const o = {}; $$(".rg", tr).forEach((i) => (o[i.dataset.f] = i.value.trim())); return o; }).filter((o) => o.data || o.purpose);
  $("#rg-add").onclick = () => { const tb = document.querySelector("#rg-table tbody"); const tr = document.createElement("tr"); tr.innerHTML = `<td><input class="txt rg" data-f="data"></td><td><input class="txt rg" data-f="purpose"></td><td><input class="txt rg" data-f="basis"></td><td><input class="txt rg" data-f="retention"></td><td><button class="btn-ghost btn-sm btn-danger rg-del">✕</button></td>`; tb.appendChild(tr); tr.querySelector(".rg-del").onclick = () => tr.remove(); };
  $$(".rg-del").forEach((b) => b.addEventListener("click", (e) => e.target.closest("tr").remove()));
  $("#rg-save").onclick = async () => { await api.put("/api/rgpd", { register: collect(), retentionMonths: Number($("#rg-months").value) }); $("#rg-msg").textContent = "Registre enregistré."; $("#rg-msg").style.color = "var(--good)"; };
  $("#rg-print").onclick = () => window.print();
  $$(".rg-export").forEach((b) => b.addEventListener("click", () => { location.href = `/api/users/${b.dataset.id}/export`; }));
  $("#rg-purge").onclick = async () => {
    await api.put("/api/rgpd", { retentionMonths: Number($("#rg-months").value) });
    if (!confirm(`Purger définitivement les entrées du journal d'audit de plus de ${$("#rg-months").value} mois ?`)) return;
    const r = await api.post("/api/rgpd/purge", {});
    $("#rg-purge-msg").textContent = `${r.removed} entrée(s) purgée(s) (> ${r.months} mois).`; $("#rg-purge-msg").style.color = "var(--good)";
  };
}

// ---------- Vue : Heatmap réseau ----------
const HEAT_DIMS = [["finance", "Finance"], ["remplissage", "Rempl."], ["admissions", "Admiss."], ["qualiopi", "Qualiopi"], ["actions", "Actions"], ["incidents", "Incid."], ["satisfaction", "Satisf."], ["insertion", "Insert."], ["visites", "Visites"], ["direction", "Direction"]];
const DRIFT_ICON = { marge: "📉", remplissage: "🏫", satisfaction: "🙁", incidents: "⚠️", admissions: "🎯", revue: "🗓️" };
function trendArrow(t) {
  if (t === "up") return '<span class="heat-tr up">▲</span>';
  if (t === "down") return '<span class="heat-tr down">▼</span>';
  return "";
}
async function renderHeatmap() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const data = await api.get("/api/heatmap");
  const rows = data.rows || [], drifts = data.drifts || [];
  const hb = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="sig-badge h-${v >= 75 ? "good" : v >= 50 ? "warn" : "bad"}">${v}</span>`);
  const head = `<tr><th>Campus</th><th>Santé</th>${HEAT_DIMS.map(([, l]) => `<th class="c">${l}</th>`).join("")}</tr>`;
  const body = rows.length ? rows.map((r) => `<tr>
      <td><b class="lnk hm-campus" data-id="${r.campusId}">${esc(r.campus)}</b></td>
      <td class="c">${hb(r.health)}</td>
      ${HEAT_DIMS.map(([k]) => { const c = r.cells[k] || {}; return `<td class="c heat-cell heat-${c.status || "na"}" data-c="${r.campusId}" data-k="${k}" title="${esc(r.campus)} · ${c.value || "—"}"><span>${esc(c.value ?? "—")}</span>${trendArrow(c.trend)}</td>`; }).join("")}
    </tr>`).join("") : `<tr><td colspan="${HEAT_DIMS.length + 2}"><p class="empty" style="padding:14px;">Aucun campus.</p></td></tr>`;
  const driftHtml = drifts.length ? drifts.map((d) => `<div class="item drift-${d.severity}"><span style="font-size:16px;">${DRIFT_ICON[d.type] || "•"}</span><div class="grow"><div class="ttl">${esc(d.campus)}</div><div class="sub">${esc(d.label)}</div></div><button class="btn-ghost btn-sm drift-go" data-id="${d.campusId}">Ouvrir</button></div>`).join("") : `<div class="card card-pad"><p class="muted" style="margin:0;">Aucune dérive détectée. 👌</p></div>`;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Heatmap réseau <span class="muted" style="font-weight:400;font-size:12px;">— clique une cellule pour l'explication</span></div>
    <div class="card" style="overflow-x:auto;"><table class="net-table heat-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="heat-legend"><span class="heat-swatch heat-good"></span>Bon <span class="heat-swatch heat-warn"></span>Vigilance <span class="heat-swatch heat-bad"></span>Risque <span class="heat-swatch heat-na"></span>Donnée absente · ▲▼ tendance vs mois précédent</div>
    <div class="section-title">Signaux faibles & dérives <span class="muted" style="font-weight:400;font-size:12px;">— tendances, au-delà des seuils fixes</span></div>
    <div class="list">${driftHtml}</div>`;
  $$(".heat-cell").forEach((td) => td.addEventListener("click", () => { const r = rows.find((x) => x.campusId === td.dataset.c); openHeatCell(r, td.dataset.k); }));
  $$(".hm-campus, .drift-go").forEach((b) => b.addEventListener("click", () => openCampus360(b.dataset.id)));
}
function openHeatCell(r, k) {
  if (!r) return;
  const label = (HEAT_DIMS.find(([kk]) => kk === k) || [k, k])[1];
  const c = r.cells[k] || {};
  const statusLbl = { good: "Bon", warn: "Vigilance", bad: "Risque", na: "Donnée absente" }[c.status] || c.status;
  const trendLbl = c.trend === "up" ? "en amélioration" : c.trend === "down" ? "en dégradation" : c.trend === "flat" ? "stable" : "—";
  const recos = {
    finance: ["Revue des charges et de la masse salariale", "Plan de remplissage / mix alternance", "Renégociation fournisseurs"],
    remplissage: ["JPO, salons, relance candidats", "Ouvrir une filière à forte demande", "Activer l'alternance"],
    admissions: ["Relancer les candidats en attente", "Renforcer la conversion entretien→inscrit", "Actions Parcoursup / partenaires"],
    qualiopi: ["Compléter les preuves manquantes", "Planifier l'audit de surveillance", "Plan de remédiation par indicateur"],
    actions: ["Débloquer / réassigner les actions en retard", "Fixer des échéances et responsables"],
    incidents: ["Traiter les réclamations ouvertes", "Analyser la récurrence (cause racine)"],
    satisfaction: ["Enquête flash + plan d'amélioration", "Point pédagogique avec l'équipe"],
    insertion: ["Renforcer le lien entreprises", "Suivi placement des diplômés"],
    visites: ["Planifier une visite de campus", "Point avec le directeur"],
    direction: ["Revue managériale", "Plan d'accompagnement du directeur"],
  }[k] || [];
  openModal(`${esc(r.campus)} — ${esc(label)}`, `
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k"><div class="v">${esc(c.value ?? "—")}</div><div class="l">Valeur actuelle</div></div>
      <div class="k"><div class="v" style="color:var(--${c.status === "good" ? "good" : c.status === "warn" ? "warn" : "danger"});">${statusLbl}</div><div class="l">Statut</div></div>
      <div class="k"><div class="v">${trendLbl}</div><div class="l">Tendance</div></div>
    </div>
    ${recos.length ? `<div class="section-title" style="margin-top:0;">Leviers recommandés</div><ul>${recos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="hc-open">Ouvrir la fiche campus</button></div>`);
  $("#hc-open").onclick = () => { closeModals(); openCampus360(r.campusId); };
}

// ---------- Vue : Priorités du jour (actions priorisées) ----------
let prioTab = "actions";   // onglet courant de la file unique (actions scorées / alertes)
async function renderPriorites() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  view.innerHTML = `
    <div class="chips" style="margin-bottom:14px;" id="prio-tabs">
      <button type="button" class="chip ${prioTab === "actions" ? "active" : ""}" data-t="actions">🎯 À traiter</button>
      <button type="button" class="chip ${prioTab === "alertes" ? "active" : ""}" data-t="alertes">🔔 Alertes${notifCount ? ` (${notifCount})` : ""}</button>
    </div>
    <div id="prio-body"><p class="muted">Chargement…</p></div>`;
  $$("#prio-tabs .chip").forEach((c) => c.addEventListener("click", () => { prioTab = c.dataset.t; renderPriorites(); }));
  if (prioTab === "alertes") return renderAlertesInto($("#prio-body"));
  return renderActionsPrioriseesInto($("#prio-body"));
}

async function renderActionsPrioriseesInto(view) {
  const acts = await api.get("/api/actions/prioritized") || [];
  const today = new Date().toISOString().slice(0, 10);
  const tone = (s) => (s >= 65 ? "bad" : s >= 40 ? "warn" : "good");
  const row = (a) => {
    const overdue = a.dueDate && a.dueDate < today;
    return `<div class="item prio-item">
      <div class="prio-score prio-${tone(a.score)}">${a.score}</div>
      <div class="grow"><div class="ttl">${esc(a.title)}</div>
        <div class="sub">${a.campusName ? esc(a.campusName) + " · " : ""}${a.owner ? "👤 " + esc(a.owner) : '<span class="pill warn">sans responsable</span>'}${a.dueDate ? ` · <span class="${overdue ? "pill overdue" : ""}">${overdue ? "⏰ " : "📅 "}${esc(a.dueDate)}</span>` : ""}</div>
        ${a.reasons?.length ? `<div class="prio-why">${a.reasons.map((r) => `<span class="prio-tag">${esc(r)}</span>`).join("")}</div>` : ""}
      </div>
      <button class="btn-ghost btn-sm prio-ed" data-id="${a.id}">Traiter</button></div>`;
  };
  const noOwner = acts.filter((a) => !a.owner);
  const overdue = acts.filter((a) => a.dueDate && a.dueDate < today);
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k"><div class="v">${acts.length}</div><div class="l">actions ouvertes</div></div>
      <div class="k k-bad"><div class="v">${overdue.length}</div><div class="l">en retard</div></div>
      <div class="k k-bad"><div class="v">${noOwner.length}</div><div class="l">sans responsable</div></div>
    </div>
    <div class="section-title" style="margin-top:0;">Top priorités <span class="muted" style="font-weight:400;font-size:12px;">— score = urgence × impact × criticité campus</span></div>
    <div class="list">${acts.length ? acts.slice(0, 12).map(row).join("") : `<p class="empty" style="padding:14px;">Aucune action ouverte. 👌</p>`}</div>
    ${noOwner.length ? `<div class="section-title">Critiques sans responsable</div><div class="list">${noOwner.slice(0, 8).map(row).join("")}</div>` : ""}`;
  $$(".prio-ed").forEach((b) => b.addEventListener("click", () => openActionForm(acts.find((a) => a.id === b.dataset.id))));
}

// ---------- Vue : Plans de redressement (30/60/90 j) ----------
const REC_HORIZONS = [["h30", "J+30 jours"], ["h60", "J+60 jours"], ["h90", "J+90 jours"]];
function recItemRow(it) {
  it = it || {};
  return `<div class="rec-item"><input type="checkbox" class="ri-done" ${it.done ? "checked" : ""}><input class="txt ri-f" data-f="text" value="${esc(it.text || "")}" placeholder="Action / objectif" style="flex:1;min-width:120px;"><input class="txt ri-f" data-f="owner" value="${esc(it.owner || "")}" placeholder="Resp." style="width:88px;"><button type="button" class="btn-ghost btn-sm ri-del">✕</button></div>`;
}
async function renderRedressements() {
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="gen-rec">🚀 <span>Générer (IA)</span></button> <button class="btn-primary btn-sm" id="add-rec">${I.plus}<span>Plan</span></button>`;
  $("#add-rec").addEventListener("click", openRecoveryForm);
  $("#gen-rec").addEventListener("click", openRecoveryAIForm);
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const recs = await api.get("/api/recoveries") || [];
  const card = (r) => {
    const items = REC_HORIZONS.flatMap(([h]) => r[h] || []);
    const done = items.filter((x) => x.done).length;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;
    return `<div class="card card-pad rec-card" data-id="${r.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <h3 style="margin:0;">${esc(r.campusName || "Campus")} <span class="pill ${r.status === "active" ? "doing" : "done"}">${r.status === "active" ? "En cours" : "Clôturé"}</span></h3>
        <div style="display:flex;gap:6px;align-items:center;"><span class="muted" style="font-size:12px;">${done}/${items.length} · ${pct}%</span>
          <button class="btn-ghost btn-sm rec-status" data-id="${r.id}" data-s="${r.status === "active" ? "closed" : "active"}">${r.status === "active" ? "Clôturer" : "Rouvrir"}</button>
          <button class="btn-ghost btn-sm btn-danger rec-del" data-id="${r.id}">Suppr.</button></div>
      </div>
      <div class="field" style="margin-top:10px;"><label class="field-label">Diagnostic</label><textarea class="rec-diag" rows="2" placeholder="Pourquoi ce campus est en difficulté (cause racine)">${esc(r.diagnostic || "")}</textarea></div>
      <div class="rec-grid">${REC_HORIZONS.map(([h, l]) => `<div class="rec-col" data-h="${h}"><div class="rec-col-h">${l}</div><div class="rec-items">${(r[h] || []).map(recItemRow).join("")}</div><button type="button" class="btn-ghost btn-sm rec-add" data-h="${h}">+ tâche</button></div>`).join("")}</div>
      <div class="field" style="margin-top:10px;"><label class="field-label">Indicateurs de sortie <span class="muted">(quand considère-t-on le campus redressé ?)</span></label><textarea class="rec-exit" rows="2">${esc(r.exitCriteria || "")}</textarea></div>
      <button class="btn-primary btn-sm rec-save" data-id="${r.id}">Enregistrer</button> <span class="status rec-msg"></span>
    </div>`;
  };
  view.innerHTML = recs.length ? recs.map(card).join("") : `<p class="empty">Aucun plan de redressement. Crée-en un pour un campus en difficulté (diagnostic → objectifs 30/60/90 → indicateurs de sortie).</p>`;
  const bindItems = () => { $$(".ri-del").forEach((b) => (b.onclick = () => b.closest(".rec-item").remove())); };
  bindItems();
  $$(".rec-add").forEach((b) => b.addEventListener("click", () => { b.closest(".rec-col").querySelector(".rec-items").insertAdjacentHTML("beforeend", recItemRow({})); bindItems(); }));
  $$(".rec-del").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ce plan ?")) { await api.del(`/api/recoveries/${b.dataset.id}`); renderRedressements(); } }));
  $$(".rec-status").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/recoveries/${b.dataset.id}`, { status: b.dataset.s }); renderRedressements(); }));
  $$(".rec-save").forEach((b) => b.addEventListener("click", async () => {
    const c = b.closest(".rec-card"); const patch = { diagnostic: c.querySelector(".rec-diag").value, exitCriteria: c.querySelector(".rec-exit").value };
    REC_HORIZONS.forEach(([h]) => { patch[h] = [...c.querySelectorAll(`.rec-col[data-h="${h}"] .rec-item`)].map((it) => ({ text: it.querySelector('[data-f="text"]').value, owner: it.querySelector('[data-f="owner"]').value, done: it.querySelector(".ri-done").checked })).filter((x) => x.text.trim()); });
    await api.patch(`/api/recoveries/${b.dataset.id}`, patch);
    const m = c.querySelector(".rec-msg"); m.textContent = "✓ Enregistré"; m.classList.add("saved");
  }));
}
// Génération IA d'un plan de redressement pré-rempli depuis les signaux réels du campus.
function openRecoveryAIForm() {
  openModal("Générer un plan de redressement (IA)", `
    <p class="muted" style="margin-top:0;font-size:13px;">L'IA pré-remplit le diagnostic et un plan 30/60/90 à partir des <strong>signaux réels</strong> du campus (dimensions dégradées, dérives de tendance, actions en retard). Tu relis et ajustes ensuite — rien n'est figé.</p>
    <div class="field"><label class="field-label">Campus concerné</label><select id="gr-campus">${campusOptions("")}</select></div>
    <div class="actions"><button class="btn-primary" id="gr-go">Générer le plan</button> <span id="gr-msg" class="status"></span></div>`);
  $("#gr-go").onclick = async () => {
    const cid = $("#gr-campus").value;
    if (!cid) { alert("Choisis un campus."); return; }
    const btn = $("#gr-go"); btn.disabled = true; $("#gr-msg").textContent = "Génération… (~15 s)";
    try {
      const draft = await api.post(`/api/campuses/${cid}/recovery-draft`, {});
      if (!draft || draft.error) { $("#gr-msg").textContent = draft?.error || "Échec de la génération"; btn.disabled = false; return; }
      const r = await api.post("/api/recoveries", { campusId: cid, diagnostic: draft.diagnostic, h30: draft.h30, h60: draft.h60, h90: draft.h90, exitCriteria: draft.exitCriteria });
      if (!r || r.error) { $("#gr-msg").textContent = r?.error || "Échec de la création"; btn.disabled = false; return; }
      closeModals(); renderRedressements();
    } catch (e) { $("#gr-msg").textContent = "Erreur réseau"; btn.disabled = false; }
  };
}
function openRecoveryForm() {
  openModal("Nouveau plan de redressement", `
    <div class="field"><label class="field-label">Campus concerné</label><select class="rf" data-f="campusId">${campusOptions("")}</select></div>
    <div class="field"><label class="field-label">Diagnostic initial</label><textarea class="rf" data-f="diagnostic" rows="3" placeholder="Cause racine de la difficulté (marge, remplissage, direction…)"></textarea></div>
    <div class="actions"><button class="btn-primary" id="rf-save">Créer le plan</button></div>`);
  $("#rf-save").onclick = async () => {
    const patch = {}; $$(".rf").forEach((i) => (patch[i.dataset.f] = i.value));
    if (!patch.campusId) { alert("Choisis un campus."); return; }
    await api.post("/api/recoveries", patch);
    closeModals(); renderRedressements();
  };
}

// ---------- Vue : Prévision consolidée réseau ----------
async function renderPrevision() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const d = await api.get("/api/forecast/consolidated");
  const eur = (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " €");
  const e = d.effectifs || {}, f = d.finance || {};
  const ecartEff = e.objectif ? e.central - e.objectif : null;
  const kpi = (v, l, tone) => `<div class="k${tone ? " k-" + tone : ""}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const campRow = (c) => `<tr class="${c.atRisk ? "row-risk" : ""}">
    <td><b>${esc(c.campus)}</b></td>
    <td class="c">${c.health ?? "—"}</td>
    <td class="c">${c.adObj ?? "—"}</td>
    <td class="c">${c.adCentral != null ? `${c.adCentral} <span class="muted">(${c.adPrudent}–${c.adOpt})</span>` : "—"}</td>
    <td class="c num">${eur(c.objRevenue)}</td>
    <td class="c num">${eur(c.revenue)}</td>
    <td class="c num ${c.margin != null && c.margin < 0 ? "neg" : ""}">${eur(c.margin)}</td>
    <td class="c">${c.atRisk ? '<span class="pill overdue">à risque</span>' : "✓"}</td></tr>`;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Trajectoire effectifs (fin d'année)</div>
    <div class="kpis">
      ${kpi(e.objectif || "—", "Objectif inscrits")}
      ${kpi(e.prudent || "—", "Scénario prudent", "bad")}
      ${kpi(e.central || "—", "Scénario central", ecartEff >= 0 ? "good" : "bad")}
      ${kpi(e.optimiste || "—", "Scénario optimiste", "good")}
    </div>
    ${e.objectif ? `<p class="hint ${ecartEff >= 0 ? "" : "muted"}" style="margin-top:8px;color:${ecartEff >= 0 ? "var(--good)" : "var(--danger)"};">${ecartEff >= 0 ? "▲ +" + ecartEff + " inscrits vs objectif réseau (scénario central)" : "▼ " + ecartEff + " inscrits sous l'objectif réseau — manque " + Math.abs(ecartEff) + " inscriptions"}</p>` : ""}
    <div class="section-title">Finance vs objectifs</div>
    <div class="kpis">
      ${kpi(eur(f.objectifCA), "Objectif CA (annuel)")}
      ${kpi(eur(f.caReal), "CA constaté (dernier mois)")}
      ${kpi(eur(f.margeReal), "Marge constatée", f.margeReal != null && f.margeReal < 0 ? "bad" : "good")}
    </div>
    <div class="section-title">Campus & trajectoire ${d.atRisk?.length ? `<span class="pill overdue">${d.atRisk.length} à risque</span>` : ""}</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Campus</th><th class="c">Santé</th><th class="c">Obj. inscrits</th><th class="c">Projection (fourchette)</th><th class="c">Obj. CA</th><th class="c">CA</th><th class="c">Marge</th><th class="c">Statut</th></tr></thead>
      <tbody>${(d.campuses || []).map(campRow).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Projection effectifs = entonnoir admissions (candidatures→inscrits) par campus, agrégée ; fourchette prudente/optimiste ±15 %. Finance = objectifs annuels (fiche campus) vs dernier mois constaté. Estimation d'aide à la décision, pas un budget.</p>`;
}

// ---------- Vue : Arbitrages CODIR ----------
const ARB_STATUS = [["toprepare", "À préparer"], ["pending", "En attente CODIR"], ["decided", "Tranché"], ["executed", "Exécuté"]];
const arbStatusLabel = (s) => (ARB_STATUS.find(([k]) => k === s) || [s, s])[1];
async function renderArbitrages() {
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="arb-codir">📋 ODJ CODIR (IA)</button><button class="btn-ghost btn-sm" id="arb-weekly">Revue hebdo PDF</button><button class="btn-primary btn-sm" id="add-arb">${I.plus}<span>Arbitrage</span></button>`;
  $("#add-arb").addEventListener("click", () => openArbitrageForm(null));
  $("#arb-weekly").addEventListener("click", () => window.open("/api/weekly-review", "_blank"));
  // Ordre du jour CODIR généré depuis les données réelles (dérives + arbitrages + retards) → livrable.
  $("#arb-codir").addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Génération… (~30 s)";
    try {
      const r = await api.post("/api/codir/agenda-draft", {});
      if (r?.id) openDeliverable(r.id);
      else alert(r?.error || "Échec de la génération");
    } catch { alert("Erreur réseau"); }
    btn.disabled = false; btn.textContent = "📋 ODJ CODIR (IA)";
  });
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const arbs = await api.get("/api/arbitrages") || [];
  const badge = (s) => `<span class="pill ${s === "decided" ? "done" : s === "executed" ? "" : s === "pending" ? "warn" : "doing"}">${arbStatusLabel(s)}</span>`;
  const card = (a) => `<div class="card card-pad arb-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div><h3 style="margin:0;">${badge(a.status)} ${esc(a.title)}</h3><div class="sub muted">${a.campusName ? esc(a.campusName) + " · " : ""}${a.owner ? "Resp. " + esc(a.owner) : ""}${a.dueDate ? " · échéance " + esc(a.dueDate) : ""}</div></div>
      <button class="btn-ghost btn-sm arb-ed" data-id="${a.id}">Éditer</button>
    </div>
    ${a.recommendation ? `<div class="arb-reco"><b>Reco DO :</b> ${esc(a.recommendation)}</div>` : ""}
    <div class="arb-meta">${[a.impactFin && `💶 ${esc(a.impactFin)}`, a.impactOp && `⚙️ ${esc(a.impactOp)}`, a.riskNoDecision && `⚠️ si non-décision : ${esc(a.riskNoDecision)}`].filter(Boolean).join(" · ")}</div>
    ${a.decision ? `<div class="arb-decision"><b>Décision :</b> ${esc(a.decision)}</div>` : ""}
    <div class="arb-actions">${ARB_STATUS.filter(([k]) => k !== a.status).map(([k, l]) => `<button class="btn-ghost btn-sm arb-mv" data-id="${a.id}" data-s="${k}">→ ${l}</button>`).join("")}<button class="btn-ghost btn-sm btn-danger arb-del" data-id="${a.id}">Suppr.</button></div>
  </div>`;
  const groups = ARB_STATUS.map(([k, l]) => { const g = arbs.filter((a) => a.status === k); return g.length ? `<div class="section-title" style="${k === "toprepare" ? "margin-top:0;" : ""}">${l} <span class="muted" style="font-weight:400;font-size:12px;">${g.length}</span></div>${g.map(card).join("")}` : ""; }).join("");
  view.innerHTML = groups || `<p class="empty">Aucun arbitrage. Transforme un sujet opérationnel en fiche de décision : contexte, options, reco DO, impacts, risque si non-décision.</p>`;
  $$(".arb-ed").forEach((b) => b.addEventListener("click", () => openArbitrageForm(arbs.find((a) => a.id === b.dataset.id))));
  $$(".arb-mv").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/arbitrages/${b.dataset.id}`, { status: b.dataset.s }); renderArbitrages(); }));
  $$(".arb-del").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer cet arbitrage ?")) { await api.del(`/api/arbitrages/${b.dataset.id}`); renderArbitrages(); } }));
}
function openArbitrageForm(a) {
  a = a || {}; const isEdit = !!a.id;
  const ta = (f, l, ph) => `<div class="field"><label class="field-label">${l}</label><textarea class="af" data-f="${f}" rows="2" placeholder="${ph || ""}">${esc(a[f] || "")}</textarea></div>`;
  openModal(isEdit ? "Modifier l'arbitrage" : "Nouvel arbitrage CODIR", `
    <div class="field"><label class="field-label">Sujet</label><input class="txt af" data-f="title" value="${esc(a.title || "")}" placeholder="Ex. Fermer la filière X à Lille"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Campus</label><select class="af" data-f="campusId">${campusOptions(a.campusId || "")}</select></div>
      <div><label class="field-label">Statut</label><select class="af" data-f="status">${ARB_STATUS.map(([k, l]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    ${ta("context", "Contexte", "Situation, historique")}
    ${ta("problem", "Problème", "Ce qui doit être tranché")}
    ${ta("options", "Options", "A) … B) … C) …")}
    ${ta("recommendation", "Recommandation du DO", "Ce que tu préconises et pourquoi")}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Impact financier</label><input class="txt af" data-f="impactFin" value="${esc(a.impactFin || "")}"></div>
      <div><label class="field-label">Impact opérationnel</label><input class="txt af" data-f="impactOp" value="${esc(a.impactOp || "")}"></div>
    </div>
    ${ta("riskNoDecision", "Risque si non-décision", "Ce qu'on risque à ne pas trancher")}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Responsable exécution</label><input class="txt af" data-f="owner" value="${esc(a.owner || "")}"></div>
      <div><label class="field-label">Échéance</label><input class="txt af" data-f="dueDate" type="date" value="${esc(a.dueDate || "")}"></div>
    </div>
    ${ta("decision", "Décision prise", "Renseigner une fois tranché")}
    <div class="actions" style="margin-top:14px;"><button class="btn-primary" id="af-save">${isEdit ? "Enregistrer" : "Créer l'arbitrage"}</button></div>`);
  $("#af-save").onclick = async () => {
    const patch = {}; $$(".af").forEach((i) => (patch[i.dataset.f] = i.value.trim ? i.value.trim() : i.value));
    if (!patch.title) return;
    if (isEdit) await api.patch(`/api/arbitrages/${a.id}`, patch); else await api.post("/api/arbitrages", patch);
    closeModals(); renderArbitrages();
  };
}

// ---------- Vue : Campus ----------
async function renderCampus() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-campus">${I.plus}<span>Campus</span></button>`;
  $("#add-campus").addEventListener("click", async () => {
    const name = prompt("Nom du campus :"); if (!name) return;
    await api.post("/api/campuses", { name });
    state.campuses = await api.get("/api/campuses");
    renderCampus();
  });
  const view = $("#view");
  if (!state.campuses.length) {
    view.innerHTML = `<p class="empty">Aucun campus. Ajoute-en un pour renseigner son adresse, ses interlocuteurs, et organiser tes livrables.</p>`;
    return;
  }
  view.innerHTML = `<div class="grid grid-2">${state.campuses.map((c) => {
    const contacts = c.contacts || [];
    return `<div class="card card-pad" data-cid="${c.id}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h3>${esc(c.name)}</h3>
        <button class="btn-ghost btn-sm btn-danger dl-campus" data-id="${c.id}">Supprimer</button>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        <div style="grid-column:1/3;"><label class="field-label">Nom du campus</label><input class="txt cf" data-f="name" value="${esc(c.name)}"></div>
        <div><label class="field-label">Ville</label><input class="txt cf" data-f="city" value="${esc(c.city || "")}"></div>
        <div><label class="field-label">Région</label><input class="txt cf" data-f="region" value="${esc(c.region || "")}"></div>
        <div style="grid-column:1/3;"><label class="field-label">Réseau / groupe</label><input class="txt cf" data-f="network" value="${esc(c.network || "")}" placeholder="Ex. réseau d'écoles, groupe…"></div>
        <div style="grid-column:1/3;"><label class="field-label">Adresse</label><input class="txt cf" data-f="address" value="${esc(c.address || "")}" placeholder="N°, rue, code postal, ville"></div>
        <div><label class="field-label">Nombre d'étudiants</label><input class="txt cf" data-f="students" type="number" value="${c.students ?? ""}"></div>
        <div><label class="field-label">Capacité (places)</label><input class="txt cf" data-f="capacity" type="number" value="${c.capacity ?? ""}"></div>
        <div><label class="field-label">Email</label><input class="txt cf" data-f="email" value="${esc(c.email || "")}" placeholder="contact@campus.fr"></div>
        <div><label class="field-label">Téléphone</label><input class="txt cf" data-f="phone" value="${esc(c.phone || "")}" placeholder="01 23 45 67 89"></div>
      </div>
      <!-- Identité réglementaire : ces champs étaient CONTRÔLÉS par l'écran
           « Prêt à exploiter ? » sans être saisissables nulle part. Les points
           bloquants qu'ils déclenchent ne pouvaient donc jamais être levés. -->
      <div class="section-title" style="margin:16px 0 8px;">Identité réglementaire</div>
      <p class="hint muted" style="margin-top:0;">Sans ces informations, ni le bilan pédagogique et financier ni le certificat de réalisation ne sont délivrables, et le Cerfa d'apprentissage reste incomplet.</p>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="field-label">SIRET</label><input class="txt cf" data-f="siret" value="${esc(c.siret || "")}" placeholder="14 chiffres"></div>
        <div><label class="field-label">N° de déclaration d'activité</label><input class="txt cf" data-f="numeroDeclaration" value="${esc(c.numeroDeclaration || "")}" placeholder="11 93 00000 93"></div>
        <div><label class="field-label">Code UAI</label><input class="txt cf" data-f="uai" value="${esc(c.uai || "")}" placeholder="identifie l'établissement sur SOLTéA"></div>
        <div><label class="field-label">Représentant légal</label><input class="txt cf" data-f="dirigeant" value="${esc(c.dirigeant || "")}"></div>
        <div><label class="field-label">Référent handicap</label><input class="txt cf" data-f="referentHandicap" value="${esc(c.referentHandicap || "")}"></div>
        <div><label class="field-label">Référent mobilité</label><input class="txt cf" data-f="referentMobilite" value="${esc(c.referentMobilite || "")}"></div>
      </div>
      <div style="margin-top:10px;"><button class="btn-ghost btn-sm save-campus" data-id="${c.id}">Enregistrer la fiche</button> <span class="status save-msg" data-id="${c.id}"></span></div>

      <div class="section-title" style="margin:16px 0 8px;">Objectifs & budget (cibles)</div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;">
        <div><label class="field-label">Effectif cible</label><input class="txt obf" data-f="students" type="number" value="${c.objectives?.students ?? ""}"></div>
        <div><label class="field-label">CA cible €</label><input class="txt obf" data-f="revenue" type="number" value="${c.objectives?.revenue ?? ""}"></div>
        <div><label class="field-label">Marge cible €</label><input class="txt obf" data-f="margin" type="number" value="${c.objectives?.margin ?? ""}"></div>
      </div>
      <div style="margin-top:8px;"><button class="btn-ghost btn-sm save-obj" data-id="${c.id}">Enregistrer les objectifs</button> <span class="status obj-msg" data-id="${c.id}"></span></div>

      <div class="section-title" style="margin:16px 0 8px;">Filières & modalités <span class="muted">(type · initial/alternance · effectif)</span></div>
      <div class="fil-table" data-cid="${c.id}">${(c.filieres || []).map(filiereRow).join("")}</div>
      <div class="fil-mix" data-cid="${c.id}">${filiereMix(c.filieres)}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn-ghost btn-sm add-fil" data-id="${c.id}">+ Filière</button>
        <button class="btn-ghost btn-sm save-fil" data-id="${c.id}">Enregistrer les filières</button>
        <span class="status fil-msg" data-id="${c.id}"></span>
      </div>

      <div class="section-title" style="margin:18px 0 8px;">Personnes du campus</div>
      <div class="list">${renderContactGroups(c)}</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <select class="ct-cat" data-c="${c.id}">${CONTACT_CATS.map((x) => `<option value="${x.k}">${x.l}</option>`).join("")}</select>
        <input class="txt ct-role" data-c="${c.id}" placeholder="Fonction (ex. Directeur campus)">
        <input class="txt ct-first" data-c="${c.id}" placeholder="Prénom">
        <input class="txt ct-last" data-c="${c.id}" placeholder="Nom">
        <input class="txt ct-email" data-c="${c.id}" placeholder="Email">
        <input class="txt ct-phone" data-c="${c.id}" placeholder="Téléphone">
        <button class="btn-ghost btn-sm add-contact" data-c="${c.id}" style="grid-column:1/3;">Ajouter la personne</button>
      </div>
    </div>`;
  }).join("")}</div>`;

  $$(".save-campus").forEach((b) => b.addEventListener("click", async () => {
    const cid = b.dataset.id;
    const card = b.closest("[data-cid]");
    const patch = {};
    $$(".cf", card).forEach((i) => (patch[i.dataset.f] = i.value.trim()));
    await api.patch(`/api/campuses/${cid}`, patch);
    state.campuses = await api.get("/api/campuses");
    const msg = $(`.save-msg[data-id="${cid}"]`); if (msg) { msg.textContent = "✓ Enregistré"; msg.classList.add("saved"); }
  }));
  $$(".save-obj").forEach((b) => b.addEventListener("click", async () => {
    const cid = b.dataset.id; const card = b.closest("[data-cid]"); const patch = {};
    $$(".obf", card).forEach((i) => (patch[i.dataset.f] = i.value));
    await api.patch(`/api/campuses/${cid}/objectives`, patch);
    state.campuses = await api.get("/api/campuses");
    const m = $(`.obj-msg[data-id="${cid}"]`); if (m) { m.textContent = "✓ Enregistré"; m.classList.add("saved"); }
  }));
  const bindDelFil = () => $$(".del-fil").forEach((b) => (b.onclick = () => b.closest(".fil-row").remove()));
  bindDelFil();
  $$(".add-fil").forEach((b) => b.addEventListener("click", () => { $(`.fil-table[data-cid="${b.dataset.id}"]`).insertAdjacentHTML("beforeend", filiereRow({})); bindDelFil(); }));
  $$(".save-fil").forEach((b) => b.addEventListener("click", async () => {
    const cid = b.dataset.id;
    const filieres = [...$(`.fil-table[data-cid="${cid}"]`).querySelectorAll(".fil-row")].map((row) => { const o = {}; row.querySelectorAll(".flf").forEach((i) => (o[i.dataset.f] = i.value)); return o; }).filter((o) => o.nom);
    await api.patch(`/api/campuses/${cid}/filieres`, { filieres });
    state.campuses = await api.get("/api/campuses");
    const m = $(`.fil-msg[data-id="${cid}"]`); if (m) { m.textContent = "✓ Enregistré"; m.classList.add("saved"); }
  }));
  $$(".dl-campus").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ce campus et ses interlocuteurs ?")) { await api.del(`/api/campuses/${b.dataset.id}`); state.campuses = await api.get("/api/campuses"); renderCampus(); } }));
  $$(".dl-contact").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/campuses/${b.dataset.c}/contacts/${b.dataset.k}`); state.campuses = await api.get("/api/campuses"); renderCampus(); }));
  $$(".add-contact").forEach((b) => b.addEventListener("click", async () => {
    const cid = b.dataset.c;
    const g = (cls) => $(`.${cls}[data-c="${cid}"]`).value.trim();
    const category = $(`.ct-cat[data-c="${cid}"]`).value;
    const role = g("ct-role"), firstName = g("ct-first"), lastName = g("ct-last"), email = g("ct-email"), phone = g("ct-phone");
    if (!role && !firstName && !lastName && !email) return;
    await api.post(`/api/campuses/${cid}/contacts`, { category, role, firstName, lastName, email, phone });
    state.campuses = await api.get("/api/campuses");
    renderCampus();
  }));
}

// ---------- Vue : Réseau ----------
async function renderReseau() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  view.innerHTML = `<div id="net"><p class="muted">Chargement…</p></div>`;
  const rows = await api.get("/api/network");
  if (!rows || !rows.length) { $("#net").innerHTML = `<p class="empty">Ajoute des campus (onglet Campus) pour voir la vue réseau comparative.</p>`; return; }
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="net-xlsx">Excel</button><button class="btn-ghost btn-sm" id="net-report">Rapport PDF</button><button class="btn-primary btn-sm" id="gen-synthese">Synthèse CODIR</button>`;
  $("#net-xlsx").addEventListener("click", () => { location.href = "/api/export/network"; });
  $("#net-report").addEventListener("click", () => window.open("/api/report", "_blank"));
  $("#gen-synthese").addEventListener("click", () => generateSynthese(false));
  const pct = (v) => (v == null ? '<span class="muted">—</span>' : v + " %");
  rows.sort((a, b) => (a.health ?? 101) - (b.health ?? 101)); // les plus à risque en tête
  view.innerHTML = `<div class="card" style="overflow-x:auto;"><table class="net-table">
    <thead><tr><th>Campus</th><th>Santé</th><th>Directeur</th><th>Effectif</th><th>Remplissage</th><th>Qualiopi</th><th>Actions</th><th>Dernière visite</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><div class="ttl c360" data-id="${r.id}">${esc(r.name)}</div><div class="sub muted">${esc(r.city || "")}</div></td>
      <td>${healthBadge(r.health, r.healthDetail)}</td>
      <td>${esc(r.director || "—")}</td>
      <td>${r.students ?? "—"}${r.capacity ? ` <span class="muted">/ ${r.capacity}</span>` : ""}</td>
      <td class="${r.occupancy != null && r.occupancy < 70 ? "cell-warn" : ""}">${pct(r.occupancy)}</td>
      <td class="${r.qualiopi != null && r.qualiopi < 80 ? "cell-warn" : ""}">${r.qualiopi == null ? '<span class="muted">non renseigné</span>' : pct(r.qualiopi)}</td>
      <td>${r.openActions} ouv.${r.overdue ? ` <span class="pill overdue">${r.overdue} retard</span>` : ""}${r.openIncidents ? ` <span class="pill overdue">${r.openIncidents} inc.</span>` : ""}</td>
      <td>${r.lastVisit ? `${r.lastVisit} <span class="muted">(${r.monthsSinceVisit} m)</span>` : '<span class="muted">jamais</span>'} ${r.visitDue ? '<span class="pill overdue">à visiter</span>' : ""}</td>
      <td><button class="btn-ghost btn-sm log-visit" data-id="${r.id}" data-name="${esc(r.name)}">+ Visite</button></td>
    </tr>`).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Tri par <strong>score de santé</strong> croissant (campus à risque en tête). Santé = moyenne pondérée remplissage · Qualiopi · actions/incidents · visites · satisfaction. Remplissage &lt; 70 % et Qualiopi &lt; 80 % signalés.</p>`;
  $$(".log-visit").forEach((b) => b.addEventListener("click", async () => {
    const date = prompt(`Date de la visite de ${b.dataset.name} (AAAA-MM-JJ) :`, new Date().toISOString().slice(0, 10)); if (!date) return;
    const type = prompt("Type (1ère visite, suivi, audit…) :") || "";
    await api.post("/api/visits", { campusId: b.dataset.id, date, type });
    renderReseau();
  }));
  $$(".c360").forEach((b) => b.addEventListener("click", () => openCampus360(b.dataset.id)));
}

// --- Synthèse CODIR (streaming + garde anti-régénération) ---
async function generateSynthese(force) {
  openModal("Synthèse réseau — CODIR", `<div id="syn-out" class="output"><div class="streaming">${force ? "Régénération…" : "Vérification des données…"}</div></div><div id="syn-tools" style="margin-top:12px;"></div>`);
  const out = $("#syn-out"); const live = out.querySelector(".streaming");
  try {
    const resp = await fetch("/api/network/synthese", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ force: !!force }) });
    if (resp.status === 401) return logout(true);
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await resp.json();
      if (j.upToDate) {
        out.innerHTML = `<p class="muted">Aucune nouvelle donnée depuis la dernière synthèse du <strong>${new Date(j.createdAt).toLocaleString("fr-FR")}</strong>. Inutile de la régénérer (et de payer une génération).</p>`;
        $("#syn-tools").innerHTML = `<button class="btn-primary btn-sm" id="syn-view">Voir la dernière synthèse</button> <button class="btn-ghost btn-sm" id="syn-force">Régénérer quand même</button>`;
        $("#syn-view").onclick = () => { document.querySelector(".modal-bg")?.remove(); openDeliverable(j.id); };
        $("#syn-force").onclick = () => { document.querySelector(".modal-bg")?.remove(); generateSynthese(true); };
        return;
      }
      out.innerHTML = `<p class="error">${esc(j.error || "Erreur")}</p>`;
      return;
    }
    live.textContent = "Génération en cours…";
    let raw = "";
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; raw += dec.decode(value, { stream: true }); live.textContent = raw; out.scrollTop = out.scrollHeight; }
    const idm = raw.match(/<!--deliverable:([a-f0-9]+)-->/); const did = idm ? idm[1] : null;
    raw = raw.replace(/\n?<!--deliverable:[a-f0-9]+-->/, "");
    const { md } = extractKpis(raw);
    out.innerHTML = mdSafe(md);
    if (did) { $("#syn-tools").innerHTML = `<button class="btn-ghost btn-sm" data-sexport="docx">Word</button> <button class="btn-ghost btn-sm" data-sexport="print">Imprimer / PDF</button>`; $$("#syn-tools [data-sexport]").forEach((b) => b.addEventListener("click", () => { const f = b.dataset.sexport; if (f === "print") window.open(`/api/deliverables/${did}/export?format=print`, "_blank"); else location.href = `/api/deliverables/${did}/export?format=${f}`; })); }
  } catch (e) { out.innerHTML = `<p class="error">${esc(e.message || "Erreur")}</p>`; }
}

// --- Fiche 360° d'un campus ---
function healthExplain(r) {
  if (r.health == null) return `<div class="section-title">Score de santé</div><div class="card card-pad"><p class="muted" style="margin:0;">Score indisponible — renseigne remplissage, Qualiopi ou satisfaction.</p></div>`;
  const tone = (v) => (v >= 75 ? "good" : v >= 50 ? "warn" : "bad");
  const bars = (r.healthDetail || []).map((d) => `<div class="hx-row"><span class="hx-l">${esc(d.label)}</span><span class="hx-bar"><span class="hx-fill h-${tone(d.score)}" style="width:${d.score}%"></span></span><span class="hx-s">${d.score}<span class="muted"> · ${d.weight}%</span></span></div>`).join("");
  const worst = (r.healthDetail || []).filter((d) => d.score < 75).slice(0, 3);
  return `<div class="section-title">Score de santé ${r.healthInsufficient ? '<span class="pill warn">données insuffisantes</span>' : ""}</div>
    <div class="card card-pad">
      <div class="hx-head"><span class="health-badge h-${tone(r.health)}" style="font-size:17px;padding:3px 12px;">${r.health}</span><span class="muted">/100 — moyenne pondérée des facteurs</span></div>
      <div class="hx">${bars}</div>
      ${worst.length ? `<div class="hx-reco">⚑ <b>À travailler en priorité :</b> ${worst.map((d) => esc(d.label) + " (" + d.score + ")").join(", ")}</div>` : `<div class="hx-reco" style="color:var(--good);">Tous les facteurs sont au vert. 👌</div>`}
    </div>`;
}
const TL_META = { livrable: ["📄", "Livrable"], visite: ["🚗", "Visite"], incident: ["⚠️", "Incident"], reclamation: ["📣", "Réclamation"], action: ["✅", "Action"], "action-done": ["✔️", "Action close"], decision: ["⚖️", "Décision"], revue: ["🗓️", "Revue"], evenement: ["🎓", "Événement"], qualiopi: ["🛡️", "Qualiopi"] };
function timelineHtml(events) {
  if (!events || !events.length) return `<p class="muted" style="font-size:13px;">Aucun événement enregistré.</p>`;
  return `<div class="timeline">${events.map((e) => { const m = TL_META[e.type] || ["•", e.type]; return `<div class="tl-item"><span class="tl-ic">${m[0]}</span><div class="tl-body"><div class="tl-date">${esc(e.date)}</div><div class="tl-label">${esc(e.label)}</div></div></div>`; }).join("")}</div>`;
}
async function openCampus360(id) {
  const [d, timeline] = await Promise.all([api.get(`/api/campus360/${id}`), api.get(`/api/campuses/${id}/timeline`).catch(() => [])]);
  if (!d || d.error) return;
  const c = d.campus, r = d.row || {};
  const stat = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="k">${l}</div></div>`;
  const delivs = d.deliverables.length ? d.deliverables.map((x) => `<div class="item"><span class="pill ${x.task}">${esc(taskLabel(x.task))}</span><div class="grow"><div class="ttl">${esc(x.title)}</div><div class="sub">${frDate(x.createdAt)}</div></div><button class="btn-ghost btn-sm d360" data-id="${x.id}">Ouvrir</button></div>`).join("") : `<p class="muted" style="font-size:13px;">Aucun livrable.</p>`;
  const acts = d.actions.open.length ? d.actions.open.slice(0, 8).map((a) => { const od = a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10); return `<div class="item"><div class="grow"><div class="ttl">${esc(a.title)}</div><div class="sub">${a.dueDate ? `<span class="${od ? "pill overdue" : ""}">${od ? "⏰ " : "📅 "}${esc(a.dueDate)}</span>` : ""}${a.owner ? " · " + esc(a.owner) : ""}</div></div></div>`; }).join("") : `<p class="muted" style="font-size:13px;">Aucune action ouverte.</p>`;
  const body = `
    <div class="kpis">
      ${stat(r.students ?? "—", "Effectif")}
      ${stat(r.occupancy != null ? r.occupancy + " %" : "—", "Remplissage")}
      ${stat(d.qualiopi?.conformity != null ? d.qualiopi.conformity + " %" : "—", "Qualiopi")}
      ${stat(d.actions.overdue.length, "Actions en retard")}
      ${stat(r.lastVisit || "jamais", "Dernière visite")}
    </div>
    ${[c.address, c.email, c.phone].filter(Boolean).length ? `<p class="muted" style="font-size:13px;margin-top:0;">${[c.address, c.email, c.phone].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
    ${healthExplain(r)}
    <div class="section-title">Interlocuteurs</div><div class="list">${renderContactGroups(c)}</div>
    <div class="section-title">Derniers livrables</div><div class="list">${delivs}</div>
    <div class="section-title">Actions ouvertes</div><div class="list">${acts}</div>
    <div class="section-title">Mémoire du campus <span class="muted" style="font-weight:400;font-size:12px;">— historique</span></div>${timelineHtml(timeline)}`;
  openModal(`${esc(c.name)}${c.city ? " · " + esc(c.city) : ""}`, body);
  $$(".d360").forEach((b) => b.addEventListener("click", () => { document.querySelector(".modal-bg")?.remove(); openDeliverable(b.dataset.id); }));
}

// ---------- Vue : Qualiopi ----------
// --- Répertoire du projet ---
// Une seule liste alimente les membres de comité et les responsabilités des
// étapes : deux listes parallèles se désynchronisent au premier départ.
let repCampus = "";

async function renderRepertoire() {
  if (!repCampus) repCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/personnes?campusId=${repCampus}`);

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="rp-new">+ Personne</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="rp-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === repCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.personnes.length, "personnes")}</div>
    </div>
    <p class="hint muted" style="margin-bottom:12px;">Ces personnes alimentent à la fois les membres des comités et les responsabilités des étapes d'ouverture. Une adresse est obligatoire : c'est la seule raison d'être du répertoire — pouvoir convoquer.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Nom</th><th>Rôle</th><th>Courriel</th><th>Téléphone</th><th></th></tr></thead><tbody>
      ${d.personnes.length ? d.personnes.map((p) => `<tr>
        <td><b>${esc(p.nom)}</b></td><td>${esc(p.role || "—")}</td>
        <td>${esc(p.email)}</td><td>${esc(p.telephone || "—")}</td>
        <td><button class="btn-ghost btn-sm rp-edit" data-id="${p.id}">Modifier</button></td>
      </tr>`).join("") : '<tr><td colspan="5" class="muted">Répertoire vide. Tant qu\'il l\'est, aucune responsabilité d\'étape n\'est convocable.</td></tr>'}
      </tbody></table></div>
    <div class="section-title">Les quatre responsabilités</div>
    <div class="card card-pad"><div style="display:flex;flex-direction:column;gap:6px;">
      ${Object.entries(d.raci).map(([k, r]) => `<div class="row" style="gap:8px;padding:4px 0;border-top:1px solid var(--border);">
        <span class="pill">${esc(r.code)}</span><span class="grow">${esc(r.label)}</span>
        <span class="muted" style="font-size:12.5px;">${r.convoque ? "reçoit les convocations" : "informé, non convoqué"}</span></div>`).join("")}
    </div></div>`;

  $("#rp-campus").onchange = (e) => { repCampus = e.target.value; renderRepertoire(); };
  $("#rp-new").onclick = () => openPersonneForm();
  $$(".rp-edit").forEach((b) => { b.onclick = () => openPersonneForm(d.personnes.find((p) => p.id === b.dataset.id)); });
}

function openPersonneForm(p = null) {
  openModal(p ? `Modifier — ${p.nom}` : "Nouvelle personne", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nom et prénom</label><input class="txt pf" data-f="nom" value="${esc(p?.nom || "")}"></div>
      <div><label class="field-label">Rôle</label><input class="txt pf" data-f="role" value="${esc(p?.role || "")}" placeholder="Directeur des opérations"></div>
      <div><label class="field-label">Courriel</label><input class="txt pf" data-f="email" type="email" value="${esc(p?.email || "")}">
        <p class="hint muted" style="margin-top:4px;">Obligatoire : une personne sans adresse ne peut pas être convoquée.</p></div>
      <div><label class="field-label">Téléphone</label><input class="txt pf" data-f="telephone" value="${esc(p?.telephone || "")}"></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="pf-save">Enregistrer</button></div>`);

  $("#pf-save").onclick = async () => {
    const body = { campusId: repCampus };
    $$(".pf").forEach((i) => (body[i.dataset.f] = i.value));
    const r = p ? await api.patch(`/api/personnes/${p.id}`, body) : await api.post("/api/personnes", body);
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert(r.warnings.join("\n"));
    closeModals(); renderRepertoire();
  };
}

// --- Exports et tableaux croisés ---
// Le module le plus dangereux : un export libre contournerait tous les seuils
// que les autres écrans appliquent. L'écran le dit, et les seuils tiennent.
let xplCampus = "", xplOnglet = "croiser";

async function renderExploitation() {
  if (!xplCampus) xplCampus = state.campuses[0]?.id || "";
  const [ref, jr] = await Promise.all([
    api.get("/api/exploitation/sources"), api.get(`/api/exploitation/journal?campusId=${xplCampus}`),
  ]);

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;gap:8px;">
      <div><label class="field-label">Campus</label><select id="ex-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === xplCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <button class="btn-ghost btn-sm ex-tab ${xplOnglet === "croiser" ? "btn-primary" : ""}" data-t="croiser">Tableau croisé</button>
      <button class="btn-ghost btn-sm ex-tab ${xplOnglet === "exporter" ? "btn-primary" : ""}" data-t="exporter">Export</button>
      <button class="btn-ghost btn-sm ex-tab ${xplOnglet === "journal" ? "btn-primary" : ""}" data-t="journal">Journal (${jr.total})</button>
    </div>

    ${xplOnglet === "croiser" ? `
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
          <div><label class="field-label">Source</label><select class="txt" id="ex-src">${Object.entries(ref.sources).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>
          <div><label class="field-label">En ligne</label><select class="txt" id="ex-l"></select></div>
          <div><label class="field-label">En colonne</label><select class="txt" id="ex-c"></select></div>
          <div><label class="field-label">Mesure (moyenne)</label><select class="txt" id="ex-m"><option value="">— compter —</option></select></div>
        </div>
        <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="ex-go">Croiser</button></div>
      </div>
      <div id="ex-out"></div>
    ` : xplOnglet === "exporter" ? `
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
          <div><label class="field-label">Source</label><select class="txt" id="ex-esrc">${Object.entries(ref.sources).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>
          <div><label class="field-label">Finalité</label><select class="txt" id="ex-fin"><option value="">—</option>${Object.entries(ref.finalites).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
          <div style="grid-column:1/-1;"><label class="field-label">Champs</label><div id="ex-champs" class="row" style="flex-wrap:wrap;gap:10px;"></div></div>
          <div style="grid-column:1/-1;" id="ex-prec"></div>
        </div>
        <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="ex-exp">Exporter</button></div>
      </div>
      <div id="ex-eout"></div>
    ` : `
      <div class="kpis" style="margin-bottom:12px;">${fkpi(jr.total, "exports")}${fkpi(jr.nominatifs, "nominatifs", jr.nominatifs ? "bad" : "good")}${fkpi(jr.lignesExportees, "lignes sorties")}</div>
      ${jr.parFinalite.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px;">${jr.parFinalite.map((f) => `<span class="pill">${esc(f.label)} : ${f.n}</span>`).join("")}</div>` : ""}
      <div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th>Date</th><th>Source</th><th>Champs</th><th>Finalité</th><th>Lignes</th><th>Par</th></tr></thead><tbody>
        ${jr.journal.length ? jr.journal.map((e) => `<tr>
          <td>${esc(e.date || "—")}</td><td>${esc(ref.sources[e.source]?.label || e.source)}</td>
          <td>${esc((e.champs || []).join(", "))}${e.nominatif ? ' <span class="pill p-bad">nominatif</span>' : ""}</td>
          <td>${esc(e.finaliteLabel || "—")}${e.finalitePrecision ? `<br><span class="muted" style="font-size:12px;">${esc(e.finalitePrecision)}</span>` : ""}</td>
          <td>${e.lignes}</td><td>${esc(e.par || "—")}</td>
        </tr>`).join("") : '<tr><td colspan="6" class="muted">Aucun export enregistré.</td></tr>'}
        </tbody></table></div>
      <p class="hint muted">${esc(jr.reserve)}</p>`}`;

  $("#ex-campus").onchange = (e) => { xplCampus = e.target.value; renderExploitation(); };
  $$(".ex-tab").forEach((b) => { b.onclick = () => { xplOnglet = b.dataset.t; renderExploitation(); }; });

  // Les axes ne proposent jamais un champ nominatif : ventiler un tableau sur
  // un nom produirait une liste de personnes déguisée en statistique.
  const majAxes = () => {
    const src = ref.sources[$("#ex-src").value];
    const axes = src.champs.filter((c) => !c.nominatif);
    const opts = axes.map((c) => `<option value="${c.cle}">${esc(c.label)}</option>`).join("");
    $("#ex-l").innerHTML = opts;
    $("#ex-c").innerHTML = opts;
    if (axes[1]) $("#ex-c").value = axes[1].cle;
    $("#ex-m").innerHTML = '<option value="">— compter —</option>' + axes.map((c) => `<option value="${c.cle}">${esc(c.label)}</option>`).join("");
  };
  if ($("#ex-src")) { $("#ex-src").onchange = majAxes; majAxes(); }

  if ($("#ex-go")) $("#ex-go").onclick = async () => {
    const r = await api.post("/api/exploitation/croiser", {
      campusId: xplCampus, source: $("#ex-src").value,
      ligne: $("#ex-l").value, colonne: $("#ex-c").value, mesure: $("#ex-m").value || null,
    });
    if (r?.error) { $("#ex-out").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    $("#ex-out").innerHTML = `
      ${r.reserve ? `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid #8A7A4B;"><b>${esc(r.reserve)}</b></div>` : ""}
      ${r.exploitable === false ? `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid #8A4B4B;"><b>${r.degenere ? "Ce croisement ne peut pas être protégé." : "Tableau trop masqué pour être exploité."}</b><p class="muted" style="margin:6px 0 0;font-size:13px;">${r.degenere ? "Avec une seule ligne ou une seule colonne, le masquage est décoratif : chaque case se déduit d'un effectif connu par ailleurs." : "Mieux vaut le dire que laisser tirer une conclusion de trois cases."}</p></div>` : ""}
      <div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th></th>${r.valColonnes.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${r.valLignes.map((l, i) => `<tr><td><b>${esc(l)}</b></td>${r.grille[i].map((c) => `<td${c.masquee ? ` class="muted" title="${esc(c.motif || "")}"` : ""}>${c.masquee ? "—" : (c.valeur ?? 0)}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>`;
  };

  const majChamps = () => {
    const src = ref.sources[$("#ex-esrc").value];
    $("#ex-champs").innerHTML = src.champs.map((c) => `<label class="jal-chk"><input type="checkbox" class="ex-ch" value="${c.cle}"> ${esc(c.label)}${c.nominatif ? ' <span class="pill p-warn">nominatif</span>' : ""}</label>`).join("");
    $$(".ex-ch").forEach((i) => { i.onchange = majPrec; });
    majPrec();
  };
  const majPrec = () => {
    const src = ref.sources[$("#ex-esrc").value];
    const coches = $$(".ex-ch").filter((i) => i.checked).map((i) => i.value);
    const nom = src.champs.filter((c) => c.nominatif && coches.includes(c.cle));
    $("#ex-prec").innerHTML = nom.length
      ? `<div class="item" style="border-left:3px solid #8A7A4B;"><div class="grow"><b>Export nominatif</b> (${nom.map((c) => esc(c.label)).join(", ")}).
         Un export de données personnelles est un traitement : il se justifie par une finalité, et il devra être expliqué.
         <br><input class="txt" id="ex-precis" placeholder="Préciser si « autre »" style="margin-top:6px;"></div></div>`
      : "";
  };
  if ($("#ex-esrc")) { $("#ex-esrc").onchange = majChamps; majChamps(); }

  if ($("#ex-exp")) $("#ex-exp").onclick = async () => {
    const champs = $$(".ex-ch").filter((i) => i.checked).map((i) => i.value);
    const r = await api.post("/api/exploitation/exporter", {
      campusId: xplCampus, source: $("#ex-esrc").value, champs,
      finalite: $("#ex-fin").value || null, finalitePrecision: $("#ex-precis")?.value || "",
    });
    if (r?.error) { $("#ex-eout").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    $("#ex-eout").innerHTML = `
      ${(r.warnings || []).map((w) => `<div class="item" style="border-left:3px solid #8A7A4B;margin-bottom:6px;"><div class="grow">${esc(w)}</div></div>`).join("")}
      <div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr>${champs.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${r.lignes.slice(0, 50).map((l) => `<tr>${champs.map((c) => `<td>${esc(l[c] ?? "")}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>
      <p class="hint muted">${r.total} ligne(s) — ${Math.min(50, r.total)} affichée(s). L'export est tracé au journal : qui, quoi, quand, pourquoi.</p>`;
  };
}

// --- Financement individuel (CPF) ---
// L'écran ne propose nulle part de saisir des heures réalisées : le service
// fait se lit dans l'émargement scellé, et c'est tout l'objet du module.
let cpfCampus = "";

async function renderCpf() {
  if (!cpfCampus) cpfCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/cpf?campusId=${cpfCampus}`);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="cp-new">+ Dossier</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="cpf-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === cpfCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.ouverts, "dossiers ouverts")}${fkpi(d.aDeclarer, "à déclarer", d.aDeclarer ? "bad" : "")}
        ${fkpi(d.montantOuvert.toLocaleString("fr-FR") + " €", "encours")}</div>
    </div>

    <div class="section-title" style="margin-top:0;">Éligibilité des offres</div>
    <p class="hint muted" style="margin-top:0;">L'éligibilité se juge offre par offre. Une seule offre certifiante ne rend pas tout le catalogue finançable.</p>
    ${d.offres.length ? d.offres.map((o) => `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid ${o.eligible ? "#4B7A5A" : "#8A4B4B"};">
      <div class="row" style="gap:8px;align-items:center;">
        <b class="grow">${esc(o.intitule)}</b>
        ${o.codeCertification ? `<span class="pill">${esc(d.repertoires[o.repertoire] ? o.repertoire.toUpperCase() : "?")} ${esc(o.codeCertification)}</span>` : ""}
        <span class="pill ${o.eligible ? "p-good" : "p-bad"}">${o.eligible ? "éligible" : "non éligible"}</span>
      </div>
      ${o.manques.map((m) => `<div class="item" style="border-left:3px solid ${GRAV[m.gravite]};margin-top:8px;"><div class="grow">${esc(m.message)}</div></div>`).join("")}
    </div>`).join("") : '<div class="card card-pad"><p class="muted">Aucune offre de formation continue au catalogue.</p></div>'}

    <div class="section-title">Dossiers</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Bénéficiaire</th><th>Inscription</th><th>Session</th><th>Prix</th><th>État</th><th>Service fait</th><th></th></tr></thead><tbody>
      ${d.lignes.length ? d.lignes.map((l) => `<tr>
        <td><b>${esc(l.beneficiaire || "—")}</b></td>
        <td>${esc(l.dateInscription || "—")}</td>
        <td>${esc(l.dateDebut || "—")}</td>
        <td>${l.prix != null ? `${l.prix} €` : "—"}</td>
        <td><span class="pill ${l.ouvert ? "p-warn" : "p-good"}">${esc(l.etatLabel)}</span>
          ${l.alertes.map((a) => `<br><span style="color:${GRAV.bloquant};font-size:12px;">${esc(a.message)}</span>`).join("")}</td>
        <td>${l.serviceFaitHeures != null ? `<b>${l.serviceFaitHeures} h</b> <span class="muted">(${l.serviceFaitTaux} %)</span>` : '<span class="muted">—</span>'}</td>
        <td>${l.etat === "en_formation" ? `<button class="btn-ghost btn-sm cp-sf" data-id="${l.id}">Service fait</button>` : ""}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="muted">Aucun dossier.</td></tr>'}
      </tbody></table></div>
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#cpf-campus").onchange = (e) => { cpfCampus = e.target.value; renderCpf(); };
  $("#cp-new").onclick = () => openDossierCpfForm(d);
  $$(".cp-sf").forEach((b) => { b.onclick = () => openServiceFait(b.dataset.id); });
}

function openDossierCpfForm(d) {
  const eligibles = d.offres.filter((o) => o.eligible);
  openModal("Nouveau dossier", `
    ${eligibles.length ? "" : '<div class="item" style="border-left:3px solid #8A4B4B;"><div class="grow">Aucune offre éligible : ouvrir un dossier maintenant, c\'est le découvrir au moment du paiement.</div></div>'}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Offre</label>
        <select class="txt cpf" data-f="offreId">${eligibles.map((o) => `<option value="${o.id}">${esc(o.intitule)}</option>`).join("")}</select></div>
      <div><label class="field-label">Bénéficiaire</label><input class="txt cpf" data-f="beneficiaire"></div>
      <div><label class="field-label">Prix (€)</label><input class="txt cpf" data-f="prix" type="number" min="0"></div>
      <div><label class="field-label">Date d'inscription</label><input class="txt cpf" data-f="dateInscription" type="date"></div>
      <div><label class="field-label">Début de session</label><input class="txt cpf" data-f="dateDebut" type="date">
        <p class="hint muted" style="margin-top:4px;">Au moins ${d.delaiEntree} jours après l'inscription, sinon la session n'est pas finançable.</p></div>
      <div><label class="field-label">Fin de session</label><input class="txt cpf" data-f="dateFin" type="date"></div>
      <div><label class="field-label">Exonération de participation</label>
        <select class="txt cpf" data-f="exoneration">${Object.entries(d.exonerations).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="cpf-save" ${eligibles.length ? "" : "disabled"}>Créer</button></div>`);

  $("#cpf-save").onclick = async () => {
    const body = { campusId: cpfCampus };
    $$(".cpf").forEach((i) => { if (i.value !== "") body[i.dataset.f] = i.dataset.f === "prix" ? +i.value : i.value; });
    const r = await api.post("/api/cpf/dossiers", body);
    if (r?.error) { alert(r.error); return; }
    closeModals(); renderCpf();
  };
}

async function openServiceFait(id) {
  const s = await api.get(`/api/cpf/dossiers/${id}/service-fait`);
  if (s?.error) { alert(s.error); return; }
  openModal("Déclaration du service fait", `
    <p class="muted" style="font-size:13.5px;"><b>Ces heures ne se saisissent pas.</b> Elles sont lues dans les feuilles d'émargement closes — celles de la chaîne scellée. Un service fait déclaré à la main déclare ce qu'on souhaite, pas ce qui s'est passé.</p>
    <div class="kpis" style="margin-top:12px;">${fkpi(s.heuresPrevues + " h", "prévues")}${fkpi(s.heuresRealisees + " h", "réalisées")}
      ${s.taux != null ? fkpi(s.taux + " %", "assiduité", s.taux === 100 ? "good" : "bad") : ""}
      ${fkpi(s.feuillesRetenues, "feuilles closes")}</div>
    ${s.alerte ? `<div class="item" style="border-left:3px solid #8A7A4B;margin-top:10px;"><div class="grow">${esc(s.alerte.message)}</div></div>` : ""}
    ${s.declaration.motif ? `<div class="item" style="border-left:3px solid ${s.declaration.autorise ? "#8A7A4B" : "#8A4B4B"};margin-top:10px;"><div class="grow">${esc(s.declaration.motif)}</div></div>` : ""}
    <p class="hint muted">${esc(s.reserve)}</p>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="sf-go" ${s.declaration.autorise ? "" : "disabled"}>Déclarer ${s.heuresRealisees} h</button></div>`);

  $("#sf-go").onclick = async () => {
    const r = await api.post(`/api/cpf/dossiers/${id}/service-fait`, {});
    if (r?.error) { alert(r.error); return; }
    if (r.partiel) alert(r.motif);
    closeModals(); renderCpf();
  };
}

// --- Catalogue et devis ---
// Un seul écran pour la chaîne : offre → devis → convention. Les séparer
// laisserait croire que ce sont trois sujets.
let catCampus = "", catOnglet = "offres";

async function renderCatalogue() {
  if (!catCampus) catCampus = state.campuses[0]?.id || "";
  const [c, p] = await Promise.all([
    api.get(`/api/offres?campusId=${catCampus}`), api.get(`/api/devis?campusId=${catCampus}`),
  ]);
  if (c?.error) { $("#view").innerHTML = `<p class="neg">${esc(c.error)}</p>`; return; }
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };

  $("#topbar-actions").innerHTML = catOnglet === "offres"
    ? `<button class="btn-primary btn-sm" id="cat-new">+ Offre</button>`
    : `<button class="btn-primary btn-sm" id="dv-new">+ Devis</button>`;

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;gap:8px;">
      <div><label class="field-label">Campus</label><select id="cat-campus">${state.campuses.map((x) => `<option value="${x.id}" ${x.id === catCampus ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <button class="btn-ghost btn-sm cat-tab ${catOnglet === "offres" ? "btn-primary" : ""}" data-t="offres">Catalogue (${c.total})</button>
      <button class="btn-ghost btn-sm cat-tab ${catOnglet === "devis" ? "btn-primary" : ""}" data-t="devis">Devis (${p.total})</button>
    </div>
    ${catOnglet === "offres" ? `
      <div class="kpis" style="margin-bottom:12px;">${fkpi(c.publiees, "publiées")}
        ${fkpi(c.invalides.length, "publiées à tort", c.invalides.length ? "bad" : "good")}
        ${fkpi(c.sansDelaiAcces, "sans délai d'accès", c.sansDelaiAcces ? "bad" : "good")}</div>
      ${c.invalides.map((i) => `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid #8A4B4B;">
        <b>${esc(i.intitule)}</b><ul style="margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:13px;">${i.erreurs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`).join("")}
      <div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th>Offre</th><th>Nature</th><th>Durée</th><th>Tarif affiché</th><th>État</th><th></th></tr></thead><tbody>
        ${c.offres.length ? c.offres.map((o) => `<tr>
          <td><b>${esc(o.intitule || "—")}</b>${o.codeRncp ? `<br><span class="muted" style="font-size:12px;">RNCP ${esc(o.codeRncp)}</span>` : ""}</td>
          <td>${esc(c.natures[o.nature]?.label || o.nature)}</td>
          <td>${o.dureeHeures ?? "—"} h</td>
          <td>${esc(o.tarifLibelle.texte)}</td>
          <td>${o.publiee ? (o.validation.ok ? '<span class="pill p-good">publiée</span>' : '<span class="pill p-bad">publiée, incomplète</span>') : '<span class="pill">brouillon</span>'}</td>
          <td><button class="btn-ghost btn-sm cat-pub" data-id="${o.id}">${o.publiee ? "Retirer" : "Publier"}</button>
            <button class="btn-ghost btn-sm cat-vue" data-id="${o.id}">Vue publique</button></td>
        </tr>`).join("") : '<tr><td colspan="6" class="muted">Aucune offre. L\'information du public sur les prestations est l\'indicateur 1 du référentiel.</td></tr>'}
        </tbody></table></div>
      <p class="hint muted">${esc(c.reserve)}</p>
    ` : `
      <div class="kpis" style="margin-bottom:12px;">${fkpi(p.enCours, "en cours")}
        ${fkpi(p.montantEnCours.toLocaleString("fr-FR") + " €", "encours")}
        ${fkpi(p.montantGagne.toLocaleString("fr-FR") + " €", "gagné", "good")}
        ${p.tauxTransformation != null ? fkpi(p.tauxTransformation + " %", "transformation") : ""}
        ${fkpi(p.bloquants, "acceptés sans acte", p.bloquants ? "bad" : "good")}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${p.parEtape.filter((e) => e.n).map((e) => `<span class="pill">${esc(e.label)} : ${e.n} · ${e.montant.toLocaleString("fr-FR")} €</span>`).join("")}
      </div>
      <div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th>Client</th><th>Objet</th><th>Montant</th><th>Validité</th><th>Étape</th><th>Alertes</th><th></th></tr></thead><tbody>
        ${p.lignes.length ? p.lignes.map((l) => `<tr>
          <td><b>${esc(l.client)}</b></td><td>${esc(l.intitule || "—")}</td>
          <td>${l.montant.toLocaleString("fr-FR")} €</td>
          <td>${esc(l.dateValidite || "—")}</td>
          <td><span class="pill ${l.etape === "expire" ? "p-bad" : l.ouvert ? "p-warn" : "p-good"}">${esc(l.etapeLabel)}</span></td>
          <td>${l.alertes.map((a) => `<div style="color:${GRAV[a.gravite]};font-size:12.5px;">${esc(a.message)}</div>`).join("") || '<span class="muted">—</span>'}</td>
          <td>${!l.acteId && l.etape === "accepte" ? `<button class="btn-primary btn-sm dv-tr" data-id="${l.id}">Transformer</button>`
            : l.ouvert ? `<button class="btn-ghost btn-sm dv-etape" data-id="${l.id}">Étape</button>` : ""}</td>
        </tr>`).join("") : '<tr><td colspan="7" class="muted">Aucun devis.</td></tr>'}
        </tbody></table></div>
      <p class="hint muted">${esc(p.reserve)}</p>`}`;

  $("#cat-campus").onchange = (e) => { catCampus = e.target.value; renderCatalogue(); };
  $$(".cat-tab").forEach((b) => { b.onclick = () => { catOnglet = b.dataset.t; renderCatalogue(); }; });
  if ($("#cat-new")) $("#cat-new").onclick = () => openOffreForm(c);
  if ($("#dv-new")) $("#dv-new").onclick = () => openDevisForm(c);

  $$(".cat-pub").forEach((b) => { b.onclick = async () => {
    const o = c.offres.find((x) => x.id === b.dataset.id);
    const r = await api.patch(`/api/offres/${o.id}`, { publiee: !o.publiee });
    // Publier une offre incomplète est refusé : c'est le moment où l'exigence mord.
    if (r?.error) { alert(`Publication impossible :\n\n${r.error}`); return; }
    renderCatalogue();
  }; });
  $$(".cat-vue").forEach((b) => { b.onclick = async () => {
    const v = await api.get(`/api/offres/${b.dataset.id}/public`);
    openModal(`Vue publique — ${v.intitule}`, `
      <p class="muted" style="font-size:13.5px;">Exactement ce que verrait un candidat. Rien d'interne ne traverse cette vue.</p>
      <div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table"><tbody>
        ${[["Nature", v.natureLabel], ["Objectifs", v.objectifs], ["Prérequis", v.prerequis], ["Public visé", v.publicVise],
           ["Durée", `${v.dureeHeures ?? "—"} h`], ["Modalités", v.modalitesLabel], ["Délai d'accès", v.delaiAcces],
           ["Évaluation", v.evaluation], ["Accessibilité", v.accessibilite], ["Débouchés", v.debouches],
           ["Tarif", v.tarif], ["Contact", v.contact]]
          .map(([k, val]) => `<tr><td class="muted" style="width:32%;">${esc(k)}</td><td>${esc(val || "—")}</td></tr>`).join("")}
      </tbody></table></div>
      ${v.resultats ? `<div class="section-title">Résultats</div>
        <div class="card" style="overflow-x:auto;"><table class="net-table"><tbody>
        ${v.resultats.lignes.map((l) => `<tr><td class="muted" style="width:50%;">${esc(l.label)}</td>
          <td>${l.publiable ? `<b>${l.valeur} %</b> <span class="muted">(${l.effectif})</span>` : `<span class="muted">${esc(l.motif)}</span>`}</td></tr>`).join("")}
        </tbody></table></div>
        <p class="hint muted">${esc(v.resultats.reserve)}</p>` : ""}`);
  }; });

  $$(".dv-tr").forEach((b) => { b.onclick = () => openTransformation(b.dataset.id); });
  $$(".dv-etape").forEach((b) => { b.onclick = async () => {
    const etape = prompt("Étape (envoye, relance, accepte, refuse) :", "accepte");
    if (!etape) return;
    const r = await api.patch(`/api/devis/${b.dataset.id}`, { etape, dateEnvoi: etape === "envoye" ? new Date().toISOString().slice(0, 10) : undefined });
    if (r?.error) { alert(r.error); return; }
    renderCatalogue();
  }; });
}

function openOffreForm(c) {
  const champ = (m) => `<div style="grid-column:1/-1;"><label class="field-label">${esc(m.label)} <span class="muted" style="font-weight:400;">${esc(m.base)}</span>${m.oubliee ? ' <span class="pill p-warn">souvent oubliée</span>' : ""}</label>
    <input class="txt of" data-f="${m.cle}" ${m.cle === "dureeHeures" ? 'type="number" min="1"' : ""}></div>`;
  openModal("Nouvelle offre", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nature</label><select class="txt" id="of-nature">${Object.entries(c.natures).map(([k, n]) => `<option value="${k}">${esc(n.label)}</option>`).join("")}</select></div>
      <div><label class="field-label">Modalités</label><select class="txt of" data-f="modalites">${Object.entries(c.modalites).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;" id="of-tarif"></div>
      ${c.mentions.filter((m) => !["modalites", "tarif"].includes(m.cle)).map(champ).join("")}
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="of-save">Créer en brouillon</button></div>`);

  // LE POINT DE DROIT, dit à l'endroit où l'on serait tenté de taper un prix.
  const maj = () => {
    const n = c.natures[$("#of-nature").value];
    $("#of-tarif").innerHTML = n.gratuitePourBeneficiaire
      ? `<div class="item" style="border-left:3px solid var(--accent);"><div class="grow">
          <b>Aucun tarif à saisir.</b> La formation est gratuite pour l'apprenti et son représentant légal (${esc(n.base)}). ${esc(n.financement)}.
          <br><span class="muted" style="font-size:13px;">Afficher un montant laisserait croire à une famille qu'elle doit payer — et le coût réel n'est pas un prix de vente.</span></div></div>`
      : `<label class="field-label">Tarif (€)</label><input class="txt of" data-f="tarifMontant" type="number" min="0">
         <p class="hint muted" style="margin-top:4px;">Laisser vide pour saisir un libellé libre dans « Tarif ou conditions de financement ».</p>`;
  };
  $("#of-nature").onchange = maj; maj();

  $("#of-save").onclick = async () => {
    const body = { campusId: catCampus, nature: $("#of-nature").value, publiee: false };
    $$(".of").forEach((i) => { if (i.value !== "") body[i.dataset.f] = ["dureeHeures", "tarifMontant"].includes(i.dataset.f) ? +i.value : i.value; });
    const r = await api.post("/api/offres", body);
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert("Créée en brouillon. À compléter avant publication :\n" + r.warnings.join("\n"));
    closeModals(); renderCatalogue();
  };
}

function openDevisForm(c) {
  openModal("Nouveau devis", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Client</label><input class="txt dvf" data-f="client"></div>
      <div><label class="field-label">Offre du catalogue</label><select class="txt dvf" data-f="offreId"><option value="">— hors catalogue —</option>${c.offres.map((o) => `<option value="${o.id}">${esc(o.intitule)}</option>`).join("")}</select></div>
      <div><label class="field-label">Objet</label><input class="txt dvf" data-f="intitule"></div>
      <div><label class="field-label">Effectif</label><input class="txt dvf" data-f="effectif" type="number" min="1" value="1"></div>
      <div><label class="field-label">Début</label><input class="txt dvf" data-f="dateDebut" type="date"></div>
      <div><label class="field-label">Fin</label><input class="txt dvf" data-f="dateFin" type="date"></div>
      <div><label class="field-label">Prix unitaire (€)</label><input class="txt" id="dv-pu" type="number" min="0"></div>
      <div><label class="field-label">Validité</label><input class="txt dvf" data-f="dateValidite" type="date">
        <p class="hint muted" style="margin-top:4px;">Par défaut ${c.validiteDefaut ?? 30} jours. Un devis sans terme engage indéfiniment aux conditions affichées.</p></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="dv-save">Créer</button></div>`);

  $("#dv-save").onclick = async () => {
    const body = { campusId: catCampus };
    $$(".dvf").forEach((i) => { if (i.value !== "") body[i.dataset.f] = i.dataset.f === "effectif" ? +i.value : i.value; });
    const pu = $("#dv-pu").value;
    if (pu !== "") body.lignes = [{ libelle: body.intitule || "Prestation", quantite: body.effectif || 1, prixUnitaire: +pu }];
    const r = await api.post("/api/devis", body);
    if (r?.error) { alert(r.error); return; }
    closeModals(); catOnglet = "devis"; renderCatalogue();
  };
}

async function openTransformation(devisId) {
  const [d, classes] = await Promise.all([api.get(`/api/devis/${devisId}`), api.get("/api/classes")]);
  const mines = classes.filter((k) => k.campusId === catCampus);
  openModal("Transformer en convention ou contrat", `
    <p class="muted" style="font-size:13.5px;"><b>Un devis accepté n'est pas une convention.</b> Le devis est une offre commerciale ; la convention de formation est le document que le code du travail exige (art. L. 6353-2). Démarrer sur un devis signé, c'est exécuter sans le document requis.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
      <div style="grid-column:1/-1;"><label class="field-label">Qui finance ?</label>
        <select class="txt" id="tr-payeur"><option value="entreprise">Entreprise ou personne morale</option><option value="opco">OPCO ou financeur public</option><option value="particulier">Le bénéficiaire lui-même, à ses frais</option></select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Classe (pour rattacher le programme préétabli)</label>
        <select class="txt" id="tr-classe"><option value="">—</option>${mines.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="tr-go">Transformer</button></div>`);

  const lancer = async (confirmer) => {
    const r = await api.post(`/api/devis/${devisId}/transformer`, {
      payeur: $("#tr-payeur").value, classId: $("#tr-classe").value || null, confirmer,
    });
    if (r?.forcable && !confirmer) {
      if (confirm(`${r.error}\n\nTransformer malgré tout ?`)) return lancer(true);
      return;
    }
    if (r?.error) { alert(r.error); return; }
    alert(r.aCompleter.length
      ? `Acte créé en brouillon. À compléter avant signature :\n\n${r.aCompleter.join("\n")}`
      : "Acte créé en brouillon, complet. Il reste à le signer depuis Documents obligatoires.");
    closeModals(); renderCatalogue();
  };
  $("#tr-go").onclick = () => lancer(false);
}

// --- Contrats des intervenants ---
// L'écran ne classe pas par date mais par RISQUE : ce qui expose à une
// requalification passe devant, parce que c'est ce qui ne se rattrape pas.
let cpCampus = "";

async function renderContratsProfs() {
  if (!cpCampus) cpCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/contrats-intervenants?campusId=${cpCampus}`);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };
  const ETAT = { en_cours: "p-good", a_venir: "", echu: "p-bad", rompu: "" };

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="cp-new">+ Contrat</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="cp-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === cpCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.actifs, "en cours")}${fkpi(d.echus, "échus", d.echus ? "bad" : "")}
        ${fkpi(d.sansContrat.length, "sans contrat", d.sansContrat.length ? "bad" : "good")}
        ${fkpi(d.bloquants, "points bloquants", d.bloquants ? "bad" : "good")}</div>
    </div>

    ${d.sansContrat.length ? `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid #8A4B4B;">
      <b>${d.sansContrat.length} intervenant(s) sans aucun contrat enregistré.</b>
      <p class="muted" style="margin:6px 0 0;font-size:13.5px;">${d.sansContrat.map((x) => esc(x.nom)).join(", ")} — leurs heures s'exécutent sans support contractuel.</p></div>` : ""}

    ${d.risques.map((r) => `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid ${GRAV[r.gravite]};">
      <b>${r.code === "carence" ? "Délai de carence" : r.code === "succession" ? "Succession de CDD" : "Poursuite au-delà du terme"}</b>
      <p class="muted" style="margin:6px 0 0;font-size:13.5px;">${esc(r.message)}</p></div>`).join("")}

    ${d.couvertures.map((c) => `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid #8A4B4B;">
      <b>${esc(c.nom || "Intervenant")}</b>
      <p class="muted" style="margin:6px 0 0;font-size:13.5px;">${esc(c.alerte.message)}</p></div>`).join("")}

    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Intervenant</th><th>Nature</th><th>Motif</th><th>Période</th><th>État</th><th>Alertes</th><th></th></tr></thead><tbody>
      ${d.lignes.length ? d.lignes.map((l) => `<tr>
        <td><b>${esc(l.nom)}</b>${l.poste ? `<br><span class="muted" style="font-size:12px;">${esc(l.poste)}</span>` : ""}</td>
        <td>${esc(l.natureLabel)}</td>
        <td>${esc(l.motifLabel || "—")}</td>
        <td>${esc(l.dateDebut || "—")} → ${esc(l.dateFin || "sans terme")}</td>
        <td><span class="pill ${ETAT[l.etat] || ""}">${esc(l.etat.replace("_", " "))}</span></td>
        <td>${l.alertes.length ? l.alertes.map((a) => `<div style="color:${GRAV[a.gravite]};font-size:12.5px;margin-bottom:3px;">${esc(a.message)}</div>`).join("") : '<span class="muted">—</span>'}</td>
        <td>${l.vigilance?.requise ? `<button class="btn-ghost btn-sm cp-vig" data-id="${l.id}">+ Vigilance</button>` : ""}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="muted">Aucun contrat enregistré.</td></tr>'}
      </tbody></table></div>
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#cp-campus").onchange = (e) => { cpCampus = e.target.value; renderContratsProfs(); };
  $("#cp-new").onclick = () => openContratProfForm(d);
  $$(".cp-vig").forEach((b) => { b.onclick = async () => {
    const date = prompt("Date de l'attestation de vigilance (AAAA-MM-JJ) :", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const r = await api.post(`/api/contrats-intervenants/${b.dataset.id}/vigilance`, { date });
    if (r?.error) { alert(r.error); return; }
    renderContratsProfs();
  }; });
}

async function openContratProfForm(d) {
  const profs = (await api.get("/api/teachers")).filter((t) => (t.campusIds || []).includes(cpCampus) && t.active !== false);
  openModal("Contrat d'intervenant", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Intervenant</label><select class="txt cf" data-f="teacherId">${profs.map((t) => `<option value="${t.id}">${esc(t.name)} — ${esc(t.status || "")}</option>`).join("")}</select></div>
      <div><label class="field-label">Nature</label><select class="txt" id="cf-nature">${Object.entries(d.natures).map(([k, n]) => `<option value="${k}">${esc(n.label)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Poste ou matière</label><input class="txt cf" data-f="poste" placeholder="Optique géométrique">
        <p class="hint muted" style="margin-top:4px;">Le délai de carence entre deux CDD s'apprécie sur le POSTE : sans lui, l'enchaînement ne peut pas être détecté.</p></div>
      <div><label class="field-label">Début</label><input class="txt cf" data-f="dateDebut" type="date"></div>
      <div><label class="field-label">Terme</label><input class="txt cf" data-f="dateFin" type="date"></div>
      <div style="grid-column:1/-1;" id="cf-specifique"></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="cf-save">Enregistrer</button></div>`);

  // Les champs dépendent de la nature : un prestataire n'a ni essai ni DPAE, et
  // les lui proposer serait suggérer une pièce qui joue contre l'organisme.
  const maj = () => {
    const nat = $("#cf-nature").value;
    const salarie = d.natures[nat].salarie;
    $("#cf-specifique").innerHTML = nat === "cdd" ? `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="field-label">Motif de recours</label><select class="txt cf" data-f="motif">${Object.entries(d.motifs).map(([k, m]) => `<option value="${k}">${esc(m)}</option>`).join("")}</select></div>
        <div><label class="field-label">Personne remplacée</label><input class="txt cf" data-f="remplace" placeholder="si motif « remplacement »"></div>
        <div><label class="field-label">Signé le</label><input class="txt cf" data-f="signeLe" type="date"></div>
        <div><label class="field-label">DPAE le</label><input class="txt cf" data-f="dpaeLe" type="date"></div>
        <div><label class="field-label">Essai (jours)</label><input class="txt cf" data-f="dureeEssaiJours" type="number" min="0"></div>
        <div><label class="field-label">Convention collective</label><input class="txt cf" data-f="conventionCollective"></div>
      </div>
      <p class="hint muted" style="margin-top:6px;">Un CDD sans motif de recours est réputé à durée indéterminée (L. 1242-12), et il doit être signé dans les deux jours ouvrables suivant l'embauche (L. 1242-13).</p>`
      : salarie ? `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="field-label">Signé le</label><input class="txt cf" data-f="signeLe" type="date"></div>
        <div><label class="field-label">DPAE le</label><input class="txt cf" data-f="dpaeLe" type="date"></div>
        <div><label class="field-label">Essai (jours)</label><input class="txt cf" data-f="dureeEssaiJours" type="number" min="0"></div>
        <div><label class="field-label">Convention collective</label><input class="txt cf" data-f="conventionCollective"></div>
      </div>` : `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="field-label">Société</label><input class="txt cf" data-f="societe"></div>
        <div><label class="field-label">Montant (€)</label><input class="txt cf" data-f="montant" type="number" min="0"></div>
      </div>
      <p class="hint muted" style="margin-top:6px;">Un prestataire n'a ni période d'essai ni déclaration d'embauche : ces mentions serviraient à démontrer un lien de subordination. Au-delà de ${d.seuilVigilance} €, l'attestation de vigilance URSSAF est requise et se renouvelle tous les six mois.</p>`;
  };
  $("#cf-nature").onchange = maj; maj();

  const enregistrer = async (confirmerCarence) => {
    const body = { campusId: cpCampus, nature: $("#cf-nature").value, confirmerCarence };
    $$(".cf").forEach((i) => { if (i.value !== "") body[i.dataset.f] = i.dataset.f === "dureeEssaiJours" || i.dataset.f === "montant" ? +i.value : i.value; });
    const r = await api.post("/api/contrats-intervenants", body);
    if (r?.code === "carence") {
      // On refuse AVANT d'écrire, et on laisse la possibilité d'assumer.
      if (confirm(`${r.error}\n\n${r.indice}\n\nEnregistrer malgré tout ?`)) return enregistrer(true);
      return;
    }
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert("Enregistré. À compléter :\n" + r.warnings.join("\n"));
    closeModals(); renderContratsProfs();
  };
  $("#cf-save").onclick = () => enregistrer(false);
}

// --- Documents obligatoires de l'organisme de formation ---
// Le point que l'écran doit rendre évident : le choix entre convention et
// contrat n'en est pas un, il se déduit de qui paie.
let dofCampus = "", dofRef = null;

async function renderDocumentsOf() {
  if (!dofCampus) dofCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/documents-of?campusId=${dofCampus}`);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }
  dofRef = d;
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="do-new">+ Convention / contrat</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="do-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === dofCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.actes.length, "actes")}${fkpi(d.bloquants, "points bloquants", d.bloquants ? "bad" : "good")}
        ${d.remises.taux != null ? fkpi(d.remises.taux + " %", "règlement remis", d.remises.complet ? "good" : "bad") : ""}</div>
    </div>
    ${d.points.map((p) => `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid ${GRAV[p.gravite]};">
      <b>${esc(p.label)}</b><p class="muted" style="margin:6px 0 0;font-size:13.5px;">${esc(p.message)}</p></div>`).join("")}

    <div class="section-title">Règlement intérieur</div>
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;">
        <span class="grow">${d.reglement.version ? `Version <b>${esc(d.reglement.version)}</b>, applicable au ${esc(d.reglement.dateApplication || "—")}` : '<span class="muted">Aucun règlement établi</span>'}</span>
        ${d.reglement.version ? `<button class="btn-ghost btn-sm" id="do-ri-print">Imprimer</button>
          <button class="btn-ghost btn-sm" id="do-ri-remise">Enregistrer la remise à tous les inscrits</button>` : ""}
        <button class="btn-ghost btn-sm" id="do-ri-edit">${d.reglement.version ? "Modifier" : "Établir"}</button>
      </div>
      ${d.dureeMaxHeures > 500 ? `<p class="hint muted" style="margin-top:8px;">Formation la plus longue du campus : <b>${d.dureeMaxHeures} h</b>. Au-delà de 500 h, l'élection de délégués des stagiaires doit être organisée et décrite dans le règlement (R. 6352-9).</p>` : ""}
      ${d.remises.version ? `<p class="hint muted" style="margin-top:6px;">Remise enregistrée pour ${d.remises.remis}/${d.remises.inscrits} inscrit(s). Une remise de l'ancienne version ne vaut pas pour la nouvelle.</p>` : ""}
    </div>

    <div class="section-title">Conventions et contrats</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Acte</th><th>Type</th><th>Financement</th><th>Période</th><th>Prix</th><th>État</th><th></th></tr></thead><tbody>
      ${d.actes.length ? d.actes.map((a) => `<tr>
        <td><b>${esc(a.intitule || "—")}</b>${a.aProgramme ? "" : ' <span class="pill p-bad">sans programme</span>'}</td>
        <td>${esc(d.types[a.type]?.label || a.type)}</td>
        <td>${esc(d.payeurs[a.payeur]?.label || a.payeur || "—")}</td>
        <td>${esc(a.dateDebut || "—")} → ${esc(a.dateFin || "—")}</td>
        <td>${a.prix != null ? `${a.prix} €` : "—"}</td>
        <td>${a.statut === "signe" ? '<span class="pill p-good">signé</span>'
          : a.validation.ok ? '<span class="pill p-warn">à signer</span>' : `<span class="pill p-bad">${a.validation.errors.length} manque(s)</span>`}</td>
        <td><button class="btn-ghost btn-sm do-print" data-id="${a.id}">Éditer</button>
          ${a.statut !== "signe" && a.validation.ok ? `<button class="btn-ghost btn-sm do-sign" data-id="${a.id}">Signer</button>` : ""}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="muted">Aucun acte. Une formation qui démarre sans convention ni contrat signé s\'exécute sans base contractuelle.</td></tr>'}
      </tbody></table></div>
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#do-campus").onchange = (e) => { dofCampus = e.target.value; renderDocumentsOf(); };
  $("#do-new").onclick = () => openActeForm(d);
  $("#do-ri-edit").onclick = () => openReglementForm(d);
  if ($("#do-ri-print")) $("#do-ri-print").onclick = () => window.open(`/api/documents-of/reglement/print?campusId=${dofCampus}`, "_blank");
  if ($("#do-ri-remise")) $("#do-ri-remise").onclick = async () => {
    const r = await api.post("/api/documents-of/remise", { campusId: dofCampus });
    if (r?.error) { alert(r.error); return; }
    alert(`Remise enregistrée pour ${r.enregistrees} inscrit(s) — version ${r.version}.`);
    renderDocumentsOf();
  };
  $$(".do-print").forEach((b) => { b.onclick = () => window.open(`/api/actes/${b.dataset.id}/print`, "_blank"); });
  $$(".do-sign").forEach((b) => { b.onclick = async () => {
    if (!confirm("Signer cet acte ? Il ne pourra plus être modifié — seulement avenanté.")) return;
    const r = await api.post(`/api/actes/${b.dataset.id}/signer`, {});
    if (r?.error) { alert(r.error); return; }
    renderDocumentsOf();
  }; });
}

function openReglementForm(d) {
  const r = d.reglement || {};
  const champ = (m) => `<div style="grid-column:1/-1;"><label class="field-label">${esc(m.label)} <span class="muted" style="font-weight:400;">${esc(m.base)}</span></label>
    <textarea class="txt ri" data-f="${m.cle}" rows="3">${esc(r[m.cle] || "")}</textarea></div>`;
  openModal("Règlement intérieur", `
    <p class="muted" style="font-size:13.5px;">Obligatoire pour tout organisme de formation (art. L. 6352-3). Son contenu est fixé par les textes : ce ne sont pas des rubriques libres.</p>
    ${d.dureeMaxHeures > 500 ? `<div class="item" style="border-left:3px solid #8A7A4B;margin-top:10px;"><div class="grow">La formation la plus longue du campus dure <b>${d.dureeMaxHeures} h</b>. Au-delà de 500 h, l'élection de délégués des stagiaires est obligatoire : la rubrique « Représentation » doit la décrire.</div></div>` : ""}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
      <div><label class="field-label">Version</label><input class="txt ri" data-f="version" value="${esc(r.version || "")}" placeholder="2026-1"></div>
      <div><label class="field-label">Applicable au</label><input class="txt ri" data-f="dateApplication" type="date" value="${esc(r.dateApplication || "")}"></div>
      ${d.mentions.reglement.map(champ).join("")}
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="ri-save">Enregistrer</button></div>`);

  $("#ri-save").onclick = async () => {
    const body = {};
    $$(".ri").forEach((i) => (body[i.dataset.f] = i.value));
    const res = await api.patch("/api/documents-of/reglement", { campusId: dofCampus, reglement: body });
    if (res?.error) { alert(res.error); return; }
    closeModals(); renderDocumentsOf();
  };
}

async function openActeForm(d) {
  const classes = (await api.get("/api/classes")).filter((k) => k.campusId === dofCampus);
  openModal("Convention ou contrat de formation", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Qui finance ?</label>
        <select class="txt" id="ac-payeur">${Object.entries(d.payeurs).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;" id="ac-deduit"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Classe (pour le programme)</label>
        <select class="txt" id="ac-classe"><option value="">—</option>${classes.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;" id="ac-mentions"></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="ac-save">Créer le brouillon</button></div>`);

  // LE POINT CENTRAL DE L'ÉCRAN : le type n'est pas proposé, il est DÉDUIT, et
  // l'interface dit pourquoi. Laisser choisir, c'est laisser se tromper.
  const maj = () => {
    const payeur = $("#ac-payeur").value;
    const type = d.payeurs[payeur].acte;
    const t = d.types[type];
    $("#ac-deduit").innerHTML = `<div class="item" style="border-left:3px solid var(--accent);"><div class="grow">
      <b>${esc(t.label)}</b> <span class="muted">${esc(t.base)}</span>
      <br><span class="muted" style="font-size:13px;">${payeur === "particulier"
        ? "Le bénéficiaire finance lui-même : il bénéficie d'un délai de rétractation de 10 jours, d'un premier versement plafonné à 30 % et d'un remboursement au prorata. Une convention ne porte aucune de ces protections."
        : "L'achat est fait par un tiers : la relation se noue avec l'acheteur."}</span></div></div>`;
    $("#ac-mentions").innerHTML = d.mentions[type].map((m) => `
      <div style="margin-top:8px;"><label class="field-label">${esc(m.label)}${m.protege ? ' <span class="pill p-warn">protège le bénéficiaire</span>' : ""} <span class="muted" style="font-weight:400;">${esc(m.base)}</span></label>
      <input class="txt acm" data-f="${m.cle}" ${["dureeHeures", "effectif", "prix"].includes(m.cle) ? 'type="number" min="0"' : ""}></div>`).join("")
      + `<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        <div><label class="field-label">Début</label><input class="txt acm" data-f="dateDebut" type="date"></div>
        <div><label class="field-label">Fin</label><input class="txt acm" data-f="dateFin" type="date"></div>
        ${type === "contrat" ? '<div><label class="field-label">Date de signature</label><input class="txt acm" data-f="dateSignature" type="date"></div>' : ""}
      </div>
      ${type === "contrat" ? '<div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="ac-ech">Proposer un échéancier conforme</button></div><div id="ac-ech-out"></div>' : ""}`;
    if ($("#ac-ech")) $("#ac-ech").onclick = proposerEcheancier;
  };
  $("#ac-payeur").onchange = maj; maj();

  let echeances = [];
  async function proposerEcheancier() {
    const prix = $(".acm[data-f='prix']")?.value, sig = $(".acm[data-f='dateSignature']")?.value;
    if (!prix || !sig) { alert("Prix et date de signature requis pour calculer le délai de rétractation."); return; }
    const e = await api.get(`/api/actes/echeancier?prix=${prix}&dateSignature=${sig}&nbEcheances=3`);
    if (e?.error) { alert(e.error); return; }
    echeances = e.lignes;
    $("#ac-ech-out").innerHTML = `<div class="card" style="overflow-x:auto;margin-top:8px;"><table class="net-table">
      <thead><tr><th>Rang</th><th>Exigible</th><th>Montant</th><th>Pourquoi</th></tr></thead><tbody>
      ${e.lignes.map((l) => `<tr><td>${l.rang}</td><td>${esc(l.date || "au fil de la formation")}</td><td>${l.montant} €</td><td class="muted" style="font-size:12px;">${esc(l.motif)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  $("#ac-save").onclick = async () => {
    const payeur = $("#ac-payeur").value, type = d.payeurs[payeur].acte;
    const body = { campusId: dofCampus, type, payeur, echeances };
    $$(".acm").forEach((i) => { if (i.value !== "") body[i.dataset.f] = ["dureeHeures", "effectif", "prix"].includes(i.dataset.f) ? +i.value : i.value; });
    const classId = $("#ac-classe").value;
    if (classId) {
      const p = await api.get(`/api/documents-of/programme?classId=${classId}`);
      if (!p?.error) { body.programme = p.programme; body.classId = classId; }
    }
    const r = await api.post("/api/actes", body);
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert("Enregistré. À compléter :\n" + r.warnings.join("\n"));
    closeModals(); renderDocumentsOf();
  };
}

// --- Dossiers RH des intervenants ---
// L'écran ne demande pas « remplissez la fiche » : il dit, champ par champ, ce
// que le manque EMPÊCHE. Une liste de cases à cocher sans conséquence ne se
// remplit jamais.
let rhCampus = "";

async function renderDossiersRh() {
  if (!rhCampus) rhCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/intervenants/dossiers?campusId=${rhCampus}`);

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="rh-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === rhCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.dossiers.length, "intervenants")}${fkpi(d.incomplets, "dossiers incomplets", d.incomplets ? "bad" : "good")}
        ${fkpi(round1(d.dossiers.reduce((a, x) => a + x.volume.heuresAffectees, 0)) + " h", "affectées")}</div>
    </div>
    ${d.incomplets ? `<div class="card card-pad" style="margin-bottom:14px;border-left:4px solid #8A7A4B;">
      <b>${d.incomplets} dossier(s) incomplet(s) : la RH ne peut pas rédiger les contrats correspondants.</b></div>` : ""}
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Intervenant</th><th>Statut</th><th>Matières</th><th>Heures affectées</th><th>Au contrat</th><th>Écart</th><th>Dossier</th><th></th></tr></thead><tbody>
      ${d.dossiers.length ? d.dossiers.map((x) => `<tr>
        <td><b>${esc(x.nom)}</b><br><span class="muted" style="font-size:12px;">${esc(x.email || "—")}</span></td>
        <td>${esc(x.statut || "—")}</td>
        <td>${x.matieres.length ? x.matieres.map(esc).join(", ") : '<span class="pill p-warn">non déclarées</span>'}</td>
        <td><b>${round1(x.volume.heuresAffectees)} h</b>${x.volume.matieres.length ? `<br><span class="muted" style="font-size:12px;">${x.volume.matieres.slice(0, 3).map((m) => `${esc(m.label)} ${round1(m.heures)} h`).join(" · ")}</span>` : ""}</td>
        <td>${x.volume.heuresAuContrat ?? '<span class="muted">—</span>'}</td>
        <td>${x.volume.alerte ? `<span class="pill ${x.volume.alerte.gravite === "important" ? "p-warn" : ""}" title="${esc(x.volume.alerte.message)}">${x.volume.ecart > 0 ? "+" : ""}${x.volume.ecart ?? "?"}</span>` : '<span class="pill p-good">aligné</span>'}</td>
        <td>${x.dossier.complet ? '<span class="pill p-good">complet</span>' : `<span class="pill p-warn">${x.dossier.completude} %</span>`}</td>
        <td><button class="btn-ghost btn-sm rh-fiche" data-id="${x.teacherId}">Fiche RH</button></td>
      </tr>`).join("") : '<tr><td colspan="8" class="muted">Aucun intervenant sur ce campus.</td></tr>'}
      </tbody></table></div>
    <p class="hint muted">Les heures affichées viennent des séances réellement affectées, pas d'une saisie : c'est ce qui garantit que le contrat et l'emploi du temps parlent du même nombre. Un écart positif se paie en heures supplémentaires ou demande un avenant.</p>`;

  $("#rh-campus").onchange = (e) => { rhCampus = e.target.value; renderDossiersRh(); };
  $$(".rh-fiche").forEach((b) => { b.onclick = () => openFicheRh(b.dataset.id); });
}

async function openFicheRh(teacherId) {
  const f = await api.get(`/api/intervenants/${teacherId}/fiche-rh?campusId=${rhCampus}`);
  if (f?.error) { alert(f.error); return; }
  const i = f.intervenant;
  const ligne = (l, v) => `<tr><td class="muted" style="width:45%;">${esc(l)}</td><td>${v}</td></tr>`;
  openModal(`Fiche RH — ${i.nom}`, `
    <p class="muted" style="font-size:13.5px;">${esc(f.reserve)}</p>
    <div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table"><tbody>
      ${ligne("Statut", esc(i.statut || "—") + (i.societe ? ` — ${esc(i.societe)}` : ""))}
      ${ligne("Courriel", esc(i.email || "—"))}
      ${ligne("Téléphone", esc(i.telephone || "—"))}
      ${ligne("Campus", esc(i.campus || "—"))}
      ${i.matricule ? ligne("Matricule paie", esc(i.matricule)) : ""}
      ${ligne("Période", `${esc(f.periode.du || "—")} → ${esc(f.periode.au || "—")}`)}
      ${ligne("<b>Heures à porter au contrat</b>", `<b>${round1(f.volume.heuresAffectees)} h</b>`)}
      ${ligne("Taux horaire", i.tauxHoraire != null ? `${i.tauxHoraire} €` : '<span class="pill p-warn">non renseigné</span>')}
      ${ligne("Coût brut", f.cout.brut != null ? `${f.cout.brut} €` : "—")}
      ${ligne("Coût employeur", f.cout.charge != null ? `<b>${f.cout.charge} €</b>${f.cout.prestataire ? ' <span class="muted">(prestataire : pas de charges patronales)</span>' : ""}`
        : `<span class="muted">${esc(f.cout.motif || "—")}</span>`)}
      ${i.regle ? ligne("Heures payées", esc(i.regle)) : ""}
    </tbody></table></div>
    <div class="section-title">Détail par matière</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Matière</th><th>Séances</th><th>Heures</th></tr></thead><tbody>
      ${f.volume.matieres.length ? f.volume.matieres.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.seances}</td><td>${round1(m.heures)} h</td></tr>`).join("")
        : '<tr><td colspan="3" class="muted">Aucune séance affectée sur la période.</td></tr>'}
      </tbody></table></div>
    ${f.volume.alerte ? `<div class="item" style="border-left:3px solid ${f.volume.alerte.gravite === "important" ? "#8A7A4B" : "var(--border)"};margin-top:10px;"><div class="grow">${esc(f.volume.alerte.message)}</div></div>` : ""}
    ${f.dossier.manquants.length ? `<div class="section-title">À compléter avant rédaction</div>
      <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:13px;">${f.dossier.manquants.map((m) => `<li><b>${esc(m.label)}</b> — ${esc(m.bloque)}</li>`).join("")}</ul>` : ""}
    <div class="section-title">À transmettre à la RH (non conservé ici)</div>
    <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:13px;">${f.dossier.aTransmettre.map((x) => `<li><b>${esc(x.label)}</b> — ${esc(x.pourquoi)}</li>`).join("")}</ul>
    <p class="hint muted">${esc(f.dossier.reserve)}</p>`);
}

// --- Masse horaire face au budget du campus ---
let mhCampus = "";

async function renderMasseHoraire() {
  if (!mhCampus) mhCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/intervenants/masse?campusId=${mhCampus}`);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };
  const eur = (n) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} €`);

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="mh-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === mhCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="kpis" style="margin-bottom:12px;">
      ${fkpi(round1(d.heures) + " h", "heures affectées")}
      ${fkpi(eur(d.cout), "coût employeur")}
      ${fkpi(eur(d.budget), "budget alloué")}
      ${d.consommation != null ? fkpi(d.consommation + " %", "consommé", d.consommation > 100 ? "bad" : "") : ""}
      ${d.avancement != null ? fkpi(Math.round(d.avancement * 100) + " %", "année écoulée") : ""}
      ${d.projection != null ? fkpi(eur(d.projection), "atterrissage projeté", d.budget && d.projection > d.budget ? "bad" : "good") : ""}</div>
    ${d.alertes.map((a) => `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid ${GRAV[a.gravite]};"><b>${esc(a.message)}</b></div>`).join("")}
    ${d.horsContrat ? `<p class="hint muted">${round1(d.horsContrat)} h affectées au-delà des volumes contractuels, tous intervenants confondus.</p>` : ""}
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Intervenant</th><th>Statut</th><th>Heures</th><th>Au contrat</th><th>Brut</th><th>Coût employeur</th></tr></thead><tbody>
      ${d.lignes.length ? d.lignes.map((l) => `<tr>
        <td>${esc(l.nom)}${l.dossierComplet ? "" : ' <span class="pill p-warn">dossier incomplet</span>'}</td>
        <td>${esc(l.statut || "—")}</td>
        <td>${round1(l.heures)} h</td>
        <td>${l.heuresAuContrat ?? '<span class="muted">—</span>'}${l.ecart > 0 ? ` <span class="pill p-warn">+${round1(l.ecart)}</span>` : ""}</td>
        <td>${eur(l.brut)}</td>
        <td>${l.charge != null ? `<b>${eur(l.charge)}</b>` : `<span class="muted" title="${esc(l.motif || "")}">non chiffré</span>`}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="muted">Aucun intervenant.</td></tr>'}
      </tbody></table></div>

    <div class="card card-pad" style="margin-top:14px;">
      <div class="section-title" style="margin-top:0;">Budget et paramètres</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div><label class="field-label">Budget annuel (€)</label><input class="txt" id="mh-budget" type="number" min="0" value="${d.parametres.budgetAnnuel ?? ""}"></div>
        <div><label class="field-label">Coefficient de charges</label><input class="txt" id="mh-coef" type="number" step="0.01" min="1" placeholder="1.42" value="${d.parametres.coefficientCharges ?? ""}"></div>
        <div><label class="field-label">Année du</label><input class="txt" id="mh-du" type="date" value="${esc(d.parametres.anneeDebut || "")}"></div>
        <div><label class="field-label">au</label><input class="txt" id="mh-au" type="date" value="${esc(d.parametres.anneeFin || "")}"></div>
      </div>
      <p class="hint muted" style="margin-top:8px;">Le <b>coefficient de charges</b> transforme un taux horaire brut en coût employeur. Il dépend du statut et de la convention collective : l'application ne le devine pas, et sans lui elle refuse de chiffrer plutôt que d'afficher un brut qui sous-estime la dépense d'environ 40 %. Un prestataire n'en génère pas — sa facture est le coût.</p>
      <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="mh-save">Enregistrer</button></div>
    </div>
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#mh-campus").onchange = (e) => { mhCampus = e.target.value; renderMasseHoraire(); };
  $("#mh-save").onclick = async () => {
    const r = await api.patch("/api/intervenants/masse", { campusId: mhCampus, masse: {
      budgetAnnuel: $("#mh-budget").value === "" ? null : +$("#mh-budget").value,
      coefficientCharges: $("#mh-coef").value === "" ? null : +$("#mh-coef").value,
      anneeDebut: $("#mh-du").value, anneeFin: $("#mh-au").value,
    } });
    if (r?.error) { alert(r.error); return; }
    renderMasseHoraire();
  };
}

// --- LMS ---
// Trois écrans, un seul fil : à distance, l'heure réalisée ne se prouve pas par
// une signature. Ce sont les travaux rendus qui la justifient — jamais les clics.
let lmsCampus = "";

async function renderRessources() {
  if (!lmsCampus) lmsCampus = state.campuses[0]?.id || "";
  const [d, curricula] = await Promise.all([
    api.get(`/api/ressources?campusId=${lmsCampus}`), api.get("/api/curricula"),
  ]);
  const vivantes = d.ressources.filter((r) => !r.archivee);

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="rs-new">+ Ressource</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="rs-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === lmsCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(vivantes.length, "ressources")}${fkpi(vivantes.filter((r) => r.aDistance).length, "activités à distance")}
        ${fkpi(vivantes.filter((r) => d.types[r.type]?.probant).length, "produisent une preuve", vivantes.some((r) => d.types[r.type]?.probant) ? "good" : "bad")}</div>
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Ressource</th><th>Enseignement</th><th>Type</th><th>À distance</th><th>Durée moy.</th><th>Consultée</th><th>Rendus</th><th></th></tr></thead><tbody>
      ${vivantes.length ? vivantes.map((r) => `<tr>
        <td><b>${esc(r.titre)}</b>${r.obligatoire ? ' <span class="pill">obligatoire</span>' : ""}</td>
        <td>${esc(r.moduleLabel || "—")}</td>
        <td>${esc(d.types[r.type]?.label || r.type)}${d.types[r.type]?.probant ? ' <span class="pill p-good">probante</span>' : ""}</td>
        <td>${r.aDistance ? "oui" : "—"}</td>
        <td>${r.dureeMoyenneMinutes ? `${r.dureeMoyenneMinutes} min` : '<span class="muted">—</span>'}</td>
        <td>${r.consultations}</td>
        <td>${d.types[r.type]?.probant ? r.rendus : '<span class="muted">—</span>'}</td>
        <td><button class="btn-ghost btn-sm rs-del" data-id="${r.id}">Archiver</button></td>
      </tr>`).join("") : '<tr><td colspan="8" class="muted">Aucune ressource.</td></tr>'}
      </tbody></table></div>
    <p class="hint muted">Une ressource consultée n'est pas une heure suivie. Seuls les <b>exercices</b> et les <b>évaluations</b> produisent un élément probant, c'est-à-dire de quoi justifier des heures à distance devant un financeur.</p>`;

  $("#rs-campus").onchange = (e) => { lmsCampus = e.target.value; renderRessources(); };
  $("#rs-new").onclick = () => openRessourceForm(d, curricula);
  $$(".rs-del").forEach((b) => { b.onclick = async () => {
    // « Archiver » et non « Supprimer » : les traces pointent dessus.
    if (!confirm("Archiver cette ressource ? Les travaux déjà rendus restent consultables.")) return;
    await api.del(`/api/ressources/${b.dataset.id}`); renderRessources();
  }; });
}

function openRessourceForm(d, curricula) {
  const modules = curricula.flatMap((c) => (c.modules || []).map((m) => ({ id: m.id, label: `${c.name} — ${m.label || m.code}` })));
  openModal("Nouvelle ressource", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Titre</label><input class="txt" id="rs-titre"></div>
      <div><label class="field-label">Enseignement</label><select class="txt" id="rs-module">${modules.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("")}</select></div>
      <div><label class="field-label">Type</label><select class="txt" id="rs-type">${Object.entries(d.types).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Lien</label><input class="txt" id="rs-url" placeholder="https://…"></div>
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="rs-distance"> Activité à effectuer à distance</label></div>
      <div><label class="field-label">Durée moyenne (minutes)</label><input class="txt" id="rs-duree" type="number" min="1"></div>
      <div><label class="field-label">Disponible jusqu'au</label><input class="txt" id="rs-au" type="date"></div>
      <div style="grid-column:1/-1;" id="rs-avert"></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="rs-save">Enregistrer</button></div>`);

  // On dit AVANT d'enregistrer ce que ce choix implique, plutôt que de refuser
  // après coup : la durée moyenne est une condition de l'article D. 6313-3-1.
  const maj = () => {
    const dist = $("#rs-distance").checked, probant = d.types[$("#rs-type").value]?.probant;
    $("#rs-avert").innerHTML = !dist ? ""
      : `<div class="item" style="border-left:3px solid ${probant ? "#4B7A5A" : "#8A7A4B"};"><div class="grow">
        ${probant ? "Cette ressource produira un élément probant : le travail rendu justifiera des heures à distance."
                  : "<b>Ce type ne produit pas d'élément probant.</b> Seule la consultation sera tracée, ce qui ne justifie aucune heure devant un financeur."}
        <br><span class="muted" style="font-size:12.5px;">La durée moyenne est obligatoire pour une activité à distance (art. D. 6313-3-1).</span></div></div>`;
  };
  $("#rs-distance").onchange = maj; $("#rs-type").onchange = maj; maj();

  $("#rs-save").onclick = async () => {
    const r = await api.post("/api/ressources", {
      campusId: lmsCampus, titre: $("#rs-titre").value, moduleId: $("#rs-module").value,
      type: $("#rs-type").value, url: $("#rs-url").value,
      aDistance: $("#rs-distance").checked,
      dureeMoyenneMinutes: $("#rs-duree").value === "" ? null : +$("#rs-duree").value,
      disponibleAu: $("#rs-au").value || null, classIds: [],
    });
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert(r.warnings.join("\n"));
    closeModals(); renderRessources();
  };
}

async function renderSuiviDistance() {
  if (!lmsCampus) lmsCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/lms/suivi?campusId=${lmsCampus}`);
  const PILL = { travail: "p-good", consultation: "p-warn", aucun: "p-bad" };

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="sd-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === lmsCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="kpis" style="margin-bottom:12px;">${fkpi(d.nbSeances, "séances à distance")}
      ${fkpi(d.justifiees, "participations justifiées", "good")}
      ${fkpi(d.consultationSeule, "consultation seule", d.consultationSeule ? "bad" : "")}
      ${fkpi(d.sansTrace, "sans aucune trace", d.sansTrace ? "bad" : "")}
      ${d.taux != null ? fkpi(d.taux + " %", "justifiable", d.taux >= 80 ? "good" : "bad") : ""}</div>
    ${d.risque ? `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid #8A4B4B;"><b>${esc(d.risque)}</b>
      <p class="muted" style="margin:8px 0 0;font-size:13px;">Une consultation atteste d'un accès, pas d'un temps de formation. Ce sont les travaux rendus et les évaluations qui justifient des heures.</p></div>` : ""}
    ${d.seances.length ? d.seances.map((s) => `<div class="card card-pad" style="margin-bottom:12px;">
      <div class="row" style="gap:8px;align-items:center;">
        <b class="grow">${esc(s.date || "—")} <span class="muted" style="font-weight:400;">${esc(s.modalite)}</span></b>
        <span class="muted">${s.justifies}/${s.inscrits} justifié(s)</span>
      </div>
      <div style="margin-top:8px;">${s.lignes.map((l) => `<div class="row" style="gap:8px;padding:4px 0;border-top:1px solid var(--border);">
        <span class="grow">${esc(l.nom)}</span>
        <span class="muted" style="font-size:12px;">${l.travaux ? `${l.travaux} travail/travaux` : l.consultations ? `${l.consultations} consultation(s)` : "—"}</span>
        <span class="pill ${PILL[l.niveau]}">${esc(d.niveaux[l.niveau].label)}</span>
      </div>`).join("")}</div>
      <p class="hint muted" style="margin-top:8px;">${esc(s.reserve)}</p>
    </div>`).join("") : '<div class="card card-pad"><p class="muted">Aucune séance à distance sur la période. Une séance devient « à distance » depuis sa fiche dans l\'emploi du temps.</p></div>'}`;

  $("#sd-campus").onchange = (e) => { lmsCampus = e.target.value; renderSuiviDistance(); };
}

async function renderDispositifFoad() {
  if (!lmsCampus) lmsCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/lms/dispositif?campusId=${lmsCampus}`);

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="fo-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === lmsCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.seancesDistance, "séances à distance")}${fkpi(d.elementsProbants, "activités probantes", d.elementsProbants ? "good" : "bad")}</div>
    </div>
    <div class="card card-pad" style="margin-bottom:14px;border-left:4px solid ${d.conforme ? "#4B7A5A" : "#8A4B4B"};">
      <b>${d.conforme ? "Les trois composantes de l'action à distance sont couvertes." : "Le dispositif à distance est incomplet."}</b>
      <p class="muted" style="margin:8px 0 0;font-size:13px;">L'article D. 6313-3-1 du code du travail pose trois conditions à une action de formation à distance. Ce ne sont pas des bonnes pratiques : sans elles, les heures à distance ne sont pas justifiables.</p>
    </div>
    ${d.composantes.map((c) => `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid ${c.couverte ? "#4B7A5A" : "#8A4B4B"};">
      <div class="row" style="gap:8px;align-items:center;">
        <b class="grow">${esc(c.label)}</b>
        <span class="pill ${c.couverte ? "p-good" : "p-bad"}">${c.couverte ? "couverte" : "à compléter"}</span>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:13px;">${esc(c.texte)}</p>
      ${c.manques.map((m) => `<div class="item" style="border-left:3px solid ${m.gravite === "bloquant" ? "#8A4B4B" : "#8A7A4B"};margin-top:8px;"><div class="grow">${esc(m.message)}</div></div>`).join("")}
    </div>`).join("")}
    <div class="card card-pad">
      <div class="section-title" style="margin-top:0;">Référent pédagogique et assistance</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
        <div><label class="field-label">Référent pédagogique</label><input class="txt" id="fo-ref" value="${esc(d.dispositif.referentPedagogique || "")}"></div>
        <div><label class="field-label">Modalités d'assistance</label><input class="txt" id="fo-mod" placeholder="Par courriel sous 24 h ouvrées, permanence le mardi…" value="${esc(d.dispositif.modalitesAssistance || "")}"></div>
      </div>
      <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="fo-save">Enregistrer</button> <span id="fo-msg" class="status"></span></div>
    </div>
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#fo-campus").onchange = (e) => { lmsCampus = e.target.value; renderDispositifFoad(); };
  $("#fo-save").onclick = async () => {
    const r = await api.patch("/api/lms/dispositif", {
      campusId: lmsCampus, referentPedagogique: $("#fo-ref").value, modalitesAssistance: $("#fo-mod").value,
    });
    if (r?.error) { alert(r.error); return; }
    renderDispositifFoad();
  };
}

// --- Présentation à la certification (indicateur 16) ---
// Le manquement que cet écran sert à voir venir : une habilitation qui expire
// AVANT l'épreuve. Elle est valable aujourd'hui, elle ne le sera plus en juin,
// et c'est toute la promotion qui ne passe pas.
let certifCampus = "";

async function renderCertification() {
  if (!certifCampus) certifCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/certifications?campusId=${certifCampus}`);
  const ETAT_PILL = { valide: "p-good", expire: "p-bad", suspendue: "p-bad", a_declarer: "p-warn" };
  const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="cf-new">+ Certification</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="cf-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === certifCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div class="kpis">${fkpi(d.total, "certifications")}${fkpi(d.empechees, "ne peuvent pas être présentées", d.empechees ? "bad" : "good")}</div>
    </div>
    ${d.lignes.length ? d.lignes.map((l) => `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid ${l.bloquants ? "#8A4B4B" : "#4B7A5A"};">
      <div class="row" style="gap:8px;align-items:center;">
        <h3 class="grow" style="margin:0;color:var(--marine);">${esc(l.intitule || "Sans intitulé")}${l.codeRncp ? ` <span class="muted" style="font-weight:400;font-size:13px;">RNCP ${esc(l.codeRncp)}</span>` : ""}</h3>
        <span class="pill ${ETAT_PILL[l.etat] || ""}">${esc(d.etats[l.etat] || l.etat)}</span>
        <button class="btn-ghost btn-sm cf-edit" data-id="${esc(l.curriculumId || "")}">Modifier</button>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:13px;">${esc(l.regimeLabel)}${l.restant != null && l.restant >= 0 ? ` — valable encore ${l.restant} jour(s)` : ""}</p>
      ${l.alertes.map((a) => `<div class="item" style="border-left:3px solid ${GRAV[a.gravite]};margin-top:8px;"><div class="grow">${esc(a.message)}</div></div>`).join("")}
      ${l.sessions.length ? `<div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table">
        <thead><tr><th>Épreuve</th><th>Inscription avant</th><th>Déposée</th><th>Exigences</th><th>État</th></tr></thead><tbody>
        ${l.sessions.map((s) => `<tr>
          <td>${esc(s.dateEpreuve || "—")}</td><td>${esc(s.dateLimiteInscription || "—")}</td>
          <td>${s.alertes.some((a) => a.code === "inscription_manquee") ? '<span class="pill p-bad">manquée</span>' : esc(s.dateLimiteInscription && s.manquantes === 0 ? "oui" : "—")}</td>
          <td>${s.exigences.length ? `${s.exigences.length - s.manquantes}/${s.exigences.length}` : '<span class="muted">aucune déclarée</span>'}</td>
          <td>${s.presentable ? '<span class="pill p-good">présentable</span>' : `<span class="pill p-bad">${s.bloquants} blocage(s)</span>`}</td>
        </tr>`).join("")}</tbody></table></div>` : ""}
    </div>`).join("") : `<div class="card card-pad"><b>Aucune certification déclarée.</b>
      <p class="muted" style="margin:8px 0 0;font-size:13px;">Tant que le régime de présentation n'est pas déclaré, personne ne sait si cet organisme peut présenter ses candidats — ni sous quel régime, ni jusqu'à quand.</p></div>`}
    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#cf-campus").onchange = (e) => { certifCampus = e.target.value; renderCertification(); };
  $("#cf-new").onclick = () => openCertificationForm(d);
}

async function openCertificationForm(d, existante = null) {
  const curricula = await api.get("/api/curricula");
  const h = existante?.habilitation || {};
  openModal(existante ? "Modifier la certification" : "Déclarer une certification", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Référentiel</label>
        <select class="txt" id="cf-cur">${curricula.map((c) => `<option value="${c.id}" ${existante?.curriculumId === c.id ? "selected" : ""}>${esc(c.name)}${c.codeRncp ? ` — RNCP ${esc(c.codeRncp)}` : ""}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Régime de présentation</label>
        <select class="txt" id="cf-regime">${Object.entries(d.regimes).map(([k, r]) => `<option value="${k}" ${h.regime === k ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
        <p class="hint muted" id="cf-preuve" style="margin-top:4px;"></p></div>
      <div><label class="field-label">Autorité de certification</label><input class="txt" id="cf-certificateur" value="${esc(h.certificateur || "")}"></div>
      <div><label class="field-label">Référence (notification, convention)</label><input class="txt" id="cf-ref" value="${esc(h.reference || "")}"></div>
      <div><label class="field-label">Valable du</label><input class="txt" id="cf-debut" type="date" value="${esc(h.dateDebut || "")}"></div>
      <div><label class="field-label">Valable jusqu'au</label><input class="txt" id="cf-fin" type="date" value="${esc(h.dateFin || "")}"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Exigences formelles du certificateur (une par ligne)</label>
        <textarea class="txt" id="cf-exigences" rows="4" placeholder="Livret de suivi visé par le maître d'apprentissage&#10;Dossier professionnel déposé sur la plateforme">${esc((h.exigences || []).map((e) => e.libelle).join("\n"))}</textarea>
        <p class="hint muted" style="margin-top:4px;">Saisissez ce que le certificateur VOUS a notifié. L'application ne les connaît pas : les inventer produirait une liste fausse présentée comme réglementaire.</p></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="cf-save">Enregistrer</button></div>`);

  const majPreuve = () => { $("#cf-preuve").textContent = `Se prouve par : ${d.regimes[$("#cf-regime").value]?.preuve || ""}`; };
  $("#cf-regime").onchange = majPreuve; majPreuve();

  $("#cf-save").onclick = async () => {
    const exigences = $("#cf-exigences").value.split("\n").map((s) => s.trim()).filter(Boolean)
      .map((libelle, i) => ({ id: `e${i + 1}`, libelle }));
    const corps = {
      campusId: certifCampus, curriculumId: $("#cf-cur").value,
      habilitation: {
        regime: $("#cf-regime").value, certificateur: $("#cf-certificateur").value,
        reference: $("#cf-ref").value, dateDebut: $("#cf-debut").value, dateFin: $("#cf-fin").value,
        exigences,
      },
    };
    const r = existante ? await api.patch(`/api/certifications/${existante.id}`, corps)
                        : await api.post("/api/certifications", corps);
    if (r?.error) { alert(r.error); return; }
    closeModals(); renderCertification();
  };
}

// --- Actions d'insertion et de poursuite d'études (indicateur 29) ---
// L'écran insiste sur la moitié oubliée : beaucoup d'organismes ne documentent
// que l'emploi et se font reprendre sur la poursuite d'études.
let insCampus = "";

async function renderInsertionActions() {
  if (!insCampus) insCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/actions-insertion?campusId=${insCampus}`);

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="ia-new">+ Action</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="ia-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === insCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:14px;">
      ${d.voies.map((v) => `<div class="card card-pad" style="border-left:4px solid ${v.couvert ? "#4B7A5A" : "#8A7A4B"};">
        <div class="section-title" style="margin-top:0;">${esc(v.label)}</div>
        <div class="kpis">${fkpi(v.total, "actions")}${fkpi(v.avecResultat, "avec résultat", v.avecResultat ? "good" : "bad")}${fkpi(v.participants, "participants")}</div>
        ${v.manque ? `<p class="muted" style="margin:8px 0 0;font-size:13px;">${esc(v.manque)}</p>` : '<p class="muted" style="margin:8px 0 0;font-size:13px;">Rien à signaler.</p>'}
      </div>`).join("")}
    </div>
    <p class="hint muted" style="margin-bottom:14px;">${esc(d.reserve)}</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Date</th><th>Action</th><th>Type</th><th>Visée</th><th>Participants</th><th>Résultat</th><th></th></tr></thead><tbody>
      ${d.actions.length ? d.actions.map((a) => `<tr>
        <td>${esc(a.date || "—")}</td><td><b>${esc(a.intitule)}</b></td>
        <td>${esc(d.types[a.type]?.label || a.type)}</td>
        <td>${esc(d.visees[a.vise || d.types[a.type]?.vise] || "—")}</td>
        <td>${a.participants ?? "—"}</td>
        <td>${a.resultat ? esc(a.resultat) : '<span class="pill p-warn">non renseigné</span>'}</td>
        <td><button class="btn-ghost btn-sm ia-del" data-id="${a.id}">Supprimer</button></td>
      </tr>`).join("") : '<tr><td colspan="7" class="muted">Aucune action enregistrée.</td></tr>'}
      </tbody></table></div>`;

  $("#ia-campus").onchange = (e) => { insCampus = e.target.value; renderInsertionActions(); };
  $("#ia-new").onclick = () => openActionInsertionForm(d);
  $$(".ia-del").forEach((b) => { b.onclick = async () => {
    if (!confirm("Supprimer cette action ?")) return;
    await api.del(`/api/actions-insertion/${b.dataset.id}`); renderInsertionActions();
  }; });
}

function openActionInsertionForm(d) {
  openModal("Action d'insertion ou de poursuite d'études", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Intitulé</label><input class="txt" id="ia-titre" placeholder="Forum entreprises de printemps"></div>
      <div><label class="field-label">Type</label><select class="txt" id="ia-type">${Object.entries(d.types).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select></div>
      <div><label class="field-label">Date</label><input class="txt" id="ia-date" type="date"></div>
      <div><label class="field-label">Visée</label><select class="txt" id="ia-vise"><option value="">— celle du type —</option>${Object.entries(d.visees).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
      <div><label class="field-label">Participants</label><input class="txt" id="ia-part" type="number" min="0"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Résultat</label><input class="txt" id="ia-res" placeholder="12 contrats signés, 8 dossiers de poursuite déposés…">
        <p class="hint muted" style="margin-top:4px;">C'est ce champ qui sépare une action d'un événement. Une action dont on ne sait pas ce qu'elle a produit ne démontre rien en audit.</p></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="ia-save">Enregistrer</button></div>`);

  $("#ia-save").onclick = async () => {
    const r = await api.post("/api/actions-insertion", {
      campusId: insCampus, intitule: $("#ia-titre").value, type: $("#ia-type").value,
      date: $("#ia-date").value, vise: $("#ia-vise").value || null,
      participants: $("#ia-part").value === "" ? null : +$("#ia-part").value,
      resultat: $("#ia-res").value,
    });
    if (r?.error) { alert(r.error); return; }
    if (r.warnings?.length) alert(r.warnings.join("\n"));
    closeModals(); renderInsertionActions();
  };
}

// --- Chantier 2026 ---
// Trois dispositifs ont été ajoutés en septembre 2026. Être dans l'application
// ne veut pas dire être en service : un rythme jamais posé, un campus resté sur
// l'ancien référentiel et une enquête jamais ouverte laissent exactement les
// mêmes trous qu'avant. Cet écran ne raconte pas ce qui a été développé — il dit
// ce qui reste à faire, et ce que ça coûte de ne pas le faire.
let chCampus = "";

async function renderChantier() {
  if (!chCampus) chCampus = state.campuses[0]?.id || "";
  const d = await api.get(`/api/chantier?campusId=${chCampus}`);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }

  const pastille = (c) => c.sansObjet ? '<span class="pill">sans objet</span>'
    : c.fait ? '<span class="pill p-good">en service</span>'
    : '<span class="pill p-warn">à faire</span>';
  const bord = (c) => c.sansObjet ? "var(--border)" : c.fait ? "#4B7A5A" : "#8A7A4B";

  // Le détail par chantier : ce qui se voit, pas un résumé.
  const corps = (c) => {
    if (c.cle === "alternance") {
      if (c.sansObjet) return "";
      return `<div style="margin-top:10px;">${c.detail.map((k) => `<div class="row" style="gap:8px;padding:5px 0;border-top:1px solid var(--border);">
        <span class="grow">${esc(k.nom)}</span>
        ${k.rythme ? `<span class="muted">${esc(k.rythme)} · ${k.semaines} sem. en centre</span>` : '<span class="pill p-warn">aucun rythme</span>'}
      </div>`).join("")}</div>`;
    }
    if (c.cle === "qualiopi") {
      if (c.fait) return "";
      return `<div style="margin-top:10px;">
        ${c.aRefaire != null ? `<div class="kpis">${fkpi(c.aRefaire, "indicateurs à reprendre", "bad")}${fkpi(c.nouveaux.length, "sans équivalent", "bad")}${c.jours != null ? fkpi(c.jours + " j", "avant échéance", c.jours <= 60 ? "bad" : "") : ""}</div>` : ""}
        ${c.nouveaux.length ? `<p class="muted" style="margin:8px 0 0;font-size:13px;">Exigences nouvelles : n° ${c.nouveaux.join(", ")}.</p>` : ""}</div>`;
    }
    if (c.cle === "cpf") {
      if (c.sansObjet) return "";
      return `<div style="margin-top:10px;"><div class="kpis">
        ${fkpi(`${c.eligibles}/${c.offres}`, "offres éligibles", c.eligibles === c.offres ? "good" : "bad")}
        ${fkpi(c.dossiers, "dossiers")}${fkpi(c.aDeclarer, "à déclarer", c.aDeclarer ? "bad" : "")}</div></div>`;
    }
    if (c.cle === "commerce") {
      return `<div style="margin-top:10px;">
        <div class="kpis">${fkpi(`${c.publiees}/${c.offres}`, "offres publiées")}
          ${fkpi(c.invalides, "publiées à tort", c.invalides ? "bad" : "good")}
          ${fkpi(c.devisEnCours, "devis en cours")}
          ${fkpi(c.devisBloquants, "acceptés sans acte", c.devisBloquants ? "bad" : "good")}</div>
        ${c.sansDelaiAcces ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px;">${c.sansDelaiAcces} offre(s) sans délai d'accès — c'est l'écart le plus fréquemment relevé.</p>` : ""}</div>`;
    }
    if (c.cle === "contrats") {
      if (c.sansObjet) return "";
      return `<div style="margin-top:10px;">
        <div class="kpis">${fkpi(c.actifs, "en cours")}${fkpi(c.echus, "échus", c.echus ? "bad" : "")}
          ${fkpi(c.sansContrat, "sans contrat", c.sansContrat ? "bad" : "good")}</div>
        ${c.risques.length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:12.5px;">${c.risques.map((r) => `<li>${esc(r.message)}</li>`).join("")}</ul>` : ""}</div>`;
    }
    if (c.cle === "documents") {
      return `<div style="margin-top:10px;">
        <div class="kpis">${fkpi(c.reglement ? "oui" : "non", "règlement établi", c.reglement ? "good" : "bad")}
          ${c.remisesTaux != null ? fkpi(c.remisesTaux + " %", "remis aux inscrits", c.remisesTaux === 100 ? "good" : "bad") : ""}
          ${fkpi(`${c.signes}/${c.actes}`, "actes signés", c.actes && c.signes === c.actes ? "good" : "bad")}</div>
        ${c.points.length ? `<div style="margin-top:8px;">${c.points.map((p) => `<div class="row" style="gap:8px;padding:4px 0;border-top:1px solid var(--border);">
          <span class="grow">${esc(p.label)}</span><span class="pill ${p.gravite === "bloquant" ? "p-bad" : "p-warn"}">${esc(p.gravite)}</span></div>`).join("")}</div>` : ""}</div>`;
    }
    if (c.cle === "distance") {
      if (c.sansObjet) return "";
      return `<div style="margin-top:10px;">
        <div class="kpis">${fkpi(c.seances, "séances à distance")}${fkpi(c.ressources, "ressources")}
          ${c.tauxJustifie != null ? fkpi(c.tauxJustifie + " %", "justifiable", c.tauxJustifie === 100 ? "good" : "bad") : ""}</div>
        <div style="margin-top:8px;">${c.composantes.map((x) => `<div class="row" style="gap:8px;padding:4px 0;border-top:1px solid var(--border);">
          <span class="grow">${esc(x.label)}</span>
          <span class="pill ${x.couverte ? "p-good" : "p-bad"}">${x.couverte ? "couverte" : "à compléter"}</span></div>`).join("")}</div></div>`;
    }
    return `<div style="margin-top:10px;">${c.lignes.map((l) => `<div style="padding:6px 0;border-top:1px solid var(--border);">
      <div class="row" style="gap:8px;"><b class="grow">${esc(l.label)}</b>
        <span class="muted" style="font-size:12px;">indicateur ${l.indicateur}</span>
        ${l.couvert ? '<span class="pill p-good">couvert</span>' : '<span class="pill p-warn">incomplet</span>'}</div>
      ${l.manques.length ? `<ul style="margin:4px 0 0;padding-left:18px;color:var(--muted);font-size:12.5px;">${l.manques.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    </div>`).join("")}</div>`;
  };

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="ch-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === chCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <span style="flex:1"></span>
      <div style="flex:none;text-align:right;">
        <div class="field-label">Référentiel à 33 indicateurs</div>
        <div style="font-size:13px;" class="${d.jours != null && d.jours <= 60 ? "neg" : "muted"}">
          ${d.jours == null ? esc(d.bascule) : d.jours > 0 ? `applicable le ${esc(d.bascule)} — dans ${d.jours} jour(s)` : `applicable depuis le ${esc(d.bascule)}`}</div>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;border-left:4px solid ${d.pret ? "#4B7A5A" : "#8A7A4B"};">
      <b>${d.pret ? "Les trois dispositifs sont en service sur ce campus."
        : `${d.restants} chantier(s) à mettre en service sur ce campus.`}</b>
      <p class="muted" style="margin:8px 0 0;font-size:13px;">Trois dispositifs ajoutés en septembre 2026. Ils restent accessibles depuis leur écran habituel — le rythme depuis l'emploi du temps, la bascule depuis Qualiopi : ce menu les rassemble pour les piloter, il ne les déplace pas.</p>
    </div>

    ${d.chantiers.map((c) => `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid ${bord(c)};">
      <div class="row" style="gap:8px;align-items:center;">
        <h3 class="grow" style="margin:0;color:var(--marine);">${esc(c.titre)}</h3>
        ${pastille(c)}
        <button class="btn-ghost btn-sm ch-go" data-ecran="${esc(c.ecran)}">Ouvrir l'écran</button>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:13px;">${esc(c.enjeu)}</p>
      ${corps(c)}
    </div>`).join("")}

    <p class="hint muted">${esc(d.reserve)}</p>`;

  $("#ch-campus").onchange = (e) => { chCampus = e.target.value; renderChantier(); };
  $$(".ch-go").forEach((b) => {
    b.onclick = () => {
      // On emmène le campus choisi avec soi : arriver sur Qualiopi en ayant
      // perdu le campus qu'on inspectait obligerait à le resélectionner.
      const ecran = b.dataset.ecran;
      if (ecran === "qualiopi") qCampus = chCampus;
      if (ecran === "enquetes") enqCampus = chCampus;
      if (ecran === "planning") planState.campusId = chCampus;
      setView(ecran);
    };
  });
}

// --- Enquêtes : satisfaction (indicateur 30) et enseignements (indicateur 33) ---
// Les deux dispositifs doivent rester distincts. L'écran les présente côte à
// côte pour que ce soit visible, et refuse de les confondre.
let enqCampus = "", enqModeles = null;

async function renderEnquetes() {
  if (!enqCampus) enqCampus = state.campuses[0]?.id || "";
  if (!enqModeles) enqModeles = await api.get("/api/enquetes/modeles");
  const [liste, dispositif] = await Promise.all([
    api.get(`/api/enquetes?campusId=${enqCampus}`),
    api.get(`/api/enquetes/dispositif?campusId=${enqCampus}`),
  ]);
  const ETAT_PILL = { brouillon: "", ouverte: "p-warn", close: "p-good" };

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="enq-new">+ Enquête</button>`;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="enq-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === enqCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:14px;">
      ${dispositif.lignes.map((l) => `<div class="card card-pad" style="border-left:4px solid ${l.couvert ? "#4B7A5A" : "#8A7A4B"};">
        <div class="section-title" style="margin-top:0;">${esc(l.label)}</div>
        <p class="muted" style="margin:4px 0 8px;font-size:12.5px;">Indicateur ${l.indicateur} du référentiel national qualité</p>
        <div class="kpis">${fkpi(l.total, "campagnes")}${fkpi(l.closes, "closes")}${fkpi(l.exploitees, "exploitées", l.exploitees ? "good" : "bad")}</div>
        ${l.manques.length ? `<ul style="margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:13px;">${l.manques.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : '<p class="muted" style="margin:10px 0 0;font-size:13px;">Rien à signaler.</p>'}
      </div>`).join("")}
    </div>
    <p class="hint muted" style="margin-bottom:14px;">${esc(dispositif.reserve)}</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Enquête</th><th>Dispositif</th><th>État</th><th>Participation</th><th>Suites</th><th></th></tr></thead><tbody>
      ${liste.length ? liste.map((e) => `<tr>
        <td><b>${esc(e.titre)}</b><br><span class="muted" style="font-size:12px;">${esc(e.dateOuverture || "non ouverte")}</span></td>
        <td>${esc(enqModeles.types.find((t) => t.cle === e.type)?.label || e.type)}</td>
        <td><span class="pill ${ETAT_PILL[e.etat] || ""}">${esc(enqModeles.etats[e.etat] || e.etat)}</span></td>
        <td>${e.invites ? `${e.repondus}/${e.invites} <span class="muted">(${Math.round((e.repondus / e.invites) * 100)} %)</span>` : '<span class="muted">—</span>'}</td>
        <td>${(e.mesures || []).length} mesure(s)${e.restitutionLe ? `<br><span class="muted" style="font-size:12px;">restitué le ${esc(e.restitutionLe)}</span>` : ""}</td>
        <td><button class="btn-ghost btn-sm enq-open" data-id="${e.id}">Ouvrir</button></td>
      </tr>`).join("") : '<tr><td colspan="6" class="muted">Aucune enquête. Les deux dispositifs sont exigés par le référentiel : un questionnaire unique n\'en couvre aucun.</td></tr>'}
      </tbody></table></div>`;

  $("#enq-campus").onchange = (e) => { enqCampus = e.target.value; renderEnquetes(); };
  $("#enq-new").onclick = () => openEnqueteForm();
  $$(".enq-open").forEach((b) => { b.onclick = () => openEnquete(liste.find((x) => x.id === b.dataset.id)); });
}

async function openEnqueteForm() {
  const classes = (await api.get("/api/classes")).filter((k) => k.campusId === enqCampus);
  const t0 = enqModeles.types[0];
  openModal("Nouvelle enquête", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Dispositif</label>
        <select class="txt" id="eq-type">${enqModeles.types.map((t) => `<option value="${t.cle}">${esc(t.label)} — indicateur ${t.indicateur}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Titre</label><input class="txt" id="eq-titre" placeholder="Évaluation des enseignements — semestre 1"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Consigne (facultative)</label><input class="txt" id="eq-consigne" placeholder="Affichée en tête du questionnaire"></div>
      <div><label class="field-label">Classe</label><select class="txt" id="eq-classe"><option value="">— toutes —</option>${classes.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Destinataires</label><div id="eq-publics" class="row" style="flex-wrap:wrap;gap:10px;"></div></div>
    </div>
    <div id="eq-apercu" style="margin-top:12px;"></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="eq-save">Créer le brouillon</button></div>`);

  // Le type pilote tout le reste : publics autorisés, questionnaire de départ,
  // et obligation de désigner une classe.
  const majType = () => {
    const t = enqModeles.types.find((x) => x.cle === $("#eq-type").value) || t0;
    $("#eq-publics").innerHTML = t.publics.map((p) => `<label class="jal-chk"><input type="checkbox" class="eq-pub" value="${p}" ${p === "apprenant" ? "checked" : ""}> ${esc(enqModeles.publics[p])}</label>`).join("");
    $("#eq-apercu").innerHTML = `<p class="muted" style="font-size:13px;">Questionnaire de départ (${t.modele.length} questions, modifiables ensuite) :</p>
      <ol style="margin:6px 0 0;padding-left:20px;color:var(--muted);font-size:13px;">${t.modele.map((q) => `<li>${esc(q.texte)} <span class="pill">${esc(enqModeles.questionTypes[q.type].label)}</span></li>`).join("")}</ol>`;
    $("#eq-classe").parentElement.style.opacity = t.cle === "enseignements" ? "1" : ".6";
  };
  $("#eq-type").onchange = majType;
  majType();

  $("#eq-save").onclick = async () => {
    const t = enqModeles.types.find((x) => x.cle === $("#eq-type").value);
    const r = await api.post("/api/enquetes", {
      campusId: enqCampus, type: t.cle, titre: $("#eq-titre").value,
      consigne: $("#eq-consigne").value, classId: $("#eq-classe").value || null,
      publics: $$(".eq-pub").filter((c) => c.checked).map((c) => c.value),
      questions: t.modele,
    });
    if (r?.error) { alert(r.error); return; }
    closeModals(); renderEnquetes();
  };
}

async function openEnquete(e) {
  const res = e.etat === "brouillon" ? null : await api.get(`/api/enquetes/${e.id}/resultats`);
  const estEns = e.type === "enseignements";
  openModal(e.titre, `
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;">
      <span class="pill">${esc(enqModeles.types.find((t) => t.cle === e.type)?.label || e.type)}</span>
      <span class="pill">${esc(enqModeles.etats[e.etat] || e.etat)}</span>
      <span style="flex:1"></span>
      ${e.etat === "brouillon" ? '<button class="btn-primary btn-sm" id="eq-ouvrir">Ouvrir et générer les liens</button>' : ""}
      ${e.etat === "ouverte" ? '<button class="btn-ghost btn-sm" id="eq-clore">Clore</button>' : ""}
    </div>
    <div id="eq-corps" style="margin-top:12px;">
    ${res ? `
      <div class="kpis">${fkpi(`${res.repondus}/${res.invites}`, "réponses")}${fkpi(res.participation + " %", "participation", res.participation >= 30 ? "good" : "bad")}
        ${res.noteGlobale != null ? fkpi(res.noteGlobale + "/5", "note globale") : ""}</div>
      ${res.participation != null && res.participation < 30 ? '<p class="hint muted" style="margin-top:8px;">Une participation faible est regardée en audit : un recueil auquel presque personne ne répond ne démontre pas grand-chose.</p>' : ""}
      ${res.questions.map((q) => `<div class="card card-pad" style="margin-top:10px;">
        <b>${esc(q.texte)}</b> <span class="muted" style="font-size:12px;">— ${q.repondu} réponse(s)</span>
        ${q.moyenne != null ? `<div style="margin-top:6px;">Moyenne <b>${q.moyenne}/5</b> — ${q.distribution.map((d) => `${d.note}★ : ${d.n}`).join(" · ")}</div>` : ""}
        ${q.tauxOui != null ? `<div style="margin-top:6px;"><b>${q.tauxOui} %</b> de oui (${q.oui}/${q.repondu})</div>` : ""}
        ${q.verbatims?.length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:13px;">${q.verbatims.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}
      </div>`).join("")}
      ${estEns && res.parEnseignement ? `<div class="section-title">Par enseignement</div>
        <p class="muted" style="font-size:13px;margin:0 0 8px;">Évaluer un enseignement, c'est évaluer quelqu'un. Sous ${res.seuilRestitution} réponses, aucun résultat nominatif n'est affiché : la personne évaluée reconnaîtrait qui a répondu quoi.</p>
        <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Enseignement</th><th>Intervenant</th><th>Réponses</th><th>Note</th></tr></thead><tbody>
        ${res.parEnseignement.map((g) => `<tr><td>${esc(g.module || "—")}</td><td>${esc(g.intervenant || "—")}</td><td>${g.repondu}</td>
          <td>${g.publiable ? `<b>${g.note}/5</b>` : `<span class="muted" title="${esc(g.motif)}">non restitué</span>`}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
    ` : '<p class="muted">Enquête en brouillon : le questionnaire peut encore être modifié. Une fois ouverte, il sera figé — les réponses déjà reçues porteraient sinon sur un autre questionnaire.</p>'}
    </div>
    ${e.etat === "close" ? `
      <div class="section-title">Suites données</div>
      <p class="muted" style="font-size:13px;margin:0 0 8px;">C'est ce que l'audit cherche : un recueil sans suite est un recueil, pas une démarche qualité.</p>
      ${(e.mesures || []).length ? `<ul style="margin:0 0 10px;padding-left:18px;">${e.mesures.map((m) => `<li>${esc(m.texte)}${m.responsable ? ` <span class="muted">— ${esc(m.responsable)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="muted">Aucune mesure enregistrée.</p>'}
      <div class="row" style="gap:8px;"><input class="txt" id="eq-mesure" placeholder="Mesure d'amélioration décidée" style="flex:1;"><button class="btn-ghost btn-sm" id="eq-add-mesure">Ajouter</button></div>
      ${estEns ? `<div class="actions" style="margin-top:10px;">
        ${e.restitutionLe ? `<span class="muted">Restitué aux équipes pédagogiques le ${esc(e.restitutionLe)}.</span>`
          : '<button class="btn-primary btn-sm" id="eq-restit">Enregistrer la restitution aux équipes pédagogiques</button>'}</div>` : ""}
    ` : ""}`);

  if ($("#eq-ouvrir")) $("#eq-ouvrir").onclick = async () => {
    const r = await api.post(`/api/enquetes/${e.id}/ouvrir`, {});
    if (r?.error) { alert(r.error); return; }
    // Les liens ne sont disponibles qu'ici : seule leur empreinte est conservée.
    // Les perdre oblige à rouvrir une campagne, donc on les affiche franchement.
    $("#eq-corps").innerHTML = `<p><b>${r.invites} lien(s) individuel(s) générés.</b> Ils ne seront <b>plus affichés après cette fenêtre</b> : seule leur empreinte est conservée, pour qu'une copie de la base ne permette pas de répondre à la place de quelqu'un.</p>
      <textarea class="txt" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:12px;" readonly>${esc(r.liens.map((l) => l.url).join("\n"))}</textarea>
      <div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="eq-copier">Copier les liens</button></div>`;
    $("#eq-copier").onclick = () => { navigator.clipboard.writeText(r.liens.map((l) => l.url).join("\n")); $("#eq-copier").textContent = "Copié"; };
  };
  if ($("#eq-clore")) $("#eq-clore").onclick = async () => {
    await api.post(`/api/enquetes/${e.id}/clore`, {}); closeModals(); renderEnquetes();
  };
  if ($("#eq-add-mesure")) $("#eq-add-mesure").onclick = async () => {
    const texte = $("#eq-mesure").value.trim();
    if (!texte) return;
    const r = await api.post(`/api/enquetes/${e.id}/mesures`, { texte });
    if (r?.error) { alert(r.error); return; }
    closeModals(); renderEnquetes();
  };
  if ($("#eq-restit")) $("#eq-restit").onclick = async () => {
    await api.post(`/api/enquetes/${e.id}/restitution`, {}); closeModals(); renderEnquetes();
  };
}

// L'échéance du 1er novembre 2026. Tant qu'un campus n'a pas basculé, c'est
// l'information la plus importante de l'écran — devant le taux de conformité,
// qui porte sur un référentiel en train d'être remplacé.
function qVersionBanner(q, ref) {
  const e = q.etatVersion;
  if (!e?.alerte) return "";
  const v2026 = ref.versions.find((v) => v.cle === "v2026");
  const couleur = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" }[e.alerte.gravite] || "var(--border)";
  return `<div class="card card-pad" style="margin-bottom:14px;border-left:4px solid ${couleur};">
    <b>${esc(e.alerte.message)}</b>
    <p class="muted" style="margin:8px 0 0;font-size:13px;">Les 32 indicateurs actuels sont conservés, mais <b>renumérotés</b> : l'indicateur 23 (handicap) devient le 26, la veille légale passe de 24 à 23. Trois exigences sont sans équivalent, dont l'évaluation des enseignements par les apprenants.
    ${v2026?.source ? `<br><a href="${esc(v2026.source)}" target="_blank" rel="noopener">Texte officiel — ${esc(v2026.texte)}</a>` : ""}</p>
    <div class="actions" style="margin-top:10px;"><button class="btn-primary btn-sm" id="q-bascule">Préparer la bascule vers les 33 indicateurs</button></div>
  </div>`;
}

// Écran de bascule : ce qui se reporte, ce qui est à reprendre, ce qui est neuf.
async function openBasculeQualiopi(campusId) {
  const prep = await api.get(`/api/campuses/${campusId}/qualiopi/bascule`);
  if (prep?.error) { alert(prep.error); return; }
  const CONF = {
    directe: ["Renumérotation simple", "var(--good-bg)"],
    partielle: ["Exigence modifiée", "#F5E9D0"],
    nouveau: ["Sans équivalent", "#F3D9D9"],
  };
  openModal("Bascule vers le référentiel 2026", `
    <p class="muted" style="font-size:13.5px;"><b>Aucune conformité n'est reportée.</b> L'audit portera sur le nouveau référentiel, et la conformité à l'ancien ne s'y transporte pas : chaque indicateur repart à « à vérifier ». Ce qui est repris, ce sont vos <b>notes de preuve</b>, replacées sur le bon indicateur malgré la renumérotation.</p>
    <div class="kpis" style="margin-top:10px;">${fkpi(prep.lignes.length, "indicateurs")}${fkpi(prep.aRefaire, "à reprendre", "bad")}${fkpi(prep.nouveaux.length, "sans équivalent", "bad")}</div>
    <div class="card" style="overflow-x:auto;margin-top:12px;max-height:46vh;overflow-y:auto;"><table class="net-table">
      <thead><tr><th>N°</th><th>Crit.</th><th>Indicateur 2026</th><th>Reprise</th><th>Venait de</th></tr></thead><tbody>
      ${prep.lignes.map((l) => {
        const [lab, bg] = CONF[l.confiance] || CONF.nouveau;
        return `<tr><td><b>${l.n}</b></td><td>${l.critere}</td>
          <td>${esc(l.libelle)}${l.note ? `<br><span class="muted" style="font-size:12px;">${esc(l.note)}</span>` : ""}</td>
          <td><span class="pill" style="background:${bg};">${esc(lab)}</span></td>
          <td>${l.anciens.length ? l.anciens.map((a) => `n° ${a.n}${a.statut === "conforme" ? " ✔" : ""}`).join(", ") : '<span class="muted">—</span>'}</td></tr>`;
      }).join("")}
      </tbody></table></div>
    <p class="hint muted" style="margin-top:8px;">${esc(prep.reserve)}</p>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="q-bascule-go">Basculer ce campus sur les 33 indicateurs</button></div>`);

  $("#q-bascule-go").onclick = async () => {
    const r = await api.post(`/api/campuses/${campusId}/qualiopi/bascule`, {});
    if (r?.error) { alert(r.error); return; }
    alert(`Campus basculé sur le référentiel 2026. ${r.aRefaire} indicateur(s) à reprendre, dont ${r.nouveaux.length} sans équivalent (n° ${r.nouveaux.join(", ")}).`);
    qualiopiRef = null;   // le référentiel affiché change de version
    closeModals(); renderQualiopi();
  };
}

async function renderQualiopi() {
  const view = $("#view");
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute un campus d'abord (onglet Campus).</p>`; return; }
  if (!qCampus || !state.campuses.find((c) => c.id === qCampus)) qCampus = state.campuses[0].id;
  // Le référentiel est chargé POUR LA VERSION du campus : un cache unique
  // afficherait les 32 anciens libellés au-dessus de statuts enregistrés sur la
  // numérotation 2026, ou l'inverse.
  const q = await api.get(`/api/campuses/${qCampus}/qualiopi`);
  qualiopiRef = qualiopiRef || {};
  if (!qualiopiRef[q.version]) qualiopiRef[q.version] = await api.get(`/api/qualiopi/reference?version=${q.version}`);
  const ref = qualiopiRef[q.version];
  const ind = q.indicators || {};
  const qdocs = await api.get(`/api/documents?campusId=${qCampus}`) || [];
  const docCount = {}; qdocs.forEach((d) => { if (d.indicator) docCount[d.indicator] = (docCount[d.indicator] || 0) + 1; });
  const STAT = [{ k: "conforme", l: "Conforme" }, { k: "non_conforme", l: "Non conforme" }, { k: "a_verifier", l: "À vérifier" }, { k: "non_applicable", l: "N/A" }];
  const ctrl = q.control;
  const monthsLeft = (d) => (d ? Math.round((new Date(d) - new Date()) / (30 * 864e5)) : null);
  const ctrlItem = (label, d) => {
    if (!d) return "";
    const m = monthsLeft(d);
    const warn = m != null && m <= 2;
    const rel = m == null ? "" : (m >= 0 ? `dans ${m} mois` : `${Math.abs(m)} mois de retard`);
    return `<div class="ctrl-item"><div class="ctrl-l">${label}</div><div class="ctrl-d ${warn ? "warn" : ""}">${d} <span class="muted">(${rel})</span></div></div>`;
  };
  const controlCard = `<div class="card card-pad" style="margin-bottom:14px;">
    <div class="section-title" style="margin-top:0;">Échéances de contrôle</div>
    ${ctrl ? `
      <div class="ctrl-grid">
        ${ctrlItem("Audit de surveillance (≈ +18 mois)", ctrl.surveillance)}
        ${ctrlItem("Renouvellement (+3 ans)", ctrl.renewal)}
      </div>
      <div class="actions" style="margin-top:14px;">
        <button class="btn-ghost btn-sm" id="q-fill-dates">Reporter ces dates dans la fiche</button>
        <button class="btn-primary btn-sm" id="q-schedule">Programmer les échéances dans le plan d'action</button>
        <span id="q-sched-msg" class="status"></span>
      </div>
      <p class="hint muted" style="margin-top:8px;">Calculé depuis le dernier audit. « Programmer » crée les revues internes trimestrielles + préparations d'audit comme actions datées, à compléter avec un RACI dans Plans d'action.</p>
    ` : `<p class="muted">Renseigne la <strong>date du dernier audit</strong> ci-dessus (puis Enregistrer) pour calculer automatiquement les échéances de contrôle.</p>`}
  </div>`;
  view.innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:center;">
      <div><label class="field-label">Campus</label><select id="q-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === qCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div style="flex:none;"><label class="field-label">Conformité</label><div class="q-gauge ${q.conformity != null && q.conformity < 80 ? "low" : ""}">${q.conformity == null ? "—" : q.conformity + " %"}</div></div>
      <span style="flex:1"></span>
      <div style="flex:none;"><label class="field-label">Référentiel</label><div class="muted" style="font-size:13px;">${esc(ref.versions.find((v) => v.cle === q.version)?.label || q.version)}</div></div>
    </div>
    ${qVersionBanner(q, ref)}
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="section-title" style="margin-top:0;">Certification & audits</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
        <div><label class="field-label">Certificateur</label><input class="txt qm" data-f="certifier" value="${esc(q.certifier || "")}"></div>
        <div><label class="field-label">N° certificat</label><input class="txt qm" data-f="certifNumber" value="${esc(q.certifNumber || "")}"></div>
        <div><label class="field-label">Dernier audit</label><input class="txt qm" data-f="lastAudit" type="date" value="${esc(q.lastAudit || "")}"></div>
        <div><label class="field-label">Audit de surveillance</label><input class="txt qm" data-f="nextSurveillance" type="date" value="${esc(q.nextSurveillance || "")}"></div>
        <div><label class="field-label">Renouvellement</label><input class="txt qm" data-f="renewalDate" type="date" value="${esc(q.renewalDate || "")}"></div>
      </div>
    </div>
    ${controlCard}
    ${ref.reference.map((crit) => `<div class="card card-pad" style="margin-bottom:12px;">
      <h3 style="color:var(--marine);">Critère ${crit.c} — ${esc(crit.titre)}</h3>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">${crit.indicators.map((i) => {
        const cur = ind[i.n] || {};
        return `<div class="q-ind">
          <div class="q-num">${i.n}</div>
          <div class="grow"><div>${esc(i.l)}${i.tag ? ` <span class="q-tag">${i.tag}</span>` : ""}${i.nouveau ? ' <span class="q-tag" style="background:var(--good-bg);">nouveau</span>' : ""}</div>
            <input class="txt q-note" data-n="${i.n}" placeholder="Note / preuve…" value="${esc(cur.note || "")}"></div>
          <button type="button" class="btn-ghost btn-sm q-proof" data-n="${i.n}" title="Pièces justificatives">${I.clip}${docCount[i.n] ? `<span class="q-proof-n">${docCount[i.n]}</span>` : ""}</button>
          <select class="q-stat s-${cur.status || "a_verifier"}" data-n="${i.n}">${STAT.map((s) => `<option value="${s.k}" ${(cur.status || "a_verifier") === s.k ? "selected" : ""}>${s.l}</option>`).join("")}</select>
        </div>`;
      }).join("")}</div>
    </div>`).join("")}
    ${(ref.glossary && ref.glossary.length) ? `<details class="card card-pad" style="margin-bottom:12px;">
      <summary style="cursor:pointer;font-weight:600;color:var(--marine);">📘 Glossaire — éléments clés de Qualiopi</summary>
      <dl style="margin:12px 0 0;display:flex;flex-direction:column;gap:10px;">${ref.glossary.map((g) => `
        ${g.sec ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:var(--marine);opacity:.7;margin-top:6px;border-top:1px solid var(--border);padding-top:10px;">${esc(g.sec)}</div>` : ""}
        <div><dt style="font-weight:600;color:var(--marine);">${esc(g.t)}</dt><dd style="margin:2px 0 0;color:var(--muted);line-height:1.5;">${esc(g.d)}</dd></div>`).join("")}</dl>
    </details>` : ""}
    <p class="hint muted">Tous les indicateurs ne concernent pas toutes les catégories d'actions : le tableau annexé au décret dit lesquels. Marquez « N/A » ceux qui ne relèvent pas de votre périmètre — ils sortent alors du taux de conformité. L'application ne le décide pas à votre place : un périmètre deviné trop étroit ferait paraître l'organisme plus conforme qu'il ne l'est.${(ref.versions.find((v) => v.cle === q.version)?.source) ? ` <a href="${esc(ref.versions.find((v) => v.cle === q.version).source)}" target="_blank" rel="noopener">Texte du référentiel</a>` : ""}</p>
    <div class="actions" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0;"><button id="q-save" class="btn-primary">Enregistrer Qualiopi</button> <span id="q-msg" class="status"></span></div>`;
  $("#q-campus").addEventListener("change", (e) => { qCampus = e.target.value; renderQualiopi(); });
  if ($("#q-bascule")) $("#q-bascule").onclick = () => openBasculeQualiopi(qCampus);
  $$(".q-proof").forEach((b) => b.addEventListener("click", () => openIndicatorProof(qCampus, b.dataset.n, qdocs.filter((d) => String(d.indicator) === String(b.dataset.n)))));
  $$(".q-stat").forEach((s) => s.addEventListener("change", () => { s.className = "q-stat s-" + s.value; }));
  $("#q-save").addEventListener("click", async () => {
    const meta = {}; $$(".qm").forEach((i) => (meta[i.dataset.f] = i.value));
    const indicators = {};
    $$(".q-stat").forEach((s) => (indicators[s.dataset.n] = { status: s.value, note: $(`.q-note[data-n="${s.dataset.n}"]`)?.value || "" }));
    const r = await api.patch(`/api/campuses/${qCampus}/qualiopi`, { ...meta, indicators });
    const m = $("#q-msg"); m.textContent = `✓ Enregistré — ${r.conformity ?? "—"} % conforme`; m.classList.add("saved");
  });
  if (ctrl) {
    $("#q-fill-dates")?.addEventListener("click", () => {
      const s = $('.qm[data-f="nextSurveillance"]'); if (s) s.value = ctrl.surveillance;
      const rd = $('.qm[data-f="renewalDate"]'); if (rd) rd.value = ctrl.renewal;
      const m = $("#q-sched-msg"); if (m) m.textContent = "Dates reportées — clique « Enregistrer Qualiopi » pour les sauver.";
    });
    $("#q-schedule")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      const r = await api.post(`/api/campuses/${qCampus}/qualiopi/schedule`, {});
      $("#q-sched-msg").textContent = r.created != null ? `✓ ${r.created} échéance(s) ajoutée(s) au plan d'action` : (r.error || "erreur");
    });
  }
}
function openIndicatorProof(campusId, indicator, docs) {
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  openModal(`Preuves — indicateur ${indicator}`, `
    <div class="row" style="align-items:end;gap:10px;margin-bottom:12px;">
      <div><label class="field-label">Ajouter une pièce justificative</label><input type="file" id="qp-file"></div>
      <button class="btn-primary btn-sm" id="qp-up" style="flex:none;">Téléverser</button><span id="qp-msg" class="status"></span>
    </div>
    <div class="list" id="qp-list">${docs.length ? docs.map((d) => `<div class="item"><span class="pill">${esc(d.category)}</span><div class="grow"><div class="ttl">${esc(d.name)}</div><div class="sub muted">${kb(d.size)} · ${frDate(d.createdAt)}</div></div><a class="btn-ghost btn-sm" href="/api/documents/${d.id}/download">Télécharger</a><button class="btn-ghost btn-sm btn-danger qp-del" data-id="${d.id}">✕</button></div>`).join("") : `<p class="muted" style="font-size:13px;">Aucune preuve rattachée à cet indicateur.</p>`}</div>
    <p class="hint muted" style="margin-top:10px;">Les pièces sont chiffrées au repos et rattachées à ce campus + indicateur (dossier d'audit prêt).</p>`);
  $("#qp-up").addEventListener("click", async () => {
    const f = $("#qp-file").files[0]; if (!f) { $("#qp-msg").textContent = "Choisis un fichier."; return; }
    $("#qp-msg").textContent = "Envoi…";
    const fd = new FormData(); fd.append("file", f); fd.append("category", "audit"); fd.append("indicator", indicator);
    const r = await fetch(`/api/campuses/${campusId}/documents`, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd });
    if (r.status === 401) return logout(true);
    if (!r.ok) { const j = await r.json().catch(() => ({})); $("#qp-msg").textContent = "Échec : " + (j.error || r.status); return; }
    closeModals(); renderQualiopi();
  });
  $$(".qp-del").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Supprimer cette preuve ?")) return; await api.del(`/api/documents/${b.dataset.id}`); closeModals(); renderQualiopi(); }));
}

// ---------- Vue : Indicateurs (KPI mensuels) ----------
const KPI_METRICS = [{ k: "students", l: "Effectif" }, { k: "occupancy", l: "Remplissage %" }, { k: "revenue", l: "CA €" }, { k: "satisfaction", l: "Satisfaction /10" }, { k: "successRate", l: "Réussite %" }, { k: "insertionRate", l: "Insertion %" }];
let kMetric = "occupancy";
async function renderIndicateurs() {
  const view = $("#view");
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute un campus d'abord (onglet Campus).</p>`; return; }
  if (!kCampus || !state.campuses.find((c) => c.id === kCampus)) kCampus = state.campuses[0].id;
  const entries = await api.get(`/api/kpi?campusId=${kCampus}`);
  const nowMonth = new Date().toISOString().slice(0, 7);
  view.innerHTML = `
    <div class="row" style="margin-bottom:14px;"><div><label class="field-label">Campus</label><select id="k-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === kCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div></div>
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="section-title" style="margin-top:0;">Saisir / mettre à jour un mois</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;align-items:end;">
        <div><label class="field-label">Mois</label><input class="txt kf" data-f="month" type="month" value="${nowMonth}"></div>
        ${KPI_METRICS.map((m) => `<div><label class="field-label">${m.l}</label><input class="txt kf" data-f="${m.k}" type="number" step="any"></div>`).join("")}
        <button id="k-add" class="btn-primary" style="flex:none;">Enregistrer</button>
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="btn-ghost btn-sm" id="k-dup"${entries.length ? "" : " disabled"}>Dupliquer M‑1</button>
        <label class="btn-ghost btn-sm" style="cursor:pointer;">Importer CSV<input type="file" id="k-csv" accept=".csv,text/csv" hidden></label>
        <span id="k-msg" class="status"></span>
      </div>
      <p class="hint muted" style="margin-top:6px;">CSV attendu : en‑tête <code>month,students,occupancy,revenue,revenueBudget,payroll,charges,satisfaction,successRate,insertionRate</code> (colonnes optionnelles, une ligne par mois).</p>
    </div>
    ${entries.length ? `
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="chips" id="k-metric" style="margin-bottom:12px;">${KPI_METRICS.map((m) => `<button type="button" class="chip ${kMetric === m.k ? "active" : ""}" data-k="${m.k}">${m.l}</button>`).join("")}</div>
      ${trendChart(entries, kMetric, (KPI_METRICS.find((m) => m.k === kMetric)?.l || "").includes("%") ? "%" : "")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Mois</th>${KPI_METRICS.map((m) => `<th>${m.l}</th>`).join("")}<th></th></tr></thead>
      <tbody>${entries.slice().reverse().map((e) => `<tr><td>${e.month}</td>${KPI_METRICS.map((m) => `<td>${e[m.k] ?? "—"}</td>`).join("")}<td><button class="btn-ghost btn-sm btn-danger k-del" data-id="${e.id}">✕</button></td></tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">Aucune donnée mensuelle. Saisis ton premier mois ci-dessus pour suivre les tendances.</p>`}`;
  $$("#k-metric .chip").forEach((c) => c.addEventListener("click", () => { kMetric = c.dataset.k; renderIndicateurs(); }));
  $("#k-campus").addEventListener("change", (e) => { kCampus = e.target.value; renderIndicateurs(); });
  $("#k-add").addEventListener("click", async () => {
    const entry = { campusId: kCampus }; $$(".kf").forEach((i) => (entry[i.dataset.f] = i.value));
    if (!entry.month) return;
    await api.post("/api/kpi", entry); renderIndicateurs();
  });
  $("#k-dup").addEventListener("click", () => {
    const last = entries[entries.length - 1]; if (!last) return;
    KPI_METRICS.forEach((m) => { const el = $(`.kf[data-f="${m.k}"]`); if (el && last[m.k] != null) el.value = last[m.k]; });
    $("#k-msg").textContent = "Valeurs de " + last.month + " reprises — ajuste puis Enregistrer.";
  });
  $("#k-csv").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) { $("#k-msg").textContent = "CSV vide."; return; }
    const cols = lines[0].split(/[,;]/).map((c) => c.trim());
    const allowed = ["month", ...KPI_METRICS.map((m) => m.k)];
    let n = 0;
    for (const line of lines.slice(1)) {
      const vals = line.split(/[,;]/);
      const entry = { campusId: kCampus };
      cols.forEach((c, i) => { if (allowed.includes(c) && vals[i] != null && vals[i].trim() !== "") entry[c] = vals[i].trim(); });
      if (!entry.month) continue;
      await api.post("/api/kpi", entry); n++;
    }
    $("#k-msg").textContent = `${n} mois importé(s).`;
    renderIndicateurs();
  });
  $$(".k-del").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/kpi/${b.dataset.id}`); renderIndicateurs(); }));
}
function trendChart(entries, key, unit) {
  const pts = entries.filter((e) => e[key] != null);
  if (!pts.length) return `<p class="muted">Pas de donnée pour ce KPI.</p>`;
  const max = Math.max(...pts.map((p) => p[key])) || 1;
  return `<div class="chart">${pts.map((p) => `<div class="bar-row"><span>${p.month}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (p[key] / max) * 100)}%"></div></div><span class="bar-val">${p[key]} ${unit}</span></div>`).join("")}</div>`;
}

// ---------- Vue : Admissions ----------
// Prévision de remplissage à partir de l'entonnoir (taux de conversion par étape).
function admForecast(a) {
  const c = +a.candidatures || 0, e = +a.entretiens || 0, ad = +a.admis || 0, ins = +a.inscrits || 0, obj = +a.objectif || 0;
  if (!c && !ad && !ins) return null;
  const r1 = c ? e / c : 0.6, r2 = e ? ad / e : 0.5, r3 = ad ? ins / ad : 0.7;
  let central = c ? Math.round(c * r1 * r2 * r3) : Math.max(ins, Math.round(ad * 0.7));
  central = Math.max(central, ins); // jamais sous les inscrits déjà acquis
  const prudent = Math.max(ins, Math.round(central * 0.85));
  const optimiste = Math.round(central * 1.15);
  return { r1: Math.round(r1 * 100), r2: Math.round(r2 * 100), r3: Math.round(r3 * 100), central, prudent, optimiste, ecart: obj ? central - obj : null, manque: obj ? Math.max(0, obj - central) : 0, obj };
}
let admMode = "agregats";
async function renderAdmissions() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  state.campuses = await api.get("/api/campuses") || [];
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute des campus (onglet Campus) pour suivre les admissions.</p>`; return; }
  view.innerHTML = `<div class="chips" style="margin-bottom:14px;" id="adm-tabs">
    <button type="button" class="chip ${admMode === "agregats" ? "active" : ""}" data-m="agregats">Agrégats</button>
    <button type="button" class="chip ${admMode === "funnel" ? "active" : ""}" data-m="funnel">Funnel candidatures</button>
  </div><div id="adm-body"><p class="muted">Chargement…</p></div>`;
  $$("#adm-tabs .chip").forEach((c) => c.addEventListener("click", () => { admMode = c.dataset.m; renderAdmissions(); }));
  if (admMode === "funnel") return renderCandidatesInto($("#adm-body"));
  return renderAdmissionsAgregatsInto($("#adm-body"));
}

async function renderAdmissionsAgregatsInto(view) {
  const num = (v) => (v == null ? "" : v);
  const rows = state.campuses.map((c) => {
    const a = c.admissions || {};
    const pctObj = a.objectif ? Math.round(((a.inscrits || 0) / a.objectif) * 100) : null;
    const conv = a.candidatures ? Math.round(((a.inscrits || 0) / a.candidatures) * 100) : null;
    return `<tr>
      <td><div class="ttl">${esc(c.name)}</div><div class="sub muted">${esc(c.city || "")}</div></td>
      <td><input class="txt ad" data-f="objectif" type="number" value="${num(a.objectif)}" style="width:78px;"></td>
      <td><input class="txt ad" data-f="candidatures" type="number" value="${num(a.candidatures)}" style="width:78px;"></td>
      <td><input class="txt ad" data-f="entretiens" type="number" value="${num(a.entretiens)}" style="width:78px;"></td>
      <td><input class="txt ad" data-f="admis" type="number" value="${num(a.admis)}" style="width:78px;"></td>
      <td><input class="txt ad" data-f="inscrits" type="number" value="${num(a.inscrits)}" style="width:78px;"></td>
      <td class="${pctObj != null && pctObj < 80 ? "cell-warn" : ""}">${pctObj != null ? pctObj + " %" : "—"}</td>
      <td>${conv != null ? conv + " %" : "—"}</td>
      <td><button class="btn-ghost btn-sm ad-save" data-cid="${c.id}">Enreg.</button></td>
    </tr>`;
  }).join("");
  view.innerHTML = `<div class="card" style="overflow-x:auto;"><table class="net-table">
    <thead><tr><th>Campus</th><th>Objectif</th><th>Candidat.</th><th>Entretiens</th><th>Admis</th><th>Inscrits</th><th>% obj.</th><th>Conversion</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">% objectif = inscrits / objectif · Conversion = inscrits / candidatures. Sous 80 % de l'objectif = signalé en rouge.</p>
    <div class="section-title">Prévision de remplissage</div>
    <div class="fc-grid">${state.campuses.map((c) => {
      const f = admForecast(c.admissions || {});
      if (!f) return `<div class="fc-card"><div class="fc-name">${esc(c.name)}</div><p class="muted" style="font-size:12.5px;margin:6px 0 0;">Données insuffisantes — saisis candidatures / admis / inscrits.</p></div>`;
      const tone = f.ecart == null ? "" : f.ecart >= 0 ? "good" : f.ecart <= -0.15 * (f.obj || 1) ? "bad" : "warn";
      return `<div class="fc-card fc-${tone}">
        <div class="fc-name">${esc(c.name)}</div>
        <div class="fc-central">${f.central}<span class="fc-unit">inscrits projetés</span></div>
        <div class="fc-band">fourchette ${f.prudent}–${f.optimiste} · objectif ${f.obj || "—"}</div>
        ${f.obj ? `<div class="fc-line ${tone}">${f.ecart >= 0 ? "▲ +" + f.ecart + " vs objectif" : "▼ " + f.ecart + " vs objectif" + (f.manque ? ` · manque ${f.manque} place${f.manque > 1 ? "s" : ""}` : "")}</div>` : ""}
        <div class="fc-rates">Conversion : candidat.→entretien ${f.r1}% · →admis ${f.r2}% · →inscrit ${f.r3}%</div>
      </div>`;
    }).join("")}</div>
    <p class="hint muted" style="margin-top:10px;">Estimation basée sur tes taux de conversion actuels (entonnoir). Central = candidatures × taux par étape ; fourchette prudente/optimiste ±15 %. À affiner au fil de la campagne — ce n'est pas une garantie.</p>`;
  $$(".ad-save").forEach((b) => b.addEventListener("click", async () => {
    const tr = b.closest("tr"); const patch = {};
    $$(".ad", tr).forEach((i) => (patch[i.dataset.f] = i.value));
    await api.patch(`/api/campuses/${b.dataset.cid}/admissions`, patch);
    await renderAdmissions();
  }));
}

// ---------- Vue : Funnel candidatures (admissions individuelles) ----------
const STAGE_LABEL = { nouveau: "Nouveau", contacte: "Contacté", entretien: "Entretien", admis: "Admis", inscrit: "Inscrit", refuse: "Refusé", perdu: "Perdu" };
const STAGE_ORDER = ["nouveau", "contacte", "entretien", "admis", "inscrit", "refuse", "perdu"];
let candFilter = { campusId: "", stage: "" };
async function renderCandidatesInto(view) {
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const qs = new URLSearchParams();
  if (candFilter.campusId) qs.set("campusId", candFilter.campusId);
  if (candFilter.stage) qs.set("stage", candFilter.stage);
  const cands = await api.get("/api/candidates?" + qs.toString()) || [];
  const sf = await api.get("/api/settings");
  const counts = Object.fromEntries(STAGE_ORDER.map((s) => [s, cands.filter((c) => c.stage === s).length]));
  const card = (c) => `<div class="item cand-card" data-id="${c.id}">
    <div class="grow"><div class="ttl">${esc(c.prenom)} ${esc(c.nom.toUpperCase())} ${c.source === "salesforce" ? '<span class="pill" title="Synchronisé depuis Salesforce">☁︎ SF</span>' : ""}</div>
      <div class="sub muted">${c.formationSouhaitee ? esc(c.formationSouhaitee) + " · " : ""}${esc(c.campusName || "sans campus")}${c.email ? " · " + esc(c.email) : ""}</div></div>
    <select class="txt cand-stage" data-id="${c.id}" style="width:130px;">${STAGE_ORDER.filter((s) => !["refuse", "perdu"].includes(s) || s === c.stage).map((s) => `<option value="${s}" ${s === c.stage ? "selected" : ""}>${STAGE_LABEL[s]}</option>`).join("")}</select>
    ${c.stage === "admis" ? `<button class="btn-primary btn-sm cand-convert" data-id="${c.id}">Convertir</button>` : ""}
  </div>`;
  view.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <p style="margin:0;">Funnel individuel des candidatures${sf?.salesforce?.configured ? "" : " — saisie manuelle."} <span class="muted">${sf?.salesforce?.configured ? (sf.salesforce.lastSync ? "Dernière synchro Salesforce : " + new Date(sf.salesforce.lastSync).toLocaleString("fr-FR") : "Connecté, jamais synchronisé") : ""}</span></p>
        <div style="display:flex;gap:8px;">
          ${isAdmin() && sf?.salesforce?.configured ? `<button class="btn-ghost btn-sm" id="cand-sync">⟳ Synchroniser Salesforce</button>` : ""}
          ${isAdmin() ? `<button class="btn-ghost btn-sm" id="cand-sf-cfg">Connecteur Salesforce</button>` : ""}
          <button class="btn-primary btn-sm" id="cand-add">${I.plus}<span>Candidature</span></button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <select class="txt" id="cand-stage-f" style="max-width:180px;"><option value="">Toutes étapes</option>${STAGE_ORDER.map((s) => `<option value="${s}" ${candFilter.stage === s ? "selected" : ""}>${STAGE_LABEL[s]} (${counts[s]})</option>`).join("")}</select>
      ${isAdmin() ? `<select class="txt" id="cand-campus-f" style="max-width:220px;"><option value="">Tous les campus</option>${state.campuses.map((c) => `<option value="${c.id}" ${candFilter.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}
    </div>
    ${cands.length ? `<div class="list">${cands.map(card).join("")}</div>` : `<p class="empty">Aucune candidature${candFilter.stage || candFilter.campusId ? " pour ce filtre" : " — ajoute la première ou connecte Salesforce"}.</p>`}`;
  $("#cand-stage-f").addEventListener("change", () => { candFilter.stage = $("#cand-stage-f").value; renderAdmissions(); });
  $("#cand-campus-f")?.addEventListener("change", () => { candFilter.campusId = $("#cand-campus-f").value; renderAdmissions(); });
  $("#cand-add").addEventListener("click", () => openCandidateForm(null, () => renderAdmissions()));
  $("#cand-sf-cfg")?.addEventListener("click", () => openSalesforceConfig(sf?.salesforce, () => renderAdmissions()));
  $("#cand-sync")?.addEventListener("click", async () => {
    const btn = $("#cand-sync"); btn.disabled = true; btn.textContent = "Synchro…";
    const r = await api.post("/api/salesforce/sync");
    if (r.error) alert(r.error);
    else alert(`Synchronisation Salesforce : ${r.created} créée(s), ${r.updated} mise(s) à jour${r.sansCampus ? `, ${r.sansCampus} sans campus (à affecter manuellement)` : ""} sur ${r.total} lead(s).`);
    await renderAdmissions();
  });
  $$(".cand-stage").forEach((s) => s.addEventListener("change", async () => { await api.patch(`/api/candidates/${s.dataset.id}`, { stage: s.value }); renderAdmissions(); }));
  $$(".cand-convert").forEach((b) => b.addEventListener("click", async () => {
    const c = cands.find((x) => x.id === b.dataset.id);
    const year = prompt(`Année scolaire d'inscription de ${c.prenom} ${c.nom} (ex. 2026-2027) — laisser vide pour créer le dossier sans inscrire tout de suite :`, "");
    const r = await api.post(`/api/candidates/${b.dataset.id}/convert`, { schoolYear: year || undefined });
    if (r.error) { alert(r.error); return; }
    alert(`Dossier ${r.learnerCreated ? "créé" : "existant lié"} pour ${r.learner.prenom} ${r.learner.nom}${r.enrollment ? " — inscrit " + r.enrollment.schoolYear : ""}.`);
    await renderAdmissions();
  }));
}

function openCandidateForm(c, onDone) {
  c = c || {};
  openModal(c.id ? "Modifier la candidature" : "Nouvelle candidature", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Nom *</label><input class="txt" id="cf-nom" value="${esc(c.nom || "")}"></div>
      <div class="field"><label class="field-label">Prénom *</label><input class="txt" id="cf-prenom" value="${esc(c.prenom || "")}"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Email</label><input class="txt" id="cf-email" type="email" value="${esc(c.email || "")}"></div>
      <div class="field"><label class="field-label">Téléphone</label><input class="txt" id="cf-tel" value="${esc(c.telephone || "")}"></div>
    </div>
    <div class="field"><label class="field-label">Formation souhaitée</label><input class="txt" id="cf-form" value="${esc(c.formationSouhaitee || "")}"></div>
    <div class="field"><label class="field-label">Campus *</label><select class="txt" id="cf-campus">${campusOptions(c.campusId)}</select></div>
    <div class="field"><label class="field-label">Notes</label><textarea id="cf-notes" rows="2">${esc(c.notes || "")}</textarea></div>
    <div class="actions"><button class="btn-primary" id="cf-save">${c.id ? "Enregistrer" : "Créer"}</button> <span class="status" id="cf-msg"></span></div>`);
  $("#cf-save").onclick = () => guard($("#cf-save"), async () => {
    const body = { nom: $("#cf-nom").value.trim(), prenom: $("#cf-prenom").value.trim(), email: $("#cf-email").value.trim(), telephone: $("#cf-tel").value.trim(), formationSouhaitee: $("#cf-form").value.trim(), campusId: $("#cf-campus").value, notes: $("#cf-notes").value.trim() };
    if (!body.nom || !body.prenom || !body.campusId) { $("#cf-msg").textContent = "Nom, prénom et campus sont requis."; return; }
    const r = c.id ? await api.patch(`/api/candidates/${c.id}`, body) : await api.post("/api/candidates", body);
    if (r.error) { $("#cf-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    await onDone();
  });
}

function openSalesforceConfig(sf, onDone) {
  sf = sf || {};
  openModal("Connecteur Salesforce", `
    <p class="sub muted" style="margin-top:0;">Connected App Salesforce, flux <b>OAuth « client credentials »</b> (serveur à serveur, pas de mot de passe utilisateur). ${sf.configured ? `<span class="pill done">Configuré</span>` : ""}</p>
    <div class="field"><label class="field-label">URL de l'instance</label><input class="txt" id="sfc-url" value="${esc(sf.instanceUrl || "")}" placeholder="https://votreorg.my.salesforce.com"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Client ID</label><input class="txt" id="sfc-cid" value="${esc(sf.clientId || "")}"></div>
      <div class="field"><label class="field-label">Client Secret ${sf.secretMask ? "(" + esc(sf.secretMask) + " — vide = inchangé)" : ""}</label><input class="txt" id="sfc-secret" type="password" placeholder="${sf.secretMask ? "inchangé" : ""}"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Objet</label><input class="txt" id="sfc-obj" value="${esc(sf.object || "Lead")}"></div>
      <div class="field"><label class="field-label">Version API</label><input class="txt" id="sfc-api" value="${esc(sf.apiVersion || "v59.0")}"></div>
    </div>
    <div class="field"><label class="field-label">Filtre SOQL (WHERE) <span class="muted">optionnel</span></label><input class="txt" id="sfc-where" value="${esc(sf.where || "")}" placeholder="RecordType.Name = 'Candidat formation'"></div>
    <div class="field"><label class="field-label">Champs <span class="muted">(une ligne par champ : nom = ApiName__c)</span></label><textarea id="sfc-fields" rows="3" placeholder="nom = LastName&#10;prenom = FirstName&#10;formation = Formation_souhaitee__c&#10;campus = Campus__c">${esc(sf.fieldsText || "")}</textarea></div>
    <div class="field"><label class="field-label">Correspondance statuts <span class="muted">(valeur Salesforce = étape Campus Manager)</span></label><textarea id="sfc-statusmap" rows="2" placeholder="Qualified = entretien&#10;Closed - Converted = inscrit">${esc(sf.statusMapText || "")}</textarea></div>
    <div class="field"><label class="field-label">Correspondance campus <span class="muted">(valeur Salesforce = nom du campus)</span></label><textarea id="sfc-campusmap" rows="2" placeholder="PAR = Paris 15">${esc(sf.campusMapText || "")}</textarea></div>
    <label style="display:flex;align-items:center;gap:8px;margin:10px 0;"><input type="checkbox" id="sfc-enabled" ${sf.enabled !== false ? "checked" : ""}> <span>Synchronisation quotidienne active</span></label>
    ${sf.lastError ? `<p class="sub" style="color:var(--bad);">Dernière erreur : ${esc(sf.lastError.message)}</p>` : ""}
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-primary" id="sfc-save">Enregistrer</button>
      <button class="btn-ghost" id="sfc-test">Tester la connexion</button>
    </div>
    <div id="sfc-msg" class="sub" style="margin-top:8px;"></div>`);
  const msg = (t, ok) => { const m = $("#sfc-msg"); m.textContent = t; m.style.color = ok ? "var(--good)" : "var(--bad)"; };
  const save = async () => {
    const body = {
      instanceUrl: $("#sfc-url").value.trim(), clientId: $("#sfc-cid").value.trim(),
      object: $("#sfc-obj").value.trim(), apiVersion: $("#sfc-api").value.trim(), where: $("#sfc-where").value.trim(),
      fieldsText: $("#sfc-fields").value, statusMapText: $("#sfc-statusmap").value, campusMapText: $("#sfc-campusmap").value,
      enabled: $("#sfc-enabled").checked,
    };
    const secret = $("#sfc-secret").value.trim();
    if (secret) body.clientSecret = secret;
    const r = await api.put("/api/settings", { salesforce: body });
    if (r.error) { msg(r.error, false); return null; }
    return r;
  };
  $("#sfc-save").onclick = async () => { if (await save()) { msg("Configuration enregistrée.", true); setTimeout(async () => { document.querySelector(".modal-bg")?.remove(); await onDone(); }, 500); } };
  $("#sfc-test").onclick = async () => {
    if (!(await save())) return;
    msg("Test en cours…", true);
    const r = await api.post("/api/salesforce/test");
    if (r.error) msg(r.error, false);
    else msg(`Connexion OK — org ${esc(r.instanceUrl)}${r.latestApi ? ", API la plus récente " + r.latestApi : ""}.`, true);
  };
}

// ---------- Vue : Timeline ----------
let tlFilter = "all";
async function renderCalendrier() {
  $("#topbar-actions").innerHTML = `
    <div class="chips" id="tl-filter">
      <button type="button" class="chip ${tlFilter === "all" ? "active" : ""}" data-f="all">Tout</button>
      <button type="button" class="chip ${tlFilter === "action" ? "active" : ""}" data-f="action">Plans d'action</button>
      <button type="button" class="chip ${tlFilter === "controle" ? "active" : ""}" data-f="controle">Points de contrôle</button>
    </div>`;
  $$("#tl-filter .chip").forEach((c) => c.addEventListener("click", () => { tlFilter = c.dataset.f; renderCalendrier(); }));
  const view = $("#view");
  let events = await api.get("/api/calendar") || [];
  if (tlFilter !== "all") events = events.filter((e) => e.type === tlFilter);
  if (!events.length) { view.innerHTML = `<p class="empty">Aucune échéance datée. Ajoute des actions avec une date, ou renseigne les audits Qualiopi (onglet Qualiopi).</p>`; return; }
  const today = new Date().toISOString().slice(0, 10);
  const frLong = (d) => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  // insertion du repère "aujourd'hui"
  const rows = [];
  let todayInserted = false;
  for (const e of events) {
    if (!todayInserted && e.date >= today) { rows.push({ todayMarker: true }); todayInserted = true; }
    rows.push(e);
  }
  if (!todayInserted) rows.push({ todayMarker: true }); // tout est passé
  const node = (e) => {
    if (e.todayMarker) return `<div class="tl-row tl-today"><div class="tl-dot tl-dot-today"></div><div class="tl-body"><span class="tl-nowline">Aujourd'hui — ${frLong(today)}</span></div></div>`;
    const cls = e.overdue ? "overdue" : e.type;
    const badge = e.type === "controle" ? '<span class="pill" style="background:var(--accent-soft);color:var(--accent-700);">Point de contrôle</span>' : '<span class="pill" style="background:var(--good-bg);color:var(--marine);">Plan d\'action</span>';
    return `<div class="tl-row"><div class="tl-dot tl-${cls}"></div><div class="tl-body">
      <div class="tl-date">${frLong(e.date)}${e.overdue ? ' · <span class="pill overdue">en retard</span>' : ""}</div>
      <div class="tl-card">${badge}<div class="tl-label">${esc(e.label)}</div><div class="tl-meta">${esc(e.campus || "")}${e.owner ? " · 👤 " + esc(e.owner) : ""}</div></div>
    </div></div>`;
  };
  view.innerHTML = `<div class="timeline">${rows.map(node).join("")}</div>`;
}

// ---------- Vue : Directeurs (objectifs détaillés + jalons) ----------
function jalonRow(j) {
  j = j || {};
  return `<div class="jalon-row">
    <input class="txt jf" data-f="libelle" value="${esc(j.libelle || "")}" placeholder="Jalon / résultat intermédiaire attendu" style="flex:2;min-width:150px;">
    <input class="txt jf" data-f="date" type="date" value="${esc(j.date || "")}" style="width:150px;">
    <input class="txt jf" data-f="resultat" value="${esc(j.resultat || "")}" placeholder="Résultat obtenu" style="flex:1;min-width:120px;">
    <label class="jal-chk"><input type="checkbox" class="jf-atteint" ${j.atteint ? "checked" : ""}> atteint</label>
    <button type="button" class="btn-ghost btn-sm btn-danger del-jalon">✕</button>
  </div>`;
}
function objCard(o) {
  o = o || {};
  return `<div class="obj-card">
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <input class="txt of" data-f="titre" value="${esc(o.titre || "")}" placeholder="Objectif" style="flex:2;min-width:170px;">
      <input class="txt of" data-f="cible" value="${esc(o.cible || "")}" placeholder="Résultat cible" style="flex:1;min-width:130px;">
      <input class="txt of" data-f="echeance" type="date" value="${esc(o.echeance || "")}" style="width:150px;">
    </div>
    <div class="jalons">
      <div class="jalons-list">${(o.jalons || []).map(jalonRow).join("")}</div>
      <button type="button" class="btn-ghost btn-sm add-jalon">+ Résultat intermédiaire</button>
    </div>
    <button type="button" class="btn-ghost btn-sm btn-danger del-obj">Supprimer l'objectif</button>
  </div>`;
}
function dirCategory(confidence, health) {
  const c = confidence || 0, h = health == null ? 60 : health;
  if (h < 50 || c === 1) return ["risk", "À risque"];
  if (c >= 4 && h >= 70) return ["auto", "Autonome"];
  if (c <= 2 || h < 65) return ["soutenir", "À soutenir"];
  return ["challenger", "À challenger"];
}
async function renderDirecteurs() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  const [dirs, net] = await Promise.all([api.get("/api/directors"), api.get("/api/network").catch(() => [])]);
  if (!dirs || !dirs.length) { view.innerHTML = `<p class="empty">Ajoute des campus, et un interlocuteur catégorie « Direction » par campus (onglet Campus).</p>`; return; }
  const healthById = Object.fromEntries((net || []).map((r) => [r.id, r.health]));
  const cats = dirs.map((d) => dirCategory(d.review?.confidence, healthById[d.campusId])[0]);
  const count = (k) => cats.filter((x) => x === k).length;
  const chip = (k, l) => `<span class="dir-chip dir-${k}">${count(k)} ${l}</span>`;
  const summary = `<div class="dir-summary">${chip("risk", "à risque")}${chip("soutenir", "à soutenir")}${chip("challenger", "à challenger")}${chip("auto", "autonomes")}</div>`;
  view.innerHTML = summary + `<div class="grid grid-2">${dirs.map((d) => {
    const r = d.review || {};
    const health = healthById[d.campusId];
    const [ck, cl] = dirCategory(r.confidence, health);
    return `<div class="card card-pad" data-cid="${d.campusId}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div><h3 style="margin:0;">${esc(d.director || "— directeur à renseigner —")}</h3>
        <div class="sub muted">${esc(d.campusName)}${d.city ? " · " + esc(d.city) : ""}${d.email ? " · " + esc(d.email) : ""}</div></div>
        <div style="text-align:right;flex:0 0 auto;"><span class="dir-chip dir-${ck}">${cl}</span><div class="sub muted" style="margin-top:4px;">Santé campus ${health ?? "—"}</div></div>
      </div>
      <div class="section-title" style="margin:14px 0 8px;">Objectifs & résultats (avec jalons intermédiaires)</div>
      <div class="objs" data-cid="${d.campusId}">${(r.objectivesList || []).map(objCard).join("")}</div>
      <button type="button" class="btn-ghost btn-sm add-obj" data-cid="${d.campusId}">+ Objectif</button>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;">
        <div><label class="field-label">Dernier point</label><input class="txt dr" data-f="lastPointDate" type="date" value="${esc(r.lastPointDate || "")}"></div>
        <div><label class="field-label">Confiance (1-5)</label><input class="txt dr" data-f="confidence" type="number" min="1" max="5" value="${r.confidence ?? ""}"></div>
      </div>
      <div class="field"><label class="field-label">Notes du dernier point</label><textarea class="dr" data-f="note" rows="2">${esc(r.note || "")}</textarea></div>
      <button class="btn-primary btn-sm dr-save" data-cid="${d.campusId}">Enregistrer</button> <span class="status dr-msg" data-cid="${d.campusId}"></span>
    </div>`;
  }).join("")}</div>`;
  const rebind = () => {
    $$(".del-jalon").forEach((b) => (b.onclick = () => b.closest(".jalon-row").remove()));
    $$(".del-obj").forEach((b) => (b.onclick = () => b.closest(".obj-card").remove()));
    $$(".add-jalon").forEach((b) => (b.onclick = () => { b.closest(".jalons").querySelector(".jalons-list").insertAdjacentHTML("beforeend", jalonRow({})); rebind(); }));
  };
  $$(".add-obj").forEach((b) => b.addEventListener("click", () => { $(`.objs[data-cid="${b.dataset.cid}"]`).insertAdjacentHTML("beforeend", objCard({})); rebind(); }));
  rebind();
  $$(".dr-save").forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest("[data-cid]"); const patch = {};
    $$(".dr", card).forEach((i) => (patch[i.dataset.f] = i.value));
    patch.objectivesList = [...$(`.objs[data-cid="${b.dataset.cid}"]`).querySelectorAll(".obj-card")].map((oc) => {
      const o = {}; oc.querySelectorAll(".of").forEach((i) => (o[i.dataset.f] = i.value));
      o.jalons = [...oc.querySelectorAll(".jalon-row")].map((jr) => { const j = {}; jr.querySelectorAll(".jf").forEach((i) => (j[i.dataset.f] = i.value)); j.atteint = jr.querySelector(".jf-atteint")?.checked || false; return j; }).filter((j) => j.libelle);
      return o;
    }).filter((o) => o.titre);
    await api.patch(`/api/campuses/${b.dataset.cid}/director-review`, patch);
    const m = $(`.dr-msg[data-cid="${b.dataset.cid}"]`); if (m) { m.textContent = "✓ Enregistré"; m.classList.add("saved"); }
  }));
}

// ---------- Vue : Emails ----------
async function renderEmails() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="gen-brief">Rafraîchir le brief</button> <button class="btn-ghost btn-sm" id="send-brief">Me l'envoyer par email</button>`;
  $("#gen-brief").addEventListener("click", () => loadBrief(false));
  $("#send-brief").addEventListener("click", () => loadBrief(true));
  const view = $("#view");
  view.innerHTML = `
    <details class="email-config" style="margin-bottom:14px;">
      <summary>Réglages du tri — expéditeurs prioritaires & ignorés</summary>
      <div class="grid grid-2" style="margin-top:12px;">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">⭐ Contacts prioritaires <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0;">— traités en premier</span></div>
        <div class="row" style="align-items:end;gap:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:170px;"><label class="field-label">Email *</label><input class="txt pr-f" data-f="email" type="email" placeholder="prenom@exemple.fr"></div>
          <div><label class="field-label">Nom</label><input class="txt pr-f" data-f="name" placeholder="Nom" style="width:110px;"></div>
          <button class="btn-primary btn-sm" id="pr-add" style="flex:none;">+</button>
        </div>
        <div><label class="field-label" style="margin-top:8px;">Note</label><input class="txt pr-f" data-f="note" placeholder="ex. Rectorat, DAF, partenaire clé"></div>
        <div id="pr-list" class="list" style="margin-top:12px;"></div>
      </div>
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">🔕 À faible priorité <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0;">— regroupés en bas</span></div>
        <div class="row" style="align-items:end;gap:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:170px;"><label class="field-label">Email *</label><input class="txt mu-f" data-f="email" type="email" placeholder="noreply@… / newsletter@…"></div>
          <div><label class="field-label">Nom</label><input class="txt mu-f" data-f="name" placeholder="Nom" style="width:110px;"></div>
          <button class="btn-primary btn-sm" id="mu-add" style="flex:none;">+</button>
        </div>
        <div><label class="field-label" style="margin-top:8px;">Note</label><input class="txt mu-f" data-f="note" placeholder="ex. newsletter, notifs auto"></div>
        <div id="mu-list" class="list" style="margin-top:12px;"></div>
      </div>
      </div>
    </details>
    <div class="card card-pad">
      <div id="brief-meta" class="muted" style="margin-top:0;font-size:13px;"></div>
      <div id="brief-out" class="output" style="margin-top:10px;"><p class="empty">Chargement du dernier brief…</p></div>
    </div>`;
  renderPriorities(); renderMuted();
  $("#pr-add").addEventListener("click", async () => {
    const body = {}; $$(".pr-f").forEach((i) => (body[i.dataset.f] = i.value.trim()));
    if (!body.email || !body.email.includes("@")) { return; }
    const r = await api.post("/api/email/priorities", body);
    if (r?.error) { alert(r.error); return; }
    $$(".pr-f").forEach((i) => (i.value = ""));
    renderPriorities();
  });
  $("#mu-add").addEventListener("click", async () => {
    const body = {}; $$(".mu-f").forEach((i) => (body[i.dataset.f] = i.value.trim()));
    if (!body.email || !body.email.includes("@")) { return; }
    const r = await api.post("/api/email/muted", body);
    if (r?.error) { alert(r.error); return; }
    $$(".mu-f").forEach((i) => (i.value = ""));
    renderMuted();
  });
  const last = await api.get("/api/brief/latest");
  if (last && last.md) {
    $("#brief-meta").innerHTML = `Dernier brief : <strong>${new Date(last.createdAt).toLocaleString("fr-FR")}</strong> · ${last.count ?? "?"} emails. <span class="muted">« Rafraîchir » relit ta boîte (~1 min).</span>`;
    $("#brief-out").innerHTML = mdSafe(last.md);
  } else {
    $("#brief-out").innerHTML = `<p class="empty">Aucun brief encore. Clique « Rafraîchir le brief » pour lire ta boîte (~1 min). Il est aussi généré chaque matin à 7h30.</p>`;
  }
}
async function renderPriorities() {
  const el = $("#pr-list"); if (!el) return;
  const list = await api.get("/api/email/priorities") || [];
  el.innerHTML = list.length
    ? list.map((p) => `<div class="item"><span class="pill good">⭐</span><div class="grow"><div class="ttl">${esc(p.name || p.email)}</div><div class="sub muted">${p.name ? esc(p.email) + " · " : ""}${esc(p.note || "")}</div></div><button class="btn-ghost btn-sm btn-danger pr-del" data-id="${p.id}">Retirer</button></div>`).join("")
    : `<p class="muted" style="font-size:13px;margin:0;">Aucun contact prioritaire. Ajoute les personnes dont les emails doivent remonter en tête du brief (direction, rectorat, partenaires clés…).</p>`;
  $$(".pr-del").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/email/priorities/${b.dataset.id}`); renderPriorities(); }));
}
async function renderMuted() {
  const el = $("#mu-list"); if (!el) return;
  const list = await api.get("/api/email/muted") || [];
  el.innerHTML = list.length
    ? list.map((p) => `<div class="item"><span class="pill">🔕</span><div class="grow"><div class="ttl">${esc(p.name || p.email)}</div><div class="sub muted">${p.name ? esc(p.email) + " · " : ""}${esc(p.note || "")}</div></div><button class="btn-ghost btn-sm btn-danger mu-del" data-id="${p.id}">Retirer</button></div>`).join("")
    : `<p class="muted" style="font-size:13px;margin:0;">Aucun expéditeur ignoré. Ajoute newsletters, notifications automatiques (noreply@…) pour les reléguer en bas du brief.</p>`;
  $$(".mu-del").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/email/muted/${b.dataset.id}`); renderMuted(); }));
}
async function loadBrief(send) {
  const out = $("#brief-out"); const meta = $("#brief-meta");
  out.innerHTML = `<div class="streaming">Lecture de ta boîte Gmail et analyse… (~1 min)</div>`;
  const r = await api.post("/api/daily-brief", { send: !!send });
  if (r && r.ok) {
    if (meta) meta.innerHTML = `Dernier brief : <strong>${new Date(r.createdAt).toLocaleString("fr-FR")}</strong> · ${r.count} emails.`;
    out.innerHTML = mdSafe(r.md) + (send ? `<p class="saved" style="margin-top:10px;">✓ Brief envoyé sur ta boîte.</p>` : "");
  } else {
    out.innerHTML = `<p class="error">${esc(r?.error || "Email non configuré")}</p>`;
  }
}

// ---------- Vue : Risques (incidents & réclamations) ----------
let riskFilter = "all";
// Brouillon de réponse à une réclamation (IA) — relire/éditer/copier avant envoi.
async function draftReclamationReply(id) {
  openModal("Brouillon de réponse (IA)", `
    <p class="muted" id="rep-status" style="margin-top:0;font-size:13px;">Génération… (~10 s)</p>
    <textarea id="rep-txt" rows="12" style="width:100%;display:none;"></textarea>
    <div class="actions" id="rep-actions" style="display:none;"><button class="btn-primary" id="rep-copy">Copier</button></div>`);
  try {
    const r = await api.post(`/api/incidents/${id}/reply-draft`, {});
    if (!r || r.error) { $("#rep-status").textContent = r?.error || "Échec de la génération"; return; }
    $("#rep-status").textContent = r.truncated ? "⚠️ Brouillon tronqué — à compléter avant envoi." : "Brouillon — relis et ajuste avant d'envoyer.";
    const ta = $("#rep-txt"); ta.style.display = ""; ta.value = r.draft || ""; $("#rep-actions").style.display = "";
    $("#rep-copy").onclick = async () => { try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand("copy"); } $("#rep-copy").textContent = "✓ Copié"; };
  } catch (e) { $("#rep-status").textContent = "Erreur réseau"; }
}
async function renderRisques() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-inc">${I.plus}<span>Signaler</span></button>`;
  $("#add-inc").addEventListener("click", () => openIncidentForm(null));
  const view = $("#view");
  view.innerHTML = `<div class="chips" style="margin-bottom:14px;" id="risk-filter">
      <button type="button" class="chip ${riskFilter === "all" ? "active" : ""}" data-f="all">Tout</button>
      <button type="button" class="chip ${riskFilter === "incident" ? "active" : ""}" data-f="incident">Incidents</button>
      <button type="button" class="chip ${riskFilter === "reclamation" ? "active" : ""}" data-f="reclamation">Réclamations</button>
    </div><div id="risk-list"><p class="muted">Chargement…</p></div>`;
  $$("#risk-filter .chip").forEach((c) => c.addEventListener("click", () => { riskFilter = c.dataset.f; renderRisques(); }));
  const items = await api.get("/api/incidents" + (riskFilter !== "all" ? `?kind=${riskFilter}` : "")) || [];
  const sevPill = (s) => ({ faible: "todo", moyen: "doing", eleve: "overdue", critique: "overdue" })[s] || "todo";
  const statLabel = { open: "Ouvert", in_progress: "En cours", closed: "Clôturé" };
  $("#risk-list").innerHTML = items.length ? `<div class="list">${items.map((i) => `
      <div class="card card-pad">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="pill ${i.kind === "reclamation" ? "note_cadrage" : "pnl"}">${i.kind === "reclamation" ? "Réclamation" : "Incident"}</span>
          <span class="pill ${sevPill(i.severity)}">${esc(i.severity)}</span>
          <span class="pill ${i.status === "closed" ? "done" : i.status === "in_progress" ? "doing" : "overdue"}">${statLabel[i.status] || i.status}</span>
          <span style="margin-left:auto;font-size:13px;color:var(--muted);font-family:var(--mono);">${esc(i.date)}</span>
        </div>
        <div class="ttl" style="margin-top:8px;">${esc(i.title)}</div>
        <div class="sub">${i.campusName ? esc(i.campusName) + " · " : ""}${esc(i.category || "")}</div>
        ${i.description ? `<p style="margin:8px 0 0;font-size:14px;">${esc(i.description)}</p>` : ""}
        ${i.resolution ? `<p style="margin:6px 0 0;font-size:13px;color:var(--marine);"><b>Traitement :</b> ${esc(i.resolution)}</p>` : ""}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
          ${i.status !== "in_progress" ? `<button class="btn-ghost btn-sm ist" data-id="${i.id}" data-s="in_progress">En cours</button>` : ""}
          ${i.status !== "closed" ? `<button class="btn-ghost btn-sm ist" data-id="${i.id}" data-s="closed">✓ Clôturer</button>` : ""}
          ${i.status !== "open" ? `<button class="btn-ghost btn-sm ist" data-id="${i.id}" data-s="open">Rouvrir</button>` : ""}
          ${i.kind === "reclamation" ? `<button class="btn-ghost btn-sm irep" data-id="${i.id}">✍️ Réponse (IA)</button>` : ""}
          <button class="btn-ghost btn-sm ied" data-id="${i.id}">Éditer</button>
          <button class="btn-ghost btn-sm btn-danger idl" data-id="${i.id}">Suppr.</button>
        </div>
      </div>`).join("")}</div>` : `<p class="empty">Aucun élément. Clique « Signaler » pour enregistrer un incident ou une réclamation.</p>`;
  $$(".ist").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/incidents/${b.dataset.id}`, { status: b.dataset.s }); renderRisques(); }));
  $$(".irep").forEach((b) => b.addEventListener("click", () => draftReclamationReply(b.dataset.id)));
  $$(".ied").forEach((b) => b.addEventListener("click", () => openIncidentForm(items.find((x) => x.id === b.dataset.id))));
  $$(".idl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ?")) { await api.del(`/api/incidents/${b.dataset.id}`); renderRisques(); } }));
}
function openIncidentForm(inc) {
  const i = inc || {}; const isEdit = !!inc;
  const body = `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Type</label><select class="inf" data-f="kind"><option value="incident" ${i.kind !== "reclamation" ? "selected" : ""}>Incident</option><option value="reclamation" ${i.kind === "reclamation" ? "selected" : ""}>Réclamation</option></select></div>
      <div><label class="field-label">Gravité</label><select class="inf" data-f="severity">${["faible", "moyen", "eleve", "critique"].map((s) => `<option value="${s}" ${(i.severity || "moyen") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div><label class="field-label">Campus</label><select class="inf" data-f="campusId">${campusOptions(i.campusId || state.campus || "")}</select></div>
      <div><label class="field-label">Date</label><input class="txt inf" data-f="date" type="date" value="${esc(i.date || new Date().toISOString().slice(0, 10))}"></div>
      <div style="grid-column:1/3;"><label class="field-label">Catégorie</label><input class="txt inf" data-f="category" value="${esc(i.category || "")}" placeholder="Sécurité · RH · litige famille · réglementaire · pédagogique…"></div>
    </div>
    <div class="field"><label class="field-label">Objet</label><input class="txt inf" data-f="title" value="${esc(i.title || "")}"></div>
    <div class="field"><label class="field-label">Description</label><textarea class="inf" data-f="description" rows="3">${esc(i.description || "")}</textarea></div>
    <div class="field"><label class="field-label">Traitement / résolution</label><textarea class="inf" data-f="resolution" rows="2">${esc(i.resolution || "")}</textarea></div>
    <div class="actions"><button class="btn-primary" id="inc-save">${isEdit ? "Enregistrer" : "Créer"}</button></div>`;
  openModal(isEdit ? "Modifier" : "Signaler un incident / une réclamation", body);
  $("#inc-save").onclick = async () => {
    const patch = {}; $$(".inf").forEach((x) => (patch[x.dataset.f] = x.value));
    if (!patch.title) return;
    patch.campusName = state.campuses.find((c) => c.id === patch.campusId)?.name || "";
    if (isEdit) await api.patch(`/api/incidents/${i.id}`, patch); else await api.post("/api/incidents", patch);
    document.querySelector(".modal-bg")?.remove(); renderRisques();
  };
}

// ---------- Vue : Assistant (chat) ----------
const CHAT_SUGGESTS = [
  "Quels campus appeler aujourd'hui, et pourquoi ?",
  "Prépare mon point hebdo (5 min de lecture)",
  "Synthèse CODIR courte : réseau en 10 lignes",
  "Risques Qualiopi prioritaires ce trimestre",
  "Analyse l'écart budget / réel du réseau",
  "Plan 30 jours pour le campus le plus à risque",
  "Questions à poser au directeur en visite",
  "Arbitrages à remonter au board ce mois-ci",
];
async function renderAssistant() {
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="chat-clear">Nouvelle conversation</button>`;
  $("#chat-clear").addEventListener("click", () => { state.chat = []; renderChatMsgs(); });
  $("#view").innerHTML = `<div class="chat-wrap">
    <div id="chat-msgs" class="chat-msgs"></div>
    <div class="chat-input-wrap">
      <form id="chat-form" class="chat-input">
        <textarea id="chat-text" rows="1" placeholder="Pose ta question à ton assistant…"></textarea>
        <button type="submit" class="chat-send-btn" id="chat-send" aria-label="Envoyer">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
      </form>
      <div class="chat-hint">Entrée pour envoyer · Maj+Entrée = saut de ligne · réponses sans invention</div>
    </div>
  </div>`;
  renderChatMsgs();
  const ta = $("#chat-text");
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; };
  ta.addEventListener("input", grow);
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  ta.focus();
  if (pendingAsk) { ta.value = pendingAsk; pendingAsk = null; sendChat(); }
}
function renderChatMsgs() {
  const el = $("#chat-msgs"); if (!el) return;
  if (!state.chat.length) {
    const prenom = (state.user?.name || "").split(" ")[0];
    el.innerHTML = `<div class="chat-empty">
      <img src="/avatar.png?v=28" class="chat-ava-lg" alt="">
      <h2 class="chat-hello">Bonjour${prenom ? " " + esc(prenom) : ""} 👋</h2>
      <p class="chat-sub">Ton assistant, façon directeur des opérations senior — dense, orienté décision, <strong>sans invention</strong>. Il connaît ton réseau et te dit quand une donnée lui manque.</p>
      <div class="chat-suggests">${CHAT_SUGGESTS.map((s) => `<button type="button" class="chat-suggest" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    </div>`;
    $$(".chat-suggest").forEach((b) => b.addEventListener("click", () => { $("#chat-text").value = b.dataset.q; sendChat(); }));
    return;
  }
  el.innerHTML = state.chat.map((m) => {
    if (m.role === "user") return `<div class="chat-row user"><div class="chat-bubble user">${esc(m.content)}</div></div>`;
    const parsed = m.content ? parseChatMsg(m.content) : { md: "", action: null };
    const bubble = m.content ? mdSafe(parsed.md) : '<span class="chat-typing">rédige…</span>';
    const btn = parsed.action ? `<div class="chat-action"><button class="btn-primary btn-sm chat-mkaction" data-a="${esc(JSON.stringify(parsed.action))}">➕ Créer l'action : ${esc(parsed.action.title)}</button></div>` : "";
    return `<div class="chat-row asst"><img src="/avatar.png?v=28" class="chat-ava" alt=""><div class="chat-bubble asst">${bubble}${btn}</div></div>`;
  }).join("");
  $$(".chat-mkaction").forEach((b) => b.addEventListener("click", () => {
    try { const a = JSON.parse(b.dataset.a); openActionForm({ title: a.title, objectif: a.objectif, moyen: a.moyen, mesures: a.mesures, owner: a.owner, dueDate: a.dueDate, campusId: "", category: "suivi" }); } catch (e) { /* ignore */ }
  }));
  el.scrollTop = el.scrollHeight;
}
function parseChatMsg(content) {
  const m = (content || "").match(/```json\s*([\s\S]*?)```/);
  if (!m) return { md: content, action: null };
  try {
    const d = JSON.parse(m[1]);
    const a = d.proposed_action || (d.action && typeof d.action === "object" ? d.action : null);
    if (a && a.title) return { md: content.replace(/\n?```json[\s\S]*?```/, "").trim(), action: a };
  } catch (e) { /* bloc partiel en cours de stream */ }
  return { md: content, action: null };
}
async function sendChat() {
  const ta = $("#chat-text"); const text = (ta?.value || "").trim(); if (!text) return;
  if (ta) { ta.value = ""; ta.style.height = "auto"; }
  state.chat.push({ role: "user", content: text });
  state.chat.push({ role: "assistant", content: "" });
  const idx = state.chat.length - 1;
  renderChatMsgs();
  const sendBtn = $("#chat-send"); if (sendBtn) sendBtn.disabled = true;
  try {
    const resp = await fetch("/api/chat", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ messages: state.chat.slice(0, -1) }) });
    if (resp.status === 401) return logout(true);
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; state.chat[idx].content += dec.decode(value, { stream: true }); renderChatMsgs(); }
  } catch (e) { state.chat[idx].content = "Erreur : " + (e.message || e); renderChatMsgs(); }
  finally { const s = $("#chat-send"); if (s) s.disabled = false; }
}

// ---------- Vue : Utilisateurs (admin) ----------
async function renderUtilisateurs() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-user">${I.plus}<span>Utilisateur</span></button>`;
  $("#add-user").addEventListener("click", () => openUserForm(null));
  const view = $("#view");
  const users = await api.get("/api/users") || [];
  const campById = Object.fromEntries(state.campuses.map((c) => [c.id, c.name]));
  view.innerHTML = `<div class="list">${users.map((u) => `
    <div class="item">
      <span class="pill ${u.role === "admin" ? "synthese_reseau" : "compte_rendu"}">${u.role === "admin" ? "Admin (DO)" : "Directeur"}</span>
      <div class="grow"><div class="ttl">${esc(u.name || u.email)}${u.active === false ? ' <span class="pill overdue">désactivé</span>' : ""}</div>
        <div class="sub">${esc(u.email)}${u.role === "directeur" ? " · " + ((u.campusIds || []).map((id) => esc(campById[id] || "?")).join(", ") || "aucun campus") : ""}</div></div>
      <button class="btn-ghost btn-sm ued" data-id="${u.id}">Éditer</button>
      <button class="btn-ghost btn-sm btn-danger udl" data-id="${u.id}">Suppr.</button>
    </div>`).join("")}</div>
    <p class="hint muted" style="margin-top:12px;">Un directeur ne voit et ne modifie que le(s) campus qui lui sont attribué(s). L'admin (DO) a accès à tout.</p>`;
  $$(".ued").forEach((b) => b.addEventListener("click", () => openUserForm(users.find((x) => x.id === b.dataset.id))));
  $$(".udl").forEach((b) => b.addEventListener("click", async () => { if (confirm("Supprimer ce compte ?")) { const r = await api.del(`/api/users/${b.dataset.id}`); if (r.error) alert(r.error); renderUtilisateurs(); } }));
}
function openUserForm(u) {
  const isEdit = !!u; u = u || {};
  const camps = state.campuses.map((c) => `<label class="uc-camp"><input type="checkbox" class="uc" value="${c.id}" ${(u.campusIds || []).includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("");
  openModal(isEdit ? "Modifier l'utilisateur" : "Nouvel utilisateur", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
      <div><label class="field-label">Nom</label><input class="txt uf" data-f="name" value="${esc(u.name || "")}"></div>
      <div><label class="field-label">Email</label><input class="txt uf" data-f="email" type="email" value="${esc(u.email || "")}"></div>
      <div><label class="field-label">Rôle</label><select class="uf" data-f="role"><option value="directeur" ${u.role !== "admin" ? "selected" : ""}>Directeur (accès à son campus)</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin (DO — accès total)</option></select></div>
      <div><label class="field-label">${isEdit ? "Nouveau mot de passe (option.)" : "Mot de passe initial"}</label><input class="txt uf" data-f="password" type="text" placeholder="min. 8 caractères"></div>
    </div>
    ${isEdit ? `<div class="field"><label class="uc-camp"><input type="checkbox" id="uf-active" ${u.active !== false ? "checked" : ""}> Compte actif <span class="muted">(décocher = login bloqué)</span></label></div>` : ""}
    <div class="field" id="camps-field"><label class="field-label">Campus autorisés</label><div class="uc-list">${camps || '<span class="muted">Aucun campus créé.</span>'}</div></div>
    <div class="actions"><button class="btn-primary" id="user-save">${isEdit ? "Enregistrer" : "Créer"}</button> <span id="user-msg" class="status"></span></div>`);
  const toggleCamps = () => { $("#camps-field").style.display = $('.uf[data-f="role"]').value === "admin" ? "none" : "block"; };
  $('.uf[data-f="role"]').addEventListener("change", toggleCamps); toggleCamps();
  $("#user-save").onclick = async () => {
    const patch = {}; $$(".uf").forEach((i) => { if (i.dataset.f === "password") { if (i.value) patch.password = i.value; } else patch[i.dataset.f] = i.value; });
    patch.campusIds = [...document.querySelectorAll(".uc:checked")].map((x) => x.value);
    if (isEdit && $("#uf-active")) patch.active = $("#uf-active").checked;
    const msg = $("#user-msg");
    if (!patch.email) { msg.textContent = "Email requis"; return; }
    if (!isEdit && (!patch.password || patch.password.length < 8)) { msg.textContent = "Mot de passe initial (min. 8) requis"; return; }
    const r = isEdit ? await api.patch(`/api/users/${u.id}`, patch) : await api.post("/api/users", patch);
    if (r.error) { msg.textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove(); renderUtilisateurs();
  };
}

// ---------- Modal ----------
// ---------- Helpers partagés (Finance / Insertion / Réseau) ----------
function fkpi(v, l, tone) { return `<div class="kpi${tone ? " kpi-" + tone : ""}"><div class="v">${v}</div><div class="k">${l}</div></div>`; }
const eur = (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " €");
function healthBadge(v, detail) {
  if (v == null) return '<span class="muted">—</span>';
  const t = v >= 75 ? "good" : v >= 50 ? "warn" : "bad";
  const tip = detail && detail.length ? ` title="Détail — ${detail.map((d) => d.label + " " + d.score).join(" · ")}"` : "";
  return `<span class="health-badge h-${t}"${tip}>${v}</span>`;
}
// Flèche de tendance M-1 (vert = hausse, considérée favorable pour ces métriques)
function deltaArrow(v, unit, dec) {
  if (v == null || v === 0) return "";
  const up = v > 0, a = Math.abs(v);
  const disp = dec ? a.toFixed(1) : Math.round(a).toLocaleString("fr-FR");
  return ` <span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"}${disp}${unit || ""}</span>`;
}

// ---------- Vue : Notifications ----------
// Redirection héritée : la vue « notifications » vit désormais dans Priorités & alertes.
function renderNotifications() { prioTab = "alertes"; setView("priorites"); }

async function renderAlertesInto(view) {
  const n = await api.get("/api/notifications") || [];
  notifCount = n.length; renderNav();
  if (!n.length) { view.innerHTML = `<p class="empty">Rien à signaler — tout est à jour 👌</p>`; return; }
  const sevLabel = { high: "Urgent", medium: "À suivre", low: "Information" };
  const typeLabel = { action: "Action", visite: "Visite", qualiopi: "Qualiopi", incident: "Incident", admissions: "Admissions", ouverture: "Ouverture", rupture: "Rupture", absenteisme: "Absentéisme", si: "SI campus" };
  const canAct = { qualiopi: 1, incident: 1, admissions: 1, ouverture: 1, visite: 1, rupture: 1, absenteisme: 1 };
  const groups = { high: [], medium: [], low: [] };
  n.forEach((x) => (groups[x.severity] || groups.low).push(x));
  view.innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([sev, items]) => `
    <div class="section-title" style="margin-top:6px;">${sevLabel[sev]} <span class="muted">(${items.length})</span></div>
    <div class="list">${items.map((x) => `<div class="notif-item sev-${sev}" data-type="${x.type}" data-campus="${x.campusId || ""}" role="button" tabindex="0">
      <span class="notif-type">${typeLabel[x.type] || x.type}</span>
      <div class="grow"><div class="ttl">${esc(x.label)}</div><div class="sub muted">${esc(x.campus || "")}${x.date ? " · " + esc(x.date) : ""}</div></div>
      ${canAct[x.type] ? `<button class="btn-ghost btn-sm notif-act" data-label="${esc(x.label)}" data-campus="${x.campusId || ""}" data-campusname="${esc(x.campus || "")}">→ Action</button>` : ""}
      <span class="notif-go">Ouvrir →</span>
    </div>`).join("")}</div>`).join("");
  $$("#view .notif-item").forEach((el) => el.addEventListener("click", () => openNotif(el.dataset.type, el.dataset.campus)));
  $$("#view .notif-act").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    openActionForm({ title: b.dataset.label, campusId: b.dataset.campus || "", campusName: b.dataset.campusname || "", category: "suivi" });
  }));
}
function openNotif(type, campusId) {
  const routes = { action: "actions", visite: "tournee", qualiopi: "qualiopi", incident: "risques", admissions: "admissions", ouverture: "ouvertures", rupture: "si", absenteisme: "si", si: "si" };
  if (type === "qualiopi" && campusId) qCampus = campusId;
  if (routes[type]) return setView(routes[type]);
  if (campusId) return openCampus360(campusId);
}

// ---------- Vue : Finance (budget vs réalisé) ----------
let finMode = "month";
function finToolbar() {
  $("#topbar-actions").innerHTML = `
    <div class="chips" id="fin-mode">
      <button type="button" class="chip ${finMode === "month" ? "active" : ""}" data-m="month">Mois</button>
      <button type="button" class="chip ${finMode === "annual" ? "active" : ""}" data-m="annual">Cumul année</button>
      <button type="button" class="chip ${finMode === "sim" ? "active" : ""}" data-m="sim">Prospective</button>
    </div>
    <button class="btn-ghost btn-sm" id="fin-xlsx">Excel</button>
    <button class="btn-ghost btn-sm" id="fin-print">Imprimer</button>`;
  $$("#fin-mode .chip").forEach((c) => c.addEventListener("click", () => { finMode = c.dataset.m; renderFinance(); }));
  $("#fin-xlsx").addEventListener("click", () => { location.href = "/api/export/finance"; });
  $("#fin-print").addEventListener("click", () => window.print());
}
async function renderFinance() {
  finToolbar();
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  if (finMode === "annual") return renderFinanceAnnual(view);
  if (finMode === "sim") return renderFinanceSim(view);
  const rows = await api.get("/api/finance") || [];
  if (!rows.length) { view.innerHTML = `<p class="empty">Ajoute des campus, puis saisis leurs données financières (bouton « Saisir »).</p>`; return; }
  const tot = rows.reduce((s, r) => ({ revenue: s.revenue + (r.revenue || 0), budget: s.budget + (r.budget || 0), margin: s.margin + (r.margin || 0) }), { revenue: 0, budget: 0, margin: 0 });
  const totEcart = tot.budget ? Math.round(((tot.revenue - tot.budget) / tot.budget) * 100) : null;
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:14px;">
      ${fkpi(eur(tot.revenue), "CA réel réseau (mois)")}
      ${fkpi(totEcart == null ? "—" : (totEcart > 0 ? "+" : "") + totEcart + " %", "Écart au budget", totEcart != null && totEcart < 0 ? "bad" : "good")}
      ${fkpi(eur(tot.margin), "Marge nette réseau")}
      ${fkpi(tot.revenue ? Math.round((tot.margin / tot.revenue) * 100) + " %" : "—", "Taux de marge")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Campus</th><th>Mois</th><th>CA réel</th><th>Budget</th><th>Écart</th><th>Masse sal.</th><th>Charges</th><th>Marge</th><th>Coût/étud.</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><div class="ttl fin-detail" data-cid="${r.id}">${esc(r.name)}</div><div class="sub muted">${esc(r.city || "")}</div></td>
        <td>${r.month || "—"}</td><td>${eur(r.revenue)}${deltaArrow(r.revenueDelta, "€")}</td><td>${eur(r.budget)}</td>
        <td class="${r.ecart != null && r.ecart < 0 ? "cell-warn" : ""}">${r.ecart == null ? "—" : (r.ecart > 0 ? "+" : "") + r.ecart + " %"}</td>
        <td>${eur(r.payroll)}</td><td>${eur(r.charges)}</td>
        <td class="${r.marginPct != null && r.marginPct < 0 ? "cell-warn" : ""}">${eur(r.margin)}${r.marginPct != null ? ` <span class="muted">(${r.marginPct}%)</span>` : ""}${deltaArrow(r.marginDelta, "€")}</td>
        <td>${eur(r.costPerStudent)}</td>
        <td><button class="btn-ghost btn-sm fin-edit" data-cid="${r.id}" data-name="${esc(r.name)}" data-month="${r.month || ""}">Saisir</button></td>
      </tr>`).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Clique un campus pour le <strong>détail mensuel</strong> et ventiler ses postes. Marge = CA réel − masse salariale − charges. La saisie met à jour le dernier mois (partagé avec Indicateurs).</p>`;
  $$(".fin-edit").forEach((b) => b.addEventListener("click", () => openFinanceForm(b.dataset.cid, b.dataset.name, b.dataset.month)));
  $$(".fin-detail").forEach((b) => b.addEventListener("click", () => openFinanceDetail(rows.find((r) => r.id === b.dataset.cid))));
}
async function renderFinanceAnnual(view) {
  const data = await api.get("/api/finance/annual") || {};
  const rows = data.rows || [];
  if (!rows.some((r) => r.months)) { view.innerHTML = `<p class="empty">Aucune donnée financière sur l'exercice ${esc(data.schoolYear || "")}. Saisis quelques mois (onglet Finance › Mois, ou Indicateurs).</p>`; return; }
  const tot = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, budget: s.budget + r.budget, margin: s.margin + r.margin, projection: s.projection + (r.projection || 0) }), { revenue: 0, budget: 0, margin: 0, projection: 0 });
  const totEcart = tot.budget ? Math.round(((tot.revenue - tot.budget) / tot.budget) * 100) : null;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Exercice ${esc(data.schoolYear)} — cumul depuis septembre</div>
    <div class="kpis" style="margin-bottom:14px;">
      ${fkpi(eur(tot.revenue), "CA réel cumulé")}
      ${fkpi(totEcart == null ? "—" : (totEcart > 0 ? "+" : "") + totEcart + " %", "Écart au budget YTD", totEcart != null && totEcart < 0 ? "bad" : "good")}
      ${fkpi(eur(tot.margin), "Marge cumulée")}
      ${fkpi(eur(tot.projection), "Projection fin d'exercice", "good")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Campus</th><th>Mois saisis</th><th>CA cumulé</th><th>Budget cumulé</th><th>Écart</th><th>Marge</th><th>Coût/étud.</th><th>Projection annuelle</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><div class="ttl fin-detail" data-cid="${r.id}">${esc(r.name)}</div><div class="sub muted">${esc(r.city || "")}</div></td>
        <td>${r.months || 0}/12</td><td>${eur(r.revenue)}</td><td>${eur(r.budget)}</td>
        <td class="${r.ecart != null && r.ecart < 0 ? "cell-warn" : ""}">${r.ecart == null ? "—" : (r.ecart > 0 ? "+" : "") + r.ecart + " %"}</td>
        <td class="${r.marginPct != null && r.marginPct < 0 ? "cell-warn" : ""}">${eur(r.margin)}${r.marginPct != null ? ` <span class="muted">(${r.marginPct}%)</span>` : ""}</td>
        <td>${eur(r.costPerStudent)}</td>
        <td>${eur(r.projection)}</td>
      </tr>`).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Clique un campus pour le détail mensuel. Cumul de l'année scolaire (sept → août). Projection = CA cumulé rapporté à 12 mois.</p>`;
  $$(".fin-detail").forEach((b) => b.addEventListener("click", () => openFinanceDetail(rows.find((r) => r.id === b.dataset.cid))));
}

// ---------- Finance › Prospective (simulation EBIT annuel) ----------
let simTarget = null;
async function renderFinanceSim(view) {
  const fin = await api.get("/api/finance") || [];
  state.campuses = await api.get("/api/campuses") || state.campuses || [];
  const base = fin.filter((r) => r.revenue != null).map((r) => ({ id: r.id, name: r.name, city: r.city, rev: (r.revenue || 0) * 12, pay: (r.payroll || 0) * 12, chg: (r.charges || 0) * 12 }));
  if (!base.length) { view.innerHTML = `<p class="empty">Renseigne d'abord la finance d'au moins un campus (onglet Finance › Mois). La prospective annualise le dernier mois connu (× 12).</p>`; return; }
  if (simTarget == null) { let t = 0; try { t = Number(localStorage.getItem("cm_sim_target")) || 0; } catch (e) { /* ignore */ } simTarget = t; }
  const baseEbit = base.reduce((s, b) => s + (b.rev - b.pay - b.chg), 0);
  if (!simTarget) simTarget = Math.round(baseEbit * 1.15 / 1000) * 1000; // cible par défaut = +15 %
  const lever = (k, l) => `<div class="sim-lever-row">
    <label class="field-label" style="margin:0;">${l}</label>
    <input type="range" class="sim-lever" data-k="${k}" min="-20" max="40" step="1" value="0">
    <span class="sim-lever-val" id="sim-lev-${k}-val">+0 %</span></div>`;
  view.innerHTML = `
    ${isAdmin() ? '<div class="card card-pad" id="sim-scenarios" style="margin-bottom:14px;"></div>' : ""}
    <div class="grid grid-2" style="gap:14px;margin-bottom:14px;">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Objectif</div>
        <label class="field-label">EBIT annuel réseau visé (€)</label>
        <input class="txt" id="sim-target" type="number" step="1000" value="${simTarget}" style="max-width:220px;">
        <p class="hint muted" style="margin-top:8px;">EBIT = résultat d'exploitation = CA − masse salariale − autres charges. Baseline = dernier mois annualisé (× 12).</p>
      </div>
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Leviers globaux</div>
        ${lever("rev", "Évolution du CA")}
        ${lever("pay", "Évolution masse salariale")}
        ${lever("chg", "Évolution autres charges")}
        <p class="hint muted" style="margin-top:6px;">Un levier réécrit les valeurs simulées de tous les campus (tu peux ensuite ajuster campus par campus).</p>
      </div>
    </div>
    <div id="sim-synth"></div>
    <div class="card" style="overflow-x:auto;margin-top:14px;"><table class="net-table">
      <thead><tr><th>Campus</th><th>CA simulé (an)</th><th>Masse sal.</th><th>Autres charges</th><th>EBIT</th><th>Marge</th></tr></thead>
      <tbody id="sim-body">${base.map((b) => `<tr>
        <td><div class="ttl">${esc(b.name)}</div><button class="btn-ghost btn-sm sim-fine" data-id="${b.id}" style="margin-top:4px;">P&L détaillé</button></td>
        <td><input class="txt sim-in" data-k="rev" data-id="${b.id}" data-base="${b.rev}" type="number" step="1000" value="${b.rev}" style="width:130px;"></td>
        <td><input class="txt sim-in" data-k="pay" data-id="${b.id}" data-base="${b.pay}" type="number" step="1000" value="${b.pay}" style="width:120px;"></td>
        <td><input class="txt sim-in" data-k="chg" data-id="${b.id}" data-base="${b.chg}" type="number" step="1000" value="${b.chg}" style="width:120px;"></td>
        <td class="sim-ebit"></td><td class="sim-marg"></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm" id="sim-reset">Réinitialiser</button><button class="btn-primary btn-sm" id="sim-apply">Appliquer comme budget mensuel</button><span id="sim-msg" class="status"></span></div>
    <p class="hint muted" style="margin-top:8px;">« Appliquer comme budget » écrit CA simulé ÷ 12 dans le budget du dernier mois de chaque campus (comparaison budget vs réalisé).</p>`;
  const persist = () => { try { localStorage.setItem("cm_sim_target", String($("#sim-target").value || 0)); } catch (e) { /* ignore */ } };
  $("#sim-target").addEventListener("input", () => { persist(); simRecompute(); });
  $$(".sim-lever").forEach((s) => s.addEventListener("input", () => {
    const k = s.dataset.k, f = 1 + (+s.value) / 100;
    $(`#sim-lev-${k}-val`).textContent = (s.value > 0 ? "+" : "") + s.value + " %";
    $$(`.sim-in[data-k="${k}"]`).forEach((inp) => { inp.value = Math.round((+inp.dataset.base || 0) * f); });
    simRecompute();
  }));
  $$(".sim-in").forEach((i) => i.addEventListener("input", simRecompute));
  $$(".sim-fine").forEach((b) => b.addEventListener("click", () => openSimFine(base.find((x) => x.id === b.dataset.id), b.closest("tr"))));
  if (isAdmin()) renderScenarioBar();
  $("#sim-reset").addEventListener("click", () => renderFinance());
  $("#sim-apply").addEventListener("click", async () => {
    if (!confirm("Écrire le CA simulé ÷ 12 comme budget mensuel de chaque campus ?")) return;
    $("#sim-msg").textContent = "Application…";
    let n = 0;
    for (let idx = 0; idx < base.length; idx++) {
      const tr = $$("#sim-body tr")[idx];
      const rev = +$('.sim-in[data-k="rev"]', tr).value || 0;
      const f = fin.find((x) => x.id === base[idx].id);
      const month = f?.month || new Date().toISOString().slice(0, 7);
      await api.post("/api/kpi", { campusId: base[idx].id, month, revenueBudget: Math.round(rev / 12) });
      n++;
    }
    $("#sim-msg").textContent = `Budget appliqué à ${n} campus.`;
  });
  simRecompute();
}
function simRecompute() {
  let tR = 0, tP = 0, tC = 0;
  $$("#sim-body tr").forEach((tr) => {
    const rev = +$('.sim-in[data-k="rev"]', tr).value || 0, pay = +$('.sim-in[data-k="pay"]', tr).value || 0, chg = +$('.sim-in[data-k="chg"]', tr).value || 0;
    const ebit = rev - pay - chg; tR += rev; tP += pay; tC += chg;
    const ec = $(".sim-ebit", tr), mg = $(".sim-marg", tr);
    ec.textContent = eur(ebit); ec.className = "sim-ebit" + (ebit < 0 ? " cell-warn" : "");
    mg.textContent = rev ? Math.round(ebit / rev * 100) + " %" : "—";
  });
  const ebit = tR - tP - tC, target = +($("#sim-target")?.value) || 0;
  const gap = ebit - target, reached = gap >= 0;
  const pct = target ? Math.max(0, Math.min(100, Math.round(ebit / target * 100))) : 0;
  const needRev = !reached ? -gap : 0; // + de CA à charges constantes
  const el = $("#sim-synth"); if (!el) return;
  el.innerHTML = `<div class="card card-pad">
    <div class="kpis" style="margin-bottom:12px;">
      ${fkpi(eur(tR), "CA réseau (an)")}
      ${fkpi(eur(ebit), "EBIT simulé", ebit < 0 ? "bad" : "good")}
      ${fkpi(tR ? Math.round(ebit / tR * 100) + " %" : "—", "Marge d'EBIT")}
      ${fkpi((gap >= 0 ? "+" : "") + eur(gap), reached ? "Objectif atteint ✓" : "Écart à l'objectif", reached ? "good" : "bad")}
    </div>
    <div class="sim-gauge"><div class="sim-gauge-fill ${reached ? "ok" : ""}" style="width:${pct}%"></div></div>
    <div class="sim-gauge-lbl muted">${pct}% de l'objectif (${eur(target)})</div>
    ${!reached ? `<p class="hint" style="margin-top:10px;color:var(--danger);">Pour atteindre l'objectif : <strong>+${eur(needRev)}</strong> de CA à charges constantes (soit ${tR ? "+" + Math.round(needRev / tR * 100) + "%" : "—"}), ou <strong>−${eur(needRev)}</strong> de charges.</p>` : `<p class="hint" style="margin-top:10px;color:var(--marine);">Objectif atteint avec ${eur(gap)} de marge de sécurité. 🎯</p>`}
  </div>`;
}
// --- Scénarios de prospective ---
function simRows() {
  return $$("#sim-body tr").map((tr) => ({
    id: $('.sim-in[data-k="rev"]', tr).dataset.id, name: ($(".ttl", tr)?.textContent || "").trim(),
    rev: +$('.sim-in[data-k="rev"]', tr).value || 0, pay: +$('.sim-in[data-k="pay"]', tr).value || 0, chg: +$('.sim-in[data-k="chg"]', tr).value || 0,
  }));
}
async function renderScenarioBar() {
  const el = $("#sim-scenarios"); if (!el) return;
  const scs = await api.get("/api/scenarios") || [];
  el.innerHTML = `<div class="section-title" style="margin-top:0;">Scénarios</div>
    <div class="row" style="align-items:end;gap:10px;">
      <div><label class="field-label">Enregistrés</label><select id="sc-select"><option value="">— choisir —</option>${scs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <button class="btn-ghost btn-sm" id="sc-load">Charger</button>
      <button class="btn-ghost btn-sm btn-danger" id="sc-del">Supprimer</button>
      <button class="btn-primary btn-sm" id="sc-save">Enregistrer le scénario actuel</button>
      <button class="btn-ghost btn-sm" id="sc-compare"${scs.length ? "" : " disabled"}>Comparer tout</button>
    </div><div id="sc-compare-out"></div>`;
  $("#sc-save").onclick = async () => {
    const name = prompt("Nom du scénario :", "Scénario " + new Date().toLocaleDateString("fr-FR")); if (!name) return;
    await api.post("/api/scenarios", { name, target: +$("#sim-target").value || 0, rows: simRows() });
    renderScenarioBar();
  };
  $("#sc-load").onclick = () => { const s = scs.find((x) => x.id === $("#sc-select").value); if (s) loadScenario(s); };
  $("#sc-del").onclick = async () => { const id = $("#sc-select").value; if (!id || !confirm("Supprimer ce scénario ?")) return; await api.del(`/api/scenarios/${id}`); renderScenarioBar(); };
  $("#sc-compare").onclick = () => compareScenarios(scs);
}
function loadScenario(s) {
  if ($("#sim-target")) { $("#sim-target").value = s.target; try { localStorage.setItem("cm_sim_target", String(s.target)); } catch (e) { /* ignore */ } }
  $$("#sim-body tr").forEach((tr) => {
    const id = $('.sim-in[data-k="rev"]', tr).dataset.id;
    const r = (s.rows || []).find((x) => x.id === id);
    if (r) { $('.sim-in[data-k="rev"]', tr).value = r.rev; $('.sim-in[data-k="pay"]', tr).value = r.pay; $('.sim-in[data-k="chg"]', tr).value = r.chg; }
  });
  simRecompute();
}
function compareScenarios(scs) {
  const out = $("#sc-compare-out"); if (!out) return;
  const cur = { name: "Scénario en cours", target: +$("#sim-target").value || 0, rows: simRows() };
  const data = [cur, ...scs].map((s) => {
    const ca = s.rows.reduce((a, r) => a + r.rev, 0), pay = s.rows.reduce((a, r) => a + r.pay, 0), chg = s.rows.reduce((a, r) => a + r.chg, 0);
    const ebit = ca - pay - chg; return { name: s.name, ca, ebit, marg: ca ? Math.round(ebit / ca * 100) : 0, target: s.target, gap: ebit - s.target };
  });
  out.innerHTML = `<div class="card" style="overflow-x:auto;margin-top:12px;"><table class="net-table">
    <thead><tr><th>Scénario</th><th>CA (an)</th><th>EBIT</th><th>Marge</th><th>Objectif</th><th>Écart</th></tr></thead>
    <tbody>${data.map((d) => `<tr><td>${esc(d.name)}</td><td>${eur(d.ca)}</td><td class="${d.ebit < 0 ? "cell-warn" : ""}">${eur(d.ebit)}</td><td>${d.marg} %</td><td>${eur(d.target)}</td><td class="${d.gap >= 0 ? "" : "cell-warn"}">${(d.gap >= 0 ? "+" : "") + eur(d.gap)}</td></tr>`).join("")}</tbody></table></div>`;
}
// --- Pilotage fin d'un campus (filières + postes ventilés) ---
// Modèle par ligne : Réel (figé) + Ajustement (± pour viser l'objectif) = Simulé.
// Affiche les DEUX pourcentages : % réel et % objectif (part dans le P&L simulé).
function fineRow(cat, l, fam) {
  l = l || {};
  const base = l.base != null ? l.base : (l.amount != null ? l.amount : 0);
  const adj = l.adj != null ? l.adj : 0;
  const famSel = (fam && fam !== "revenue")
    ? `<select class="fine-fam" title="famille P&L">${[["cogs", "COGS"], ["payroll", "Payroll"], ["docs", "DOCS"], ["da", "D&A"]].map(([v, t]) => `<option value="${v}" ${fam === v ? "selected" : ""}>${t}</option>`).join("")}</select>`
    : "";
  return `<div class="fine-row" data-cat="${cat}" data-base="${base}">
    <input class="txt fine-lbl" value="${esc(l.label || "")}" placeholder="Poste">
    <span class="fine-real num" title="réel">${eur(base)}</span>
    ${famSel}
    <span class="fine-adjw"><input class="txt fine-adj" type="number" step="1000" value="${adj}" title="à ajouter (+) ou retirer (−) pour l'objectif" placeholder="±0"></span>
    <span class="fine-sim num" title="simulé">= <b>${eur(base + adj)}</b></span>
    <button type="button" class="btn-ghost btn-sm btn-danger fine-del" title="Supprimer">✕</button>
    <span class="fine-cmp"></span>
  </div>`;
}
function fineRowVal(r) { return (+r.dataset.base || 0) + (+$(".fine-adj", r).value || 0); }
// Classe une ligne de charges dans une famille P&L : COGS (coûts directs) / DOCS (charges
// d'exploitation) / D&A (amortissements). Revenue et Payroll ont leur propre section.
function famAnglo(cat, label) {
  const s = (label || "").toLowerCase();
  if (/amortiss|dotation|provision/.test(s)) return "da";
  if (/p[ée]dago|fourniture|mat[ée]riel|support|manuel|examen|certification|documentation|intervenant|cr[ée]ation|contenu|production|plateforme|e-?learning|lms|ressource|d[ée]veloppement|licence/.test(s)) return "cogs";
  return "docs";
}
// Bibliothèque de leviers (axes concrets, école post-bac) selon le poste et le sens.
function leversFor(dir, label) {
  const s = (label || "").toLowerCase();
  const out = []; const push = (arr) => arr.forEach((x) => { if (!out.includes(x)) out.push(x); });
  if (/loyer/.test(s)) push(["Renégocier le bail (durée, franchise, indexation)", "Sous-louer / mutualiser les salles inoccupées", "Réduire la surface ou passer en flex office"]);
  else if (/marketing|communic|acquisition|pub/.test(s)) push(["Recentrer le budget sur les canaux au meilleur coût d'acquisition", "Développer l'acquisition organique (SEO, réseaux, alumni)", "Parrainage étudiant + CRM de nurturing des candidats", "Couper les salons à faible conversion"]);
  else if (/vacataire|intervenant|enseignant|formateur/.test(s)) push(["Optimiser la taille des groupes & mutualiser les cours", "Arbitrer permanents vs vacataires selon la charge", "Mutualiser des modules transverses entre campus (co-modal)"]);
  else if (/altern|opco/.test(s)) push(["Signer plus d'entreprises partenaires (financement OPCO, coût étudiant nul)", "Développer les contrats de professionnalisation", "Renforcer la cellule relations entreprises"]);
  else if (/scolar|frais|inscription/.test(s)) push(["Augmenter le remplissage : JPO, salons, Parcoursup, relances candidats", "Différencier le pricing par filière (initial / alternance)", "Ouvrir une filière ou un mastère à plus forte valeur"]);
  else if (/[ée]nergie|fluide|eau/.test(s)) push(["Plan de sobriété énergétique", "Contrats d'énergie groupés au niveau réseau"]);
  else if (/fourniture|contenu|cr[ée]ation|p[ée]dago|licence|plateforme|lms|ressource/.test(s)) push(["Mutualiser la production de contenus entre campus/filières", "Négocier des licences groupées réseau", "Capitaliser & réutiliser les supports existants"]);
  else if (/sous-?trait|prestation|honoraire/.test(s)) push(["Mettre en concurrence (appels d'offres, contrats-cadres réseau)", "Internaliser les prestations récurrentes"]);
  else if (/formation continue/.test(s)) push(["Catalogue court certifiant pour entreprises (B2B)", "Partenariats OPCO & branches professionnelles"]);
  if (dir === "rev_up") push(["Actionner l'alternance et la formation continue B2B", "Améliorer la rétention en cours d'année (tutorat, suivi)"]);
  else if (dir === "cost_up") push(["Justifier la hausse par le ROI et l'échelonner", "Chercher une compensation sur un autre poste"]);
  else push(["Benchmark vs les autres campus du réseau", "Cible chiffrée + responsable (RACI) + échéance"]);
  return out.slice(0, 4);
}
async function openSimFine(baseRow, tr) {
  if (!baseRow) return;
  const camp = (state.campuses || []).find((c) => c.id === baseRow.id) || {};
  const hist = await api.get(`/api/kpi?campusId=${baseRow.id}`) || [];
  const k = hist[hist.length - 1] || {};
  const month = k.month || new Date().toISOString().slice(0, 7);
  const postes = k.postes || {};
  const filSum = (camp.filieres && camp.filieres.length) ? camp.filieres.reduce((s, f) => s + (f.effectif || 0), 0) : 0;
  const students = filSum || camp.students || k.students || null;
  const target = +($("#sim-target")?.value) || 0;
  // Grandes familles P&L : Revenue · COGS (coûts directs) · Payroll · DOCS (charges d'exploit.) · D&A.
  const FAMS = [
    { k: "revenue", l: "Produits (Revenue)", store: "revenue", cls: "prod" },
    { k: "cogs", l: "COGS — coûts directs", store: "charges", cls: "chg" },
    { k: "payroll", l: "Payroll — masse salariale", store: "payroll", cls: "chg" },
    { k: "docs", l: "DOCS — charges d'exploitation", store: "charges", cls: "chg" },
    { k: "da", l: "D&A — amortissements", store: "charges", cls: "chg" },
  ];
  const linesFor = (cat) => (postes[cat] && postes[cat].length ? postes[cat] : ventilate(cat, k[cat])).map((l) => { const a = Math.round((Number(l.amount) || 0) * 12); return { label: l.label, amount: a, base: a }; });
  const chargeByFam = { cogs: [], docs: [], da: [] };
  linesFor("charges").forEach((l) => chargeByFam[famAnglo("charges", l.label)].push(l));
  const famLines = { revenue: linesFor("revenue"), payroll: linesFor("payroll"), cogs: chargeByFam.cogs, docs: chargeByFam.docs, da: chargeByFam.da };
  const sec = (f) => `<div class="pnl-sec-head ${f.cls}">${f.l}<span class="pnl-sec-tot" data-tot="${f.k}"></span></div><div class="fine-sec" id="fr-${f.k}">${(famLines[f.k] || []).map((l) => fineRow(f.store, l, f.k)).join("")}</div><button type="button" class="btn-ghost btn-sm fine-add" data-cat="${f.store}" data-sec="fr-${f.k}">+ Ligne</button>`;
  const filBlock = (camp.filieres && camp.filieres.length) ? `<div class="pnl-sec-head sub">Pilotage par filière (effectif × frais → CA scolarité, live)</div>
    <div id="fr-fil">${camp.filieres.map((f) => `<div class="fine-row fil-row"><span class="grow">${MODALITE_BADGE[f.modalite] || ""} ${filiereLabel(f)}${f.capacite ? ` <span class="muted">/${f.capacite} pl.</span>` : ""}</span>
      <input class="txt fil-eff" type="number" value="${f.effectif || 0}" title="effectif" style="width:66px;"> <span class="fine-x">×</span>
      <input class="txt fil-frais" type="number" value="${f.frais || 0}" title="frais annuels" style="width:88px;">
      <span class="fil-ca num" style="width:104px;text-align:right;font-weight:700;"></span></div>`).join("")}</div>
    <label class="jal-chk" style="margin-top:6px;"><input type="checkbox" id="fil-drive" checked> Piloter automatiquement « Frais de scolarité » depuis les filières</label>` : "";
  openModal(`P&L dynamique — ${baseRow.name}`, `
    <p class="hint muted" style="margin-top:0;">Structure P&L : <strong>Revenue − COGS = Marge brute → − Payroll − DOCS = EBITDA → − D&A = EBIT</strong>. Par ligne : réel figé · <strong>±</strong> ajustement · = simulé (% réel & % objectif). En direct.</p>
    <div class="pnl-sim">
      <div class="pnl-edit">
        ${sec(FAMS[0])}
        ${filBlock}
        ${sec(FAMS[1])}${sec(FAMS[2])}${sec(FAMS[3])}${sec(FAMS[4])}
      </div>
      <div class="pnl-live" id="pnl-live"></div>
    </div>
    <div class="actions" style="margin-top:14px;flex-wrap:wrap;">
      <button class="btn-ghost btn-sm" id="fine-reset">Réinitialiser</button>
      <button class="btn-ghost btn-sm" id="fine-export">Exporter PDF</button>
      <button class="btn-ghost btn-sm" id="fine-plan">Proposer un plan d'action</button>
      <button class="btn-ghost btn-sm" id="fine-save">Enregistrer dans la finance</button>
      <button class="btn-primary" id="fine-apply">Appliquer au scénario</button>
    </div>`);
  const modal = $("#pnl-live").closest(".modal");
  const sumFam = (kf) => $$(`#fr-${kf} .fine-row`).reduce((s, r) => s + fineRowVal(r), 0);
  const realFam = (kf) => $$(`#fr-${kf} .fine-row`).reduce((s, r) => s + (+r.dataset.base || 0), 0);
  const recalc = () => {
    const rev = sumFam("revenue"), cogs = sumFam("cogs"), pay = sumFam("payroll"), docs = sumFam("docs"), da = sumFam("da");
    const rRev = realFam("revenue"), rCogs = realFam("cogs"), rPay = realFam("payroll"), rDocs = realFam("docs"), rDa = realFam("da");
    const gm = rev - cogs, ebitda = gm - pay - docs, ebit = ebitda - da;
    const rEbit = rRev - rCogs - rPay - rDocs - rDa;
    const totCost = cogs + pay + docs + da;
    const marge = rev ? Math.round(ebit / rev * 100) : null;
    const cps = students ? Math.round(totCost / students) : null;
    const caPerStu = students && rev ? rev / students : null;
    const be = caPerStu ? Math.ceil(totCost / caPerStu) : null;
    $$(".pnl-sec-tot").forEach((el) => { el.textContent = eur(sumFam(el.dataset.tot)); });
    $$(".fine-row", modal).forEach((r) => {
      if (r.classList.contains("fil-row")) return;
      const b = +r.dataset.base || 0, val = fineRowVal(r), adj = val - b;
      const sim = $(".fine-sim b", r); if (sim) { sim.textContent = eur(val); sim.className = adj > 0 ? "up" : adj < 0 ? "down" : ""; }
      const cmp = $(".fine-cmp", r); if (!cmp) return;
      const pR = rRev ? Math.round(b / rRev * 100) : null, pS = rev ? Math.round(val / rev * 100) : null;
      const unit = r.dataset.cat === "revenue" ? "prod" : "CA";
      cmp.innerHTML = `<span class="cmp-p">% réel ${pR == null ? "—" : pR + "%"}</span><span class="cmp-p obj">% objectif ${pS == null ? "—" : pS + "%"} ${unit}</span>`;
    });
    const line = (l, v, cls) => `<div class="pnl-line ${cls || ""}"><span>${l}</span><span class="num">${v}</span></div>`;
    const pc = (v) => (rev ? ` <span class="sig-pct">${Math.round(v / rev * 100)}%</span>` : "");
    const row = (l, v) => `<div class="pnl-line"><span>${l}</span><span class="num">${eur(v)}${pc(v)}</span></div>`;
    const sig = (l, v) => `<div class="pnl-line sig"><span>${l}</span><span class="num">${eur(v)}${pc(v)}</span></div>`;
    const gap = target ? ebit - target : null;
    $("#pnl-live").innerHTML = `
      <div class="pnl-live-h">Compte d'exploitation prospectif (annuel)</div>
      <div class="pnl-line prod strong"><span>Revenue (produits)</span><span class="num">${eur(rev)}</span></div>
      ${row("− COGS (coûts directs)", cogs)}
      ${sig("= Marge brute (Gross Margin)", gm)}
      ${row("− Payroll (masse salariale)", pay)}
      ${row("− DOCS (charges d'exploit.)", docs)}
      ${sig("= EBITDA", ebitda)}
      ${da ? row("− D&A (amortissements)", da) : ""}
      <div class="pnl-ebit ${ebit < 0 ? "neg" : "pos"}"><span>= EBIT (résultat d'exploit.)</span><span class="num">${eur(ebit)}${rev ? " · " + marge + "%" : ""}</span></div>
      ${line("EBIT réel (référence)", eur(rEbit))}
      ${line("Coût / étudiant", cps == null ? "—" : eur(cps))}
      ${students ? line("Effectif", students) : ""}
      ${target ? `<div class="pnl-gap ${gap >= 0 ? "pos" : "neg"}">${gap >= 0 ? "Objectif atteint (+" + eur(gap) + ")" : "Reste " + eur(Math.abs(gap)) + " à trouver"}<div class="muted" style="font-weight:400;font-size:11px;">objectif EBIT réseau ${eur(target)}</div></div>` : ""}
      <div class="pnl-live-h" style="margin-top:14px;">Point mort & sensibilité</div>
      ${be != null ? line("Point mort (EBIT = 0)", be + " étud." + (students ? ` (${ebit >= 0 ? "−" : "+"}${Math.abs(be - students)})` : "")) : line("Point mort", "effectif manquant")}
      ${caPerStu ? line("+1 étudiant", "≈ +" + eur(Math.round(caPerStu))) : ""}
      ${pay ? line("−1 % Payroll", "+" + eur(Math.round(pay * 0.01))) : ""}
      ${docs ? line("−1 % DOCS", "+" + eur(Math.round(docs * 0.01))) : ""}
      <div class="muted" style="font-size:10.5px;margin-top:6px;">Marge brute = Revenue − COGS · EBITDA = Marge brute − Payroll − DOCS · EBIT = EBITDA − D&A. % du CA simulé.</div>`;
  };
  const filTotal = () => { let t = 0; $$("#fr-fil .fil-row").forEach((r) => { t += (+$(".fil-eff", r).value || 0) * (+$(".fil-frais", r).value || 0); }); return t; };
  const scolarRow = () => { let t = $$("#fr-revenue .fine-row").find((r) => /scolar/i.test($(".fine-lbl", r).value)); if (!t) { $("#fr-revenue").insertAdjacentHTML("afterbegin", fineRow("revenue", { label: "Frais de scolarité", amount: 0, base: 0 })); t = $("#fr-revenue .fine-row"); } return t; };
  const syncFil = () => {
    $$("#fr-fil .fil-row").forEach((r) => { $(".fil-ca", r).textContent = eur((+$(".fil-eff", r).value || 0) * (+$(".fil-frais", r).value || 0)); });
    if ($("#fil-drive")?.checked) { const row = scolarRow(); const b = +row.dataset.base || 0; $(".fine-adj", row).value = Math.round(filTotal() - b); }
  };
  modal.addEventListener("input", (e) => { if (e.target.classList.contains("fil-eff") || e.target.classList.contains("fil-frais")) syncFil(); recalc(); });
  modal.addEventListener("change", (e) => {
    if (e.target.id === "fil-drive") { syncFil(); recalc(); }
    else if (e.target.classList.contains("fine-fam")) {
      const r = e.target.closest(".fine-row"), val = e.target.value;
      r.dataset.cat = val === "payroll" ? "payroll" : "charges";
      $(`#fr-${val}`).appendChild(r);
      recalc();
    }
  });
  modal.addEventListener("click", (e) => {
    if (e.target.closest(".fine-del")) { e.target.closest(".fine-row").remove(); recalc(); }
    else if (e.target.closest(".fine-add")) { const b = e.target.closest(".fine-add"); $(`#${b.dataset.sec}`).insertAdjacentHTML("beforeend", fineRow(b.dataset.cat, null, b.dataset.sec.replace("fr-", ""))); recalc(); }
  });
  syncFil(); recalc();
  $("#fine-reset").onclick = () => { closeModals(); openSimFine(baseRow, tr); };
  $("#fine-plan").onclick = () => {
    const items = [];
    $$(".fine-row", modal).forEach((r) => {
      if (r.classList.contains("fil-row")) return;
      const b = +r.dataset.base || 0, val = fineRowVal(r), adj = val - b;
      if (Math.abs(adj) < 1) return;
      const label = ($(".fine-lbl", r).value || "poste").trim();
      const isRev = r.dataset.cat === "revenue";
      const impact = isRev ? adj : -adj; // effet sur l'EBIT
      const grow = adj > 0;
      const dir = isRev ? (grow ? "rev_up" : "rev_down") : (adj < 0 ? "cost_down" : "cost_up");
      const axes = leversFor(dir, label);
      const title = isRev
        ? `${grow ? "Développer" : "Revoir"} « ${label} » : ${grow ? "+" : "−"}${eur(Math.abs(adj))}`
        : `${grow ? "Absorber la hausse" : "Réduire"} « ${label} » : ${grow ? "+" : "−"}${eur(Math.abs(adj))}`;
      items.push({ title, objectif: `Impact EBIT visé : ${impact >= 0 ? "+" : "−"}${eur(Math.abs(impact))}/an`, moyen: axes[0] || "", mesures: `Passer « ${label} » de ${eur(b)} à ${eur(val)} (${adj > 0 ? "+" : "−"}${eur(Math.abs(adj))}/an).`, axes, impact });
    });
    const ebit = sumFam("revenue") - sumFam("cogs") - sumFam("payroll") - sumFam("docs") - sumFam("da");
    const rEbit = realFam("revenue") - realFam("cogs") - realFam("payroll") - realFam("docs") - realFam("da");
    openPnlPlan(baseRow, items, { rEbit, ebit, target });
  };
  $("#fine-apply").onclick = () => {
    if (tr) { $('.sim-in[data-k="rev"]', tr).value = Math.round(sumFam("revenue")); $('.sim-in[data-k="pay"]', tr).value = Math.round(sumFam("payroll")); $('.sim-in[data-k="chg"]', tr).value = Math.round(sumFam("cogs") + sumFam("docs") + sumFam("da")); }
    closeModals(); simRecompute();
  };
  $("#fine-save").onclick = async () => {
    if (!confirm(`Enregistrer cette ventilation dans la finance de ${baseRow.name} (mois ${month}, montants ÷ 12) ?`)) return;
    const map = { revenue: ["revenue"], payroll: ["payroll"], charges: ["cogs", "docs", "da"] };
    for (const [store, fams] of Object.entries(map)) {
      const lines = fams.flatMap((kf) => $$(`#fr-${kf} .fine-row`)).map((r) => ({ label: $(".fine-lbl", r).value.trim(), amount: Math.round(fineRowVal(r) / 12) })).filter((l) => l.label);
      await api.patch("/api/kpi/postes", { campusId: baseRow.id, month, poste: store, lines });
    }
    closeModals(); renderFinance();
  };
  $("#fine-export").onclick = () => {
    const rev = sumFam("revenue"), cogs = sumFam("cogs"), pay = sumFam("payroll"), docs = sumFam("docs"), da = sumFam("da");
    const gm = rev - cogs, ebitda = gm - pay - docs, ebit = ebitda - da;
    const secRows = (kf) => $$(`#fr-${kf} .fine-row`).map((r) => `<tr><td>${esc($(".fine-lbl", r).value)}</td><td class="a">${eur(fineRowVal(r))}</td></tr>`).join("");
    const blk = (kf, lbl, cls) => `<tr class="h ${cls}"><td>${lbl}</td><td class="a">${eur(sumFam(kf))}</td></tr>${secRows(kf)}`;
    const sigrow = (lbl, v) => `<tr class="s"><td>${lbl}</td><td class="a">${eur(v)}${rev ? " · " + Math.round(v / rev * 100) + "%" : ""}</td></tr>`;
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>P&L simulé — ${esc(baseRow.name)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0D1B2A;max-width:720px;margin:24px auto;padding:0 16px;}
h1{color:#0B6E5F;font-size:20px;margin:0 0 2px;}.sub{color:#5A6672;font-size:12px;margin-bottom:16px;}
table{border-collapse:collapse;width:100%;font-size:13px;}td{padding:6px 8px;border-bottom:1px solid #eee;}td.a{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
tr.h td{background:#e4f1ee;color:#0B6E5F;font-weight:800;border-top:1.5px solid #cfe4de;}tr.h.chg td{background:#f9e6e1;color:#C94B33;}
tr.s td{font-weight:800;color:#0B6E5F;border-top:1.5px solid #cfe4de;background:#f3f8f6;}
.ebit{margin-top:14px;padding:12px 14px;border-radius:10px;display:flex;justify-content:space-between;font-weight:800;font-size:16px;background:${ebit < 0 ? "#f9e6e1;color:#C94B33" : "#e4f1ee;color:#0B6E5F"};}
.foot{margin-top:20px;color:#7A8590;font-size:11px;}@media print{.noprint{display:none}}</style></head><body>
<h1>P&L simulé — ${esc(baseRow.name)}</h1><div class="sub">Campus Manager · scénario prospectif · montants annuels · ${new Date().toLocaleDateString("fr-FR")}</div>
<button class="noprint" onclick="window.print()" style="margin-bottom:14px;background:#0B6E5F;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;cursor:pointer;">Imprimer / PDF</button>
<table><tbody>${blk("revenue", "Revenue (produits)", "")}${blk("cogs", "COGS — coûts directs", "chg")}${sigrow("= Marge brute", gm)}${blk("payroll", "Payroll — masse salariale", "chg")}${blk("docs", "DOCS — charges d'exploitation", "chg")}${sigrow("= EBITDA", ebitda)}${blk("da", "D&A — amortissements", "chg")}</tbody></table>
<div class="ebit"><span>EBIT (résultat d'exploitation)</span><span>${eur(ebit)}${rev ? " · " + Math.round(ebit / rev * 100) + " %" : ""}</span></div>
<div class="foot">Simulation à structure donnée. Document confidentiel.</div></body></html>`;
    const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
  };
}
// Transforme les ajustements de la simulation en plan d'action (revue + création).
function openPnlPlan(baseRow, items, ctx) {
  if (!items.length) { alert("Aucun ajustement saisi. Mets des ± sur des lignes du P&L pour générer un plan d'action."); return; }
  const totImpact = items.reduce((s, i) => s + i.impact, 0);
  openModal(`Plan d'action — ${baseRow.name}`, `
    <p class="hint muted" style="margin-top:0;">Généré depuis tes ajustements. EBIT réel ${eur(ctx.rEbit)} → simulé <strong>${eur(ctx.ebit)}</strong>${ctx.target ? ` · objectif réseau ${eur(ctx.target)}` : ""}. Décoche ce que tu ne veux pas créer, ajuste les intitulés.</p>
    <div class="list" id="plan-list">${items.map((it, i) => `<div class="item" style="align-items:flex-start;gap:10px;">
      <label class="jal-chk" style="margin-top:4px;"><input type="checkbox" class="plan-ck" data-i="${i}" checked></label>
      <div class="grow"><input class="txt plan-title" data-i="${i}" value="${esc(it.title)}" style="width:100%;font-weight:600;margin-bottom:4px;">
        <div class="sub muted" style="margin-bottom:6px;">${esc(it.objectif)} · ${esc(it.mesures)}</div>
        <div class="plan-axes"><span class="plan-axes-h">Axes proposés</span>${(it.axes || []).map((a, j) => `<label class="plan-axis"><input type="checkbox" class="plan-ax" data-i="${i}" data-j="${j}" checked> ${esc(a)}</label>`).join("")}</div>
      </div>
    </div>`).join("")}</div>
    <div class="actions" style="margin-top:14px;align-items:center;"><span class="muted" style="flex:1;">Impact EBIT cumulé : <strong class="${totImpact >= 0 ? "up" : "down"}">${totImpact >= 0 ? "+" : "−"}${eur(Math.abs(totImpact))}/an</strong></span><button class="btn-primary" id="plan-create">Créer les actions</button></div>`);
  $("#plan-create").onclick = async () => {
    const chosen = $$(".plan-ck").filter((c) => c.checked).map((c) => +c.dataset.i);
    if (!chosen.length) { closeModals(); return; }
    for (const i of chosen) {
      const it = items[i];
      const title = $(`.plan-title[data-i="${i}"]`)?.value || it.title;
      const axList = $$(`.plan-ax[data-i="${i}"]`).filter((c) => c.checked).map((c) => it.axes[+c.dataset.j]);
      const mesures = it.mesures + (axList.length ? "\nAxes : " + axList.map((a) => "• " + a).join("  ") : "");
      await api.post("/api/actions", { title, objectif: it.objectif, moyen: axList[0] || it.moyen, mesures, campusId: baseRow.id, campusName: baseRow.name, category: "prospective" });
    }
    closeModals(); setView("actions");
  };
}
function openFinanceForm(cid, name, month, prefill) {
  const m = month || new Date().toISOString().slice(0, 7);
  const pv = (f) => (prefill && prefill[f] != null ? prefill[f] : "");
  openModal(`Finance — ${name}`, `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Mois</label><input class="txt ff" data-f="month" type="month" value="${m}"></div>
      <div><label class="field-label">CA réel (€)</label><input class="txt ff" data-f="revenue" type="number" step="any" value="${pv("revenue")}"></div>
      <div><label class="field-label">CA budgété (€)</label><input class="txt ff" data-f="revenueBudget" type="number" step="any" value="${pv("revenueBudget")}"></div>
      <div><label class="field-label">Masse salariale (€)</label><input class="txt ff" data-f="payroll" type="number" step="any" value="${pv("payroll")}"></div>
      <div><label class="field-label">Autres charges (€)</label><input class="txt ff" data-f="charges" type="number" step="any" value="${pv("charges")}"></div>
    </div>
    <p class="hint muted" style="margin-top:8px;">Laisse un champ vide pour ne pas l'écraser.</p>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm" id="ff-dup">Dupliquer M‑1</button><button class="btn-primary" id="ff-save">Enregistrer</button></div>`);
  $("#ff-dup").addEventListener("click", async () => {
    const hist = await api.get(`/api/kpi?campusId=${cid}`) || [];
    const last = hist[hist.length - 1]; if (!last) { $("#ff-dup").textContent = "Aucun historique"; return; }
    ["revenue", "revenueBudget", "payroll", "charges"].forEach((f) => { const el = $(`.ff[data-f="${f}"]`); if (el && last[f] != null) el.value = last[f]; });
    $("#ff-dup").textContent = "Repris ✓";
  });
  $("#ff-save").addEventListener("click", async () => {
    const entry = { campusId: cid }; $$(".ff").forEach((i) => { if (i.value !== "") entry[i.dataset.f] = i.value; });
    if (!entry.month) return;
    await api.post("/api/kpi", entry);
    document.querySelector(".modal-bg")?.remove();
    renderFinance();
  });
}

// --- Détail financier d'un campus (drill-down) ---
function finBars(fin) {
  const max = Math.max(...fin.map((e) => Math.max(e.revenue || 0, e.revenueBudget || 0))) || 1;
  return `<div class="card card-pad" style="margin-bottom:6px;"><div class="finbars">${fin.map((e) => `<div class="finbar-col">
      <div class="finbar-pair">
        <div class="finbar b-rev" style="height:${Math.max(3, (e.revenue || 0) / max * 100)}%" title="CA ${eur(e.revenue)}"></div>
        <div class="finbar b-bud" style="height:${Math.max(3, (e.revenueBudget || 0) / max * 100)}%" title="Budget ${eur(e.revenueBudget)}"></div>
      </div><div class="finbar-lbl">${e.month.slice(2)}</div></div>`).join("")}</div>
    <div class="finbar-legend"><span class="lg lg-rev">CA réel</span><span class="lg lg-bud">Budget</span></div></div>`;
}
async function openFinanceDetail(row) {
  if (!row) return;
  const all = await api.get(`/api/kpi?campusId=${row.id}`) || [];
  const fin = all.filter((e) => e.revenue != null).map((e) => ({ ...e, _margin: e.revenue - (e.payroll || 0) - (e.charges || 0) }));
  const students = row.students;
  if (!fin.length) {
    openModal(`Finance — ${row.name}`, `<p class="muted">Aucune donnée financière pour ce campus.</p><div class="actions" style="margin-top:12px;"><button class="btn-primary" id="fd-add">Saisir un mois</button></div>`);
    $("#fd-add").onclick = () => { document.querySelector(".modal-bg")?.remove(); openFinanceForm(row.id, row.name); };
    return;
  }
  const last = fin[fin.length - 1];
  const cps = students && (last.payroll != null || last.charges != null) ? Math.round(((last.payroll || 0) + (last.charges || 0)) / students) : null;
  const ecLast = last.revenueBudget ? Math.round((last.revenue - last.revenueBudget) / last.revenueBudget * 100) : null;
  const body = `
    <div class="kpis" style="margin-bottom:6px;">
      ${fkpi(eur(last.revenue), "CA · " + last.month)}
      ${fkpi(eur(last._margin), "Marge", last._margin < 0 ? "bad" : "good")}
      ${fkpi(ecLast == null ? "—" : (ecLast > 0 ? "+" : "") + ecLast + " %", "Écart budget", ecLast != null && ecLast < 0 ? "bad" : "good")}
      ${fkpi(cps == null ? "—" : eur(cps), "Coût/étudiant")}
    </div>
    <div class="section-title">CA réel vs budget</div>
    ${finBars(fin)}
    <div class="section-title">Détail mensuel <span class="muted" style="font-weight:400;">— clique un poste (CA, masse sal., charges) pour le ventiler</span></div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Mois</th><th>CA</th><th>Budget</th><th>Écart</th><th>Masse sal.</th><th>Charges</th><th>Marge</th><th></th></tr></thead>
      <tbody>${fin.slice().reverse().map((e) => { const ec = e.revenueBudget ? Math.round((e.revenue - e.revenueBudget) / e.revenueBudget * 100) : null; return `<tr>
        <td>${e.month}</td><td>${posteCell(e, "revenue")}</td><td>${eur(e.revenueBudget)}</td>
        <td class="${ec != null && ec < 0 ? "cell-warn" : ""}">${ec == null ? "—" : (ec > 0 ? "+" : "") + ec + " %"}</td>
        <td>${posteCell(e, "payroll")}</td><td>${posteCell(e, "charges")}</td>
        <td class="${e._margin < 0 ? "cell-warn" : ""}">${eur(e._margin)}</td>
        <td><button class="btn-ghost btn-sm fd-edit" data-month="${e.month}">Éditer</button></td>
      </tr>`; }).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm" id="fd-pnl">Seeder depuis le P&L</button><button class="btn-primary btn-sm" id="fd-add">+ Nouveau mois</button><span id="fd-msg" class="status"></span></div>`;
  openModal(`Finance — ${row.name}${row.city ? " · " + row.city : ""}`, body);
  $("#fd-add").onclick = () => { document.querySelector(".modal-bg")?.remove(); openFinanceForm(row.id, row.name); };
  $("#fd-pnl").onclick = async () => {
    $("#fd-msg").textContent = "Lecture du P&L…";
    const r = await api.post(`/api/campuses/${row.id}/seed-finance-from-pnl`, {});
    if (r?.ok) { document.querySelector(".modal-bg")?.remove(); openFinanceDetail(row); }
    else $("#fd-msg").textContent = r?.error || "Aucun P&L exploitable — génère d'abord une Analyse P&L (Atelier).";
  };
  $$(".fd-edit").forEach((b) => b.addEventListener("click", () => { const e = fin.find((x) => x.month === b.dataset.month); document.querySelector(".modal-bg")?.remove(); openFinanceForm(row.id, row.name, b.dataset.month, e); }));
  $$(".poste-cell").forEach((c) => c.addEventListener("click", () => {
    const e = fin.find((x) => x.month === c.dataset.month);
    document.querySelector(".modal-bg")?.remove();
    openPosteDetail(row, c.dataset.month, c.dataset.poste, e);
  }));
}
const POSTE_LABEL = { revenue: "CA réel", payroll: "Masse salariale", charges: "Autres charges" };
const POSTE_HINT = { revenue: "ex. Frais de scolarité, Alternance, Formation continue…", payroll: "ex. Enseignants, Vacataires, Administratif…", charges: "ex. Loyer, Énergie, Marketing, Fournitures…" };
// Plan de comptes type d'un P&L de campus — sert à pré-ventiler chaque poste (ratios indicatifs, somme = 1).
const PNL_TEMPLATE = {
  revenue: [
    { label: "Frais de scolarité", ratio: 0.62 }, { label: "Alternance / OPCO", ratio: 0.22 },
    { label: "Formation continue", ratio: 0.08 }, { label: "Taxe d'apprentissage & subventions", ratio: 0.05 },
    { label: "Autres produits", ratio: 0.03 },
  ],
  payroll: [
    { label: "Enseignants permanents", ratio: 0.42 }, { label: "Vacataires", ratio: 0.20 },
    { label: "Personnel administratif", ratio: 0.16 }, { label: "Charges sociales", ratio: 0.22 },
  ],
  charges: [
    { label: "Loyer & charges locatives", ratio: 0.30 }, { label: "Énergie & fluides", ratio: 0.08 },
    { label: "Marketing & communication", ratio: 0.18 }, { label: "Fournitures & pédagogie", ratio: 0.12 },
    { label: "Déplacements & réceptions", ratio: 0.06 }, { label: "Sous-traitance & prestations", ratio: 0.14 },
    { label: "Amortissements", ratio: 0.07 }, { label: "Autres charges", ratio: 0.05 },
  ],
};
// Répartit un montant agrégé selon le modèle P&L (ajuste l'arrondi sur la dernière ligne).
function ventilate(poste, agg) {
  const lines = PNL_TEMPLATE[poste].map((t) => ({ label: t.label, amount: agg != null ? Math.round(agg * t.ratio) : "" }));
  if (agg != null && lines.length) { const s = lines.reduce((a, l) => a + (l.amount || 0), 0); lines[lines.length - 1].amount += (agg - s); }
  return lines;
}
function posteCell(e, poste) {
  const has = e.postes && e.postes[poste] && e.postes[poste].length;
  return `<span class="poste-cell" data-month="${e.month}" data-poste="${poste}" title="Cliquer pour ventiler ce poste">${eur(e[poste])}${has ? ` <span class="poste-dot" title="${has} ligne(s)"></span>` : ""}</span>`;
}
function openPosteDetail(row, month, poste, entry) {
  // Déjà ventilé → on reprend les lignes ; sinon on pré-remplit selon la structure P&L.
  const lines = (entry && entry.postes && entry.postes[poste] && entry.postes[poste].length)
    ? entry.postes[poste].slice()
    : ventilate(poste, entry ? entry[poste] : null);
  const lineRow = (l) => `<div class="poste-row">
    <input class="txt plf" data-f="label" value="${esc(l && l.label || "")}" placeholder="Libellé" style="flex:2;min-width:150px;">
    <input class="txt plf" data-f="amount" type="number" step="any" value="${l && l.amount != null ? l.amount : ""}" placeholder="Montant €" style="width:130px;">
    <button type="button" class="btn-ghost btn-sm btn-danger del-pl">✕</button></div>`;
  openModal(`${POSTE_LABEL[poste]} — ${row.name} · ${month}`, `
    <p class="hint muted" style="margin-top:0;">${POSTE_HINT[poste]}</p>
    <div id="poste-list">${lines.length ? lines.map(lineRow).join("") : lineRow()}</div>
    <button type="button" class="btn-ghost btn-sm" id="pl-add" style="margin-top:8px;">+ Ligne</button>
    <div class="poste-total" id="pl-total"></div>
    <p class="hint muted" style="margin-top:6px;">Le total des lignes remplace le montant agrégé du poste pour ce mois.</p>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm" id="pl-back">Retour</button><button class="btn-primary" id="pl-save">Enregistrer</button></div>`);
  const list = $("#poste-list");
  const recalc = () => { let t = 0; $$(".poste-row", list).forEach((r) => { const a = parseFloat($('.plf[data-f="amount"]', r).value); if (!isNaN(a)) t += a; }); $("#pl-total").textContent = "Total du poste : " + eur(t); };
  $("#pl-add").onclick = () => { list.insertAdjacentHTML("beforeend", lineRow()); recalc(); };
  list.addEventListener("click", (e) => { if (e.target.closest(".del-pl")) { e.target.closest(".poste-row").remove(); recalc(); } });
  list.addEventListener("input", recalc);
  recalc();
  $("#pl-back").onclick = () => { document.querySelector(".modal-bg")?.remove(); openFinanceDetail(row); };
  $("#pl-save").onclick = async () => {
    const arr = $$(".poste-row", list).map((r) => { const o = {}; $$(".plf", r).forEach((i) => (o[i.dataset.f] = i.value)); return o; }).filter((o) => String(o.label || "").trim());
    await api.patch("/api/kpi/postes", { campusId: row.id, month, poste, lines: arr });
    document.querySelector(".modal-bg")?.remove();
    openFinanceDetail(row);
  };
}

// ---------- Vue : Insertion & satisfaction ----------
async function renderInsertion() {
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="ins-xlsx">Excel</button><button class="btn-ghost btn-sm" id="ins-print">Imprimer</button>`;
  $("#ins-xlsx").addEventListener("click", () => { location.href = "/api/export/insertion"; });
  $("#ins-print").addEventListener("click", () => window.print());
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const rows = await api.get("/api/performance") || [];
  if (!rows.length) { view.innerHTML = `<p class="empty">Ajoute des campus, puis saisis satisfaction / réussite / insertion (onglet Indicateurs).</p>`; return; }
  const avg = (key) => { const v = rows.filter((r) => r[key] != null); return v.length ? Math.round((v.reduce((s, r) => s + r[key], 0) / v.length) * 10) / 10 : null; };
  const pct = (v) => (v == null ? "—" : v + " %");
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:14px;">
      ${fkpi(avg("satisfaction") != null ? avg("satisfaction") + " /10" : "—", "Satisfaction moyenne")}
      ${fkpi(pct(avg("successRate")), "Réussite moyenne")}
      ${fkpi(pct(avg("insertionRate")), "Insertion moyenne (6 mois)")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Campus</th><th>Mois</th><th>Satisfaction</th><th>Réussite</th><th>Insertion 6 mois</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><div class="ttl">${esc(r.name)}</div><div class="sub muted">${esc(r.city || "")}</div></td>
        <td>${r.month || "—"}</td>
        <td class="${r.satisfaction != null && r.satisfaction < 7 ? "cell-warn" : ""}">${r.satisfaction != null ? r.satisfaction + " /10" : "—"}${deltaArrow(r.satisfactionDelta, "", true)}</td>
        <td class="${r.successRate != null && r.successRate < 70 ? "cell-warn" : ""}">${pct(r.successRate)}${deltaArrow(r.successDelta, "%")}</td>
        <td class="${r.insertionRate != null && r.insertionRate < 70 ? "cell-warn" : ""}">${pct(r.insertionRate)}${deltaArrow(r.insertionDelta, "%")}</td>
      </tr>`).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Dernier mois saisi (onglet Indicateurs). Satisfaction &lt; 7/10, réussite/insertion &lt; 70 % signalées. L'insertion à 6 mois est un indicateur Qualiopi clé.</p>`;
}

// ---------- Vue : Entreprises & alternance ----------
let entCampus = null;
async function renderEntreprises() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  state.campuses = await api.get("/api/campuses") || [];
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute un campus d'abord (onglet Campus).</p>`; return; }
  if (!entCampus || !state.campuses.find((c) => c.id === entCampus)) entCampus = state.campuses[0].id;
  const partners = await api.get(`/api/partners?campusId=${entCampus}`) || [];
  const totAlt = partners.reduce((s, p) => s + (p.alternants || 0), 0);
  const actifs = partners.filter((p) => p.status === "actif").length;
  const stTone = { actif: "good", prospect: "warn", inactif: "" };
  view.innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:end;">
      <div><label class="field-label">Campus</label><select id="ent-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === entCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <button class="btn-primary btn-sm" id="ent-add" style="flex:none;">+ Entreprise</button>
    </div>
    <div class="kpis" style="margin-bottom:14px;">
      ${fkpi(partners.length, "Entreprises partenaires")}
      ${fkpi(actifs, "Partenariats actifs")}
      ${fkpi(totAlt, "Alternants placés")}
    </div>
    ${partners.length ? `<div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Entreprise</th><th>Secteur</th><th>Contact</th><th>Alternants</th><th>Statut</th><th></th></tr></thead>
      <tbody>${partners.map((p) => `<tr>
        <td><div class="ttl">${esc(p.name)}</div>${p.notes ? `<div class="sub muted">${esc(p.notes)}</div>` : ""}</td>
        <td>${esc(p.sector || "—")}</td>
        <td>${esc(p.contactName || "—")}${p.contactEmail ? `<div class="sub muted">${esc(p.contactEmail)}</div>` : ""}</td>
        <td>${p.alternants || 0}</td>
        <td><span class="pill ${stTone[p.status] || ""}">${esc(p.status)}</span></td>
        <td><button class="btn-ghost btn-sm ent-edit" data-id="${p.id}">Éditer</button> <button class="btn-ghost btn-sm btn-danger ent-del" data-id="${p.id}">✕</button></td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="empty">Aucune entreprise partenaire pour ce campus. Ajoute-en pour suivre alternance et placements.</p>`}`;
  $("#ent-campus").addEventListener("change", (e) => { entCampus = e.target.value; renderEntreprises(); });
  $("#ent-add").addEventListener("click", () => openPartnerForm());
  $$(".ent-edit").forEach((b) => b.addEventListener("click", () => openPartnerForm(partners.find((p) => p.id === b.dataset.id))));
  $$(".ent-del").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Supprimer cette entreprise ?")) return; await api.del(`/api/partners/${b.dataset.id}`); renderEntreprises(); }));
}
function openPartnerForm(p) {
  const e = p || {};
  openModal(p ? "Modifier l'entreprise" : "Nouvelle entreprise", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Nom *</label><input class="txt pf" data-f="name" value="${esc(e.name || "")}"></div>
      <div><label class="field-label">Secteur</label><input class="txt pf" data-f="sector" value="${esc(e.sector || "")}"></div>
      <div><label class="field-label">Alternants</label><input class="txt pf" data-f="alternants" type="number" value="${e.alternants || 0}"></div>
      <div><label class="field-label">Contact</label><input class="txt pf" data-f="contactName" value="${esc(e.contactName || "")}"></div>
      <div><label class="field-label">Email contact</label><input class="txt pf" data-f="contactEmail" value="${esc(e.contactEmail || "")}"></div>
      <div><label class="field-label">Téléphone</label><input class="txt pf" data-f="contactPhone" value="${esc(e.contactPhone || "")}"></div>
      <div><label class="field-label">Statut</label><select class="txt pf" data-f="status">${["actif", "prospect", "inactif"].map((s) => `<option ${e.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Notes</label><input class="txt pf" data-f="notes" value="${esc(e.notes || "")}"></div>
    </div>
    <details style="margin-top:10px;" ${e.siret ? "open" : ""}><summary class="muted" style="cursor:pointer;">Informations employeur <span class="sub">(requises pour les contrats d'alternance)</span></summary>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        <div><label class="field-label">SIRET</label><input class="txt pf" data-f="siret" value="${esc(e.siret || "")}" placeholder="14 chiffres"><div class="sub muted" id="pf-siret-check"></div></div>
        <div><label class="field-label">Code NAF</label><input class="txt pf" data-f="naf" value="${esc(e.naf || "")}"></div>
        <div><label class="field-label">Forme juridique</label><input class="txt pf" data-f="formeJuridique" value="${esc(e.formeJuridique || "")}"></div>
        <div><label class="field-label">Convention collective</label><input class="txt pf" data-f="conventionCollective" value="${esc(e.conventionCollective || "")}"></div>
        <div style="grid-column:1/-1;"><label class="field-label">Adresse</label><input class="txt pf" data-f="adresse" value="${esc(e.adresse || "")}"></div>
        <div><label class="field-label">Code postal</label><input class="txt pf" data-f="codePostal" value="${esc(e.codePostal || "")}"></div>
        <div><label class="field-label">Ville</label><input class="txt pf" data-f="ville" value="${esc(e.ville || "")}"></div>
        <div><label class="field-label">Effectif</label><input class="txt pf" data-f="effectif" value="${esc(e.effectif || "")}"></div>
      </div></details>
    <div class="actions" style="margin-top:14px;"><button class="btn-primary" id="pf-save">Enregistrer</button></div>`);
  // Contrôle immédiat de la clé du SIRET : une erreur de saisie ici bloque un dépôt plus tard.
  const siretInput = $('.pf[data-f="siret"]');
  const checkSiret = () => {
    const v = siretInput.value.replace(/\s/g, "");
    const el = $("#pf-siret-check");
    if (!v) { el.textContent = ""; return; }
    let ok = /^\d{14}$/.test(v) && !/^0+$/.test(v);
    if (ok) { let sum = 0; for (let i = 0; i < 14; i++) { let d = Number(v[13 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; } ok = sum % 10 === 0; }
    el.textContent = ok ? "✓ SIRET valide" : "⚠ SIRET invalide (14 chiffres, clé de contrôle)";
    el.style.color = ok ? "var(--good)" : "var(--bad)";
  };
  siretInput.addEventListener("input", checkSiret);
  checkSiret();
  $("#pf-save").addEventListener("click", async () => {
    const body = { campusId: entCampus }; $$(".pf").forEach((i) => (body[i.dataset.f] = i.value));
    if (!String(body.name || "").trim()) return;
    if (p) await api.patch(`/api/partners/${p.id}`, body); else await api.post("/api/partners", body);
    document.querySelector(".modal-bg")?.remove();
    renderEntreprises();
  });
}

// ---------- Vue : Objectifs réseau (OKR) ----------
function krRow(r) {
  r = r || {};
  const opts = `<option value="">— réseau —</option>` + state.campuses.map((c) => `<option value="${c.id}" ${r.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  return `<div class="kr-row">
    <input class="txt krf" data-f="libelle" value="${esc(r.libelle || "")}" placeholder="Résultat-clé mesurable" style="flex:2;min-width:150px;">
    <select class="txt krf" data-f="campusId" style="width:140px;">${opts}</select>
    <input class="txt krf" data-f="cible" value="${esc(r.cible || "")}" placeholder="Cible" style="width:100px;">
    <input class="txt krf" data-f="avancement" type="number" value="${r.avancement ?? ""}" placeholder="%" style="width:64px;">
    <button type="button" class="btn-ghost btn-sm btn-danger del-kr">✕</button>
  </div>`;
}
function okrCard(o) {
  o = o || {};
  return `<div class="obj-card okr-card">
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <input class="txt okf" data-f="titre" value="${esc(o.titre || "")}" placeholder="Objectif réseau" style="flex:2;min-width:180px;">
      <input class="txt okf" data-f="cible" value="${esc(o.cible || "")}" placeholder="Cible globale" style="flex:1;min-width:120px;">
      <input class="txt okf" data-f="echeance" type="date" value="${esc(o.echeance || "")}" style="width:150px;">
    </div>
    <div class="krs"><div class="kr-list">${(o.resultats || []).map(krRow).join("")}</div>
      <button type="button" class="btn-ghost btn-sm add-kr">+ Résultat-clé</button></div>
    <button type="button" class="btn-ghost btn-sm btn-danger del-okr">Supprimer l'objectif</button>
  </div>`;
}
function okrCardRO(o) {
  const bars = (o.resultats || []).map((r) => {
    const c = state.campuses.find((x) => x.id === r.campusId);
    const av = r.avancement;
    return `<div class="kr-ro"><div class="grow"><div class="ttl">${esc(r.libelle)}</div><div class="sub muted">${c ? esc(c.name) : "Réseau"}${r.cible ? " · cible " + esc(r.cible) : ""}</div></div>
      <div class="kr-bar"><div class="kr-bar-fill" style="width:${Math.max(0, Math.min(100, av || 0))}%"></div></div><span class="kr-pct">${av == null ? "—" : av + "%"}</span></div>`;
  }).join("");
  return `<div class="card card-pad" style="margin-bottom:12px;"><div class="ttl" style="font-size:16px;">${esc(o.titre)}</div>
    <div class="sub muted" style="margin-bottom:8px;">${o.cible ? esc(o.cible) : ""}${o.echeance ? " · échéance " + esc(o.echeance) : ""}</div>${bars || '<p class="muted" style="font-size:13px;">Pas de résultat-clé.</p>'}</div>`;
}
async function renderObjectifs() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  state.campuses = await api.get("/api/campuses") || [];
  const objs = await api.get("/api/network/objectives") || [];
  if (!isAdmin()) {
    view.innerHTML = objs.length ? objs.map(okrCardRO).join("") : `<p class="empty">Aucun objectif réseau défini pour l'instant.</p>`;
    return;
  }
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="okr-save">Enregistrer</button>`;
  view.innerHTML = `<div id="okr-list">${objs.map(okrCard).join("")}</div>
    <button class="btn-ghost btn-sm" id="okr-add" style="margin-top:10px;">+ Objectif réseau</button>
    <p class="hint muted" style="margin-top:10px;">Cascade réseau → campus : un objectif se décline en résultats-clés, chacun rattachable à un campus, avec un avancement (%).</p>`;
  const list = $("#okr-list");
  $("#okr-add").addEventListener("click", () => list.insertAdjacentHTML("beforeend", okrCard()));
  list.addEventListener("click", (e) => {
    const card = e.target.closest(".okr-card");
    if (e.target.closest(".add-kr")) card.querySelector(".kr-list").insertAdjacentHTML("beforeend", krRow());
    else if (e.target.closest(".del-kr")) e.target.closest(".kr-row").remove();
    else if (e.target.closest(".del-okr")) card.remove();
  });
  $("#okr-save").addEventListener("click", async () => {
    const objectives = $$("#okr-list .okr-card").map((card) => {
      const o = {}; $$(".okf", card).forEach((i) => (o[i.dataset.f] = i.value));
      o.resultats = $$(".kr-row", card).map((row) => { const r = {}; $$(".krf", row).forEach((i) => (r[i.dataset.f] = i.value)); return r; }).filter((r) => String(r.libelle || "").trim());
      return o;
    }).filter((o) => String(o.titre || "").trim());
    await api.put("/api/network/objectives", { objectives });
    const b = $("#okr-save"); if (b) { b.textContent = "Enregistré ✓"; setTimeout(() => { const x = $("#okr-save"); if (x) x.textContent = "Enregistrer"; }, 1400); }
  });
}

// ---------- Vue : Documents (GED) ----------
let docCampus = null;
async function renderDocuments() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  state.campuses = await api.get("/api/campuses") || [];
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute un campus d'abord (onglet Campus).</p>`; return; }
  if (!docCampus || !state.campuses.find((c) => c.id === docCampus)) docCampus = state.campuses[0].id;
  const docs = await api.get(`/api/documents?campusId=${docCampus}`) || [];
  const CATS = ["convention", "contrat", "audit", "PV", "pédagogie", "RH", "autre"];
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  view.innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:end;flex-wrap:wrap;">
      <div><label class="field-label">Campus</label><select id="doc-campus">${state.campuses.map((c) => `<option value="${c.id}" ${c.id === docCampus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label class="field-label">Catégorie</label><select id="doc-cat" class="txt">${CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div><label class="field-label">Fichier</label><input type="file" id="doc-file"></div>
      <button class="btn-primary btn-sm" id="doc-up" style="flex:none;">Téléverser</button>
      <span id="doc-msg" class="status"></span>
    </div>
    ${docs.length ? `<div class="card"><div class="list">${docs.map((d) => `<div class="item"><span class="pill">${esc(d.category)}</span><div class="grow"><div class="ttl">${esc(d.name)}</div><div class="sub muted">${kb(d.size)} · ${frDate(d.createdAt)}</div></div>
      <a class="btn-ghost btn-sm" href="/api/documents/${d.id}/download">Télécharger</a>
      <button class="btn-ghost btn-sm btn-danger doc-del" data-id="${d.id}">✕</button></div>`).join("")}</div></div>` : `<p class="empty">Aucun document. Téléverse conventions, contrats, rapports d'audit… (chiffrés au repos).</p>`}`;
  $("#doc-campus").addEventListener("change", (e) => { docCampus = e.target.value; renderDocuments(); });
  $("#doc-up").addEventListener("click", async () => {
    const f = $("#doc-file").files[0]; if (!f) { $("#doc-msg").textContent = "Choisis un fichier."; return; }
    $("#doc-msg").textContent = "Envoi…";
    const fd = new FormData(); fd.append("file", f); fd.append("category", $("#doc-cat").value);
    const r = await fetch(`/api/campuses/${docCampus}/documents`, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd });
    if (r.status === 401) return logout(true);
    if (!r.ok) { const j = await r.json().catch(() => ({})); $("#doc-msg").textContent = "Échec : " + (j.error || r.status); return; }
    renderDocuments();
  });
  $$(".doc-del").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Supprimer ce document ?")) return; await api.del(`/api/documents/${b.dataset.id}`); renderDocuments(); }));
}

// ---------- Vue : Tournée (visites terrain) ----------
async function renderTournee() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const rows = await api.get("/api/network") || [];
  if (!rows.length) { view.innerHTML = `<p class="empty">Ajoute des campus pour planifier ta tournée.</p>`; return; }
  const due = rows.filter((r) => r.visitDue).sort((a, b) => (b.monthsSinceVisit ?? 999) - (a.monthsSinceVisit ?? 999));
  const ok = rows.filter((r) => !r.visitDue).sort((a, b) => (b.monthsSinceVisit ?? 0) - (a.monthsSinceVisit ?? 0));
  const card = (r, urgent) => `<div class="tour-card${urgent ? " urgent" : ""}">
    <div class="grow"><div class="ttl">${esc(r.name)} <span class="muted">${esc(r.city || "")}</span></div>
      <div class="sub muted">${r.lastVisit ? `Dernière visite ${r.lastVisit} (${r.monthsSinceVisit} mois)` : "Jamais visité"} · cadence ${r.cadence} mois${r.director ? " · " + esc(r.director) : ""}</div></div>
    <button class="btn-ghost btn-sm t-360" data-id="${r.id}">Fiche</button>
    <button class="btn-primary btn-sm t-log" data-id="${r.id}" data-name="${esc(r.name)}">Programmer</button>
  </div>`;
  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">À visiter <span class="muted">(${due.length})</span></div>
    ${due.length ? `<div class="tour-list">${due.map((r) => card(r, true)).join("")}</div>` : `<p class="muted">Aucune visite en retard 👌</p>`}
    <div class="section-title">À jour <span class="muted">(${ok.length})</span></div>
    ${ok.length ? `<div class="tour-list">${ok.map((r) => card(r, false)).join("")}</div>` : `<p class="muted">—</p>`}`;
  $$(".t-360").forEach((b) => b.addEventListener("click", () => openCampus360(b.dataset.id)));
  $$(".t-log").forEach((b) => b.addEventListener("click", async () => {
    const date = prompt(`Date de la visite de ${b.dataset.name} (AAAA-MM-JJ) :`, new Date().toISOString().slice(0, 10)); if (!date) return;
    const type = prompt("Type (1ère visite, suivi, audit…) :") || "";
    await api.post("/api/visits", { campusId: b.dataset.id, date, type });
    renderTournee();
  }));
}

// ---------- Vue : Apprenants (dossiers & inscriptions) ----------
const ENR_BADGE = {
  inscrit: ["Inscrit", "done"],
  // Apprenti dont le contrat est rompu et qui reste en formation au CFA pendant
  // les 6 mois d'accompagnement : il n'est PAS sorti.
  stagiaire: ["Stagiaire (post-rupture)", "warn"],
  sorti: ["Sorti", ""], diplome: ["Diplômé", "done"], rupture: ["Rupture", "overdue"], abandon: ["Abandon", "overdue"],
};
let appFilter = { campusId: "", q: "" };
async function renderApprenants() {
  $("#topbar-actions").innerHTML = `
    <button class="btn-ghost btn-sm" id="lr-export">Excel</button>
    <label class="btn-ghost btn-sm" style="cursor:pointer;">Importer<input type="file" id="lr-import" accept=".csv,.xlsx,.xls" hidden></label>
    <button class="btn-primary btn-sm" id="add-learner">${I.plus}<span>Apprenant</span></button>`;
  $("#add-learner").addEventListener("click", () => openLearnerForm(null));
  $("#lr-export").addEventListener("click", () => window.open("/api/export/learners", "_blank"));
  $("#lr-import").addEventListener("change", async () => {
    const file = $("#lr-import").files[0];
    if (!file) return;
    const cid = appFilter.campusId || (state.campuses.length === 1 ? state.campuses[0].id : "");
    if (!cid) { alert("Choisis d'abord un campus dans le filtre : l'import peuple ce campus.\n\nColonnes reconnues : nom, prenom, civilite, date_naissance, ine, email, telephone, adresse, rqth, classe, annee_scolaire."); $("#lr-import").value = ""; return; }
    const fd = new FormData();
    fd.append("file", file);
    const r = await (await fetch(`/api/campuses/${cid}/learners/import`, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd })).json();
    if (r.error) { alert(r.error); return; }
    alert(`Import terminé : ${r.created} dossier(s) créé(s), ${r.enrolled} inscription(s)${r.skipped.length ? `\n${r.skipped.length} ligne(s) ignorée(s) :\n` + r.skipped.slice(0, 10).map((s) => `  ligne ${s.ligne} — ${s.motif}`).join("\n") + (r.skipped.length > 10 ? "\n  …" : "") : ""}`);
    await renderApprenants();
  });
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const qs = new URLSearchParams();
  if (appFilter.campusId) qs.set("campusId", appFilter.campusId);
  if (appFilter.q) qs.set("q", appFilter.q);
  const rows = await api.get("/api/learners?" + qs.toString()) || [];
  const actifs = rows.filter((l) => ["inscrit", "stagiaire"].includes(l.enrollment?.statut)).length;
  const stagiaires = rows.filter((l) => l.enrollment?.statut === "stagiaire").length;
  const ruptures = rows.filter((l) => ["rupture", "abandon"].includes(l.enrollment?.statut)).length;
  const row = (l) => {
    const e = l.enrollment;
    const [lbl, cls] = ENR_BADGE[e?.statut] || ["Sans inscription", "warn"];
    return `<div class="item">
      <div class="grow"><div class="ttl">${esc(l.nom.toUpperCase())} ${esc(l.prenom)} <span class="pill ${cls}">${lbl}</span>${l.rqth ? ' <span class="pill" title="Reconnaissance de la qualité de travailleur handicapé">RQTH</span>' : ""}</div>
        <div class="sub muted">${e ? esc(e.schoolYear) + (e.className ? " · " + esc(e.className) : "") + " · " : ""}${l.ine ? "INE " + esc(l.ine) + " · " : ""}${esc(state.campuses.find((c) => c.id === l.campusId)?.name || "")}</div></div>
      <button class="btn-ghost btn-sm lr-open" data-id="${l.id}">Dossier</button>
    </div>`;
  };
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k"><div class="v">${rows.length}</div><div class="l">dossiers</div></div>
      <div class="k"><div class="v">${actifs}</div><div class="l">en formation</div></div>
      ${stagiaires ? `<div class="k k-bad"><div class="v">${stagiaires}</div><div class="l">stagiaires post-rupture</div></div>` : ""}
      <div class="k${ruptures ? " k-bad" : ""}"><div class="v">${ruptures}</div><div class="l">ruptures / abandons</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <input class="txt" id="lr-q" placeholder="Rechercher (nom, INE, email…)" value="${esc(appFilter.q)}" style="max-width:280px;">
      ${isAdmin() ? `<select class="txt" id="lr-campus" style="max-width:220px;"><option value="">Tous les campus</option>${state.campuses.map((c) => `<option value="${c.id}" ${appFilter.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}
    </div>
    ${rows.length ? `<div class="list">${rows.map(row).join("")}</div>` : `<p class="empty">Aucun dossier apprenant${appFilter.q ? " pour cette recherche" : " — crée le premier avec « + Apprenant »"}.</p>`}`;
  let qTimer;
  $("#lr-q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { appFilter.q = $("#lr-q").value.trim(); renderApprenants(); }, 300); });
  $("#lr-campus")?.addEventListener("change", () => { appFilter.campusId = $("#lr-campus").value; renderApprenants(); });
  $$(".lr-open").forEach((b) => b.addEventListener("click", () => openLearnerFiche(b.dataset.id)));
}

function openLearnerForm(learner, onDone) {
  const l = learner || {};
  openModal(l.id ? `Modifier — ${l.prenom} ${l.nom}` : "Nouvel apprenant", `
    <div class="grid" style="grid-template-columns:110px 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Civilité</label><select class="txt" id="lf-civ">${["", "M.", "Mme", "Autre"].map((c) => `<option ${c === (l.civilite || "") ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Nom *</label><input class="txt" id="lf-nom" value="${esc(l.nom || "")}"></div>
      <div class="field"><label class="field-label">Prénom *</label><input class="txt" id="lf-prenom" value="${esc(l.prenom || "")}"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Né(e) le</label><input class="txt" id="lf-ddn" type="date" value="${esc(l.dateNaissance || "")}"></div>
      <div class="field"><label class="field-label">Lieu de naissance</label><input class="txt" id="lf-ldn" value="${esc(l.lieuNaissance || "")}"></div>
      <div class="field"><label class="field-label">INE</label><input class="txt" id="lf-ine" value="${esc(l.ine || "")}" placeholder="requis pour SIFA"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Email</label><input class="txt" id="lf-email" type="email" value="${esc(l.email || "")}"></div>
      <div class="field"><label class="field-label">Téléphone</label><input class="txt" id="lf-tel" value="${esc(l.telephone || "")}"></div>
    </div>
    <div class="field"><label class="field-label">Adresse</label><input class="txt" id="lf-adr" value="${esc(l.adresse || "")}"></div>
    <div class="field"><label class="field-label">Campus *</label><select class="txt" id="lf-campus">${campusOptions(l.campusId)}</select></div>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;"><input type="checkbox" id="lf-rqth" ${l.rqth ? "checked" : ""}> <span>RQTH <span class="muted">(déclenche le suivi référent handicap)</span></span></label>
    <details style="margin:8px 0;"><summary class="muted" style="cursor:pointer;">Représentant légal (si mineur)</summary>
      <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px;">
        <div class="field"><label class="field-label">Nom</label><input class="txt" id="lf-rlnom" value="${esc(l.repLegalNom || "")}"></div>
        <div class="field"><label class="field-label">Téléphone</label><input class="txt" id="lf-rltel" value="${esc(l.repLegalTel || "")}"></div>
        <div class="field"><label class="field-label">Email</label><input class="txt" id="lf-rlemail" value="${esc(l.repLegalEmail || "")}"></div>
      </div></details>
    <div class="field"><label class="field-label">Notes internes</label><textarea id="lf-notes" rows="2">${esc(l.notes || "")}</textarea></div>
    <div class="actions"><button class="btn-primary" id="lf-save">${l.id ? "Enregistrer" : "Créer le dossier"}</button> <span class="status" id="lf-msg"></span></div>`);
  $("#lf-save").onclick = () => guard($("#lf-save"), async () => {
    const body = {
      civilite: $("#lf-civ").value, nom: $("#lf-nom").value.trim(), prenom: $("#lf-prenom").value.trim(),
      dateNaissance: $("#lf-ddn").value, lieuNaissance: $("#lf-ldn").value.trim(), ine: $("#lf-ine").value.trim(),
      email: $("#lf-email").value.trim(), telephone: $("#lf-tel").value.trim(), adresse: $("#lf-adr").value.trim(),
      campusId: $("#lf-campus").value, rqth: $("#lf-rqth").checked,
      repLegalNom: $("#lf-rlnom").value.trim(), repLegalTel: $("#lf-rltel").value.trim(), repLegalEmail: $("#lf-rlemail").value.trim(),
      notes: $("#lf-notes").value.trim(),
    };
    if (!body.nom || !body.prenom || !body.campusId) { $("#lf-msg").textContent = "Nom, prénom et campus sont requis."; return; }
    const r = l.id ? await api.patch(`/api/learners/${l.id}`, body) : await api.post("/api/learners", body);
    if (r.error) { $("#lf-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    if (onDone) await onDone(r); else await renderApprenants();
  });
}

async function openLearnerFiche(lid) {
  const l = await api.get(`/api/learners/${lid}`);
  if (!l || l.error) { alert(l?.error || "Dossier introuvable"); return; }
  const classes = await api.get(`/api/classes?campusId=${l.campusId}`) || [];
  const enrRow = (e) => {
    const [lbl, cls] = ENR_BADGE[e.statut] || [e.statut, ""];
    return `<div class="item"><div class="grow"><div class="ttl">${esc(e.schoolYear)} <span class="pill ${cls}">${lbl}</span></div>
      <div class="sub muted">${e.className ? esc(e.className) + " · " : ""}${e.dateDebut ? "du " + esc(e.dateDebut) : ""}${e.dateSortie ? " au " + esc(e.dateSortie) : ""}${e.motifSortie ? " · " + esc(e.motifSortie) : ""}</div></div>
      <button class="btn-ghost btn-sm en-ed" data-id="${e.id}">Modifier</button></div>`;
  };
  const tlRow = (ev) => `<div class="item"><span class="pill">${esc(ev.date || "?")}</span><div class="grow"><div class="ttl" style="font-weight:500;">${esc(ev.label)}</div></div></div>`;
  openModal(`${l.prenom} ${l.nom.toUpperCase()}`, `
    <div class="sub muted" style="margin-bottom:10px;">${l.civilite ? esc(l.civilite) + " · " : ""}${l.dateNaissance ? "né(e) le " + esc(l.dateNaissance) + " · " : ""}${l.ine ? "INE " + esc(l.ine) + " · " : '<span class="pill warn">INE manquant (SIFA)</span> · '}${l.email ? esc(l.email) + " · " : ""}${esc(l.telephone || "")}${l.rqth ? ' · <span class="pill">RQTH</span>' : ""}</div>
    <div class="section-title" style="margin-top:0;">Inscriptions <button class="btn-ghost btn-sm" id="en-add" style="float:right;">+ Inscription</button></div>
    <div class="list" id="en-list">${l.enrollments.length ? l.enrollments.map(enrRow).join("") : `<p class="muted" style="padding:8px;">Aucune inscription.</p>`}</div>
    <div class="section-title">Documents <label class="btn-ghost btn-sm" style="float:right;cursor:pointer;">+ Pièce<input type="file" id="lr-doc" hidden></label></div>
    <div class="list">${l.documents.length ? l.documents.map((d) => `<div class="item"><div class="grow"><div class="ttl" style="font-weight:500;">${esc(d.name)}</div><div class="sub muted">${(d.createdAt || "").slice(0, 10)}</div></div><a class="btn-ghost btn-sm" href="/api/documents/${d.id}/download">⬇</a></div>`).join("") : `<p class="muted" style="padding:8px;">Aucune pièce au dossier.</p>`}</div>
    <div class="section-title">Historique</div>
    <div class="list">${l.timeline.length ? l.timeline.map(tlRow).join("") : `<p class="muted" style="padding:8px;">—</p>`}</div>
    <div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-ghost btn-sm" id="lr-edit">Modifier le dossier</button>
      <button class="btn-ghost btn-sm" id="lr-portal">🔗 Lien portail</button>
      <button class="btn-ghost btn-sm" id="lr-consent">🛡 Autorisations</button>
      <button class="btn-ghost btn-sm" id="lr-certif">📜 Certificat de réalisation</button>
      <button class="btn-ghost btn-sm" id="lr-acquis">🎓 Acquis &amp; dispenses</button>
      <button class="btn-ghost btn-sm" id="lr-suivi">🤝 Suivi du parcours</button>
      <button class="btn-ghost btn-sm" id="lr-export">⬇ Export RGPD</button>
      ${isAdmin() ? `<button class="btn-ghost btn-sm btn-danger" id="lr-del">Supprimer (RGPD)</button>` : ""}
    </div>`);
  const reopen = async () => { document.querySelector(".modal-bg")?.remove(); await openLearnerFiche(lid); };
  $("#lr-edit").onclick = () => { document.querySelector(".modal-bg")?.remove(); openLearnerForm(l, reopen); };
  $("#lr-portal").onclick = () => openPortalLink("learner", l.id, l.campusId, `${l.prenom} ${l.nom}`);
  $("#lr-consent").onclick = () => openConsentForm(l, reopen);
  $("#lr-export").onclick = () => window.open(`/api/learners/${l.id}/export`, "_blank");
  $("#lr-certif").onclick = () => openCertificat(l);
  $("#lr-acquis").onclick = () => openAcquis(l);
  $("#lr-suivi").onclick = () => openSuiviParcours(l);
  $("#lr-del")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement le dossier de ${l.prenom} ${l.nom} (inscriptions comprises) ?`)) return;
    await api.del(`/api/learners/${lid}`);
    document.querySelector(".modal-bg")?.remove();
    await renderApprenants();
  });
  $("#en-add").onclick = () => openEnrollmentForm(l, null, classes, reopen);
  $$(".en-ed").forEach((b) => b.addEventListener("click", () => openEnrollmentForm(l, l.enrollments.find((e) => e.id === b.dataset.id), classes, reopen)));
  $("#lr-doc").addEventListener("change", async () => {
    const file = $("#lr-doc").files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await (await fetch(`/api/learners/${lid}/documents`, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd })).json();
    if (r.error) { alert(r.error); return; }
    await reopen();
  });
}

function openEnrollmentForm(l, enr, classes, onDone) {
  const e = enr || {};
  const yearDefault = (() => { const d = new Date(); const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${y + 1}`; })();
  document.querySelector(".modal-bg")?.remove();
  openModal(`${enr ? "Modifier l'inscription" : "Nouvelle inscription"} — ${l.prenom} ${l.nom}`, `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Année scolaire *</label><input class="txt" id="ef-year" value="${esc(e.schoolYear || yearDefault)}" placeholder="2026-2027"></div>
      <div class="field"><label class="field-label">Classe</label><select class="txt" id="ef-class"><option value="">—</option>${classes.map((k) => `<option value="${k.id}" ${k.id === e.classId ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Statut</label><select class="txt" id="ef-statut">${Object.entries(ENR_BADGE).map(([k, [lbl]]) => `<option value="${k}" ${k === (e.statut || "inscrit") ? "selected" : ""}>${lbl}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Début</label><input class="txt" id="ef-deb" type="date" value="${esc(e.dateDebut || "")}"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Sortie <span class="muted">(si sorti/rupture)</span></label><input class="txt" id="ef-fin" type="date" value="${esc(e.dateSortie || "")}"></div>
      <div class="field"><label class="field-label">Motif de sortie</label><input class="txt" id="ef-motif" value="${esc(e.motifSortie || "")}"></div>
    </div>
    <div class="actions"><button class="btn-primary" id="ef-save">Enregistrer</button> <span class="status" id="ef-msg"></span></div>`);
  $("#ef-save").onclick = () => guard($("#ef-save"), async () => {
    const body = { schoolYear: $("#ef-year").value.trim(), classId: $("#ef-class").value || null, statut: $("#ef-statut").value, dateDebut: $("#ef-deb").value, dateSortie: $("#ef-fin").value, motifSortie: $("#ef-motif").value.trim() };
    if (!body.schoolYear) { $("#ef-msg").textContent = "Année scolaire requise."; return; }
    const r = enr ? await api.patch(`/api/learners/${l.id}/enrollments/${enr.id}`, body) : await api.post(`/api/learners/${l.id}/enrollments`, body);
    if (r.error) { $("#ef-msg").textContent = r.error; return; }
    if (onDone) await onDone();
  });
}

// ---------- Vue : SI campus (connecteur ERP) ----------
const nfr = (n) => (n == null ? "—" : Number(n).toLocaleString("fr-FR"));
async function renderSi() {
  $("#topbar-actions").innerHTML = isAdmin() ? `<button class="btn-primary btn-sm" id="si-sync-all">⟳ <span>Tout synchroniser</span></button>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const rows = await api.get("/api/si/overview") || [];
  const configured = rows.filter((r) => r.config?.configured);
  const statusPill = (r) => {
    if (!r.config?.configured) return `<span class="pill">non connecté</span>`;
    if (!r.config.enabled) return `<span class="pill">en pause</span>`;
    if (r.lastError && (!r.syncedAt || r.lastError.at > r.syncedAt)) return `<span class="pill overdue">échec de synchro</span>`;
    if (r.syncedAt) return `<span class="pill done">synchronisé ${new Date(r.syncedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>`;
    return `<span class="pill doing">jamais synchronisé</span>`;
  };
  const kpiCell = (v, l, tone) => `<div class="k${tone ? " k-" + tone : ""}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const card = (r) => {
    const s = r.summary;
    const nRupt = s?.contrats?.rupturesEnCours?.length || 0;
    const ar = s?.assiduite?.absentRate;
    return `<div class="card card-pad" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <h3 style="margin:0;">${esc(r.campus)} ${statusPill(r)}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${s ? `<button class="btn-ghost btn-sm si-detail" data-id="${r.campusId}">Détail</button>` : ""}
          ${isAdmin() && r.config?.configured ? `<button class="btn-ghost btn-sm si-sync" data-id="${r.campusId}">Synchroniser</button>` : ""}
          ${isAdmin() ? `<button class="btn-ghost btn-sm si-cfg" data-id="${r.campusId}">Configurer</button>` : ""}
        </div>
      </div>
      ${r.lastError && (!r.syncedAt || r.lastError.at > r.syncedAt) ? `<p class="sub" style="color:var(--bad);margin:8px 0 0;">${esc(r.lastError.message)}</p>` : ""}
      ${s ? `<div class="kpis" style="margin-top:12px;">
        ${kpiCell(nfr(s.effectif), "apprenants")}
        ${kpiCell(ar != null ? ar + " %" : "—", "absentéisme (30 j)", ar != null && ar > 10 ? "bad" : "")}
        ${kpiCell(s.absences ? nfr(s.absences.unjustifiedH) + " h" : "—", "abs. non justifiées")}
        ${kpiCell(nfr(s.contrats?.actifs), "contrats actifs")}
        ${kpiCell(String(nRupt), "ruptures en cours", nRupt ? "bad" : "")}
        ${kpiCell(s.finance ? nfr(s.finance.ecart) + " €" : "—", "écart facturé/assiduité", s.finance?.ecart > 0 ? "bad" : "")}
      </div>` : r.config?.configured ? "" : `<p class="sub muted" style="margin:8px 0 0;">Renseigne l'URL de l'instance du SI du campus et son jeton API pour alimenter automatiquement effectifs, assiduité, contrats et facturation.</p>`}
    </div>`;
  };
  view.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px;"><p style="margin:0;">Connecteur <strong>SI campus</strong> — l'ERP de gestion de chaque campus alimente le cockpit chaque nuit : effectifs, assiduité, contrats d'alternance (dont <strong>ruptures en cours</strong>) et écart facturation/assiduité OPCO. <span class="muted">Le jeton se crée dans le module « prestataires webservices REST » du SI du campus.</span></p></div>
    ${rows.length ? rows.map(card).join("") : `<p class="empty">Ajoute d'abord des campus.</p>`}
    ${configured.length ? "" : rows.length ? `<p class="hint muted">Aucun campus connecté pour l'instant${isAdmin() ? " — clique sur « Configurer »" : ""}.</p>` : ""}`;
  $("#si-sync-all")?.addEventListener("click", async () => {
    $("#si-sync-all").disabled = true;
    const r = await api.post("/api/si/sync");
    const ko = (r.results || []).filter((x) => !x.ok);
    alert(r.results?.length ? `Synchronisation : ${r.results.length - ko.length} ok${ko.length ? `, ${ko.length} en échec (${ko.map((x) => x.campus).join(", ")})` : ""}` : "Aucun campus connecté.");
    renderSi();
  });
  $$(".si-cfg").forEach((b) => b.addEventListener("click", () => openSiConfig(rows.find((r) => r.campusId === b.dataset.id))));
  $$(".si-sync").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Synchro…";
    const r = await api.post(`/api/campuses/${b.dataset.id}/si/sync`);
    if (r.error) alert(r.error);
    renderSi();
  }));
  $$(".si-detail").forEach((b) => b.addEventListener("click", () => openSiDetail(rows.find((r) => r.campusId === b.dataset.id))));
}

function openSiConfig(r) {
  if (!r) return;
  const c = r.config || {};
  openModal(`SI campus — ${r.campus}`, `
    <div class="field"><label class="field-label">URL de l'instance <span class="muted">(ex. https://erp.moncampus.fr)</span></label><input class="txt" id="sic-url" value="${esc(c.baseUrl || "")}" placeholder="https://…"></div>
    <div class="field"><label class="field-label">Jeton API <span class="muted">${c.tokenMask ? "(actuel : " + esc(c.tokenMask) + " — laisser vide pour conserver)" : "(prestataire webservices REST)"}</span></label><input class="txt" id="sic-token" type="password" placeholder="${c.tokenMask ? "inchangé" : "jeton X-Auth-Token"}"></div>
    <div class="field"><label class="field-label">Codes site <span class="muted">(optionnel, séparés par des virgules — pour une instance multi-sites)</span></label><input class="txt" id="sic-sites" value="${esc(c.codesSite || "")}"></div>
    <label style="display:flex;align-items:center;gap:8px;margin:10px 0;"><input type="checkbox" id="sic-enabled" ${c.enabled !== false ? "checked" : ""}> <span>Synchronisation quotidienne active</span></label>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-primary" id="sic-save">Enregistrer</button>
      <button class="btn-ghost" id="sic-test">Tester la connexion</button>
    </div>
    <div id="sic-msg" class="sub" style="margin-top:8px;"></div>`);
  const msg = (t, ok) => { const m = $("#sic-msg"); m.textContent = t; m.style.color = ok ? "var(--good)" : "var(--bad)"; };
  const save = async () => {
    const body = { baseUrl: $("#sic-url").value.trim(), codesSite: $("#sic-sites").value.trim(), enabled: $("#sic-enabled").checked };
    const tok = $("#sic-token").value.trim();
    if (tok) body.token = tok;
    const res = await api.put(`/api/campuses/${r.campusId}/si/config`, body);
    if (res.error) { msg(res.error, false); return null; }
    return res;
  };
  $("#sic-save").onclick = async () => { if (await save()) { msg("Configuration enregistrée.", true); setTimeout(() => { document.querySelector(".modal-bg")?.remove(); renderSi(); }, 500); } };
  $("#sic-test").onclick = async () => {
    if (!(await save())) return;
    msg("Test en cours…", true);
    const res = await api.post(`/api/campuses/${r.campusId}/si/test`);
    if (res.error) msg(res.error, false);
    else msg(`Connexion OK — ${res.sites?.length || 0} site(s) : ${(res.sites || []).map((s) => s.nom || s.code).slice(0, 5).join(", ")}`, true);
  };
}

function openSiDetail(r) {
  const s = r?.summary;
  if (!s) return;
  const ruptRow = (x, resil) => `<div class="item"><div class="grow"><div class="ttl">${esc(x.apprenant)}</div><div class="sub muted">${resil ? "Résilié le " + esc(x.dateResiliation || "?") : "Résiliation en cours"}${x.motif ? " · " + esc(x.motif) : ""}${x.dateDeb ? " · contrat depuis " + esc(x.dateDeb) : ""}</div></div>${x.npecOpco ? `<span class="pill">NPEC ${nfr(x.npecOpco)} €</span>` : ""}</div>`;
  openModal(`SI campus — ${r.campus} (fenêtre ${s.windowDays} j)`, `
    ${s.errors ? `<p class="sub" style="color:var(--bad);">Endpoints en échec : ${esc(Object.keys(s.errors).join(", "))} — vérifier les endpoints autorisés du jeton.</p>` : ""}
    ${s.contrats ? `<div class="section-title" style="margin-top:0;">Ruptures de contrat</div>
      ${s.contrats.rupturesEnCours.length ? `<div class="sub muted" style="margin-bottom:6px;">En cours de résiliation :</div><div class="list">${s.contrats.rupturesEnCours.map((x) => ruptRow(x, false)).join("")}</div>` : ""}
      ${s.contrats.rupturesPeriode.length ? `<div class="sub muted" style="margin:8px 0 6px;">Résiliées sur la période :</div><div class="list">${s.contrats.rupturesPeriode.map((x) => ruptRow(x, true)).join("")}</div>` : ""}
      ${!s.contrats.rupturesEnCours.length && !s.contrats.rupturesPeriode.length ? `<p class="muted">Aucune rupture — ${nfr(s.contrats.actifs)} contrat(s) actif(s) sur ${nfr(s.contrats.total)}.</p>` : ""}` : ""}
    ${s.absences?.topAbsents?.length ? `<div class="section-title">Apprenants les plus absents (30 j)</div>
      <div class="list">${s.absences.topAbsents.map((x) => `<div class="item"><div class="grow"><div class="ttl">${esc(x.nom)}</div><div class="sub muted">${nfr(Math.round(x.totalMin / 60))} h dont ${nfr(Math.round(x.unjustifiedMin / 60))} h non justifiées · ${x.count} absence(s)</div></div></div>`).join("")}</div>` : ""}
    ${s.finance ? `<div class="section-title">Facturation vs assiduité (base OPCO)</div>
      <div class="kpis">
        <div class="k"><div class="v">${nfr(s.finance.facture)} €</div><div class="l">facturé</div></div>
        <div class="k"><div class="v">${nfr(s.finance.assiduite)} €</div><div class="l">valeur assiduité</div></div>
        <div class="k${s.finance.ecart > 0 ? " k-bad" : ""}"><div class="v">${nfr(s.finance.ecart)} €</div><div class="l">écart (risque OPCO)</div></div>
      </div>
      <p class="hint muted">Un écart positif = du facturé non couvert par l'assiduité constatée → risque de reprise OPCO liée à l'absentéisme.</p>` : ""}`);
}

// ---------- Vue : Journal d'audit ----------
async function renderJournal() {
  const view = $("#view");
  $("#topbar-actions").innerHTML = "";
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const rows = await api.get("/api/audit") || [];
  if (!rows.length) { view.innerHTML = `<p class="empty">Journal vide — les créations, modifications, suppressions et téléversements y seront tracés.</p>`; return; }
  const actLabel = { create: "Création", delete: "Suppression", update: "Modification", upload: "Téléversement", export: "Export", purge: "Purge", send: "Envoi", seed: "Génération" };
  const targetLabel = { campus: "Campus", action: "Action", user: "Utilisateur", partner: "Entreprise", document: "Document", "network-objectives": "Objectifs réseau", decision: "Décision", review: "Revue", event: "Événement", opening: "Ouverture", scenario: "Scénario", settings: "Paramètres", rgpd: "RGPD", "rgpd-user": "Export RGPD", "rgpd-audit": "Purge RGPD", "board-pack": "Board pack" };
  const dt = (iso) => new Date(iso).toLocaleString("fr-FR");
  view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div class="muted" style="font-size:13px;">${rows.length} évènement${rows.length > 1 ? "s" : ""} (300 derniers)</div>
      <button class="btn-primary btn-sm" id="audit-csv">⤓ Exporter en CSV</button>
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
    <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détail</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${dt(r.at)}</td><td>${esc(r.userName || "—")}</td><td>${actLabel[r.action] || r.action}</td><td>${targetLabel[r.target] || r.target}</td><td>${esc(r.detail || "")}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint muted" style="margin-top:12px;">Traçabilité horodatée par utilisateur (création, modification, suppression, export…).</p>`;
  $("#audit-csv") && ($("#audit-csv").onclick = () => {
    const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const csv = ["Date;Utilisateur;Action;Objet;Détail", ...rows.map((r) => [dt(r.at), r.userName || "", actLabel[r.action] || r.action, targetLabel[r.target] || r.target, r.detail || ""].map(q).join(";"))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "journal-audit.csv"; a.click(); URL.revokeObjectURL(a.href);
  });
}

// ---------- Vue : Ouvertures de campus (rétroplanning) ----------
const OUV_LOTS = [
  // Doit rester aligne sur OPENING_LOTS (lib/calc.js) : une tache dont le lot est
  // absent d'ici n'apparait dans AUCUNE section de la vue « Par lot ».
  { k: "gouv", l: "Gouvernance du projet" },
  { k: "etude", l: "Étude & décision" },
  { k: "immo", l: "Locaux & immobilier" },
  { k: "travaux", l: "Aménagement & travaux" },
  { k: "admin", l: "Administratif & juridique" },
  { k: "offre", l: "Offre & pédagogie" },
  { k: "rh", l: "Recrutement & RH" },
  { k: "finance", l: "Finance & gestion" },
  { k: "si", l: "Systèmes d'information" },
  { k: "marketing", l: "Marketing & admissions" },
  { k: "lancement", l: "Lancement & rentrée" },
];
const OUV_STATUS = { etude: "Étude", preparation: "Préparation", travaux: "Travaux", lancement: "Lancement", ouvert: "Ouvert", abandonne: "Abandonné" };
const TASK_STATUS = { todo: "À faire", doing: "En cours", done: "Fait", blocked: "Bloqué" };
const lotLabel = (k) => OUV_LOTS.find((l) => l.k === k)?.l || k;
function closeModals() { $$(".modal-bg").forEach((m) => m.remove()); }
const daysTo = (d) => (d ? Math.round((new Date(d) - new Date()) / 864e5) : null);
function countdownLabel(d) {
  const n = daysTo(d); if (n == null) return "";
  if (n < 0) return `ouvert depuis ${Math.abs(n)} j`;
  if (n <= 60) return `J‑${n}`;
  return `dans ${Math.round(n / 30.4)} mois`;
}
function ouvProgress(o) { const t = o.tasks || []; const done = t.filter((x) => x.status === "done").length; return { done, total: t.length, pct: t.length ? Math.round(done / t.length * 100) : 0 }; }
async function renderOuvertures() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="ouv-add">+ Nouvelle ouverture</button>`;
  $("#ouv-add").addEventListener("click", () => openOuvertureForm());
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const list = await api.get("/api/openings") || [];
  if (!list.length) { view.innerHTML = `<p class="empty">Aucun projet d'ouverture. Lance-en un : tu obtiens un rétroplanning type (locaux, travaux, recrutement, marketing…) calculé à rebours de la date de rentrée.</p>`; return; }
  view.innerHTML = `<div class="grid grid-2">${list.map(ouvCard).join("")}</div>`;
  $$(".ouv-open").forEach((b) => b.addEventListener("click", () => openOuvertureDetail(b.dataset.id)));
}
function ouvCard(o) {
  const p = ouvProgress(o);
  const overdue = (o.tasks || []).filter((t) => t.status !== "done" && t.dueDate && daysTo(t.dueDate) < 0).length;
  return `<div class="card card-pad">
    <div class="ouv-head"><div><div class="ttl" style="font-size:17px;">${esc(o.name)}</div><div class="sub muted">${esc(o.city || "")}${o.targetDate ? " · rentrée " + o.targetDate : ""}</div></div>
      <span class="pill ouv-st st-${o.status}">${OUV_STATUS[o.status] || o.status}</span></div>
    <div style="margin-top:8px;">${o.targetDate ? `<span class="ouv-cd">${countdownLabel(o.targetDate)}</span>` : '<span class="muted">date à définir</span>'}${overdue ? ` <span class="pill overdue">${overdue} en retard</span>` : ""}</div>
    <div class="sim-gauge" style="margin-top:10px;"><div class="sim-gauge-fill ${p.pct === 100 ? "ok" : ""}" style="width:${p.pct}%"></div></div>
    <div class="sim-gauge-lbl muted">${p.done}/${p.total} tâches · ${p.pct}%</div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary btn-sm ouv-open" data-id="${o.id}">Ouvrir le rétroplanning</button></div>
  </div>`;
}
function openOuvertureForm(o) {
  const e = o || {};
  openModal(o ? "Modifier l'ouverture" : "Nouvelle ouverture de campus", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Nom du projet *</label><input class="txt ouf" data-f="name" value="${esc(e.name || "")}" placeholder="Campus Nantes"></div>
      <div><label class="field-label">Ville</label><input class="txt ouf" data-f="city" value="${esc(e.city || "")}"></div>
      <div><label class="field-label">Région</label><input class="txt ouf" data-f="region" value="${esc(e.region || "")}"></div>
      <div><label class="field-label">Date de rentrée (cible)</label><input class="txt ouf" data-f="targetDate" type="date" value="${esc(e.targetDate || "")}"></div>
      <div><label class="field-label">Budget d'ouverture (€)</label><input class="txt ouf" data-f="budget" type="number" value="${e.budget ?? ""}"></div>
      <div><label class="field-label">Durée du projet (mois avant la rentrée)</label><input class="txt ouf" data-f="dureeMois" type="number" min="12" max="24" step="0.5" value="${e.dureeMois ?? ""}" placeholder="15 (modèle)">
        <p class="hint muted" style="margin-top:4px;">Raccourcir ne comprime que l'amont — étude, décision, recherche du local. Les délais subis (appel d'offres, instruction ERP, chantier, fournisseurs, commission de sécurité) gardent leur date.</p></div>
      ${o ? `<div><label class="field-label">Statut</label><select class="txt ouf" data-f="status">${Object.entries(OUV_STATUS).map(([k, l]) => `<option value="${k}" ${e.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
      <div style="grid-column:1/-1;"><label class="field-label">Notes</label><input class="txt ouf" data-f="notes" value="${esc(e.notes || "")}"></div>
    </div>
    ${o ? (e.targetDate ? `<label class="jal-chk" style="margin-top:10px;"><input type="checkbox" id="ouf-recompute"> Recalculer les dates des tâches depuis la nouvelle rentrée</label>` : "") : `<label class="jal-chk" style="margin-top:10px;"><input type="checkbox" id="ouf-seed" checked> Générer le rétroplanning type (recommandé)</label>`}
    <div class="actions" style="margin-top:14px;"><button class="btn-primary" id="ouf-save">Enregistrer</button></div>`);
  $("#ouf-save").addEventListener("click", async () => {
    const body = {}; $$(".ouf").forEach((i) => (body[i.dataset.f] = i.value));
    if (!String(body.name || "").trim()) return;
    if (o) {
      if ($("#ouf-recompute")?.checked) body.recompute = true;
      await api.patch(`/api/openings/${o.id}`, body);
      closeModals(); openOuvertureDetail(o.id);
    } else {
      body.seed = $("#ouf-seed")?.checked !== false;
      const created = await api.post("/api/openings", body);
      closeModals(); renderOuvertures();
      if (created?.id) openOuvertureDetail(created.id);
    }
  });
}
// Chaîne de l'ouverture affichée (null si non chargée). Module-level parce que
// ouvTaskRow est appelé depuis ouvFriseHtml et les sections par lot, sans contexte.
let ouvChain = null;
// Ce qu'une ligne de tâche gagne à dire : combien d'autres l'attendent, ce qu'il reste de
// marge, et si elle subit déjà le retard d'une autre. Sans ça, 161 lignes se valent.
function chainChips(t) {
  const c = ouvChain?.byId?.[t.id];
  if (!c) return "";
  const out = [];
  if (c.downstream > 0) out.push(`<span class="pill" title="${c.blocks} tâche(s) juste après, ${c.downstream} en aval au total">bloque ${c.downstream}</span>`);
  if (c.slack != null && t.status !== "done") {
    const cls = c.slack <= 0 ? "overdue" : c.slack <= 7 ? "st-task-blocked" : "";
    out.push(`<span class="pill ${cls}" title="jours dont cette tâche peut glisser sans repousser la rentrée">marge ${c.slack} j</span>`);
  }
  if (c.inherited > 0) out.push(`<span class="pill overdue" title="décalage subi du fait d'une tâche amont, hors retard propre">+${c.inherited} j hérités</span>`);
  return out.length ? ` ${out.join(" ")}` : "";
}
function ouvTaskRow(t) {
  const dn = daysTo(t.dueDate); const late = t.status !== "done" && dn != null && dn < 0;
  const when = t.dueDate ? `<span class="${late ? "cell-warn" : ""}">${t.dueDate}${dn != null ? ` (${dn < 0 ? Math.abs(dn) + " j de retard" : "J‑" + dn})` : ""}</span>` : "date libre";
  return `<div class="ouv-task ${t.status === "done" ? "is-done" : ""}">
    <button class="ouv-check st-${t.status} task-cycle" data-tid="${t.id}" title="${TASK_STATUS[t.status]} — cliquer pour changer"></button>
    <div class="grow"><div class="ttl">${t.critical ? '<span class="crit-dot" title="chemin critique"></span>' : ""}${esc(t.title)}</div>
      <div class="sub muted">${when}${t.owner ? " · " + esc(t.owner) : ""}${(t.steps || []).length ? ` · ${(t.steps || []).filter((s) => s.done).length}/${(t.steps || []).length} étapes` : ""}${(t.outputs || []).length ? ` · ${(t.outputs || []).filter((o) => o.status === "validated").length}/${(t.outputs || []).length} livrables` : ""}${t.notes ? " · " + esc(t.notes) : ""}</div></div>
    <span class="pill st-task-${t.status}">${TASK_STATUS[t.status]}</span>${chainChips(t)}
    <button class="btn-ghost btn-sm task-edit" data-tid="${t.id}">✎</button>
  </div>`;
}
function ouvFriseHtml(rows) {
  if (!rows.length) return `<p class="muted">Aucune tâche datée.</p>`;
  const today = new Date().toISOString().slice(0, 10);
  const frLong = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
  const out = []; let inserted = false;
  for (const t of rows) {
    if (!inserted && t.dueDate >= today) { out.push(`<div class="tl-row tl-today"><div class="tl-dot tl-dot-today"></div><div class="tl-body"><span class="tl-nowline">Aujourd'hui</span></div></div>`); inserted = true; }
    const late = t.status !== "done" && t.dueDate < today;
    out.push(`<div class="tl-row"><div class="tl-dot tl-${t.status === "done" ? "done" : (late ? "overdue" : "action")}"></div><div class="tl-body">
      <div class="tl-date">${frLong(t.dueDate)}</div>
      <div class="tl-card"><span class="pill st-task-${t.status}">${TASK_STATUS[t.status]}</span><div class="tl-label">${t.critical ? '<span class="crit-dot"></span>' : ""}${esc(t.title)}</div><div class="tl-meta">${esc(lotLabel(t.lot))}${t.owner ? " · " + esc(t.owner) : ""}</div></div>
    </div></div>`);
  }
  if (!inserted) out.push(`<div class="tl-row tl-today"><div class="tl-dot tl-dot-today"></div><div class="tl-body"><span class="tl-nowline">Aujourd'hui — tout est planifié en amont</span></div></div>`);
  return `<div class="timeline">${out.join("")}</div>`;
}
function ouvBudgetRow(l) {
  l = l || {};
  const conso = l.planned ? Math.round((l.committed || 0) / l.planned * 100) : null;
  return `<tr>
    <td><select class="txt obg" data-f="lot" style="width:150px;">${OUV_LOTS.map((x) => `<option value="${x.k}" ${l.lot === x.k ? "selected" : ""}>${x.l}</option>`).join("")}</select></td>
    <td><input class="txt obg" data-f="label" value="${esc(l.label || "")}" placeholder="Poste" style="min-width:130px;"></td>
    <td><input class="txt obg" data-f="planned" type="number" value="${l.planned || ""}" style="width:105px;"></td>
    <td><input class="txt obg" data-f="committed" type="number" value="${l.committed || ""}" style="width:105px;"></td>
    <td><input class="txt obg" data-f="spent" type="number" value="${l.spent || ""}" style="width:105px;"></td>
    <td class="${conso != null && conso > 100 ? "cell-warn" : ""}">${conso == null ? "—" : conso + " %"}</td>
    <td><button class="btn-ghost btn-sm btn-danger obg-del">✕</button></td>
  </tr>`;
}
function ouvBudgetHtml(o) {
  const lines = o.budgetLines || [];
  const totP = lines.reduce((s, l) => s + (l.planned || 0), 0), totC = lines.reduce((s, l) => s + (l.committed || 0), 0), totS = lines.reduce((s, l) => s + (l.spent || 0), 0);
  return `<div class="kpis" style="margin-bottom:12px;">
      ${fkpi(eur(totP), "Budgété (lots)")}
      ${fkpi(eur(totC), "Engagé", totC > totP && totP ? "bad" : "")}
      ${fkpi(eur(totS), "Réalisé")}
      ${fkpi(o.budget != null ? eur(o.budget - totC) : "—", "Reste à engager", o.budget != null && o.budget - totC < 0 ? "bad" : "good")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Lot</th><th>Poste</th><th>Budgété</th><th>Engagé</th><th>Réalisé</th><th>% conso.</th><th></th></tr></thead>
      <tbody id="obg-body">${(lines.length ? lines : [{}]).map(ouvBudgetRow).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:10px;"><button class="btn-ghost btn-sm" id="obg-add">+ Ligne</button><button class="btn-ghost btn-sm" id="obg-seed">Générer un budget type</button><button class="btn-primary btn-sm" id="obg-save">Enregistrer le budget</button><span id="obg-msg" class="status"></span></div>
    <p class="hint muted" style="margin-top:8px;">« Budget type » répartit le budget d'ouverture total par lot (travaux 40 %, marketing 18 %, RH 12 %…). % conso. = engagé / budgété ; dépassement signalé en rouge.</p>`;
}
// --- Onglet « Paramètres réseau » ---
// Les trois choses qu'un modèle de rétroplanning ne peut pas deviner. Elles ne sont
// pas décoratives : un délai fournisseur réel REMONTE la date de commande depuis la
// date de livraison requise, et un montant au-dessus d'un seuil INSÈRE la validation
// budgétaire qui doit la précéder.
const opmMilestoneRow = (j = {}) => `<tr>
  <td><input class="txt opm" data-f="title" value="${esc(j.title || "")}" placeholder="Ex. Validation du dossier par le comité réseau"></td>
  <td><select class="txt opm" data-f="lot" style="width:150px;">${OUV_LOTS.map((l) => `<option value="${l.k}" ${j.lot === l.k ? "selected" : ""}>${l.l}</option>`).join("")}</select></td>
  <td><input class="txt opm" data-f="m" type="number" step="0.5" style="width:80px;" value="${j.m ?? ""}" placeholder="12"></td>
  <td><input class="txt opm" data-f="owner" style="width:140px;" value="${esc(j.owner || "")}" placeholder="Responsable"></td>
  <td style="text-align:center;"><input class="opm" data-f="critical" type="checkbox" ${j.critical ? "checked" : ""}></td>
  <td><button class="btn-ghost btn-sm opm-del" title="Supprimer">✕</button></td></tr>`;

const opsThresholdRow = (s = {}) => `<tr>
  <td><input class="txt ops" data-f="label" value="${esc(s.label || "")}" placeholder="Ex. Direction générale"></td>
  <td><input class="txt ops" data-f="minAmount" type="number" step="1000" style="width:120px;" value="${s.minAmount ?? ""}" placeholder="100000"></td>
  <td><input class="txt ops" data-f="approver" style="width:160px;" value="${esc(s.approver || "")}" placeholder="Qui valide"></td>
  <td><input class="txt ops" data-f="leadDays" type="number" style="width:90px;" value="${s.leadDays ?? ""}" placeholder="45"></td>
  <td><button class="btn-ghost btn-sm ops-del" title="Supprimer">✕</button></td></tr>`;

const oplLeadRow = (fams, l = {}) => `<tr>
  <td><select class="txt opl" data-f="family" style="width:230px;"><option value="">— famille —</option>${fams.map((f) => `<option value="${f.k}" ${l.family === f.k ? "selected" : ""}>${esc(f.label)}</option>`).join("")}</select></td>
  <td><input class="txt opl" data-f="supplier" style="width:150px;" value="${esc(l.supplier || "")}" placeholder="Fournisseur"></td>
  <td><input class="txt opl" data-f="leadWeeks" type="number" step="1" style="width:90px;" value="${l.leadWeeks ?? ""}" placeholder="20"></td>
  <td><input class="txt opl" data-f="amount" type="number" step="1000" style="width:110px;" value="${l.amount ?? ""}" placeholder="145000"></td>
  <td class="muted opl-def" style="font-size:12px;">${l.family ? (fams.find((f) => f.k === l.family)?.defaultLeadWeeks ?? "—") + " sem." : "—"}</td>
  <td><button class="btn-ghost btn-sm opl-del" title="Supprimer">✕</button></td></tr>`;

function ouvParamsHtml(cfg, fams) {
  return `<p class="hint muted" style="margin-bottom:12px;">Ces réglages valent pour <strong>toutes les ouvertures du réseau</strong>. Ils ne s'appliquent pas tout seuls : enregistre, puis clique « Appliquer à ce rétroplanning » — les tâches déjà renseignées (responsable, étapes, statut) sont conservées.</p>

  <div class="ouv-lot"><div class="ouv-lot-head"><span class="ttl">Jalons de convention de réseau</span><span class="muted">ajoutés au rétroplanning</span></div>
    <p class="hint muted" style="margin:6px 0;">Les étapes propres à ta convention ISO que le modèle générique ignore. « Mois avant » = nombre de mois avant la rentrée.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Jalon</th><th>Lot</th><th>Mois avant</th><th>Responsable</th><th>Critique</th><th></th></tr></thead>
      <tbody id="opm-body">${(cfg.milestones.length ? cfg.milestones : [{}]).map(opmMilestoneRow).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="opm-add">+ Jalon</button></div></div>

  <div class="ouv-lot" style="margin-top:16px;"><div class="ouv-lot-head"><span class="ttl">Seuils de validation budgétaire</span><span class="muted">insèrent une tâche avant chaque commande concernée</span></div>
    <p class="hint muted" style="margin:6px 0;">Un engagement au-dessus d'un seuil génère la validation qui doit le précéder, datée du <strong>délai d'obtention</strong> avant la commande. C'est le seuil le plus exigeant franchi qui s'applique.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Palier</th><th>À partir de (€)</th><th>Approbateur</th><th>Délai (jours)</th><th></th></tr></thead>
      <tbody id="ops-body">${(cfg.thresholds.length ? cfg.thresholds : [{}]).map(opsThresholdRow).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="ops-add">+ Palier</button></div></div>

  <div class="ouv-lot" style="margin-top:16px;"><div class="ouv-lot-head"><span class="ttl">Délais fournisseurs & engagements</span><span class="muted">déplacent la date de commande</span></div>
    <p class="hint muted" style="margin:6px 0;">Le modèle suppose un délai par défaut (dernière colonne). Saisis le délai <strong>réel</strong> de ton fournisseur : la date de commande est recalculée à rebours de la date de livraison requise. Le montant sert à déclencher le bon palier de validation.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Famille d'équipement</th><th>Fournisseur</th><th>Délai réel (sem.)</th><th>Montant (€)</th><th>Défaut modèle</th><th></th></tr></thead>
      <tbody id="opl-body">${(cfg.leadTimes.length ? cfg.leadTimes : [{}]).map((l) => oplLeadRow(fams, l)).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="opl-add">+ Engagement</button></div></div>

  <div class="actions" style="margin-top:16px;">
    <button class="btn-primary btn-sm" id="opp-save">Enregistrer les paramètres</button>
    <button class="btn-ghost btn-sm" id="opp-apply">Appliquer à ce rétroplanning</button>
    <span id="opp-msg" class="status"></span></div>`;
}

function ouvChainHtml(ch, tasks) {
  if (ch?.noTarget) return `<p class="empty">Renseigne la date de rentrée : sans elle, aucune marge ni glissement n'est calculable.</p>`;
  if (!ch || !ch.datees) return `<p class="empty">Aucune tâche datée.</p>`;
  const by = new Map((tasks || []).map((t) => [t.id, t]));
  const jour = (n) => `${n} jour${n > 1 ? "s" : ""}`;
  const cyc = ch.cycles?.length
    ? `<div class="card card-pad" style="border-left:3px solid #C94B33;margin-bottom:12px;"><div class="ttl">Dépendances circulaires détectées</div>
       <p class="hint muted" style="margin:6px 0 0;">Ces tâches s'attendent mutuellement, le calcul les a contournées. Corrige-les dans la fiche de tâche, sinon les marges en aval sont fausses.</p>
       <ul style="margin:6px 0 0;padding-left:18px;">${ch.cycles.slice(0, 5).map((c) => `<li>${esc(c.join(" → "))}</li>`).join("")}</ul></div>`
    : "";
  const rupt = ch.ruptures.length
    ? `<div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th>Tâche en retard</th><th>Lot</th><th>Retard</th><th>Marge</th><th>Repousse de</th><th>En aval</th><th>Responsable</th></tr></thead>
        <tbody>${ch.ruptures.slice(0, 25).map((r) => `<tr>
          <td>${esc(r.title)}</td><td class="muted">${esc(lotLabel(r.lot))}</td>
          <td>${r.ownDelay} j</td><td class="muted">${r.slack == null ? "—" : r.slack + " j"}</td>
          <td class="${r.cost > 0 ? "cell-warn" : "muted"}">${r.cost > 0 ? r.cost + " j" : "absorbé"}</td>
          <td>${r.downstream || "—"}</td><td class="muted">${esc(r.owner || "—")}</td></tr>`).join("")}</tbody></table></div>
       <p class="hint muted" style="margin-top:8px;">« Repousse de » = le retard <strong>au-delà de la marge</strong>, donc ce qu'il coûte réellement à la rentrée. Classées par ce coût et non par ancienneté : un retard de 40 jours avec 50 jours de marge pèse moins qu'un retard de 5 jours à marge nulle dont 20 tâches dépendent.</p>`
    : `<p class="muted">Aucune tâche en retard.</p>`;
  const chaine = ch.path.length
    ? `<div class="list">${ch.path.map((id) => {
        const t = by.get(id); if (!t) return "";
        const c = ch.byId[id] || {};
        const tendu = c.slack != null && c.slack <= 7;
        return `<div class="ouv-task ${t.status === "done" ? "is-done" : ""}">
          <button class="ouv-check st-${t.status}" style="cursor:default;"></button>
          <div class="grow"><div class="ttl">${esc(t.title)}</div>
            <div class="sub muted">${t.dueDate} · ${esc(lotLabel(t.lot))}${t.owner ? " · " + esc(t.owner) : ""}</div></div>
          <span class="pill ${tendu ? "overdue" : ""}">${c.slack == null ? "—" : "marge " + c.slack + " j"}</span></div>`;
      }).join("")}</div>`
    : `<p class="muted">Chaîne non déterminable.</p>`;
  // Le rebasage ne s'offre que s'il y a quelque chose à reprendre.
  const reb = ch.ruptures.length
    ? `<div class="card card-pad" style="border-left:3px solid #0B6E5F;margin-bottom:14px;">
        <div class="ttl">Reprendre le retard</div>
        <p class="hint muted" style="margin:6px 0 10px;">Repose chaque tâche en retard à sa première date réalisable — pas avant aujourd'hui, et en respectant les délais du plan. <strong>Les tâches à l'heure dont rien ne bouge en amont gardent leur date.</strong> Rien n'est écrit avant que tu aies vu l'aperçu.</p>
        <div class="actions"><button class="btn-ghost btn-sm" id="reb-preview">Simuler le rebasage</button><span id="reb-msg" class="status"></span></div>
        <div id="reb-out"></div></div>`
    : "";
  return `${cyc}${reb}
    <div class="kpis" style="margin-bottom:12px;">
      ${fkpi(ch.slip > 0 ? "+" + ch.slip + " j" : "à l'heure", "Glissement de la rentrée", ch.slip > 0 ? "bad" : "good")}
      ${fkpi(String(ch.ruptures.length), "Tâches en retard", ch.ruptures.length ? "bad" : "good")}
      ${fkpi(String(ch.ruptures.filter((r) => r.cost > 0).length), "Dont hors marge", ch.ruptures.some((r) => r.cost > 0) ? "bad" : "good")}
      ${fkpi(String(ch.datees), "Tâches datées")}
    </div>
    <p class="hint muted" style="margin-bottom:12px;">${ch.slip > 0
      ? `Les retards actuels repoussent la rentrée de <strong>${jour(ch.slip)}</strong>. La chaîne ci-dessous est celle qui le détermine : agir ailleurs ne rattrapera rien.`
      : `Aucun retard ne déborde sa marge : la rentrée n'est pas menacée. La chaîne ci-dessous est le <strong>chemin critique</strong> — c'est là, et nulle part ailleurs, que le prochain retard coûtera.`}</p>
    <div class="ouv-lot"><div class="ouv-lot-head"><span class="ttl">Ruptures</span><span class="muted">${ch.ruptures.length}</span></div>${rupt}</div>
    <div class="ouv-lot" style="margin-top:16px;"><div class="ouv-lot-head"><span class="ttl">${ch.slip > 0 ? "Chaîne qui détermine le glissement" : "Chemin critique"}</span><span class="muted">${ch.path.length} jalons</span></div>${chaine}</div>`;
}

let ouvView = "lot";
let ouvFamilies = null;
// Les directions viennent du serveur, jamais recopiées ici : une liste locale
// aurait dérivé du modèle au premier ajout, et la feuille d'impression d'une
// direction absente serait revenue vide sans rien dire.
let ouvDepts = null;
async function openOuvertureDetail(oid) {
  const o = await api.get(`/api/openings/${oid}`);
  if (!o || o.error) return;
  // Les comités ne sont chargés que pour leur onglet : la modale est reconstruite à
  // chaque mutation, inutile de payer la requête sur les trois autres vues.
  const committees = ouvView === "copil" ? (await api.get(`/api/committees?scope=opening&scopeId=${oid}`)) || [] : [];
  // La chaîne sert partout : les pastilles « bloque N / marge X j » sont sur chaque ligne
  // de tâche, pas seulement dans son onglet. Une requête, réutilisée par toutes les vues.
  ouvChain = ouvView === "params" ? null : await api.get(`/api/openings/${oid}/chain`);
  let opCfg = null;
  if (!ouvDepts) ouvDepts = ((await api.get("/api/openings/meta")) || {}).depts || [];
  if (ouvView === "params") {
    opCfg = (await api.get("/api/opening-settings")) || { milestones: [], thresholds: [], leadTimes: [] };
    // Les familles sont déduites du modèle côté serveur : on les charge une fois par
    // session plutôt que de les recopier ici, où elles dériveraient au premier ajout.
    if (!ouvFamilies) ouvFamilies = ((await api.get("/api/openings/meta")) || {}).families || [];
  }
  const p = ouvProgress(o);
  const byLot = {};
  (o.tasks || []).forEach((t) => { (byLot[t.lot] = byLot[t.lot] || []).push(t); });
  Object.values(byLot).forEach((arr) => arr.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")));
  const lotSection = (lot) => {
    const arr = byLot[lot.k]; if (!arr || !arr.length) return "";
    const ld = arr.filter((t) => t.status === "done").length;
    return `<div class="ouv-lot"><div class="ouv-lot-head"><span class="ttl">${lot.l}</span><span class="muted">${ld}/${arr.length}</span></div><div class="list">${arr.map(ouvTaskRow).join("")}</div></div>`;
  };
  const frise = (o.tasks || []).filter((t) => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const body = `
    <div class="kpis" style="margin-bottom:6px;">
      ${fkpi(o.targetDate ? countdownLabel(o.targetDate) : "—", "Rentrée" + (o.targetDate ? " " + o.targetDate : ""))}
      ${fkpi(p.pct + " %", "Avancement", p.pct === 100 ? "good" : "")}
      ${fkpi(p.done + "/" + p.total, "Tâches faites")}
      ${fkpi(o.budget != null ? eur(o.budget) : "—", "Budget d'ouverture")}
      ${ouvChain?.datees ? fkpi(ouvChain.slip > 0 ? "+" + ouvChain.slip + " j" : "à l'heure", "Glissement rentrée", ouvChain.slip > 0 ? "bad" : "good") : ""}
    </div>
    <div class="row" style="margin:10px 0;gap:8px;align-items:center;">
      <div class="chips" id="ouv-mode"><button class="chip ${ouvView === "lot" ? "active" : ""}" data-m="lot">Par lot</button><button class="chip ${ouvView === "frise" ? "active" : ""}" data-m="frise">Frise</button><button class="chip ${ouvView === "budget" ? "active" : ""}" data-m="budget">Budget</button><button class="chip ${ouvView === "copil" ? "active" : ""}" data-m="copil">Comité</button><button class="chip ${ouvView === "chaine" ? "active" : ""}" data-m="chaine">Chaîne</button><button class="chip ${ouvView === "params" ? "active" : ""}" data-m="params">Paramètres réseau</button></div>
      <button class="btn-ghost btn-sm" id="ouv-addtask">+ Tâche</button>
      <button class="btn-ghost btn-sm" id="ouv-reseed">Régénérer le type</button>
      <button class="btn-ghost btn-sm" id="ouv-xlsx">Excel</button>
      <button class="btn-ghost btn-sm" id="ouv-print">Imprimer le plan</button>
      <select class="txt" id="ouv-print-dir" style="width:auto;padding:4px 8px;font-size:13px;"><option value="">Imprimer une direction…</option>${ouvDepts.map((d) => `<option value="${d.k}">${esc(d.l)}</option>`).join("")}</select>
      <button class="btn-sm" id="ouv-pack">Pack documentaire</button>
      ${o.campusId ? `<button class="btn-ghost btn-sm" disabled>Fiche campus créée ✓</button>` : `<button class="btn-ghost btn-sm" id="ouv-convert">Convertir en campus</button>`}
      <button class="btn-ghost btn-sm" id="ouv-edit">Modifier</button>
      <button class="btn-ghost btn-sm btn-danger" id="ouv-del">Supprimer</button>
    </div>
    <div id="ouv-plan">${ouvView === "chaine" ? ouvChainHtml(ouvChain, o.tasks) : ouvView === "params" ? ouvParamsHtml(opCfg, ouvFamilies || []) : ouvView === "budget" ? ouvBudgetHtml(o) : ouvView === "copil" ? ouvCopilHtml(committees, o) : ouvView === "frise" ? ouvFriseHtml(frise) : (OUV_LOTS.map(lotSection).join("") || '<p class="muted">Aucune tâche. Ajoute-en ou régénère le rétroplanning type.</p>')}</div>`;
  openModal(`${o.name}${o.city ? " · " + o.city : ""}`, body);
  $("#ouv-edit").onclick = () => { closeModals(); openOuvertureForm(o); };
  $("#ouv-del").onclick = async () => { if (!confirm("Supprimer ce projet d'ouverture ?")) return; await api.del(`/api/openings/${oid}`); closeModals(); renderOuvertures(); };
  $("#ouv-addtask").onclick = () => openTaskForm(oid);
  $("#ouv-reseed").onclick = async () => { if (!confirm("Régénérer le rétroplanning type ? Cela remplace les tâches actuelles.")) return; const r = await api.post(`/api/openings/${oid}/seed`, {}); if (r?.error) { alert(r.error); return; } closeModals(); openOuvertureDetail(oid); };
  $("#ouv-xlsx").onclick = () => { location.href = `/api/openings/${oid}/export`; };
  // Deux impressions distinctes : le rétroplanning complet (consultation) et la
  // feuille d'une direction (relecture et signature). C'est la seconde qu'on
  // imprime en pratique — la première fait une cinquantaine de pages.
  $("#ouv-print").onclick = () => window.open(`/api/openings/${oid}/export?format=print`, "_blank");
  $("#ouv-print-dir") && ($("#ouv-print-dir").onclick = () => {
    const d = $("#ouv-print-dir").value;
    if (!d) return;
    window.open(`/api/openings/${oid}/export?format=print&dept=${encodeURIComponent(d)}`, "_blank");
    $("#ouv-print-dir").value = "";
  });
  $("#ouv-pack").onclick = () => openPackForm(oid);
  $("#ouv-convert") && ($("#ouv-convert").onclick = async () => { if (!confirm("Convertir ce projet en fiche campus (le projet passe « Ouvert ») ?")) return; const r = await api.post(`/api/openings/${oid}/convert`, {}); if (r?.ok) { alert(r.already ? "Ce projet est déjà lié à une fiche campus." : "Fiche campus créée ✓ (onglet Campus)"); closeModals(); openOuvertureDetail(oid); } });
  $$("#ouv-mode .chip").forEach((c) => c.addEventListener("click", () => { ouvView = c.dataset.m; closeModals(); openOuvertureDetail(oid); }));
  if (ouvView === "budget") {
    $("#obg-add")?.addEventListener("click", () => $("#obg-body").insertAdjacentHTML("beforeend", ouvBudgetRow()));
    $("#obg-body")?.addEventListener("click", (e) => { if (e.target.closest(".obg-del")) e.target.closest("tr").remove(); });
    $("#obg-seed")?.addEventListener("click", async () => { const r = await api.post(`/api/openings/${oid}/budget/seed`, {}); if (r?.error) { $("#obg-msg").textContent = r.error; return; } closeModals(); openOuvertureDetail(oid); });
    $("#obg-save")?.addEventListener("click", async () => {
      const lines = $$("#obg-body tr").map((tr) => { const l = {}; $$(".obg", tr).forEach((i) => (l[i.dataset.f] = i.value)); return l; }).filter((l) => l.label || l.planned || l.committed || l.spent);
      await api.patch(`/api/openings/${oid}/budget`, { lines });
      closeModals(); openOuvertureDetail(oid);
    });
  }
  if (ouvView === "chaine") {
    const fr = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    $("#reb-preview")?.addEventListener("click", async () => {
      $("#reb-msg").textContent = "calcul…";
      const p = await api.post(`/api/openings/${oid}/rebase`, { apply: false });
      $("#reb-msg").textContent = "";
      if (p?.error) { $("#reb-msg").textContent = p.error; return; }
      if (!p.count) { $("#reb-out").innerHTML = `<p class="muted">Rien à rebaser : aucune échéance n'a besoin de bouger.</p>`; return; }
      const depasse = p.slip > 0;
      $("#reb-out").innerHTML = `
        <div class="kpis" style="margin:10px 0;">
          ${fkpi(String(p.count), "Échéances décalées")}
          ${fkpi(p.maxShift + " j", "Décalage le plus fort")}
          ${fkpi(fr(p.landing), "Atterrissage du plan", depasse ? "bad" : "good")}
          ${fkpi(depasse ? "+" + p.slip + " j" : "dans les temps", "Par rapport à la rentrée", depasse ? "bad" : "good")}
        </div>
        <div class="card" style="overflow-x:auto;max-height:260px;"><table class="net-table">
          <thead><tr><th>Tâche</th><th>Lot</th><th>Avant</th><th>Après</th><th>Décalage</th></tr></thead>
          <tbody>${p.moved.slice(0, 40).map((m) => `<tr><td>${esc(m.title)}</td><td class="muted">${esc(lotLabel(m.lot))}</td><td class="muted">${m.from}</td><td>${m.to}</td><td class="cell-warn">+${m.days} j</td></tr>`).join("")}</tbody></table></div>
        ${p.moved.length > 40 ? `<p class="hint muted" style="margin-top:6px;">+ ${p.moved.length - 40} autres.</p>` : ""}
        <div class="actions" style="margin-top:12px;">
          <button class="btn-ghost btn-sm" id="reb-keep">Rebaser et garder la rentrée</button>
          ${depasse ? `<button class="btn-primary btn-sm" id="reb-move">Rebaser et reporter la rentrée au ${fr(p.landing)}</button>` : ""}
        </div>
        <p class="hint muted" style="margin-top:8px;">${depasse
          ? `Garder la rentrée ne la rend pas tenable : le dépassement de <strong>${p.slip} jours</strong> reste affiché, il faudra le résorber en comprimant des délais. Reporter la rentrée assainit le plan.`
          : `Le plan rebasé tient avant la rentrée : aucun report n'est nécessaire.`}</p>`;
      const lance = async (moveTarget) => {
        if (!confirm(`Rebaser ${p.count} échéance(s)${moveTarget ? ` et reporter la rentrée au ${fr(p.landing)}` : ""} ?`)) return;
        const r = await api.post(`/api/openings/${oid}/rebase`, { apply: true, moveTarget });
        if (r?.error) { $("#reb-msg").textContent = r.error; return; }
        alert(`Plan rebasé ✓\n${r.count} échéance(s) décalée(s)${r.movedTarget ? `\nRentrée reportée au ${fr(r.targetDate)}` : ""}`);
        closeModals(); openOuvertureDetail(oid);
      };
      $("#reb-keep")?.addEventListener("click", () => lance(false));
      $("#reb-move")?.addEventListener("click", () => lance(true));
    });
  }
  if (ouvView === "params") {
    const fams = ouvFamilies || [];
    // Lire les lignes depuis le DOM plutôt que de tenir un état parallèle : c'est ce
    // que fait déjà l'onglet Budget, et ça évite qu'un état et un tableau divergent.
    const lire = (sel, cls) => $$(`${sel} tr`).map((tr) => {
      const l = {};
      $$(`.${cls}`, tr).forEach((i) => (l[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value));
      return l;
    });
    const collecte = () => ({
      milestones: lire("#opm-body", "opm").filter((j) => (j.title || "").trim()),
      thresholds: lire("#ops-body", "ops").filter((s2) => (s2.label || "").trim() || s2.minAmount),
      leadTimes: lire("#opl-body", "opl").filter((l) => l.family),
    });
    $("#opm-add")?.addEventListener("click", () => $("#opm-body").insertAdjacentHTML("beforeend", opmMilestoneRow()));
    $("#ops-add")?.addEventListener("click", () => $("#ops-body").insertAdjacentHTML("beforeend", opsThresholdRow()));
    $("#opl-add")?.addEventListener("click", () => $("#opl-body").insertAdjacentHTML("beforeend", oplLeadRow(fams)));
    $("#ouv-plan")?.addEventListener("click", (e) => {
      const b = e.target.closest(".opm-del, .ops-del, .opl-del");
      if (b) { e.preventDefault(); b.closest("tr").remove(); }
    });
    // Le délai par défaut du modèle n'a de sens qu'une fois la famille choisie : on
    // l'affiche au changement, sinon l'utilisateur corrige un repère invisible.
    $("#opl-body")?.addEventListener("change", (e) => {
      const sel = e.target.closest('select.opl[data-f="family"]'); if (!sel) return;
      const f = fams.find((x) => x.k === sel.value);
      const cell = sel.closest("tr").querySelector(".opl-def");
      if (cell) cell.textContent = f ? `${f.defaultLeadWeeks} sem.` : "—";
    });
    $("#opp-save")?.addEventListener("click", async () => {
      const r = await api.put("/api/opening-settings", collecte());
      $("#opp-msg").textContent = r?.error ? r.error : `Enregistré ✓ ${r.milestones.length} jalons, ${r.thresholds.length} paliers, ${r.leadTimes.length} engagements`;
    });
    $("#opp-apply")?.addEventListener("click", async () => {
      if (!confirm("Appliquer les paramètres réseau à ce rétroplanning ?\n\nLes échéances et la chaîne de dépendances sont recalculées. Tout ce qui a été saisi est conservé : responsable, RACI, étapes, commentaires, livrables, statut. Les tâches ajoutées à la main restent.")) return;
      const saved = await api.put("/api/opening-settings", collecte());
      if (saved?.error) { $("#opp-msg").textContent = saved.error; return; }
      const r = await api.post(`/api/openings/${oid}/apply-settings`, {});
      if (r?.error) { $("#opp-msg").textContent = r.error; return; }
      alert(`Rétroplanning mis à jour ✓\n${r.recalees} tâche(s) recalée(s), ${r.ajoutees} ajoutée(s), ${r.propres} tâche(s) propre(s) conservée(s).`);
      ouvView = "lot"; closeModals(); openOuvertureDetail(oid);
    });
  }
  $$(".task-cycle").forEach((b) => b.addEventListener("click", async () => {
    const t = (o.tasks || []).find((x) => x.id === b.dataset.tid);
    const order = ["todo", "doing", "done", "blocked"]; const next = order[(order.indexOf(t.status) + 1) % order.length];
    await api.patch(`/api/openings/${oid}/tasks/${t.id}`, { status: next });
    closeModals(); openOuvertureDetail(oid);
  }));
  // Le crayon ouvre désormais la fiche complète (contexte, RACI, livrables, échanges).
  $$(".task-edit").forEach((b) => b.addEventListener("click", () => openTaskSheet(oid, b.dataset.tid)));
  // Toute la ligne ouvre la fiche. Le crayon restait le SEUL point d'entrée : sur une
  // ligne de 900 px, viser une icône de 20 px pour accéder au responsable, aux étapes et
  // aux livrables, c'est une cible de 2 % de la largeur — et la fiche passait pour
  // inexistante. On exclut la pastille de statut et le crayon, qui ont leur propre action.
  $$("#ouv-plan .ouv-task").forEach((ligne) => ligne.addEventListener("click", (e) => {
    if (e.target.closest(".ouv-check, .task-edit, a, input, select")) return;
    const bouton = ligne.querySelector(".task-edit");
    if (bouton) openTaskSheet(oid, bouton.dataset.tid);
  }));
  if (ouvView === "copil") {
    $("#cp-add")?.addEventListener("click", () => openCommitteeForm(oid));
    $$(".cp-edit").forEach((b) => b.addEventListener("click", () => openCommitteeForm(oid, committees.find((c) => c.id === b.dataset.cid))));
    $$(".cp-addses").forEach((b) => b.addEventListener("click", () => openSessionSheet(oid, b.dataset.cid)));
    $$(".cp-ses").forEach((b) => b.addEventListener("click", () => openSessionSheet(oid, b.dataset.cid, b.dataset.sid)));
    $$(".cp-task").forEach((b) => b.addEventListener("click", () => openTaskSheet(oid, b.dataset.tid)));
  }
}
async function openPackForm(oid) {
  const r = await api.get(`/api/openings/${oid}/pack?inventaire=1`);
  const pieces = r?.pieces || [];
  if (!pieces.length) { alert("Aucun document à produire pour ce projet."); return; }
  const dossiers = [...new Set(pieces.map((p) => p.dossier))];
  const ICONE = { docx: "Word", pptx: "PowerPoint", xlsx: "Excel" };
  openModal("Pack documentaire", `
    <p class="sub">${pieces.length} documents produits depuis le plan : ils ne peuvent pas diverger de lui.
    Le classeur de pilotage est le seul destiné à être modifié — les autres se régénèrent.</p>
    ${dossiers.map((d) => `
      <div class="ouv-lot"><h4>${esc(d)}</h4>
      ${pieces.filter((p) => p.dossier === d).map((p) => `
        <div class="ouv-task">
          <div style="flex:1;min-width:0;">
            <b>${esc(p.nom)}</b> <span class="pill">${ICONE[p.ext] || esc(p.ext)}</span>
            <div class="sub muted">${esc(p.quoi)}</div>
          </div>
          <button class="btn-ghost btn-sm" data-piece="${esc(p.cle)}">Télécharger</button>
        </div>`).join("")}
      </div>`).join("")}
    <div style="margin-top:14px;display:flex;gap:8px;align-items:center;">
      <button id="pack-tout" class="btn-sm">Télécharger le pack complet (.zip)</button>
      <span id="pack-etat" class="sub muted"></span>
    </div>`);
  $$("[data-piece]").forEach((b) => b.addEventListener("click", () => {
    location.href = `/api/openings/${oid}/pack/${b.dataset.piece}`;
  }));
  $("#pack-tout").onclick = () => {
    const b = $("#pack-tout");
    b.disabled = true;
    $("#pack-etat").textContent = "Construction du pack… (quelques secondes)";
    location.href = `/api/openings/${oid}/pack`;
    // Le navigateur ne signale pas la fin d'un telechargement declenche par
    // navigation : on redonne la main apres un delai plutot que de laisser le
    // bouton mort si l'utilisateur veut relancer.
    setTimeout(() => { b.disabled = false; $("#pack-etat").textContent = "Téléchargement lancé."; }, 12000);
  };
}

function openTaskForm(oid, t) {
  const e = t || {};
  openModal(t ? "Modifier la tâche" : "Nouvelle tâche", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Intitulé *</label><input class="txt tkf" data-f="title" value="${esc(e.title || "")}"></div>
      <div><label class="field-label">Lot</label><select class="txt tkf" data-f="lot">${OUV_LOTS.map((l) => `<option value="${l.k}" ${e.lot === l.k ? "selected" : ""}>${l.l}</option>`).join("")}</select></div>
      <div><label class="field-label">Échéance</label><input class="txt tkf" data-f="dueDate" type="date" value="${esc(e.dueDate || "")}"></div>
      <div><label class="field-label">Responsable</label><input class="txt tkf" data-f="owner" value="${esc(e.owner || "")}"></div>
      <div><label class="field-label">Statut</label><select class="txt tkf" data-f="status">${Object.entries(TASK_STATUS).map(([k, l]) => `<option value="${k}" ${e.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" class="tkf-crit" ${e.critical ? "checked" : ""}> Chemin critique</label></div>
      <div style="grid-column:1/-1;"><label class="field-label">Notes</label><input class="txt tkf" data-f="notes" value="${esc(e.notes || "")}"></div>
    </div>
    <div class="actions" style="margin-top:14px;">${t ? `<button class="btn-ghost btn-sm btn-danger" id="tk-del">Supprimer</button>` : ""}<button class="btn-primary" id="tk-save">Enregistrer</button></div>`);
  $("#tk-save").onclick = async () => {
    const body = {}; $$(".tkf").forEach((i) => (body[i.dataset.f] = i.value)); body.critical = $(".tkf-crit").checked;
    if (!String(body.title || "").trim()) return;
    if (t) await api.patch(`/api/openings/${oid}/tasks/${t.id}`, body); else await api.post(`/api/openings/${oid}/tasks`, body);
    closeModals(); openOuvertureDetail(oid);
  };
  if (t) $("#tk-del").onclick = async () => { if (!confirm("Supprimer cette tâche ?")) return; await api.del(`/api/openings/${oid}/tasks/${t.id}`); closeModals(); openOuvertureDetail(oid); };
}

// ---------- Comité de pilotage & fiche action détaillée ----------
const OUT_STATUS = { todo: "À produire", produced: "Produit", validated: "Validé" };
const SES_STATUS = { planned: "Prévue", held: "Tenue" };

function cpSessionRow(c, s) {
  const dec = (s.resolutions || []).length, act = (s.taskIds || []).length;
  const meta = [
    `${(s.agendaItems || []).length} point(s)`,
    dec ? `${dec} décision(s)` : "",
    act ? `${act} action(s)` : "",
  ].filter(Boolean).join(" · ");
  return `<button class="ouv-task cp-ses" data-cid="${c.id}" data-sid="${s.id}" style="width:100%;text-align:left;">
    <span class="pill st-task-${s.status === "held" ? "done" : "doing"}">${SES_STATUS[s.status]}</span>
    <span class="ttl">${esc(s.date || "date à fixer")}</span>
    <span class="muted">${esc(meta)}</span></button>`;
}

function ouvCopilHtml(committees, o) {
  const add = `<div class="actions" style="margin-top:12px;"><button class="btn-primary btn-sm" id="cp-add">+ Comité de pilotage</button></div>`;
  if (!committees.length) {
    return `<p class="empty">Aucun comité de pilotage sur ce projet.<br><span class="muted">Le comité porte les séances, les décisions et les actions qui en découlent — le rétroplanning dit quoi faire, le comité dit qui tranche.</span></p>${add}`;
  }
  const byId = {};
  (o.tasks || []).forEach((t) => (byId[t.id] = t));
  return committees.map((c) => {
    const sessions = (c.sessions || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const open = (c.sessions || []).flatMap((s) => (s.resolutions || []).map((r) => ({ ...r, date: s.date })));
    const linked = (c.sessions || []).flatMap((s) => s.taskIds || []).map((id2) => byId[id2]).filter(Boolean);
    const late = linked.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));
    return `<div class="ouv-lot">
      <div class="ouv-lot-head">
        <span class="ttl">${esc(c.name)}${c.cadence ? ` <span class="muted">· ${esc(c.cadence)}</span>` : ""}</span>
        <span><button class="btn-ghost btn-sm cp-edit" data-cid="${c.id}">Modifier</button>
              <button class="btn-ghost btn-sm cp-addses" data-cid="${c.id}">+ Séance</button></span>
      </div>
      <div style="padding:0 12px 10px;">
        <p class="muted" style="margin:6px 0;">${(c.members || []).length ? (c.members || []).map((m) => m.name ? `${esc(m.name)}${m.role ? ` <span class="muted">(${esc(m.role)})</span>` : ""}${m.userId ? " ✓" : ""}` : `<i>${esc(m.role)} — à pourvoir</i>`).join(" · ") : "Aucun membre déclaré."}</p>
        ${late.length ? `<p class="neg" style="margin:6px 0;">${late.length} action(s) du comité en retard.</p>` : ""}
        <div class="list">${sessions.length ? sessions.map((s) => cpSessionRow(c, s)).join("") : '<p class="muted">Aucune séance.</p>'}</div>
        ${open.length ? `<p class="field-label" style="margin-top:10px;">Décisions</p><ul style="margin:6px 0 0 18px;padding:0;font-size:13.5px;">${open.map((r) => `<li>${esc(r.text)}${r.owner ? ` — <span class="muted">${esc(r.owner)}</span>` : ""}${r.dueDate ? ` <span class="muted">(${esc(r.dueDate)})</span>` : ""}</li>`).join("")}</ul>` : ""}
        ${linked.length ? `<p class="field-label" style="margin-top:10px;">Actions issues du comité</p><div class="list">${linked.map((t) => `<button class="ouv-task cp-task" data-tid="${t.id}" style="width:100%;text-align:left;"><span class="pill st-task-${t.status}">${TASK_STATUS[t.status]}</span><span class="ttl">${esc(t.title)}</span><span class="muted">${esc(t.dueDate || "")}</span></button>`).join("")}</div>` : ""}
      </div></div>`;
  }).join("") + add;
}

async function openCommitteeForm(oid, c) {
  const e = c || {};
  const members = (e.members || []);
  // Les comptes de l'app, pour rattacher un membre qui en a un : ses actions
  // remontent alors chez lui. Les autres restent de simples participants nommés —
  // on ne force personne à créer un compte pour siéger à un comité.
  const users = await api.get("/api/users").catch(() => []);
  const memberRow = (m = {}) => `<tr>
    <td><input class="txt cpm" data-f="name" value="${esc(m.name || "")}" placeholder="Nom"></td>
    <td><input class="txt cpm" data-f="role" value="${esc(m.role || "")}" placeholder="Rôle"></td>
    <td><input class="txt cpm" data-f="email" value="${esc(m.email || "")}" placeholder="Email"></td>
    <td><select class="txt cpm cpm-user" data-f="userId"><option value="">— sans compte —</option>${(Array.isArray(users) ? users : []).map((u) => `<option value="${u.id}" ${m.userId === u.id ? "selected" : ""}>${esc(u.name || u.email)}</option>`).join("")}</select></td>
    <td><button class="btn-ghost btn-sm cpm-del">×</button></td></tr>`;
  openModal(c ? "Modifier le comité" : "Nouveau comité de pilotage", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nom *</label><input class="txt cpf" data-f="name" value="${esc(e.name || "Comité de pilotage")}"></div>
      <div><label class="field-label">Cadence</label><input class="txt cpf" data-f="cadence" value="${esc(e.cadence || "")}" placeholder="mensuel, bimensuel…"></div>
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="cp-auto" ${e.autoSendMinutes === false ? "" : "checked"}> Diffuser automatiquement le compte rendu, le lendemain de la séance</label>
        <p class="hint muted" style="margin:4px 0 0;">Le délai d'un jour laisse le temps de corriger. Décoché, tu diffuses à la main — et l'app te relance au bout de 4 jours si le compte rendu est rédigé mais n'est parti à personne.</p></div>
    </div>
    <p class="field-label" style="margin-top:12px;">Membres</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Nom</th><th>Rôle</th><th>Email</th><th>Compte</th><th></th></tr></thead><tbody id="cpm-body">${members.map(memberRow).join("") || memberRow()}</tbody></table></div>
    <p class="hint muted">Un siège peut être créé sans nom : le rôle suffit tant que la personne n'est pas recrutée. Rattacher un compte permet au membre de retrouver ses actions dans l'application.</p>
    <button class="btn-ghost btn-sm" id="cpm-add" style="margin-top:6px;">+ Membre</button>
    <div class="actions" style="margin-top:14px;">${c ? `<button class="btn-ghost btn-sm btn-danger" id="cp-del">Supprimer</button>` : ""}<button class="btn-primary" id="cp-save">Enregistrer</button></div>`);
  $("#cpm-add").onclick = () => $("#cpm-body").insertAdjacentHTML("beforeend", memberRow());
  $("#cpm-body").addEventListener("click", (ev) => { if (ev.target.closest(".cpm-del")) ev.target.closest("tr").remove(); });
  $("#cp-save").onclick = async () => {
    const body = {}; $$(".cpf").forEach((i) => (body[i.dataset.f] = i.value));
    body.autoSendMinutes = $("#cp-auto").checked;
    if (!String(body.name || "").trim()) return;
    // On garde un siège dès qu'il porte un nom OU un rôle : « Directeur de campus
    // (à recruter) » est une information utile, pas une ligne vide.
    body.members = $$("#cpm-body tr").map((tr) => { const m = {}; $$(".cpm", tr).forEach((i) => (m[i.dataset.f] = i.value)); return m; })
      .filter((m) => (m.name || "").trim() || (m.role || "").trim());
    if (c) await api.patch(`/api/committees/${c.id}`, body);
    else await api.post("/api/committees", { ...body, scope: "opening", scopeId: oid });
    ouvView = "copil"; closeModals(); openOuvertureDetail(oid);
  };
  if (c) $("#cp-del").onclick = async () => { if (!confirm("Supprimer ce comité et ses séances ?")) return; await api.del(`/api/committees/${c.id}`); ouvView = "copil"; closeModals(); openOuvertureDetail(oid); };
}

async function openSessionSheet(oid, cid, sid) {
  const c = await api.get(`/api/committees/${cid}`);
  if (!c || c.error) return;
  const s = sid ? (c.sessions || []).find((x) => x.id === sid) : null;
  const e = s || {};
  const resRow = (r = {}) => `<tr><td><input class="txt cpr" data-f="text" value="${esc(r.text || "")}" placeholder="Décision"></td><td><input class="txt cpr" data-f="owner" value="${esc(r.owner || "")}" placeholder="Pilote"></td><td><input class="txt cpr" data-f="dueDate" type="date" value="${esc(r.dueDate || "")}"></td><td><button class="btn-ghost btn-sm cpr-del">×</button></td></tr>`;
  const present = new Set(e.presentIds || []);
  openModal(s ? `Séance du ${esc(s.date || "?")}` : "Nouvelle séance", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Date</label><input class="txt sef" data-f="date" type="date" value="${esc(e.date || "")}"></div>
      <div><label class="field-label">Statut</label><select class="txt sef" data-f="status">${Object.entries(SES_STATUS).map(([k, l]) => `<option value="${k}" ${e.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Heure</label><input class="txt sef" data-f="time" value="${esc(e.time || "")}" placeholder="14h00"></div>
      <div><label class="field-label">Lieu</label><input class="txt sef" data-f="place" value="${esc(e.place || "")}" placeholder="Campus, salle A"></div>
    </div>
    <div style="margin-top:10px;"><label class="field-label">Lien de visioconférence</label><input class="txt sef" data-f="link" value="${esc(e.link || "")}" placeholder="https://…"></div>
    ${(c.members || []).length ? `<p class="field-label" style="margin-top:12px;">Présents</p><div class="chips">${(c.members || []).map((m) => `<label class="jal-chk"><input type="checkbox" class="se-pres" value="${m.id}" ${present.has(m.id) ? "checked" : ""}> ${esc(m.name)}</label>`).join("")}</div>` : ""}
    <p class="field-label" style="margin-top:12px;">Ordre du jour <span class="muted">(un point par ligne)</span></p>
    <textarea class="txt" id="se-agenda" rows="5">${esc((e.agendaItems || []).map((a) => a.text).join("\n"))}</textarea>
    <button class="btn-ghost btn-sm" id="se-ia" style="margin-top:6px;">✨ Proposer un ordre du jour (IA)</button>
    <span class="muted" id="se-ia-msg"></span>
    <p class="field-label" style="margin-top:12px;">Compte rendu</p>
    <textarea class="txt" id="se-minutes" rows="6">${esc(e.minutes || "")}</textarea>
    <p class="field-label" style="margin-top:12px;">Décisions</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Décision</th><th>Pilote</th><th>Échéance</th><th></th></tr></thead><tbody id="cpr-body">${(e.resolutions || []).map(resRow).join("") || resRow()}</tbody></table></div>
    <button class="btn-ghost btn-sm" id="cpr-add" style="margin-top:6px;">+ Décision</button>
    ${s ? `<p class="field-label" style="margin-top:14px;">Créer une action depuis cette séance</p>
      <div class="row" style="gap:8px;"><input class="txt" id="se-nt" placeholder="Intitulé de l'action" style="flex:1;"><input class="txt" id="se-nd" type="date" style="max-width:170px;"><button class="btn-ghost btn-sm" id="se-addtask">Créer</button></div>` : ""}
    ${s ? `<div class="ouv-lot" style="margin-top:16px;"><div class="ouv-lot-head"><span class="ttl">Diffusion</span><span class="muted">${(c.members || []).filter((m) => m.email).length}/${(c.members || []).length} membre(s) joignable(s)</span></div>
      <p class="hint muted" style="margin:6px 0 10px;">Convocation automatique à J‑7, rappel à J‑1, relance du compte rendu 2 jours après la séance. Chaque envoi n'a lieu qu'une fois ; ces boutons permettent de l'anticiper ou de le renvoyer après correction.</p>
      <div class="actions"><button class="btn-ghost btn-sm" id="se-prev-conv">Aperçu convocation</button><button class="btn-ghost btn-sm" id="se-prev-cr">Aperçu compte rendu</button><span id="se-mail-msg" class="status"></span></div>
      <div id="se-mail-out"></div>
      ${Object.keys(e.sent || {}).length ? `<p class="hint muted" style="margin-top:8px;">Déjà envoyé : ${Object.entries(e.sent).map(([k, d]) => `${k} le ${d}`).join(" · ")}</p>` : ""}</div>` : ""}
    <div class="actions" style="margin-top:14px;">${s ? `<button class="btn-ghost btn-sm btn-danger" id="se-del">Supprimer</button>` : ""}<button class="btn-primary" id="se-save">Enregistrer</button></div>`);

  if (s) {
    // L'aperçu d'abord, l'envoi ensuite : on ne convoque pas huit personnes à l'aveugle.
    const apercu = async (kind) => {
      $("#se-mail-msg").textContent = "chargement…";
      const p = await api.get(`/api/committees/${cid}/sessions/${sid}/preview?kind=${kind}`);
      $("#se-mail-msg").textContent = "";
      if (p?.error) { $("#se-mail-msg").textContent = p.error; return; }
      const deja = !!(e.sent || {})[kind];
      $("#se-mail-out").innerHTML = `
        <p class="hint muted" style="margin:10px 0 6px;">Destinataires : ${p.to.length ? p.to.map(esc).join(", ") : "<strong>aucun</strong>"}${p.sansEmail.length ? ` · <span class="cell-warn">sans adresse : ${p.sansEmail.map(esc).join(", ")}</span>` : ""}</p>
        <iframe id="se-mail-frame" style="width:100%;height:340px;border:1px solid #EDE7DA;border-radius:8px;background:#fff;"></iframe>
        <div class="actions" style="margin-top:10px;"><button class="btn-primary btn-sm" id="se-send" ${p.to.length ? "" : "disabled"}>${deja ? "Renvoyer" : "Envoyer"} ${kind === "compte-rendu" ? "le compte rendu" : "la convocation"}</button></div>`;
      // srcdoc plutôt qu'une injection dans le DOM : le mail porte ses propres styles, on
      // ne veut ni qu'il hérite de ceux de l'app, ni qu'il les écrase.
      $("#se-mail-frame").srcdoc = p.html;
      $("#se-send").onclick = async () => {
        if (!confirm(`Envoyer à ${p.to.length} destinataire(s) ?`)) return;
        const r = await api.post(`/api/committees/${cid}/sessions/${sid}/send`, { kind, force: true });
        $("#se-mail-msg").textContent = r?.error ? r.error : `Envoyé ✓ ${r.recipients} destinataire(s)`;
      };
    };
    $("#se-prev-conv").onclick = () => apercu("convocation");
    $("#se-prev-cr").onclick = () => apercu("compte-rendu");
  }

  $("#cpr-add").onclick = () => $("#cpr-body").insertAdjacentHTML("beforeend", resRow());
  $("#cpr-body").addEventListener("click", (ev) => { if (ev.target.closest(".cpr-del")) ev.target.closest("tr").remove(); });
  const collect = () => {
    const body = {}; $$(".sef").forEach((i) => (body[i.dataset.f] = i.value));
    body.agendaItems = $("#se-agenda").value.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text }));
    body.minutes = $("#se-minutes").value;
    body.presentIds = $$(".se-pres").filter((i) => i.checked).map((i) => i.value);
    body.resolutions = $$("#cpr-body tr").map((tr) => { const r = {}; $$(".cpr", tr).forEach((i) => (r[i.dataset.f] = i.value)); return r; }).filter((r) => r.text.trim());
    return body;
  };
  $("#se-ia").onclick = async () => {
    if (!s) { $("#se-ia-msg").textContent = " enregistre d'abord la séance."; return; }
    $("#se-ia-msg").textContent = " génération…";
    const r = await api.post(`/api/committees/${cid}/sessions/${s.id}/agenda-draft`, {});
    if (r?.error) { $("#se-ia-msg").textContent = " " + r.error; return; }
    $("#se-ia-msg").textContent = "";
    $("#se-agenda").value = (r.draft || "").trim();
  };
  $("#se-save").onclick = async () => {
    if (s) await api.patch(`/api/committees/${cid}/sessions/${s.id}`, collect());
    else await api.post(`/api/committees/${cid}/sessions`, collect());
    ouvView = "copil"; closeModals(); openOuvertureDetail(oid);
  };
  if (s) {
    $("#se-del").onclick = async () => { if (!confirm("Supprimer cette séance ?")) return; await api.del(`/api/committees/${cid}/sessions/${s.id}`); ouvView = "copil"; closeModals(); openOuvertureDetail(oid); };
    $("#se-addtask").onclick = async () => {
      const title = $("#se-nt").value.trim(); if (!title) return;
      const r = await api.post(`/api/committees/${cid}/sessions/${s.id}/tasks`, { title, dueDate: $("#se-nd").value });
      if (r?.error) { alert(r.error); return; }
      ouvView = "copil"; closeModals(); openOuvertureDetail(oid);
    };
  }
}

async function openTaskSheet(oid, tid) {
  const o = await api.get(`/api/openings/${oid}`);
  const t = (o?.tasks || []).find((x) => x.id === tid);
  if (!t) return;
  // Le répertoire et la GED du campus : sans eux, le RACI reste du texte libre
  // et les pièces ne se rattachent à rien.
  const cid = o.campusId || "";
  const [rep, ged] = await Promise.all([
    cid ? api.get(`/api/personnes?campusId=${cid}`) : Promise.resolve({ personnes: [] }),
    cid ? api.get(`/api/documents?campusId=${cid}`) : Promise.resolve([]),
  ]);
  const gens = rep.personnes || [];
  const docs = Array.isArray(ged) ? ged : [];
  const nomDe = (id) => gens.find((g) => g.id === id)?.nom || null;

  // Un rôle se choisit dans le répertoire. Le texte libre hérité reste visible
  // sous le champ, marqué pour ce qu'il est : un nom qu'on ne peut pas convoquer.
  const choixPersonne = (champ, label, valeur, libre) => `
    <div><label class="field-label">${label}</label>
      <select class="txt tsf" data-f="${champ}"><option value="">—</option>${gens.map((g) => `<option value="${g.id}" ${valeur === g.id ? "selected" : ""}>${esc(g.nom)}${g.role ? ` · ${esc(g.role)}` : ""}</option>`).join("")}</select>
      ${libre && !valeur ? `<p class="hint muted" style="margin-top:4px;color:#8A7A4B;">Saisi à la main : « ${esc(libre)} » — non convocable tant que la personne n'est pas rattachée.</p>` : ""}</div>`;
  const choixMulti = (champ, label, valeurs, libre) => `
    <div><label class="field-label">${label}</label>
      <select class="txt" id="ts-${champ}" multiple size="3">${gens.map((g) => `<option value="${g.id}" ${(valeurs || []).includes(g.id) ? "selected" : ""}>${esc(g.nom)}</option>`).join("")}</select>
      ${libre && !(valeurs || []).length ? `<p class="hint muted" style="margin-top:4px;color:#8A7A4B;">Saisi à la main : « ${esc(libre)} »</p>` : ""}</div>`;
  const others = (o.tasks || []).filter((x) => x.id !== tid);
  const dep = new Set(t.dependsOn || []);
  const outRow = (out) => `<tr>
    <td>${esc(out.label)}</td>
    <td><select class="txt out-st" data-oid="${out.id}">${Object.entries(OUT_STATUS).map(([k, l]) => `<option value="${k}" ${out.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    <td>${esc(out.owner || "—")}</td><td>${esc(out.dueDate || "—")}</td>
    <td>${out.documentId ? `<a class="btn-ghost btn-sm" href="/api/documents/${out.documentId}/download">Télécharger</a>` : `<label class="btn-ghost btn-sm" style="cursor:pointer;">joindre<input type="file" class="out-file" data-oid="${out.id}" hidden></label>`}</td>
    <td><button class="btn-ghost btn-sm out-del" data-oid="${out.id}">×</button></td></tr>`;
  // openModal echappe deja son titre : le passer pre-echappe affichait « &amp; » a l'ecran.
  openModal(t.title, `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Intitulé *</label><input class="txt tsf" data-f="title" value="${esc(t.title)}"></div>
      <div><label class="field-label">Lot</label><select class="txt tsf" data-f="lot">${OUV_LOTS.map((l) => `<option value="${l.k}" ${t.lot === l.k ? "selected" : ""}>${l.l}</option>`).join("")}</select></div>
      <div><label class="field-label">Échéance</label><input class="txt tsf" data-f="dueDate" type="date" value="${esc(t.dueDate || "")}"></div>
      <div><label class="field-label">Statut</label><select class="txt tsf" data-f="status">${Object.entries(TASK_STATUS).map(([k, l]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Avancement %</label><input class="txt tsf" data-f="progress" type="number" min="0" max="100" value="${t.progress == null ? "" : t.progress}" ${(t.steps || []).length ? "disabled" : ""}>${(t.steps || []).length ? '<span class="hint muted">calculé depuis la checklist</span>' : ""}</div>
      <div style="grid-column:1/-1;"><label class="field-label">Contexte</label><textarea class="txt tsf" data-f="description" rows="3">${esc(t.description || "")}</textarea></div>
      ${choixPersonne("ownerId", "Responsable (R)", t.ownerId, t.owner)}
      ${choixPersonne("accountableId", "Approbateur (A)", t.accountableId, t.accountable)}
      ${choixMulti("consultedIds", "Consultés (C)", t.consultedIds, t.consulted)}
      ${choixMulti("informedIds", "Informés (I)", t.informedIds, t.informed)}
      ${gens.length ? "" : '<div style="grid-column:1/-1;"><p class="hint muted" style="color:#8A7A4B;">Le répertoire du campus est vide : tant qu\'aucune personne n\'y figure, aucun rôle n\'est convocable. Réseau → Répertoire du projet.</p></div>'}
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="ts-crit" ${t.critical ? "checked" : ""}> Chemin critique</label></div>
      ${others.length ? `<div style="grid-column:1/-1;"><label class="field-label">Dépend de</label><select class="txt" id="ts-dep" multiple size="4">${others.map((x) => `<option value="${x.id}" ${dep.has(x.id) ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></div>` : ""}
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm btn-danger" id="ts-del">Supprimer l'action</button><button class="btn-primary" id="ts-save">Enregistrer</button></div>

    <p class="field-label" style="margin-top:16px;">À faire ${(t.steps || []).length ? `<span class="muted">— ${(t.steps || []).filter((s) => s.done).length}/${(t.steps || []).length}</span>` : ""}</p>
    <div class="list" id="ts-st">${(t.steps || []).length ? (t.steps || []).map((s) => `<div class="ouv-task${s.done ? " is-done" : ""}"><label class="jal-chk" style="flex:1;"><input type="checkbox" class="st-chk" data-sid="${s.id}" ${s.done ? "checked" : ""}> <span class="ttl">${esc(s.text)}</span></label><button class="btn-ghost btn-sm st-del" data-sid="${s.id}">×</button></div>`).join("") : '<p class="muted">Aucune étape. Découpe l\'action en étapes concrètes : l\'avancement se calculera tout seul.</p>'}</div>
    <div class="row" style="gap:8px;margin-top:8px;"><input class="txt" id="ts-stt" placeholder="Nouvelle étape" style="flex:1;"><button class="btn-ghost btn-sm" id="ts-stadd">Ajouter</button></div>

    <p class="field-label" style="margin-top:16px;">Livrables attendus</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Livrable</th><th>Statut</th><th>Responsable</th><th>Échéance</th><th>Fichier</th><th></th></tr></thead>
      <tbody id="ts-out">${(t.outputs || []).map(outRow).join("") || '<tr><td colspan="6" class="muted">Aucun livrable déclaré.</td></tr>'}</tbody></table></div>
    <div class="row" style="gap:8px;margin-top:8px;">
      <input class="txt" id="ts-ol" placeholder="Nouveau livrable" style="flex:1;">
      <input class="txt" id="ts-oo" placeholder="Responsable" style="max-width:160px;">
      <input class="txt" id="ts-od" type="date" style="max-width:170px;">
      <button class="btn-ghost btn-sm" id="ts-oadd">Ajouter</button>
    </div>

    <p class="field-label" style="margin-top:16px;">Ce qui a été fait</p>
    <p class="hint muted" style="margin-top:0;">Une case cochée ne dit rien. Ce texte est le seul élément qui survivra au départ de celui qui a fait l'étape — et c'est lui qu'on relira devant un auditeur ou au comité suivant.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div style="grid-column:1/-1;"><textarea class="txt" id="ts-real" rows="4" placeholder="Séance du 12 septembre, sept membres présents. Deux décisions : ouverture d'une seconde section, révision du rythme.">${esc(t.realisation?.texte || "")}</textarea></div>
      <div><label class="field-label">Réalisée le</label><input class="txt" id="ts-real-le" type="date" value="${esc(t.realisation?.le || t.doneAt || "")}"></div>
      <div><label class="field-label">Par</label><select class="txt" id="ts-real-par"><option value="">—</option>${gens.map((g) => `<option value="${g.id}" ${t.realisation?.par === g.id ? "selected" : ""}>${esc(g.nom)}</option>`).join("")}</select></div>
    </div>

    <p class="field-label" style="margin-top:16px;">Pièces qui valident le livrable</p>
    <p class="hint muted" style="margin-top:0;">Le compte rendu dit ce qui a été fait ; la pièce le démontre. Procès-verbal signé, récépissé, attestation.</p>
    <div class="list" id="ts-pr">${(t.preuves || []).length ? (t.preuves || []).map((pr) => {
      const d = docs.find((x) => x.id === pr.documentId);
      return `<div class="ouv-task"><span class="ttl">${esc(pr.label || d?.name || "Pièce")}</span>
        ${d ? `<a class="btn-ghost btn-sm" href="/api/documents/${pr.documentId}/download">Ouvrir</a>`
            : '<span class="pill p-bad">document introuvable</span>'}
        <button class="btn-ghost btn-sm pr-del" data-doc="${esc(pr.documentId)}">×</button></div>`;
    }).join("") : '<p class="muted">Aucune pièce annexée.</p>'}</div>
    <div class="row" style="gap:8px;margin-top:8px;">
      <select class="txt" id="ts-prdoc" style="flex:1;"><option value="">— choisir un document du campus —</option>${docs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
      <input class="txt" id="ts-prlab" placeholder="Intitulé" style="max-width:200px;">
      <button class="btn-ghost btn-sm" id="ts-pradd">Annexer</button>
    </div>
    ${docs.length ? "" : '<p class="hint muted" style="color:#8A7A4B;">Aucun document dans la GED de ce campus : dépose d\'abord la pièce dans Documents.</p>'}
    <div id="ts-diag" style="margin-top:12px;"></div>

    <p class="field-label" style="margin-top:16px;">Échanges</p>
    <div class="list" id="ts-cm">${(t.comments || []).length ? (t.comments || []).map((c) => `<div class="ouv-task"><span class="ttl">${esc(c.text)}</span><span class="muted">${esc(c.by || "")} · ${esc((c.at || "").slice(0, 10))}</span><button class="btn-ghost btn-sm cm-del" data-cid="${c.id}">×</button></div>`).join("") : '<p class="muted">Aucun échange.</p>'}</div>
    <div class="row" style="gap:8px;margin-top:8px;"><input class="txt" id="ts-cmt" placeholder="Ajouter un message" style="flex:1;"><button class="btn-ghost btn-sm" id="ts-cmadd">Envoyer</button></div>`);

  const back = () => { closeModals(); openTaskSheet(oid, tid); };
  $("#ts-save").onclick = async () => {
    const body = {}; $$(".tsf").forEach((i) => (body[i.dataset.f] = i.value));
    if (!String(body.title || "").trim()) return;
    body.critical = $("#ts-crit").checked;
    body.progress = body.progress === "" ? null : Number(body.progress);
    if ($("#ts-dep")) body.dependsOn = $$("#ts-dep option").filter((op) => op.selected).map((op) => op.value);
    // Les listes multiples et le bloc de réalisation ne passent pas par `.tsf`.
    for (const f of ["consultedIds", "informedIds"]) {
      body[f] = $$(`#ts-${f} option`).filter((op) => op.selected).map((op) => op.value);
    }
    const texte = $("#ts-real").value.trim();
    body.realisation = texte || $("#ts-real-le").value || $("#ts-real-par").value
      ? { texte, le: $("#ts-real-le").value || null, par: $("#ts-real-par").value || null }
      : null;

    const r = await api.patch(`/api/openings/${oid}/tasks/${tid}`, body);
    // Le diagnostic s'affiche SUR PLACE : refermer la fiche en emportant
    // l'avertissement reviendrait à ne pas l'avoir donné.
    const d = r?.diagnostic;
    if (d && d.manques.length) {
      const GRAV = { bloquant: "#8A4B4B", important: "#8A7A4B", conseille: "var(--border)" };
      $("#ts-diag").innerHTML = d.manques.map((m) => `<div class="item" style="border-left:3px solid ${GRAV[m.gravite]};margin-bottom:6px;"><div class="grow">${esc(m.message)}</div></div>`).join("")
        + '<p class="hint muted">Enregistré. Ces points n\'empêchent rien — ils sont ce qu\'un audit relèverait.</p>';
      return;
    }
    closeModals(); openOuvertureDetail(oid);
  };

  // Annexer une pièce : on enregistre immédiatement, sinon l'ajout se perdrait
  // si la fiche est fermée sans « Enregistrer ».
  $("#ts-pradd").onclick = async () => {
    const doc = $("#ts-prdoc").value;
    if (!doc) { alert("Choisis un document du campus."); return; }
    const preuves = [...(t.preuves || []), { documentId: doc, label: $("#ts-prlab").value.trim() }];
    await api.patch(`/api/openings/${oid}/tasks/${tid}`, { preuves });
    back();
  };
  $$(".pr-del").forEach((b) => { b.onclick = async () => {
    const preuves = (t.preuves || []).filter((x) => x.documentId !== b.dataset.doc);
    await api.patch(`/api/openings/${oid}/tasks/${tid}`, { preuves });
    back();
  }; });
  $("#ts-del").onclick = async () => { if (!confirm("Supprimer cette action ?")) return; await api.del(`/api/openings/${oid}/tasks/${tid}`); closeModals(); openOuvertureDetail(oid); };
  $("#ts-stadd").onclick = async () => {
    const text = $("#ts-stt").value.trim(); if (!text) return;
    await api.post(`/api/openings/${oid}/tasks/${tid}/steps`, { text }); back();
  };
  $("#ts-stt").addEventListener("keydown", (ev) => { if (ev.key === "Enter") $("#ts-stadd").click(); });
  $$(".st-chk").forEach((chk) => chk.addEventListener("change", async () => {
    await api.patch(`/api/openings/${oid}/tasks/${tid}/steps/${chk.dataset.sid}`, { done: chk.checked });
    back();
  }));
  $$(".st-del").forEach((b) => b.addEventListener("click", async () => {
    await api.del(`/api/openings/${oid}/tasks/${tid}/steps/${b.dataset.sid}`); back();
  }));
  $("#ts-oadd").onclick = async () => {
    const label = $("#ts-ol").value.trim(); if (!label) return;
    await api.post(`/api/openings/${oid}/tasks/${tid}/outputs`, { label, owner: $("#ts-oo").value, dueDate: $("#ts-od").value });
    back();
  };
  $$(".out-st").forEach((sel) => sel.addEventListener("change", async () => {
    await api.patch(`/api/openings/${oid}/tasks/${tid}/outputs/${sel.dataset.oid}`, { status: sel.value });
    back();
  }));
  $$(".out-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Supprimer ce livrable ?")) return;
    await api.del(`/api/openings/${oid}/tasks/${tid}/outputs/${b.dataset.oid}`); back();
  }));
  $$(".out-file").forEach((inp) => inp.addEventListener("change", async () => {
    const f = inp.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch(`/api/openings/${oid}/tasks/${tid}/outputs/${inp.dataset.oid}/document`, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd }).then((x) => x.json());
    if (r?.error) { alert(r.error); return; }
    back();
  }));
  $("#ts-cmadd").onclick = async () => {
    const text = $("#ts-cmt").value.trim(); if (!text) return;
    await api.post(`/api/openings/${oid}/tasks/${tid}/comments`, { text }); back();
  };
  $$(".cm-del").forEach((b) => b.addEventListener("click", async () => {
    await api.del(`/api/openings/${oid}/tasks/${tid}/comments/${b.dataset.cid}`); back();
  }));
}

// ---------- Vue : Sauvegardes / Restauration (admin) ----------
async function renderBackups() {
  const view = $("#view");
  $("#topbar-actions").innerHTML = "";
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const rep = await api.get("/api/backups") || {};
  const c = rep.config || {};
  const d = c.distant || {};
  const ko = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR") : "—");

  const h = rep.sante || {};
  const bandeau = h.alertes?.length
    ? `<div class="card card-pad" style="margin-bottom:14px;border-left:3px solid #C94B33;">
        <div class="ttl">La sauvegarde n'est pas au niveau</div>
        <ul style="margin:8px 0 0;padding-left:18px;">${h.alertes.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <p class="hint muted" style="margin-top:8px;">Contrôle automatique chaque matin, avec alerte email. Surveiller l'échec ne suffit pas : quand rien ne tourne, rien n'échoue.</p></div>`
    : `<div class="card card-pad" style="margin-bottom:14px;border-left:3px solid #0B6E5F;">
        <div class="ttl">Sauvegarde saine</div>
        <p style="margin:8px 0 0;">${h.archives} archive(s), la dernière il y a ${h.ageHeures} h. Chiffrées, copiées hors du serveur.</p></div>`;
  view.innerHTML = bandeau + `
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="ttl">Sauvegarde de l'application</div>
      <p style="margin:8px 0 0;">Archive complète de l'état réel — ${rep.mode === "postgres" ? "lue dans <strong>PostgreSQL</strong>" : "lue dans le magasin fichier"} —, <strong>chiffrée</strong>, avec empreinte SHA‑256 vérifiée à la relecture. Elle se restaure dans les deux modes, donc une bascule reste réversible.</p>
      <p class="hint muted" style="margin-top:8px;">Indépendante du <code>pg_dump</code> nocturne côté serveur, qui continue de tourner. Deux mécanismes valent mieux qu'un.</p>
    </div>

    <div class="grid grid-2" style="gap:14px;align-items:start;">
      <div class="card card-pad">
        <div class="ttl">Planification & destination locale</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
          <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="bk-actif" ${c.actif ? "checked" : ""}> Sauvegarde automatique quotidienne</label></div>
          <div><label class="field-label">Heure</label><input class="txt" id="bk-heure" value="${esc(c.heure || "03:10")}" placeholder="03:10"></div>
          <div><label class="field-label">Conserver (archives)</label><input class="txt" id="bk-ret" type="number" min="1" max="365" value="${c.retention || 30}"></div>
          <div style="grid-column:1/-1;"><label class="field-label">Dossier sur le serveur</label><input class="txt" id="bk-dossier" value="${esc(c.dossier || "")}"></div>
          <div><label class="field-label">Hebdomadaires gardées</label><input class="txt" id="bk-sem" type="number" min="0" max="104" value="${c.semaines ?? 8}"></div>
          <div><label class="field-label">Mensuelles gardées</label><input class="txt" id="bk-mois" type="number" min="0" max="120" value="${c.mois ?? 12}"></div>
          <div style="grid-column:1/-1;"><label class="field-label">Alerte email (échec ET absence)</label><input class="txt" id="bk-mail" value="${esc(c.alerteEmail || "")}" placeholder="ops@exemple.fr"></div>
        </div>
        <p class="hint muted" style="margin-top:8px;">Le dossier doit être dans le volume monté, sinon les archives disparaissent à la recréation du conteneur. Rétention étagée : les N dernières quotidiennes, puis une par semaine, puis une par mois — garder 30 archives ne donne que 30 jours de profondeur.</p>
      </div>

      <div class="card card-pad">
        <div class="ttl">Serveur externe</div>
        <p class="hint muted" style="margin:6px 0 10px;">Une sauvegarde qui ne vit que sur la machine qu'elle protège ne protège de rien. Copie par <code>rsync</code> over SSH, avec une <strong>clé montée sur l'hôte</strong> — la clé privée n'entre jamais dans la base.</p>
        <div class="grid" style="grid-template-columns:2fr 1fr;gap:10px;">
          <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="bk-dactif" ${d.actif ? "checked" : ""}> Copier chaque archive vers un serveur externe</label></div>
          <div><label class="field-label">Hôte</label><input class="txt" id="bk-hote" value="${esc(d.hote || "")}" placeholder="10.10.0.1"></div>
          <div><label class="field-label">Port</label><input class="txt" id="bk-port" type="number" value="${d.port || 22}"></div>
          <div><label class="field-label">Utilisateur</label><input class="txt" id="bk-user" value="${esc(d.utilisateur || "root")}"></div>
          <div><label class="field-label">Chemin distant</label><input class="txt" id="bk-chemin" value="${esc(d.chemin || "")}" placeholder="/opt/backups/campus"></div>
          <div style="grid-column:1/-1;"><label class="field-label">Clé SSH (chemin dans le conteneur)</label><input class="txt" id="bk-cle" value="${esc(d.cle || "")}"></div>
        </div>
        <div class="actions" style="margin-top:10px;"><button class="btn-ghost btn-sm" id="bk-test">Tester la connexion</button><span id="bk-test-msg" class="status"></span></div>
      </div>
    </div>

    <div class="actions" style="margin-top:14px;">
      <button class="btn-primary btn-sm" id="bk-save">Enregistrer les réglages</button>
      <button class="btn-ghost btn-sm" id="bk-run">Sauvegarder maintenant</button>
      <button class="btn-ghost btn-sm" id="bk-dl">Télécharger une archive</button>
      <button class="btn-ghost btn-sm" id="bk-verif">Relire les archives</button>
      <label class="btn-ghost btn-sm" style="cursor:pointer;">Restaurer depuis un fichier<input type="file" id="bk-up" accept=".cmbak" style="display:none;"></label>
      <span id="bk-msg" class="status"></span>
    </div>

    <div class="ouv-lot" style="margin-top:16px;"><div class="ouv-lot-head"><span class="ttl">Archives sur le serveur</span><span class="muted">${(rep.archives || []).length}</span></div>
      ${(rep.archives || []).length ? `<div class="card" style="overflow-x:auto;"><table class="net-table">
        <thead><tr><th>Archive</th><th>Date</th><th>Lignes</th><th>Taille</th><th>Source</th><th></th></tr></thead>
        <tbody>${rep.archives.map((a) => `<tr>
          <td style="font-family:ui-monospace,monospace;font-size:12px;">${esc(a.nom)}</td>
          <td>${dt(a.createdAt || a.mtime)}</td>
          <td>${a.total ?? "—"}</td><td class="muted">${ko(a.octets)}</td>
          <td class="muted">${esc(a.mode || "—")}${a.chiffre === false ? " · <span class=\"cell-warn\">non chiffrée</span>" : ""}</td>
          <td><button class="btn-ghost btn-sm bk-get" data-n="${esc(a.nom)}">Télécharger</button>
              <button class="btn-ghost btn-sm bk-res" data-n="${esc(a.nom)}">Restaurer</button></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted">Aucune archive pour l'instant. « Sauvegarder maintenant » en crée une.</p>`}</div>`;

  const lire = () => ({
    actif: $("#bk-actif").checked, heure: $("#bk-heure").value, retention: $("#bk-ret").value,
    dossier: $("#bk-dossier").value, alerteEmail: $("#bk-mail").value,
    semaines: $("#bk-sem").value, mois: $("#bk-mois").value,
    distant: { actif: $("#bk-dactif").checked, hote: $("#bk-hote").value, port: $("#bk-port").value,
               utilisateur: $("#bk-user").value, chemin: $("#bk-chemin").value, cle: $("#bk-cle").value },
  });
  $("#bk-save").onclick = async () => {
    const r = await api.put("/api/backups/config", lire());
    $("#bk-msg").textContent = r?.error ? r.error : "Réglages enregistrés ✓ planification reprise immédiatement";
  };
  $("#bk-test").onclick = async () => {
    $("#bk-test-msg").textContent = "connexion…";
    const r = await api.post("/api/backups/verifier-distant", { distant: lire().distant });
    $("#bk-test-msg").innerHTML = r?.ok ? `<span style="color:#0B6E5F;">Joignable ✓ ${esc((r.detail || "").split(/\s+/).slice(-2).join(" "))}</span>` : `<span class="cell-warn">${esc(r?.error || "échec")}</span>`;
  };
  $("#bk-run").onclick = async () => {
    $("#bk-msg").textContent = "sauvegarde en cours…";
    const r = await api.post("/api/backups/run", {});
    $("#bk-msg").textContent = r?.ok
      ? `Archive ${r.nom} ✓ ${r.total} lignes${r.distant?.envoye ? ", copiée hors site" : r.distant?.error ? ` — copie externe en échec : ${r.distant.error}` : ""}`
      : `Échec : ${r?.error || "inconnu"}`;
    if (r?.ok) renderBackups();
  };
  $("#bk-dl").onclick = () => { location.href = "/api/backups/telecharger"; };
  $("#bk-verif").onclick = async () => {
    $("#bk-msg").textContent = "relecture…";
    const r = await api.post("/api/backups/verifier-archives", {});
    $("#bk-msg").textContent = r.details?.length
      ? `${r.saines}/${r.verifiees} saines — ${r.details.map((d) => `${d.nom} : ${d.error}`).join(" ; ")}`
      : `${r.saines}/${r.verifiees} archives relues sans erreur ✓`;
  };
  $$(".bk-get").forEach((b) => (b.onclick = () => { location.href = `/api/backups/telecharger?nom=${encodeURIComponent(b.dataset.n)}`; }));

  // Restauration : APERÇU d'abord, toujours. On montre ce qui serait écrasé avant de
  // demander confirmation — restaurer sans savoir ce qu'on perd est le geste qui
  // transforme un incident en catastrophe.
  const apercuPuisRestaurer = async (appel) => {
    const p = await appel(false);
    if (p?.error) { $("#bk-msg").textContent = p.error; return; }
    const lignes = (p.diff || []).map((x) => `  ${x.collection} : ${x.actuel} → ${x.archive} (${x.delta > 0 ? "+" : ""}${x.delta})`).join("\n");
    const ok = confirm(`Restaurer l'archive du ${new Date(p.enveloppe.createdAt).toLocaleString("fr-FR")} ?\n\n`
      + (p.perdus ? `⚠ ${p.perdus} ligne(s) seraient SUPPRIMÉES.\n\n` : "Aucune suppression.\n\n")
      + (lignes ? `Changements :\n${lignes}\n\n` : "Aucun écart d'effectifs.\n\n")
      + `Une archive de l'état actuel est prise juste avant.`);
    if (!ok) return;
    const r = await appel(true);
    if (r?.error) { $("#bk-msg").textContent = r.error; return; }
    alert(`Restauration effectuée ✓\nFilet de sécurité : ${r.filet}\n${r.redemarrageRequis ? "\nRedémarre le service pour recharger l'état en mémoire." : ""}`);
    location.reload();
  };
  $$(".bk-res").forEach((b) => (b.onclick = () => apercuPuisRestaurer((confirmer) =>
    api.post("/api/backups/restaurer", { nom: b.dataset.n, confirmer }))));
  $("#bk-up").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    await apercuPuisRestaurer(async (confirmer) => {
      const fd = new FormData(); fd.append("fichier", f); fd.append("confirmer", String(confirmer));
      const res = await fetch("/api/backups/televerser", { method: "POST", body: fd, headers: { "X-CSRF-Token": csrfToken() } });
      return res.json();
    });
    e.target.value = "";
  };
}

function openModal(title, bodyHtml, toolsHtml = "") {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  const titleId = "modal-title-" + Math.random().toString(36).slice(2, 8);
  // Rôle et libellé : sans eux, un lecteur d'écran ne voit qu'un div de plus.
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="modal-head"><h2 id="${titleId}">${esc(title)}</h2><div style="display:flex;gap:8px;align-items:center;">${toolsHtml}<button class="btn-ghost btn-sm" id="modal-close">Fermer</button></div></div><div class="modal-body">${bodyHtml}</div></div>`;
  const rendreFocus = document.activeElement;
  const fermer = () => {
    bg.remove();
    document.removeEventListener("keydown", onKey);
    if (rendreFocus && document.contains(rendreFocus)) rendreFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); fermer(); return; }
    // Piège de focus : au clavier, on ne doit pas sortir de la modale par accident.
    if (e.key !== "Tab") return;
    const cibles = bg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!cibles.length) return;
    const premier = cibles[0], dernier = cibles[cibles.length - 1];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  };
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.id === "modal-close") fermer(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(bg);
  // Le focus entre dans la modale : premier champ si présent, sinon « Fermer ».
  (bg.querySelector(".modal-body input, .modal-body select, .modal-body textarea") || bg.querySelector("#modal-close"))?.focus();
  return bg;
}

// ---------- Command palette (Cmd/Ctrl+K) + recherche globale ----------
const TYPE_ICON = { campus: "🏫", action: "✅", livrable: "📄", incident: "⚠️", "décision": "⚖️", arbitrage: "📋", contact: "👤" };
function paletteActions() {
  const A = [
    { icon: "➕", label: "Créer une action", run: () => openActionForm(null) },
    { icon: "⚖️", label: "Nouvelle décision CODIR", admin: true, run: () => { setView("decisions"); setTimeout(() => openDecisionForm(null), 60); } },
    { icon: "📋", label: "Nouvel arbitrage CODIR", admin: true, run: () => { setView("arbitrages"); setTimeout(() => openArbitrageForm(null), 60); } },
    { icon: "🧭", label: "Heatmap réseau", admin: true, run: () => setView("heatmap") },
    { icon: "🎯", label: "Priorités du jour", run: () => setView("priorites") },
    { icon: "📊", label: "Rapport board pack (PDF)", admin: true, run: () => window.open("/api/report", "_blank") },
    { icon: "🗓️", label: "Revue hebdo (PDF)", admin: true, run: () => window.open("/api/weekly-review", "_blank") },
    { icon: "💬", label: "Ouvrir l'assistant IA", run: () => setView("assistant") },
  ];
  return A.filter((a) => !a.admin || isAdmin());
}
function runGo(go) {
  if (!go) return;
  setView(go.view);
  if (go.campus360) setTimeout(() => openCampus360(go.campus360), 80);
  else if (go.deliverable) setTimeout(() => openDeliverable(go.deliverable), 80);
}
let palSel = 0, palItems = [], palTimer = null;
function openPalette() {
  if (!state.user || document.getElementById("palette")) return;
  const bg = document.createElement("div");
  bg.id = "palette"; bg.className = "pal-bg";
  bg.innerHTML = `<div class="pal"><input id="pal-input" class="pal-input" placeholder="Rechercher un campus, une action, une décision… ou taper une commande" autocomplete="off"><div id="pal-list" class="pal-list"></div><div class="pal-hint">↑↓ naviguer · ↵ ouvrir · Échap fermer</div></div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) closePalette(); });
  document.body.appendChild(bg);
  const input = $("#pal-input");
  input.focus();
  const render = () => {
    const list = $("#pal-list");
    list.innerHTML = palItems.length ? palItems.map((it, i) => `<div class="pal-item ${i === palSel ? "sel" : ""}" data-i="${i}"><span class="pal-ic">${it.icon}</span><span class="pal-lbl">${esc(it.label)}</span>${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ""}${it.tag ? `<span class="pal-tag">${it.tag}</span>` : ""}</div>`).join("") : `<div class="pal-empty">Aucun résultat</div>`;
    $$(".pal-item").forEach((el) => el.addEventListener("click", () => { palSel = +el.dataset.i; choose(); }));
  };
  const build = async (q) => {
    const acts = paletteActions().filter((a) => a.label.toLowerCase().includes(q.toLowerCase())).map((a) => ({ icon: a.icon, label: a.label, tag: "commande", run: a.run }));
    const navs = NAV.filter((n) => (!n.admin || isAdmin()) && n.label.toLowerCase().includes(q.toLowerCase())).slice(0, 5).map((n) => ({ icon: "→", label: n.label, tag: "aller à", run: () => setView(n.id) }));
    let results = [];
    if (q.length >= 2) { const r = await api.get("/api/search?q=" + encodeURIComponent(q)); results = (r || []).map((x) => ({ icon: TYPE_ICON[x.type] || "•", label: x.label, sub: x.sub, tag: x.type, run: () => runGo(x.go) })); }
    palItems = q ? [...acts, ...navs, ...results] : paletteActions().map((a) => ({ icon: a.icon, label: a.label, tag: "commande", run: a.run }));
    palSel = 0; render();
  };
  const choose = () => { const it = palItems[palSel]; closePalette(); if (it) it.run(); };
  input.addEventListener("input", () => { clearTimeout(palTimer); palTimer = setTimeout(() => build(input.value.trim()), 160); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { closePalette(); }
  });
  build("");
}
function closePalette() { document.getElementById("palette")?.remove(); }
document.getElementById("global-search")?.addEventListener("click", () => { if (state.user) openPalette(); });

boot();

// ======================= Module Enseignement =======================
// Emploi du temps, professeurs, référentiels, salles et classes.

const PLAN_DAYS = [["lun", "Lundi"], ["mar", "Mardi"], ["mer", "Mercredi"], ["jeu", "Jeudi"], ["ven", "Vendredi"], ["sam", "Samedi"]];
const SES_KIND = { cours: "Cours", examen: "Examen", rattrapage: "Rattrapage", reunion: "Réunion" };
const SES_MODALITE = { presentiel: "Présentiel", distanciel: "À distance", hybride: "Hybride" };
const SES_STATUT = { planned: "Prévue", done: "Faite", cancelled: "Annulée" };
const TEACH_STATUS = { permanent: "Permanent", vacataire: "Vacataire", intervenant: "Intervenant" };
const PERIOD_KIND = { vacances: "Vacances", ferie: "Férié", examens: "Examens", stage: "Stage", entreprise: "En entreprise" };

// Lundi de la semaine contenant `d`.
function mondayOf(d) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hhmmToMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : 0; };

let planState = { week: mondayOf(new Date().toISOString().slice(0, 10)), campusId: "", classId: "", teacherId: "" };

// ---------- Emploi du temps : grille semaine éditable ----------
// Génération d'un lien de portail. Le lien n'est affiché QU'UNE FOIS : il n'est
// stocké nulle part en clair, seule son empreinte l'est côté serveur.
async function openPortalLink(kind, subjectId, campusId, label) {
  const existing = await api.get(`/api/portal/access?campusId=${campusId}&kind=${kind}`) || [];
  const actifs = existing.filter((a) => a.subjectId === subjectId && !a.revokedAt);
  const kindLabel = { learner: "apprenant", teacher: "formateur", tutor: "tuteur entreprise" }[kind] || kind;
  openModal(`Accès portail — ${label}`, `
    <p class="sub muted" style="margin-top:0;">Un lien personnel donne accès à l'espace ${kindLabel}, sans mot de passe. Il est <b>révocable à tout moment</b> et n'ouvre que sur ce dossier.</p>
    ${actifs.length ? `<div class="card card-pad" style="margin-bottom:10px;"><b>Un lien est déjà actif</b>
      <div class="sub muted">Créé le ${new Date(actifs[0].createdAt).toLocaleDateString("fr-FR")}${actifs[0].lastUsedAt ? ` · dernière visite le ${new Date(actifs[0].lastUsedAt).toLocaleDateString("fr-FR")} (${actifs[0].useCount} visite(s))` : " · jamais utilisé"}${actifs[0].expiresAt ? ` · expire le ${new Date(actifs[0].expiresAt).toLocaleDateString("fr-FR")}` : ""}</div>
      <div class="sub muted" style="margin-top:6px;">Le lien lui-même n'est pas conservé : en générer un nouveau remplace l'ancien, qui cesse aussitôt de fonctionner.</div>
      <div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm btn-danger" id="pl-revoke">Révoquer l'accès</button></div></div>` : ""}
    <div class="actions"><button class="btn-primary" id="pl-gen">${actifs.length ? "Générer un nouveau lien" : "Générer le lien"}</button></div>
    <div id="pl-out" style="margin-top:12px;"></div>`);
  $("#pl-revoke")?.addEventListener("click", async () => {
    if (!confirm("Révoquer cet accès ? Le lien cessera immédiatement de fonctionner.")) return;
    await api.del(`/api/portal/access/${actifs[0].id}`);
    document.querySelector(".modal-bg")?.remove();
    openPortalLink(kind, subjectId, campusId, label);
  });
  $("#pl-gen").onclick = async () => {
    let r = await api.post("/api/portal/access", { kind, subjectId, campusId, label });
    if (r.code === "consentement_mineur_manquant") {
      // On n'impose rien à l'établissement (c'est lui le responsable de traitement),
      // mais on refuse de le faire en silence.
      if (!confirm(`${r.error}\n\nOuvrir quand même l'accès ? La décision sera tracée dans le journal d'audit.`)) {
        $("#pl-out").innerHTML = `<p class="sub muted">Accès non créé. Enregistre l'autorisation via « 🛡 Autorisations » sur la fiche.</p>`;
        return;
      }
      r = await api.post("/api/portal/access", { kind, subjectId, campusId, label, forcerMineur: true });
    }
    if (r.error) { $("#pl-out").innerHTML = `<p class="sub" style="color:var(--bad);">${esc(r.error)}</p>`; return; }
    $("#pl-out").innerHTML = `<div class="card card-pad" style="border-left:4px solid var(--coral);">
      <b>⚠ ${esc(r.warning)}</b>
      <input class="txt" id="pl-url" readonly value="${esc(r.url)}" style="margin-top:8px;font-family:ui-monospace,monospace;font-size:12px;">
      <div class="actions" style="margin-top:8px;"><button class="btn-primary btn-sm" id="pl-copy">Copier le lien</button></div></div>`;
    $("#pl-url").select();
    $("#pl-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.url); $("#pl-copy").textContent = "✓ Copié"; }
      catch { $("#pl-url").select(); document.execCommand("copy"); $("#pl-copy").textContent = "✓ Copié"; }
    };
  };
}

// Autorisations du représentant légal. Enregistrer des coordonnées ne prouve
// aucun consentement : il faut savoir qui a autorisé quoi, et quand.
const CONSENT_LABELS = {
  droit_image: "Droit à l'image",
  sorties: "Sorties et déplacements",
  communication_notes: "Communication des résultats au représentant légal",
  acces_portail: "Ouverture d'un accès à l'espace en ligne",
  soins_urgence: "Autorisation de soins en cas d'urgence",
};
function openConsentForm(l, onDone) {
  const actuels = new Map((l.consentements || []).map((c) => [c.scope, c]));
  const ligne = ([scope, label]) => {
    const c = actuels.get(scope);
    return `<div class="item">
      <div class="grow"><div class="ttl">${label}</div>
        <div class="sub muted">${c ? `${c.accorde ? "Accordée" : "Refusée"} le ${esc(c.le)} par ${esc(c.par)}` : "Jamais renseignée"}</div></div>
      <button class="btn-${c?.accorde ? "ghost" : "primary"} btn-sm cs-set" data-scope="${scope}" data-ok="1">Accorder</button>
      <button class="btn-ghost btn-sm cs-set" data-scope="${scope}" data-ok="0">Refuser</button>
    </div>`;
  };
  openModal(`Autorisations — ${l.prenom} ${l.nom}`, `
    <p class="sub muted" style="margin-top:0;">À recueillir auprès du représentant légal pour un apprenant mineur. Chaque autorisation est horodatée et nominative.</p>
    <div class="field"><label class="field-label">Signataire *</label><input class="txt" id="cs-par" value="${esc(l.repLegalNom || "")}" placeholder="Nom du représentant légal"></div>
    <div class="list">${Object.entries(CONSENT_LABELS).map(ligne).join("")}</div>
    <div id="cs-msg" class="sub" style="margin-top:8px;"></div>`);
  $$(".cs-set").forEach((b) => b.addEventListener("click", () => guard(b, async () => {
    const par = $("#cs-par").value.trim();
    if (!par) { $("#cs-msg").textContent = "Renseigne le nom du signataire : une autorisation anonyme n'en est pas une."; $("#cs-msg").style.color = "var(--bad)"; return; }
    const r = await api.put(`/api/learners/${l.id}/consent`, { scope: b.dataset.scope, accorde: b.dataset.ok === "1", par });
    if (r.error) { $("#cs-msg").textContent = r.error; $("#cs-msg").style.color = "var(--bad)"; return; }
    document.querySelector(".modal-bg")?.remove();
    await onDone();
  })));
}

// Certificat de réalisation — le justificatif que le financeur attend pour
// libérer les fonds. La durée réalisée n'est jamais saisie à la main : elle est
// calculée sur les feuilles d'émargement closes, seule base défendable.
async function openCertificat(l) {
  const d = new Date(); const an = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  const defFrom = `${an}-09-01`, defTo = d.toISOString().slice(0, 10);
  const charger = async (from, to, issue) => api.get(`/api/learners/${l.id}/certificat-realisation?from=${from}&to=${to}${issue ? "&issue=" + issue : ""}`);
  let info = await charger(defFrom, defTo);
  if (info?.error) { alert(info.error); return; }
  const h = (m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  openModal(`Certificat de réalisation — ${l.prenom} ${l.nom}`, `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Du</label><input class="txt" id="cr-from" type="date" value="${defFrom}"></div>
      <div class="field"><label class="field-label">Au</label><input class="txt" id="cr-to" type="date" value="${defTo}"></div>
    </div>
    <div class="kpis" id="cr-kpis"></div>
    <div class="field"><label class="field-label">Issue de l'action</label>
      <select class="txt" id="cr-issue">${Object.entries(info.issues).map(([k, v]) => `<option value="${k}">${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join("")}</select>
      <div class="sub muted">Proposée d'après l'assiduité constatée. C'est l'organisme qui signe et qui tranche.</div></div>
    <div id="cr-alerte"></div>
    <div class="actions"><button class="btn-primary" id="cr-print">Éditer le certificat</button></div>
    <p class="hint muted">Document destiné au <b>financeur</b> pour justifier la réalisation de l'action — distinct de l'attestation remise au stagiaire. La durée est calculée sur les feuilles d'émargement closes, jamais saisie à la main.</p>`);
  const rendre = () => {
    $("#cr-kpis").innerHTML = `
      <div class="k"><div class="v">${h(info.heuresRealisees)}</div><div class="l">réalisées</div></div>
      <div class="k"><div class="v">${h(info.heuresPrevues)}</div><div class="l">prévues</div></div>
      <div class="k${info.feuilles ? "" : " k-bad"}"><div class="v">${info.feuilles}</div><div class="l">séances closes</div></div>`;
    $("#cr-issue").value = info.issueProposee;
    $("#cr-alerte").innerHTML = info.manquantes?.length
      ? `<div class="card card-pad" style="border-left:4px solid var(--bad);"><b>Non conforme en l'état</b><ul style="margin:6px 0 0;padding-left:18px;font-size:13px;">${info.manquantes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
      : `<div class="card card-pad" style="border-left:4px solid var(--good);"><b>✓ Mentions obligatoires réunies</b></div>`;
  };
  rendre();
  const recharger = async () => { info = await charger($("#cr-from").value, $("#cr-to").value); if (!info.error) rendre(); };
  $("#cr-from").addEventListener("change", recharger);
  $("#cr-to").addEventListener("change", recharger);
  $("#cr-print").onclick = () => window.open(`/api/learners/${l.id}/certificat-realisation?format=html&from=${$("#cr-from").value}&to=${$("#cr-to").value}&issue=${$("#cr-issue").value}`, "_blank");
}

// Acquis, dispenses, équivalences et allègements par bloc.
// L'écran doit rendre IMPOSSIBLE la confusion que le domaine fait tout le temps :
// un allègement dispense de suivre la formation, une dispense d'épreuve vaut
// acquisition. Les deux cases sont donc affichées séparément, avec leur effet
// écrit en clair sous le sélecteur.
async function openAcquis(l) {
  const [motifs, decisions, rapport] = await Promise.all([
    api.get("/api/acquis/motifs"),
    api.get(`/api/learners/${l.id}/acquis`),
    api.get(`/api/learners/${l.id}/report`),
  ]);
  if (rapport?.error) { alert(rapport.error); return; }
  const blocs = rapport?.blocs || [];
  if (!blocs.length) { alert("Aucun bloc de compétences au référentiel de cette classe."); return; }
  const parBloc = new Map((decisions || []).map((d) => [d.blocId, d]));

  const ligne = (b) => {
    const d = parBloc.get(b.blocId);
    const statut = b.status === "acquis_dispense" ? `<span class="pill done">Acquis par dispense</span>`
      : b.status === "acquis" ? `<span class="pill done">Acquis</span>`
      : b.status === "non_acquis" ? `<span class="pill overdue">Non acquis</span>` : `<span class="pill">En cours</span>`;
    return `<div class="item" data-bloc="${esc(b.blocId)}" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div style="display:flex;gap:10px;align-items:center;">
        <div class="grow"><div class="ttl">${esc(b.code ? b.code + " — " : "")}${esc(b.label)}</div>
          <div class="sub muted">${b.evaluees}/${b.total} matière(s) évaluée(s)${b.moyenne != null ? " · moyenne " + String(b.moyenne).replace(".", ",") : ""}</div></div>
        ${statut}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:220px;"><label class="field-label">Décision</label>
          <select class="txt ac-motif"><option value="">— aucune —</option>
            ${Object.entries(motifs).map(([k, m]) => `<option value="${k}" ${d?.motif === k ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></div>
        <div style="min-width:150px;"><label class="field-label">Date de décision</label><input class="txt ac-date" type="date" value="${esc(d?.dateDecision || "")}"></div>
      </div>
      <div class="ac-detail" ${d?.motif ? "" : "hidden"}>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 6px;">
          <label class="sub"><input type="checkbox" class="ac-ep" ${d?.dispenseEpreuve ? "checked" : ""}> Dispensé de l'<b>épreuve</b> (vaut acquisition)</label>
          <label class="sub"><input type="checkbox" class="ac-fo" ${d?.dispenseFormation ? "checked" : ""}> Dispensé de <b>suivre la formation</b> (n'acquiert rien)</label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input class="txt ac-just grow" placeholder="Pièce justificative (relevé de notes, notification de jury…)" value="${esc(d?.justificatif || "")}" style="min-width:240px;">
          <input class="txt ac-par" placeholder="Décidé par" value="${esc(d?.decidePar || "")}" style="max-width:190px;">
        </div>
        <div class="sub muted ac-aide" style="margin-top:5px;"></div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary btn-sm ac-save">Enregistrer</button>
        ${d ? '<button class="btn-ghost btn-sm btn-danger ac-del">Retirer la décision</button>' : ""}
        <span class="sub ac-msg" style="align-self:center;"></span>
      </div>
    </div>`;
  };

  openModal(`Acquis & dispenses — ${l.prenom} ${l.nom}`, `
    <p class="muted" style="margin-top:0;">Un <b>allègement de parcours</b> dispense de <i>suivre</i> la formation : l'apprenant passe quand même l'épreuve, rien n'est validé.
    Une <b>dispense d'épreuve</b>, une <b>équivalence</b> ou un <b>bloc déjà acquis</b> valent acquisition : le bloc est validé sans être évalué ici.</p>
    <div class="list">${blocs.map(ligne).join("")}</div>
    <p class="hint muted">Depuis la loi du 5 septembre 2018, les blocs de compétences sont acquis définitivement : un bloc validé lors d'une session antérieure n'est pas à repasser.
    Sans pièce justificative, la décision reste enregistrée mais <b>le titre ne pourra pas être délivré</b>.</p>`);

  $$(".item[data-bloc]").forEach((row) => {
    const motif = $(".ac-motif", row), detail = $(".ac-detail", row), aide = $(".ac-aide", row);
    const ep = $(".ac-ep", row), fo = $(".ac-fo", row), msg = $(".ac-msg", row);
    const rafraichir = ({ appliquerDefauts }) => {
      const m = motifs[motif.value];
      detail.hidden = !m;
      if (!m) return;
      // Le motif propose des valeurs par défaut ; l'utilisateur peut les changer.
      if (appliquerDefauts) { ep.checked = m.dispenseEpreuve; fo.checked = m.dispenseFormation; }
      aide.textContent = m.aide;
    };
    rafraichir({ appliquerDefauts: false });
    motif.addEventListener("change", () => rafraichir({ appliquerDefauts: true }));

    $(".ac-save", row).addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
      msg.textContent = ""; msg.style.color = "";
      if (!motif.value) { msg.textContent = "Choisir une décision."; msg.style.color = "var(--bad)"; return; }
      const r = await api.put(`/api/learners/${l.id}/acquis/${row.dataset.bloc}`, {
        motif: motif.value, dispenseEpreuve: ep.checked, dispenseFormation: fo.checked,
        justificatif: $(".ac-just", row).value.trim(), dateDecision: $(".ac-date", row).value,
        decidePar: $(".ac-par", row).value.trim(),
      });
      if (r?.error) { msg.textContent = r.error; msg.style.color = "var(--bad)"; return; }
      // Le refetch est attendu AVANT de rendre la main : sans cela le bouton
      // redevient cliquable pendant le rechargement et la décision part deux fois.
      document.querySelector(".modal-bg")?.remove();
      await openAcquis(l);
    }));

    $(".ac-del", row)?.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
      if (!confirm("Retirer cette décision ? Le bloc redeviendra à évaluer.")) return;
      await api.del(`/api/learners/${l.id}/acquis/${row.dataset.bloc}`);
      document.querySelector(".modal-bg")?.remove();
      await openAcquis(l);
    }));
  });
}

// ---------- Suivi du parcours (positionnement, aménagements, rencontres) ----------
async function openSuiviParcours(l) {
  const [ref, d] = await Promise.all([api.get("/api/suivi/referentiels"), api.get(`/api/learners/${l.id}/suivi`)]);
  if (d?.error) { alert(d.error); return; }
  const p = d.positionnement || {};
  const alerte = d.etat?.alerte;

  openModal(`Suivi du parcours — ${l.prenom} ${l.nom}`, `
    ${alerte ? `<div class="card card-pad" style="border-left:4px solid var(--bad);margin-bottom:12px;"><b>${esc(alerte)}</b></div>` : ""}
    <div class="section-title" style="margin-top:0;">Positionnement à l'entrée</div>
    <p class="sub muted" style="margin-top:0;">Il fonde l'individualisation du parcours : il est censé <b>précéder</b> l'entrée en formation${d.debutFormation ? ` (débutée le ${esc(d.debutFormation)})` : ""}.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div><label class="field-label">Date</label><input class="txt" id="po-date" type="date" value="${esc(p.date || "")}"></div>
      <div style="flex:1;min-width:170px;"><label class="field-label">Modalité</label><select class="txt" id="po-mod">${Object.entries(ref.positionnementModalites).map(([k, v]) => `<option value="${k}" ${p.modalite === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div style="flex:1;min-width:210px;"><label class="field-label">Prérequis</label><select class="txt" id="po-pre">${Object.entries(ref.prerequisVerdicts).map(([k, v]) => `<option value="${k}" ${p.prerequis === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <input class="txt grow" id="po-obj" placeholder="Objectifs individualisés" value="${esc(p.objectifs || "")}" style="min-width:240px;">
      <input class="txt" id="po-amg" placeholder="Aménagement proposé" value="${esc(p.amenagementPropose || "")}" style="min-width:200px;">
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
      <button class="btn-primary btn-sm" id="po-save">Enregistrer le positionnement</button>
      <span class="sub" id="po-msg"></span>
    </div>

    <div class="section-title">Aménagements</div>
    <p class="sub muted" style="margin-top:0;">Un aménagement <b>d'épreuve</b> est accordé par le certificateur : l'organisme le demande, il ne l'accorde pas.
    N'enregistrer que l'aménagement à mettre en place — <b>aucune donnée de santé</b>.</p>
    <div class="list">${(d.amenagements || []).map((a) => `<div class="item"><span class="pill">${esc(ref.amenagementStatuts[a.statut] || "—")}</span>
      <div class="grow"><div class="ttl" style="font-weight:500;">${esc(ref.amenagementTypes[a.type]?.label || a.type)}</div>
      <div class="sub muted">${esc(a.description || "")}${a.referenceDecision ? ` · réf. ${esc(a.referenceDecision)}` : ""}</div></div>
      <button class="btn-ghost btn-sm btn-danger am-del" data-id="${a.id}">✕</button></div>`).join("") || '<p class="muted" style="padding:8px;">Aucun aménagement.</p>'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end;">
      <div style="min-width:190px;"><label class="field-label">Type</label><select class="txt" id="am-type">${Object.entries(ref.amenagementTypes).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>
      <div style="min-width:150px;"><label class="field-label">Statut</label><select class="txt" id="am-statut">${Object.entries(ref.amenagementStatuts).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <input class="txt grow" id="am-desc" placeholder="Description de l'aménagement" style="min-width:220px;">
      <input class="txt" id="am-ref" placeholder="Réf. décision certificateur" style="max-width:200px;">
      <button class="btn-ghost btn-sm" id="am-add">Ajouter</button>
      <span class="sub" id="am-msg"></span>
    </div>

    <div class="section-title">Rencontres en entreprise</div>
    <p class="sub muted" style="margin-top:0;">Seules la <b>visite</b> et l'<b>entretien tripartite</b> valent liaison avec l'entreprise ; un appel documente l'accompagnement.
    ${d.etat?.dernier ? `Dernière rencontre le ${esc(d.etat.dernier.date)} (il y a ${d.etat.joursDepuis} jours).` : "Aucune rencontre enregistrée."}</p>
    <div class="list">${(d.suivis || []).map((s) => `<div class="item"><span class="pill">${esc(ref.suiviTypes[s.type] || s.type)}</span>
      <div class="grow"><div class="ttl" style="font-weight:500;">${esc(s.date || "")}${s.tuteur ? " · tuteur " + esc(s.tuteur) : ""}</div>
      <div class="sub muted">${esc(s.compteRendu || "")}${s.difficultes ? ` · difficultés : ${esc(s.difficultes)}` : ""}${s.actions ? ` · action : ${esc(s.actions)}` : ""}</div></div>
      <button class="btn-ghost btn-sm btn-danger su-del" data-id="${s.id}">✕</button></div>`).join("") || '<p class="muted" style="padding:8px;">Aucune rencontre.</p>'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end;">
      <div><label class="field-label">Date</label><input class="txt" id="su-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div style="min-width:170px;"><label class="field-label">Type</label><select class="txt" id="su-type">${Object.entries(ref.suiviTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <input class="txt" id="su-tuteur" placeholder="Maître d'apprentissage" style="max-width:190px;">
      <input class="txt grow" id="su-cr" placeholder="Compte rendu" style="min-width:200px;">
      <input class="txt" id="su-dif" placeholder="Difficultés" style="max-width:170px;">
      <input class="txt" id="su-act" placeholder="Action décidée" style="max-width:170px;">
      <button class="btn-ghost btn-sm" id="su-add">Ajouter</button>
      <span class="sub" id="su-msg"></span>
    </div>`);

  const recharger = async () => { document.querySelector(".modal-bg")?.remove(); await openSuiviParcours(l); };
  const afficher = (cible, r) => {
    const m = $(cible);
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return false; }
    if (r?.warnings?.length) { m.textContent = r.warnings.join(" · "); m.style.color = "var(--warn, #C77700)"; }
    return true;
  };

  $("#po-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.put(`/api/learners/${l.id}/positionnement`, {
      date: $("#po-date").value, modalite: $("#po-mod").value, prerequis: $("#po-pre").value,
      objectifs: $("#po-obj").value.trim(), amenagementPropose: $("#po-amg").value.trim(),
    });
    if (!afficher("#po-msg", r)) return;
    if (!r.warnings?.length) await recharger();
  });
  $("#am-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post(`/api/learners/${l.id}/amenagements`, {
      type: $("#am-type").value, statut: $("#am-statut").value,
      description: $("#am-desc").value.trim(), referenceDecision: $("#am-ref").value.trim(),
    });
    if (!afficher("#am-msg", r)) return;
    await recharger();
  });
  $("#su-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post(`/api/learners/${l.id}/suivis`, {
      date: $("#su-date").value, type: $("#su-type").value, tuteur: $("#su-tuteur").value.trim(),
      compteRendu: $("#su-cr").value.trim(), difficultes: $("#su-dif").value.trim(), actions: $("#su-act").value.trim(),
    });
    if (!afficher("#su-msg", r)) return;
    await recharger();
  });
  $$(".am-del").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    await api.del(`/api/amenagements/${b.dataset.id}`); await recharger();
  })));
  $$(".su-del").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    await api.del(`/api/suivis/${b.dataset.id}`); await recharger();
  })));
}

// ---------- Vue : Réclamations & sous-traitance ----------
let qualCampus = "";
async function renderQualite() {
  if (!qualCampus) qualCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="qu-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${qualCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [ref, reg, st] = await Promise.all([
    api.get("/api/qualite/referentiels"),
    api.get(`/api/reclamations?campusId=${qualCampus}`),
    api.get(`/api/sous-traitants?campusId=${qualCampus}`),
  ]);

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Ce n'est pas le contenu de ces registres qui est contrôlé, c'est leur <b>tenue</b>.
      Un registre vide chez un organisme qui forme des centaines d'apprenants ne prouve pas qu'il n'y a eu aucune réclamation.</p>
    </div>

    <div class="section-title">Réclamations et appels</div>
    <div class="kpis">
      <div class="k"><div class="v">${reg.total}</div><div class="l">enregistrées</div></div>
      <div class="k"><div class="v">${reg.ouvertes}</div><div class="l">ouvertes</div></div>
      <div class="k${reg.horsDelai ? " k-bad" : ""}"><div class="v">${reg.horsDelai}</div><div class="l">hors délai (${ref.delaiReponseJours} j)</div></div>
      <div class="k"><div class="v">${reg.delaiMoyen != null ? reg.delaiMoyen + " j" : "—"}</div><div class="l">délai moyen</div></div>
      <div class="k${reg.sansActionCorrective ? " k-bad" : ""}"><div class="v">${reg.sansActionCorrective}</div><div class="l">closes sans action</div></div>
    </div>
    <div class="card"><div class="list">${(reg.items || []).map((r) => `<div class="item">
      <span class="pill ${r.etat.horsDelai ? "overdue" : r.etat.close ? "done" : "doing"}">${esc(ref.statuts[r.statut] || "Reçue")}</span>
      <div class="grow"><div class="ttl">${esc(r.objet)} ${r.kind === "appel" ? '<span class="pill">appel</span>' : ""}</div>
        <div class="sub muted">${esc(r.date)} · ${esc(ref.origines[r.origine] || "")} · ${esc(ref.natures[r.nature] || "")}${r.etat.alerte ? ` · <b>${esc(r.etat.alerte)}</b>` : ""}</div></div>
      <button class="btn-ghost btn-sm rc-open" data-id="${r.id}">Traiter</button></div>`).join("") || '<p class="muted" style="padding:10px;">Aucune réclamation enregistrée.</p>'}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:flex-end;">
      <div><label class="field-label">Date</label><input class="txt" id="rc-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div style="min-width:150px;"><label class="field-label">Type</label><select class="txt" id="rc-kind">${Object.entries(ref.kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <div style="min-width:170px;"><label class="field-label">Origine</label><select class="txt" id="rc-origine">${Object.entries(ref.origines).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <div style="min-width:170px;"><label class="field-label">Nature</label><select class="txt" id="rc-nature">${Object.entries(ref.natures).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <input class="txt grow" id="rc-objet" placeholder="Objet de la réclamation" style="min-width:230px;">
      <button class="btn-primary btn-sm" id="rc-add">Enregistrer</button>
      <span class="sub" id="rc-msg"></span>
    </div>

    <div class="section-title">Sous-traitance</div>
    <p class="muted" style="margin-top:0;">Le donneur d'ordre reste responsable de la prestation. Un sous-traitant non certifié sur des actions financées peut faire tomber la prise en charge — et c'est vous qui remboursez.</p>
    ${st.registre.aRisque.length ? `<div class="card card-pad" style="border-left:4px solid var(--bad);"><b>À régulariser :</b> ${st.registre.aRisque.map(esc).join(", ")} — actions financées sans certification attestée.</div>` : ""}
    <div class="card" style="margin-top:10px;"><div class="list">${(st.items || []).map((s) => `<div class="item">
      <span class="pill ${s.certifie ? "done" : ""}">${s.certifie ? "certifié" : "non certifié"}</span>
      <div class="grow"><div class="ttl">${esc(s.nom)}</div>
        <div class="sub muted">${esc(s.prestation || "")}${s.dateFin ? ` · jusqu'au ${esc(s.dateFin)}` : ""}${s.actionsFinancees ? " · actions financées" : ""}</div></div>
      ${isAdmin() ? `<button class="btn-ghost btn-sm btn-danger st-del" data-id="${s.id}">✕</button>` : ""}</div>`).join("") || '<p class="muted" style="padding:10px;">Aucun sous-traitant enregistré.</p>'}</div></div>
    ${isAdmin() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:flex-end;">
      <input class="txt" id="st-nom" placeholder="Raison sociale" style="min-width:190px;">
      <div style="min-width:180px;"><label class="field-label">Périmètre</label><select class="txt" id="st-per">${Object.entries(ref.perimetres).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <input class="txt grow" id="st-prest" placeholder="Prestation confiée" style="min-width:200px;">
      <label class="sub"><input type="checkbox" id="st-fin"> actions financées</label>
      <label class="sub"><input type="checkbox" id="st-cert"> certifié qualité</label>
      <button class="btn-ghost btn-sm" id="st-add">Ajouter</button>
      <span class="sub" id="st-msg"></span>
    </div>` : ""}`;

  $("#qu-campus")?.addEventListener("change", () => { qualCampus = $("#qu-campus").value; renderQualite(); });
  const msg = (sel, r) => { const m = $(sel); if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return false; }
    if (r?.warnings?.length) { m.textContent = r.warnings.join(" · "); m.style.color = "var(--warn, #C77700)"; } return true; };

  $("#rc-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post("/api/reclamations", { campusId: qualCampus, date: $("#rc-date").value, kind: $("#rc-kind").value,
      origine: $("#rc-origine").value, nature: $("#rc-nature").value, objet: $("#rc-objet").value.trim() });
    if (!msg("#rc-msg", r)) return;
    await renderQualite();
  });
  $$(".rc-open").forEach((b) => b.addEventListener("click", () => openReclamation(b.dataset.id, ref)));
  $("#st-add")?.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post("/api/sous-traitants", { campusId: qualCampus, nom: $("#st-nom").value.trim(),
      perimetre: $("#st-per").value, prestation: $("#st-prest").value.trim(),
      actionsFinancees: $("#st-fin").checked, certifie: $("#st-cert").checked });
    if (!msg("#st-msg", r)) return;
    await renderQualite();
  }));
  $$(".st-del").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    if (!confirm("Retirer ce sous-traitant du registre ?")) return;
    await api.del(`/api/sous-traitants/${b.dataset.id}`); await renderQualite();
  })));
}

async function openReclamation(rid, ref) {
  const reg = await api.get(`/api/reclamations?campusId=${qualCampus}`);
  const r = (reg.items || []).find((x) => x.id === rid);
  if (!r) return;
  openModal(`Réclamation — ${r.objet}`, `
    <div class="sub muted" style="margin-bottom:10px;">${esc(r.date)} · ${esc(ref.origines[r.origine] || "")} · ${esc(ref.natures[r.nature] || "")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div style="min-width:190px;"><label class="field-label">Statut</label><select class="txt" id="rd-statut">${Object.entries(ref.statuts).map(([k, v]) => `<option value="${k}" ${r.statut === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div><label class="field-label">Date de réponse</label><input class="txt" id="rd-date" type="date" value="${esc(r.dateReponse || "")}"></div>
    </div>
    <div class="field" style="margin-top:8px;"><label class="field-label">Réponse apportée</label><textarea class="txt" id="rd-rep" rows="3">${esc(r.reponse || "")}</textarea></div>
    <div class="field"><label class="field-label">Action corrective</label><input class="txt" id="rd-act" value="${esc(r.actionCorrective || "")}" placeholder="Ce que l'organisme change à la suite de cette réclamation"></div>
    <p class="hint muted">Une réclamation close sans action corrective est <b>traitée, pas exploitée</b> — c'est le point que relève un auditeur.</p>
    <div class="actions"><button class="btn-primary" id="rd-save">Enregistrer</button><span class="sub" id="rd-msg" style="align-self:center;"></span></div>`);
  $("#rd-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const res = await api.patch(`/api/reclamations/${rid}`, { statut: $("#rd-statut").value, dateReponse: $("#rd-date").value,
      reponse: $("#rd-rep").value.trim(), actionCorrective: $("#rd-act").value.trim() });
    const m = $("#rd-msg");
    if (res?.error) { m.textContent = res.error; m.style.color = "var(--bad)"; return; }
    document.querySelector(".modal-bg")?.remove();
    await renderQualite();
  });
}

// ---------- Vue : Risque de décrochage ----------
let decCampusRisque = "";
async function renderDecrochage() {
  if (!decCampusRisque) decCampusRisque = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="dr-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${decCampusRisque === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const d = await api.get(`/api/risque/decrochage?campusId=${decCampusRisque}`);
  if (d?.error) { view.innerHTML = `<p class="muted">${esc(d.error)}</p>`; return; }
  const teinte = { critique: "overdue", eleve: "overdue", moyen: "warn", faible: "" };

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Un apprenant qui décroche coche presque toujours plusieurs cases à la fois.
      C'est le <b>croisement</b> qui alerte utilement — et le score ne sert qu'à trier : ce sont les motifs qui se traitent.</p>
    </div>
    <div class="kpis">
      <div class="k"><div class="v">${d.total}</div><div class="l">apprenants suivis</div></div>
      <div class="k${d.aTraiter ? " k-bad" : ""}"><div class="v">${d.aTraiter}</div><div class="l">à traiter</div></div>
    </div>
    <div class="card"><div class="list">${(d.items || []).map((x) => `<div class="item">
      <span class="pill ${teinte[x.risque.niveau]}">${esc(x.risque.niveauLabel)}</span>
      <div class="grow"><div class="ttl">${esc(x.nom)}</div><div class="sub muted">${esc(x.risque.resume)}</div></div>
      <button class="btn-ghost btn-sm dr-fiche" data-id="${x.learnerId}">Ouvrir la fiche</button></div>`).join("") || '<p class="muted" style="padding:10px;">Aucun apprenant inscrit sur ce campus.</p>'}</div></div>`;
  $("#dr-campus")?.addEventListener("change", () => { decCampusRisque = $("#dr-campus").value; renderDecrochage(); });
  $$(".dr-fiche").forEach((b) => b.addEventListener("click", () => openLearnerFiche(b.dataset.id)));
}

// ---------- Vue : Sessions d'examen & jury ----------
let juryCampus = "";
async function renderJury() {
  if (!juryCampus) juryCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="jy-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${juryCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [ref, sessions] = await Promise.all([api.get("/api/jury/referentiels"), api.get(`/api/jury/sessions?campusId=${juryCampus}`)]);

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Les notes disent ce que l'apprenant a <b>obtenu</b> ; le jury dit ce qu'il <b>obtient</b>.
      Le jury est souverain — mais tout écart avec le calcul doit être motivé au procès-verbal.</p>
    </div>
    <div class="card"><div class="list">${(sessions || []).map((s) => `<div class="item">
      <span class="pill ${s.convocation.insuffisant || !s.convocation.convoquee ? "overdue" : "done"}">${esc(ref.statuts[s.statut] || "Planifiée")}</span>
      <div class="grow"><div class="ttl">${esc(s.intitule)}</div>
        <div class="sub muted">${esc(s.date)}${s.lieu ? " · " + esc(s.lieu) : ""}${s.convocation.alerte ? ` · <b>${esc(s.convocation.alerte)}</b>` : ` · convoquée ${s.convocation.prevenanceJours} j avant`}</div></div>
      ${isAdmin() ? `<button class="btn-ghost btn-sm btn-danger jy-del" data-id="${s.id}">✕</button>` : ""}</div>`).join("") || '<p class="muted" style="padding:10px;">Aucune session planifiée.</p>'}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:flex-end;">
      <div><label class="field-label">Date de l'épreuve</label><input class="txt" id="jy-date" type="date"></div>
      <div><label class="field-label">Convocation envoyée le</label><input class="txt" id="jy-conv" type="date"></div>
      <input class="txt grow" id="jy-int" placeholder="Intitulé de la session" style="min-width:200px;">
      <input class="txt" id="jy-lieu" placeholder="Lieu" style="max-width:170px;">
      <button class="btn-primary btn-sm" id="jy-add">Planifier</button>
      <span class="sub" id="jy-msg"></span>
    </div>
    <p class="sub muted" style="margin-top:10px;">Délai de prévenance annoncé : <b>${ref.delaiConvocationJours} jours</b>. Une convocation plus tardive est un motif de contestation, et c'est l'organisme qui perd.</p>`;

  $("#jy-campus")?.addEventListener("change", () => { juryCampus = $("#jy-campus").value; renderJury(); });
  $("#jy-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post("/api/jury/sessions", { campusId: juryCampus, date: $("#jy-date").value,
      dateConvocation: $("#jy-conv").value || null, intitule: $("#jy-int").value.trim(), lieu: $("#jy-lieu").value.trim() });
    const m = $("#jy-msg");
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
    await renderJury();
  });
  $$(".jy-del").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    if (!confirm("Supprimer cette session ?")) return;
    await api.del(`/api/jury/sessions/${b.dataset.id}`); await renderJury();
  })));
}

// ---------- Vue : Contrats d'alternance ----------
const CT_STATUS = { brouillon: ["Brouillon", ""], a_deposer: ["À déposer", "warn"], depose: ["Déposé", "doing"], valide: ["Validé", "done"], rompu: ["Rompu", "overdue"], termine: ["Terminé", ""] };
const RUPT_STAGE = { signalee: "Signalée", mediation: "Médiation", replacement: "Recherche entreprise", resolue: "Résolue (maintien)", confirmee: "Rupture confirmée" };
let ctFilter = { campusId: "", status: "", enRupture: false };
async function renderContrats() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="ct-add">${I.plus}<span>Contrat</span></button>`;
  $("#ct-add").addEventListener("click", () => openContractForm(null));
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const qs = new URLSearchParams();
  if (ctFilter.campusId) qs.set("campusId", ctFilter.campusId);
  if (ctFilter.status) qs.set("status", ctFilter.status);
  if (ctFilter.enRupture) qs.set("enRupture", "1");
  const rows = await api.get("/api/contracts?" + qs.toString()) || [];
  const ruptures = rows.filter((c) => c.rupture && !["resolue", "confirmee"].includes(c.rupture.stage));
  const bloques = rows.filter((c) => !c.validation.ok && c.status !== "rompu");
  const line = (c) => {
    const [lbl, tone] = CT_STATUS[c.status] || [c.status, ""];
    const rupt = c.rupture && !["resolue", "confirmee"].includes(c.rupture.stage);
    return `<div class="item">
      <div class="grow"><div class="ttl">${esc(c.learnerName || "—")} <span class="muted" style="font-weight:400;">chez ${esc(c.companyName || "—")}</span>
        <span class="pill ${tone}">${lbl}</span>${rupt ? ` <span class="pill overdue">⚠ ${RUPT_STAGE[c.rupture.stage]}</span>` : ""}${!c.validation.ok && c.status !== "rompu" ? ` <span class="pill warn">${c.validation.errors.length} blocage(s)</span>` : ""}</div>
        <div class="sub muted">${esc(c.dateDebut || "?")} → ${esc(c.dateFin || "?")}${c.npec ? " · NPEC " + Number(c.npec).toLocaleString("fr-FR") + " €" : ""}${c.alerts?.length ? " · " + esc(c.alerts[0].label) : ""}</div></div>
      <button class="btn-ghost btn-sm ct-open" data-id="${c.id}">Ouvrir</button>
    </div>`;
  };
  view.innerHTML = `
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k"><div class="v">${rows.length}</div><div class="l">contrats</div></div>
      <div class="k"><div class="v">${rows.filter((c) => c.status === "valide").length}</div><div class="l">validés</div></div>
      <div class="k${bloques.length ? " k-bad" : ""}"><div class="v">${bloques.length}</div><div class="l">non conformes</div></div>
      <div class="k${ruptures.length ? " k-bad" : ""}"><div class="v">${ruptures.length}</div><div class="l">ruptures en cours</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      ${isAdmin() ? `<select class="txt" id="ct-campus" style="max-width:200px;"><option value="">Tous les campus</option>${state.campuses.map((c) => `<option value="${c.id}" ${ctFilter.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}
      <select class="txt" id="ct-status" style="max-width:170px;"><option value="">Tous statuts</option>${Object.entries(CT_STATUS).map(([k, [l]]) => `<option value="${k}" ${ctFilter.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="sub" style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="ct-rupt" ${ctFilter.enRupture ? "checked" : ""}> ruptures en cours</label>
    </div>
    ${ruptures.length ? `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid var(--bad);"><b>⚠ ${ruptures.length} rupture(s) à traiter</b> — chaque jour compte : au-delà de 2 mois sans solution, le retour en formation devient rare.</div>` : ""}
    ${rows.length ? `<div class="list">${rows.map(line).join("")}</div>` : `<p class="empty">Aucun contrat${ctFilter.status || ctFilter.enRupture ? " pour ce filtre" : " — crée le premier avec « + Contrat »"}.</p>`}`;
  $("#ct-campus")?.addEventListener("change", () => { ctFilter.campusId = $("#ct-campus").value; renderContrats(); });
  $("#ct-status").addEventListener("change", () => { ctFilter.status = $("#ct-status").value; renderContrats(); });
  $("#ct-rupt").addEventListener("change", () => { ctFilter.enRupture = $("#ct-rupt").checked; renderContrats(); });
  $$(".ct-open").forEach((b) => b.addEventListener("click", () => openContractFiche(b.dataset.id)));
}

async function openContractForm(contract) {
  const c = contract || {};
  const campusId = c.campusId || ctFilter.campusId || state.campuses[0]?.id || "";
  const [learners, companies] = await Promise.all([
    api.get(`/api/learners?campusId=${campusId}`),
    api.get(`/api/partners?campusId=${campusId}`),
  ]);
  openModal(c.id ? "Modifier le contrat" : "Nouveau contrat d'alternance", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Apprenant *</label><select class="txt" id="ctf-learner"><option value="">—</option>${(learners || []).map((l) => `<option value="${l.id}" ${l.id === c.learnerId ? "selected" : ""}>${esc(l.prenom)} ${esc(l.nom)}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Entreprise *</label><select class="txt" id="ctf-company"><option value="">—</option>${(companies || []).map((p) => `<option value="${p.id}" ${p.id === c.companyId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Type</label><select class="txt" id="ctf-type"><option value="apprentissage" ${c.type !== "professionnalisation" ? "selected" : ""}>Apprentissage</option><option value="professionnalisation" ${c.type === "professionnalisation" ? "selected" : ""}>Professionnalisation</option></select></div>
      <div class="field"><label class="field-label">Début *</label><input class="txt" id="ctf-debut" type="date" value="${esc(c.dateDebut || "")}"></div>
      <div class="field"><label class="field-label">Fin *</label><input class="txt" id="ctf-fin" type="date" value="${esc(c.dateFin || "")}"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Signature</label><input class="txt" id="ctf-sign" type="date" value="${esc(c.dateSignature || "")}"></div>
      <div class="field"><label class="field-label">Année d'exécution</label><select class="txt" id="ctf-annee">${[1, 2, 3].map((y) => `<option value="${y}" ${(c.anneeExecution || 1) === y ? "selected" : ""}>Année ${y}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Rémunération € / mois</label><input class="txt" id="ctf-remu" type="number" step="0.01" value="${c.remunerationMensuelle ?? ""}"><div class="sub muted" id="ctf-wage"></div></div>
    </div>
    <div class="section-title" style="margin-top:6px;">Maître d'apprentissage</div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Nom *</label><input class="txt" id="ctf-mnom" value="${esc(c.maitreNom || "")}"></div>
      <div class="field"><label class="field-label">Fonction</label><input class="txt" id="ctf-mfonc" value="${esc(c.maitreFonction || "")}"></div>
      <div class="field"><label class="field-label">Email</label><input class="txt" id="ctf-mmail" value="${esc(c.maitreEmail || "")}"></div>
      <div class="field"><label class="field-label">Téléphone</label><input class="txt" id="ctf-mtel" value="${esc(c.maitreTel || "")}"></div>
    </div>
    <div class="section-title" style="margin-top:6px;">Financement</div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">NPEC €</label><input class="txt" id="ctf-npec" type="number" value="${c.npec ?? ""}"></div>
      <div class="field"><label class="field-label">Financeur</label><input class="txt" id="ctf-fin2" value="${esc(c.financeur || "")}"></div>
      <div class="field"><label class="field-label">N° dossier</label><input class="txt" id="ctf-dossier" value="${esc(c.numeroDossier || "")}"></div>
      <div class="field"><label class="field-label">N° dépôt</label><input class="txt" id="ctf-depot" value="${esc(c.numeroDepot || "")}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;"><input type="checkbox" id="ctf-derog" ${c.derogationAge ? "checked" : ""}> <span>Dérogation d'âge (RQTH, sportif de haut niveau, création d'entreprise…)</span></label>
    <div class="actions"><button class="btn-primary" id="ctf-save">${c.id ? "Enregistrer" : "Créer"}</button> <span class="status" id="ctf-msg"></span></div>`);
  // Aide vivante : la rémunération minimale s'affiche dès qu'on connaît l'âge et l'année.
  const refreshWage = async () => {
    const lid = $("#ctf-learner").value, debut = $("#ctf-debut").value;
    const l = (learners || []).find((x) => x.id === lid);
    if (!l?.dateNaissance || !debut) { $("#ctf-wage").textContent = ""; return; }
    const age = Math.floor((new Date(debut) - new Date(l.dateNaissance)) / (365.25 * 864e5));
    const w = await api.get(`/api/contracts/wage/simulate?age=${age}&year=${$("#ctf-annee").value}`);
    if (w?.amount) $("#ctf-wage").innerHTML = `minimum légal : <b>${w.amount.toFixed(2)} €</b> (${Math.round(w.rate * 100)} % du SMIC, ${age} ans)`;
  };
  ["#ctf-learner", "#ctf-debut", "#ctf-annee"].forEach((s) => $(s).addEventListener("change", refreshWage));
  refreshWage();
  $("#ctf-save").onclick = () => guard($("#ctf-save"), async () => {
    const body = {
      campusId, learnerId: $("#ctf-learner").value, companyId: $("#ctf-company").value, type: $("#ctf-type").value,
      dateDebut: $("#ctf-debut").value, dateFin: $("#ctf-fin").value, dateSignature: $("#ctf-sign").value,
      anneeExecution: $("#ctf-annee").value, remunerationMensuelle: $("#ctf-remu").value,
      maitreNom: $("#ctf-mnom").value.trim(), maitreFonction: $("#ctf-mfonc").value.trim(),
      maitreEmail: $("#ctf-mmail").value.trim(), maitreTel: $("#ctf-mtel").value.trim(),
      npec: $("#ctf-npec").value, financeur: $("#ctf-fin2").value.trim(),
      numeroDossier: $("#ctf-dossier").value.trim(), numeroDepot: $("#ctf-depot").value.trim(),
      derogationAge: $("#ctf-derog").checked,
    };
    if (!body.learnerId || !body.companyId) { $("#ctf-msg").textContent = "Apprenant et entreprise sont requis."; return; }
    const r = c.id ? await api.patch(`/api/contracts/${c.id}`, body) : await api.post("/api/contracts", body);
    if (r.error) { $("#ctf-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    if (c.id) openContractFiche(c.id); else renderContrats();
  });
}

async function openContractFiche(cid) {
  const c = await api.get(`/api/contracts/${cid}`);
  if (!c || c.error) { alert(c?.error || "Contrat introuvable"); return; }
  const v = c.validation;
  const rupt = c.rupture;
  const ruptOpen = rupt && !["resolue", "confirmee"].includes(rupt.stage);
  openModal(`Contrat — ${esc(c.learnerName || "")} / ${esc(c.companyName || "")}`, `
    <div class="sub muted" style="margin-top:0;">${esc(CT_STATUS[c.status]?.[0] || c.status)} · ${esc(c.dateDebut || "?")} → ${esc(c.dateFin || "?")} · ${c.type === "professionnalisation" ? "Professionnalisation" : "Apprentissage"}${c.npec ? " · NPEC " + Number(c.npec).toLocaleString("fr-FR") + " €" : ""}</div>
    ${v.errors.length ? `<div class="card card-pad" style="margin:10px 0;border-left:4px solid var(--bad);"><b>${v.errors.length} point(s) bloquant(s) avant dépôt</b><ul style="margin:6px 0 0;padding-left:18px;">${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
      : `<div class="card card-pad" style="margin:10px 0;border-left:4px solid var(--good);"><b>✓ Contrat conforme</b> — aucun point bloquant pour le dépôt.</div>`}
    ${v.warnings.length ? `<div class="card card-pad" style="margin:10px 0;border-left:4px solid var(--warn);"><b>Vigilance</b><ul style="margin:6px 0 0;padding-left:18px;">${v.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${v.wage ? `<p class="sub muted">Rémunération minimale légale : <b>${v.wage.amount.toFixed(2)} €/mois</b> (${Math.round(v.wage.rate * 100)} % du SMIC, tranche ${esc(v.wage.bracket)}, année ${v.wage.year})${c.remunerationMensuelle ? ` — versée : ${Number(c.remunerationMensuelle).toFixed(2)} €` : ""}. <i>Barème ${esc(v.wage.version)}, à revérifier chaque campagne.</i></p>` : ""}
    ${c.alerts?.length ? `<div class="list" style="margin:10px 0;">${c.alerts.map((a) => `<div class="item"><span class="pill ${a.severity === "high" ? "overdue" : "warn"}">${esc(a.date || "")}</span><div class="grow"><div class="ttl" style="font-weight:500;">${esc(a.label)}</div></div></div>`).join("")}</div>` : ""}
    ${rupt ? `<div class="section-title">Rupture — ${esc(RUPT_STAGE[rupt.stage] || rupt.stage)}</div>
      <p class="sub muted">Signalée le ${esc(rupt.since || "")}${rupt.origine ? " · origine : " + esc(rupt.origine) : ""}${rupt.owner ? " · pilote : " + esc(rupt.owner) : ""}<br>${esc(rupt.motif || "")}</p>
      <p class="sub">${rupt.mode ? `Qualification : <b>${esc(RUPT_MODES[rupt.mode]?.label || rupt.mode)}</b>` : `<span class="pill warn">Non qualifiée</span> — la qualification commande la procédure applicable`}
        ${["resolue", "confirmee"].includes(rupt.stage) ? "" : ` <button class="btn-ghost btn-sm" id="ct-qualif">${rupt.mode ? "Modifier" : "Qualifier"}</button>`}</p>
      ${rupt.mode && RUPT_MODES[rupt.mode] ? `<p class="sub muted"><b>Procédure :</b> ${esc(RUPT_MODES[rupt.mode].procedure)}</p>` : ""}
      ${rupt.mediateurSaisiLe ? `<p class="sub muted">Médiateur saisi le ${esc(rupt.mediateurSaisiLe)} · employeur informable à partir du ${esc(rupt.informationEmployeurAuPlusTot)} · rupture effective au plus tôt le ${esc(rupt.ruptureEffectiveAuPlusTot)}</p>` : ""}
      ${rupt.finAccompagnement ? `<p class="sub muted">Accompagnement du CFA jusqu'au <b>${esc(rupt.finAccompagnement)}</b> — l'apprenti reste en formation.</p>` : ""}
      <div class="list">${(rupt.events || []).slice().reverse().map((e) => `<div class="item"><span class="pill">${new Date(e.at).toLocaleDateString("fr-FR")}</span><div class="grow"><div class="ttl" style="font-weight:500;">${esc(RUPT_STAGE[e.stage] || e.stage)}</div><div class="sub muted">${esc(e.note || "")}${e.by ? " · " + esc(e.by) : ""}</div></div></div>`).join("")}</div>
      ${ruptOpen ? `<div class="actions" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
        ${["mediation", "replacement", "resolue", "confirmee"].filter((s) => s !== rupt.stage).map((s) => `<button class="btn-${s === "resolue" ? "primary" : "ghost"} btn-sm rupt-adv" data-stage="${s}">${RUPT_STAGE[s]}</button>`).join("")}
      </div>` : ""}` : ""}
    <div class="actions" style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-ghost btn-sm" id="ct-edit">Modifier</button>
      <button class="btn-ghost btn-sm" id="ct-portal">🔗 Lien tuteur</button>
      <button class="btn-ghost btn-sm" id="ct-cerfa">📄 Dossier de dépôt</button>
      ${c.status !== "depose" && c.status !== "valide" && c.status !== "rompu" ? `<button class="btn-primary btn-sm" id="ct-depose" ${v.ok ? "" : "disabled title=\"Lever d'abord les points bloquants\""}>Marquer déposé</button>` : ""}
      ${c.status === "depose" ? `<button class="btn-primary btn-sm" id="ct-valide">Marquer validé</button>` : ""}
      ${!ruptOpen && c.status !== "rompu" ? `<button class="btn-ghost btn-sm btn-danger" id="ct-rupture">Signaler une rupture</button>` : ""}
    </div>`);
  $("#ct-edit").onclick = () => { document.querySelector(".modal-bg")?.remove(); openContractForm(c); };
  $("#ct-portal").onclick = () => openPortalLink("tutor", c.companyId, c.campusId, c.companyName || "Entreprise");
  $("#ct-cerfa").onclick = () => openCerfaDossier(cid);
  $("#ct-depose")?.addEventListener("click", async () => {
    const r = await api.patch(`/api/contracts/${cid}`, { status: "depose", dateDepot: new Date().toISOString().slice(0, 10) });
    if (r.error) { alert(r.error + (r.errors ? "\n\n• " + r.errors.join("\n• ") : "")); return; }
    document.querySelector(".modal-bg")?.remove(); openContractFiche(cid);
  });
  $("#ct-valide")?.addEventListener("click", async () => {
    const r = await api.patch(`/api/contracts/${cid}`, { status: "valide", dateValidation: new Date().toISOString().slice(0, 10) });
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove(); await openContractFiche(cid);
  });
  $("#ct-rupture")?.addEventListener("click", () => openRuptureForm(cid));
  $("#ct-qualif")?.addEventListener("click", () => openRuptureForm(cid, rupt));
  $$(".rupt-adv").forEach((b) => b.addEventListener("click", async () => {
    const stage = b.dataset.stage;
    if (stage === "confirmee" && !confirm("Confirmer la rupture ?\n\nLe contrat passera en « rompu ». L'apprenti restera en formation au CFA pendant 6 mois sous statut de stagiaire de la formation professionnelle — il ne sort PAS des effectifs.")) return;
    const note = prompt(`Note pour l'étape « ${RUPT_STAGE[stage]} » :`, "") || "";
    const owner = stage === "mediation" || stage === "replacement" ? (prompt("Qui pilote ?", rupt.owner || "") || "") : undefined;
    const r = await api.patch(`/api/contracts/${cid}/rupture`, { stage, note, owner });
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove(); openContractFiche(cid);
  }));
}

// ---------- Vue : Notes & bulletins ----------
const EVAL_TYPE = { devoir: "Devoir", examen: "Examen", tp: "TP", oral: "Oral", projet: "Projet", cco: "CCF" };
let ntCampus = "", ntClass = "", ntFrom = "", ntTo = "";
// Jeton de génération : invalide un rendu dont la réponse arrive après un
// changement de classe (sinon le rendu périmé écrase le nouveau).
let ntGen = 0;
async function renderNotes() {
  const view = $("#view");
  if (!ntCampus) ntCampus = state.campuses[0]?.id || "";
  const classes = ntCampus ? (await api.get(`/api/classes?campusId=${ntCampus}`) || []) : [];
  if (ntClass && !classes.some((k) => k.id === ntClass)) ntClass = "";
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="nt-add">${I.plus}<span>Évaluation</span></button>`;
  $("#nt-add").addEventListener("click", () => openAssessmentForm(null, classes));
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const qs = new URLSearchParams();
  if (ntCampus) qs.set("campusId", ntCampus);
  if (ntClass) qs.set("classId", ntClass);
  const evals = await api.get("/api/assessments?" + qs.toString()) || [];
  const learners = ntClass ? (await api.get(`/api/learners?campusId=${ntCampus}`) || []) : [];
  const line = (a) => `<div class="item">
    <span class="pill">${esc(a.date || "—")}</span>
    <div class="grow"><div class="ttl">${esc(a.label)} <span class="muted" style="font-weight:400;">${EVAL_TYPE[a.type] || a.type}${a.moduleLabel ? " · " + esc(a.moduleLabel) : ""}${a.className ? " · " + esc(a.className) : ""}</span></div>
      <div class="sub muted">coef. ${a.coefficient} · sur ${a.maxScore} · ${a.graded}/${a.total} note(s) saisie(s)</div></div>
    ${a.graded < a.total ? '<span class="pill warn">à saisir</span>' : '<span class="pill done">complète</span>'}
    <button class="btn-ghost btn-sm nt-open" data-id="${a.id}">Saisir</button>
  </div>`;
  view.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      ${isAdmin() ? `<select class="txt" id="nt-campus" style="max-width:200px;">${state.campuses.map((c) => `<option value="${c.id}" ${ntCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}
      <select class="txt" id="nt-class" style="max-width:200px;"><option value="">Toutes les classes</option>${classes.map((k) => `<option value="${k.id}" ${ntClass === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select>
      ${ntClass ? `<span class="sub muted" style="align-self:center;">Période du bulletin :</span>
      <input class="txt" id="nt-from" type="date" value="${esc(ntFrom)}" style="max-width:150px;" title="début de période">
      <input class="txt" id="nt-to" type="date" value="${esc(ntTo)}" style="max-width:150px;" title="fin de période">
      ${ntFrom || ntTo ? `<button class="btn-ghost btn-sm" id="nt-clear">Toute l'année</button>` : ""}` : ""}
    </div>
    <div class="section-title" style="margin-top:0;">Évaluations <span class="muted">(${evals.length})</span></div>
    ${evals.length ? `<div class="list">${evals.map(line).join("")}</div>` : `<p class="empty">Aucune évaluation${ntClass ? " pour cette classe" : ""} — crée la première avec « + Évaluation ».</p>`}
    ${ntClass ? `<div class="section-title">Bulletins <span class="muted">(inscrits de la classe)</span></div>
      <div class="list" id="nt-bulletins"><p class="muted" style="padding:8px;">Chargement des moyennes…</p></div>` : `<p class="hint muted" style="margin-top:14px;">Choisis une classe pour afficher les moyennes et éditer les bulletins.</p>`}`;
  $("#nt-campus")?.addEventListener("change", () => { ntCampus = $("#nt-campus").value; ntClass = ""; renderNotes(); });
  $("#nt-class").addEventListener("change", () => { ntClass = $("#nt-class").value; renderNotes(); });
  $("#nt-from")?.addEventListener("change", () => { ntFrom = $("#nt-from").value; renderNotes(); });
  $("#nt-to")?.addEventListener("change", () => { ntTo = $("#nt-to").value; renderNotes(); });
  $("#nt-clear")?.addEventListener("click", () => { ntFrom = ""; ntTo = ""; renderNotes(); });
  $$(".nt-open").forEach((b) => b.addEventListener("click", () => openGradeEntry(b.dataset.id)));
  if (ntClass) {
    // Une seule requête pour toute la classe : la version précédente en émettait
    // une par apprenant du campus, en série, et jetait celles qui ne concernaient
    // pas la classe — environ sept secondes d'attente pour 25 bulletins.
    const gen = ++ntGen;
    const qsRep = new URLSearchParams();
    if (ntFrom) qsRep.set("from", ntFrom);
    if (ntTo) qsRep.set("to", ntTo);
    const data = await api.get(`/api/classes/${ntClass}/reports?` + qsRep.toString());
    // L'utilisateur a pu changer de classe pendant le chargement : ne pas écrire
    // les moyennes d'une classe dans le conteneur d'une autre.
    if (gen !== ntGen) return;
    const box = $("#nt-bulletins");
    if (!box) return;
    if (data?.error) { box.innerHTML = `<p class="empty">${esc(data.error)}</p>`; return; }
    const rows = data?.reports || [];
    box.innerHTML = rows.length ? rows.map((r) => `<div class="item">
        <span class="pill">${r.rank ? r.rank + "ᵉ" : "—"}</span>
        <div class="grow"><div class="ttl">${esc(r.prenom || "")} ${esc((r.nom || "").toUpperCase())}
          ${r.certification?.total ? `<span class="pill ${r.certification.titreComplet ? "done" : r.certification.nonAcquis ? "overdue" : ""}">${r.certification.acquis}/${r.certification.total} bloc(s)</span>` : ""}</div>
          <div class="sub muted">${r.average != null ? "moyenne " + r.average.toFixed(2).replace(".", ",") + " · " + (r.mention || "") : "aucune note"}${r.certification?.resteAValider?.length ? " · reste : " + esc(r.certification.resteAValider.join(", ")) : ""}</div></div>
        <a class="btn-ghost btn-sm" href="/api/learners/${r.learnerId}/bulletin${ntFrom || ntTo ? "?" + qsRep.toString() : ""}" target="_blank">Bulletin</a>
      </div>`).join("") : `<p class="muted" style="padding:8px;">Aucun apprenant inscrit dans cette classe.</p>`;
  }
}

async function openAssessmentForm(a, classes) {
  a = a || {};
  const classId = a.classId || ntClass || classes[0]?.id || "";
  const mods = await modulesForClass(classId, classes);
  openModal(a.id ? "Modifier l'évaluation" : "Nouvelle évaluation", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Intitulé *</label><input class="txt" id="af-label" value="${esc(a.label || "")}" placeholder="Devoir sur table n°2"></div>
      <div class="field"><label class="field-label">Classe *</label><select class="txt" id="af-class">${classes.map((k) => `<option value="${k.id}" ${k.id === classId ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Matière</label><select class="txt" id="af-module"><option value="">—</option>${mods.map((m) => `<option value="${m.id}" ${m.id === a.moduleId ? "selected" : ""}>${esc(m.code ? m.code + " — " : "")}${esc(m.label)}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Type</label><select class="txt" id="af-type">${Object.entries(EVAL_TYPE).map(([k, l]) => `<option value="${k}" ${k === (a.type || "devoir") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Date</label><input class="txt" id="af-date" type="date" value="${esc(a.date || new Date().toISOString().slice(0, 10))}"></div>
      <div class="field"><label class="field-label">Coefficient</label><input class="txt" id="af-coef" type="number" step="0.5" min="0" value="${a.coefficient ?? 1}"></div>
      <div class="field"><label class="field-label">Barème (noté sur)</label><input class="txt" id="af-max" type="number" min="1" value="${a.maxScore ?? 20}"></div>
    </div>
    <div class="actions"><button class="btn-primary" id="af-save">${a.id ? "Enregistrer" : "Créer et saisir les notes"}</button> <span class="status" id="af-msg"></span></div>`);
  $("#af-save").onclick = () => guard($("#af-save"), async () => {
    const body = { campusId: ntCampus, classId: $("#af-class").value, moduleId: $("#af-module").value || null,
      label: $("#af-label").value.trim(), type: $("#af-type").value, date: $("#af-date").value,
      coefficient: $("#af-coef").value, maxScore: $("#af-max").value };
    if (!body.label) { $("#af-msg").textContent = "L'intitulé est requis."; return; }
    const r = a.id ? await api.patch(`/api/assessments/${a.id}`, body) : await api.post("/api/assessments", body);
    if (r.error) { $("#af-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    if (!a.id) openGradeEntry(r.id); else renderNotes();
  });
}

async function modulesForClass(classId, classes) {
  const k = (classes || []).find((x) => x.id === classId);
  if (!k?.curriculumId) return [];
  const cur = await api.get(`/api/curricula`);
  return (cur || []).find((c) => c.id === k.curriculumId)?.modules || [];
}

async function openGradeEntry(aid) {
  const a = await api.get(`/api/assessments/${aid}`);
  if (!a || a.error) { alert(a?.error || "Évaluation introuvable"); return; }
  const row = (g) => `<div class="item grade-row" data-lid="${g.learnerId}">
    <div class="grow"><div class="ttl">${esc(g.learnerName)}</div></div>
    <input class="txt gr-score" data-lid="${g.learnerId}" type="number" step="0.25" min="0" max="${a.maxScore}" value="${g.score ?? ""}" style="width:80px;" placeholder="/${a.maxScore}" ${g.absent ? "disabled" : ""}>
    <label class="sub muted" style="display:flex;align-items:center;gap:4px;white-space:nowrap;"><input type="checkbox" class="gr-abs" data-lid="${g.learnerId}" ${g.absent ? "checked" : ""}> absent</label>
    <label class="sub muted" style="display:flex;align-items:center;gap:4px;white-space:nowrap;${g.absent ? "" : "display:none;"}" data-zero="${g.learnerId}"><input type="checkbox" class="gr-zero" data-lid="${g.learnerId}" ${g.zeroSiAbsent ? "checked" : ""}> compte 0</label>
  </div>`;
  openModal(`${esc(a.label)} — saisie des notes`, `
    <p class="sub muted" style="margin-top:0;">${EVAL_TYPE[a.type] || a.type} · noté sur ${a.maxScore} · coefficient ${a.coefficient}${a.date ? " · " + esc(a.date) : ""}</p>
    ${a.stats ? `<div class="kpis" style="margin-bottom:10px;">
      <div class="k"><div class="v">${a.stats.average.toFixed(2).replace(".", ",")}</div><div class="l">moyenne (/20)</div></div>
      <div class="k"><div class="v">${a.stats.min.toFixed(2).replace(".", ",")}</div><div class="l">min</div></div>
      <div class="k"><div class="v">${a.stats.max.toFixed(2).replace(".", ",")}</div><div class="l">max</div></div>
      <div class="k"><div class="v">${a.stats.count}</div><div class="l">notés</div></div>
    </div>` : ""}
    <div class="list">${a.grades.map(row).join("")}</div>
    <p class="hint muted" style="margin-top:10px;">Une absence ne compte pas comme un zéro : elle sort du calcul de la moyenne, sauf si l'équipe coche explicitement « compte 0 ».</p>
    <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="gr-save">Enregistrer les notes</button> <span class="status" id="gr-msg"></span></div>`);
  $$(".gr-abs").forEach((c) => c.addEventListener("change", () => {
    const lid = c.dataset.lid;
    const score = $(`.gr-score[data-lid="${lid}"]`);
    const zero = document.querySelector(`[data-zero="${lid}"]`);
    if (score) score.disabled = c.checked;
    if (zero) zero.style.display = c.checked ? "flex" : "none";
  }));
  $("#gr-save").onclick = () => guard($("#gr-save"), async () => {
    const entries = $$(".grade-row").map((r) => {
      const lid = r.dataset.lid;
      return { learnerId: lid, score: $(`.gr-score[data-lid="${lid}"]`).value,
        absent: $(`.gr-abs[data-lid="${lid}"]`).checked, zeroSiAbsent: $(`.gr-zero[data-lid="${lid}"]`)?.checked };
    });
    const r = await api.patch(`/api/assessments/${aid}/grades`, { entries });
    if (r.error) { $("#gr-msg").textContent = r.error; $("#gr-msg").style.color = "var(--bad)"; return; }
    document.querySelector(".modal-bg")?.remove();
    await renderNotes();
  });
}

// Dossier de dépôt du contrat. On montre d'abord ce qui MANQUE : éditer un
// dossier incomplet, c'est un rejet et des semaines perdues.
async function openCerfaDossier(cid) {
  const d = await api.get(`/api/contracts/${cid}/cerfa`);
  if (!d || d.error) { alert(d?.error || "Dossier indisponible"); return; }
  openModal("Dossier de dépôt du contrat", `
    <div class="card card-pad" style="border-left:4px solid var(--${d.ready ? "good" : "bad"});margin-bottom:12px;">
      <b>${d.ready ? "✓ Dossier complet" : `${d.missing.length} rubrique(s) à compléter`}</b>
      <div class="sub muted">Rempli à ${d.completeness} %${d.mineur ? " · apprenti mineur : la section représentant légal est exigée" : ""}</div>
      ${d.missing.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;">${d.missing.slice(0, 10).map((m) => `<li>${esc(m.section)} — ${esc(m.label)}${m.hint ? ` <span class="muted">(${esc(m.hint)})</span>` : ""}</li>`).join("")}${d.missing.length > 10 ? `<li class="muted">… et ${d.missing.length - 10} autre(s)</li>` : ""}</ul>` : ""}
    </div>
    ${d.periods?.length ? `<div class="section-title" style="margin-top:0;">Rémunération par période</div>
      <div class="list">${d.periods.map((p) => `<div class="item"><span class="pill">${esc(p.from)} → ${esc(p.to)}</span>
        <div class="grow"><div class="ttl">${p.montantMinimum != null ? p.montantMinimum.toFixed(2).replace(".", ",") + " € minimum" : "—"}</div>
        <div class="sub muted">année ${p.year ?? "—"} · ${p.age ?? "?"} ans${p.rate != null ? " · " + Math.round(p.rate * 100) + " % du " + (p.base || "SMIC") : ""}</div></div></div>`).join("")}</div>` : ""}
    <div class="field" style="margin-top:12px;"><label class="field-label">NIR de l'apprenti <span class="muted">(facultatif — saisi pour l'édition, jamais conservé)</span></label>
      <input class="txt" id="cf-nir" placeholder="13 chiffres + clé" autocomplete="off"></div>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-primary" id="cf-print">Éditer le dossier</button>
    </div>
    <p class="hint muted" style="margin-top:10px;">Ce dossier rassemble et contrôle toutes les rubriques exigées, pour la saisie sur le portail de l'opérateur de compétences ou le dépôt dématérialisé. Il ne remplace pas le formulaire Cerfa officiel.</p>`);
  $("#cf-print").onclick = () => {
    const nir = $("#cf-nir").value.trim();
    window.open(`/api/contracts/${cid}/cerfa/print${nir ? "?nir=" + encodeURIComponent(nir) : ""}`, "_blank");
  };
}

// Qualification juridique de la rupture. Le mode commande les délais, le
// formalisme et les parties à informer : le choisir à l'aveugle expose le CFA.
let RUPT_MODES = {};
async function openRuptureForm(cid, rupt) {
  if (!Object.keys(RUPT_MODES).length) RUPT_MODES = await api.get("/api/contracts/rupture-modes") || {};
  const existe = !!rupt;
  openModal(existe ? "Qualifier la rupture" : "Signaler une rupture", `
    ${existe ? "" : `<div class="field"><label class="field-label">Que s'est-il passé ? *</label><textarea id="rf-motif" rows="2" placeholder="Motif du signalement"></textarea></div>
    <div class="field"><label class="field-label">Origine du signalement</label><select class="txt" id="rf-origine"><option value="entreprise">Entreprise</option><option value="apprenti">Apprenti</option><option value="cfa">CFA</option></select></div>`}
    <div class="field"><label class="field-label">Mode de rupture ${existe ? "*" : "(peut être précisé plus tard)"}</label>
      <select class="txt" id="rf-mode"><option value="">— à qualifier —</option>${Object.entries(RUPT_MODES).map(([k, m]) => `<option value="${k}" ${rupt?.mode === k ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></div>
    <div id="rf-detail" class="card card-pad" style="display:none;font-size:13px;"></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="rf-save">${existe ? "Enregistrer la qualification" : "Signaler"}</button> <span class="status" id="rf-msg"></span></div>
    <p class="hint muted">La qualification détermine les délais et le formalisme applicables. Elle est <b>obligatoire avant de confirmer</b> la rupture.</p>`);
  const maj = () => {
    const m = RUPT_MODES[$("#rf-mode").value];
    const box = $("#rf-detail");
    if (!m) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = `<b>${esc(m.label)}</b><div class="sub muted" style="margin-top:4px;"><b>Quand :</b> ${esc(m.quand)}</div><div class="sub muted" style="margin-top:4px;"><b>Procédure :</b> ${esc(m.procedure)}</div>`;
  };
  $("#rf-mode").addEventListener("change", maj); maj();
  $("#rf-save").onclick = () => guard($("#rf-save"), async () => {
    const mode = $("#rf-mode").value || undefined;
    let r;
    if (existe) {
      if (!mode) { $("#rf-msg").textContent = "Choisis un mode de rupture."; return; }
      r = await api.patch(`/api/contracts/${cid}/rupture`, { stage: rupt.stage, mode, note: "qualification du mode de rupture" });
    } else {
      const motif = $("#rf-motif").value.trim();
      if (!motif) { $("#rf-msg").textContent = "Le motif est requis."; return; }
      r = await api.post(`/api/contracts/${cid}/rupture`, { motif, origine: $("#rf-origine").value, mode });
    }
    if (r.error) { $("#rf-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    await openContractFiche(cid);
  });
}

// ---------- Vue : Clés d'API ----------
async function renderApiKeys() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [scopes, cles] = await Promise.all([api.get("/api/apikeys/scopes"), api.get("/api/apikeys")]);
  const nomCampus = (ids) => !ids ? "tous les campus"
    : ids.map((id) => state.campuses.find((c) => c.id === id)?.name || id).join(", ");

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Les clés d'API permettent à un logiciel tiers d'appeler votre instance.
      Une clé n'est affichée <b>qu'une seule fois</b> : seule son empreinte est conservée.
      Documentation publique : <a href="/v1/docs" target="_blank">/v1/docs</a>.</p>
    </div>

    <div class="section-title">Clés existantes</div>
    <div class="card"><div class="list">${(cles || []).map((k) => `<div class="item">
      <span class="pill ${k.revokedAt ? "overdue" : k.jamaisUtilisee ? "warn" : "done"}">${k.revokedAt ? "révoquée" : k.jamaisUtilisee ? "jamais utilisée" : "active"}</span>
      <div class="grow"><div class="ttl">${esc(k.nom)} <span class="muted" style="font-weight:400;font-family:ui-monospace,monospace;">${esc(k.apercu || "")}</span></div>
        <div class="sub muted">${k.scopes.map(esc).join(", ")} · ${esc(nomCampus(k.campusIds))}${k.expiresAt ? ` · expire le ${esc(k.expiresAt)}` : ""}${k.lastUsedAt ? ` · dernier appel ${esc(String(k.lastUsedAt).slice(0, 10))}` : ""}</div></div>
      ${k.revokedAt ? "" : `<button class="btn-ghost btn-sm btn-danger ak-rev" data-id="${k.id}">Révoquer</button>`}</div>`).join("") || '<p class="muted" style="padding:10px;">Aucune clé.</p>'}</div></div>

    <div class="section-title">Créer une clé</div>
    <div class="card card-pad">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <input class="txt grow" id="ak-nom" placeholder="Nom (ex. « Export paie »)" style="min-width:220px;">
        <div><label class="field-label">Expire le (facultatif)</label><input class="txt" id="ak-exp" type="date"></div>
      </div>
      <div style="margin-top:10px;"><label class="field-label">Portées</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;">${Object.entries(scopes).map(([k, v]) => `<label class="sub"><input type="checkbox" class="ak-scope" value="${k}"> <code>${esc(k)}</code> — ${esc(v)}</label>`).join("")}</div></div>
      ${state.campuses.length > 1 ? `<div style="margin-top:10px;"><label class="field-label">Limiter à des campus (facultatif)</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;">${state.campuses.map((c) => `<label class="sub"><input type="checkbox" class="ak-campus" value="${c.id}"> ${esc(c.name)}</label>`).join("")}</div></div>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
        <button class="btn-primary btn-sm" id="ak-add">Créer la clé</button>
        <span class="sub" id="ak-msg"></span>
      </div>
      <p class="hint muted">Une portée <code>:write</code> accorde aussi la lecture de la même ressource. Une clé ne peut jamais dépasser vos propres droits.</p>
    </div>`;

  $("#ak-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const m = $("#ak-msg");
    const choisies = $$(".ak-scope").filter((c) => c.checked).map((c) => c.value);
    if (!choisies.length) { m.textContent = "Choisir au moins une portée."; m.style.color = "var(--bad)"; return; }
    const campusIds = $$(".ak-campus").filter((c) => c.checked).map((c) => c.value);
    const r = await api.post("/api/apikeys", {
      nom: $("#ak-nom").value.trim(), scopes: choisies,
      campusIds: campusIds.length ? campusIds : null, expiresAt: $("#ak-exp").value || null,
    });
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
    // La clé n'existera plus nulle part après ce message : on la montre dans une
    // modale explicite plutôt que dans une ligne de liste qu'on ferme par réflexe.
    openModal("Clé créée — copiez-la maintenant", `
      <div class="card card-pad" style="border-left:4px solid var(--bad);"><b>${esc(r.avertissement)}</b></div>
      <pre style="background:var(--card,#fff);border:1px solid var(--line,#e3ded3);border-radius:8px;padding:14px;overflow-x:auto;font-family:ui-monospace,monospace;font-size:13px;margin-top:12px;">${esc(r.cle)}</pre>
      <div class="actions"><button class="btn-primary" id="ak-copy">Copier</button></div>
      <p class="hint muted">Transmettez-la par un canal sûr. Si elle est perdue, révoquez-la et créez-en une autre : elle ne peut pas être relue.</p>`);
    $("#ak-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.cle); $("#ak-copy").textContent = "Copié"; }
      catch { $("#ak-copy").textContent = "Copie impossible — sélectionnez le texte"; }
    };
    await renderApiKeys();
  });
  $$(".ak-rev").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    if (!confirm("Révoquer cette clé ? Toute intégration qui l'utilise cessera immédiatement de fonctionner.")) return;
    await api.del(`/api/apikeys/${b.dataset.id}`);
    await renderApiKeys();
  })));
}

// ---------- Vue : Comptabilité & paie ----------
let expCampus = "";
async function renderExports() {
  if (!expCampus) expCampus = state.campuses[0]?.id || "";
  const an = new Date().getFullYear() - 1;
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="ex-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${expCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [plan, ref] = await Promise.all([api.get("/api/compta/plan"), api.get("/api/paie/referentiels")]);

  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">Export comptable (FEC)</div>
    <p class="muted" style="margin-top:0;">Fichier des écritures comptables, au format attendu par l'administration fiscale (art. A. 47 A-1 du LPF).
    Il n'est produit que s'il est <b>équilibré</b> : un fichier déséquilibré est rejeté au contrôle, le livrer ne rendrait service à personne.</p>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div><label class="field-label">Début d'exercice</label><input class="txt" id="fec-from" type="date" value="${an}-01-01"></div>
        <div><label class="field-label">Fin d'exercice</label><input class="txt" id="fec-to" type="date" value="${an}-12-31"></div>
        <button class="btn-ghost btn-sm" id="fec-verif">Vérifier</button>
        <button class="btn-primary btn-sm" id="fec-dl">Télécharger le FEC</button>
      </div>
      <div id="fec-res" style="margin-top:12px;"></div>
    </div>

    <div class="section-title">Plan de comptes</div>
    <p class="muted" style="margin-top:0;">Chaque organisme a le sien : ces comptes sont ceux qui figureront dans le fichier remis au cabinet.</p>
    <div class="card card-pad"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
      ${[["client", "Clients"], ["produits", "Produits (prestations)"], ["banque", "Banque"], ["tva", "TVA collectée"]].map(([k, l]) => `
        <div><label class="field-label">${esc(l)}</label><input class="txt pc" data-k="${k}" value="${esc(plan.actuel[k] || "")}"></div>`).join("")}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
      <button class="btn-ghost btn-sm" id="pc-save">Enregistrer le plan</button><span class="sub" id="pc-msg"></span></div></div>

    <div class="section-title">Préparation de la paie</div>
    <p class="muted" style="margin-top:0;">Les <b>prestataires facturent</b> : ils sont écartés de l'export et listés à part.
    Les heures de face-à-face ne sont pas les heures payées — la règle de préparation se déclare sur la fiche de l'intervenant.</p>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div><label class="field-label">Du</label><input class="txt" id="pa-from" type="date" value="${an + 1}-01-01"></div>
        <div><label class="field-label">Au</label><input class="txt" id="pa-to" type="date" value="${an + 1}-01-31"></div>
        <button class="btn-ghost btn-sm" id="pa-verif">Calculer</button>
        <button class="btn-primary btn-sm" id="pa-dl">Exporter (Excel)</button>
      </div>
      <div id="pa-res" style="margin-top:12px;"></div>
    </div>
    <p class="sub muted" style="margin-top:12px;">Règles de préparation disponibles : ${Object.values(ref.regles).map((r) => esc(r.label)).join(" · ")}.</p>`;

  $("#ex-campus")?.addEventListener("change", () => { expCampus = $("#ex-campus").value; renderExports(); });

  const periodeFec = () => `campusId=${expCampus}&from=${$("#fec-from").value}&to=${$("#fec-to").value}`;
  $("#fec-verif").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.get(`/api/compta/fec?${periodeFec()}`);
    $("#fec-res").innerHTML = r.remettable
      ? `<div class="card card-pad" style="border-left:4px solid var(--good);"><b>${r.ecritures} écriture(s), ${r.lignes} ligne(s) — équilibré.</b>
         <div class="sub muted">${r.totalDebit.toLocaleString("fr-FR")} € au débit, autant au crédit.</div></div>`
      : `<div class="card card-pad" style="border-left:4px solid var(--bad);"><b>Non remettable en l'état</b>
         <ul style="margin:6px 0 0;padding-left:18px;">${(r.anomalies || []).map((a) => `<li>${esc(a.message)}</li>`).join("") || "<li>aucune écriture sur l'exercice</li>"}</ul></div>`;
  });
  $("#fec-dl").onclick = async () => {
    const r = await api.get(`/api/compta/fec?${periodeFec()}`);
    if (!r.remettable) { $("#fec-verif").click(); return; }
    location.href = `/api/compta/fec?${periodeFec()}&format=fec`;
  };
  $("#pc-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const corps = {};
    $$(".pc").forEach((i) => { corps[i.dataset.k] = i.value.trim(); });
    await api.put("/api/compta/plan", corps);
    $("#pc-msg").textContent = "Plan enregistré."; $("#pc-msg").style.color = "var(--good)";
  });

  const periodePaie = () => `campusId=${expCampus}&from=${$("#pa-from").value}&to=${$("#pa-to").value}`;
  $("#pa-verif").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.get(`/api/paie/export?${periodePaie()}`);
    $("#pa-res").innerHTML = `
      <div class="kpis"><div class="k"><div class="v">${r.lignes.length}</div><div class="l">à payer</div></div>
        <div class="k"><div class="v">${r.totalHeures}</div><div class="l">heures</div></div>
        <div class="k"><div class="v">${r.totalBrut.toLocaleString("fr-FR")} €</div><div class="l">brut</div></div>
        <div class="k${r.seancesNonConfirmees ? " k-bad" : ""}"><div class="v">${r.seancesNonConfirmees}</div><div class="l">séances non confirmées</div></div></div>
      ${r.incomplets.length ? `<div class="card card-pad" style="border-left:4px solid var(--bad);"><b>Export bloqué :</b><ul style="margin:6px 0 0;padding-left:18px;">${r.incomplets.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
      ${r.exclus.length ? `<div class="card card-pad" style="border-left:4px solid var(--warn,#C77700);margin-top:8px;"><b>Écartés de la paie</b>
        <div class="list">${r.exclus.map((x) => `<div class="item"><div class="grow"><div class="ttl">${esc(x.intervenant)}</div><div class="sub muted">${esc(x.motif)}</div></div>
        <span class="pill">${x.constate.heures} h à facturer</span></div>`).join("")}</div></div>` : ""}
      <div class="card" style="margin-top:8px;overflow-x:auto;"><table class="net-table"><thead><tr>${["Nom", "Statut", "Constatées", "Règle", "À payer", "Taux", "Brut"].map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${r.lignes.map((l) => `<tr><td>${esc(l.nom)}</td><td>${esc(l.statut)}</td><td>${l.heuresConstatees} h</td><td>${esc(l.regle)}</td>
          <td><b>${l.heuresPayees} h</b></td><td>${l.tauxHoraire} €</td><td><b>${l.brut.toLocaleString("fr-FR")} €</b></td></tr>`).join("") || '<tr><td colspan="7">Aucune heure constatée sur la période.</td></tr>'}</tbody></table></div>`;
  });
  $("#pa-dl").onclick = () => { location.href = `/api/paie/export?${periodePaie()}&format=xlsx`; };
}

// ---------- Vue : Dépôts OPCO ----------
let decaCampus = "";
async function renderDeca() {
  if (!decaCampus) decaCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="dc-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${decaCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [ref, t] = await Promise.all([api.get("/api/deca/referentiels"), api.get(`/api/deca?campusId=${decaCampus}`)]);
  const teinte = { critique: "overdue", eleve: "overdue", moyen: "warn", aucun: "done" };

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Ce n'est pas le CFA qui dépose : l'employeur transmet à son OPCO, qui contrôle puis dépose.
      Ce que l'on peut faire, c'est ne pas laisser filer les délais — <b>${ref.delaiTransmission} jours ouvrables</b> pour transmettre,
      <b>${ref.delaiDecision} jours</b> pour la décision. <b>Au-delà, le silence de l'OPCO vaut refus</b> (décret du 28 juin 2024).</p>
    </div>
    <div class="kpis">
      <div class="k"><div class="v">${t.total}</div><div class="l">contrats suivis</div></div>
      <div class="k${t.aTraiter ? " k-bad" : ""}"><div class="v">${t.aTraiter}</div><div class="l">à traiter</div></div>
      <div class="k"><div class="v">${t.finances}</div><div class="l">pris en charge</div></div>
      <div class="k${t.financementCompromis ? " k-bad" : ""}"><div class="v">${t.financementCompromis}</div><div class="l">financement compromis</div></div>
    </div>
    <div class="card"><div class="list">${(t.lignes || []).map((l) => `<div class="item">
      <span class="pill ${teinte[l.risque]}">${esc(l.etatLabel)}</span>
      <div class="grow"><div class="ttl">${esc(l.apprenant)} <span class="muted" style="font-weight:400;">${esc(l.employeur)}</span></div>
        <div class="sub muted">début ${esc(l.dateDebut || "?")}${l.dateTransmission ? ` · transmis le ${esc(l.dateTransmission)}` : ""}${l.echeanceDecision ? ` · décision attendue avant le ${esc(l.echeanceDecision)}` : ""}
        ${l.alertes.map((a) => `<br><b>${esc(a.message)}</b>`).join("")}</div></div>
      <button class="btn-ghost btn-sm dc-ed" data-id="${l.contratId}">Mettre à jour</button></div>`).join("") || '<p class="muted" style="padding:10px;">Aucun contrat déposable sur ce campus.</p>'}</div></div>`;

  $("#dc-campus")?.addEventListener("change", () => { decaCampus = $("#dc-campus").value; renderDeca(); });
  $$(".dc-ed").forEach((b) => b.addEventListener("click", () => {
    const l = t.lignes.find((x) => x.contratId === b.dataset.id);
    openModal(`Dépôt — ${l.apprenant}`, `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div style="min-width:220px;"><label class="field-label">État</label><select class="txt" id="dp-etat">${Object.entries(ref.etats).map(([k, v]) => `<option value="${k}" ${l.etat === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></div>
        <div><label class="field-label">Transmis le</label><input class="txt" id="dp-trans" type="date" value="${esc(l.dateTransmission || "")}"></div>
        <div><label class="field-label">Décision le</label><input class="txt" id="dp-dec" type="date" value="${esc(l.dateDecision || "")}"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <input class="txt" id="dp-opco" placeholder="OPCO" value="${esc(l.opco || "")}" style="max-width:200px;">
        <input class="txt grow" id="dp-motif" placeholder="Motif (refus ou correction demandée)" style="min-width:220px;">
      </div>
      <p class="hint muted">Un refus sans motif enregistré ne peut être ni corrigé ni contesté.</p>
      <div class="actions"><button class="btn-primary" id="dp-save">Enregistrer</button><span class="sub" id="dp-msg" style="align-self:center;"></span></div>`);
    $("#dp-save").onclick = (ev) => guard(ev.currentTarget, async () => {
      const r = await api.put(`/api/contracts/${l.contratId}/depot`, {
        etat: $("#dp-etat").value, dateTransmission: $("#dp-trans").value || null,
        dateDecision: $("#dp-dec").value || null, opco: $("#dp-opco").value.trim(), motif: $("#dp-motif").value.trim(),
      });
      const m = $("#dp-msg");
      if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
      document.querySelector(".modal-bg")?.remove();
      await renderDeca();
    });
  }));
}

// ---------- Vue : Taxe d'apprentissage ----------
let taxeCampus = "", taxeAnnee = 0;
async function renderTaxe() {
  if (!taxeCampus) taxeCampus = state.campuses[0]?.id || "";
  const ref = await api.get("/api/taxe/referentiels");
  if (!taxeAnnee) taxeAnnee = ref.calendrier.annee;
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="tx-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${taxeCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const d = await api.get(`/api/taxe?campusId=${taxeCampus}&annee=${taxeAnnee}`);
  const c = d.calendrier;
  const teinte = { critique: "overdue", eleve: "overdue", moyen: "warn", aucun: "done" };

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Le <b>solde</b> de la taxe — 13 % du total, soit 0,09 % de la masse salariale — est réparti par les <b>entreprises elles-mêmes</b> sur la plateforme SOLTéA.
      C'est la seule recette qui dépende directement de votre notoriété auprès d'elles.
      <b>Le guichet d'habilitation ferme quatre mois avant l'ouverture de la campagne</b>, et il n'y a pas de rattrapage.</p>
    </div>
    ${d.alertes.map((a) => `<div class="card card-pad" style="border-left:4px solid ${d.risque === "critique" || d.risque === "eleve" ? "var(--bad)" : "var(--warn,#C77700)"};margin-bottom:8px;"><b>${esc(a.message)}</b></div>`).join("")}
    <div class="kpis">
      <div class="k"><div class="v">${d.total.toLocaleString("fr-FR")} €</div><div class="l">reçu${d.totalDefinitif ? "" : " (partiel)"}</div></div>
      <div class="k"><span class="pill ${teinte[d.risque]}">${esc(d.etatLabel)}</span><div class="l" style="margin-top:6px;">habilitation ${taxeAnnee}</div></div>
      ${d.evolution?.pourcent != null ? `<div class="k"><div class="v">${d.evolution.pourcent > 0 ? "+" : ""}${d.evolution.pourcent} %</div><div class="l">vs ${taxeAnnee - 1}</div></div>` : ""}
    </div>

    <div class="section-title">Calendrier ${taxeAnnee}</div>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><tbody>
      <tr><td>Dépôt des demandes d'habilitation</td><td><b>${esc(c.habilitationDebut)} → ${esc(c.habilitationFin)}</b></td></tr>
      <tr><td>Période de répartition 1</td><td>${esc(c.periode1Debut)} → ${esc(c.periode1Fin)}</td></tr>
      <tr><td>Premier versement</td><td>à partir du ${esc(c.versement1)}</td></tr>
      <tr><td>Période de répartition 2</td><td>${esc(c.periode2Debut)} → ${esc(c.periode2Fin)}</td></tr>
      <tr><td>Second versement</td><td>à partir du ${esc(c.versement2)}</td></tr>
    </tbody></table></div>

    ${isAdmin() ? `<div class="section-title">Habilitation et versements</div>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div style="min-width:190px;"><label class="field-label">État</label><select class="txt" id="tx-etat">${Object.entries(ref.etats).map(([k, v]) => `<option value="${k}" ${d.etat === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
        <div><label class="field-label">Déposée le</label><input class="txt" id="tx-depot" type="date"></div>
        <input class="txt" id="tx-uai" placeholder="Code UAI" value="${esc(d.numeroUai || "")}" style="max-width:160px;">
      </div>
      <p class="hint muted">Sans code UAI, une entreprise ne vous trouvera pas sur la plateforme.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:8px;">
        <div><label class="field-label">Versement 1 (€)</label><input class="txt" id="tx-v1" type="number" step="0.01" value="${d.versements.find((v) => v.periode === 1)?.montant ?? ""}"></div>
        <div><label class="field-label">Versement 2 (€)</label><input class="txt" id="tx-v2" type="number" step="0.01" value="${d.versements.find((v) => v.periode === 2)?.montant ?? ""}"></div>
        <button class="btn-primary btn-sm" id="tx-save">Enregistrer</button><span class="sub" id="tx-msg"></span>
      </div>
    </div>` : ""}

    <div class="section-title">Estimer le solde d'une entreprise</div>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div><label class="field-label">Masse salariale annuelle (€)</label><input class="txt" id="tx-ms" type="number" step="1000" placeholder="1000000"></div>
        <button class="btn-ghost btn-sm" id="tx-sim">Calculer</button><span class="sub" id="tx-sim-res"></span>
      </div>
      <p class="hint muted">Argument de rendez-vous : un chiffre sans sa formule ne se discute pas.</p>
    </div>`;

  $("#tx-campus")?.addEventListener("change", () => { taxeCampus = $("#tx-campus").value; renderTaxe(); });
  $("#tx-save")?.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    const versements = [];
    if ($("#tx-v1").value) versements.push({ periode: 1, montant: Number($("#tx-v1").value) });
    if ($("#tx-v2").value) versements.push({ periode: 2, montant: Number($("#tx-v2").value) });
    const r = await api.put(`/api/taxe/${taxeAnnee}`, { campusId: taxeCampus,
      habilitation: { etat: $("#tx-etat").value, dateDepot: $("#tx-depot").value || null, numeroUai: $("#tx-uai").value.trim() }, versements });
    const m = $("#tx-msg");
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
    await renderTaxe();
  }));
  $("#tx-sim").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post("/api/taxe/simulation", { masseSalariale: Number($("#tx-ms").value) });
    $("#tx-sim-res").innerHTML = r.solde != null
      ? `Solde à répartir : <b>${r.solde.toLocaleString("fr-FR")} €</b> <span class="muted">(${esc(r.formule)})</span>`
      : "Masse salariale requise.";
  });
}

// ---------- Vue : Indicateurs publiés ----------
let indCampus = "", indAnnee = "";
async function renderIndicateursPublies() {
  if (!indCampus) indCampus = state.campuses[0]?.id || "";
  if (!indAnnee) indAnnee = String(new Date().getFullYear() - 1);
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="in-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${indCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [ref, p] = await Promise.all([api.get("/api/indicateurs/referentiels"), api.get(`/api/indicateurs?campusId=${indCampus}&annee=${indAnnee}`)]);

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Article L. 6111-8 : ces indicateurs sont rendus publics chaque année <b>lorsque les effectifs sont suffisants</b>.
      Sous ${ref.seuil} personnes, aucun taux n'est calculé — pas même pour information : un taux sur trois apprentis n'informe personne et <b>désigne</b> celui qui a échoué.</p>
    </div>
    <div style="display:flex;gap:10px;align-items:end;margin-bottom:12px;">
      <div><label class="field-label">Année</label><input class="txt" id="in-annee" type="number" min="2018" max="2100" value="${esc(indAnnee)}" style="width:120px;"></div>
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Indicateur</th><th style="text-align:center;">Valeur</th><th style="text-align:center;">Effectif</th><th>Source</th></tr></thead>
      <tbody>${p.lignes.map((l) => `<tr>
        <td>${esc(l.label)}</td>
        <td style="text-align:center;font-weight:700;">${l.publiable ? `${l.valeur} %` : "<span class=\"muted\">—</span>"}</td>
        <td style="text-align:center;color:var(--muted,#5B6B72);">${l.effectif ?? (l.millesime ? "millésime " + esc(l.millesime) : "—")}</td>
        <td class="sub muted">${esc(l.sourceLabel)}${l.motif ? `<br><b>${esc(l.motif)}</b>` : ""}</td></tr>`).join("")}</tbody></table></div>
    ${p.manquants.length ? `<div class="card card-pad" style="border-left:4px solid var(--warn,#C77700);margin-top:10px;">
      <b>Non publiable en l'état :</b><ul style="margin:6px 0 0;padding-left:18px;">${p.manquants.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}

    ${isAdmin() ? `<div class="section-title">Indicateurs déclarés</div>
    <p class="muted" style="margin-top:0;">L'insertion professionnelle et la valeur ajoutée viennent du dispositif national <b>InserJeunes</b> : elles ne se calculent pas ici et les estimer produirait un chiffre faux publié sous obligation légale.</p>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div><label class="field-label">Insertion (%)</label><input class="txt" id="in-ins" type="number" min="0" max="100" step="0.1" style="width:120px;"></div>
        <div><label class="field-label">Valeur ajoutée</label><input class="txt" id="in-va" type="number" step="0.1" style="width:120px;"></div>
        <div><label class="field-label">Poursuite d'études (%)</label><input class="txt" id="in-po" type="number" min="0" max="100" step="0.1" style="width:140px;"></div>
        <div><label class="field-label">Millésime</label><input class="txt" id="in-mil" placeholder="2025" style="width:110px;"></div>
        <input class="txt" id="in-src" placeholder="Source de la poursuite d'études" style="max-width:220px;">
        <button class="btn-primary btn-sm" id="in-save">Enregistrer</button><span class="sub" id="in-msg"></span>
      </div>
      <p class="hint muted">Un taux sans millésime ne veut rien dire : le lecteur ne peut ni le dater ni le vérifier.</p>
    </div>` : ""}
    <p class="sub muted" style="margin-top:12px;">${esc(p.reserve)}</p>`;

  $("#in-campus")?.addEventListener("change", () => { indCampus = $("#in-campus").value; renderIndicateursPublies(); });
  $("#in-annee").addEventListener("change", () => { indAnnee = $("#in-annee").value; renderIndicateursPublies(); });
  $("#in-save")?.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    const r = await api.put(`/api/indicateurs/${indAnnee}`, { campusId: indCampus,
      insertion: $("#in-ins").value || null, valeurAjoutee: $("#in-va").value || null,
      poursuite: $("#in-po").value || null, millesime: $("#in-mil").value.trim(), sourcePoursuite: $("#in-src").value.trim() });
    const m = $("#in-msg");
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
    await renderIndicateursPublies();
  }));
}

// ---------- Vue : Mobilité internationale ----------
let mobCampus = "";
async function renderMobilite() {
  if (!mobCampus) mobCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="mb-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${mobCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [ref, t, apprenants] = await Promise.all([
    api.get("/api/mobilite/referentiels"),
    api.get(`/api/mobilite?campusId=${mobCampus}`),
    api.get(`/api/learners?campusId=${mobCampus}`),
  ]);

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <p class="muted" style="margin:0;">Pendant une mobilité, le contrat d'apprentissage est <b>mis en veille</b> (art. L. 6222-42) : suspendu, avec les obligations de l'employeur.
      Ces périodes sont <b>neutralisées dans le calcul d'assiduité</b> — sans quoi six semaines à l'étranger passeraient pour six semaines d'absence.</p>
    </div>
    <div class="kpis">
      <div class="k"><div class="v">${t.total}</div><div class="l">mobilités</div></div>
      <div class="k"><div class="v">${t.enCours}</div><div class="l">en cours</div></div>
      <div class="k"><div class="v">${t.joursCumules}</div><div class="l">jours cumulés</div></div>
      <div class="k${t.sansConvention ? " k-bad" : ""}"><div class="v">${t.sansConvention}</div><div class="l">sans convention</div></div>
    </div>
    <div class="card"><div class="list">${(t.lignes || []).map((m) => `<div class="item">
      <span class="pill ${m.enCours ? "doing" : m.etat === "terminee" ? "done" : ""}">${esc(m.etatLabel)}</span>
      <div class="grow"><div class="ttl">${esc(m.apprenant || "")} <span class="muted" style="font-weight:400;">${esc(m.pays || "")} · ${esc(m.regimeLabel)}</span></div>
        <div class="sub muted">${esc(m.dateDebut || "")} → ${esc(m.dateFin || "")} (${m.duree} j) · ${esc(m.structureAccueil || "")}
        ${(m.alertes || []).map((a) => `<br><b style="color:${a.gravite === "bloquant" ? "var(--bad)" : "var(--warn,#C77700)"};">${esc(a.message)}</b>`).join("")}</div></div>
      <button class="btn-ghost btn-sm btn-danger mb-del" data-id="${m.id}">✕</button></div>`).join("") || '<p class="muted" style="padding:10px;">Aucune mobilité enregistrée.</p>'}</div></div>

    <div class="section-title">Déclarer une mobilité</div>
    <div class="card card-pad">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <div style="min-width:220px;"><label class="field-label">Apprenant</label><select class="txt" id="mb-app">${(apprenants || []).map((l) => `<option value="${l.id}">${esc(l.prenom)} ${esc(l.nom)}</option>`).join("")}</select></div>
        <div style="min-width:170px;"><label class="field-label">Régime</label><select class="txt" id="mb-regime">${Object.entries(ref.regimes).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>
        <div><label class="field-label">Du</label><input class="txt" id="mb-du" type="date"></div>
        <div><label class="field-label">Au</label><input class="txt" id="mb-au" type="date"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
        <input class="txt" id="mb-pays" placeholder="Pays d'accueil" style="max-width:180px;">
        <input class="txt grow" id="mb-struct" placeholder="Structure d'accueil" style="min-width:200px;">
        <input class="txt" id="mb-conv" placeholder="Référence de convention" style="max-width:200px;">
        <input class="txt" id="mb-ref" placeholder="Référent au CFA" style="max-width:180px;">
        <input class="txt" id="mb-couv" placeholder="Couverture sociale (hors UE)" style="max-width:220px;">
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;align-items:center;flex-wrap:wrap;">
        <div style="min-width:170px;"><label class="field-label">État</label><select class="txt" id="mb-etat">${Object.entries(ref.etats).map(([k, v]) => `<option value="${k}" ${k === "conventionnee" ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
        <label class="sub"><input type="checkbox" id="mb-veille" checked> contrat mis en veille</label>
        <button class="btn-primary btn-sm" id="mb-add">Enregistrer</button><span class="sub" id="mb-msg"></span>
      </div>
      <p class="hint muted">Hors Union européenne, la mise en veille est la règle et la <b>couverture sociale ne découle pas du contrat français</b> : elle se vérifie séparément.</p>
    </div>`;

  $("#mb-campus")?.addEventListener("change", () => { mobCampus = $("#mb-campus").value; renderMobilite(); });
  $("#mb-add").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post(`/api/learners/${$("#mb-app").value}/mobilites`, {
      regime: $("#mb-regime").value, pays: $("#mb-pays").value.trim(), structureAccueil: $("#mb-struct").value.trim(),
      dateDebut: $("#mb-du").value, dateFin: $("#mb-au").value, etat: $("#mb-etat").value,
      convention: $("#mb-conv").value.trim(), referentCfa: $("#mb-ref").value.trim(),
      couvertureSociale: $("#mb-couv").value.trim(), miseEnVeille: $("#mb-veille").checked,
    });
    const m = $("#mb-msg");
    if (r?.error) { m.textContent = r.error; m.style.color = "var(--bad)"; return; }
    if (r.warnings?.length) { m.textContent = r.warnings.join(" · "); m.style.color = "var(--warn,#C77700)"; }
    await renderMobilite();
  });
  $$(".mb-del").forEach((b) => b.addEventListener("click", (ev) => guard(ev.currentTarget, async () => {
    if (!confirm("Supprimer cette mobilité ? Les périodes cesseront d'être neutralisées dans l'assiduité.")) return;
    await api.del(`/api/mobilites/${b.dataset.id}`); await renderMobilite();
  })));
}

// ---------- Vue : Prêt à exploiter ? ----------
let demCampus = "";
async function renderDemarrage() {
  if (!demCampus) demCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="dm-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${demCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Contrôle en cours…</p>`;
  const r = await api.get(`/api/demarrage?campusId=${demCampus}`);
  const teinte = { bloquant: "var(--bad)", important: "var(--warn,#C77700)", conseille: "var(--line,#e3ded3)" };
  const pastille = { bloquant: "overdue", important: "warn", conseille: "" };

  // Regroupement par écran : c'est ainsi qu'on corrige, pas point par point.
  const groupes = new Map();
  for (const p of r.points) {
    if (!groupes.has(p.ou)) groupes.set(p.ou, []);
    groupes.get(p.ou).push(p);
  }

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;border-left:4px solid ${r.exploitable ? "var(--good)" : "var(--bad)"};">
      <div class="ttl" style="font-size:15px;">${r.exploitable
        ? "Aucun obstacle technique connu ne s'oppose à l'exploitation."
        : `${r.bloquants} point(s) bloquant(s) avant de pouvoir exploiter.`}</div>
      <p class="muted" style="margin:6px 0 0;">${esc(r.reserve)}</p>
    </div>
    <div class="kpis">
      <div class="k${r.bloquants ? " k-bad" : ""}"><div class="v">${r.bloquants}</div><div class="l">bloquants</div></div>
      <div class="k"><div class="v">${r.importants}</div><div class="l">importants</div></div>
      <div class="k"><div class="v">${r.conseilles}</div><div class="l">conseillés</div></div>
    </div>
    ${[...groupes].map(([ecran, points]) => `
      <div class="section-title">${esc(ecran)}</div>
      <div class="card"><div class="list">${points.map((p) => `<div class="item" style="border-left:3px solid ${teinte[p.niveau]};">
        <span class="pill ${pastille[p.niveau]}">${p.niveau}</span>
        <div class="grow"><div class="ttl">${esc(p.quoi)}</div>
          <div class="sub muted">Sans cela : <b>${esc(p.empeche)}</b></div></div></div>`).join("")}</div></div>`).join("")
      || '<div class="card card-pad"><p class="muted" style="margin:0;">Rien à signaler sur ce campus.</p></div>'}`;

  $("#dm-campus")?.addEventListener("change", () => { demCampus = $("#dm-campus").value; renderDemarrage(); });
}

// ---------- Vue : Licence & abonnement ----------
async function renderLicence() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const l = await api.get("/api/licence");
  state.licence = l;
  renderLicenceBanner();

  const barre = (q) => {
    if (q.plafond == null) return `<div class="sub muted">${q.utilise} — sans plafond</div>`;
    const teinte = q.depasse ? "var(--bad)" : q.proche ? "var(--warn, #C77700)" : "var(--good)";
    return `<div class="sub muted" style="margin-bottom:4px;">${q.utilise} / ${q.plafond} (${q.pourcent} %)</div>
      <div style="height:7px;border-radius:4px;background:var(--line,#e3ded3);overflow:hidden;">
        <div style="height:100%;width:${Math.min(100, q.pourcent)}%;background:${teinte};"></div></div>`;
  };

  view.innerHTML = `
    <div class="card card-pad" style="margin-top:0;">
      <div class="ttl" style="font-size:15px;">Plan ${esc(l.planLabel)}${l.client ? ` — ${esc(l.client)}` : ""}</div>
      <p class="muted" style="margin:6px 0 0;">
        ${l.validUntil ? `Licence valable jusqu'au <b>${esc(l.validUntil)}</b>${l.joursRestants != null ? ` (${l.joursRestants} jour(s))` : ""}.` : "Licence sans échéance."}
        ${l.lectureSeule ? " L'instance est en <b>lecture seule</b>." : ""}
      </p>
      <p class="muted" style="margin:8px 0 0;">
        Quel que soit l'état de la licence, la <b>consultation</b> et l'<b>export</b> de vos données restent ouverts.
        Émargements scellés, contrats, factures et bulletins sont les pièces dont vous répondez devant un contrôleur :
        ils ne vous sont jamais retenus.
      </p>
    </div>

    <div class="section-title">Consommation</div>
    <div class="card card-pad">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;">
        ${(l.quotas || []).map((q) => `<div><div class="ttl" style="text-transform:capitalize;">${esc(q.label)}</div>${barre(q)}</div>`).join("")}
      </div>
    </div>

    <div class="section-title">Modules inclus</div>
    <div class="card"><div class="list">
      ${(l.modulesDetail || []).map((m) => `<div class="item"><span class="pill done">inclus</span><div class="grow"><div class="ttl" style="font-weight:500;text-transform:capitalize;">${esc(m.id)}</div><div class="sub muted">${esc(m.label)}</div></div></div>`).join("")}
    </div></div>

    <div class="section-title">Autres plans</div>
    <div class="card"><div class="list">
      ${Object.entries(l.plans || {}).map(([id, p]) => `<div class="item"><div class="grow"><div class="ttl">${esc(p.label)}${id === l.plan ? ' <span class="pill">plan actuel</span>' : ""}</div><div class="sub muted">${esc(p.cible)}</div></div></div>`).join("")}
    </div></div>
    <p class="sub muted" style="margin-top:12px;">Le changement de plan se fait avec Ruliora : il modifie l'abonnement et les plafonds de cette instance.</p>`;
}

// ---------- Vue : Déclarations annuelles (SIFA, BPF) ----------
// PARTI PRIS — l'écran prépare la déclaration et NOMME ce qui bloque. Il ne
// produit jamais un fichier « complet » à partir de données incomplètes : un
// fichier SIFA rejeté se découvre en fin de campagne, quand il est trop tard.
let decCampus = "";
let decAnnee = 0;
let decExercice = null;
async function renderDeclarations() {
  if (!decCampus) decCampus = state.campuses[0]?.id || "";
  // SIFA porte sur l'année civile arrêtée au 31 décembre ; en début d'année, la
  // campagne en cours est celle de l'année précédente.
  if (!decAnnee) { const n = new Date(); decAnnee = n.getMonth() >= 11 ? n.getFullYear() : n.getFullYear() - 1; }
  // Le BPF porte sur l'EXERCICE COMPTABLE — par défaut l'exercice civil clos.
  if (!decExercice) decExercice = { from: `${decAnnee}-01-01`, to: `${decAnnee}-12-31` };

  const view = $("#view");
  $("#topbar-actions").innerHTML = isAdmin() && state.campuses.length > 1
    ? `<select class="txt" id="dec-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${decCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [sifa, bpf] = await Promise.all([
    api.get(`/api/declarations/sifa?campusId=${decCampus}&annee=${decAnnee}`),
    api.get(`/api/declarations/bpf?campusId=${decCampus}&from=${decExercice.from}&to=${decExercice.to}`),
  ]);
  const eur = (v) => Number(v || 0).toLocaleString("fr-FR") + " €";

  const anomalies = sifa.anomalies || [];
  const sifaBloc = anomalies.length
    ? `<div class="card card-pad" style="border-left:4px solid var(--bad);">
        <div class="ttl" style="margin-bottom:6px;">${anomalies.length} ligne(s) rejetée(s) en l'état</div>
        <p class="muted" style="margin-top:0;">La plateforme rejette toute ligne dont une donnée obligatoire manque — l'INE en premier lieu. Ces apprentis sont à compléter dans leur fiche avant dépôt.</p>
        <div class="list">${anomalies.slice(0, 40).map((a) => `<div class="item"><div class="grow"><div class="ttl">${esc(a.apprenant)}</div><div class="sub muted">manque : ${a.manquants.map(esc).join(", ")}</div></div>
          <button class="btn-ghost btn-sm dec-fiche" data-id="${esc(a.learnerId)}">Ouvrir la fiche</button></div>`).join("")}
          ${anomalies.length > 40 ? `<div class="item"><div class="sub muted">… et ${anomalies.length - 40} autre(s).</div></div>` : ""}</div>
      </div>`
    : sifa.total
      ? `<div class="card card-pad" style="border-left:4px solid var(--good);"><div class="ttl">Les ${sifa.total} ligne(s) sont complètes.</div>
         <p class="muted" style="margin-bottom:0;">Le fichier peut être exporté, puis déposé sur la plateforme officielle.</p></div>`
      : `<div class="card card-pad"><p class="muted" style="margin:0;">Aucun apprenti en formation au ${esc(sifa.dateObservation || "31 décembre")} sur ce campus. Il n'y a pas de fichier à déposer — vérifier que les inscriptions de l'année sont bien saisies.</p></div>`;

  const apercu = (sifa.apercu || []).length
    ? `<div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table">
        <thead><tr>${(sifa.colonnes || []).slice(0, 8).map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${sifa.apercu.map((l) => `<tr>${(sifa.colonnes || []).slice(0, 8).map((c) => `<td>${esc(l[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>
        <div class="sub muted" style="padding:8px 12px;">Aperçu des ${Math.min(10, sifa.total)} premières lignes sur ${sifa.total} — l'export contient les ${(sifa.colonnes || []).length} colonnes.</div></div>`
    : "";

  const fin = bpf.financeurs || {};
  const produits = bpf.cadreC?.produits || {};

  view.innerHTML = `
    <div class="section-title" style="margin-top:0;">SIFA — enquête annuelle des CFA</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Une ligne par apprenti présent au <b>31 décembre</b>. Un contrat rompu mais l'apprenti maintenu en formation compte : il est bien au CFA à cette date.</p>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div><label class="field-label">Année d'observation</label><input class="txt" id="dec-annee" type="number" min="2020" max="2100" value="${decAnnee}" style="width:120px;"></div>
        <button class="btn-ghost btn-sm" id="dec-sifa-csv">Exporter le fichier (CSV)</button>
        <span class="sub muted">${sifa.total || 0} apprenti(s) au ${esc(sifa.dateObservation || "")}</span>
      </div>
      <div id="dec-sifa-msg" class="sub" style="margin-top:8px;"></div>
    </div>
    ${sifaBloc}
    ${apercu}

    <div class="section-title">BPF — bilan pédagogique et financier</div>
    <div class="card card-pad">
      <p class="muted" style="margin-top:0;">Déposé auprès de la DREETS avant le <b>30 avril</b>. Il porte sur l'<b>exercice comptable</b> — pas sur l'année scolaire — et ses montants sont hors taxes.</p>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div><label class="field-label">Début d'exercice</label><input class="txt" id="dec-from" type="date" value="${esc(decExercice.from)}"></div>
        <div><label class="field-label">Fin d'exercice</label><input class="txt" id="dec-to" type="date" value="${esc(decExercice.to)}"></div>
        <button class="btn-ghost btn-sm" id="dec-bpf-open">Ouvrir le bilan imprimable</button>
      </div>
    </div>
    ${(bpf.manquantes || []).length ? `<div class="card card-pad" style="border-left:4px solid var(--bad);margin-top:10px;">
      <div class="ttl" style="margin-bottom:6px;">À compléter avant dépôt</div>
      <ul class="muted" style="margin:0;padding-left:18px;">${bpf.manquantes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
    <div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table">
      <thead><tr><th>Cadre C — origine des produits</th><th style="text-align:right;">Montant HT</th></tr></thead>
      <tbody>${Object.entries(fin).map(([k, label]) => `<tr><td>${esc(label)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${eur(produits[k])}</td></tr>`).join("")}
        <tr><td><b>Total des produits</b></td><td style="text-align:right;font-variant-numeric:tabular-nums;"><b>${eur(bpf.cadreC?.total)}</b></td></tr></tbody></table></div>
    <div class="card card-pad" style="margin-top:10px;">
      <div class="ttl">Cadre B — bilan pédagogique</div>
      <p class="muted" style="margin-bottom:0;"><b>${(bpf.cadreB?.heuresStagiaires || 0).toLocaleString("fr-FR")}</b> heures-stagiaires, <b>${bpf.cadreB?.stagiaires || 0}</b> stagiaire(s).
      Les heures ne sont comptées que sur les feuilles d'émargement <b>closes</b> : une feuille ouverte n'est pas une heure justifiable en contrôle.</p>
    </div>
    <p class="sub muted" style="margin-top:14px;">Campus Manager prépare ces déclarations et signale ce qui manque ; le dépôt reste à effectuer sur les portails officiels (SIFA, « Mon Activité Formation »). Formats et nomenclatures à revérifier à chaque campagne.</p>`;

  $("#dec-campus")?.addEventListener("change", () => { decCampus = $("#dec-campus").value; renderDeclarations(); });
  $("#dec-annee").addEventListener("change", () => { decAnnee = Number($("#dec-annee").value) || decAnnee; renderDeclarations(); });
  const majExercice = () => { decExercice = { from: $("#dec-from").value, to: $("#dec-to").value }; renderDeclarations(); };
  $("#dec-from").addEventListener("change", majExercice);
  $("#dec-to").addEventListener("change", majExercice);
  $$(".dec-fiche").forEach((b) => b.addEventListener("click", () => openLearnerFiche(b.dataset.id)));
  $("#dec-bpf-open").onclick = () => window.open(`/api/declarations/bpf?campusId=${decCampus}&from=${decExercice.from}&to=${decExercice.to}&format=html`, "_blank");
  $("#dec-sifa-csv").onclick = () => {
    const msg = $("#dec-sifa-msg");
    if (!sifa.total) { msg.textContent = "Aucun apprenti en périmètre : il n'y a pas de fichier à produire."; msg.style.color = "var(--bad)"; return; }
    // Un export forcé reste possible, mais jamais par défaut et jamais sans que
    // l'utilisateur sache qu'il dépose un fichier que la plateforme rejettera.
    if (anomalies.length && !confirm(`${anomalies.length} ligne(s) sont incomplètes et seront rejetées au dépôt.\n\nExporter quand même (pour travail interne) ?`)) return;
    location.href = `/api/declarations/sifa?campusId=${decCampus}&annee=${decAnnee}&format=csv${anomalies.length ? "&force=1" : ""}`;
  };
}

// ---------- Vue : Facturation ----------
const INV_BADGE = { brouillon: ["Brouillon", ""], emise: ["Émise", "doing"], payee: ["Payée", "done"], annulee: ["Annulée", "overdue"] };
let facCampus = "";
async function renderFacturation() {
  if (!facCampus) facCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="fac-compare">Comparateur de bascule</button>
    <button class="btn-primary btn-sm" id="fac-add">${I.plus}<span>Financement</span></button>`;
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const [fundings, invoices] = await Promise.all([
    api.get(`/api/fundings?campusId=${facCampus}`),
    api.get(`/api/invoices?campusId=${facCampus}`),
  ]);
  const eur = (v) => (v == null ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
  const aFacturer = (fundings || []).reduce((s, f) => s + (f.solde?.resteAFacturer || 0), 0);
  const aEncaisser = (fundings || []).reduce((s, f) => s + (f.solde?.resteAEncaisser || 0), 0);
  const ligneF = (f) => `<div class="item">
    <div class="grow"><div class="ttl">${esc(f.financeur || "Financeur")} <span class="muted" style="font-weight:400;">${esc(f.learnerName || "")}</span>
      <span class="pill">${esc(f.modeLabel || f.mode)}</span>${f.arret ? ' <span class="pill overdue">arrêté</span>' : ""}</div>
      <div class="sub muted">${esc(f.dateDebut || "?")} → ${esc(f.dateFin || "?")} · ${eur(f.montant)}${f.prorata && f.prorata.ratio < 1 ? ` · dû au prorata : ${eur(f.prorata.montantDu)} (${f.prorata.joursExecutes}/${f.prorata.joursTotal} j)` : ""}
        · reste à facturer ${eur(f.solde?.resteAFacturer)}</div></div>
    <button class="btn-ghost btn-sm fac-open" data-id="${f.id}">Ouvrir</button></div>`;
  const ligneI = (i) => {
    const [lbl, tone] = INV_BADGE[i.status] || [i.status, ""];
    return `<div class="item"><span class="pill ${tone}">${lbl}</span>
      <div class="grow"><div class="ttl">${esc(i.numero || "sans numéro")} <span class="muted" style="font-weight:400;">${esc(i.learnerName || "")}</span></div>
        <div class="sub muted">${esc(i.date)}${i.periodeDebut ? ` · période ${esc(i.periodeDebut)} → ${esc(i.periodeFin)}` : ""} · ${eur(i.totalTTC)}${i.regle ? ` · réglé ${eur(i.regle)}` : ""}</div></div>
      ${i.status === "brouillon" ? `<button class="btn-primary btn-sm inv-issue" data-id="${i.id}">Émettre</button>` : ""}
      ${i.status === "emise" ? `<button class="btn-ghost btn-sm inv-pay" data-id="${i.id}" data-ttc="${i.totalTTC}">Régler</button>
        <button class="btn-ghost btn-sm inv-credit" data-id="${i.id}">Avoir</button>` : ""}</div>`;
  };
  view.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      ${isAdmin() ? `<select class="txt" id="fac-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${facCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}
    </div>
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k"><div class="v">${(fundings || []).length}</div><div class="l">dossiers de financement</div></div>
      <div class="k${aFacturer > 0 ? " k-bad" : ""}"><div class="v">${eur(aFacturer)}</div><div class="l">reste à facturer</div></div>
      <div class="k${aEncaisser > 0 ? " k-bad" : ""}"><div class="v">${eur(aEncaisser)}</div><div class="l">reste à encaisser</div></div>
    </div>
    <div class="section-title" style="margin-top:0;">Dossiers de financement</div>
    ${(fundings || []).length ? `<div class="list">${fundings.map(ligneF).join("")}</div>` : `<p class="empty">Aucun dossier — crée le premier avec « + Financement ».</p>`}
    <div class="section-title">Factures et avoirs</div>
    ${(invoices || []).length ? `<div class="list">${invoices.map(ligneI).join("")}</div>` : `<p class="muted" style="padding:8px;">Aucune pièce émise.</p>`}
    <p class="hint muted" style="margin-top:12px;">Le montant dû est <b>calculé</b>, jamais saisi : en alternance au prorata des jours de contrat exécutés (l'assiduité n'entre pas dans le NPEC), en conventionné aux heures réellement réalisées. Une facture émise est immuable — elle se corrige par un avoir.</p>`;
  $("#fac-campus")?.addEventListener("change", () => { facCampus = $("#fac-campus").value; renderFacturation(); });
  $("#fac-add").addEventListener("click", () => openFundingForm());
  $("#fac-compare").addEventListener("click", () => openComparateur());
  $$(".fac-open").forEach((b) => b.addEventListener("click", () => openFundingFiche(b.dataset.id)));
  $$(".inv-issue").forEach((b) => b.addEventListener("click", () => guard(b, async () => {
    if (!confirm("Émettre cette facture ?\n\nElle deviendra IMMUABLE : une erreur ne se corrigera plus que par un avoir.")) return;
    const r = await api.post(`/api/invoices/${b.dataset.id}/issue`, {});
    if (r.error) { alert(r.error); return; }
    await renderFacturation();
  })));
  $$(".inv-credit").forEach((b) => b.addEventListener("click", () => guard(b, async () => {
    const motif = prompt("Motif de l'avoir (obligatoire — il figure sur la pièce) :");
    if (!motif) return;
    const r = await api.post(`/api/invoices/${b.dataset.id}/credit`, { motif });
    if (r.error) { alert(r.error); return; }
    await renderFacturation();
  })));
  $$(".inv-pay").forEach((b) => b.addEventListener("click", () => guard(b, async () => {
    const montant = prompt("Montant du règlement (€) :", b.dataset.ttc);
    if (!montant) return;
    const r = await api.post(`/api/invoices/${b.dataset.id}/payments`, { montant, moyen: "virement" });
    if (r.error) { alert(r.error); return; }
    await renderFacturation();
  })));
}

async function openFundingForm() {
  const [learners, modes] = await Promise.all([api.get(`/api/learners?campusId=${facCampus}`), api.get("/api/fundings/modes")]);
  openModal("Nouveau dossier de financement", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Apprenant</label><select class="txt" id="ff-learner"><option value="">—</option>${(learners || []).map((l) => `<option value="${l.id}">${esc(l.prenom)} ${esc(l.nom)}</option>`).join("")}</select></div>
      <div class="field"><label class="field-label">Financeur *</label><input class="txt" id="ff-financeur" placeholder="OPCO, entreprise, particulier…"></div>
    </div>
    <div class="field"><label class="field-label">Mode de financement *</label>
      <select class="txt" id="ff-mode">${Object.entries(modes || {}).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join("")}</select>
      <div class="sub muted" id="ff-base"></div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Montant total (€)</label><input class="txt" id="ff-montant" type="number" step="0.01"></div>
      <div class="field"><label class="field-label">Prix horaire (€) <span class="muted">mode heures</span></label><input class="txt" id="ff-ph" type="number" step="0.01"></div>
      <div class="field"><label class="field-label">Cadence</label><select class="txt" id="ff-cadence"><option value="mensuelle">Mensuelle</option><option value="trimestrielle">Trimestrielle</option><option value="annuelle">Annuelle</option></select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label class="field-label">Début *</label><input class="txt" id="ff-debut" type="date"></div>
      <div class="field"><label class="field-label">Fin *</label><input class="txt" id="ff-fin" type="date"></div>
    </div>
    <div class="actions"><button class="btn-primary" id="ff-save">Créer et générer l'échéancier</button> <span class="status" id="ff-msg"></span></div>`);
  const maj = () => { $("#ff-base").textContent = (modes || {})[$("#ff-mode").value]?.base || ""; };
  $("#ff-mode").addEventListener("change", maj); maj();
  $("#ff-save").onclick = () => guard($("#ff-save"), async () => {
    const body = { campusId: facCampus, learnerId: $("#ff-learner").value || null, financeur: $("#ff-financeur").value.trim(),
      mode: $("#ff-mode").value, montant: $("#ff-montant").value, prixHoraire: $("#ff-ph").value,
      cadence: $("#ff-cadence").value, dateDebut: $("#ff-debut").value, dateFin: $("#ff-fin").value };
    const r = await api.post("/api/fundings", body);
    if (r.error) { $("#ff-msg").textContent = r.error; return; }
    document.querySelector(".modal-bg")?.remove();
    await renderFacturation();
  });
}

async function openFundingFiche(fid) {
  const f = await api.get(`/api/fundings/${fid}`);
  if (!f || f.error) { alert(f?.error || "Dossier introuvable"); return; }
  const eur = (v) => (v == null ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
  const dejaFacturees = new Set((f.invoices || []).filter((i) => i.status !== "annulee").map((i) => i.periodeDebut));
  openModal(`Financement — ${esc(f.financeur || "")}`, `
    <div class="sub muted" style="margin-top:0;">${esc(f.modeLabel)} · ${esc(f.dateDebut)} → ${esc(f.dateFin)} · ${eur(f.montant)}${f.arret ? ` · arrêté le ${esc(f.arret)}` : ""}</div>
    ${f.prorata && f.prorata.ratio < 1 ? `<div class="card card-pad" style="border-left:4px solid var(--warn);margin:10px 0;">
      <b>Régularisation au prorata</b><div class="sub muted">${f.prorata.joursExecutes} jours exécutés sur ${f.prorata.joursTotal} → <b>${eur(f.prorata.montantDu)}</b> dus au lieu de ${eur(f.prorata.montantInitial)}.</div></div>` : ""}
    <div class="kpis" style="margin:10px 0;">
      <div class="k"><div class="v">${eur(f.solde?.facture)}</div><div class="l">facturé</div></div>
      <div class="k"><div class="v">${eur(f.solde?.encaisse)}</div><div class="l">encaissé</div></div>
      <div class="k"><div class="v">${eur(f.solde?.resteAFacturer)}</div><div class="l">reste à facturer</div></div>
    </div>
    <div class="section-title">Échéancier</div>
    <div class="list">${(f.echeances || []).map((e) => `<div class="item">
      <span class="pill">${esc(e.debut)} → ${esc(e.fin)}</span>
      <div class="grow"><div class="ttl">${eur(e.montant)}</div><div class="sub muted">${e.jours} jour(s)</div></div>
      ${dejaFacturees.has(e.debut) ? '<span class="pill done">facturée</span>' : `<button class="btn-ghost btn-sm ech-fac" data-debut="${e.debut}" data-fin="${e.fin}">Facturer</button>`}
    </div>`).join("") || '<p class="muted" style="padding:8px;">Aucune échéance.</p>'}</div>
    ${f.arret ? "" : `<div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm btn-danger" id="ff-arret">Arrêter (rupture)</button></div>`}`);
  $$(".ech-fac").forEach((b) => b.addEventListener("click", () => guard(b, async () => {
    const r = await api.post(`/api/fundings/${fid}/invoices`, { periodeDebut: b.dataset.debut, periodeFin: b.dataset.fin });
    if (r.error) { alert(r.error); return; }
    alert(`Facture préparée : ${eur(r.totalTTC)}\n${r.calcul.base}${r.calcul.jours != null ? ` — ${r.calcul.jours}/${r.calcul.joursPeriode} jours` : ""}${r.calcul.heures != null ? ` — ${r.calcul.heures} h` : ""}\n\nElle reste en brouillon jusqu'à son émission.`);
    document.querySelector(".modal-bg")?.remove();
    await renderFacturation();
  })));
  $("#ff-arret")?.addEventListener("click", () => guard($("#ff-arret"), async () => {
    const date = prompt("Date d'arrêt (AAAA-MM-JJ) — le dû sera recalculé au prorata des jours exécutés :", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const r = await api.patch(`/api/fundings/${fid}`, { arret: date, motifArret: "rupture de contrat" });
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove();
    await openFundingFiche(fid);
  }));
}

// Comparateur de bascule : c'est lui qui autorise l'abandon de l'ancien système.
function openComparateur() {
  openModal("Comparateur de bascule", `
    <p class="sub muted" style="margin-top:0;">Colle les montants facturés par le système sortant, mois par mois. Le comparateur confronte chaque période à ce que Campus Manager calcule. <b>Un seul écart inexpliqué suffit à reporter la bascule</b> : il se répétera sur chaque dossier.</p>
    <div class="field"><label class="field-label">Référence (une ligne par mois : <code>2026-09 ; 660.00</code>)</label>
      <textarea id="cp-ref" rows="8" placeholder="2026-09 ; 660.00&#10;2026-10 ; 680.00"></textarea></div>
    <div class="actions"><button class="btn-primary" id="cp-run">Comparer</button></div>
    <div id="cp-out" style="margin-top:12px;"></div>`);
  $("#cp-run").onclick = () => guard($("#cp-run"), async () => {
    const reference = $("#cp-ref").value.split(/\n/).map((l) => {
      const [periode, montant] = l.split(/[;,\t]/);
      return periode && montant ? { periode: periode.trim(), montant: Number(String(montant).replace(",", ".").trim()) } : null;
    }).filter(Boolean);
    if (!reference.length) { $("#cp-out").innerHTML = `<p class="sub" style="color:var(--bad);">Aucune ligne exploitable.</p>`; return; }
    const r = await api.post("/api/billing/compare", { campusId: facCampus, reference });
    if (r.error) { $("#cp-out").innerHTML = `<p class="sub" style="color:var(--bad);">${esc(r.error)}</p>`; return; }
    const eur = (v) => (v == null ? "—" : Number(v).toFixed(2).replace(".", ",") + " €");
    $("#cp-out").innerHTML = `
      <div class="card card-pad" style="border-left:4px solid var(--${r.basculeAutorisee ? "good" : "bad"});margin-bottom:10px;">
        <b>${r.basculeAutorisee ? "✓ Concordance complète — bascule envisageable" : `${r.ecarts} écart(s) sur ${r.total} période(s) — bascule à reporter`}</b>
        ${r.ecartTotal ? `<div class="sub muted">Écart cumulé : ${eur(r.ecartTotal)}</div>` : ""}</div>
      <div class="list">${r.lignes.map((l) => `<div class="item"><span class="pill ${l.conforme ? "done" : "overdue"}">${esc(l.periode)}</span>
        <div class="grow"><div class="ttl">${eur(l.calcule)} <span class="muted" style="font-weight:400;">vs ${eur(l.reference)}</span></div>
        <div class="sub muted">${l.conforme ? "conforme" : esc(l.motif || "")}${l.ecart ? ` · écart ${eur(l.ecart)}` : ""}</div></div></div>`).join("")}</div>`;
  });
}

// ---------- Vue : Émargement (preuve de réalisation) ----------
const ATT_LABEL = { present: "Présent", absent: "Absent", retard: "Retard", excuse: "Excusé" };
const ATT_TONE = { present: "done", absent: "overdue", retard: "warn", excuse: "" };
let emCampus = "", emFrom = "", emTo = "";
async function renderEmargement() {
  const view = $("#view");
  if (!emFrom) {
    const d = new Date(); const start = new Date(d.getTime() - 13 * 864e5);
    emFrom = start.toISOString().slice(0, 10); emTo = d.toISOString().slice(0, 10);
  }
  if (!emCampus) emCampus = state.campuses[0]?.id || "";
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="em-proof">Attestation d'assiduité</button>`;
  $("#em-proof").addEventListener("click", () => {
    if (!emCampus) { alert("Choisis un campus."); return; }
    window.open(`/api/attendance/proof?campusId=${emCampus}&from=${emFrom}&to=${emTo}`, "_blank");
  });
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const qs = new URLSearchParams({ from: emFrom, to: emTo });
  if (emCampus) qs.set("campusId", emCampus);
  const [sheets, sessions, chain, anchors] = await Promise.all([
    api.get("/api/attendance/sheets?" + qs.toString()),
    api.get(`/api/sessions?${emCampus ? "campusId=" + emCampus + "&" : ""}from=${emFrom}&to=${emTo}`),
    emCampus ? api.get(`/api/attendance/verify?campusId=${emCampus}`) : Promise.resolve(null),
    emCampus ? api.get(`/api/attendance/anchors?campusId=${emCampus}`) : Promise.resolve([]),
  ]);
  const bySession = new Map((sheets || []).map((s) => [s.sessionId, s]));
  const rows = (sessions || []).filter((s) => s.kind !== "reunion").sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.start || "").localeCompare(a.start || ""));
  const openCount = (sheets || []).filter((s) => s.status === "open").length;
  const lockedCount = (sheets || []).filter((s) => s.status === "locked").length;
  const todo = rows.filter((s) => !bySession.has(s.id)).length;
  const line = (s) => {
    const sh = bySession.get(s.id);
    const st = sh?.stats;
    return `<div class="item">
      <span class="pill">${esc(s.date)}</span>
      <div class="grow"><div class="ttl">${esc(s.className || s.classId || "—")} <span class="muted" style="font-weight:400;">${esc(s.start)}–${esc(s.end)}${s.moduleName ? " · " + esc(s.moduleName) : ""}${s.teacherName ? " · " + esc(s.teacherName) : ""}</span></div>
        <div class="sub muted">${sh ? (sh.status === "locked" ? `Close · ${st?.present ?? 0} présents / ${st?.total ?? 0} · assiduité ${st?.attendanceRate ?? "—"} %` : `Ouverte · ${st?.present ?? 0}/${st?.total ?? 0} pointés`) : "Appel non fait"}</div></div>
      ${sh ? `<span class="pill ${sh.status === "locked" ? "done" : "doing"}">${sh.status === "locked" ? "🔒 close" : "ouverte"}</span>` : ""}
      <button class="btn-${sh ? "ghost" : "primary"} btn-sm em-open" data-sid="${s.id}" data-sheet="${sh?.id || ""}">${sh ? "Ouvrir" : "Faire l'appel"}</button>
    </div>`;
  };
  view.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <select class="txt" id="em-campus" style="max-width:220px;">${state.campuses.map((c) => `<option value="${c.id}" ${emCampus === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <input class="txt" id="em-from" type="date" value="${emFrom}" style="max-width:160px;">
      <input class="txt" id="em-to" type="date" value="${emTo}" style="max-width:160px;">
    </div>
    <div class="kpis" style="margin-bottom:12px;">
      <div class="k${todo ? " k-bad" : ""}"><div class="v">${todo}</div><div class="l">appels à faire</div></div>
      <div class="k"><div class="v">${openCount}</div><div class="l">feuilles ouvertes</div></div>
      <div class="k"><div class="v">${lockedCount}</div><div class="l">closes (scellées)</div></div>
    </div>
    ${chain ? `<div class="card card-pad" style="margin-bottom:12px;border-left:4px solid var(--${chain.ok ? "good" : "bad"});">
      <b>${chain.ok ? "✓ Chaîne de preuve intègre" : "⚠ Chaîne rompue"}</b> — ${chain.ok ? `${chain.count} feuille(s) close(s), chaînées par empreinte SHA-256. Toute modification postérieure serait détectée.` : esc(chain.reason || "incohérence détectée")}
      ${chain.lastHash ? `<div class="sub muted" style="margin-top:4px;word-break:break-all;font-family:ui-monospace,monospace;font-size:11px;">tête : ${esc(chain.lastHash)}</div>` : ""}
      <div class="sub muted" style="margin-top:6px;">
        ${anchors?.length ? `Dernier ancrage externe : ${new Date(anchors[0].at).toLocaleString("fr-FR")}${anchors[0].sentTo ? ` (envoyé à ${esc(anchors[0].sentTo)})` : " — non transmis, destinataire non configuré"}. L'empreinte publiée hors de ce système rend une falsification détectable même avec un accès serveur.`
          : `Aucun ancrage externe publié : la chaîne n'est vérifiable qu'en interne. Publie l'empreinte pour lui donner sa pleine valeur probante.`}
        ${isAdmin() ? ` <button class="btn-ghost btn-sm" id="em-anchor" style="margin-left:6px;">Ancrer maintenant</button>` : ""}
      </div>
    </div>` : ""}
    ${rows.length ? `<div class="list">${rows.map(line).join("")}</div>` : `<p class="empty">Aucune séance sur cette période — vérifie l'emploi du temps.</p>`}`;
  $("#em-anchor")?.addEventListener("click", () => guard($("#em-anchor"), async () => {
    const r = await api.post("/api/attendance/anchors");
    if (r.error) { alert(r.error); return; }
    const mine = (r.results || []).find((x) => x.campusId === emCampus);
    alert(mine ? `Empreinte publiée : ${mine.count} feuille(s) close(s).\n${mine.sent ? "Email d'ancrage envoyé à " + r.sentTo : "⚠ Email NON envoyé — configure un destinataire (ALERT_TO ou board pack) pour que l'ancrage ait une valeur externe."}` : "Aucune feuille close à ancrer.");
    await renderEmargement();
  }));
  $("#em-campus").addEventListener("change", () => { emCampus = $("#em-campus").value; renderEmargement(); });
  $("#em-from").addEventListener("change", () => { emFrom = $("#em-from").value; renderEmargement(); });
  $("#em-to").addEventListener("change", () => { emTo = $("#em-to").value; renderEmargement(); });
  $$(".em-open").forEach((b) => b.addEventListener("click", async () => {
    let sheetId = b.dataset.sheet;
    if (!sheetId) {
      const r = await api.post(`/api/sessions/${b.dataset.sid}/attendance`, {});
      if (r.error) { alert(r.error); return; }
      sheetId = r.id;
    }
    await openSheetModal(sheetId);
  }));
}

async function openSheetModal(sheetId) {
  const sh = await api.get(`/api/attendance/sheets/${sheetId}`);
  if (!sh || sh.error) { alert(sh?.error || "Feuille introuvable"); return; }
  const locked = sh.status === "locked";
  const row = (e) => `<div class="item att-row" data-lid="${e.learnerId}">
    <div class="grow"><div class="ttl">${esc(e.learnerName)}</div>
      <div class="sub muted">${e.signedAt ? "✍︎ signé " + new Date(e.signedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "non signé"}${e.reason ? " · " + esc(e.reason) : ""}</div></div>
    ${locked ? `<span class="pill ${ATT_TONE[e.status]}">${ATT_LABEL[e.status]}</span>
      <button class="btn-ghost btn-sm att-amend" data-lid="${e.learnerId}">Avenant</button>`
    : `<select class="txt att-st" data-lid="${e.learnerId}" style="width:120px;">${Object.entries(ATT_LABEL).map(([k, l]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input class="txt att-late" data-lid="${e.learnerId}" type="number" min="0" placeholder="min" value="${e.minutesLate || ""}" style="width:70px;${e.status === "retard" ? "" : "display:none;"}" title="minutes de retard">
      <label class="sub muted" style="display:flex;align-items:center;gap:4px;white-space:nowrap;"><input type="checkbox" class="att-just" data-lid="${e.learnerId}" ${e.justified ? "checked" : ""}> justifié</label>
      <button class="btn-ghost btn-sm att-sign" data-lid="${e.learnerId}">${e.signedAt ? "✍︎" : "Signer"}</button>`}
  </div>`;
  openModal(`Émargement — ${esc(sh.date)} ${esc(sh.start)}–${esc(sh.end)}`, `
    ${locked ? `<div class="card card-pad" style="margin-bottom:10px;border-left:4px solid var(--good);"><b>🔒 Feuille close et scellée</b> le ${new Date(sh.lockedAt).toLocaleString("fr-FR")} par ${esc(sh.lockedBy || "—")} · séquence ${sh.seq}
      <div class="sub muted" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:11px;margin-top:4px;">${esc(sh.hash || "")}</div>
      <div class="sub muted" style="margin-top:4px;">Toute correction se fait désormais par avenant motivé, conservé sur la feuille.</div></div>`
    : `<div class="card card-pad" style="margin-bottom:10px;">Code de séance à afficher en salle : <b style="font-size:20px;letter-spacing:3px;font-family:ui-monospace,monospace;">${esc(sh.code)}</b>
      <div class="sub muted">L'apprenant peut signer depuis son espace avec ce code, ou directement ci-dessous sur la tablette.</div></div>`}
    <div class="kpis" style="margin-bottom:10px;">
      <div class="k"><div class="v">${sh.stats.present}</div><div class="l">présents</div></div>
      <div class="k${sh.stats.absent ? " k-bad" : ""}"><div class="v">${sh.stats.absent}</div><div class="l">absents</div></div>
      <div class="k"><div class="v">${sh.stats.retard}</div><div class="l">retards</div></div>
      <div class="k"><div class="v">${sh.stats.attendanceRate ?? "—"} %</div><div class="l">assiduité</div></div>
    </div>
    <div class="list">${sh.entries.map(row).join("")}</div>
    ${sh.amendments?.length ? `<div class="section-title">Avenants</div><div class="list">${sh.amendments.map((a) => `<div class="item"><span class="pill">${new Date(a.at).toLocaleDateString("fr-FR")}</span><div class="grow"><div class="ttl" style="font-weight:500;">${esc(sh.entries.find((e) => e.learnerId === a.learnerId)?.learnerName || "—")} : ${ATT_LABEL[a.from] || a.from} → ${ATT_LABEL[a.to] || a.to}</div><div class="sub muted">${esc(a.reason)} · ${esc(a.by)}</div></div></div>`).join("")}</div>` : ""}
    ${locked ? "" : `<div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-ghost" id="att-save">Enregistrer l'appel</button>
      <button class="btn-primary" id="att-lock">🔒 Clore et sceller</button>
    </div><p class="hint muted">La clôture fige la feuille et l'ajoute à la chaîne de preuve du campus. Après clôture, seules des corrections motivées (avenants) sont possibles.</p>`}`);
  const collect = () => $$(".att-row").map((r) => {
    const lid = r.dataset.lid;
    return { learnerId: lid, status: $(`.att-st[data-lid="${lid}"]`)?.value, minutesLate: Number($(`.att-late[data-lid="${lid}"]`)?.value || 0), justified: $(`.att-just[data-lid="${lid}"]`)?.checked };
  });
  $$(".att-st").forEach((s) => s.addEventListener("change", () => {
    const late = $(`.att-late[data-lid="${s.dataset.lid}"]`);
    if (late) late.style.display = s.value === "retard" ? "" : "none";
  }));
  $("#att-save")?.addEventListener("click", async () => {
    const r = await api.patch(`/api/attendance/sheets/${sheetId}/entries`, { entries: collect() });
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove();
    await openSheetModal(sheetId);
  });
  $("#att-lock")?.addEventListener("click", () => guard($("#att-lock"), async () => {
    if (!confirm("Clore et sceller cette feuille ?\n\nElle deviendra non modifiable : toute correction ultérieure devra passer par un avenant motivé, conservé et visible.")) return;
    // Le résultat de l'enregistrement DOIT être vérifié : sceller sur un état non
    // enregistré produirait une preuve d'assiduité fausse, affichée comme un succès.
    const saved = await api.patch(`/api/attendance/sheets/${sheetId}/entries`, { entries: collect() });
    if (saved.error) { alert("Les pointages n'ont pas pu être enregistrés — la feuille n'a PAS été close.\n\n" + saved.error); return; }
    const r = await api.post(`/api/attendance/sheets/${sheetId}/lock`, {});
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove();
    await renderEmargement();
  }));
  $$(".att-sign").forEach((b) => b.addEventListener("click", () => openSignaturePad(sheetId, b.dataset.lid, sh.entries.find((e) => e.learnerId === b.dataset.lid)?.learnerName || "")));
  $$(".att-amend").forEach((b) => b.addEventListener("click", async () => {
    const e = sh.entries.find((x) => x.learnerId === b.dataset.lid);
    const status = prompt(`Nouveau statut pour ${e.learnerName} (present / absent / retard / excuse) :`, e.status);
    if (!status) return;
    const reason = prompt("Motif de la correction (obligatoire, conservé sur la feuille) :", "");
    if (!reason) { alert("Un avenant sans motif n'a aucune valeur probante."); return; }
    const r = await api.post(`/api/attendance/sheets/${sheetId}/amend`, { learnerId: b.dataset.lid, status, reason });
    if (r.error) { alert(r.error); return; }
    document.querySelector(".modal-bg")?.remove();
    await openSheetModal(sheetId);
  }));
}

// Pavé de signature tactile : trait au doigt/stylet, envoyé en PNG.
function openSignaturePad(sheetId, learnerId, name) {
  const pad = document.createElement("div");
  pad.className = "modal-bg";
  pad.innerHTML = `<div class="modal" style="max-width:520px;">
    <div class="modal-head"><h2>Signature — ${esc(name)}</h2><button class="btn-ghost btn-sm" id="sig-close">Fermer</button></div>
    <div class="modal-body">
      <p class="sub muted" style="margin-top:0;">Signe dans le cadre. L'horodatage est celui du serveur.</p>
      <canvas id="sig-canvas" width="460" height="180" style="width:100%;border:2px dashed var(--line);border-radius:8px;background:var(--surface);touch-action:none;"></canvas>
      <div class="actions" style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-ghost" id="sig-clear">Effacer</button>
        <button class="btn-primary" id="sig-save">Valider la signature</button>
      </div>
    </div></div>`;
  document.body.appendChild(pad);
  const cv = pad.querySelector("#sig-canvas");
  const ctx = cv.getContext("2d");
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0D1B2A";
  let drawing = false, dirty = false;
  const pos = (ev) => {
    const r = cv.getBoundingClientRect();
    const p = ev.touches ? ev.touches[0] : ev;
    return { x: (p.clientX - r.left) * (cv.width / r.width), y: (p.clientY - r.top) * (cv.height / r.height) };
  };
  const start = (ev) => { ev.preventDefault(); drawing = true; dirty = true; const { x, y } = pos(ev); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (ev) => { if (!drawing) return; ev.preventDefault(); const { x, y } = pos(ev); ctx.lineTo(x, y); ctx.stroke(); };
  const end = () => { drawing = false; };
  cv.addEventListener("pointerdown", start); cv.addEventListener("pointermove", move);
  // Écouteur posé sur window : il DOIT être retiré à la fermeture, sinon une
  // tablette en salle accumule un écouteur et un canvas par signature de la journée.
  window.addEventListener("pointerup", end);
  const fermerPad = () => { window.removeEventListener("pointerup", end); pad.remove(); };
  pad.querySelector("#sig-close").addEventListener("click", fermerPad);
  pad.querySelector("#sig-clear").addEventListener("click", () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; });
  pad.querySelector("#sig-save").addEventListener("click", async () => {
    if (!dirty) { alert("Signature vide."); return; }
    const r = await api.post(`/api/attendance/sheets/${sheetId}/sign`, { learnerId, signature: cv.toDataURL("image/png") });
    if (r.error) { alert(r.error); return; }
    pad.remove();
    document.querySelector(".modal-bg")?.remove();
    await openSheetModal(sheetId);
  });
}

async function renderPlanning() {
  const [campuses, classes, teachers] = await Promise.all([api.get("/api/campuses"), api.get("/api/classes"), api.get("/api/teachers")]);
  if (!planState.campusId && campuses[0]) planState.campusId = campuses[0].id;
  const from = planState.week, to = addDays(from, 5);
  const q = new URLSearchParams({ from, to });
  if (planState.campusId) q.set("campusId", planState.campusId);
  if (planState.classId) q.set("classId", planState.classId);
  if (planState.teacherId) q.set("teacherId", planState.teacherId);
  const sessions = await api.get(`/api/sessions?${q}`);

  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="pl-rythme">Rythme d'alternance</button><button class="btn-ghost btn-sm" id="pl-gen">✨ Générer</button><button class="btn-primary btn-sm" id="pl-add">+ Séance</button>`;
  const mine = classes.filter((k) => !planState.campusId || k.campusId === planState.campusId);

  $("#view").innerHTML = `
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn-ghost btn-sm" id="pl-prev">← Semaine</button>
      <b style="min-width:210px;text-align:center;">${frDate(from)} → ${frDate(to)}</b>
      <button class="btn-ghost btn-sm" id="pl-next">Semaine →</button>
      <select class="txt" id="pl-campus" style="max-width:180px;">${campuses.map((c) => `<option value="${c.id}" ${planState.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <select class="txt" id="pl-class" style="max-width:180px;"><option value="">Toutes les classes</option>${mine.map((k) => `<option value="${k.id}" ${planState.classId === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select>
      <select class="txt" id="pl-teacher" style="max-width:180px;"><option value="">Tous les professeurs</option>${teachers.map((t) => `<option value="${t.id}" ${planState.teacherId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
      <span style="flex:1"></span>
      <button class="btn-ghost btn-sm" id="pl-print">Imprimer</button>
      <button class="btn-ghost btn-sm" id="pl-ics">Agenda (.ics)</button>
      <button class="btn-ghost btn-sm" id="pl-send">Envoyer</button>
    </div>
    ${planBanner(sessions)}
    <div class="card" style="overflow-x:auto;"><div class="plan-grid">
      ${PLAN_DAYS.map(([k, l], i) => `<div class="plan-col">
        <div class="plan-head">${l}<span class="muted">${frDate(addDays(from, i)).slice(0, 5)}</span></div>
        <div class="plan-day" data-date="${addDays(from, i)}">
          ${sessions.filter((s) => s.date === addDays(from, i)).sort((a, b) => hhmmToMin(a.start) - hhmmToMin(b.start)).map(planCard).join("")
            || '<p class="muted" style="font-size:12px;padding:8px;">—</p>'}
        </div></div>`).join("")}
    </div></div>
    <p class="hint muted" style="margin-top:8px;">Clique une séance pour la modifier. Chaque déplacement est revérifié : professeur, salle, classe, disponibilités, vacances et capacité.</p>`;

  $("#pl-prev").onclick = () => { planState.week = addDays(planState.week, -7); renderPlanning(); };
  $("#pl-next").onclick = () => { planState.week = addDays(planState.week, 7); renderPlanning(); };
  for (const [id, key] of [["pl-campus", "campusId"], ["pl-class", "classId"], ["pl-teacher", "teacherId"]]) {
    $(`#${id}`).onchange = (e) => { planState[key] = e.target.value; renderPlanning(); };
  }
  $("#pl-add").onclick = () => openSessionForm();
  $("#pl-gen").onclick = () => openGenerator();
  $("#pl-rythme").onclick = () => openRythme();
  $("#pl-print").onclick = () => window.open(`/api/schedule/print?${filterQS()}`, "_blank");
  $("#pl-ics").onclick = () => { location.href = `/api/schedule/ics?${filterQS()}`; };
  $("#pl-send").onclick = () => openSendForm(teachers, mine);
  $$(".plan-card").forEach((c) => c.addEventListener("click", () => openSessionForm(sessions.find((s) => s.id === c.dataset.sid))));
}
function filterQS() {
  const q = new URLSearchParams({ from: planState.week, to: addDays(planState.week, 5) });
  if (planState.classId) q.set("classId", planState.classId);
  if (planState.teacherId) q.set("teacherId", planState.teacherId);
  return q.toString();
}
function planCard(s) {
  const forced = (s.forced || []).length;
  return `<div class="plan-card${s.status === "cancelled" ? " off" : ""}${forced ? " forced" : ""}" data-sid="${s.id}" title="${forced ? "Conflit assumé : " + esc(s.forced.join(", ")) : ""}">
    <div class="h">${esc(s.start)}–${esc(s.end)}${s.kind !== "cours" ? ` <span class="pill">${esc(SES_KIND[s.kind])}</span>` : ""}${forced ? ' <span class="pill p-warn">forcé</span>' : ""}</div>
    <div class="t">${esc(s.moduleLabel || "—")}</div>
    <div class="m muted">${[s.className, s.teacherName, s.roomName].filter(Boolean).map(esc).join(" · ")}</div></div>`;
}
function planBanner(sessions) {
  const h = sessions.reduce((a, s) => a + (hhmmToMin(s.end) - hhmmToMin(s.start)) / 60, 0);
  const forced = sessions.filter((s) => (s.forced || []).length).length;
  return `<div class="kpis" style="margin-bottom:10px;">
    ${fkpi(sessions.length, "séances")}${fkpi(Math.round(h) + " h", "volume")}
    ${fkpi(new Set(sessions.map((s) => s.teacherId).filter(Boolean)).size, "professeurs")}
    ${fkpi(forced, "conflits assumés", forced ? "bad" : "good")}</div>`;
}

// ---------- Formulaire de séance : la vérification est faite AVANT d'écrire ----------
async function openSessionForm(s) {
  const e = s || { date: planState.week, start: "09:00", end: "11:00", campusId: planState.campusId };
  const [classes, teachers, rooms, curricula] = await Promise.all([api.get("/api/classes"), api.get("/api/teachers"), api.get("/api/rooms"), api.get("/api/curricula")]);
  const k = classes.find((x) => x.id === (e.classId || planState.classId));
  const cur = curricula.find((c) => c.id === k?.curriculumId);
  const modules = cur?.modules || [];
  openModal(s ? "Modifier la séance" : "Nouvelle séance", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Classe *</label><select class="txt ssf" data-f="classId">${classes.map((x) => `<option value="${x.id}" ${(e.classId || planState.classId) === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
      <div><label class="field-label">Module</label><select class="txt ssf" data-f="moduleId"><option value="">—</option>${modules.map((m) => `<option value="${m.id}" ${e.moduleId === m.id ? "selected" : ""}>${esc(m.label || m.code)}</option>`).join("")}</select></div>
      <div><label class="field-label">Professeur</label><select class="txt ssf" data-f="teacherId"><option value="">—</option>${teachers.map((t) => `<option value="${t.id}" ${e.teacherId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      <div><label class="field-label">Salle</label><select class="txt ssf" data-f="roomId"><option value="">—</option>${rooms.map((r) => `<option value="${r.id}" ${e.roomId === r.id ? "selected" : ""}>${esc(r.name)}${r.places ? ` (${r.places})` : ""}</option>`).join("")}</select></div>
      <div><label class="field-label">Date *</label><input class="txt ssf" data-f="date" type="date" value="${esc(e.date || "")}"></div>
      <div><label class="field-label">Type</label><select class="txt ssf" data-f="kind">${Object.entries(SES_KIND).map(([kk, l]) => `<option value="${kk}" ${e.kind === kk ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Modalité</label><select class="txt ssf" data-f="modalite">${Object.entries(SES_MODALITE).map(([kk, l]) => `<option value="${kk}" ${(e.modalite || "presentiel") === kk ? "selected" : ""}>${l}</option>`).join("")}</select>
        <p class="hint muted" style="margin-top:4px;">À distance, l'heure ne se prouve pas par une signature : elle se justifie par les travaux rendus (Suivi à distance).</p></div>
      <div><label class="field-label">Début *</label><input class="txt ssf" data-f="start" type="time" value="${esc(e.start || "")}"></div>
      <div><label class="field-label">Fin *</label><input class="txt ssf" data-f="end" type="time" value="${esc(e.end || "")}"></div>
      ${s ? `<div><label class="field-label">Statut</label><select class="txt ssf" data-f="status">${Object.entries(SES_STATUT).map(([kk, l]) => `<option value="${kk}" ${e.status === kk ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : `
      <div><label class="field-label">Répéter jusqu'au</label><input class="txt" id="ss-until" type="date" placeholder="série hebdomadaire"></div>`}
      <div style="grid-column:1/-1;"><label class="field-label">Notes</label><input class="txt ssf" data-f="notes" value="${esc(e.notes || "")}"></div>
    </div>
    <div id="ss-conflicts" style="margin-top:10px;"></div>
    <div class="actions" style="margin-top:12px;">
      ${s ? `<button class="btn-ghost btn-sm btn-danger" id="ss-del">Supprimer</button>` : ""}
      <button class="btn-ghost btn-sm" id="ss-check">Vérifier</button>
      <button class="btn-primary" id="ss-save">Enregistrer</button></div>`);

  const collect = () => {
    const b = { campusId: e.campusId || planState.campusId };
    $$(".ssf").forEach((i) => (b[i.dataset.f] = i.value));
    return b;
  };
  const showConflicts = (list, forcable) => {
    const box = $("#ss-conflicts");
    if (!list?.length) { box.innerHTML = '<p class="muted" style="font-size:13px;">Aucun conflit détecté.</p>'; return; }
    box.innerHTML = list.map((c) => `<div class="item" style="border-left:3px solid ${c.level === "warn" ? "#8A6114" : "#8A4B4B"};">
      <span class="pill ${c.level === "warn" ? "p-warn" : "p-off"}">${c.level === "warn" ? "Alerte" : c.level === "block-forcable" ? "À confirmer" : "Impossible"}</span>
      <span class="grow">${esc(c.message)}</span></div>`).join("")
      + (forcable ? '<p class="hint muted">Ces points peuvent être forcés — le forçage est tracé et remonte dans le suivi de service.</p>' : "");
  };
  $("#ss-check").onclick = async () => showConflicts((await api.post("/api/sessions/check", collect())).conflicts);
  $("#ss-save").onclick = async () => {
    const body = collect();
    if (!body.date || !body.start || !body.end) return;
    const until = $("#ss-until")?.value;
    let r;
    if (s) r = await api.patch(`/api/sessions/${s.id}`, body);
    else if (until) r = await api.post("/api/sessions/series", { ...body, until });
    else r = await api.post("/api/sessions", body);
    if (r?.conflicts) {
      showConflicts(r.conflicts, r.forcable);
      if (r.forcable && confirm("Conflit signalé. Poser quand même la séance ?")) {
        const f = s ? await api.patch(`/api/sessions/${s.id}`, { ...body, force: true })
                    : until ? await api.post("/api/sessions/series", { ...body, until, force: true })
                            : await api.post("/api/sessions", { ...body, force: true });
        if (f?.conflicts) { showConflicts(f.conflicts, f.forcable); return; }
      } else return;
    }
    if (r?.skipped?.length) alert(`${r.created} séances posées. ${r.skipped.length} écartées (conflit ou période fermée).`);
    closeModals(); renderPlanning();
  };
  if (s) $("#ss-del").onclick = async () => {
    if (!confirm("Supprimer cette séance ?")) return;
    await api.del(`/api/sessions/${s.id}`); closeModals(); renderPlanning();
  };
}

// ---------- Générateur ----------
// --- Rythme d'alternance ---
// Poser un rythme à la main, c'est saisir une trentaine de périodes par classe.
// L'écran les génère, et surtout DIT AVANT DE PLANIFIER si le rythme permet
// d'atteindre le volume du référentiel — le découvrir en juin ne sert à rien.
async function openRythme() {
  const [classes, modeles] = await Promise.all([
    api.get("/api/classes"), api.get("/api/schedule/rythme/modeles"),
  ]);
  const mine = classes.filter((k) => !planState.campusId || k.campusId === planState.campusId);
  if (!mine.length) { alert("Aucune classe sur ce campus."); return; }

  openModal("Rythme d'alternance", `
    <p class="muted" style="font-size:13.5px;">Les semaines en entreprise deviennent des périodes du calendrier : la génération d'emploi du temps les saute automatiquement. <b>Un apprenti n'a pas de vacances scolaires</b> — il est salarié, et pendant les fermetures du centre il est en entreprise. Une semaine de cours qui tombe sur une fermeture est <b>reportée</b>, pas perdue.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Classe</label>
        <select class="txt" id="ry-class">${mine.map((k) => `<option value="${k.id}" ${planState.classId === k.id ? "selected" : ""}>${esc(k.name)}${k.rythme ? ` — ${esc(k.rythme)}` : ""}</option>`).join("")}</select></div>
      <div><label class="field-label">Début de l'année</label><input class="txt" id="ry-debut" type="date" value="${planState.week}"></div>
      <div><label class="field-label">Fin de l'année</label><input class="txt" id="ry-fin" type="date"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Rythme</label>
        <select class="txt" id="ry-modele">${modeles.map((m) => `<option value="${m.cle}" ${m.cle === "1-3" ? "selected" : ""}>${esc(m.label)}</option>`).join("")}<option value="">Personnalisé…</option></select></div>
      <div><label class="field-label">Semaines en centre</label><input class="txt" id="ry-centre" type="number" value="1" min="1" max="11"></div>
      <div><label class="field-label">Semaines en entreprise</label><input class="txt" id="ry-entreprise" type="number" value="3" min="0" max="11"></div>
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="ry-ent-first"> L'année commence par une période en entreprise</label></div>
    </div>
    <div id="ry-out" style="margin-top:12px;"></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost" id="ry-prev">Prévisualiser</button></div>`);

  const lire = () => ({
    classId: $("#ry-class").value,
    debut: $("#ry-debut").value, fin: $("#ry-fin").value,
    centre: +$("#ry-centre").value, entreprise: +$("#ry-entreprise").value,
    commencePar: $("#ry-ent-first").checked ? "entreprise" : "centre",
  });
  $("#ry-modele").onchange = (e) => {
    const m = modeles.find((x) => x.cle === e.target.value);
    if (!m) return;
    $("#ry-centre").value = m.centre; $("#ry-entreprise").value = m.entreprise;
  };

  const poser = async (confirmer) => {
    const r = await api.post("/api/schedule/rythme/apply", { ...lire(), confirmer });
    if (r?.error) {
      // Des cours déjà posés dans ce qui devient une semaine en entreprise : on
      // les montre au lieu d'écraser silencieusement un planning existant.
      $("#ry-out").insertAdjacentHTML("beforeend", `<div class="item" style="border-left:3px solid #8A4B4B;margin-top:10px;"><div class="grow">
        <b class="neg">${esc(r.error)}</b>${r.indice ? `<br><span class="muted">${esc(r.indice)}</span>` : ""}
        ${(r.conflits || []).slice(0, 10).map((c) => `<br><span class="muted" style="font-size:12px;">${esc(frDate(c.date))} ${esc(c.start)}–${esc(c.end)}</span>`).join("")}
        ${r.conflitsTotal > 10 ? `<br><span class="muted" style="font-size:12px;">… et ${r.conflitsTotal - 10} autre(s)</span>` : ""}
        ${r.conflits ? '<div class="actions" style="margin-top:8px;"><button class="btn-ghost btn-sm" id="ry-force">Poser le rythme malgré tout</button></div>' : ""}
      </div></div>`);
      if ($("#ry-force")) $("#ry-force").onclick = () => poser(true);
      return;
    }
    alert(`Rythme posé : ${r.creees} période(s) en entreprise, ${r.weeksAtSchool} semaines de cours dans l'année.`
      + (r.remplacees ? ` ${r.remplacees} période(s) du rythme précédent remplacée(s).` : ""));
    closeModals(); renderPlanning();
  };

  $("#ry-prev").onclick = async () => {
    $("#ry-out").innerHTML = '<p class="muted">Calcul…</p>';
    const r = await api.post("/api/schedule/rythme/preview", lire());
    if (r?.error) { $("#ry-out").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    const v = r.volume;
    $("#ry-out").innerHTML = `
      <div class="kpis">${fkpi(v.semainesCentre, "semaines en centre")}${fkpi(v.semainesEntreprise, "semaines en entreprise")}
        ${fkpi(v.heuresDisponibles + " h", "volume délivrable", v.suffisant === false ? "bad" : v.suffisant ? "good" : "")}
        ${v.volumeRequis ? fkpi(v.volumeRequis + " h", "référentiel") : ""}</div>
      <div class="item" style="border-left:3px solid ${v.suffisant === false ? "#8A4B4B" : v.suffisant ? "#4B7A5A" : "#8A7A4B"};margin-top:10px;">
        <div class="grow">${esc(v.message)}${v.semainesReportees ? `<br><span class="muted" style="font-size:12px;">${v.semainesReportees} semaine(s) de cours reportée(s) pour cause de fermeture du centre.</span>` : ""}</div></div>
      <p class="hint muted" style="margin-top:8px;">${esc(r.resume.note)}</p>
      <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="ry-apply">Poser ${r.periodes.length} période(s) sur le calendrier</button></div>`;
    $("#ry-apply").onclick = () => poser(false);
  };
}

async function openGenerator() {
  const classes = (await api.get("/api/classes")).filter((k) => !planState.campusId || k.campusId === planState.campusId);
  openModal("Générer l'emploi du temps", `
    <p class="muted" style="font-size:13.5px;">Le générateur construit la <b>semaine type</b> depuis les référentiels, les disponibilités et les salles, puis on la déroule sur la période. Il refuse tout planning qui dépasserait les plafonds légaux de service.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div style="grid-column:1/-1;"><label class="field-label">Classes</label>
        <select class="txt" id="gn-classes" multiple size="${Math.min(6, Math.max(2, classes.length))}">${classes.map((k) => `<option value="${k.id}" selected>${esc(k.name)}</option>`).join("")}</select></div>
      <div><label class="field-label">Semaine de référence</label><input class="txt" id="gn-week" type="date" value="${planState.week}"></div>
      <div><label class="field-label">Dérouler jusqu'au</label><input class="txt" id="gn-until" type="date"></div>
      <div><label class="field-label">Durée d'une séance (min)</label><input class="txt" id="gn-dur" type="number" value="120" step="30" min="30"></div>
      <div><label class="field-label">Semaines de cours dans l'année</label><input class="txt" id="gn-weeks" type="number" value="36" min="10" max="52"></div>
      <div style="grid-column:1/-1;"><label class="jal-chk"><input type="checkbox" id="gn-legal" checked> Refuser tout dépassement des plafonds légaux (28 h/semaine, 48 h supplémentaires/an)</label></div>
    </div>
    <div id="gn-out" style="margin-top:12px;"></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="gn-run">Générer</button></div>`);

  $("#gn-run").onclick = async () => {
    $("#gn-out").innerHTML = '<p class="muted">Génération…</p>';
    const r = await api.post("/api/schedule/generate", {
      campusId: planState.campusId,
      classIds: $$("#gn-classes option").filter((o) => o.selected).map((o) => o.value),
      weekOf: $("#gn-week").value, sessionMinutes: +$("#gn-dur").value,
      weeksInYear: +$("#gn-weeks").value, enforceLegalLimits: $("#gn-legal").checked,
    });
    if (r?.error) { $("#gn-out").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    $("#gn-out").innerHTML = `
      <div class="kpis">${fkpi(r.stats.coverage + " %", "couverture", r.stats.coverage === 100 ? "good" : "bad")}
        ${fkpi(r.stats.placed + "/" + r.stats.demanded, "séances placées")}
        ${fkpi(r.score.classGaps + " h", "trous étudiants")}${fkpi(r.score.loadStdev, "écart de charge")}</div>
      ${r.diagnosis?.length ? `<div style="margin:10px 0;">${r.diagnosis.map((d) => `<div class="item" style="border-left:3px solid #8A4B4B;">
        <div class="grow"><b>${esc(d.message)}</b><br><span class="muted">${esc(d.remedy || "")}</span>
        ${d.modules?.length ? `<br><span class="muted" style="font-size:12px;">Modules : ${d.modules.map(esc).join(", ")}</span>` : ""}</div></div>`).join("")}</div>` : '<p class="muted">Aucun blocage : tout le référentiel a trouvé sa place.</p>'}
      <div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table"><thead><tr><th>Jour</th><th>Horaire</th><th>Enseignement</th><th>Classe</th><th>Professeur</th><th>Salle</th></tr></thead><tbody>
        ${r.week.slice().sort((a, b) => PLAN_DAYS.findIndex((d) => d[0] === a.day) - PLAN_DAYS.findIndex((d) => d[0] === b.day) || hhmmToMin(a.start) - hhmmToMin(b.start))
          .map((w) => `<tr><td>${esc((PLAN_DAYS.find((d) => d[0] === w.day) || [])[1] || w.day)}</td><td>${esc(w.start)}–${esc(w.end)}</td><td>${esc(w.label)}</td><td>${esc(w.classId)}</td><td>${esc(w.teacherId || "—")}</td><td>${esc(w.roomId || "—")}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="actions" style="margin-top:10px;"><button class="btn-primary" id="gn-apply">Appliquer sur la période</button></div>`;
    $("#gn-apply").onclick = async () => {
      const until = $("#gn-until").value;
      if (!until) { alert("Indique jusqu'à quelle date dérouler la semaine type."); return; }
      const a = await api.post("/api/schedule/apply", { week: r.week, weekOf: r.weekOf, until, campusId: planState.campusId });
      // La garde des durées légales répond 409 sans rien créer : l'afficher comme
      // « undefined séances créées » laisserait croire à un simple bogue et le
      // refus passerait inaperçu.
      if (a?.error) {
        $("#gn-out").insertAdjacentHTML("beforeend",
          `<div class="item" style="border-left:3px solid #8A4B4B;margin-top:10px;"><div class="grow"><b class="neg">${esc(a.error)}</b>
          ${(a.illegales || a.refusees || []).slice(0, 10).map((x) => `<br><span class="muted" style="font-size:12px;">${esc(frDate(x.date))} ${esc(x.start)}–${esc(x.end)} — ${esc((x.motifs || []).join(" ; "))}</span>`).join("")}</div></div>`);
        return;
      }
      alert(`${a.created} séances créées.${a.refuseesTotal ? ` ${a.refuseesTotal} refusée(s) pour conflit.` : ""}`);
      closeModals(); renderPlanning();
    };
  };
}

// ---------- Envoi du planning ----------
function openSendForm(teachers, classes) {
  openModal("Envoyer l'emploi du temps", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Du</label><input class="txt" id="sd-from" type="date" value="${planState.week}"></div>
      <div><label class="field-label">Au</label><input class="txt" id="sd-until" type="date" value="${addDays(planState.week, 5)}"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Professeurs — chacun reçoit le sien</label>
        <select class="txt" id="sd-teachers" multiple size="5">${teachers.map((t) => `<option value="${t.id}" ${t.id === planState.teacherId ? "selected" : ""}>${esc(t.name)}${t.email ? "" : " (sans email)"}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Classe</label>
        <select class="txt" id="sd-class"><option value="">—</option>${classes.map((k) => `<option value="${k.id}" ${k.id === planState.classId ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1;"><label class="field-label">Destinataires de la classe</label>
        <input class="txt" id="sd-to" placeholder="adresses séparées par des virgules">
        <span class="hint muted">Les adresses des étudiants ne sont pas stockées dans l'application : indique-les ici, ou envoie au délégué.</span></div>
      <div style="grid-column:1/-1;"><label class="field-label">Mot d'introduction</label><input class="txt" id="sd-intro" placeholder="facultatif"></div>
    </div>
    <div id="sd-out" style="margin-top:10px;"></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="sd-go">Envoyer</button></div>`);
  $("#sd-go").onclick = async () => {
    $("#sd-out").innerHTML = '<p class="muted">Envoi…</p>';
    const r = await api.post("/api/schedule/send", {
      teacherIds: $$("#sd-teachers option").filter((o) => o.selected).map((o) => o.value),
      classId: $("#sd-class").value || null, to: $("#sd-to").value,
      from: $("#sd-from").value, until: $("#sd-until").value, intro: $("#sd-intro").value,
    });
    if (r?.error) { $("#sd-out").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    $("#sd-out").innerHTML = `<p><b>${r.sent.length} envoi(s)</b>${r.sent.map((x) => `<br><span class="muted">${esc(x.name)} → ${esc(x.to)} (${x.sessions} séances)</span>`).join("")}</p>`
      + (r.failed.length ? `<p class="neg">${r.failed.map((f) => `${esc(f.name)} : ${esc(f.error)}`).join("<br>")}</p>` : "");
  };
}

// ---------- Professeurs & prestataires ----------
let profFilter = "";
async function renderProfesseurs() {
  const [teachers, campuses] = await Promise.all([api.get("/api/teachers"), api.get("/api/campuses")]);
  const svc = await api.get(`/api/schedule/service${planState.campusId ? `?campusId=${planState.campusId}` : ""}`);
  const byId = new Map((svc.rows || []).map((r) => [r.teacherId, r]));
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="tc-import">Importer les contacts</button><button class="btn-primary btn-sm" id="tc-add">+ Professeur</button>`;
  const list = teachers.filter((t) => !profFilter || t.status === profFilter);

  $("#view").innerHTML = `
    <div class="kpis" style="margin-bottom:12px;">
      ${fkpi(teachers.length, "professeurs")}
      ${fkpi(teachers.filter((t) => t.status === "prestataire").length, "prestataires")}
      ${fkpi(Math.round(svc.cost || 0).toLocaleString("fr-FR") + " €", "coût du planning")}
      ${fkpi((svc.equity?.stdev ?? 0) + " h", "écart de charge", (svc.equity?.stdev ?? 0) > 40 ? "bad" : "good")}
    </div>
    <div class="chips" style="margin-bottom:10px;">
      ${[["", "Tous"], ...Object.entries(TEACH_STATUS)].map(([k, l]) => `<button class="chip ${profFilter === k ? "active" : ""}" data-s="${k}">${l}</button>`).join("")}
    </div>
    ${(svc.rows || []).some((r) => r.flags?.length) ? `<div class="card" style="border-left:3px solid #8A4B4B;padding:12px;margin-bottom:12px;">
      <b>Service à surveiller</b>${(svc.rows || []).filter((r) => r.flags?.length).map((r) => `<div class="muted" style="font-size:13px;margin-top:4px;">${esc(r.name)} — ${r.flags.map((f) => esc(f.message)).join(" ")}</div>`).join("")}</div>` : ""}
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Nom</th><th>Statut</th><th>Société</th><th>Matières</th><th>Dû</th><th>Posé</th><th>H. supp.</th><th>Coût</th><th></th></tr></thead><tbody>
      ${list.map((t) => { const s = byId.get(t.id) || {}; return `<tr>
        <td><b>${esc(t.name)}</b>${t.email ? `<br><span class="muted" style="font-size:12px;">${esc(t.email)}</span>` : ""}</td>
        <td><span class="pill">${esc(TEACH_STATUS[t.status] || t.status)}</span></td>
        <td>${esc(t.company || "—")}</td>
        <td class="muted" style="font-size:12.5px;">${(t.subjects || []).map(esc).join(", ") || "—"}</td>
        <td class="num">${t.heuresAnnuelles ?? "—"}</td>
        <td class="num">${s.planned ?? 0}</td>
        <td class="num ${s.overtime > 0 ? "neg" : ""}">${s.overtime ?? 0}</td>
        <td class="num">${s.cost != null ? Math.round(s.cost).toLocaleString("fr-FR") + " €" : "—"}</td>
        <td><button class="btn-ghost btn-sm tc-edit" data-id="${t.id}">✎</button></td></tr>`; }).join("")
        || '<tr><td colspan="9" class="muted">Aucun professeur. Importe les contacts existants ou crée une fiche.</td></tr>'}
    </tbody></table></div>`;

  $$(".chips .chip").forEach((c) => c.addEventListener("click", () => { profFilter = c.dataset.s; renderProfesseurs(); }));
  $("#tc-add").onclick = () => openTeacherForm(null, campuses);
  $$(".tc-edit").forEach((b) => b.addEventListener("click", () => openTeacherForm(teachers.find((t) => t.id === b.dataset.id), campuses)));
  $("#tc-import").onclick = async () => {
    const r = await api.post("/api/teachers/import-contacts", {});
    alert(r.imported ? `${r.imported} professeur(s) repris depuis les fiches campus.` : "Aucun nouveau contact « professeur » à reprendre.");
    renderProfesseurs();
  };
}

function openTeacherForm(t, campuses) {
  const e = t || { availability: {}, campusIds: [], unavailable: [] };
  const day = (k, l) => {
    const r = (e.availability || {})[k];
    const on = Array.isArray(r);
    return `<tr><td><label class="jal-chk"><input type="checkbox" class="av-on" data-d="${k}" ${on ? "checked" : ""}> ${l}</label></td>
      <td><input class="txt av-a" data-d="${k}" type="time" value="${on && r[0] ? esc(r[0][0]) : ""}"></td>
      <td><input class="txt av-b" data-d="${k}" type="time" value="${on && r[0] ? esc(r[0][1]) : ""}"></td></tr>`;
  };
  openModal(t ? "Modifier la fiche" : "Nouveau professeur", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nom *</label><input class="txt tf" data-f="name" value="${esc(e.name || "")}"></div>
      <div><label class="field-label">Statut</label><select class="txt tf" data-f="status">${Object.entries(TEACH_STATUS).map(([k, l]) => `<option value="${k}" ${e.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Email</label><input class="txt tf" data-f="email" value="${esc(e.email || "")}"></div>
      <div><label class="field-label">Téléphone</label><input class="txt tf" data-f="phone" value="${esc(e.phone || "")}"></div>
      <div><label class="field-label">Société <span class="muted">(prestataire)</span></label><input class="txt tf" data-f="company" value="${esc(e.company || "")}"></div>
      <div><label class="field-label">Réf. contrat</label><input class="txt tf" data-f="contractRef" value="${esc(e.contractRef || "")}"></div>
      <div><label class="field-label">Heures annuelles dues</label><input class="txt tf" data-f="heuresAnnuelles" type="number" value="${e.heuresAnnuelles ?? ""}"></div>
      <div><label class="field-label">Taux horaire (€)</label><input class="txt tf" data-f="tauxHoraire" type="number" value="${e.tauxHoraire ?? ""}"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Matières enseignées <span class="muted">(séparées par des virgules — laisser vide = polyvalent, servi en dernier recours)</span></label>
        <input class="txt" id="tf-subj" value="${esc((e.subjects || []).join(", "))}"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Campus</label>
        <select class="txt" id="tf-campus" multiple size="3">${campuses.map((c) => `<option value="${c.id}" ${(e.campusIds || []).includes(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <p class="field-label" style="margin-top:14px;">Disponibilités — propres à chaque jour</p>
    <p class="hint muted">Cocher un jour sans horaire = déclaré indisponible ce jour-là. Un jour non coché n'est pas renseigné : le générateur ne s'y aventurera pas, l'éditeur laissera passer.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Jour</th><th>De</th><th>À</th></tr></thead>
      <tbody>${PLAN_DAYS.map(([k, l]) => day(k, l)).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:14px;">${t ? `<button class="btn-ghost btn-sm btn-danger" id="tf-del">Supprimer</button>` : ""}<button class="btn-primary" id="tf-save">Enregistrer</button></div>`);

  $("#tf-save").onclick = async () => {
    const b = {}; $$(".tf").forEach((i) => (b[i.dataset.f] = i.value));
    if (!String(b.name || "").trim()) return;
    b.subjects = $("#tf-subj").value.split(",").map((x) => x.trim()).filter(Boolean);
    b.campusIds = $$("#tf-campus option").filter((o) => o.selected).map((o) => o.value);
    b.availability = {};
    $$(".av-on").forEach((c) => {
      if (!c.checked) return;                       // jour non coché = non renseigné
      const d = c.dataset.d;
      const a = $(`.av-a[data-d="${d}"]`).value, z = $(`.av-b[data-d="${d}"]`).value;
      b.availability[d] = a && z ? [[a, z]] : [];   // coché sans horaire = indisponible
    });
    if (t) await api.patch(`/api/teachers/${t.id}`, b); else await api.post("/api/teachers", b);
    closeModals(); renderProfesseurs();
  };
  if (t) $("#tf-del").onclick = async () => {
    if (!confirm("Supprimer cette fiche ?")) return;
    await api.del(`/api/teachers/${t.id}`); closeModals(); renderProfesseurs();
  };
}

// ---------- Référentiels ----------
async function renderReferentiels() {
  const [curricula, prop] = await Promise.all([api.get("/api/curricula"), api.get("/api/curricula/proposal")]);
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="rf-import">Importer un fichier</button><button class="btn-primary btn-sm" id="rf-add">+ Référentiel</button>`;
  $("#view").innerHTML = `
    ${prop ? proposalBox(prop) : ""}
    ${curricula.length ? `<div class="grid grid-2">${curricula.map((c) => `<div class="card" style="padding:14px;">
      <div class="row" style="justify-content:space-between;align-items:baseline;">
        <div><b style="font-size:16px;">${esc(c.name)}</b>${c.diploma ? ` <span class="pill">${esc(c.diploma)}</span>` : ""}</div>
        <span><button class="btn-ghost btn-sm rf-assign" data-id="${c.id}">✨ Qui enseigne quoi</button>
        <button class="btn-ghost btn-sm rf-edit" data-id="${c.id}">✎</button></span></div>
      <div class="muted" style="font-size:13px;margin:6px 0;">${(c.modules || []).length} modules · <b>${c.weeklyByYear?.[1] || 0} h/sem</b> en 1re · <b>${c.weeklyByYear?.[2] || 0} h/sem</b> en 2e${(c.modules || []).some((m) => m.heuresSemaine == null && m.heures == null) ? ` · <span class="neg">${(c.modules || []).filter((m) => m.heuresSemaine == null && m.heures == null).length} sans volume</span>` : ""}</div>
      <div class="list">${(c.modules || []).slice(0, 8).map((m) => `<div class="item"><span class="grow">${esc(m.code ? m.code + " · " : "")}${esc(m.label)}${m.year ? ` <span class="muted">(${m.year}re/e)</span>` : ""}</span><span class="${m.heuresSemaine == null && m.heures == null ? "neg" : "muted"}">${m.heuresSemaine != null ? m.heuresSemaine + " h/sem" : m.heures != null ? m.heures + " h/an" : "à renseigner"}</span></div>`).join("")}
        ${(c.modules || []).length > 8 ? `<p class="muted" style="font-size:12px;">+ ${(c.modules || []).length - 8} autres</p>` : ""}</div>
    </div>`).join("")}</div>` : '<p class="empty">Aucun référentiel.<br><span class="muted">Crée-en un, ou dépose le référentiel officiel : les modules et volumes seront proposés à ta validation.</span></p>'}`;
  $("#rf-add").onclick = () => openCurriculumForm();
  $$(".rf-assign").forEach((b) => b.addEventListener("click", () => openAssignments(b.dataset.id)));
  $$(".rf-edit").forEach((b) => b.addEventListener("click", () => openCurriculumForm(curricula.find((c) => c.id === b.dataset.id))));
  $("#rf-import").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".pdf,.xlsx,.xls,.csv,.txt,.docx";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      $("#view").insertAdjacentHTML("afterbegin", '<p class="muted" id="rf-wait">Lecture du document…</p>');
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/curricula/import", { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd }).then((x) => x.json());
      $("#rf-wait")?.remove();
      if (r?.error) { alert(r.error); return; }
      renderReferentiels();
    };
    inp.click();
  };
  $("#rf-ok") && ($("#rf-ok").onclick = async () => { await api.post("/api/curricula/proposal/confirm", {}); renderReferentiels(); });
  $("#rf-no") && ($("#rf-no").onclick = async () => { await api.post("/api/curricula/proposal/discard", {}); renderReferentiels(); });
}
function proposalBox(p) {
  const manque = (p.modules || []).filter((m) => m.heures == null).length;
  return `<div class="card" style="border-left:3px solid #FF6A4D;padding:14px;margin-bottom:14px;">
    <b>Proposition à valider — ${esc(p.name || "sans titre")}</b>
    <p class="muted" style="font-size:13px;">Extrait de « ${esc(p.source || "document")} » : ${(p.modules || []).length} modules.
    ${manque ? `<span class="neg">${manque} module(s) sans volume horaire — l'extraction ne l'a pas inventé, à toi de le renseigner après validation.</span>` : ""}</p>
    <div class="card" style="overflow-x:auto;max-height:260px;"><table class="net-table"><thead><tr><th>Code</th><th>Module</th><th>Heures</th><th>Année</th></tr></thead>
      <tbody>${(p.modules || []).map((m) => `<tr><td>${esc(m.code || "—")}</td><td>${esc(m.label)}</td><td class="${m.heures == null ? "neg" : ""}">${m.heures ?? "—"}</td><td>${m.year ?? "—"}</td></tr>`).join("")}</tbody></table></div>
    <div class="actions" style="margin-top:10px;"><button class="btn-ghost btn-sm" id="rf-no">Ignorer</button><button class="btn-primary btn-sm" id="rf-ok">Valider et créer</button></div></div>`;
}
function openCurriculumForm(c) {
  const e = c || { modules: [] };
  const row = (m = {}) => `<tr>
    <td><input class="txt cm" data-f="code" value="${esc(m.code || "")}" placeholder="U1"></td>
    <td><input class="txt cm" data-f="label" value="${esc(m.label || "")}" placeholder="Intitulé"></td>
    <td><input class="txt cm cm-w" data-f="heuresSemaine" type="number" step="0.5" value="${m.heuresSemaine ?? ""}" placeholder="h/sem"></td>
    <td><input class="txt cm" data-f="year" type="number" min="1" max="3" value="${m.year ?? ""}" placeholder="1"></td>
    <td><input class="txt cm" data-f="heures" type="number" value="${m.heures ?? ""}" placeholder="annuel"></td>
    <td><input class="txt cm" data-f="requiresRoom" value="${esc(m.requiresRoom || "")}" placeholder="salle exigée"></td>
    <td><button class="btn-ghost btn-sm cm-del">×</button></td></tr>`;
  openModal(c ? "Modifier le référentiel" : "Nouveau référentiel", `
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div><label class="field-label">Intitulé *</label><input class="txt cf" data-f="name" value="${esc(e.name || "")}"></div>
      <div><label class="field-label">Diplôme</label><input class="txt cf" data-f="diploma" value="${esc(e.diploma || "")}" placeholder="BTS"></div>
      <div><label class="field-label">Niveau</label><input class="txt cf" data-f="level" value="${esc(e.level || "")}"></div>
    </div>
    <p class="field-label" style="margin-top:12px;">Maquette horaire</p>
    <p class="hint muted">Saisis les <b>heures par semaine</b> — c'est la forme officielle d'une maquette de BTS (33 h en 1re année, 34 en 2e). La colonne « annuel » ne sert qu'aux formations décrites en volume global ; si les deux sont remplies, l'hebdomadaire fait foi.</p>
    <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Code</th><th>Module</th><th>h / semaine</th><th>Année</th><th>Annuel <span class="muted">(optionnel)</span></th><th>Salle exigée</th><th></th></tr></thead>
      <tbody id="cm-body">${(e.modules || []).map(row).join("") || row()}</tbody></table></div>
    <div class="row" style="gap:14px;margin-top:6px;align-items:center;">
      <button class="btn-ghost btn-sm" id="cm-add">+ Module</button>
      <span class="muted" id="cm-tot"></span>
    </div>
    <div class="actions" style="margin-top:14px;">${c ? `<button class="btn-ghost btn-sm btn-danger" id="cf-del">Supprimer</button>` : ""}<button class="btn-primary" id="cf-save">Enregistrer</button></div>`);
  // Total hebdomadaire vivant, par année : le chiffre qu'un directeur vérifie.
  const totaux = () => {
    const par = {};
    $$("#cm-body tr").forEach((tr) => {
      const h = parseFloat($(".cm-w", tr)?.value || "");
      const y = $('.cm[data-f="year"]', tr)?.value || "?";
      if (!isNaN(h)) par[y] = Math.round(((par[y] || 0) + h) * 10) / 10;
    });
    const txt = Object.entries(par).sort().map(([y, h]) => `${y === "?" ? "sans année" : y + "re/e année"} : ${h} h/semaine`).join("  ·  ");
    $("#cm-tot").textContent = txt || "";
  };
  $("#cm-add").onclick = () => { $("#cm-body").insertAdjacentHTML("beforeend", row()); totaux(); };
  $("#cm-body").addEventListener("click", (ev) => { if (ev.target.closest(".cm-del")) { ev.target.closest("tr").remove(); totaux(); } });
  $("#cm-body").addEventListener("input", totaux);
  totaux();
  $("#cf-save").onclick = async () => {
    const b = {}; $$(".cf").forEach((i) => (b[i.dataset.f] = i.value));
    if (!String(b.name || "").trim()) return;
    b.modules = $$("#cm-body tr").map((tr) => { const m = {}; $$(".cm", tr).forEach((i) => (m[i.dataset.f] = i.value)); return m; }).filter((m) => m.label || m.code);
    if (c) await api.patch(`/api/curricula/${c.id}`, b); else await api.post("/api/curricula", b);
    closeModals(); renderReferentiels();
  };
  if (c) $("#cf-del").onclick = async () => {
    if (!confirm("Supprimer ce référentiel ?")) return;
    await api.del(`/api/curricula/${c.id}`); closeModals(); renderReferentiels();
  };
}

// ---------- Salles, classes et calendrier ----------
async function renderSallesClasses() {
  const [campuses, rooms, classes, curricula, periods] = await Promise.all([
    api.get("/api/campuses"), api.get("/api/rooms"), api.get("/api/classes"), api.get("/api/curricula"), api.get("/api/periods")]);
  if (!planState.campusId && campuses[0]) planState.campusId = campuses[0].id;
  const usage = await api.get(`/api/schedule/rooms-usage?campusId=${planState.campusId}&from=${planState.week}&to=${addDays(planState.week, 6)}`);
  const byRoom = new Map((usage.rows || []).map((r) => [r.roomId, r]));
  const mine = (arr) => arr.filter((x) => !x.campusId || x.campusId === planState.campusId);

  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="sc-room">+ Salle</button><button class="btn-ghost btn-sm" id="sc-class">+ Classe</button><button class="btn-primary btn-sm" id="sc-period">+ Période</button>`;
  $("#view").innerHTML = `
    <div class="row" style="gap:8px;margin-bottom:12px;align-items:center;">
      <select class="txt" id="sc-campus" style="max-width:220px;">${campuses.map((c) => `<option value="${c.id}" ${planState.campusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <span class="muted">Taux d'occupation calculé sur la semaine du ${frDate(planState.week)}</span>
    </div>
    <h3 class="sec">Salles</h3>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Salle</th><th>Type</th><th>Places</th><th>Séances</th><th>Heures</th><th>Occupation</th><th></th></tr></thead><tbody>
      ${mine(rooms).map((r) => { const u = byRoom.get(r.id) || {}; return `<tr>
        <td><b>${esc(r.name)}</b>${(r.equipment || []).length ? `<br><span class="muted" style="font-size:12px;">${r.equipment.map(esc).join(", ")}</span>` : ""}</td>
        <td><span class="pill">${esc(r.kind || "standard")}</span></td><td class="num">${r.places ?? "—"}</td>
        <td class="num">${u.sessions ?? 0}</td><td class="num">${u.hours ?? 0}</td>
        <td><div class="sim-gauge"><span style="width:${Math.min(100, u.rate || 0)}%"></span></div><span class="muted" style="font-size:12px;">${u.rate ?? 0} %</span></td>
        <td><button class="btn-ghost btn-sm sc-redit" data-id="${r.id}">✎</button></td></tr>`; }).join("")
        || '<tr><td colspan="7" class="muted">Aucune salle. Sans salle déclarée, le générateur ne peut rien placer.</td></tr>'}
    </tbody></table></div>
    ${usage.unused?.length ? `<p class="hint muted">Inoccupées cette semaine : ${usage.unused.map(esc).join(", ")}.</p>` : ""}

    <h3 class="sec" style="margin-top:18px;">Classes</h3>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Classe</th><th>Référentiel</th><th>Année</th><th>Effectif</th><th></th></tr></thead><tbody>
      ${mine(classes).map((k) => `<tr><td><b>${esc(k.name)}</b></td>
        <td>${esc(curricula.find((c) => c.id === k.curriculumId)?.name || "—")}${k.modalite === "alternance" ? ' <span class="pill p-warn">alternance</span>' : ""}${k.rythme ? `<br><span class="muted" style="font-size:12px;">${esc(k.rythme)}</span>` : ""}</td>
        <td class="num">${k.year ?? "—"}</td><td class="num">${k.size ?? "de la filière"}</td>
        <td><button class="btn-ghost btn-sm sc-kedit" data-id="${k.id}">✎</button></td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">Aucune classe.</td></tr>'}
    </tbody></table></div>

    <h3 class="sec" style="margin-top:18px;">Calendrier — vacances, examens, stages</h3>
    <div class="list">${mine(periods).map((p) => `<div class="item">
      <span class="pill">${esc(PERIOD_KIND[p.kind] || p.kind)}</span>
      <span class="grow">${esc(p.label || "")} <span class="muted">du ${frDate(p.from)} au ${frDate(p.to)}</span>${p.classId ? ` <span class="muted">· ${esc(classes.find((k) => k.id === p.classId)?.name || "")}</span>` : ""}</span>
      <button class="btn-ghost btn-sm sc-pdel" data-id="${p.id}">×</button></div>`).join("")
      || '<p class="muted">Aucune période. Sans vacances déclarées, une série hebdomadaire posera des cours en plein congé.</p>'}</div>`;

  $("#sc-campus").onchange = (e) => { planState.campusId = e.target.value; renderSallesClasses(); };
  $("#sc-room").onclick = () => openRoomForm(null);
  $("#sc-class").onclick = () => openClassForm(null, curricula, campuses);
  $("#sc-period").onclick = () => openPeriodForm(mine(classes));
  $$(".sc-redit").forEach((b) => b.addEventListener("click", () => openRoomForm(rooms.find((r) => r.id === b.dataset.id))));
  $$(".sc-kedit").forEach((b) => b.addEventListener("click", () => openClassForm(classes.find((k) => k.id === b.dataset.id), curricula, campuses)));
  $$(".sc-pdel").forEach((b) => b.addEventListener("click", async () => { await api.del(`/api/periods/${b.dataset.id}`); renderSallesClasses(); }));
}
function openRoomForm(r) {
  const e = r || {};
  openModal(r ? "Modifier la salle" : "Nouvelle salle", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nom *</label><input class="txt rf" data-f="name" value="${esc(e.name || "")}"></div>
      <div><label class="field-label">Places</label><input class="txt rf" data-f="places" type="number" value="${e.places ?? ""}"></div>
      <div><label class="field-label">Type</label><input class="txt rf" data-f="kind" value="${esc(e.kind || "standard")}" placeholder="standard, optique, informatique…"></div>
      <div><label class="field-label">Équipements</label><input class="txt" id="rf-eq" value="${esc((e.equipment || []).join(", "))}" placeholder="banc, réfracteur…"></div>
    </div>
    <p class="hint muted">Le « type » et les équipements sont ce qu'un module peut exiger : un TP d'optique posé dans une salle banale sera signalé.</p>
    <div class="actions" style="margin-top:12px;">${r ? `<button class="btn-ghost btn-sm btn-danger" id="rf-del">Supprimer</button>` : ""}<button class="btn-primary" id="rf-save">Enregistrer</button></div>`);
  $("#rf-save").onclick = async () => {
    const b = { campusId: planState.campusId }; $$(".rf").forEach((i) => (b[i.dataset.f] = i.value));
    if (!String(b.name || "").trim()) return;
    b.equipment = $("#rf-eq").value.split(",").map((x) => x.trim()).filter(Boolean);
    if (r) await api.patch(`/api/rooms/${r.id}`, b); else await api.post("/api/rooms", b);
    closeModals(); renderSallesClasses();
  };
  if (r) $("#rf-del").onclick = async () => { if (!confirm("Supprimer cette salle ?")) return; await api.del(`/api/rooms/${r.id}`); closeModals(); renderSallesClasses(); };
}
function openClassForm(k, curricula, campuses) {
  const e = k || {};
  const camp = campuses.find((c) => c.id === (e.campusId || planState.campusId));
  openModal(k ? "Modifier la classe" : "Nouvelle classe", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Nom *</label><input class="txt kf" data-f="name" value="${esc(e.name || "")}"></div>
      <div><label class="field-label">Année</label><input class="txt kf" data-f="year" type="number" value="${e.year ?? ""}"></div>
      <div><label class="field-label">Référentiel</label><select class="txt kf" data-f="curriculumId"><option value="">—</option>${curricula.map((c) => `<option value="${c.id}" ${e.curriculumId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label class="field-label">Filière</label><select class="txt kf" data-f="filiereId"><option value="">—</option>${(camp?.filieres || []).map((f) => `<option value="${f.id}" ${e.filiereId === f.id ? "selected" : ""}>${esc(f.nom)}</option>`).join("")}</select></div>
      <div><label class="field-label">Modalité</label><select class="txt kf" data-f="modalite">${[["initial","Initial"],["alternance","Alternance"],["mixte","Mixte"]].map(([k2,l])=>`<option value="${k2}" ${(e.modalite||"initial")===k2?"selected":""}>${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Rythme <span class="muted">(alternance)</span></label><input class="txt kf" data-f="rythme" value="${esc(e.rythme || "")}" placeholder="2 sem. école / 2 sem. entreprise"></div>
      <div><label class="field-label">Semaines de cours dans l'année</label><input class="txt kf" data-f="weeksAtSchool" type="number" value="${e.weeksAtSchool ?? ""}" placeholder="auto"></div>
      <div><label class="field-label">Effectif <span class="muted">(vide = filière)</span></label><input class="txt kf" data-f="size" type="number" value="${e.size ?? ""}"></div>
      <p class="hint muted" style="grid-column:1/-1;">En alternance, le volume du référentiel se comprime dans moins de semaines : laisse « auto » (moitié de l'année) ou saisis le nombre exact. Déclare aussi les semaines en entreprise dans le calendrier, sinon la récurrence posera des cours pendant que la classe est en poste.</p>
    </div>
    <div class="actions" style="margin-top:12px;">${k ? `<button class="btn-ghost btn-sm btn-danger" id="kf-del">Supprimer</button>` : ""}<button class="btn-primary" id="kf-save">Enregistrer</button></div>`);
  $("#kf-save").onclick = async () => {
    const b = { campusId: planState.campusId }; $$(".kf").forEach((i) => (b[i.dataset.f] = i.value));
    if (!String(b.name || "").trim()) return;
    if (k) await api.patch(`/api/classes/${k.id}`, b); else await api.post("/api/classes", b);
    closeModals(); renderSallesClasses();
  };
  if (k) $("#kf-del").onclick = async () => { if (!confirm("Supprimer cette classe ?")) return; await api.del(`/api/classes/${k.id}`); closeModals(); renderSallesClasses(); };
}
function openPeriodForm(classes) {
  openModal("Nouvelle période", `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
      <div><label class="field-label">Type</label><select class="txt pf" data-f="kind">${Object.entries(PERIOD_KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div><label class="field-label">Libellé</label><input class="txt pf" data-f="label" placeholder="Toussaint"></div>
      <div><label class="field-label">Du *</label><input class="txt pf" data-f="from" type="date"></div>
      <div><label class="field-label">Au *</label><input class="txt pf" data-f="to" type="date"></div>
      <div style="grid-column:1/-1;"><label class="field-label">Classe concernée <span class="muted">(pour un stage — vide = tout le campus)</span></label>
        <select class="txt pf" data-f="classId"><option value="">Tout le campus</option>${classes.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></div>
    </div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="pf-save">Enregistrer</button></div>`);
  $("#pf-save").onclick = async () => {
    const b = { campusId: planState.campusId }; $$(".pf").forEach((i) => (b[i.dataset.f] = i.value));
    if (!b.from || !b.to) return;
    await api.post("/api/periods", b); closeModals(); renderSallesClasses();
  };
}


// ---------- Qui enseigne quoi : proposition IA, validation humaine ----------
// C'est l'information qui conditionne toute la qualité du planning. Sans matières
// déclarées, le générateur traite chacun comme polyvalent et affecte au hasard.
async function openAssignments(curriculumId) {
  openModal("Qui enseigne quoi", '<p class="muted">Analyse du référentiel et des fiches intervenants…</p>');
  const r = await api.post("/api/schedule/suggest-assignments", { curriculumId, campusId: planState.campusId });
  if (r?.error) { $(".modal-body").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
  const conf = { haute: "p-ok", moyenne: "p-warn", faible: "p-off" };
  $(".modal-body").innerHTML = `
    <p class="muted" style="font-size:13.5px;">Proposition à partir des matières déjà déclarées et des libellés. <b>Rien n'est écrit sans ta validation.</b> Décoche ce qui ne convient pas.</p>
    <div class="card" style="overflow-x:auto;margin-top:10px;"><table class="net-table">
      <thead><tr><th></th><th>Module</th><th>Intervenants proposés</th><th>Confiance</th><th>Pourquoi</th></tr></thead><tbody>
      ${r.assignments.map((a, i) => `<tr>
        <td><input type="checkbox" class="as-ok" data-i="${i}" ${a.confidence !== "faible" ? "checked" : ""}></td>
        <td><b>${esc(a.moduleLabel)}</b></td>
        <td>${a.teachers.map((t) => esc(t.name)).join(", ")}</td>
        <td><span class="pill ${conf[a.confidence]}">${esc(a.confidence)}</span></td>
        <td class="muted" style="font-size:12.5px;">${esc(a.rationale)}</td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">Aucune correspondance proposée.</td></tr>'}
    </tbody></table></div>
    ${r.unmatched?.length ? `<div class="card" style="border-left:3px solid #8A4B4B;padding:12px;margin-top:10px;">
      <b>Modules sans intervenant identifié</b>${r.unmatched.map((u) => `<div class="muted" style="font-size:13px;">${esc(u.moduleLabel || "")} — ${esc(u.reason || "")}</div>`).join("")}
      <p class="hint muted">C'est une information, pas un échec : il manque une compétence à recruter ou à déclarer.</p></div>` : ""}
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="as-save">Appliquer aux fiches cochées</button></div>`;
  $("#as-save").onclick = async () => {
    const keep = $$(".as-ok").filter((c) => c.checked).map((c) => r.assignments[+c.dataset.i]);
    if (!keep.length) { closeModals(); return; }
    const out = await api.post("/api/schedule/apply-assignments", { assignments: keep });
    alert(`${out.updated} fiche(s) enrichie(s). Le générateur saura désormais qui peut enseigner quoi.`);
    closeModals(); renderReferentiels();
  };
}

// ---------- Vue : Projets (conduite de projet) ----------
// Ce module ne recouvre NI les ouvertures de campus NI les plans d'action : ce
// sont des registres distincts, et on n'y touche pas. Ici vivent les projets
// qui n'entrent dans aucune case et qui se pilotent avec des dépendances, une
// charge et une date de fin CALCULÉE — jamais saisie.
const PJ = { campus: "", ouvert: null, onglet: "planning", zoom: null, data: null };

const pjJour = (iso) => new Date(String(iso).slice(0, 10) + "T00:00:00Z");
const pjAdd = (iso, n) => new Date(pjJour(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
const pjDiff = (a, b) => Math.round((pjJour(b) - pjJour(a)) / 86400000);
const pjDate = (iso) => (iso ? pjJour(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const pjPct = (v) => Math.round((v || 0) * 100);
const pjEcart = (n) => (n == null ? '<span class="muted">—</span>'
  : n > 0 ? `<span class="pj-neg">+${n} j</span>` : n < 0 ? `<span class="pj-pos">${n} j</span>` : '<span class="muted">à l\'heure</span>');

// Envoi d'une mutation qui peut se heurter à une garde « motif requis ». Le
// serveur refuse (409) tant qu'aucune raison n'est écrite ; on la demande une
// fois, puis on renvoie. C'est la trace qui manque partout ailleurs : une date
// d'engagement qui bouge sans motif, ce sont trois plannings en circulation.
async function pjAvecMotif(appel) {
  let r = await appel(null);
  if (r?.motifRequis || (r?.forcable && r?.error)) {
    const motif = prompt(`${r.error}\n\nMotif (obligatoire) :`, "");
    if (!motif || !motif.trim()) return null;
    r = await appel(motif.trim());
  }
  if (r?.error) { alert(r.error); return null; }
  return r;
}

async function renderProjets() {
  if (PJ.ouvert) return renderFicheProjet();
  return renderPortefeuilleProjets();
}

// --- Portefeuille : la réponse à « lequel me coûtera cher si je ne m'en
// occupe pas cette semaine ». Pas de note sur 100 : des faits, comptés.
async function renderPortefeuilleProjets() {
  const q = PJ.campus ? `?campusId=${encodeURIComponent(PJ.campus)}` : "";
  const d = await api.get("/api/projets" + q);
  if (d?.error) { $("#view").innerHTML = `<p class="neg">${esc(d.error)}</p>`; return; }
  PJ.referentiels = d.referentiels;

  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="pj-new">+ Projet</button>`;
  const NIV = { bloquant: "pj-a-bloquant", important: "pj-a-important", conseille: "pj-a-conseille" };

  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px;align-items:flex-end;gap:10px;flex-wrap:wrap;">
      <div><label class="field-label">Campus</label><select id="pj-campus">
        <option value="">Tous (réseau compris)</option>
        ${state.campuses.map((c) => `<option value="${c.id}" ${c.id === PJ.campus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select></div>
    </div>
    <div class="kpis" style="margin-bottom:14px;">
      ${fkpi(d.actifs, "projets actifs")}
      ${fkpi(d.enAlerte, "en alerte", d.enAlerte ? "bad" : "good")}
      ${fkpi(d.nonCalculables, "plans non calculables", d.nonCalculables ? "bad" : "good")}
    </div>
    <div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Projet</th><th>Campus</th><th>Pilote</th><th>Fin prévue</th><th>Dérive</th>
        <th>Avancement</th><th>Reste</th><th>Prochain jalon</th><th>Ce qui cloche</th></tr></thead>
      <tbody>${d.lignes.length ? d.lignes.map((l) => `<tr class="pj-row" data-id="${l.id}">
        <td><b>${esc(l.nom)}</b><br><span class="muted" style="font-size:12px;">${esc(d.referentiels.statutsProjet[l.statut]?.label || l.statut)}</span></td>
        <td>${esc(campusName(l.campusId) || "réseau")}</td>
        <td>${esc(l.pilote || "—")}</td>
        <td>${l.calculable ? pjDate(l.fin) : '<span class="pj-neg">—</span>'}</td>
        <td>${l.calculable ? pjEcart(l.derive) : ""}</td>
        <td>${l.calculable ? `<div class="pj-jauge" title="${pjPct(l.avancement)} %"><span style="width:${pjPct(l.avancement)}%"></span></div>` : ""}</td>
        <td>${l.calculable ? `${l.resteAFaireJours} j` : ""}</td>
        <td>${l.prochainJalon ? `${esc(l.prochainJalon.titre)}<br><span class="muted" style="font-size:12px;">${pjDate(l.prochainJalon.date)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${l.alertes.length ? l.alertes.map((a) => `<div class="${NIV[a.niveau]}">${esc(a.texte)}</div>`).join("") : '<span class="muted">rien à signaler</span>'}</td>
      </tr>`).join("") : `<tr><td colspan="9" class="muted">Aucun projet. Les ouvertures de campus et les plans d'action restent dans leurs rubriques : ici vivent les projets qui n'y entrent pas.</td></tr>`}
      </tbody></table></div>

    <div class="section-title">Modèles</div>
    <p class="muted" style="font-size:13.5px;margin:-6px 0 10px;">Aucune trame n'est livrée avec le module : un modèle décidé par l'éditeur décrit son idée du métier, pas le vôtre. Un modèle se capture depuis un projet qui a tourné — bouton « Enregistrer comme modèle » sur une fiche.</p>
    ${d.modeles.length ? `<div class="card" style="overflow-x:auto;"><table class="net-table">
      <thead><tr><th>Modèle</th><th>Tâches</th><th>Description</th><th></th></tr></thead><tbody>
      ${d.modeles.map((m) => `<tr><td><b>${esc(m.nom)}</b></td><td>${m.taches}</td><td class="muted">${esc(m.description || "")}</td>
        <td><button class="btn-ghost btn-sm pj-mod-use" data-id="${m.id}">Lancer un projet</button>
        ${isAdmin() ? `<button class="btn-ghost btn-sm pj-mod-del" data-id="${m.id}">Supprimer</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted">Aucun modèle capturé pour l\'instant.</p>'}`;

  $("#pj-campus").onchange = (e) => { PJ.campus = e.target.value; renderPortefeuilleProjets(); };
  $("#pj-new").onclick = () => openProjetForm(null, d.modeles);
  $$(".pj-row").forEach((tr) => { tr.onclick = () => { PJ.ouvert = tr.dataset.id; PJ.onglet = "planning"; PJ.zoom = null; renderProjets(); }; });
  $$(".pj-mod-use").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openProjetForm(null, d.modeles, b.dataset.id); }; });
  $$(".pj-mod-del").forEach((b) => { b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("Supprimer ce modèle ? Les projets déjà créés à partir de lui ne bougent pas.")) return;
    const r = await api.del(`/api/projets-modeles/${b.dataset.id}`);
    if (r?.error) return alert(r.error);
    renderPortefeuilleProjets();
  }; });
}

// --- Fiche projet ---
async function renderFicheProjet() {
  const d = await api.get(`/api/projets/${PJ.ouvert}`);
  if (d?.error) { PJ.ouvert = null; alert(d.error); return renderProjets(); }
  PJ.data = d;
  const p = d.projet, r = d.resume;

  $("#topbar-actions").innerHTML = `
    <button class="btn-ghost btn-sm" id="pj-back">← Portefeuille</button>
    <button class="btn-ghost btn-sm" id="pj-edit">Cadre du projet</button>
    <button class="btn-primary btn-sm" id="pj-add">+ Tâche</button>`;

  const entete = `
    <div class="row" style="align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="flex:1;min-width:240px;">
        <h2 style="margin:0 0 2px;">${esc(p.nom)}</h2>
        <div class="muted" style="font-size:13px;">${esc(campusName(p.campusId) || "projet réseau")}${p.pilote ? ` · piloté par ${esc(p.pilote)}` : ""} · début ${pjDate(p.debut)}</div>
      </div>
      <div class="row pj-actions" style="gap:6px;flex-wrap:wrap;">
        <button class="btn-ghost btn-sm" id="pj-simuler">Simuler</button>
        <button class="btn-ghost btn-sm" id="pj-niveler">Niveler la charge</button>
        <button class="btn-ghost btn-sm" id="pj-ref">${p.reference ? "Nouvelle référence" : "Figer la référence"}</button>
        <button class="btn-ghost btn-sm" id="pj-modele">Enregistrer comme modèle</button>
        <button class="btn-ghost btn-sm" id="pj-export">Excel</button>
      </div>
    </div>`;

  if (!d.ok) {
    $("#view").innerHTML = `${entete}
      <div class="card card-pad" style="border-left:4px solid var(--danger);">
        <b>Ce plan n'est pas calculable — aucune date n'est affichée.</b>
        <p class="sub muted">Un planning faux est plus dangereux qu'un planning absent : on prend des décisions avec. Ce qui bloque :</p>
        <ul style="margin:6px 0 0;padding-left:18px;">${d.erreurs.map((e) => `<li>${esc(e.message)}</li>`).join("")}</ul>
      </div>
      <div class="section-title">Tâches</div>${pjTableTaches(d)}`;
    pjBrancherEntete(d);
    pjBrancherTable(d);
    return;
  }

  const surcharge = (d.charge?.ressources || []).reduce((s, x) => s + x.nbJoursSurcharge, 0);
  const onglets = [["planning", "Planning"], ["taches", `Tâches (${d.taches.filter((t) => !t.synthese).length})`],
    ["charge", `Charge${surcharge ? " ⚠" : ""}`], ["copil", "COPIL"], ["journal", `Journal (${d.journal.length})`]];

  $("#view").innerHTML = `${entete}
    <div class="kpis" style="margin-bottom:12px;">
      ${fkpi(pjDate(r.fin), "fin prévue")}
      ${fkpi(pjPct(r.avancement) + " %", "avancement constaté")}
      ${fkpi(r.resteAFaireJours + " j", "reste à faire")}
      ${fkpi(d.derive ? (d.derive.finEcart > 0 ? "+" : "") + d.derive.finEcart + " j" : "—", d.derive ? "dérive / référence" : "sans référence", d.derive?.finEcart > 0 ? "bad" : d.derive ? "good" : "")}
      ${fkpi(r.critiques.length, "tâches critiques")}
      ${fkpi(surcharge, "jours de surcharge", surcharge ? "bad" : "good")}
    </div>
    ${pjBandeaux(d)}
    <div class="row pj-actions" style="gap:6px;margin-bottom:10px;flex-wrap:wrap;">
      ${onglets.map(([k, l]) => `<button class="btn-ghost btn-sm pj-tab ${PJ.onglet === k ? "btn-primary" : ""}" data-t="${k}">${l}</button>`).join("")}
    </div>
    <div id="pj-contenu"></div>`;

  $("#pj-contenu").innerHTML = PJ.onglet === "planning" ? pjGantt(d)
    : PJ.onglet === "taches" ? pjTableTaches(d)
    : PJ.onglet === "charge" ? pjCharge(d)
    : PJ.onglet === "copil" ? '<p class="muted">Chargement…</p>'
    : pjJournal(d);

  pjBrancherEntete(d);
  $$(".pj-tab").forEach((b) => { b.onclick = () => { PJ.onglet = b.dataset.t; renderFicheProjet(); }; });
  if (PJ.onglet === "planning") pjBrancherGantt(d);
  if (PJ.onglet === "taches") pjBrancherTable(d);
  if (PJ.onglet === "charge") pjBrancherCharge(d);
  if (PJ.onglet === "copil") pjRendreCopil(d);
}

function pjBandeaux(d) {
  const r = d.resume;
  const bloc = (couleur, titre, corps) => `<div class="card card-pad" style="border-left:4px solid ${couleur};margin-bottom:10px;">
    <b>${titre}</b><div style="font-size:13.5px;margin-top:4px;">${corps}</div></div>`;
  let out = "";
  if (r.echeancesDepassees.length) {
    out += bloc("var(--danger)", "Échéances dépassées",
      `${r.echeancesDepassees.map((e) => `« ${esc(e.titre)} » : échéance au ${pjDate(e.echeance)}, fin prévue au ${pjDate(e.fin)} — <b>${e.retard} jour(s) ouvré(s) de retard</b>.`).join("<br>")}
       <div class="muted" style="margin-top:4px;">L'échéance n'a pas comprimé le plan : elle affiche le retard. Il se traite en arbitrant le contenu, la charge ou la date — pas en raccourcissant les tâches dans le tableur.</div>`);
  }
  if (r.conflits.length) {
    out += bloc("var(--warn)", "Dates imposées en conflit",
      r.conflits.map((c) => `« ${esc(c.titre)} » — ${c.conflits.map(esc).join(" ; ")}`).join("<br>"));
  }
  if (d.erreurs?.length) {
    out += bloc("var(--warn)", "À corriger", d.erreurs.map((e) => esc(e.message)).join("<br>"));
  }
  return out;
}

function pjBrancherEntete(d) {
  $("#pj-back").onclick = () => { PJ.ouvert = null; PJ.data = null; renderProjets(); };
  $("#pj-edit").onclick = () => openProjetForm(d.projet);
  $("#pj-add").onclick = () => openTacheForm(d, null);
  if ($("#pj-export")) $("#pj-export").onclick = () => window.open(`/api/projets/${d.projet.id}/export`, "_blank");
  if ($("#pj-simuler")) $("#pj-simuler").onclick = () => openSimulationProjet(d);
  if ($("#pj-niveler")) $("#pj-niveler").onclick = () => openNivellement(d);
  if ($("#pj-modele")) $("#pj-modele").onclick = () => openModeleProjet(d);
  if ($("#pj-ref")) $("#pj-ref").onclick = async (ev) => guard(ev.currentTarget, async () => {
    const motif = prompt("Figer la référence — motif (ex. « validée en comité du 12 mars ») :", "");
    if (motif === null) return;
    const r = await pjAvecMotif((m) => api.post(`/api/projets/${d.projet.id}/reference`, { motif: motif || m || "", confirmer: !!m || undefined }));
    if (r) renderFicheProjet();
  });
}

// --- Diagramme ---
// Trois partis pris qui le distinguent d'un Gantt de tableur :
//   • les jours non travaillés sont GRISÉS (week-ends, fériés, fermetures du
//     site) — une barre continue par-dessus la fermeture de Noël promet deux
//     semaines de travail qui n'auront pas lieu ;
//   • la référence figée s'affiche en ombre sous la barre : la dérive se voit,
//     elle ne se déduit pas ;
//   • le chemin critique est en corail, et rien d'autre ne l'est.
const PJ_ROW = 30, PJ_HEAD = 46, PJ_GUT = 8;

function pjGantt(d) {
  const taches = d.taches;
  if (!taches.length) return '<div class="card card-pad muted">Aucune tâche. Le bouton « + Tâche » en haut à droite ouvre la première.</div>';
  const dates = taches.flatMap((t) => [t.debut, t.fin]).filter(Boolean).sort();
  const d0 = pjAdd(dates[0], -4);
  const d1 = pjAdd(dates[dates.length - 1], 8);
  const span = Math.max(1, pjDiff(d0, d1) + 1);
  const PX = PJ.zoom || (span <= 60 ? 16 : span <= 140 ? 8 : span <= 380 ? 4 : span <= 900 ? 2 : 1);
  const X = (iso) => pjDiff(d0, iso) * PX;
  const W = span * PX;
  const H = PJ_HEAD + taches.length * PJ_ROW;
  const auj = d.resume.aujourdhui;
  const refLignes = new Map((d.derive?.lignes || []).map((l) => [l.id, l]));

  let fond = "";
  // Jours non travaillés : au-dessous de 4 px par jour, le grisé devient une
  // bouillie — on s'abstient plutôt que de salir le fond.
  if (PX >= 4) {
    for (const j of (d.nonOuvres || [])) {
      if (j < d0 || j > d1) continue;
      fond += `<rect x="${X(j)}" y="${PJ_HEAD}" width="${PX}" height="${H - PJ_HEAD}" fill="rgba(13,27,42,.05)"/>`;
    }
  }
  // Bandes de mois + libellés.
  let axe = "";
  let m = d0.slice(0, 8) + "01";
  while (m <= d1) {
    const x = X(m);
    const label = pjJour(m).toLocaleDateString("fr-FR", { month: "short", year: PX < 6 ? "2-digit" : undefined });
    if (x > -40) {
      axe += `<line x1="${x}" y1="24" x2="${x}" y2="${H}" stroke="var(--line)" stroke-width="1"/>`;
      axe += `<text x="${x + 4}" y="38" class="pj-mois">${esc(label)}</text>`;
    }
    m = pjAdd(m, 32).slice(0, 8) + "01";
  }
  const xAuj = X(auj);
  const ligneAuj = xAuj >= 0 && xAuj <= W
    ? `<line x1="${xAuj}" y1="20" x2="${xAuj}" y2="${H}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3"/>
       <text x="${xAuj + 4}" y="16" class="pj-auj">aujourd'hui</text>` : "";

  let barres = "";
  const pos = new Map();
  taches.forEach((t, i) => {
    const y = PJ_HEAD + i * PJ_ROW;
    barres += `<rect x="0" y="${y}" width="${W}" height="${PJ_ROW}" fill="${i % 2 ? "rgba(13,27,42,.018)" : "transparent"}"/>`;
    if (!t.debut) return;
    const x = X(t.debut);
    const w = Math.max(PX * 0.6, (pjDiff(t.debut, t.fin || t.debut) + 1) * PX);
    const yb = y + 7;
    pos.set(t.id, { x, w, y: y + PJ_ROW / 2 });

    // Référence figée : ombre grise sous la barre.
    const ref = refLignes.get(t.id);
    if (ref?.referenceDebut && ref?.referenceFin) {
      const xr = X(ref.referenceDebut);
      const wr = Math.max(2, (pjDiff(ref.referenceDebut, ref.referenceFin) + 1) * PX);
      barres += `<rect x="${xr}" y="${y + PJ_ROW - 7}" width="${wr}" height="4" rx="2" fill="rgba(13,27,42,.22)"><title>référence : ${esc(ref.referenceDebut)} → ${esc(ref.referenceFin)}</title></rect>`;
    }

    const couleur = t.statut === "abandonnee" ? "#9aa5ad" : t.statut === "faite" ? "var(--teal-2)" : t.critique ? "var(--accent)" : "var(--marine)";
    const infobulle = `${t.code} ${t.titre}\n${t.debut} → ${t.fin}\n${t.jalon ? "jalon" : t.dureeJours + " j ouvrés"}${t.synthese ? "" : ` · reste ${t.resteAFaire} j`}${t.synthese ? "" : `\nmarge totale ${t.margeTotale} j${t.critique ? " — chemin critique" : ""}`}${t.echeance ? `\néchéance ${t.echeance}${t.echeanceDepassee ? ` — ${t.echeanceDepassee} j de retard` : ""}` : ""}`;

    if (t.jalon) {
      const cx = x + PX / 2, cy = y + PJ_ROW / 2, s = 8;
      barres += `<g class="pj-bar" data-t="${t.id}"><polygon points="${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}"
        fill="${t.statut === "faite" ? "var(--teal-2)" : t.echeanceDepassee ? "var(--danger)" : couleur}" stroke="#fff" stroke-width="1.5"><title>${esc(infobulle)}</title></polygon></g>`;
    } else if (t.synthese) {
      barres += `<g class="pj-bar" data-t="${t.id}"><path d="M${x},${yb + 2} L${x + w},${yb + 2} L${x + w},${yb + 9} L${x + w - 5},${yb + 4} L${x + 5},${yb + 4} L${x},${yb + 9} Z"
        fill="var(--ink)" opacity=".75"><title>${esc(infobulle)}</title></path></g>`;
    } else {
      const wAv = Math.max(0, Math.min(w, w * (t.avancement || 0)));
      barres += `<g class="pj-bar" data-t="${t.id}">
        <rect x="${x}" y="${yb}" width="${w}" height="${PJ_ROW - 15}" rx="3" fill="${couleur}" opacity=".24"/>
        ${wAv > 0.5 ? `<rect x="${x}" y="${yb}" width="${wAv}" height="${PJ_ROW - 15}" rx="3" fill="${couleur}"/>` : ""}
        <rect x="${x}" y="${yb}" width="${w}" height="${PJ_ROW - 15}" rx="3" fill="transparent" stroke="${couleur}" stroke-width="1"><title>${esc(infobulle)}</title></rect>
        ${t.echeance ? `<line x1="${X(t.echeance) + PX}" y1="${y + 3}" x2="${X(t.echeance) + PX}" y2="${y + PJ_ROW - 3}" stroke="${t.echeanceDepassee ? "var(--danger)" : "var(--warn)"}" stroke-width="2"/>` : ""}
      </g>`;
    }
  });

  // Flèches de dépendance.
  let liens = "";
  for (const t of taches) {
    if (t.synthese) continue;
    for (const l of (t.liens || [])) {
      const a = pos.get(l.deId), b = pos.get(t.id);
      if (!a || !b) continue;
      const depuisFin = l.type === "FD" || l.type === "FF";
      const x1 = depuisFin ? a.x + a.w : a.x;
      const versDebut = l.type === "FD" || l.type === "DD";
      const x2 = versDebut ? b.x : b.x + b.w;
      const coude = Math.max(x1 + 7, x2 - 10);
      liens += `<path d="M${x1},${a.y} H${coude} V${b.y} H${x2}" fill="none" stroke="rgba(13,27,42,.4)" stroke-width="1" marker-end="url(#pj-fleche)"/>`;
    }
  }

  const gauche = taches.map((t) => `<div class="pj-nom ${t.critique && !t.synthese ? "pj-crit" : ""}" data-t="${t.id}" style="padding-left:${8 + (t.niveau || 0) * 14}px;">
      <span class="pj-code">${esc(t.code || "")}</span>
      <span class="pj-titre ${t.statut === "faite" ? "pj-faite" : ""}">${t.jalon ? "◆ " : ""}${esc(t.titre)}</span>
    </div>`).join("");

  return `<div class="card" style="padding:0;overflow:hidden;">
    <div class="row pj-actions" style="gap:6px;padding:10px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center;">
      <span class="muted" style="font-size:12.5px;">Zoom</span>
      ${[["Jour", 16], ["Semaine", 8], ["Mois", 4], ["Année", 1.6]].map(([l, z]) => `<button class="btn-ghost btn-sm pj-zoom ${PJ.zoom === z ? "btn-primary" : ""}" data-z="${z}">${l}</button>`).join("")}
      <span style="flex:1"></span>
      <span class="pj-leg"><i style="background:var(--accent)"></i>chemin critique</span>
      <span class="pj-leg"><i style="background:var(--marine)"></i>tâche</span>
      <span class="pj-leg"><i style="background:var(--teal-2)"></i>faite</span>
      ${d.derive ? '<span class="pj-leg"><i style="background:rgba(13,27,42,.22)"></i>référence figée</span>' : ""}
    </div>
    <div class="pj-gantt">
      <div class="pj-gauche" style="padding-top:${PJ_HEAD}px;">${gauche}</div>
      <div class="pj-droite"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="pj-svg">
        <defs><marker id="pj-fleche" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" fill="rgba(13,27,42,.4)"/></marker></defs>
        ${fond}${axe}${barres}${liens}${ligneAuj}
      </svg></div>
    </div>
  </div>
  ${d.chemins?.length ? `<div class="section-title">Chemin critique</div>
    <div class="card card-pad"><p class="muted" style="font-size:13.5px;margin-top:0;">La chaîne, dans l'ordre : c'est là qu'un jour gagné est un jour gagné sur la fin du projet. Ailleurs, il est absorbé par la marge.</p>
    <div class="pj-chaine">${d.chemins[0].taches.map((t) => `<span class="pj-maillon">${esc(t.titre)}<span class="muted"> · ${t.duree} j</span></span>`).join('<span class="pj-fleche-txt">→</span>')}</div></div>` : ""}`;
}

function pjBrancherGantt(d) {
  $$(".pj-zoom").forEach((b) => { b.onclick = () => { PJ.zoom = Number(b.dataset.z); renderFicheProjet(); }; });
  $$(".pj-bar, .pj-nom").forEach((el) => { el.onclick = () => {
    const t = d.taches.find((x) => x.id === el.dataset.t);
    if (t) openTacheForm(d, t);
  }; });
  // Le diagramme s'ouvre sur aujourd'hui, pas sur le début d'un projet lancé
  // il y a huit mois.
  const droite = $(".pj-droite");
  if (droite) {
    const dates = d.taches.flatMap((t) => [t.debut, t.fin]).filter(Boolean).sort();
    if (dates.length) {
      const span = Math.max(1, pjDiff(pjAdd(dates[0], -4), pjAdd(dates[dates.length - 1], 8)) + 1);
      const PX = PJ.zoom || (span <= 60 ? 16 : span <= 140 ? 8 : span <= 380 ? 4 : span <= 900 ? 2 : 1);
      droite.scrollLeft = Math.max(0, pjDiff(pjAdd(dates[0], -4), d.resume.aujourdhui) * PX - 120);
    }
  }
}

// --- Tableau des tâches ---
// La colonne qui compte est « reste à faire », modifiable sur la ligne. C'est
// le geste quotidien : on ne demande jamais un pourcentage, on demande ce qu'il
// reste. Le pourcentage, lui, se déduit — et une tâche « à 90 % » depuis trois
// semaines se voit tout de suite, parce que son reste ne descend pas.
function pjTableTaches(d) {
  const noms = new Map(d.taches.map((t) => [t.id, t.titre]));
  const ST = d.referentiels.statutsTache;
  const lignes = d.taches.map((t) => {
    const retard = t.echeanceDepassee > 0;
    return `<tr class="${t.synthese ? "pj-tr-synth" : ""}">
      <td class="muted">${esc(t.code || "")}</td>
      <td style="padding-left:${6 + (t.niveau || 0) * 16}px;">
        <b class="${t.statut === "faite" ? "pj-faite" : ""}">${t.jalon ? "◆ " : ""}${esc(t.titre)}</b>
        ${t.critique && !t.synthese ? '<span class="pill overdue" style="margin-left:6px;">critique</span>' : ""}
        ${t.lot ? `<br><span class="muted" style="font-size:12px;">${esc(t.lot)}</span>` : ""}</td>
      <td>${t.jalon ? "—" : t.dureeJours + " j"}</td>
      <td>${pjDate(t.debut)}</td>
      <td class="${retard ? "pj-neg" : ""}">${pjDate(t.fin)}${retard ? `<br><span style="font-size:11.5px;">échéance ${pjDate(t.echeance)}</span>` : ""}</td>
      <td>${t.synthese || t.jalon ? "" : `<input class="pj-raf" type="number" min="0" step="0.5" value="${t.resteAFaire}" data-t="${t.id}" title="reste à faire, en jours ouvrés">`}</td>
      <td><div class="pj-jauge" title="${pjPct(t.avancement)} %"><span style="width:${pjPct(t.avancement)}%"></span></div></td>
      <td>${t.synthese ? "" : `<span class="${t.margeTotale < 0 ? "pj-neg" : t.margeTotale === 0 ? "muted" : ""}">${t.margeTotale} j</span>`}</td>
      <td>${t.synthese ? "" : `<select class="pj-statut out-st" data-t="${t.id}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === t.statut ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>`}</td>
      <td class="muted" style="font-size:12.5px;">${(t.liens || []).map((l) => `${esc(noms.get(l.deId) || "?")} <span class="pj-code">${l.type}${l.decalage ? (l.decalage > 0 ? "+" : "") + l.decalage : ""}</span>`).join("<br>") || "—"}</td>
      <td>${esc(t.responsable || t.role || "—")}</td>
      <td><button class="btn-ghost btn-sm pj-ed" data-t="${t.id}">Modifier</button>
        <button class="btn-ghost btn-sm pj-del" data-t="${t.id}">Suppr.</button></td>
    </tr>`;
  }).join("");
  return `<div class="card" style="overflow-x:auto;"><table class="net-table pj-table">
    <thead><tr><th>N°</th><th>Tâche</th><th>Durée</th><th>Début</th><th>Fin</th><th>Reste</th><th>Avancement</th><th>Marge</th><th>Statut</th><th>Dépend de</th><th>Qui</th><th></th></tr></thead>
    <tbody>${lignes || '<tr><td colspan="12" class="muted">Aucune tâche.</td></tr>'}</tbody></table></div>
    <p class="hint muted">Le début et la fin ne se saisissent pas : ils sont calculés depuis les durées, les liens et le calendrier. Pour tenir une date, posez une échéance sur la tâche — elle révélera le retard au lieu de le masquer.</p>`;
}

function pjBrancherTable(d) {
  $$(".pj-ed").forEach((b) => { b.onclick = () => openTacheForm(d, d.taches.find((t) => t.id === b.dataset.t)); });
  $$(".pj-del").forEach((b) => { b.onclick = async () => {
    const t = d.taches.find((x) => x.id === b.dataset.t);
    if (!confirm(`Supprimer « ${t.titre} » ?\n\nLes dépendances qui pointaient dessus seront retirées et ses sous-tâches remontées d'un niveau — sinon le plan deviendrait incalculable.`)) return;
    const r = await api.del(`/api/projets/${d.projet.id}/taches/${t.id}`);
    if (r?.error) return alert(r.error);
    renderFicheProjet();
  }; });
  $$(".pj-statut").forEach((s) => { s.onchange = async () => {
    // Qu'on ait appliqué ou annulé (motif refusé), on redessine : sinon le
    // menu resterait sur une valeur que le serveur n'a pas retenue.
    await pjAvecMotif((m) => api.patch(`/api/projets/${d.projet.id}/taches/${s.dataset.t}`, { statut: s.value, motif: m || undefined }));
    renderFicheProjet();
  }; });
  $$(".pj-raf").forEach((i) => { i.onchange = async () => {
    const t = d.taches.find((x) => x.id === i.dataset.t);
    const raf = Math.max(0, Number(i.value) || 0);
    // Saisir un reste inférieur à la durée, c'est avoir commencé. On le déduit
    // plutôt que de demander à l'utilisateur de cocher deux cases cohérentes.
    const statut = raf === 0 ? "faite" : raf < t.dureeJours ? "en_cours" : t.statut;
    await pjAvecMotif((m) => api.patch(`/api/projets/${d.projet.id}/taches/${t.id}`, { resteAFaire: raf, statut, motif: m || undefined }));
    renderFicheProjet();
  }; });
}

// --- Charge ---
function pjCharge(d) {
  const c = d.charge;
  if (!c?.ressources?.length) {
    return `<div class="card card-pad muted">Aucune ressource déclarée. Ajoutez-en dans « Cadre du projet » : sans capacité déclarée, la surcharge est invisible — et c'est elle qui fait glisser les plannings, pas les dépendances.</div>`;
  }
  const courbe = (r) => {
    if (!r.courbe.length) return "";
    const L = 3, H = 46;
    const W = Math.max(120, r.courbe.length * L);
    const max = Math.max(r.pic, r.capaciteJour, 1);
    const barres = r.courbe.map((p, i) => {
      const h = (p.v / max) * H;
      return `<rect x="${i * L}" y="${H - h}" width="${L - 0.5}" height="${h}" fill="${p.v > r.capaciteJour + 1e-9 ? "var(--danger)" : "var(--marine)"}"><title>${p.date} : ${p.v} j</title></rect>`;
    }).join("");
    const yCap = H - (r.capaciteJour / max) * H;
    return `<svg width="${W}" height="${H}" class="pj-courbe">${barres}
      <line x1="0" y1="${yCap}" x2="${W}" y2="${yCap}" stroke="var(--ink)" stroke-dasharray="3 2" stroke-width="1"/></svg>`;
  };
  return `${c.inconnues.length ? `<div class="card card-pad" style="border-left:4px solid var(--warn);margin-bottom:10px;">
      <b>Affectations orphelines</b><div style="font-size:13.5px;">${c.inconnues.map((u) => `${u.taches.length} tâche(s) affectée(s) à une ressource retirée du projet.`).join("<br>")}
      <div class="muted">Elles restent comptées : si on les ignorait, la charge baisserait toute seule au moment où quelqu'un quitte le projet.</div></div></div>` : ""}
    <div class="pj-ress">${c.ressources.map((r) => `<div class="card card-pad">
      <div class="row" style="align-items:center;gap:10px;">
        <div style="flex:1;"><b>${esc(r.nom)}</b>${r.role ? ` <span class="muted">· ${esc(r.role)}</span>` : ""}
          <div class="muted" style="font-size:12.5px;">capacité déclarée ${r.capaciteJour} j/jour · ${r.totalJours} j affectés · pic ${r.pic}</div></div>
        ${r.nbJoursSurcharge ? `<span class="pill overdue" style="flex:0 0 auto;">${r.nbJoursSurcharge} j de surcharge</span>` : '<span class="pill done" style="flex:0 0 auto;">tenable</span>'}
      </div>
      <div style="overflow-x:auto;margin-top:8px;">${courbe(r)}</div>
      ${r.joursSurcharge.length ? `<div class="muted" style="font-size:12.5px;margin-top:6px;">Premiers jours en dépassement : ${r.joursSurcharge.slice(0, 6).map((j) => `${pjDate(j.date)} (${j.charge}/${j.capacite})`).join(", ")}${r.joursSurcharge.length > 6 ? "…" : ""}</div>` : ""}
    </div>`).join("")}</div>
    <div class="actions" style="margin-top:12px;"><button class="btn-ghost btn-sm" id="pj-niv2">Proposer un nivellement</button></div>
    <p class="hint muted">La capacité est une part de journée consacrée à CE projet. 0,4 pour un directeur qui garde son campus à faire tourner : c'est cette valeur-là qui fait apparaître les surcharges que « 1 ETP » masque.</p>`;
}
function pjBrancherCharge(d) { if ($("#pj-niv2")) $("#pj-niv2").onclick = () => openNivellement(d); }

// --- Journal ---
function pjJournal(d) {
  if (!d.journal.length) return '<div class="card card-pad muted">Rien n\'a encore déplacé une date de jalon ni la fin du projet.</div>';
  return `<div class="card" style="overflow-x:auto;"><table class="net-table">
    <thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Motif</th><th>Fin du projet</th><th>Jalons déplacés</th></tr></thead><tbody>
    ${d.journal.map((j) => `<tr>
      <td>${pjDate(j.at)}<br><span class="muted" style="font-size:11.5px;">${esc(String(j.at || "").slice(11, 16))}</span></td>
      <td>${esc(j.par || "—")}</td><td>${esc(j.action || "")}</td>
      <td class="muted">${esc(j.motif || "—")}</td>
      <td>${j.finAvant !== j.finApres ? `${pjDate(j.finAvant)} → <b>${pjDate(j.finApres)}</b>` : '<span class="muted">inchangée</span>'}</td>
      <td class="muted" style="font-size:12.5px;">${(j.mouvements || []).map((m) => `${esc(m.titre)} : ${pjDate(m.de)} → ${pjDate(m.vers)}`).join("<br>") || "—"}</td>
    </tr>`).join("")}</tbody></table></div>
    <p class="hint muted">Seules les modifications qui déplacent une date de jalon ou la fin du projet sont journalisées : tout tracer noierait la seule information utile.</p>`;
}

// --- Formulaire : cadre du projet ---
// Le calendrier et les ressources vivent ici, et non dans un écran de
// réglages : ce sont eux qui déterminent les dates, les cacher reviendrait à
// rendre le calcul incompréhensible.
const PJ_JOURS = [[1, "L"], [2, "M"], [3, "M"], [4, "J"], [5, "V"], [6, "S"], [7, "D"]];

function pjLigneFermeture(f = {}) {
  return `<div class="row pj-ferm" style="gap:6px;margin-bottom:6px;align-items:center;">
    <input type="date" class="pj-f-du" value="${esc(f.du || "")}" title="du">
    <input type="date" class="pj-f-au" value="${esc(f.au || "")}" title="au">
    <input type="text" class="pj-f-motif grow" placeholder="motif (fermeture de fin d'année…)" value="${esc(f.motif || "")}">
    <button class="btn-ghost btn-sm pj-f-del" type="button">−</button></div>`;
}
function pjLigneRessource(r = {}) {
  return `<div class="row pj-ress-l" style="gap:6px;margin-bottom:6px;align-items:center;">
    <input type="hidden" class="pj-r-id" value="${esc(r.id || "r" + Math.random().toString(36).slice(2, 8))}">
    <input type="text" class="pj-r-nom grow" placeholder="Nom" value="${esc(r.nom || "")}">
    <input type="text" class="pj-r-role grow" placeholder="Rôle" value="${esc(r.role || "")}">
    <input type="number" class="pj-r-cap" step="0.1" min="0" max="3" style="width:6rem;" placeholder="j/jour" value="${r.capaciteJour ?? 1}" title="part de journée consacrée à CE projet">
    <button class="btn-ghost btn-sm pj-r-del" type="button">−</button></div>`;
}

async function openProjetForm(projet, modeles = [], modeleId = "") {
  const isEdit = !!projet?.id;
  const p = projet || { calendrier: { joursOuvres: [1, 2, 3, 4, 5], feries: true, fermetures: [] }, ressources: [], debut: new Date().toISOString().slice(0, 10) };
  const cal = p.calendrier || {};
  const ouvres = cal.joursOuvres || [1, 2, 3, 4, 5];
  const ST = PJ.referentiels?.statutsProjet || { cadrage: { label: "Cadrage" }, en_cours: { label: "En cours" }, suspendu: { label: "Suspendu" }, termine: { label: "Terminé" }, abandonne: { label: "Abandonné" } };

  const bg = openModal(isEdit ? "Cadre du projet" : "Nouveau projet", `
    <div class="grid" style="gap:10px;">
      <div><label class="field-label">Intitulé</label><input id="pf-nom" type="text" value="${esc(p.nom || "")}" placeholder="Refonte du système de scolarité"></div>
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Campus</label><select id="pf-campus">
          ${isAdmin() ? `<option value="">Projet réseau (tous campus)</option>` : ""}
          ${state.campuses.map((c) => `<option value="${c.id}" ${c.id === p.campusId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
        <div><label class="field-label">Pilote</label><input id="pf-pilote" type="text" value="${esc(p.pilote || "")}"></div>
      </div>
      <div><label class="field-label">Ce que le projet doit produire</label><textarea id="pf-objectif" rows="2">${esc(p.objectif || "")}</textarea></div>
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Début</label><input id="pf-debut" type="date" value="${esc(p.debut || "")}"></div>
        <div><label class="field-label">Statut</label><select id="pf-statut">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === p.statut ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></div>
      </div>
      ${!isEdit && modeles.length ? `<div class="card card-pad" style="background:var(--bg);">
        <label class="field-label">Partir d'un modèle (facultatif)</label>
        <select id="pf-modele"><option value="">— Projet vierge —</option>${modeles.map((m) => `<option value="${m.id}" ${m.id === modeleId ? "selected" : ""}>${esc(m.nom)} (${m.taches} tâches)</option>`).join("")}</select>
        <div class="grid grid-2" style="gap:10px;margin-top:8px;">
          <div><label class="field-label">Date pivot</label><input id="pf-pivot" type="date" value="${esc(p.debut || "")}"></div>
          <div><label class="field-label">Sens</label><select id="pf-sens">
            <option value="avant">La date pivot est la FIN (rétroplanning)</option>
            <option value="depuis">La date pivot est le début</option>
          </select></div>
        </div>
        <p class="hint muted">Une rentrée, un audit, une date de dépôt ne se négocient pas : on part de la date cible et on remonte. C'est le sens par défaut.</p>
      </div>` : ""}
      <div class="card card-pad" style="background:var(--bg);">
        <label class="field-label">Calendrier — ce qui ne produit rien ne compte pas</label>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;">
          ${PJ_JOURS.map(([n, l]) => `<label class="pj-chk"><input type="checkbox" class="pf-jour" value="${n}" ${ouvres.includes(n) ? "checked" : ""}> ${l}</label>`).join("")}
          <label class="pj-chk"><input type="checkbox" id="pf-feries" ${cal.feries !== false ? "checked" : ""}> jours fériés</label>
          <label class="pj-chk"><input type="checkbox" id="pf-am" ${cal.alsaceMoselle ? "checked" : ""}> Alsace-Moselle</label>
        </div>
        <label class="field-label" style="margin-top:10px;">Fermetures du site</label>
        <div id="pf-fermetures">${(cal.fermetures || []).map(pjLigneFermeture).join("")}</div>
        <button class="btn-ghost btn-sm" type="button" id="pf-add-ferm">+ Fermeture</button>
      </div>
      <div class="card card-pad" style="background:var(--bg);">
        <label class="field-label">Ressources et capacité réelle</label>
        <div id="pf-ressources">${(p.ressources || []).map(pjLigneRessource).join("")}</div>
        <button class="btn-ghost btn-sm" type="button" id="pf-add-ress">+ Ressource</button>
        <p class="hint muted">Capacité = part de journée consacrée à ce projet. Mettre 1 partout rend la charge muette.</p>
      </div>
      <div><label class="field-label">Budget du projet (€)</label><input id="pf-budget" type="number" step="100" value="${p.budget || 0}"></div>
    </div>
    <div class="actions" style="margin-top:14px;">
      <button class="btn-primary" id="pf-save">${isEdit ? "Enregistrer" : "Créer le projet"}</button>
      ${isEdit && isAdmin() ? '<button class="btn-ghost" id="pf-del">Supprimer le projet</button>' : ""}
    </div>`);

  $("#pf-add-ferm").onclick = () => { $("#pf-fermetures").insertAdjacentHTML("beforeend", pjLigneFermeture()); pjBrancherLignes(bg); };
  $("#pf-add-ress").onclick = () => { $("#pf-ressources").insertAdjacentHTML("beforeend", pjLigneRessource()); pjBrancherLignes(bg); };
  pjBrancherLignes(bg);

  $("#pf-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const corps = {
      nom: $("#pf-nom").value.trim(),
      campusId: $("#pf-campus").value || null,
      pilote: $("#pf-pilote").value.trim(),
      objectif: $("#pf-objectif").value.trim(),
      debut: $("#pf-debut").value,
      statut: $("#pf-statut").value,
      budget: Number($("#pf-budget").value) || 0,
      calendrier: {
        joursOuvres: $$(".pf-jour").filter((c) => c.checked).map((c) => Number(c.value)),
        feries: $("#pf-feries").checked,
        alsaceMoselle: $("#pf-am").checked,
        fermetures: $$(".pj-ferm").map((row) => ({
          du: row.querySelector(".pj-f-du").value, au: row.querySelector(".pj-f-au").value,
          motif: row.querySelector(".pj-f-motif").value.trim(),
        })).filter((f) => f.du && f.au),
      },
      ressources: $$(".pj-ress-l").map((row) => ({
        id: row.querySelector(".pj-r-id").value,
        nom: row.querySelector(".pj-r-nom").value.trim(),
        role: row.querySelector(".pj-r-role").value.trim(),
        capaciteJour: Number(row.querySelector(".pj-r-cap").value) || 0,
      })).filter((r) => r.nom),
    };
    if (!corps.nom) return alert("L'intitulé du projet est requis.");
    if (!corps.calendrier.joursOuvres.length) return alert("Au moins un jour travaillé est nécessaire, sinon aucune tâche ne peut progresser.");
    if ($("#pf-modele")?.value) { corps.modeleId = $("#pf-modele").value; corps.datePivot = $("#pf-pivot").value || corps.debut; corps.sens = $("#pf-sens").value; }
    const r = isEdit ? await api.patch(`/api/projets/${projet.id}`, corps) : await api.post("/api/projets", corps);
    if (r?.error) return alert(r.error);
    closeModals();
    if (!isEdit) PJ.ouvert = r.projet.id;
    renderProjets();
  });
  if ($("#pf-del")) $("#pf-del").onclick = async () => {
    if (!confirm(`Supprimer « ${projet.nom} » et toutes ses tâches ? Cette action est définitive.`)) return;
    const r = await api.del(`/api/projets/${projet.id}`);
    if (r?.error) return alert(r.error);
    closeModals(); PJ.ouvert = null; renderProjets();
  };
}
function pjBrancherLignes(bg) {
  bg.querySelectorAll(".pj-f-del").forEach((b) => { b.onclick = () => b.closest(".pj-ferm").remove(); });
  bg.querySelectorAll(".pj-r-del").forEach((b) => { b.onclick = () => b.closest(".pj-ress-l").remove(); });
  bg.querySelectorAll(".pj-l-del").forEach((b) => { b.onclick = () => b.closest(".pj-lien").remove(); });
  bg.querySelectorAll(".pj-a-del").forEach((b) => { b.onclick = () => b.closest(".pj-aff").remove(); });
}

// --- Formulaire : tâche ---
function pjLigneLien(taches, l = {}, moiId = "") {
  const TL = PJ.referentiels?.liens || { FD: { label: "Fin → Début" }, DD: { label: "Début → Début" }, FF: { label: "Fin → Fin" }, DF: { label: "Début → Fin" } };
  return `<div class="row pj-lien" style="gap:6px;margin-bottom:6px;align-items:center;">
    <select class="pj-l-de grow">${taches.filter((t) => t.id !== moiId && !t.synthese).map((t) => `<option value="${t.id}" ${t.id === l.deId ? "selected" : ""}>${esc(t.code ? t.code + " " : "")}${esc(t.titre)}</option>`).join("")}</select>
    <select class="pj-l-type">${Object.entries(TL).map(([k, v]) => `<option value="${k}" ${k === (l.type || "FD") ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>
    <input type="number" class="pj-l-dec" style="width:5.5rem;" value="${l.decalage || 0}" title="décalage en jours ouvrés (négatif = recouvrement)">
    <button class="btn-ghost btn-sm pj-l-del" type="button">−</button></div>`;
}
function pjLigneAff(ressources, a = {}) {
  return `<div class="row pj-aff" style="gap:6px;margin-bottom:6px;align-items:center;">
    <select class="pj-a-r grow">${ressources.map((r) => `<option value="${r.id}" ${r.id === a.ressourceId ? "selected" : ""}>${esc(r.nom)}${r.role ? " — " + esc(r.role) : ""}</option>`).join("")}</select>
    <input type="number" class="pj-a-taux" step="0.1" min="0" max="3" style="width:6rem;" value="${a.tauxJour ?? 1}" title="part de journée">
    <button class="btn-ghost btn-sm pj-a-del" type="button">−</button></div>`;
}

async function openTacheForm(d, tache) {
  const isEdit = !!tache?.id;
  const t = tache || { dureeJours: 1, statut: "a_faire", liens: [], affectations: [], contrainte: { type: "auplustot" } };
  const CT = d.referentiels.contraintes, ST = d.referentiels.statutsTache;
  const ressources = d.projet.ressources || [];
  const candidatsParent = d.taches.filter((x) => x.id !== t.id && !x.jalon);

  const bg = openModal(isEdit ? `Tâche — ${t.titre}` : "Nouvelle tâche", `
    <div class="grid" style="gap:10px;">
      <div><label class="field-label">Intitulé</label><input id="tf-titre" type="text" value="${esc(t.titre || "")}"></div>
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Lot / phase</label><input id="tf-lot" type="text" value="${esc(t.lot || "")}"></div>
        <div><label class="field-label">Rattachée à</label><select id="tf-parent">
          <option value="">— Aucune (premier niveau) —</option>
          ${candidatsParent.map((x) => `<option value="${x.id}" ${x.id === t.parentId ? "selected" : ""}>${esc(x.code ? x.code + " " : "")}${esc(x.titre)}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Nature</label><select id="tf-jalon">
          <option value="0" ${!t.jalon ? "selected" : ""}>Tâche (elle consomme des jours)</option>
          <option value="1" ${t.jalon ? "selected" : ""}>Jalon (date d'événement, durée nulle)</option>
        </select></div>
        <div><label class="field-label">Durée (jours ouvrés)</label><input id="tf-duree" type="number" min="0" step="0.5" value="${t.dureeJours ?? 1}" ${t.jalon ? "disabled" : ""}></div>
      </div>
      <div class="card card-pad" style="background:var(--bg);">
        <label class="field-label">Dépend de</label>
        <div id="tf-liens">${(t.liens || []).map((l) => pjLigneLien(d.taches, l, t.id)).join("")}</div>
        ${d.taches.filter((x) => x.id !== t.id && !x.synthese).length ? `<button class="btn-ghost btn-sm" type="button" id="tf-add-lien">+ Dépendance</button>` : '<span class="muted">Aucune autre tâche pour l\'instant.</span>'}
      </div>
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Contrainte de date</label><select id="tf-ctype">
          ${Object.entries(CT).map(([k, v]) => `<option value="${k}" ${k === (t.contrainte?.type || "auplustot") ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
        </select></div>
        <div><label class="field-label">Date</label><input id="tf-cdate" type="date" value="${esc(t.contrainte?.date || "")}"></div>
      </div>
      <p class="hint muted" id="tf-caide">${esc(CT[t.contrainte?.type || "auplustot"]?.aide || "")}</p>
      ${ressources.length ? `<div class="card card-pad" style="background:var(--bg);">
        <label class="field-label">Qui la fait</label>
        <div id="tf-affs">${(t.affectations || []).map((a) => pjLigneAff(ressources, a)).join("")}</div>
        <button class="btn-ghost btn-sm" type="button" id="tf-add-aff">+ Affectation</button></div>` : ""}
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Responsable (nom)</label><input id="tf-resp" type="text" value="${esc(t.responsable || "")}"></div>
        <div><label class="field-label">Rôle attendu</label><input id="tf-role" type="text" value="${esc(t.role || "")}" placeholder="directeur de campus, prestataire…"></div>
      </div>
      ${isEdit && !t.synthese ? `<div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">État</label><select id="tf-statut">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === t.statut ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></div>
        <div><label class="field-label">Reste à faire (jours)</label><input id="tf-raf" type="number" min="0" step="0.5" value="${t.resteAFaire ?? t.dureeJours}"></div>
      </div>
      <p class="hint muted">On ne saisit jamais un pourcentage : on saisit ce qu'il reste. Le pourcentage s'en déduit, et la fin prévue est recalculée sur le reste — pas sur la durée d'origine.</p>` : ""}
      <div class="grid grid-2" style="gap:10px;">
        <div><label class="field-label">Budget prévu (€)</label><input id="tf-bp" type="number" step="50" value="${t.budgetPrevu || 0}"></div>
        <div><label class="field-label">Dépensé (€)</label><input id="tf-bd" type="number" step="50" value="${t.budgetDepense || 0}"></div>
      </div>
      <div><label class="field-label">Note</label><textarea id="tf-note" rows="2">${esc(t.note || "")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:14px;">
      <button class="btn-primary" id="tf-save">${isEdit ? "Enregistrer" : "Ajouter"}</button>
      ${isEdit ? '<button class="btn-ghost" id="tf-sim">Simuler un décalage</button>' : ""}
    </div>`);

  const rafraichirLignes = () => pjBrancherLignes(bg);
  if ($("#tf-add-lien")) $("#tf-add-lien").onclick = () => { $("#tf-liens").insertAdjacentHTML("beforeend", pjLigneLien(d.taches, {}, t.id)); rafraichirLignes(); };
  if ($("#tf-add-aff")) $("#tf-add-aff").onclick = () => { $("#tf-affs").insertAdjacentHTML("beforeend", pjLigneAff(ressources, {})); rafraichirLignes(); };
  rafraichirLignes();
  $("#tf-jalon").onchange = () => { $("#tf-duree").disabled = $("#tf-jalon").value === "1"; if ($("#tf-jalon").value === "1") $("#tf-duree").value = 0; };
  $("#tf-ctype").onchange = () => { $("#tf-caide").textContent = CT[$("#tf-ctype").value]?.aide || ""; };

  $("#tf-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const jalon = $("#tf-jalon").value === "1";
    const ctype = $("#tf-ctype").value;
    const corps = {
      titre: $("#tf-titre").value.trim(), lot: $("#tf-lot").value.trim(),
      parentId: $("#tf-parent").value || null, jalon,
      dureeJours: jalon ? 0 : Number($("#tf-duree").value) || 0,
      contrainte: { type: ctype, date: ctype === "auplustot" ? null : ($("#tf-cdate").value || null) },
      liens: $$(".pj-lien").map((row) => ({ deId: row.querySelector(".pj-l-de").value, type: row.querySelector(".pj-l-type").value, decalage: Number(row.querySelector(".pj-l-dec").value) || 0 })).filter((l) => l.deId),
      affectations: $$(".pj-aff").map((row) => ({ ressourceId: row.querySelector(".pj-a-r").value, tauxJour: Number(row.querySelector(".pj-a-taux").value) || 0 })).filter((a) => a.ressourceId),
      responsable: $("#tf-resp").value.trim(), role: $("#tf-role").value.trim(),
      budgetPrevu: Number($("#tf-bp").value) || 0, budgetDepense: Number($("#tf-bd").value) || 0,
      note: $("#tf-note").value.trim(),
    };
    if (!corps.titre) return alert("L'intitulé est requis.");
    if (ctype !== "auplustot" && !corps.contrainte.date) return alert("Cette contrainte a besoin d'une date.");
    if ($("#tf-statut")) { corps.statut = $("#tf-statut").value; corps.resteAFaire = Number($("#tf-raf").value) || 0; }
    const r = await pjAvecMotif((m) => (isEdit
      ? api.patch(`/api/projets/${d.projet.id}/taches/${t.id}`, { ...corps, motif: m || undefined })
      : api.post(`/api/projets/${d.projet.id}/taches`, { ...corps, motif: m || undefined })));
    if (!r) return;
    closeModals();
    renderFicheProjet();
  });
  if ($("#tf-sim")) $("#tf-sim").onclick = () => { closeModals(); openSimulationProjet(d, t.id); };
}

// --- Simulation : répondre sans rien écrire ---
async function openSimulationProjet(d, tacheId = "") {
  const feuilles = d.taches.filter((t) => !t.synthese);
  if (!feuilles.length) return alert("Aucune tâche à simuler.");
  openModal("Et si… ?", `
    <p class="muted" style="font-size:13.5px;margin-top:0;">Rien n'est enregistré : on regarde ce que coûterait la décision avant de la prendre.</p>
    <div class="grid grid-2" style="gap:10px;">
      <div><label class="field-label">Tâche</label><select id="sim-t">${feuilles.map((t) => `<option value="${t.id}" ${t.id === tacheId ? "selected" : ""}>${esc(t.code ? t.code + " " : "")}${esc(t.titre)}</option>`).join("")}</select></div>
      <div><label class="field-label">Décalage (jours ouvrés)</label><input id="sim-dec" type="number" step="1" value="5"></div>
    </div>
    <div><label class="field-label">Ou : nouvelle durée (laisser vide pour ne pas y toucher)</label><input id="sim-duree" type="number" min="0" step="0.5" placeholder=""></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="sim-go">Calculer l'impact</button></div>
    <div id="sim-out" style="margin-top:12px;"></div>`);

  $("#sim-go").onclick = (ev) => guard(ev.currentTarget, async () => {
    const mod = { tacheId: $("#sim-t").value };
    const dec = Number($("#sim-dec").value) || 0;
    const duree = $("#sim-duree").value;
    if (dec) mod.decalageJours = dec;
    if (duree !== "") mod.dureeJours = Number(duree);
    const r = await api.post(`/api/projets/${d.projet.id}/simuler`, { modifications: [mod] });
    if (r?.error) { $("#sim-out").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
    $("#sim-out").innerHTML = `
      <div class="kpis">${fkpi(pjDate(r.finAvant), "fin actuelle")}
        ${fkpi(pjDate(r.finApres), "fin simulée", r.ecartJours > 0 ? "bad" : "good")}
        ${fkpi((r.ecartJours > 0 ? "+" : "") + r.ecartJours + " j", "écart", r.ecartJours > 0 ? "bad" : "good")}</div>
      ${r.ecartJours === 0 ? '<p class="muted">La marge absorbe entièrement ce décalage : la fin du projet ne bouge pas.</p>' : ""}
      ${r.impacts.length ? `<div class="section-title">Jalons déplacés</div><ul>${r.impacts.map((i) => `<li>${esc(i.titre)} : ${pjDate(i.avant)} → <b>${pjDate(i.apres)}</b> (${i.ecart > 0 ? "+" : ""}${i.ecart} j)</li>`).join("")}</ul>` : ""}
      ${r.nouvellesCritiques.length ? `<p><b>Entrent sur le chemin critique :</b> ${r.nouvellesCritiques.map((x) => esc(x.titre)).join(", ")}</p>` : ""}
      ${r.chargeApres > r.chargeAvant ? `<p class="neg">Cette hypothèse crée ${r.chargeApres - r.chargeAvant} surcharge(s) de plus.</p>` : ""}`;
  });
}

// --- Nivellement : proposé, chiffré, appliqué seulement si on le demande ---
async function openNivellement(d) {
  const bg = openModal("Nivellement de la charge", '<p class="muted">Calcul…</p>');
  const r = await api.post(`/api/projets/${d.projet.id}/nivellement`, {});
  if (r?.error) { bg.querySelector(".modal-body").innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
  bg.querySelector(".modal-body").innerHTML = `
    <div class="kpis">${fkpi(r.avant.joursSurcharge, "jours de surcharge", r.avant.joursSurcharge ? "bad" : "good")}
      ${fkpi(r.apres.joursSurcharge, "après nivellement", r.apres.joursSurcharge ? "bad" : "good")}
      ${fkpi((r.coutJours > 0 ? "+" : "") + r.coutJours + " j", "coût sur la fin", r.coutJours > 0 ? "bad" : "good")}</div>
    ${r.propositions.length ? `<div class="section-title">Ce qu'il faudrait décaler</div>
      <div class="card" style="overflow-x:auto;"><table class="net-table"><thead><tr><th>Tâche</th><th>De</th><th>Vers</th><th>Décalage</th></tr></thead><tbody>
      ${r.propositions.map((p) => `<tr><td>${esc(p.titre)}</td><td>${pjDate(p.de)}</td><td><b>${pjDate(p.vers)}</b></td><td>${p.jours} j</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted">Aucun décalage à proposer.</p>'}
    ${(r.irreductibles || []).length ? `<div class="section-title">Ce qu'un décalage ne résout pas</div>
      <ul>${r.irreductibles.map((i) => `<li>${esc(i.nom)}, le ${pjDate(i.date)} — ${esc(i.motif)}</li>`).join("")}</ul>` : ""}
    ${r.propositions.length ? `<div class="actions" style="margin-top:12px;">
      <button class="btn-primary" id="niv-go">Appliquer ces décalages</button></div>
      <p class="hint muted">Appliquer pose une contrainte « pas avant » sur chaque tâche décalée, et l'inscrit au journal. Rien n'est fait tant que vous n'avez pas cliqué.</p>` : ""}`;

  if ($("#niv-go")) $("#niv-go").onclick = (ev) => guard(ev.currentTarget, async () => {
    const motif = prompt("Motif de l'arbitrage de charge :", "nivellement de la charge");
    if (motif === null) return;
    const out = await api.post(`/api/projets/${d.projet.id}/nivellement`, { appliquer: true, motif });
    if (out?.error) return alert(out.error);
    closeModals(); renderFicheProjet();
  });
}

// --- Capturer un modèle ---
async function openModeleProjet(d) {
  openModal("Enregistrer comme modèle", `
    <p class="muted" style="font-size:13.5px;margin-top:0;">La trame conserve les tâches, leur durée, leurs enchaînements et leur position relative — mais <b>ni les dates, ni les personnes</b> : les unes se recalculent, les autres changent de poste.</p>
    <div><label class="field-label">Nom du modèle</label><input id="mo-nom" type="text" value="${esc(d.projet.nom)}"></div>
    <div><label class="field-label">À quoi il sert</label><textarea id="mo-desc" rows="2" placeholder="Quand l'utiliser, ce qu'il suppose…"></textarea></div>
    <div class="actions" style="margin-top:12px;"><button class="btn-primary" id="mo-save">Enregistrer</button></div>`);
  $("#mo-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post(`/api/projets/${d.projet.id}/modele`, { nom: $("#mo-nom").value.trim(), description: $("#mo-desc").value.trim() });
    if (r?.error) return alert(r.error);
    closeModals();
    alert(`Modèle « ${r.modele.nom} » enregistré (${r.modele.taches.length} tâches). Il apparaît dans le portefeuille.`);
  });
}


// ---------- Onglet COPIL du projet ----------
// Le comité ne se prépare plus : il se tient. Cet écran montre ce que l'ordre
// du jour de la prochaine séance dit AUJOURD'HUI, et il se remplit tout seul
// avant chaque séance — jusqu'à ce que quelqu'un y touche, auquel cas il se
// retire définitivement de cette séance-là.
const PJ_GRAVITE = { bloquant: "var(--danger)", important: "var(--warn)", info: "var(--line)" };

async function pjRendreCopil(d) {
  const hote = $("#pj-contenu");
  const r = await api.get(`/api/projets/${d.projet.id}/copil`);
  if (r?.error) { hote.innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }

  if (!r.committee) {
    hote.innerHTML = `<div class="card card-pad">
      <b>Aucun comité de pilotage sur ce projet.</b>
      <p class="sub muted">En mettre un en place crée les séances des dix prochaines semaines et remplit leur ordre du jour depuis ce planning : ce qui a bougé et pourquoi, les échéances franchies, les tâches critiques sans responsable, les surcharges. Vous n'aurez plus à le préparer — seulement à le relire.</p>
      <div class="actions"><button class="btn-primary" id="pj-copil-new">Mettre en place le comité</button></div>
    </div>`;
    $("#pj-copil-new").onclick = () => openCopilForm(d, r.cadences);
    return;
  }

  const o = r.odj;
  const seance = r.prochaine;
  hote.innerHTML = `
    <div class="card card-pad" style="margin-bottom:12px;">
      <div class="row pj-actions" style="align-items:center;gap:10px;">
        <div style="flex:1;min-width:200px;">
          <b>${esc(r.committee.name)}</b>
          <div class="muted" style="font-size:13px;">${esc(r.committee.cadence || "")} · ${(r.committee.members || []).length} membre(s)${(r.committee.members || []).some((m) => !m.email) ? ` · <span class="neg">${(r.committee.members || []).filter((m) => !m.email).length} sans adresse : ils ne recevront rien</span>` : ""}</div>
        </div>
        <button class="btn-ghost btn-sm" id="pj-copil-membres">Membres</button>
        <button class="btn-ghost btn-sm" id="pj-copil-refill">Remplir maintenant</button>
        ${seance ? '<button class="btn-primary btn-sm" id="pj-copil-conv">Convoquer maintenant</button>' : ""}
      </div>
    </div>

    ${seance ? `
      <div class="section-title" style="margin-top:0;">Prochaine séance — ${pjDate(seance.date)}${seance.time ? ` à ${esc(seance.time)}` : ""}</div>
      <p class="muted" style="font-size:13px;margin:-6px 0 10px;">
        ${seance.agendaAuto === false
          ? "Ordre du jour repris à la main : le remplissage automatique s'est retiré de cette séance."
          : `Ordre du jour rempli automatiquement avant la séance. Convocation envoyée à J-7, rappel à J-1.`}
      </p>
      ${o ? `<div class="card" style="overflow:hidden;">
        ${o.note ? `<div style="padding:10px 14px;border-bottom:1px solid var(--line);" class="muted">${esc(o.note)}</div>` : ""}
        ${o.points.map((pt, i) => `<div style="padding:11px 14px;border-bottom:1px solid var(--line-2);border-left:4px solid ${PJ_GRAVITE[pt.gravite] || "var(--line)"};">
          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
            <b style="font-size:14px;">${i + 1}. ${esc(pt.titre)}</b>
            <span class="muted" style="font-size:12px;">${pt.minutes} min${pt.porteur ? ` · ${esc(pt.porteur)}` : ""}</span>
          </div>
          ${pt.detail ? `<div class="muted" style="font-size:13px;margin-top:3px;">${esc(pt.detail)}</div>` : ""}
          ${pt.decision ? `<div style="font-size:13px;margin-top:4px;"><span class="muted">Décision attendue :</span> ${esc(pt.decision)}</div>` : ""}
        </div>`).join("")}
        <div style="padding:9px 14px;" class="muted">Total ${o.total} min · établi depuis le planning, sans reformulation.</div>
      </div>` : '<p class="muted">Ordre du jour indisponible : le planning n\'est pas calculable.</p>'}
    ` : '<p class="muted">Aucune séance à venir. L\'entretien quotidien en recréera à l\'horizon de la cadence.</p>'}

    ${r.aVenir.length > 1 ? `<div class="section-title">Séances programmées</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;">${r.aVenir.map((s2) => `<button class="pill ${s2.agendaAuto === false ? "doing" : "done"} pj-seance" data-s="${s2.id}" style="flex:0 0 auto;cursor:pointer;border:0;">${pjDate(s2.date)}${s2.points ? ` · ${s2.points} points` : ""}</button>`).join("")}</div>
      <p class="hint muted">Créées d'avance par la cadence. Celles en orange ont un ordre du jour repris à la main. Cliquer sur une séance pour consigner son relevé de décisions — c'est lui qui alimentera le « suivi des décisions » de l'ordre du jour suivant.</p>` : ""}`;

  $("#pj-copil-membres").onclick = () => openCopilMembres(d, r.committee);
  $$(".pj-seance").forEach((b) => { b.onclick = () => openCopilSeance(d, r.committee.id, r.aVenir.find((x) => x.id === b.dataset.s)); });
  if ($("#pj-copil-conv")) $("#pj-copil-conv").onclick = (ev) => guard(ev.currentTarget, async () => {
    if (!confirm(`Envoyer la convocation du ${pjDate(seance.date)} aux ${(r.committee.members || []).filter((m) => m.email).length} membre(s) qui ont une adresse ?`)) return;
    const out = await api.post(`/api/committees/${r.committee.id}/sessions/${seance.id}/send`, { kind: "convocation", force: true });
    alert(out?.error ? out.error : `Convocation envoyée à ${out.recipients} destinataire(s).${out.sansEmail?.length ? `\n\nSans adresse, donc non prévenus : ${out.sansEmail.join(", ")}` : ""}`);
    pjRendreCopil(d);
  });
  $("#pj-copil-refill").onclick = (ev) => guard(ev.currentTarget, async () => {
    if (!seance) return;
    let out = await api.post(`/api/committees/${r.committee.id}/sessions/${seance.id}/agenda-auto`, {});
    if (out?.forcable) {
      if (!confirm(`${out.error}\n\nÉcraser quand même ?`)) return;
      out = await api.post(`/api/committees/${r.committee.id}/sessions/${seance.id}/agenda-auto`, { reprendre: true });
    }
    if (out?.error) return alert(out.error);
    pjRendreCopil(d);
  });
}

function openCopilForm(d, cadences) {
  const JOURS = [[1, "lundi"], [2, "mardi"], [3, "mercredi"], [4, "jeudi"], [5, "vendredi"]];
  const bg = openModal("Mettre en place le comité de pilotage", `
    <div class="row">
      <div><label class="field-label">Intitulé</label><input id="cp-nom" value="COPIL — ${esc(d.projet.nom)}"></div>
    </div>
    <div class="row" style="margin-top:10px;">
      <div><label class="field-label">Cadence</label><select id="cp-type">
        ${Object.entries(cadences).map(([k, v]) => `<option value="${k}" ${k === "hebdo" ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
      </select></div>
      <div><label class="field-label">Jour</label><select id="cp-jour">
        ${JOURS.map(([v, l]) => `<option value="${v}" ${v === 2 ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
      <div><label class="field-label">Heure</label><input id="cp-heure" type="time" value="09:00"></div>
    </div>
    <div class="row" style="margin-top:10px;">
      <div><label class="field-label">Lieu</label><input id="cp-lieu" placeholder="salle, site…"></div>
      <div><label class="field-label">Lien visio</label><input id="cp-lien" placeholder="https://…"></div>
    </div>
    <p class="hint muted" style="margin-top:10px;">Les séances des dix prochaines semaines sont créées tout de suite, et leur ordre du jour se remplira depuis ce planning avant chaque séance. Une séance tombant un jour férié est reportée au jour ouvré suivant, jamais supprimée.</p>
    <p class="hint muted">Les membres se complètent ensuite dans l'écran du comité : seuls ceux qui ont une adresse reçoivent la convocation.</p>
    <div class="actions"><button class="btn-primary" id="cp-save">Créer le comité et les séances</button></div>`);
  $("#cp-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const r = await api.post(`/api/projets/${d.projet.id}/copil`, {
      name: $("#cp-nom").value.trim(),
      cadenceRegle: {
        type: $("#cp-type").value, jourSemaine: Number($("#cp-jour").value),
        heure: $("#cp-heure").value, lieu: $("#cp-lieu").value.trim(), lien: $("#cp-lien").value.trim(),
      },
    });
    if (r?.error) return alert(r.error);
    bg.remove();
    pjRendreCopil(d);
  });
}


// Membres du comité. Ceux qui n'ont pas d'adresse sont montrés comme tels :
// un comité où trois personnes ne reçoivent jamais rien délibère à leur insu.
function openCopilMembres(d, committee) {
  const lignes = (committee.members || []).map((m) => ({ ...m }));
  const ligne = (m, i) => `<div class="row pj-membre" data-i="${i}" style="gap:6px;margin-bottom:6px;">
    <div><input class="cm-nom" value="${esc(m.name || "")}" placeholder="Nom"></div>
    <div><input class="cm-role" value="${esc(m.role || "")}" placeholder="Rôle"></div>
    <div><input class="cm-mail" value="${esc(m.email || "")}" placeholder="adresse@exemple.fr"></div>
    <button class="btn-ghost btn-sm cm-del" style="flex:0 0 auto;">Retirer</button></div>`;
  const bg = openModal(`Membres — ${committee.name}`, `
    <div id="cm-liste">${lignes.map(ligne).join("") || ""}</div>
    <div class="actions"><button class="btn-ghost btn-sm" id="cm-add">+ Membre</button>
      <button class="btn-primary" id="cm-save">Enregistrer</button></div>
    <p class="hint muted">Seuls les membres qui ont une adresse reçoivent la convocation et le compte rendu. Les autres restent des participants nommés.</p>`);
  const relire = () => $$("#cm-liste .pj-membre").map((el) => ({
    name: $(".cm-nom", el).value.trim(), role: $(".cm-role", el).value.trim(), email: $(".cm-mail", el).value.trim(),
  })).filter((m) => m.name || m.email);
  const brancher = () => $$("#cm-liste .cm-del").forEach((b) => { b.onclick = () => { b.closest(".pj-membre").remove(); }; });
  brancher();
  $("#cm-add").onclick = () => { $("#cm-liste").insertAdjacentHTML("beforeend", ligne({}, lignes.length)); brancher(); };
  $("#cm-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const out = await api.patch(`/api/committees/${committee.id}`, { members: relire() });
    if (out?.error) return alert(out.error);
    bg.remove();
    pjRendreCopil(d);
  });
}

// Une séance : son ordre du jour tel qu'il serait rempli maintenant, et son
// relevé de décisions. Le relevé n'est pas un compte rendu — ce sont les
// engagements datés que l'ordre du jour suivant ira rechercher.
async function openCopilSeance(d, cid, seance) {
  if (!seance) return;
  const apercu = await api.get(`/api/committees/${cid}/sessions/${seance.id}/agenda-projet`);
  const c = await api.get(`/api/committees/${cid}`);
  const s = (c.sessions || []).find((x) => x.id === seance.id) || {};
  const res = (s.resolutions || []).map((x) => ({ ...x }));
  const ligneRes = (x) => `<div class="row pj-res" style="gap:6px;margin-bottom:6px;">
    <div style="flex:2;"><input class="cr-txt" value="${esc(x.text || "")}" placeholder="Décision prise"></div>
    <div><input class="cr-own" value="${esc(x.owner || "")}" placeholder="Qui"></div>
    <div><input class="cr-due" type="date" value="${esc(x.dueDate || "")}"></div>
    <button class="btn-ghost btn-sm cr-del" style="flex:0 0 auto;">×</button></div>`;
  const bg = openModal(`Séance du ${pjDate(seance.date)}`, `
    <div class="section-title" style="margin-top:0;">Ordre du jour</div>
    ${apercu?.odj?.points?.length ? `<div class="card" style="overflow:hidden;">${apercu.odj.points.map((pt, i) => `
      <div style="padding:9px 12px;border-bottom:1px solid var(--line-2);border-left:4px solid ${PJ_GRAVITE[pt.gravite] || "var(--line)"};">
        <b style="font-size:13.5px;">${i + 1}. ${esc(pt.titre)}</b>
        <span class="muted" style="font-size:12px;"> ${pt.minutes} min</span>
        ${pt.decision ? `<div style="font-size:12.5px;margin-top:2px;"><span class="muted">Décision attendue :</span> ${esc(pt.decision)}</div>` : ""}
      </div>`).join("")}</div>` : '<p class="muted">Ordre du jour indisponible.</p>'}
    <p class="hint muted">${s.agendaAuto === false ? "Repris à la main : le remplissage automatique ne touchera plus cette séance." : "Rempli automatiquement avant la séance."}</p>

    <div class="section-title">Relevé de décisions</div>
    <div id="cr-liste">${res.map(ligneRes).join("")}</div>
    <div class="actions"><button class="btn-ghost btn-sm" id="cr-add">+ Décision</button>
      <button class="btn-primary" id="cr-save">Enregistrer</button></div>
    <p class="hint muted">Ce que le comité a tranché, avec qui et pour quand. L'ordre du jour de la séance suivante reprendra automatiquement celles arrivées à échéance.</p>`);
  const brancher = () => $$("#cr-liste .cr-del").forEach((b) => { b.onclick = () => b.closest(".pj-res").remove(); });
  brancher();
  $("#cr-add").onclick = () => { $("#cr-liste").insertAdjacentHTML("beforeend", ligneRes({})); brancher(); };
  $("#cr-save").onclick = (ev) => guard(ev.currentTarget, async () => {
    const out = await api.patch(`/api/committees/${cid}/sessions/${seance.id}`, {
      resolutions: $$("#cr-liste .pj-res").map((el) => ({
        text: $(".cr-txt", el).value.trim(), owner: $(".cr-own", el).value.trim(), dueDate: $(".cr-due", el).value,
      })).filter((x) => x.text),
    });
    if (out?.error) return alert(out.error);
    bg.remove();
    pjRendreCopil(d);
  });
}

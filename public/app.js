const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
const api = {
  async get(u) { const r = await fetch(u); if (r.status === 401) return logout(true); return r.json(); },
  async post(u, b) { const r = await fetch(u, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(b || {}) }); return r.json(); },
  async patch(u, b) { const r = await fetch(u, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(b || {}) }); return r.json(); },
  async put(u, b) { const r = await fetch(u, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(b || {}) }); return r.json(); },
  async del(u) { const r = await fetch(u, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken() } }); return r.json(); },
  async upload(file) { const fd = new FormData(); fd.append("file", file); const r = await fetch("/api/upload", { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, body: fd }); return r.json(); },
};

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
const NAV_GROUPS = ["Pilotage", "Décisions", "Réseau", "Recrutement", "Performance", "Conformité", "Atelier", "Administration"];
const NAV = [
  { id: "accueil", label: "Accueil", icon: I.home, group: "Pilotage" },
  { id: "notifications", label: "Notifications", icon: I.bell, group: "Pilotage" },
  { id: "heatmap", label: "Heatmap réseau", icon: I.net, admin: true, group: "Pilotage" },
  { id: "priorites", label: "Priorités du jour", icon: I.target, group: "Pilotage" },
  { id: "assistant", label: "Assistant", icon: I.chat, group: "Pilotage" },
  { id: "decisions", label: "Décisions (CODIR)", icon: I.gavel, admin: true, group: "Décisions" },
  { id: "arbitrages", label: "Arbitrages CODIR", icon: I.clip, admin: true, group: "Décisions" },
  { id: "redressements", label: "Plans de redressement", icon: I.rocket, admin: true, group: "Décisions" },
  { id: "revues", label: "Revues mensuelles", icon: I.hist, admin: true, group: "Décisions" },
  { id: "reseau", label: "Réseau", icon: I.net, admin: true, group: "Réseau" },
  { id: "campus", label: "Campus", icon: I.campus, group: "Réseau" },
  { id: "directeurs", label: "Directeurs", icon: I.users, admin: true, group: "Réseau" },
  { id: "tournee", label: "Tournée", icon: I.route, group: "Réseau" },
  { id: "ouvertures", label: "Ouvertures", icon: I.rocket, admin: true, group: "Réseau" },
  { id: "documents", label: "Documents", icon: I.folder, group: "Réseau" },
  { id: "admissions", label: "Admissions", icon: I.funnel, group: "Recrutement" },
  { id: "evenements", label: "JPO & événements", icon: I.mega, group: "Recrutement" },
  { id: "finance", label: "Finance", icon: I.euro, group: "Performance" },
  { id: "objectifs", label: "Objectifs réseau", icon: I.target, group: "Performance" },
  { id: "prevision", label: "Prévision consolidée", icon: I.chart, admin: true, group: "Performance" },
  { id: "indicateurs", label: "Indicateurs", icon: I.chart, group: "Performance" },
  { id: "insertion", label: "Insertion & satisfaction", icon: I.heart, group: "Performance" },
  { id: "entreprises", label: "Entreprises & alternance", icon: I.brief, group: "Performance" },
  { id: "qualiopi", label: "Qualiopi", icon: I.shield, group: "Conformité" },
  { id: "risques", label: "Risques", icon: I.alert, group: "Conformité" },
  { id: "actions", label: "Plans d'action", icon: I.actions, group: "Conformité" },
  { id: "atelier", label: "Atelier", icon: I.pnl, group: "Atelier" },
  { id: "calendrier", label: "Timeline", icon: I.cal, group: "Atelier" },
  { id: "historique", label: "Historique", icon: I.hist, group: "Atelier" },
  { id: "emails", label: "Emails", icon: I.mail, admin: true, group: "Administration" },
  { id: "utilisateurs", label: "Utilisateurs", icon: I.users, admin: true, group: "Administration" },
  { id: "journal", label: "Journal d'audit", icon: I.journal, admin: true, group: "Administration" },
  { id: "backups", label: "Sauvegardes", icon: I.save, admin: true, group: "Administration" },
  { id: "parametres", label: "Paramètres", icon: I.sliders, admin: true, group: "Administration" },
  { id: "rgpd", label: "RGPD & conformité", icon: I.shield, admin: true, group: "Administration" },
  { id: "change-pw", label: "Changer le mot de passe", icon: I.lock, group: "Administration", action: "changePassword" },
];
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
    const isOpen = open[g] !== false;
    return `<div class="nav-group${isOpen ? " open" : ""}">
      <button class="nav-group-label" data-group="${g}"><span>${g}</span>${NAV_CHEV}</button>
      <div class="nav-group-items">${gi.map((n) => `<button data-view="${n.id}"${n.id === state.view ? ' class="active"' : ""}>${n.icon}<span>${n.label}</span>${n.id === "notifications" && notifCount ? `<span class="nav-badge">${notifCount}</span>` : ""}</button>`).join("")}</div>
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
  $("#topbar-actions").innerHTML = "";
  ({ accueil: renderAccueil, assistant: renderAssistant, notifications: renderNotifications, emails: renderEmails, reseau: renderReseau, admissions: renderAdmissions, calendrier: renderCalendrier, atelier: renderAtelier, qualiopi: renderQualiopi, indicateurs: renderIndicateurs, risques: renderRisques, directeurs: renderDirecteurs, utilisateurs: renderUtilisateurs, historique: renderHistorique, actions: renderActions, campus: renderCampus, objectifs: renderObjectifs, tournee: renderTournee, documents: renderDocuments, finance: renderFinance, insertion: renderInsertion, entreprises: renderEntreprises, journal: renderJournal, ouvertures: renderOuvertures, backups: renderBackups, decisions: renderDecisions, revues: renderRevues, evenements: renderEvenements, parametres: renderParametres, rgpd: renderRGPD, heatmap: renderHeatmap, priorites: renderPriorites, redressements: renderRedressements, prevision: renderPrevision, arbitrages: renderArbitrages }[v] || renderAccueil)();
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
    sig(notifCount, notifCount ? "notification" + (notifCount > 1 ? "s" : "") + " à traiter" : "tout est calme", "notifications", notifCount ? "warn" : ""),
    worst ? sig(`${esc(worst.name)} ${hb(worst.health)}`, "campus le plus à risque", "reseau", worst.health < 50 ? "bad" : "") : sig("—", "santé campus", "reseau"),
    ecart != null ? sig((ecart > 0 ? "+" : "") + ecart + " %", "écart budgétaire réseau", "finance", ecart < 0 ? "bad" : "good") : sig("—", "finance à renseigner", "finance"),
    sig(dueVisits, "visite" + (dueVisits > 1 ? "s" : "") + " à planifier", "tournee", dueVisits ? "warn" : ""),
  ].join("");
  $$("#signals .signal").forEach((b) => b.addEventListener("click", () => setView(b.dataset.go)));
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
  const actList = (arr) => arr.map((x) => `<div class="item"><div class="grow"><div class="ttl">${esc(x.title)}</div><div class="sub">${x.campus ? esc(x.campus) + " · " : ""}📅 ${esc(x.dueDate)}${x.owner ? " · " + esc(x.owner) : ""}</div></div></div>`).join("");
  el.innerHTML = `
    <div class="stats">
      ${card(nOver, "Actions en retard", true)}
      ${card(nSoon, "Échéances < 14 jours", false)}
      ${card(nRisk, "Campus à surveiller", true)}
      ${card(nInc, "Incidents ouverts", true)}
    </div>
    <div class="grid grid-2" style="margin-top:14px;">
      ${nRisk ? `<div class="card card-pad"><div class="section-title" style="margin-top:0;">Campus à surveiller</div><div class="list">${a.atRisk.map((r) => `<div class="item"><div class="grow"><div class="ttl c360" data-id="">${esc(r.name)}${r.city ? ` <span class="muted">· ${esc(r.city)}</span>` : ""}</div><div class="sub">${r.reasons.map((x) => `<span class="pill overdue" style="margin-right:4px;">${esc(x)}</span>`).join("")}</div></div></div>`).join("")}</div></div>` : ""}
      ${nOver ? `<div class="card card-pad"><div class="section-title" style="margin-top:0;">Actions en retard</div><div class="list">${actList(a.overdueActions)}</div></div>` : ""}
    </div>`;
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
    const { md, kpis, chart, actions } = extractKpis(raw);
    state.lastMd = md; state.lastActions = actions || [];
    if (kpis || chart) kz.innerHTML = renderKpis(kpis) + renderChart(chart);
    out.innerHTML = mdSafe(md);
    renderResTools();
    if (state.task === "pnl") showFinanceProposal(state.campus);   // chiffres IA à valider
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
    <div class="field"><label class="field-label">Notes de revue</label><textarea class="rvf" data-f="notes" rows="5" placeholder="Points marquants, décisions, points de vigilance, engagements pris avec le directeur…"></textarea></div>
    <div class="actions" style="margin-top:16px;"><button class="btn-primary" id="rvf-save">Enregistrer la revue</button></div>`;
  openModal(`Revue mensuelle — ${campusName}`, body);
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
async function renderPriorites() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
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
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="add-rec">${I.plus}<span>Plan</span></button>`;
  $("#add-rec").addEventListener("click", openRecoveryForm);
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
  $("#topbar-actions").innerHTML = `<button class="btn-ghost btn-sm" id="arb-weekly">Revue hebdo PDF</button><button class="btn-primary btn-sm" id="add-arb">${I.plus}<span>Arbitrage</span></button>`;
  $("#add-arb").addEventListener("click", () => openArbitrageForm(null));
  $("#arb-weekly").addEventListener("click", () => window.open("/api/weekly-review", "_blank"));
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
async function renderQualiopi() {
  const view = $("#view");
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute un campus d'abord (onglet Campus).</p>`; return; }
  if (!qCampus || !state.campuses.find((c) => c.id === qCampus)) qCampus = state.campuses[0].id;
  if (!qualiopiRef) qualiopiRef = await api.get("/api/qualiopi/reference");
  const q = await api.get(`/api/campuses/${qCampus}/qualiopi`);
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
    </div>
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
    ${qualiopiRef.reference.map((crit) => `<div class="card card-pad" style="margin-bottom:12px;">
      <h3 style="color:var(--marine);">Critère ${crit.c} — ${esc(crit.titre)}</h3>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">${crit.indicators.map((i) => {
        const cur = ind[i.n] || {};
        return `<div class="q-ind">
          <div class="q-num">${i.n}</div>
          <div class="grow"><div>${esc(i.l)}${i.tag ? ` <span class="q-tag">${i.tag}</span>` : ""}</div>
            <input class="txt q-note" data-n="${i.n}" placeholder="Note / preuve…" value="${esc(cur.note || "")}"></div>
          <button type="button" class="btn-ghost btn-sm q-proof" data-n="${i.n}" title="Pièces justificatives">${I.clip}${docCount[i.n] ? `<span class="q-proof-n">${docCount[i.n]}</span>` : ""}</button>
          <select class="q-stat s-${cur.status || "a_verifier"}" data-n="${i.n}">${STAT.map((s) => `<option value="${s.k}" ${(cur.status || "a_verifier") === s.k ? "selected" : ""}>${s.l}</option>`).join("")}</select>
        </div>`;
      }).join("")}</div>
    </div>`).join("")}
    <div class="actions" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0;"><button id="q-save" class="btn-primary">Enregistrer Qualiopi</button> <span id="q-msg" class="status"></span></div>`;
  $("#q-campus").addEventListener("change", (e) => { qCampus = e.target.value; renderQualiopi(); });
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
async function renderAdmissions() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  state.campuses = await api.get("/api/campuses") || [];
  if (!state.campuses.length) { view.innerHTML = `<p class="empty">Ajoute des campus (onglet Campus) pour suivre les admissions.</p>`; return; }
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
    renderAdmissions();
  }));
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
          <button class="btn-ghost btn-sm ied" data-id="${i.id}">Éditer</button>
          <button class="btn-ghost btn-sm btn-danger idl" data-id="${i.id}">Suppr.</button>
        </div>
      </div>`).join("")}</div>` : `<p class="empty">Aucun élément. Clique « Signaler » pour enregistrer un incident ou une réclamation.</p>`;
  $$(".ist").forEach((b) => b.addEventListener("click", async () => { await api.patch(`/api/incidents/${b.dataset.id}`, { status: b.dataset.s }); renderRisques(); }));
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
async function renderNotifications() {
  $("#topbar-actions").innerHTML = "";
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const n = await api.get("/api/notifications") || [];
  notifCount = n.length; renderNav();
  if (!n.length) { view.innerHTML = `<p class="empty">Rien à signaler — tout est à jour 👌</p>`; return; }
  const sevLabel = { high: "Urgent", medium: "À suivre", low: "Information" };
  const typeLabel = { action: "Action", visite: "Visite", qualiopi: "Qualiopi", incident: "Incident", admissions: "Admissions", ouverture: "Ouverture" };
  const canAct = { qualiopi: 1, incident: 1, admissions: 1, ouverture: 1, visite: 1 };
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
  const routes = { action: "actions", visite: "tournee", qualiopi: "qualiopi", incident: "risques", admissions: "admissions", ouverture: "ouvertures" };
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
    <div class="actions" style="margin-top:14px;"><button class="btn-primary" id="pf-save">Enregistrer</button></div>`);
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
  { k: "etude", l: "Étude & décision" }, { k: "immo", l: "Locaux & immobilier" },
  { k: "travaux", l: "Aménagement & travaux" }, { k: "admin", l: "Administratif & juridique" },
  { k: "offre", l: "Offre & pédagogie" }, { k: "rh", l: "Recrutement équipe" },
  { k: "marketing", l: "Marketing & admissions" }, { k: "lancement", l: "Lancement & rentrée" },
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
function ouvTaskRow(t) {
  const dn = daysTo(t.dueDate); const late = t.status !== "done" && dn != null && dn < 0;
  const when = t.dueDate ? `<span class="${late ? "cell-warn" : ""}">${t.dueDate}${dn != null ? ` (${dn < 0 ? Math.abs(dn) + " j de retard" : "J‑" + dn})` : ""}</span>` : "date libre";
  return `<div class="ouv-task ${t.status === "done" ? "is-done" : ""}">
    <button class="ouv-check st-${t.status} task-cycle" data-tid="${t.id}" title="${TASK_STATUS[t.status]} — cliquer pour changer"></button>
    <div class="grow"><div class="ttl">${t.critical ? '<span class="crit-dot" title="chemin critique"></span>' : ""}${esc(t.title)}</div>
      <div class="sub muted">${when}${t.owner ? " · " + esc(t.owner) : ""}${t.notes ? " · " + esc(t.notes) : ""}</div></div>
    <span class="pill st-task-${t.status}">${TASK_STATUS[t.status]}</span>
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
let ouvView = "lot";
async function openOuvertureDetail(oid) {
  const o = await api.get(`/api/openings/${oid}`);
  if (!o || o.error) return;
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
    </div>
    <div class="row" style="margin:10px 0;gap:8px;align-items:center;">
      <div class="chips" id="ouv-mode"><button class="chip ${ouvView === "lot" ? "active" : ""}" data-m="lot">Par lot</button><button class="chip ${ouvView === "frise" ? "active" : ""}" data-m="frise">Frise</button><button class="chip ${ouvView === "budget" ? "active" : ""}" data-m="budget">Budget</button></div>
      <button class="btn-ghost btn-sm" id="ouv-addtask">+ Tâche</button>
      <button class="btn-ghost btn-sm" id="ouv-reseed">Régénérer le type</button>
      <button class="btn-ghost btn-sm" id="ouv-xlsx">Excel</button>
      <button class="btn-ghost btn-sm" id="ouv-print">Imprimer</button>
      ${o.campusId ? `<button class="btn-ghost btn-sm" disabled>Fiche campus créée ✓</button>` : `<button class="btn-ghost btn-sm" id="ouv-convert">Convertir en campus</button>`}
      <button class="btn-ghost btn-sm" id="ouv-edit">Modifier</button>
      <button class="btn-ghost btn-sm btn-danger" id="ouv-del">Supprimer</button>
    </div>
    <div id="ouv-plan">${ouvView === "budget" ? ouvBudgetHtml(o) : ouvView === "frise" ? ouvFriseHtml(frise) : (OUV_LOTS.map(lotSection).join("") || '<p class="muted">Aucune tâche. Ajoute-en ou régénère le rétroplanning type.</p>')}</div>`;
  openModal(`${o.name}${o.city ? " · " + o.city : ""}`, body);
  $("#ouv-edit").onclick = () => { closeModals(); openOuvertureForm(o); };
  $("#ouv-del").onclick = async () => { if (!confirm("Supprimer ce projet d'ouverture ?")) return; await api.del(`/api/openings/${oid}`); closeModals(); renderOuvertures(); };
  $("#ouv-addtask").onclick = () => openTaskForm(oid);
  $("#ouv-reseed").onclick = async () => { if (!confirm("Régénérer le rétroplanning type ? Cela remplace les tâches actuelles.")) return; const r = await api.post(`/api/openings/${oid}/seed`, {}); if (r?.error) { alert(r.error); return; } closeModals(); openOuvertureDetail(oid); };
  $("#ouv-xlsx").onclick = () => { location.href = `/api/openings/${oid}/export`; };
  $("#ouv-print").onclick = () => window.open(`/api/openings/${oid}/export?format=print`, "_blank");
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
  $$(".task-cycle").forEach((b) => b.addEventListener("click", async () => {
    const t = (o.tasks || []).find((x) => x.id === b.dataset.tid);
    const order = ["todo", "doing", "done", "blocked"]; const next = order[(order.indexOf(t.status) + 1) % order.length];
    await api.patch(`/api/openings/${oid}/tasks/${t.id}`, { status: next });
    closeModals(); openOuvertureDetail(oid);
  }));
  $$(".task-edit").forEach((b) => b.addEventListener("click", () => openTaskForm(oid, (o.tasks || []).find((x) => x.id === b.dataset.tid))));
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

// ---------- Vue : Sauvegardes / Restauration (admin) ----------
async function renderBackups() {
  $("#topbar-actions").innerHTML = `<button class="btn-primary btn-sm" id="bk-now">Sauvegarder maintenant</button>`;
  $("#bk-now").addEventListener("click", async () => { await api.post("/api/backups", {}); renderBackups(); });
  const view = $("#view");
  view.innerHTML = `<p class="muted">Chargement…</p>`;
  const list = await api.get("/api/backups") || [];
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  const dt = (iso) => new Date(iso).toLocaleString("fr-FR");
  view.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px;"><p style="margin:0;">Une sauvegarde est créée <strong>automatiquement avant chaque écriture</strong> (30 dernières conservées). Tu peux en créer une manuellement et <strong>restaurer</strong> l'état à un instant donné.</p></div>
    ${list.length ? `<div class="card"><div class="list">${list.map((b) => `<div class="item"><span class="pill">${esc(b.name.replace("db-", "").slice(0, 10))}</span><div class="grow"><div class="ttl">${dt(b.mtime)}</div><div class="sub muted">${kb(b.size)}</div></div><button class="btn-ghost btn-sm bk-restore" data-name="${esc(b.name)}">Restaurer</button></div>`).join("")}</div></div>` : `<p class="empty">Aucune sauvegarde pour l'instant.</p>`}
    <p class="hint muted" style="margin-top:12px;">La restauration remplace l'état actuel — une sauvegarde de sécurité de l'état courant est prise juste avant.</p>`;
  $$(".bk-restore").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Restaurer cette sauvegarde ? L'état actuel sera remplacé (une sauvegarde de sécurité est prise avant).")) return;
    const r = await api.post("/api/backups/restore", { name: b.dataset.name });
    if (r.error) { alert(r.error); return; }
    alert("Restauration effectuée. Rechargement…"); location.reload();
  }));
}

function openModal(title, bodyHtml, toolsHtml = "") {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal"><div class="modal-head"><h2>${esc(title)}</h2><div style="display:flex;gap:8px;align-items:center;">${toolsHtml}<button class="btn-ghost btn-sm" id="modal-close">Fermer</button></div></div><div class="modal-body">${bodyHtml}</div></div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.id === "modal-close") bg.remove(); });
  document.body.appendChild(bg);
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

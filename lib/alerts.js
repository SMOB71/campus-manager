// Alerte email sur les echeances d'actions (digest en retard + a venir), groupe par campus.
import { sendMail } from "./mailbox.js";
import * as store from "./store.js";
import { conformityRate } from "./qualiopi.js";
import { healthScore } from "./calc.js";   // source unique du score de santé (évite la divergence)

export function collectDeadlines(horizonDays = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + horizonDays * 864e5).toISOString().slice(0, 10);
  const open = store.listActions().filter((a) => a.status !== "done" && a.dueDate);
  const overdue = open.filter((a) => a.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const soon = open.filter((a) => a.dueDate >= today && a.dueDate <= horizon).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { overdue, soon };
}

function frDate(d) {
  try { return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }); } catch { return d; }
}
function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function tableRows(actions, overdue) {
  const today = new Date();
  return actions.map((a) => {
    const days = Math.round((new Date(a.dueDate) - today) / 864e5);
    const tag = overdue ? `<span style="color:#C94B33;font-weight:700;">${Math.abs(days)} j de retard</span>` : `<span style="color:#a86a12;">dans ${days} j</span>`;
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;">${esc(a.title)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;">${esc(a.campusName || "—")}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;">${esc(a.owner || "—")}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${frDate(a.dueDate)} · ${tag}</td>
    </tr>`;
  }).join("");
}

export function buildDigestHtml({ overdue, soon }, horizonDays) {
  const section = (title, actions, isOverdue) => actions.length ? `
    <h3 style="color:#0B6E5F;margin:18px 0 8px;">${title} (${actions.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead><tr style="background:#E4F1EE;color:#0B6E5F;text-align:left;">
        <th style="padding:7px 10px;">Action</th><th style="padding:7px 10px;">Campus</th><th style="padding:7px 10px;">Responsable</th><th style="padding:7px 10px;">Échéance</th>
      </tr></thead><tbody>${tableRows(actions, isOverdue)}</tbody></table>` : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#F4EFE6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0D1B2A;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #E2DACD;border-radius:14px;overflow:hidden;">
    <div style="background:#0B6E5F;color:#fff;padding:16px 22px;font-weight:700;font-size:16px;">Campus Manager — Échéances d'actions</div>
    <div style="padding:22px;line-height:1.5;">
      <p style="margin:0 0 6px;">${overdue.length} action(s) <strong>en retard</strong> · ${soon.length} <strong>à venir</strong> sous ${horizonDays} jours.</p>
      ${section("🔴 En retard", overdue, true)}
      ${section("🟠 À venir", soon, false)}
      ${!overdue.length && !soon.length ? '<p style="color:#5A6672;">Aucune échéance à signaler. 👍</p>' : ""}
    </div>
    <div style="padding:12px 22px;color:#5A6672;font-size:12px;border-top:1px solid #E2DACD;">
      Suivi complet sur <a href="https://assistant.iarbiter.fr" style="color:#0B6E5F;">assistant.iarbiter.fr</a> → Plans d'action.
    </div>
  </div>
</body></html>`;
}

// --- Digest hebdomadaire : signaux faibles par campus ---
export function collectAttention(opts = {}) {
  const occT = opts.occThreshold ?? 70;
  const qualT = opts.qualThreshold ?? 80;
  const campuses = store.listCampuses();
  const actions = store.listActions();
  const lastVisits = store.lastVisitByCampus();
  const today = new Date().toISOString().slice(0, 10);
  const monthsSince = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / (30 * 864e5)) : null);
  const items = [];
  for (const c of campuses) {
    const occ = c.students && c.capacity ? Math.round((c.students / c.capacity) * 100) : null;
    const qual = c.qualiopi ? conformityRate(c.qualiopi.indicators || {}) : null;
    const overdue = actions.filter((a) => a.campusId === c.id && a.status !== "done" && a.dueDate && a.dueDate < today).length;
    const lv = lastVisits[c.id];
    const cadence = c.visitCadenceMonths || 6;
    const visitDue = !lv || monthsSince(lv.date) >= cadence;
    const flags = [];
    if (occ != null && occ < occT) flags.push(`Remplissage ${occ} %`);
    if (qual != null && qual < qualT) flags.push(`Qualiopi ${qual} %`);
    if (overdue > 0) flags.push(`${overdue} action(s) en retard`);
    if (visitDue) flags.push(lv ? `Dernière visite +${monthsSince(lv.date)} mois` : "Jamais visité");
    if (flags.length) items.push({ name: c.name, city: c.city || "", flags });
  }
  return items;
}
function attentionHtml(items) {
  if (!items.length) return '<p style="color:#5A6672;">Rien à signaler cette semaine. 👍</p>';
  return items.map((i) => `<div style="padding:10px 0;border-bottom:1px solid #EDE7DA;">
    <div style="font-weight:700;color:#0D1B2A;">${esc(i.name)}${i.city ? ` <span style="color:#7A8590;font-weight:400;">· ${esc(i.city)}</span>` : ""}</div>
    <div style="margin-top:4px;">${i.flags.map((f) => `<span style="display:inline-block;background:#f9e6e1;color:#C94B33;font-size:12.5px;font-weight:600;padding:2px 9px;border-radius:999px;margin:2px 4px 2px 0;">${esc(f)}</span>`).join("")}</div>
  </div>`).join("");
}
// --- Cockpit réseau (mêmes signaux que l'accueil de l'app) ---
function latestKpi(cid) { const k = store.listKpi(cid); return k[k.length - 1] || {}; }
export function collectNetworkSignals() {
  const campuses = store.listCampuses();
  const actions = store.listActions();
  const incidents = store.listIncidents({ status: "open" });
  const lastVisits = store.lastVisitByCampus();
  const today = new Date().toISOString().slice(0, 10);
  const monthsSince = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / (30 * 864e5)) : null);
  let totRev = 0, totBud = 0; const health = []; let dueVisits = 0;
  for (const c of campuses) {
    const k = latestKpi(c.id);
    const filSum = (key) => (c.filieres && c.filieres.length ? (c.filieres.reduce((s, f) => s + (f[key] || 0), 0) || null) : null);
    const students = filSum("effectif") ?? c.students ?? k.students ?? null;
    const capacity = filSum("capacite") ?? c.capacity ?? null;
    const occ = capacity && students ? Math.round((students / capacity) * 100) : (k.occupancy ?? null);
    const qual = c.qualiopi ? conformityRate(c.qualiopi.indicators || {}) : null;
    const overdue = actions.filter((a) => a.campusId === c.id && a.status !== "done" && a.dueDate && a.dueDate < today).length;
    const openInc = incidents.filter((i) => i.campusId === c.id).length;
    const lv = lastVisits[c.id]; const visitDue = !lv || monthsSince(lv.date) >= (c.visitCadenceMonths || 6);
    if (visitDue) dueVisits++;
    const score = healthScore({ occupancy: occ, qualiopi: qual, overdue, visitDue, satisfaction: k.satisfaction, openIncidents: openInc }).score;
    if (score != null) health.push({ name: c.name, score });
    if (k.revenue != null) { totRev += k.revenue; totBud += k.revenueBudget || 0; }
  }
  const worst = health.sort((a, b) => a.score - b.score)[0] || null;
  const ecart = totBud ? Math.round(((totRev - totBud) / totBud) * 100) : null;
  return { worst, ecart, dueVisits };
}
function cockpitHtml(s) {
  const card = (v, l) => `<td style="padding:12px 14px;border:1px solid #E2DACD;border-radius:10px;text-align:center;">
    <div style="font-size:17px;font-weight:700;color:#0D1B2A;">${v}</div><div style="font-size:12px;color:#5A6672;margin-top:2px;">${l}</div></td>`;
  return `<h3 style="color:#0B6E5F;margin:0 0 8px;">Cockpit réseau</h3>
  <table style="border-collapse:separate;border-spacing:8px 0;width:100%;margin-bottom:6px;"><tr>
    ${card(s.worst ? `${esc(s.worst.name)} <span style="color:${s.worst.score < 50 ? "#C94B33" : "#a86a12"};">${s.worst.score}</span>` : "—", "Campus le plus à risque")}
    ${card(s.ecart != null ? (s.ecart > 0 ? "+" : "") + s.ecart + " %" : "—", "Écart budgétaire réseau")}
    ${card(s.dueVisits, "Visite(s) à planifier")}
  </tr></table>`;
}
export function collectOpeningAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const o of store.listOpenings()) {
    if (["ouvert", "abandonne"].includes(o.status)) continue;
    const late = (o.tasks || []).filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today);
    if (late.length) out.push({ name: o.name, targetDate: o.targetDate, late });
  }
  return out;
}
function openingsHtml(items) {
  if (!items.length) return "";
  return `<h3 style="color:#0B6E5F;margin:22px 0 8px;">Ouvertures — tâches en retard</h3>` + items.map((o) => `<div style="padding:8px 0;border-bottom:1px solid #EDE7DA;">
    <div style="font-weight:700;color:#0D1B2A;">${esc(o.name)}${o.targetDate ? ` <span style="color:#7A8590;font-weight:400;">· rentrée ${o.targetDate}</span>` : ""}</div>
    <div style="margin-top:3px;font-size:13px;color:#C94B33;">${o.late.slice(0, 6).map((t) => esc(t.title)).join(" · ")}${o.late.length > 6 ? ` +${o.late.length - 6}` : ""}</div></div>`).join("");
}
export async function sendWeeklyDigest(cfg) {
  const attention = collectAttention(cfg);
  const deadlines = collectDeadlines(cfg.horizonDays);
  const signals = collectNetworkSignals();
  const openings = collectOpeningAlerts();
  if (!attention.length && !deadlines.overdue.length && !deadlines.soon.length && !cfg.alwaysSend) return { sent: false };
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#F4EFE6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0D1B2A;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #E2DACD;border-radius:14px;overflow:hidden;">
    <div style="background:#0B6E5F;color:#fff;padding:16px 22px;font-weight:700;font-size:16px;">Campus Manager — Ce qui mérite ton attention</div>
    <div style="padding:22px;line-height:1.5;">
      ${cockpitHtml(signals)}
      <h3 style="color:#0B6E5F;margin:18px 0 8px;">Campus à surveiller (${attention.length})</h3>
      ${attentionHtml(attention)}
      <h3 style="color:#0B6E5F;margin:22px 0 8px;">Échéances d'actions</h3>
      <p style="margin:0;">${deadlines.overdue.length} en retard · ${deadlines.soon.length} à venir sous ${cfg.horizonDays} jours.</p>
      ${openingsHtml(openings)}
    </div>
    <div style="padding:12px 22px;color:#5A6672;font-size:12px;border-top:1px solid #E2DACD;">Détail sur <a href="https://assistant.iarbiter.fr" style="color:#0B6E5F;">assistant.iarbiter.fr</a> → Réseau.</div>
  </div>
</body></html>`;
  await sendMail({ to: cfg.to, subject: `Campus Manager — attention réseau (${attention.length} campus, ${deadlines.overdue.length} retards)`, html });
  return { sent: true, campuses: attention.length, overdue: deadlines.overdue.length };
}

export async function sendDeadlineAlert(cfg) {
  const data = collectDeadlines(cfg.horizonDays);
  const total = data.overdue.length + data.soon.length;
  if (!total && !cfg.alwaysSend) return { sent: false, count: 0 };
  await sendMail({
    to: cfg.to,
    subject: `Campus Manager — ${data.overdue.length} en retard, ${data.soon.length} à venir`,
    html: buildDigestHtml(data, cfg.horizonDays),
  });
  return { sent: true, count: total, overdue: data.overdue.length, soon: data.soon.length };
}

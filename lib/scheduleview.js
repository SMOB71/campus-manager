// Rendus d'un emploi du temps : impression et iCal.
// Pas d'I/O, pas de store — on reçoit des séances déjà résolues (libellés inclus).

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DAY_LABEL = { lun: "Lundi", mar: "Mardi", mer: "Mercredi", jeu: "Jeudi", ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const KIND_LABEL = { cours: "", examen: "Examen", rattrapage: "Rattrapage", reunion: "Réunion" };

export function frDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

// --- Impression : une page A4 par période, groupée par jour ---
// Même système documentaire que le reste de l'app (bandeau teal, Georgia, pied
// confidentiel) pour qu'un planning imprimé soit reconnaissable comme un document
// de l'établissement.
export function buildScheduleHtml({ title, subtitle, sessions = [], meta = {} }) {
  const byDate = new Map();
  for (const s of sessions) {
    const k = s.date || "";
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(s);
  }
  const dates = [...byDate.keys()].sort();
  const totalH = sessions.reduce((a, s) => a + durH(s), 0);

  const blocks = dates.map((d) => {
    const rows = byDate.get(d).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    const jour = rows[0]?.dayLabel || DAY_LABEL[rows[0]?.day] || "";
    return `<h2>${esc(jour)} ${esc(frDate(d))}</h2>
    <table><thead><tr><th style="width:110px">Horaire</th><th>Enseignement</th><th>Intervenant</th><th>Salle</th><th style="width:90px">Groupe</th></tr></thead><tbody>
    ${rows.map((r) => `<tr${r.status === "cancelled" ? ' class="off"' : ""}>
      <td class="mono">${esc(r.start)} – ${esc(r.end)}</td>
      <td><b>${esc(r.moduleLabel || "—")}</b>${KIND_LABEL[r.kind] ? ` <span class="tag">${esc(KIND_LABEL[r.kind])}</span>` : ""}${r.status === "cancelled" ? ' <span class="tag off">Annulé</span>' : ""}</td>
      <td>${esc(r.teacherName || "—")}</td>
      <td>${esc(r.roomName || "—")}</td>
      <td>${esc(r.className || "—")}</td></tr>`).join("")}
    </tbody></table>`;
  }).join("");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0D1B2A; margin: 0; padding: 22px; }
  .band { background: #0B6E5F; color: #fff; padding: 16px 20px; border-radius: 6px; margin-bottom: 18px; }
  .band h1 { font-family: Georgia, "Times New Roman", serif; font-size: 22px; margin: 0 0 4px; font-weight: 600; }
  .band .sub { opacity: .9; font-size: 13px; }
  .eyebrow { color: #FF6A4D; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
  h2 { font-family: Georgia, serif; font-size: 15px; color: #0B6E5F; margin: 18px 0 6px; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; page-break-inside: avoid; }
  th { background: #0B6E5F; color: #fff; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 7px 9px; }
  td { padding: 7px 9px; border-bottom: 1px solid #E3E9EC; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F7FAF9; }
  tr.off td { opacity: .55; text-decoration: line-through; }
  .mono { font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
  .tag { background: #F4EFE6; color: #8A6114; font-size: 10px; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; font-weight: 700; }
  .tag.off { background: #F0DDDD; color: #8A4B4B; }
  .kpis { display: flex; gap: 10px; margin-bottom: 14px; }
  .kpi { flex: 1; border: 1px solid #E3E9EC; border-radius: 5px; padding: 9px 11px; }
  .kpi b { display: block; font-size: 18px; color: #0B6E5F; }
  .kpi span { font-size: 11px; color: #5C6570; }
  footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #E3E9EC; font-size: 10.5px; color: #6B7880; }
  .noprint { margin-bottom: 14px; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()" style="background:#0B6E5F;color:#fff;border:0;padding:9px 16px;border-radius:5px;font-size:13px;cursor:pointer;">Imprimer / PDF</button></div>
<div class="band"><div class="eyebrow">Campus Manager · Emploi du temps</div><h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}</div>
<div class="kpis">
  <div class="kpi"><b>${sessions.length}</b><span>séance${sessions.length > 1 ? "s" : ""}</span></div>
  <div class="kpi"><b>${round1(totalH)} h</b><span>volume total</span></div>
  <div class="kpi"><b>${dates.length}</b><span>jour${dates.length > 1 ? "s" : ""}</span></div>
  ${meta.periodLabel ? `<div class="kpi"><b style="font-size:13px">${esc(meta.periodLabel)}</b><span>période</span></div>` : ""}
</div>
${blocks || '<p style="color:#6B7880">Aucune séance sur cette période.</p>'}
<footer>Document généré le ${frDate(new Date().toISOString().slice(0, 10))} — susceptible de modification. Document interne, ne pas diffuser hors de l'établissement.</footer>
</body></html>`;
}

// --- iCal : le seul format qui atterrit vraiment dans l'agenda de quelqu'un ---
// Écrit à la main : node-ical (déjà en dépendance) ne fait que LIRE.
export function buildIcs({ sessions = [], name = "Emploi du temps" }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Campus Manager//Planning//FR",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`, "X-WR-TIMEZONE:Europe/Paris",
  ];
  for (const s of sessions) {
    if (!s.date || !s.start || !s.end || s.status === "cancelled") continue;
    const d = s.date.replace(/-/g, "");
    const t1 = String(s.start).replace(":", "") + "00";
    const t2 = String(s.end).replace(":", "") + "00";
    const desc = [s.teacherName && `Intervenant : ${s.teacherName}`, s.className && `Groupe : ${s.className}`,
      s.kind && s.kind !== "cours" && KIND_LABEL[s.kind], s.notes].filter(Boolean).join("\\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id || Math.random().toString(36).slice(2)}@campusmanager.fr`,
      `DTSTAMP:${stamp}`,
      // Heures locales avec TZID : sans ça, un cours de 9 h s'affiche à 11 h l'été.
      `DTSTART;TZID=Europe/Paris:${d}T${t1}`,
      `DTEND;TZID=Europe/Paris:${d}T${t2}`,
      `SUMMARY:${icsText(s.moduleLabel || "Cours")}`,
      s.roomName ? `LOCATION:${icsText(s.roomName)}` : "",
      desc ? `DESCRIPTION:${icsText(desc)}` : "",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  // Les lignes iCal doivent être pliées à 75 octets, sinon certains clients rejettent.
  return lines.filter(Boolean).map(fold).join("\r\n") + "\r\n";
}
function icsText(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line) {
  if (line.length <= 74) return line;
  const out = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) { out.push(" " + rest.slice(0, 73)); rest = rest.slice(73); }
  if (rest) out.push(" " + rest);
  return out.join("\r\n");
}

// --- Corps d'email : compact, lisible sur téléphone ---
export function buildScheduleEmail({ title, intro, sessions = [] }) {
  const byDate = new Map();
  for (const s of sessions) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); }
  const days = [...byDate.keys()].sort().map((d) => {
    const rows = byDate.get(d).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    return `<tr><td style="padding:12px 0 4px;font:700 13px Georgia,serif;color:#0B6E5F;">${esc(DAY_LABEL[rows[0]?.day] || "")} ${esc(frDate(d))}</td></tr>
    ${rows.map((r) => `<tr><td style="padding:5px 0;border-bottom:1px solid #eee;font:13px -apple-system,sans-serif;">
      <b>${esc(r.start)}–${esc(r.end)}</b> · ${esc(r.moduleLabel || "Cours")}${r.status === "cancelled" ? " <span style='color:#8A4B4B'>(annulé)</span>" : ""}<br>
      <span style="color:#5C6570;font-size:12px;">${[r.teacherName, r.roomName, r.className].filter(Boolean).map(esc).join(" · ")}</span>
    </td></tr>`).join("")}`;
  }).join("");
  return `<div style="max-width:600px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0D1B2A;">
    <div style="background:#0B6E5F;color:#fff;padding:16px 18px;border-radius:6px;">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#FFCDBF;font-weight:700;">Campus Manager</div>
      <div style="font:600 20px Georgia,serif;margin-top:3px;">${esc(title)}</div>
    </div>
    ${intro ? `<p style="font-size:13.5px;color:#3E4A51;">${esc(intro)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;">${days || '<tr><td style="padding:14px 0;color:#6B7880;font-size:13px;">Aucune séance sur cette période.</td></tr>'}</table>
    <p style="font-size:11.5px;color:#6B7880;margin-top:18px;border-top:1px solid #E3E9EC;padding-top:10px;">
      Planning susceptible de modification. Le fichier joint (.ics) s'ajoute à votre agenda.</p>
  </div>`;
}

function durH(s) {
  const p = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };
  const a = p(s.start), b = p(s.end);
  return a != null && b != null && b > a ? (b - a) / 60 : 0;
}
function round1(n) { return Math.round(n * 10) / 10; }

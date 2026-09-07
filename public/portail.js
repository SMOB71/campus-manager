// Le jeton vit dans le fragment d'URL (#) : il n'est jamais envoyé au serveur
// dans la ligne de requête, donc jamais écrit dans les journaux d'accès.
const token = location.hash.slice(1);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const api = async (path, method = "GET", body) => {
  const r = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
const ATT = { absent: ["Absence", "bad"], retard: ["Retard", "warn"], excuse: ["Excusée", ""] };

if (!token) {
  $("#app").innerHTML = '<div class="card"><b>Lien incomplet.</b><p class="sub">Ouvre le lien complet qui t\'a été transmis par ton campus.</p></div>';
} else {
  load();
}

async function load() {
  const d = await api("/api/portal/me");
  if (d.error) {
    $("#app").innerHTML = `<div class="card"><b>Accès impossible</b><p class="sub">${esc(d.error)}. Demande un nouveau lien à ton campus.</p></div>`;
    return;
  }
  $("#who").textContent = d.kind === "tutor" ? d.identity.nom : `${d.identity.prenom || ""} ${d.identity.nom || ""}`.trim() || "Mon espace";
  $("#whosub").textContent = [d.campusName, d.identity.className, d.identity.schoolYear].filter(Boolean).join(" · ");
  if (d.kind === "learner") renderLearner(d);
  else if (d.kind === "teacher") renderTeacher(d);
  else renderTutor(d);
}

function sessionRows(sessions, withClass) {
  if (!sessions?.length) return '<p class="empty">Aucun cours prévu.</p>';
  return sessions.map((s) => `<div class="row">
    <span class="pill">${esc(fmtDate(s.date))}</span>
    <div class="grow"><div class="ttl">${esc(s.moduleName || s.moduleLabel || "Cours")}${withClass && s.className ? " · " + esc(s.className) : ""}</div>
      <div class="sub">${esc(s.start)}–${esc(s.end)}${s.roomName ? " · " + esc(s.roomName) : ""}${!withClass && s.teacherName ? " · " + esc(s.teacherName) : ""}</div></div>
  </div>`).join("");
}

function renderLearner(d) {
  const abs = d.absences || [];
  const nonJust = abs.filter((a) => !a.justified && a.status !== "excuse").length;
  $("#app").innerHTML = `
    <div class="card">
      <h2 style="margin-top:0;">Signer ma présence</h2>
      <p class="sub" style="margin-top:0;">Saisis le code affiché par ton formateur en salle.</p>
      <input class="code-input" id="code" maxlength="6" placeholder="ABC234" autocomplete="off">
      <div style="margin-top:10px;"><button id="sign">Signer</button></div>
      <div class="msg" id="signmsg"></div>
    </div>
    ${d.report ? `<h2>Mes résultats</h2>
      <div class="kpis">
        <div class="kpi"><b>${d.report.average != null ? d.report.average.toFixed(2).replace(".", ",") : "—"}</b><span>moyenne générale</span></div>
        <div class="kpi"><b>${d.report.mention || "—"}</b><span>appréciation</span></div>
      </div>
      <div class="card" style="margin-top:12px;">${d.report.modules?.length ? d.report.modules.map((m) => `<div class="row"><div class="grow"><div class="ttl">${esc(m.label)}</div><div class="sub">${m.count} évaluation(s)${m.absences ? " · " + m.absences + " absence(s)" : ""}</div></div><span class="pill">${m.average != null ? m.average.toFixed(2).replace(".", ",") : "—"}</span></div>`).join("") : '<p class="empty">Aucune note pour l’instant.</p>'}</div>` : ""}
    <h2>Mes prochains cours</h2>
    <div class="card">${sessionRows(d.sessions)}</div>
    <h2>Mes absences ${nonJust ? `<span class="pill bad">${nonJust} à justifier</span>` : ""}</h2>
    <div class="card">${abs.length ? abs.map((a) => {
      const [lbl, tone] = ATT[a.status] || [a.status, ""];
      return `<div class="row"><span class="pill ${tone}">${lbl}</span>
        <div class="grow"><div class="ttl">${esc(fmtDate(a.date))} · ${esc(a.start)}–${esc(a.end)}</div>
          <div class="sub">${a.justified ? "Justifiée" : "Non justifiée"}${a.reason ? " · " + esc(a.reason) : ""}</div></div>
        ${a.justified ? "" : `<button class="ghost just" data-id="${a.sheetId}">Justifier</button>`}</div>`;
    }).join("") : '<p class="empty">Aucune absence — continue comme ça.</p>'}</div>
    ${d.documents?.length ? `<h2>Mes documents</h2><div class="card">${d.documents.map((doc) => `<div class="row"><div class="grow"><div class="ttl">${esc(doc.name)}</div><div class="sub">${esc((doc.createdAt || "").slice(0, 10))}</div></div></div>`).join("")}</div>` : ""}`;

  $("#sign").onclick = async () => {
    const code = $("#code").value.trim().toUpperCase();
    const msg = $("#signmsg");
    if (code.length < 4) { msg.textContent = "Saisis le code complet."; msg.className = "msg ko"; return; }
    const r = await api("/api/portal/sign", "POST", { code });
    if (r.error) { msg.textContent = r.error; msg.className = "msg ko"; return; }
    msg.textContent = `Présence signée pour le cours du ${r.date} à ${r.start}.`;
    msg.className = "msg ok";
    $("#code").value = "";
    setTimeout(load, 1200);
  };
  document.querySelectorAll(".just").forEach((b) => b.onclick = async () => {
    const reason = prompt("Motif de l'absence (il sera transmis à l'équipe pour validation) :");
    if (!reason) return;
    const r = await api("/api/portal/justify", "POST", { sheetId: b.dataset.id, reason });
    alert(r.error || "Demande transmise. L'équipe la validera — l'absence reste non justifiée en attendant.");
    if (!r.error) load();
  });
}

function renderTeacher(d) {
  $("#app").innerHTML = `<h2 style="margin-top:0;">Mes prochains cours</h2>
    <div class="card">${sessionRows(d.sessions, true)}</div>
    <p class="sub" style="text-align:center;">Pour faire l'appel, connecte-toi à Campus Manager depuis un poste ou une tablette du campus.</p>`;
}

function renderTutor(d) {
  const list = d.alternants || [];
  $("#app").innerHTML = `<h2 style="margin-top:0;">Mes alternants <span class="pill">${list.length}</span></h2>
    ${list.length ? list.map((a) => `<div class="card">
      <div class="row" style="border:0;padding-top:0;">
        <div class="grow"><div class="ttl">${esc(a.prenom)} ${esc(a.nom.toUpperCase())}</div>
          <div class="sub">${esc(a.className || "")}${a.contract?.dateFin ? " · contrat jusqu'au " + esc(a.contract.dateFin) : ""}</div></div>
        ${a.assiduite != null ? `<span class="pill ${a.assiduite < 90 ? "warn" : ""}">${a.assiduite} % présence</span>` : ""}
      </div>
      ${a.contract?.rupture ? `<p class="sub" style="color:var(--bad);">Rupture en cours — le campus vous recontacte.</p>` : ""}
      ${a.sessions?.length ? `<div class="sub" style="margin:6px 0 4px;">Prochains cours au campus :</div>${sessionRows(a.sessions.slice(0, 4))}` : ""}
      <div style="margin-top:10px;"><button class="ghost sig" data-id="${a.learnerId}" data-name="${esc(a.prenom)} ${esc(a.nom)}">Signaler une difficulté</button></div>
    </div>`).join("") : '<p class="empty">Aucun alternant rattaché à votre entreprise.</p>'}`;
  document.querySelectorAll(".sig").forEach((b) => b.onclick = async () => {
    const message = prompt(`Signaler une difficulté concernant ${b.dataset.name} :`);
    if (!message) return;
    const r = await api("/api/portal/signal", "POST", { learnerId: b.dataset.id, message });
    alert(r.error || "Signalement transmis au campus. Un responsable vous recontactera.");
  });
}

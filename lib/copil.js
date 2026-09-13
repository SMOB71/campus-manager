// Convocations, comptes rendus et rappels de comité de pilotage.
//
// L'app savait déjà tenir un COPIL — membres, séances, ordre du jour, présents, compte
// rendu, décisions — et même en rédiger l'ordre du jour par IA. Mais rien ne SORTAIT :
// il fallait recopier à la main dans un mail. Un comité qu'on ne convoque pas ne se
// réunit pas.
//
// Principe des rappels : on n'envoie CHAQUE CHOSE QU'UNE FOIS (store.markSessionSent est
// atomique et refuse le second envoi). Un rappel automatique qui repart tous les jours est
// pire que pas de rappel : les destinataires créent une règle de filtrage, et la vraie
// convocation se perd avec le reste.
import { sendMail } from "./mailbox.js";
import * as store from "./store.js";
import { analyseChain } from "./chain.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const frDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "date à fixer");
const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

const SHELL = (titre, corps) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#F4EFE6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0D1B2A;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;padding:26px 28px;">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0B6E5F;font-weight:700;">Campus Manager</div>
    <h1 style="margin:6px 0 18px;font-size:21px;line-height:1.3;">${titre}</h1>
    ${corps}
    <p style="margin-top:26px;padding-top:14px;border-top:1px solid #EDE7DA;font-size:12px;color:#7A8590;">
      Message automatique de Campus Manager. Répondre à l'expéditeur pour signaler une absence.</p>
  </div></body></html>`;

const bloc = (titre, contenu) => contenu
  ? `<h2 style="font-size:15px;color:#0B6E5F;margin:22px 0 8px;">${titre}</h2>${contenu}`
  : "";

const liste = (items, rendu) => (items?.length
  ? `<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;">${items.map((x) => `<li>${rendu(x)}</li>`).join("")}</ol>`
  : "");

// Contexte métier d'un COPIL d'ouverture. C'est ce qui rend le mail utile : sans lui, une
// convocation n'est qu'une date. Avec lui, chacun arrive en sachant ce qui coince.
function contexteOuverture(committee) {
  if (committee.scope !== "opening" || !committee.scopeId) return null;
  const o = store.getOpening(committee.scopeId);
  if (!o?.targetDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const ch = analyseChain(o.tasks || [], { targetDate: o.targetDate, today });
  return { opening: o, chain: ch };
}

function htmlContexte(ctx) {
  if (!ctx) return "";
  const { opening: o, chain: ch } = ctx;
  const couleur = ch.slip > 0 ? "#C94B33" : "#0B6E5F";
  const etat = ch.slip > 0
    ? `<strong style="color:${couleur};">La rentrée glisse de ${ch.slip} jour${ch.slip > 1 ? "s" : ""}.</strong>`
    : `<strong style="color:${couleur};">Rentrée tenue à ce jour.</strong>`;
  const top = ch.ruptures.filter((r) => r.cost > 0).slice(0, 5);
  return bloc("Où en est l'ouverture", `
    <p style="font-size:14px;margin:0 0 8px;">${esc(o.name)} — rentrée ${frDate(o.targetDate)}. ${etat}
      ${ch.ruptures.length ? ` ${ch.ruptures.length} tâche(s) en retard.` : ""}</p>
    ${top.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr style="background:#E4F1EE;color:#0B6E5F;text-align:left;">
        <th style="padding:6px 9px;">Ce qui coûte le plus</th><th style="padding:6px 9px;">Retard</th>
        <th style="padding:6px 9px;">Repousse de</th><th style="padding:6px 9px;">En aval</th></tr></thead>
      <tbody>${top.map((r) => `<tr>
        <td style="padding:6px 9px;border-bottom:1px solid #eee;">${esc(r.title)}${r.owner ? ` <span style="color:#7A8590;">— ${esc(r.owner)}</span>` : ""}</td>
        <td style="padding:6px 9px;border-bottom:1px solid #eee;white-space:nowrap;">${r.ownDelay} j</td>
        <td style="padding:6px 9px;border-bottom:1px solid #eee;white-space:nowrap;color:${couleur};font-weight:700;">${r.cost} j</td>
        <td style="padding:6px 9px;border-bottom:1px solid #eee;">${r.downstream || "—"}</td></tr>`).join("")}</tbody></table>`
      : `<p style="font-size:13px;color:#7A8590;margin:0;">Aucun retard ne déborde sa marge.</p>`}`);
}

// Décisions de la séance précédente qui n'ont pas encore d'échéance tenue. Un COPIL qui
// ne rouvre pas ses propres décisions ne décide rien : il enregistre.
function resolutionsEnCours(committee, session) {
  const passees = (committee.sessions || [])
    .filter((s) => s.id !== session.id && s.date && s.date < (session.date || "9999"))
    .sort((a, b) => b.date.localeCompare(a.date));
  const prec = passees[0];
  if (!prec?.resolutions?.length) return "";
  const today = new Date().toISOString().slice(0, 10);
  return bloc(`Suivi des décisions du ${frDate(prec.date)}`, liste(prec.resolutions, (r) => {
    const retard = r.dueDate && r.dueDate < today;
    return `${esc(r.text)}${r.owner ? ` <span style="color:#7A8590;">— ${esc(r.owner)}</span>` : ""}`
      + (r.dueDate ? ` <span style="color:${retard ? "#C94B33" : "#7A8590"};">(échéance ${r.dueDate}${retard ? ", dépassée" : ""})</span>` : "");
  }));
}

function htmlQuand(session) {
  const l = [`<strong>${frDate(session.date)}</strong>${session.time ? ` à ${esc(session.time)}` : ""}`];
  if (session.place) l.push(esc(session.place));
  if (session.link) l.push(`<a href="${esc(session.link)}" style="color:#0B6E5F;">Lien de connexion</a>`);
  return `<p style="font-size:15px;margin:0 0 4px;">${l.join(" · ")}</p>`;
}

export function convocationHtml(committee, session, { rappel = false } = {}) {
  const ctx = contexteOuverture(committee);
  const restants = session.date ? jours(new Date().toISOString().slice(0, 10), session.date) : null;
  const titre = rappel
    ? `Rappel — ${committee.name}${restants != null && restants >= 0 ? ` dans ${restants} jour${restants > 1 ? "s" : ""}` : ""}`
    : `Convocation — ${committee.name}`;
  return SHELL(esc(titre), `
    ${htmlQuand(session)}
    ${committee.cadence ? `<p style="font-size:13px;color:#7A8590;margin:0;">Cadence ${esc(committee.cadence)}</p>` : ""}
    ${bloc("Ordre du jour", session.agendaItems?.length
      ? liste(session.agendaItems, (a) => `${esc(a.text)}${a.owner ? ` <span style="color:#7A8590;">— ${esc(a.owner)}</span>` : ""}`)
      : `<p style="font-size:14px;color:#C94B33;margin:0;">Ordre du jour non encore arrêté.</p>`)}
    ${resolutionsEnCours(committee, session)}
    ${htmlContexte(ctx)}
    ${bloc("Participants", liste(committee.members, (m) => `${esc(m.name || "— à pourvoir —")}${m.role ? ` <span style="color:#7A8590;">(${esc(m.role)})</span>` : ""}`))}`);
}

export function compteRenduHtml(committee, session) {
  const nom = (ids) => (ids || []).map((i) => (committee.members || []).find((m) => m.id === i)?.name).filter(Boolean);
  const presents = nom(session.presentIds), excuses = nom(session.excusedIds);
  return SHELL(`Compte rendu — ${esc(committee.name)}`, `
    ${htmlQuand(session)}
    ${bloc("Présents", presents.length ? `<p style="font-size:14px;margin:0;">${presents.map(esc).join(", ")}</p>` : "")}
    ${bloc("Excusés", excuses.length ? `<p style="font-size:14px;margin:0;">${excuses.map(esc).join(", ")}</p>` : "")}
    ${bloc("Relevé de décisions", liste(session.resolutions, (r) =>
      `${esc(r.text)}${r.owner ? ` <span style="color:#7A8590;">— ${esc(r.owner)}</span>` : ""}${r.dueDate ? ` <span style="color:#7A8590;">(pour le ${r.dueDate})</span>` : ""}`))}
    ${bloc("Compte rendu", session.minutes
      ? `<div style="font-size:14px;line-height:1.65;white-space:pre-wrap;">${esc(session.minutes)}</div>` : "")}
    ${htmlContexte(contexteOuverture(committee))}`);
}

// Destinataires : les membres qui ont une adresse. Ceux qui n'en ont pas sont RENVOYÉS,
// pas ignorés — un comité où trois personnes ne reçoivent rien sans que personne ne le
// sache est un comité qui délibère à l'insu de ses membres.
export function destinataires(committee) {
  const avec = (committee.members || []).filter((m) => m.email);
  const sans = (committee.members || []).filter((m) => !m.email && (m.name || m.role));
  return { to: avec.map((m) => m.email), joignables: avec.length, sansEmail: sans.map((m) => m.name || m.role) };
}

export const SUJETS = {
  convocation: (c, s) => `Convocation — ${c.name} — ${frDate(s.date)}`,
  rappel: (c, s) => `Rappel — ${c.name} — ${frDate(s.date)}`,
  "compte-rendu": (c) => `Compte rendu — ${c.name}`,
};

// L'expéditeur est INJECTABLE. Les namespaces ES étant en lecture seule, on ne peut pas
// remplacer sendMail depuis un test ; et un module d'envoi qu'on ne peut pas substituer
// est un module qu'on ne teste pas — donc des rappels dont on ne vérifie jamais qu'ils
// ne partent pas deux fois.
export async function sendSessionMail(cid, sid, kind, { to, force = false, envoyer = sendMail } = {}) {
  const c = store.getCommittee(cid);
  const s = c && (c.sessions || []).find((x) => x.id === sid);
  if (!s) return { sent: false, error: "séance introuvable" };
  if (!s.date) return { sent: false, error: "renseigne d'abord la date de la séance" };
  const d = destinataires(c);
  const cibles = to?.length ? to : d.to;
  if (!cibles.length) return { sent: false, error: "aucun membre du comité n'a d'adresse email", sansEmail: d.sansEmail };
  // Le marquage AVANT l'envoi : deux exécutions concurrentes du cron ne doivent pas
  // produire deux convocations. Si l'envoi échoue, on démarque pour pouvoir réessayer.
  if (!force && !store.markSessionSent(cid, sid, kind)) return { sent: false, already: true };
  try {
    await envoyer({
      to: cibles.join(","),
      subject: SUJETS[kind] ? SUJETS[kind](c, s) : `${c.name} — ${frDate(s.date)}`,
      html: kind === "compte-rendu" ? compteRenduHtml(c, s) : convocationHtml(c, s, { rappel: kind === "rappel" }),
    });
  } catch (e) {
    if (!force) store.resetSessionSentKind(cid, sid, kind);
    throw e;
  }
  return { sent: true, kind, recipients: cibles.length, sansEmail: d.sansEmail };
}

// --- Rappels automatiques ---------------------------------------------------
// Convocation à J-7, rappel à J-1, relance du compte rendu 2 jours après la séance.
// Les seuils sont des « au plus tard » et non des égalités strictes : si le serveur est
// arrêté le jour J-7, la convocation doit partir le lendemain, pas jamais.
export const RAPPELS = [
  { kind: "convocation", avant: 7 },
  { kind: "rappel", avant: 1 },
];

export async function runSessionReminders(today = new Date().toISOString().slice(0, 10), { envoyer = sendMail } = {}) {
  const out = { convocation: 0, rappel: 0, relances: 0, erreurs: [] };
  for (const c of store.listCommittees()) {
    for (const s of c.sessions || []) {
      if (!s.date) continue;
      const reste = jours(today, s.date);
      if (s.status !== "held" && reste >= 0) {
        for (const r of RAPPELS) {
          if (reste > r.avant || s.sent?.[r.kind]) continue;
          try {
            const res = await sendSessionMail(c.id, s.id, r.kind, { envoyer });
            if (res.sent) out[r.kind]++;
          } catch (e) { out.erreurs.push(`${c.name} ${r.kind} : ${e?.message || e}`); }
        }
      }
      // Séance passée sans compte rendu : on relance une fois. Le compte rendu qui
      // n'est pas écrit dans les jours qui suivent ne s'écrit jamais.
      if (reste <= -2 && !s.minutes?.trim() && !s.sent?.["relance-cr"]) {
        const d = destinataires(c);
        if (d.to.length && store.markSessionSent(c.id, s.id, "relance-cr")) {
          try {
            await envoyer({
              to: d.to.join(","),
              subject: `Compte rendu attendu — ${c.name} — ${frDate(s.date)}`,
              html: SHELL(`Compte rendu attendu`, `<p style="font-size:14px;">La séance du <strong>${frDate(s.date)}</strong> de « ${esc(c.name)} » n'a pas encore de compte rendu.</p>
                <p style="font-size:14px;">Sans relevé de décisions, les arbitrages pris ne sont opposables à personne et ne remontent pas dans le suivi de l'ouverture.</p>`),
            });
            out.relances++;
          } catch (e) { out.erreurs.push(`${c.name} relance-cr : ${e?.message || e}`); }
        }
      }
    }
  }
  return out;
}

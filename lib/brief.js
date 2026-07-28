// Orchestration du brief email du matin : lecture Gmail + agenda -> triage IA -> envoi email.
import { marked } from "marked";
import { fetchRecentEmails, sendMail } from "./mailbox.js";
import { todayAgenda } from "./agenda.js";
import { EMAIL_TRIAGE, EMAIL_MODEL } from "./prompts.js";

function frDate() {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris",
  });
}

function wrapHtml(md) {
  const body = marked.parse(md);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f5f6f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2233;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e4e8ef;border-radius:12px;overflow:hidden;">
    <div style="background:#0B2A5B;color:#fff;padding:16px 22px;font-weight:700;font-size:16px;">
      Assistant Campus — Brief du matin
    </div>
    <div style="padding:22px;line-height:1.55;font-size:15px;">
      ${body}
    </div>
    <div style="padding:12px 22px;color:#6b7686;font-size:12px;border-top:1px solid #e4e8ef;">
      Généré automatiquement. Les réponses sont des brouillons — l'envoi reste à ta main.
    </div>
  </div>
</body></html>`;
}

export async function generateDailyBrief(openai, cfg) {
  if (!cfg.gmailUser || !cfg.gmailPass) throw new Error("Identifiants Gmail manquants (GMAIL_USER / GMAIL_APP_PASSWORD)");

  const emails = await fetchRecentEmails({ user: cfg.gmailUser, pass: cfg.gmailPass, hours: cfg.hours, max: cfg.max });

  let agenda = [];
  if (cfg.icalUrl) {
    try { agenda = await todayAgenda(cfg.icalUrl); }
    catch (e) { console.warn("[brief] agenda KO:", e.message); }
  }

  const agendaBlock = agenda.length
    ? agenda.map((a) => `- ${a.time} — ${a.summary}${a.location ? " @ " + a.location : ""}`).join("\n")
    : (cfg.icalUrl ? "(aucun rendez-vous aujourd'hui)" : "(agenda non configuré)");

  const emailBlock = emails.length
    ? emails.map((e, i) => `${i + 1}. [${e.seen ? "lu" : "NON LU"}] De: ${e.from} | Objet: ${e.subject} | ${e.date}\n   Extrait: ${e.snippet || "(vide)"}`).join("\n")
    : "(aucun email reçu sur la période)";

  const priorities = cfg.priorities || [];
  const prioBlock = priorities.length
    ? priorities.map((p) => `- ${p.name ? p.name + " " : ""}<${p.email}>${p.note ? " — " + p.note : ""}`).join("\n")
    : "(aucun défini)";
  const prioDirective = priorities.length
    ? `\n\n=== Expéditeurs PRIORITAIRES ===\nLes emails provenant de ces personnes doivent être traités EN PREMIER : place-les tout en haut, signale-les clairement (ex. « ⭐ PRIORITAIRE »), et propose une réponse/action pour chacun s'il attend quelque chose.\n${prioBlock}`
    : "";

  const muted = cfg.muted || [];
  const mutedDirective = muted.length
    ? `\n\n=== Expéditeurs à FAIBLE priorité / à ignorer ===\nLes emails de ces expéditeurs (newsletters, notifications automatiques…) sont secondaires : ne les détaille PAS ; regroupe-les tout en bas en une seule ligne (ex. « N emails secondaires non détaillés »), sauf si l'un contient manifestement une action urgente.\n${muted.map((p) => `- ${p.name ? p.name + " " : ""}<${p.email}>${p.note ? " — " + p.note : ""}`).join("\n")}`
    : "";

  const userContent = `Date : ${frDate()}\n\n=== Agenda du jour ===\n${agendaBlock}${prioDirective}${mutedDirective}\n\n=== Emails reçus sur les dernières ${cfg.hours}h (${emails.length}) ===\n${emailBlock}`;

  const resp = await openai.chat.completions.create({
    model: cfg.model || EMAIL_MODEL,
    max_completion_tokens: 6000,
    messages: [
      { role: "system", content: EMAIL_TRIAGE },
      { role: "user", content: userContent },
    ],
  });
  const md = resp.choices?.[0]?.message?.content || "(brief vide)";

  if (cfg.send !== false) {
    await sendMail({
      user: cfg.gmailUser,
      pass: cfg.gmailPass,
      to: cfg.briefTo || cfg.gmailUser,
      subject: `Brief du matin — ${frDate()} (${emails.length} emails)`,
      html: wrapHtml(md),
    });
  }

  return { count: emails.length, agenda: agenda.length, md };
}

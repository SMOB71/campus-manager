// Lecture Gmail (IMAP) + envoi (SMTP), via mot de passe d'application Google.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

// Recupere les emails recus dans les dernieres `hours` heures (max `max`, les plus recents).
export async function fetchRecentEmails({ user, pass, hours = 24, max = 40 }) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    // recherche par date -> liste d'UID
    let uids = await client.search({ since }, { uid: true });
    if (!Array.isArray(uids)) uids = [];
    const recent = uids.slice(-max);
    for (const uid of recent) {
      const msg = await client.fetchOne(uid, { source: true, flags: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const seen = msg.flags ? msg.flags.has("\\Seen") : false;
      out.push({
        from: parsed.from?.text || "(inconnu)",
        subject: parsed.subject || "(sans objet)",
        date: parsed.date ? parsed.date.toISOString() : "",
        seen,
        snippet: (parsed.text || parsed.subject || "").replace(/\s+/g, " ").trim().slice(0, 600),
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  // plus recent en premier
  out.reverse();
  return out;
}

// Transport generique : si MAIL_HOST est defini (ex. mailcow iArbiter) on l'utilise,
// sinon on retombe sur Gmail (smtp.gmail.com + mot de passe d'application).
export function makeTransport() {
  if (process.env.MAIL_HOST) {
    const port = Number(process.env.MAIL_PORT || 587);
    return nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port,
      secure: process.env.MAIL_SECURE === "true" || port === 465,
      auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
      // Vérification TLS stricte par défaut. Opt-out explicite (MAIL_TLS_INSECURE=true) réservé
      // à un serveur mail interne à certificat auto-signé — interdit en production.
      tls: { rejectUnauthorized: !(process.env.MAIL_TLS_INSECURE === "true" && process.env.NODE_ENV !== "production") },
    });
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

export async function sendMail({ user, pass, to, subject, html, from }) {
  let transport, sender;
  if (user && pass) {
    transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    sender = from || user;
  } else {
    transport = makeTransport();
    sender = from || process.env.MAIL_FROM || process.env.MAIL_USER || process.env.GMAIL_USER;
  }
  await transport.sendMail({ from: sender, to: to || sender, subject, html });
}

// Test de connexion IMAP (utilise pour verifier les identifiants).
export async function testImap({ user, pass }) {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let total = 0;
  try {
    total = client.mailbox?.exists ?? 0;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { ok: true, inboxCount: total };
}

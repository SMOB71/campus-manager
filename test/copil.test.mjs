import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "copil-"));
process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || "0".repeat(64);

const store = await import("../lib/store.js");
const { buildOpeningTasks } = await import("../lib/calc.js");
const { convocationHtml, compteRenduHtml, destinataires, runSessionReminders, sendSessionMail } = await import("../lib/copil.js");

// Expéditeur de test : on compte les envois sans rien expédier. Il est injecté plutôt
// que substitué, les namespaces ES étant en lecture seule.
const envois = [];
const envoyer = async (m) => { envois.push(m); return { ok: true }; };

function monter({ date, members, minutes } = {}) {
  const o = store.addOpening({ name: "Iso Test", targetDate: "2028-09-04" });
  store.setOpeningTasks(o.id, buildOpeningTasks(o.targetDate));
  const c = store.addCommittee({
    name: "COPIL Test", scope: "opening", scopeId: o.id, cadence: "mensuel",
    members: members || [{ name: "Claire", role: "Directrice", email: "claire@x.fr" }, { name: "Paul", role: "Architecte" }],
  });
  const s = store.addSession(c.id, { date });
  if (minutes != null) store.updateSession(c.id, s.id, { minutes });
  return { o, cid: c.id, sid: s.id };
}
const dans = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test("convocation : porte le quand, l'ordre du jour, l'état de l'ouverture et les participants", () => {
  const { cid, sid } = monter({ date: "2027-03-10" });
  store.updateSession(cid, sid, {
    time: "14h00", place: "Campus Lyon, salle A", link: "https://visio.example/abc",
    agendaItems: [{ text: "Validation des plans", owner: "Paul" }],
  });
  const c = store.getCommittee(cid);
  const html = convocationHtml(c, c.sessions[0]);
  for (const attendu of ["Convocation", "14h00", "Campus Lyon, salle A", "https://visio.example/abc", "Validation des plans", "Paul", "Où en est l"]) {
    assert.ok(html.includes(attendu), `la convocation doit mentionner « ${attendu} »`);
  }
  // Le contexte d'ouverture est ce qui rend le mail utile : sans lui, c'est juste une date.
  assert.ok(html.includes("Iso Test"));
  assert.ok(/rentrée/i.test(html));
});

test("destinataires : les membres sans adresse sont SIGNALÉS, pas ignorés", () => {
  const { cid } = monter({ date: "2027-03-10" });
  const d = destinataires(store.getCommittee(cid));
  assert.deepEqual(d.to, ["claire@x.fr"]);
  // Un comité où quelqu'un ne reçoit rien sans que personne ne le sache délibère à
  // l'insu de ses membres.
  assert.deepEqual(d.sansEmail, ["Paul"]);
});

test("aucun membre joignable : on refuse et on explique, on ne fait pas semblant", async () => {
  const { cid, sid } = monter({ date: "2027-03-10", members: [{ name: "Paul", role: "Architecte" }] });
  const r = await sendSessionMail(cid, sid, "convocation", { envoyer });
  assert.equal(r.sent, false);
  assert.match(r.error, /aucun membre/i);
  assert.deepEqual(r.sansEmail, ["Paul"]);
});

test("séance sans date : refus explicite", async () => {
  const { cid, sid } = monter({ date: "" });
  const r = await sendSessionMail(cid, sid, "convocation", { envoyer });
  assert.equal(r.sent, false);
  assert.match(r.error, /date/i);
});

test("rappels : convocation à J‑7, rappel à J‑1, et JAMAIS deux fois", async () => {
  envois.length = 0;
  const { cid, sid } = monter({ date: dans(5) });   // dans la fenêtre J‑7, hors J‑1

  const a = await runSessionReminders(undefined, { envoyer });
  assert.equal(a.convocation, 1);
  assert.equal(a.rappel, 0, "trop tôt pour le rappel");
  assert.equal(envois.length, 1);

  // LE point qui compte : relancer le cron le lendemain ne doit rien renvoyer. Un rappel
  // qui repart chaque jour se fait filtrer, et la vraie convocation se perd avec.
  const b = await runSessionReminders(undefined, { envoyer });
  assert.equal(b.convocation + b.rappel, 0);
  assert.equal(envois.length, 1);

  // On avance : la veille, le rappel part — une seule fois lui aussi.
  store.updateSession(cid, sid, { date: dans(1) });
  // Changer la date rouvre les envois : la convocation ne valait plus pour l'ancienne.
  const c = await runSessionReminders(undefined, { envoyer });
  assert.equal(c.convocation, 1);
  assert.equal(c.rappel, 1);
  const d = await runSessionReminders(undefined, { envoyer });
  assert.equal(d.convocation + d.rappel, 0);
});

test("séance passée sans compte rendu : une relance, une seule", async () => {
  envois.length = 0;
  monter({ date: dans(-3) });
  const a = await runSessionReminders(undefined, { envoyer });
  assert.equal(a.relances, 1);
  assert.ok(envois.some((m) => /Compte rendu attendu/.test(m.subject)));
  const b = await runSessionReminders(undefined, { envoyer });
  assert.equal(b.relances, 0);
});

test("séance passée AVEC compte rendu : aucune relance", async () => {
  envois.length = 0;
  monter({ date: dans(-5), minutes: "Décisions prises et actées." });
  const r = await runSessionReminders(undefined, { envoyer });
  assert.equal(r.relances, 0);
  assert.equal(envois.length, 0);
});

test("séance tenue : plus de convocation ni de rappel", async () => {
  envois.length = 0;
  const { cid, sid } = monter({ date: dans(2) });
  store.updateSession(cid, sid, { status: "held", minutes: "tenue" });
  const r = await runSessionReminders(undefined, { envoyer });
  assert.equal(r.convocation + r.rappel, 0);
});

test("le compte rendu reprend présents, excusés et relevé de décisions", () => {
  const { cid, sid } = monter({ date: "2027-03-10" });
  const c0 = store.getCommittee(cid);
  const [claire, paul] = c0.members;
  store.updateSession(cid, sid, {
    status: "held", minutes: "Séance tenue en visioconférence.",
    presentIds: [claire.id], excusedIds: [paul.id],
    resolutions: [{ text: "Lancer l'appel d'offres", owner: "Claire", dueDate: "2027-04-01" }],
  });
  const c = store.getCommittee(cid);
  const html = compteRenduHtml(c, c.sessions[0]);
  assert.ok(html.includes("Claire") && html.includes("Paul"));
  assert.ok(html.includes("Lancer l'appel d'offres"));
  assert.ok(html.includes("2027-04-01"));
  assert.ok(html.includes("Séance tenue en visioconférence."));
});

test("un envoi manuel forcé reste possible après correction de l'ordre du jour", async () => {
  envois.length = 0;
  const { cid, sid } = monter({ date: dans(3) });
  assert.equal((await sendSessionMail(cid, sid, "convocation", { envoyer })).sent, true);
  assert.equal((await sendSessionMail(cid, sid, "convocation", { envoyer })).already, true, "le garde bloque le doublon automatique");
  const f = await sendSessionMail(cid, sid, "convocation", { envoyer, force: true });
  assert.equal(f.sent, true, "mais un humain peut renvoyer explicitement");
  assert.equal(envois.length, 2);
});

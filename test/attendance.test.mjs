import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmatt-"));
process.env.DATA_KEY = "test-key-attendance";
const att = await import("../lib/attendancestore.js");
const { canonical, hashSheet, verifyChain, sheetStats, periodStats, sessionMinutes, generateSessionCode, GENESIS_HASH } = await import("../lib/attendance.js");

// ---------- Logique pure ----------

test("canonical : indépendant de l'ordre des clés, stable", () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ a: [1, { y: 1, x: 2 }] }), '{"a":[1,{"x":2,"y":1}]}');
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("sessionMinutes + sheetStats : absences, retards plafonnés, taux", () => {
  const sheet = {
    start: "09:00", end: "12:00", // 180 min
    entries: [
      { learnerId: "a", status: "present" },
      { learnerId: "b", status: "absent", justified: false },
      { learnerId: "c", status: "absent", justified: true },
      { learnerId: "d", status: "retard", minutesLate: 30, justified: false },
      { learnerId: "e", status: "retard", minutesLate: 999, justified: true }, // plafonné à la durée
    ],
  };
  const st = sheetStats(sheet);
  assert.equal(st.durationMinutes, 180);
  assert.equal(st.total, 5);
  assert.equal(st.plannedMinutes, 900);
  // b (180) + c (180) + d (30) + e (180 plafonné) = 570
  assert.equal(st.absentMinutes, 570);
  // non justifié : b (180) + d (30) = 210
  assert.equal(st.unjustifiedMinutes, 210);
  assert.equal(st.attendanceRate, 36.7);
});

test("generateSessionCode : 6 caractères sans 0/O/1/I/L", () => {
  for (let i = 0; i < 40; i++) {
    const c = generateSessionCode();
    assert.equal(c.length, 6);
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

// ---------- Chaîne d'empreintes ----------

function mkSession(n, campusId = "camp1") {
  return { id: `sess${n}`, campusId, classId: "cl1", teacherId: "t1", date: `2026-09-0${n}`, start: "09:00", end: "12:00" };
}
const LEARNERS = [{ id: "l1" }, { id: "l2" }];

test("clôture : la première feuille part du hash de genèse, les suivantes s'enchaînent", () => {
  const s1 = att.openSheet({ session: mkSession(1), learners: LEARNERS, openedBy: "prof" });
  const l1 = att.lockSheet(s1.id, "prof");
  assert.equal(l1.seq, 1);
  assert.equal(l1.prevHash, GENESIS_HASH);
  assert.match(l1.hash, /^[a-f0-9]{64}$/);

  const s2 = att.openSheet({ session: mkSession(2), learners: LEARNERS, openedBy: "prof" });
  const l2 = att.lockSheet(s2.id, "prof");
  assert.equal(l2.seq, 2);
  assert.equal(l2.prevHash, l1.hash);

  const chain = att.verifyCampusChain("camp1");
  assert.equal(chain.ok, true);
  assert.equal(chain.count, 2);
  assert.equal(chain.lastHash, l2.hash);
});

test("feuille close : saisie directe refusée, avenant motivé obligatoire", () => {
  const s = att.openSheet({ session: mkSession(3), learners: LEARNERS, openedBy: "prof" });
  att.lockSheet(s.id, "prof");
  const refus = att.setEntries(s.id, [{ learnerId: "l1", status: "absent" }]);
  assert.ok(refus.error);
  const sansMotif = att.amendSheet(s.id, { learnerId: "l1", status: "absent", by: "dir" });
  assert.ok(sansMotif.error);
  const ok = att.amendSheet(s.id, { learnerId: "l1", status: "absent", reason: "certificat médical reçu", by: "dir" });
  assert.equal(ok.amendments.length, 1);
  assert.equal(ok.amendments[0].from, "present");
  assert.equal(ok.amendments[0].to, "absent");
  assert.equal(ok.entries.find((e) => e.learnerId === "l1").status, "absent");
  // l'avenant re-scelle sans rompre la chaîne
  assert.equal(att.verifyCampusChain("camp1").ok, true);
});

test("altération silencieuse : la chaîne la détecte", () => {
  const sheets = att.listSheets({ campusId: "camp1", status: "locked" }).map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e })) }));
  assert.equal(verifyChain(sheets).ok, true);
  // quelqu'un modifie une feuille ancienne sans repasser par un avenant
  const victim = sheets.find((s) => s.seq === 1);
  victim.entries[0].status = "absent";
  const verdict = verifyChain(sheets);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, victim.id);
  assert.match(verdict.reason, /modifié/);
});

test("signature : horodatage serveur, empreinte stockée, image relisible", () => {
  const s = att.openSheet({ session: mkSession(4), learners: LEARNERS, openedBy: "prof" });
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const signed = att.signEntry(s.id, "l1", dataUri);
  const entry = signed.entries.find((e) => e.learnerId === "l1");
  assert.match(entry.signedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(entry.signatureHash, /^[a-f0-9]{64}$/);
  assert.equal(att.readSignature(s.id, "l1"), dataUri);
  // l'empreinte de signature entre dans le sceau
  const before = hashSheet({ ...signed, seq: 1, lockedAt: "x", lockedBy: "y" }, GENESIS_HASH);
  const tampered = { ...signed, seq: 1, lockedAt: "x", lockedBy: "y", entries: signed.entries.map((e) => (e.learnerId === "l1" ? { ...e, signatureHash: "autre" } : e)) };
  assert.notEqual(before, hashSheet(tampered, GENESIS_HASH));
});

test("code de séance : signature par code, refusée si feuille close", () => {
  const s = att.openSheet({ session: mkSession(5), learners: LEARNERS, openedBy: "prof" });
  assert.ok(att.getSheetByCode(s.code));
  assert.equal(att.getSheetByCode("XXXXXX"), null);
  att.lockSheet(s.id, "prof");
  assert.equal(att.getSheetByCode(s.code), null); // close → le code ne vaut plus
});

test("openSheet : idempotent (rappeler l'appel ne crée pas de doublon)", () => {
  const session = mkSession(6);
  const a = att.openSheet({ session, learners: LEARNERS, openedBy: "prof" });
  const b = att.openSheet({ session, learners: LEARNERS, openedBy: "prof" });
  assert.equal(a.id, b.id);
  assert.equal(att.listSheets({ sessionId: session.id }).length, 1);
});

test("periodStats : agrège prévu/réalisé sur les feuilles closes", () => {
  const sheets = att.listSheets({ campusId: "camp1", status: "locked" });
  const agg = periodStats(sheets);
  assert.equal(agg.lockedSheets, sheets.length);
  assert.ok(agg.plannedMinutes > 0);
  assert.ok(agg.realizedMinutes <= agg.plannedMinutes);
});

test("chaînes de campus indépendantes", () => {
  const s = att.openSheet({ session: mkSession(7, "camp2"), learners: LEARNERS, openedBy: "prof" });
  const locked = att.lockSheet(s.id, "prof");
  assert.equal(locked.seq, 1); // repart à 1 sur un autre campus
  assert.equal(locked.prevHash, GENESIS_HASH);
  assert.equal(att.verifyCampusChain("camp2").ok, true);
  assert.equal(att.verifyCampusChain("camp1").ok, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmatt-"));
process.env.DATA_KEY = "test-key-attendance";
const att = await import("../lib/attendancestore.js");
const { canonical, hashSheet, verifyChain, sheetStats, periodStats, sessionMinutes, generateSessionCode, effectiveEntries, GENESIS_HASH } = await import("../lib/attendance.js");
const { schoolYearOf } = att;

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
  const scelle = att.lockSheet(s.id, "prof");
  const empreinteOrigine = scelle.hash;

  assert.ok(att.setEntries(s.id, [{ learnerId: "l1", status: "absent" }]).error);
  assert.ok(att.amendSheet(s.id, { learnerId: "l1", status: "absent", by: "dir" }).error, "sans motif : refusé");
  assert.ok(att.amendSheet(s.id, { learnerId: "l1", status: "n_importe_quoi", reason: "x", by: "dir" }).error, "statut invalide : refusé");

  const ok = att.amendSheet(s.id, { learnerId: "l1", status: "absent", reason: "certificat médical reçu", by: "dir" });
  assert.equal(ok.amendments.length, 1);
  assert.equal(ok.amendments[0].from, "present");
  assert.equal(ok.amendments[0].to, "absent");

  // LE POINT CLÉ : la feuille scellée n'est PAS réécrite. Son empreinte d'origine
  // reste valable, donc tous les ancrages externes publiés avant la correction
  // restent vrais.
  assert.equal(att.getSheet(s.id).hash, empreinteOrigine, "le sceau d'origine ne doit jamais bouger");
  assert.equal(att.getSheet(s.id).entries.find((e) => e.learnerId === "l1").status, "present", "l'appel constaté reste intact");

  // Mais l'état EFFECTIF, lui, tient compte de la correction
  const effectif = effectiveEntries(att.getSheet(s.id)).find((e) => e.learnerId === "l1");
  assert.equal(effectif.status, "absent");
  assert.equal(effectif.amende, true);
  // et les statistiques aussi
  assert.equal(sheetStats(att.getSheet(s.id)).absent, 1);

  // L'avenant est un maillon supplémentaire, pas une réécriture
  const chaine = att.listAmendments("camp1");
  assert.equal(chaine.length, 1);
  assert.equal(chaine[0].sheetId, s.id);
  assert.ok(chaine[0].seq > scelle.seq, "l'avenant vient APRÈS la feuille dans la chaîne");
  assert.equal(att.verifyCampusChain("camp1").ok, true);

  // Un avenant qui ne change rien est refusé (bruit inutile dans une pièce probante)
  assert.ok(att.amendSheet(s.id, { learnerId: "l1", status: "absent", reason: "re-correction", by: "dir" }).error);
});

test("avenant altéré après coup : la chaîne le détecte aussi", () => {
  const s = att.openSheet({ session: mkSession(8), learners: LEARNERS, openedBy: "prof" });
  att.lockSheet(s.id, "prof");
  att.amendSheet(s.id, { learnerId: "l2", status: "excuse", reason: "convocation", by: "dir" });
  const liens = [
    ...att.listSheets({ campusId: "camp1", status: "locked" }).map((x) => ({ ...x })),
    ...att.listAmendments("camp1").map((x) => ({ ...x })),
  ];
  assert.equal(verifyChain(liens).ok, true);
  // quelqu'un maquille le motif d'un avenant
  const victime = liens.find((l) => l.kind === "amendment" && l.sheetId === s.id);
  victime.reason = "motif réécrit";
  const verdict = verifyChain(liens);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, victime.id);
  assert.match(verdict.reason, /avenant modifié/);
});

test("altération silencieuse d'une feuille : la chaîne la détecte", () => {
  // La chaîne mêle feuilles closes ET avenants : les deux doivent être fournis.
  const liens = [
    ...att.listSheets({ campusId: "camp1", status: "locked" }).map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e })) })),
    ...att.listAmendments("camp1").map((a) => ({ ...a })),
  ];
  assert.equal(verifyChain(liens).ok, true);
  // quelqu'un modifie une feuille ancienne sans repasser par un avenant
  const victim = liens.find((l) => l.seq === 1);
  victim.entries[0].status = "absent";
  const verdict = verifyChain(liens);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, victim.id);
  assert.match(verdict.reason, /modifiée après clôture/);
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

test("partitionnement : un fichier par campus et par année scolaire", () => {
  const fsx = fs, pathx = path;
  const dir = pathx.join(process.env.DATA_DIR, "attendance");
  // Deux campus, deux années scolaires → quatre partitions distinctes
  for (const [campus, date] of [["pA", "2026-10-05"], ["pA", "2027-03-05"], ["pB", "2026-10-05"]]) {
    const s = att.openSheet({ session: { id: `p-${campus}-${date}`, campusId: campus, classId: "c", date, start: "09:00", end: "12:00" }, learners: LEARNERS });
    att.lockSheet(s.id, "prof");
  }
  const fichiers = fsx.readdirSync(dir).filter((f) => f.endsWith(".json"));
  // L'année scolaire court de septembre à août : octobre 2026 et mars 2027 sont
  // dans la MÊME année scolaire (2026), donc la même partition.
  assert.equal(schoolYearOf("2026-10-05"), "2026");
  assert.equal(schoolYearOf("2027-03-05"), "2026");
  assert.equal(schoolYearOf("2027-09-01"), "2027");
  assert.ok(fichiers.includes("pA__2026.json"), `partition pA attendue, vu : ${fichiers.join(", ")}`);
  assert.ok(fichiers.includes("pB__2026.json"));

  // Les campus restent étanches
  assert.equal(att.listSheets({ campusId: "pA" }).length, 2);
  assert.equal(att.listSheets({ campusId: "pB" }).length, 1);
  // et leurs chaînes sont indépendantes et intègres
  assert.equal(att.verifyCampusChain("pA").ok, true);
  assert.equal(att.verifyCampusChain("pA").count, 2);
  assert.equal(att.verifyCampusChain("pB").count, 1);
});

test("chaîne d'un campus : elle traverse les années scolaires", () => {
  const a1 = att.openSheet({ session: { id: "sy1", campusId: "pC", classId: "c", date: "2026-11-02", start: "09:00", end: "12:00" }, learners: LEARNERS });
  const l1 = att.lockSheet(a1.id, "prof");
  // Année scolaire suivante, MÊME campus : la chaîne continue, elle ne repart pas.
  const a2 = att.openSheet({ session: { id: "sy2", campusId: "pC", classId: "c", date: "2027-11-02", start: "09:00", end: "12:00" }, learners: LEARNERS });
  const l2 = att.lockSheet(a2.id, "prof");
  assert.equal(l2.seq, 2, "la séquence continue d'une année sur l'autre");
  assert.equal(l2.prevHash, l1.hash, "le maillon pointe vers l'année précédente");
  assert.equal(att.verifyCampusChain("pC").ok, true);
  // Un avenant sur la feuille de l'an dernier reste dans SA partition
  att.amendSheet(a1.id, { learnerId: "l1", status: "absent", reason: "justificatif tardif", by: "dir" });
  assert.equal(att.verifyCampusChain("pC").ok, true);
  assert.equal(att.listAmendments("pC").length, 1);
});

test("chaînes de campus indépendantes", () => {
  const s = att.openSheet({ session: mkSession(7, "camp2"), learners: LEARNERS, openedBy: "prof" });
  const locked = att.lockSheet(s.id, "prof");
  assert.equal(locked.seq, 1); // repart à 1 sur un autre campus
  assert.equal(locked.prevHash, GENESIS_HASH);
  assert.equal(att.verifyCampusChain("camp2").ok, true);
  assert.equal(att.verifyCampusChain("camp1").ok, true);
});

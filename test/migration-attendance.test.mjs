// Reprise du fichier d'émargement historique vers le stockage partitionné.
// Ce test protège une migration qui s'exécutera sur des DONNÉES RÉELLES au
// premier démarrage : une erreur ici perdrait des preuves de réalisation.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmmig-"));
process.env.DATA_KEY = "test-key-migration";
const { encrypt, decrypt } = await import("../lib/crypto-store.js");

// L'ancien format doit exister AVANT le premier import du store.
const ancien = {
  sheets: [
    { id: "s1", campusId: "cA", date: "2026-10-01", start: "09:00", end: "12:00", status: "locked", seq: 1, prevHash: "0".repeat(64), hash: "h1", entries: [{ learnerId: "l1", status: "present" }], amendments: [] },
    { id: "s2", campusId: "cA", date: "2027-10-01", start: "09:00", end: "12:00", status: "locked", seq: 2, prevHash: "h1", hash: "h2", entries: [], amendments: [] },
    { id: "s3", campusId: "cB", date: "2026-10-01", start: "09:00", end: "12:00", status: "open", entries: [], amendments: [] },
  ],
  amendments: [{ id: "a1", kind: "amendment", campusId: "cA", sheetId: "s1", seq: 3, prevHash: "h2", hash: "h3", learnerId: "l1", from: "present", to: "absent", reason: "justificatif", at: "2026-11-01T10:00:00Z", by: "dir" }],
};
fs.writeFileSync(path.join(process.env.DATA_DIR, "attendance.json"), encrypt(ancien));
const att = await import("../lib/attendancestore.js");

test("migration : aucune feuille perdue, partitions correctes", () => {
  assert.equal(att.listSheets({}).length, 3);
  assert.equal(att.listSheets({ campusId: "cA" }).length, 2);
  assert.equal(att.listSheets({ campusId: "cB" }).length, 1);
  const parts = fs.readdirSync(path.join(process.env.DATA_DIR, "attendance")).sort();
  assert.deepEqual(parts, ["cA__2026.json", "cA__2027.json", "cB__2026.json"], `partitions obtenues : ${parts}`);
});

test("migration : l'avenant suit la partition de SA feuille", () => {
  assert.equal(att.listAmendments("cA").length, 1);
  const p2026 = decrypt(fs.readFileSync(path.join(process.env.DATA_DIR, "attendance", "cA__2026.json"), "utf8"));
  assert.equal(p2026.amendments.length, 1, "l'avenant doit être avec la feuille s1 (2026)");
  const p2027 = decrypt(fs.readFileSync(path.join(process.env.DATA_DIR, "attendance", "cA__2027.json"), "utf8"));
  assert.equal((p2027.amendments || []).length, 0);
});

test("migration : les sceaux d'origine ne sont pas recalculés", () => {
  // Re-hacher pendant une migration invaliderait tous les ancrages externes déjà
  // publiés. La migration DÉPLACE, elle ne re-scelle jamais.
  assert.equal(att.getSheet("s1").hash, "h1");
  assert.equal(att.getSheet("s1").seq, 1);
  assert.equal(att.getSheet("s2").prevHash, "h1");
});

test("migration : l'ancien fichier est neutralisé, pas rejoué", () => {
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, "attendance.json")));
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, "attendance.json.migre")), "l'original est conservé sous .migre");
  // Une nouvelle écriture ne ressuscite pas l'ancien format
  att.openSheet({ session: { id: "s4", campusId: "cB", date: "2026-10-02", start: "09:00", end: "12:00" }, learners: [{ id: "l9" }] });
  assert.equal(att.listSheets({}).length, 4);
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, "attendance.json")));
});

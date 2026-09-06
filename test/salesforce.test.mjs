import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmsf-"));
process.env.DATA_KEY = "test-key-salesforce";
const store = await import("../lib/store.js");
const { parseMapLines, buildSoql, normalizeRecords, sfToken, sfQuery, testConnection, clearTokenCache } = await import("../lib/salesforce.js");

// ---------- Mapping (pur) ----------

test("parseMapLines : lignes 'valeur = cible', insensible au vide/mal formé", () => {
  assert.deepEqual(parseMapLines("PAR = Paris 15\nLYO=Lyon Part-Dieu\n\nligne invalide\n = vide"), { par: "Paris 15", lyo: "Lyon Part-Dieu" });
  assert.deepEqual(parseMapLines(""), {});
  assert.deepEqual(parseMapLines(null), {});
});

test("buildSoql : colonnes dédupliquées, WHERE optionnel", () => {
  const soql = buildSoql({ object: "Lead", fields: { nom: "LastName", prenom: "FirstName" }, where: "Status != 'Junk'" });
  assert.match(soql, /^SELECT Id, LastName, FirstName FROM Lead WHERE Status != 'Junk' ORDER BY/);
});

test("normalizeRecords : mappe statuts et campus, tolère les accents/casse", () => {
  const campuses = [{ id: "c1", name: "Paris 15" }, { id: "c2", name: "Lyon Part-Dieu" }];
  const cfg = {
    fields: { nom: "LastName", prenom: "FirstName", email: "Email", statut: "Status", campus: "Campus__c" },
    statusMapText: "Qualified = entretien\nClosed - Converted = inscrit",
    campusMapText: "PAR = Paris 15\nLYO = Lyon Part-Dieu",
  };
  const records = [
    { Id: "00Q1", LastName: "Dupont", FirstName: "Léa", Email: "l@d.fr", Status: "Qualified", Campus__c: "PAR" },
    { Id: "00Q2", LastName: "Martin", FirstName: "Sami", Email: "", Status: "Unknown Status", Campus__c: "Lyon part-dieu" },
    { Id: "00Q3", LastName: "Petit", FirstName: "Jules", Email: "", Status: "Closed - Converted", Campus__c: "INCONNU" },
  ];
  const rows = normalizeRecords(records, cfg, campuses);
  assert.equal(rows[0].stage, "entretien");
  assert.equal(rows[0].campusId, "c1");
  assert.equal(rows[1].stage, "nouveau"); // statut non mappé → défaut
  assert.equal(rows[1].campusId, "c2");   // match direct par nom, insensible casse
  assert.equal(rows[2].stage, "inscrit"); // mapping par défaut (DEFAULT_STATUS_MAP)
  assert.equal(rows[2].campusId, null);   // valeur inconnue → pas de campus
});

// ---------- Client HTTP (mock Salesforce) ----------

function mockSalesforce({ tokenOk = true, records = [] } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/services/oauth2/token")) {
        if (!tokenOk) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid_client" })); }
        return res.end(JSON.stringify({ access_token: "tok-abc", instance_url: `http://127.0.0.1:${srv.address().port}` }));
      }
      if (req.url.startsWith("/services/data/v59.0/query")) {
        return res.end(JSON.stringify({ records, done: true }));
      }
      if (req.url === "/services/data/") {
        return res.end(JSON.stringify([{ version: "59.0" }, { version: "60.0" }]));
      }
      res.statusCode = 404; res.end("{}");
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("sfToken : échange client credentials, message clair si refusé", async () => {
  clearTokenCache();
  const { srv, base } = await mockSalesforce({ tokenOk: true });
  try {
    const t = await sfToken({ instanceUrl: base, clientId: "id", clientSecret: "secret" });
    assert.equal(t.token, "tok-abc");
  } finally { srv.close(); }
  clearTokenCache();
  const bad = await mockSalesforce({ tokenOk: false });
  try {
    await assert.rejects(() => sfToken({ instanceUrl: bad.base, clientId: "id", clientSecret: "wrong" }), /refusée/);
  } finally { bad.srv.close(); }
});

test("testConnection : renvoie l'org et l'API la plus récente", async () => {
  clearTokenCache();
  const { srv, base } = await mockSalesforce({ tokenOk: true });
  try {
    const r = await testConnection({ instanceUrl: base, clientId: "id", clientSecret: "secret" });
    assert.equal(r.ok, true);
    assert.equal(r.latestApi, "60.0");
  } finally { srv.close(); }
});

test("sfQuery : renvoie les records de la page unique", async () => {
  clearTokenCache();
  const records = [{ Id: "00Q1", LastName: "Dupont" }];
  const { srv, base } = await mockSalesforce({ tokenOk: true, records });
  try {
    const rows = await sfQuery({ instanceUrl: base, clientId: "id", clientSecret: "secret" }, "SELECT Id FROM Lead");
    assert.deepEqual(rows, records);
  } finally { srv.close(); }
});

// ---------- Store : upsert + conversion ----------

test("upsertCandidateFromSf : crée puis met à jour par sfId, ne rétrograde jamais un converti", () => {
  const c1 = store.upsertCandidateFromSf({ sfId: "00Q1", nom: "Dupont", prenom: "Léa", stage: "nouveau", campusId: null });
  assert.equal(c1.action, "created");
  const c2 = store.upsertCandidateFromSf({ sfId: "00Q1", nom: "Dupont", prenom: "Léa", stage: "entretien", campusId: null });
  assert.equal(c2.action, "updated");
  assert.equal(c2.candidate.stage, "entretien");
  // conversion, puis une resync ne doit pas changer l'étape ni délier le dossier
  store.updateCandidate(c2.candidate.id, { learnerId: "fake-learner-id" });
  const c3 = store.upsertCandidateFromSf({ sfId: "00Q1", nom: "Dupont", prenom: "Léa", stage: "perdu", campusId: null });
  assert.equal(c3.candidate.stage, "entretien"); // pas rétrogradé
  assert.equal(c3.candidate.learnerId, "fake-learner-id");
});

test("convertCandidate : crée le dossier apprenant + inscription, sans doublon si dossier existant", () => {
  const campus = store.addCampus({ name: "Campus Conv" });
  const classe = store.addClass({ campusId: campus.id, name: "BTS 1" });
  const cand = store.addCandidate({ campusId: campus.id, nom: "Roux", prenom: "Max", email: "max@test.fr", stage: "admis" });
  const r = store.convertCandidate(cand.id, { classId: classe.id, schoolYear: "2026-2027" });
  assert.equal(r.learnerCreated, true);
  assert.equal(r.learner.nom, "Roux");
  assert.equal(r.enrollment.schoolYear, "2026-2027");
  assert.equal(store.getCandidate(cand.id).learnerId, r.learner.id);
  // reconversion refusée
  const again = store.convertCandidate(cand.id, {});
  assert.ok(again.error);
  // un dossier déjà présent (même nom+prénom+email) est lié, pas dupliqué
  const cand2 = store.addCandidate({ campusId: campus.id, nom: "Roux", prenom: "Max", email: "max@test.fr", stage: "admis" });
  const r2 = store.convertCandidate(cand2.id, {});
  assert.equal(r2.learnerCreated, false);
  assert.equal(r2.learner.id, r.learner.id);
  assert.equal(store.listLearners({ campusId: campus.id }).length, 1);
});

test("convertCandidate : sans campus → erreur explicite", () => {
  const cand = store.addCandidate({ nom: "Sans", prenom: "Campus", stage: "admis" });
  const r = store.convertCandidate(cand.id, {});
  assert.ok(r.error);
});

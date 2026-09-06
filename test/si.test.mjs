import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store isolé (même pattern que store.test.mjs) — à définir AVANT l'import du store.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmsi-"));
process.env.DATA_KEY = "test-key-si";
const store = await import("../lib/store.js");
const { parseFrDate, frDate, asList, summarize, siGet, syncCampus } = await import("../lib/si.js");

// ---------- Helpers purs ----------

test("parseFrDate : accepte JJ/MM/AAAA, JJ-MM-AAAA et ISO", () => {
  assert.equal(parseFrDate("01/09/2026"), "2026-09-01");
  assert.equal(parseFrDate("15-03-2025"), "2025-03-15");
  assert.equal(parseFrDate("2026-09-01"), "2026-09-01");
  assert.equal(parseFrDate(""), null);
  assert.equal(parseFrDate(null), null);
});

test("frDate : format JJ-MM-AAAA attendu par les paths du SI", () => {
  assert.equal(frDate(new Date(2026, 8, 6)), "06-09-2026");
});

test("asList : tableau direct ou objet indexé par code (les deux existent selon les instances)", () => {
  assert.deepEqual(asList([1, 2]), [1, 2]);
  assert.deepEqual(asList({ 12: "a", 13: "b" }), ["a", "b"]);
  assert.deepEqual(asList(null), []);
});

// ---------- Agrégation cockpit ----------

const NOW = new Date("2026-09-06T08:00:00Z");
const FIXTURE = {
  apprenants: [
    { codeApprenant: 1, nomApprenant: "DUPONT", prenomApprenant: "Léa" },
    { codeApprenant: 2, nomApprenant: "MARTIN", prenomApprenant: "Sami" },
    { codeApprenant: 3, nomApprenant: "BERNARD", prenomApprenant: "Jules" },
    { codeApprenant: 1, nomApprenant: "DUPONT", prenomApprenant: "Léa" }, // 2 inscriptions = 1 apprenant
  ],
  absences: [
    { codeApprenant: 1, duree: 420, isJustifie: false, isRetard: false }, // 7 h non justifiées
    { codeApprenant: 1, duree: 60, isJustifie: true, isRetard: false },
    { codeApprenant: 2, duree: 120, isJustifie: true, isRetard: false },
    { codeApprenant: 3, duree: 10, isJustifie: false, isRetard: true }, // retard, pas une absence
  ],
  contrats: [
    { codeContrat: 10, codeApprenant: 1, dateDebContrat: "01/09/2025", dateFinContrat: "31/08/2027", resilEnCours: 0 },
    { codeContrat: 11, codeApprenant: 2, dateDebContrat: "01/09/2025", dateFinContrat: "31/08/2027", resilEnCours: 1, nomMotifResiliation: "Abandon" },
    { codeContrat: 12, codeApprenant: 3, dateDebContrat: "01/09/2024", dateFinContrat: "31/08/2026", dateResiliation: "20/08/2026", nomMotifResiliation: "Rupture employeur", resilEnCours: 0 },
    { codeContrat: 13, codeApprenant: 3, dateDebContrat: "01/09/2024", dateFinContrat: "31/08/2025", dateResiliation: "01/02/2025", resilEnCours: 0 }, // hors fenêtre
  ],
  statsFin: [
    { minutePrevu: 10000, minuteAssiduite: 9000, montantFacture: 5000, montantAssiduite: 4500 },
    { minutePrevu: 10000, minuteAssiduite: 9500, montantFacture: 5000, montantAssiduite: 4800 },
  ],
};

test("summarize : effectif distinct, absences, absentéisme, ruptures, écart OPCO", () => {
  const s = summarize(FIXTURE, { now: NOW, windowDays: 30 });
  assert.equal(s.effectif, 3); // 4 lignes mais 3 apprenants distincts
  assert.equal(s.absences.totalMin, 600); // le retard n'est pas compté
  assert.equal(s.absences.unjustifiedMin, 420);
  assert.equal(s.absences.retards, 1);
  assert.equal(s.absences.topAbsents[0].nom, "Léa DUPONT"); // le plus absent en premier
  assert.equal(s.assiduite.absentRate, 7.5); // 1 - 18500/20000
  assert.equal(s.contrats.actifs, 2); // 10 + 11 (résiliation en cours = encore actif) ; 12 et 13 résiliés/terminés
  assert.equal(s.contrats.rupturesEnCours.length, 1);
  assert.equal(s.contrats.rupturesEnCours[0].apprenant, "Sami MARTIN");
  assert.equal(s.contrats.rupturesPeriode.length, 1); // le 20/08/2026 est dans la fenêtre, pas le 01/02/2025
  assert.equal(s.contrats.rupturesPeriode[0].motif, "Rupture employeur");
  assert.equal(s.finance.ecart, 700); // 10000 facturés - 9300 assiduité
});

test("summarize : sections null quand l'endpoint a échoué (jeton partiel)", () => {
  const s = summarize({ apprenants: FIXTURE.apprenants, absences: null, contrats: null, statsFin: null, errors: { absences: "403" } }, { now: NOW });
  assert.equal(s.effectif, 3);
  assert.equal(s.absences, null);
  assert.equal(s.contrats, null);
  assert.equal(s.finance, null);
  assert.ok(s.errors.absences);
});

// ---------- Client HTTP (serveur mock local) ----------

function mockSi(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("siGet : envoie le jeton en X-Auth-Token et parse le JSON", async () => {
  let seenToken = null;
  const { srv, base } = await mockSi((req, res) => {
    seenToken = req.headers["x-auth-token"];
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([{ codeSite: 1, nomSite: "Campus Test" }]));
  });
  try {
    const out = await siGet({ baseUrl: base + "/", token: "tok-123" }, "/r/v1/sites");
    assert.equal(seenToken, "tok-123");
    assert.equal(out[0].nomSite, "Campus Test");
  } finally { srv.close(); }
});

test("siGet : 401 → message explicite jeton refusé", async () => {
  const { srv, base } = await mockSi((req, res) => { res.statusCode = 401; res.end("{}"); });
  try {
    await assert.rejects(() => siGet({ baseUrl: base, token: "bad" }, "/r/v1/sites"), /Jeton refusé par le SI/);
  } finally { srv.close(); }
});

test("syncCampus : agrège les 4 endpoints, tolère un endpoint en échec", async () => {
  const { srv, base } = await mockSi((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/absences/")) { res.statusCode = 403; res.end("{}"); return; }
    if (req.url.includes("apprenants")) return res.end(JSON.stringify(FIXTURE.apprenants));
    if (req.url.includes("contrats")) return res.end(JSON.stringify(FIXTURE.contrats));
    if (req.url.includes("stats-financieres")) return res.end(JSON.stringify(FIXTURE.statsFin));
    res.end("[]");
  });
  try {
    const s = await syncCampus({ baseUrl: base, token: "t" }, { now: NOW, windowDays: 30 });
    assert.equal(s.effectif, 3);
    assert.equal(s.absences, null); // endpoint refusé → section absente, pas de crash
    assert.equal(s.contrats.rupturesEnCours.length, 1);
    assert.ok(s.errors.absences);
  } finally { srv.close(); }
});

test("syncCampus : échec total → erreur (pas de snapshot vide)", async () => {
  const { srv, base } = await mockSi((req, res) => { res.statusCode = 401; res.end("{}"); });
  try {
    await assert.rejects(() => syncCampus({ baseUrl: base, token: "bad" }, { now: NOW }), /Jeton refusé par le SI/);
  } finally { srv.close(); }
});

// ---------- Store : config masquée + snapshots ----------

test("store SI : le jeton n'est jamais exposé, champ vide = conservé", () => {
  const c = store.addCampus({ name: "Si Campus" });
  store.setSiConfig(c.id, { baseUrl: "https://erp.demo.test/", token: "secret-9876", codesSite: "1" });
  const masked = store.maskSiConfig(c.id);
  assert.equal(masked.configured, true);
  assert.equal(masked.tokenMask, "•••9876");
  assert.ok(!JSON.stringify(masked).includes("secret-9876"));
  // base URL normalisée (pas de slash final) et mise à jour sans jeton → jeton conservé
  assert.equal(store.getSiConfig(c.id).baseUrl, "https://erp.demo.test");
  store.setSiConfig(c.id, { baseUrl: "https://erp.demo.test", codesSite: "1,2" });
  assert.equal(store.getSiConfig(c.id).token, "secret-9876");
  assert.equal(store.getSiConfig(c.id).codesSite, "1,2");
});

test("store SI : snapshot + historique dédoublonné par jour + erreur", () => {
  const c = store.addCampus({ name: "Si Campus 2" });
  const s1 = summarize(FIXTURE, { now: NOW, windowDays: 30 });
  store.setSiSnapshot(c.id, s1);
  store.setSiSnapshot(c.id, s1); // 2e sync du même jour → 1 seul point d'historique
  let snap = store.getSiSnapshot(c.id);
  assert.equal(snap.history.length, 1);
  assert.equal(snap.history[0].effectif, 3);
  assert.equal(snap.lastError, null);
  store.setSiError(c.id, "boom");
  snap = store.getSiSnapshot(c.id);
  assert.equal(snap.lastError.message, "boom");
  assert.equal(snap.summary.effectif, 3); // l'erreur ne détruit pas le dernier snapshot
});

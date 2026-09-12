#!/usr/bin/env node
// Mesure de tenue a l'echelle : un reseau de 30 campus, en conditions reelles.
//
// POURQUOI CE SCRIPT EST DANS LE DEPOT — une mesure de performance qu'on ne peut
// pas rejouer n'est pas une mesure, c'est un souvenir. Celle-ci a deja servi
// deux fois a trouver des defauts qu'aucun test fonctionnel ne voyait :
//   - un calcul de decrochage en O(n2) : 3 979 ms pour UN campus ;
//   - une comparaison par valeur sur 45 000 lignes A CHAQUE ECRITURE : 326 ms.
//
// ATTENTION : sous Docker Desktop macOS, mesurer depuis l'hote traverse le
// passe-plat reseau de la VM, qui s'effondre (79 s pour un count(*) execute en
// 5 ms par la base). Ce script doit tourner DANS le reseau Docker.
//
// Usage :
//   DATABASE_URL=postgres://… DB_SCHEMA=echelle30 node scripts/bench-echelle.mjs --seed
//   DATABASE_URL=postgres://… DB_SCHEMA=echelle30 node scripts/bench-echelle.mjs
//
// Le schema dedie evite que les tests unitaires, qui vident les tables, ne
// detruisent le jeu de donnees entre deux mesures.

import { spawn } from "node:child_process";
import * as db from "../lib/db.js";

const SEED = process.argv.includes("--seed");
const CAMPUS = 30, PAR_CAMPUS = 500, CLASSES_PAR_CAMPUS = 20, EVALS_PAR_CLASSE = 24;

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL requis"); process.exit(1); }

if (SEED) {
  await db.ensureSchema();
  for (const c of db.COLLECTION_NAMES) await db.replaceCollection(c, []);
  const t0 = Date.now();
  const modules = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, code: `U${i}`, label: `Matiere ${i}`, coefficient: 1 + (i % 3) }));
  await db.putMany("curricula", [{ id: "cur1", name: "BTS", modules,
    blocks: [{ id: "b1", code: "B1", label: "Bloc 1", moduleIds: modules.slice(0, 4).map((m) => m.id) },
             { id: "b2", code: "B2", label: "Bloc 2", moduleIds: modules.slice(4).map((m) => m.id) }] }]);
  await db.putMany("campuses", Array.from({ length: CAMPUS }, (_, i) => ({ id: `c${i}`, name: `Campus ${i}`, city: `Ville ${i}` })));

  const classes = [];
  for (let c = 0; c < CAMPUS; c++) for (let j = 0; j < CLASSES_PAR_CAMPUS; j++) {
    classes.push({ id: `k${classes.length}`, campusId: `c${c}`, name: `Classe ${j}`, curriculumId: "cur1", year: 1 });
  }
  await db.putMany("classes", classes);

  const total = CAMPUS * PAR_CAMPUS;
  const apprenants = [], inscriptions = [];
  for (let n = 0; n < total; n++) {
    apprenants.push({ id: `l${n}`, campusId: `c${Math.floor(n / PAR_CAMPUS)}`, nom: `Nom${n}`, prenom: `Prenom${n}`,
      ine: `INE${n}`, dateNaissance: "2005-01-01", email: `a${n}@x.fr`, telephone: "0600000000" });
    inscriptions.push({ id: `e${n}`, learnerId: `l${n}`, campusId: `c${Math.floor(n / PAR_CAMPUS)}`,
      classId: `k${Math.floor(n / 25)}`, schoolYear: "2026-2027", statut: "inscrit", dateDebut: "2026-09-01" });
  }
  await db.putMany("learners", apprenants);
  await db.putMany("enrollments", inscriptions);

  const evals = [];
  for (const cl of classes) for (let i = 0; i < EVALS_PAR_CLASSE; i++) {
    evals.push({ id: `a${evals.length}`, campusId: cl.campusId, classId: cl.id, label: `Eval ${i}`,
      moduleId: modules[i % 8].id, coefficient: 1, maxScore: 20, date: "2027-01-15" });
  }
  await db.putMany("assessments", evals);

  let g = 0, lot = [];
  for (let n = 0; n < total; n++) {
    const base = Math.floor(n / 25) * EVALS_PAR_CLASSE;
    for (let i = 0; i < EVALS_PAR_CLASSE; i++) {
      lot.push({ id: `g${g++}`, learnerId: `l${n}`, assessmentId: `a${base + i}`, score: 8 + (n + i) % 12 });
      if (lot.length >= 20000) { await db.putMany("grades", lot); lot = []; }
    }
  }
  if (lot.length) await db.putMany("grades", lot);
  for (let a = 0; a < 200000; a += 20000) {
    await db.putMany("audit", Array.from({ length: 20000 }, (_, i) => ({ id: `au${a + i}`, action: "update", target: "x", detail: "courant", createdAt: "2027-01-01T00:00:00Z" })));
  }
  console.log(`jeu de donnees cree en ${((Date.now() - t0) / 1000).toFixed(0)} s :`,
    Object.entries(await db.counts()).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" "));
  await db.close();
  process.exit(0);
}

// ---- Mesure ----
const PORT = 3299;
const srv = spawn(process.execPath, ["server.js"], { cwd: new URL("..", import.meta.url).pathname,
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR: "/tmp/bench-echelle",
    DATA_KEY: process.env.DATA_KEY || "bench_key_0123456789_0123456789", SESSION_SECRET: "b",
    OPENAI_API_KEY: "sk-test", ADMIN_EMAIL: "admin@bench.co", APP_PASSWORD: "pw12345678" } });
const B = `http://127.0.0.1:${PORT}`;
const t0 = Date.now();
for (let i = 0; i < 180; i++) { try { if ((await fetch(B + "/health")).ok) break; } catch { /* pas pret */ } await new Promise((r) => setTimeout(r, 500)); }
const demarrage = (Date.now() - t0) / 1000;

const r = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@bench.co", password: "pw12345678" }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const campus = await (await fetch(B + "/api/campuses", { headers: { cookie } })).json();
const cid = campus[0]?.id;
if (!cid) { console.error("aucun campus : lancer d'abord avec --seed"); srv.kill("SIGKILL"); process.exit(1); }
const classes = await (await fetch(B + `/api/classes?campusId=${cid}`, { headers: { cookie } })).json();
const app1 = await (await fetch(B + `/api/learners?campusId=${cid}`, { headers: { cookie } })).json();

console.log(`\n${campus.length} campus, ${app1.length} apprenants sur le premier — demarrage en ${demarrage.toFixed(1)} s`);
console.log(`memoire du processus serveur : voir docker stats\n`);
console.log("ROUTE                              DUREE   CODE   TAILLE");
console.log("-".repeat(58));
const SEUIL = 300;
const lents = [];
const routes = [
  ["campus", "/api/campuses"], ["reseau (heatmap)", "/api/network"], ["notifications", "/api/notifications"],
  ["apprenants (1 campus)", `/api/learners?campusId=${cid}`], ["apprenants (tout le reseau)", "/api/learners"],
  ["export Excel apprenants", "/api/export/learners"],
  ["fiche apprenant", `/api/learners/${app1[0].id}`],
  ["export RGPD (1 apprenant)", `/api/learners/${app1[0].id}/export`],
  ["bulletin (1 apprenant)", `/api/learners/${app1[0].id}/report`],
  ["bulletins de classe", `/api/classes/${classes[0].id}/reports`],
  ["contrats", `/api/contracts?campusId=${cid}`], ["factures", `/api/invoices?campusId=${cid}`],
  ["declaration SIFA", `/api/declarations/sifa?campusId=${cid}&annee=2026`],
  ["risque de decrochage", `/api/risque/decrochage?campusId=${cid}`],
  ["journal d'audit", "/api/audit"], ["rapport (board pack)", "/api/report"],
];
for (const [nom, chemin] of routes) {
  const t = Date.now();
  let code = "ERR", ko = 0;
  try { const res = await fetch(B + chemin, { headers: { cookie } }); code = res.status; ko = (await res.text()).length / 1024; }
  catch { code = "TIMEOUT"; }
  const ms = Date.now() - t;
  if (ms > SEUIL && code === 200) lents.push(`${nom} (${ms} ms)`);
  console.log(`${nom.padEnd(34)}${String(ms).padStart(6)} ms ${String(code).padStart(6)} ${ko.toFixed(0).padStart(6)} Ko`);
}
// Cout d'une ECRITURE : c'est lui qui s'etait degrade sans qu'aucun test le voie.
const tEcr = [];
for (let i = 0; i < 5; i++) {
  const t = Date.now();
  await fetch(B + "/api/campuses", { method: "POST", headers: { cookie, "Content-Type": "application/json",
    "X-CSRF-Token": (cookie.match(/ac_csrf=([^;]+)/) || [])[1] || "" }, body: JSON.stringify({ name: `Mesure ${i}` }) });
  tEcr.push(Date.now() - t);
}
console.log(`\necriture (creation de campus, ${tEcr.length} essais) : ${Math.min(...tEcr)}-${Math.max(...tEcr)} ms`);
console.log(lents.length ? `\nAU-DESSUS DE ${SEUIL} ms : ${lents.join(", ")}` : `\naucune route au-dessus de ${SEUIL} ms`);
srv.kill("SIGKILL");

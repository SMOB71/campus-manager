// Campus de démonstration pour le module Enseignement.
//
// Crée un campus complet et cohérent : référentiel, salles, professeurs (dont un
// prestataire), classes, calendrier scolaire, puis génère et applique l'emploi du
// temps. Tout est préfixé « DÉMO » pour être repérable et supprimable.
//
//   node scripts/seed-demo-planning.mjs                       # local (port 3200)
//   BASE=https://campusmanager.fr EMAIL=… PW=… node scripts/seed-demo-planning.mjs
//   ... --clean                                               # supprime la démo
//
// ⚠️ Les volumes horaires ci-dessous sont ILLUSTRATIFS. Le référentiel officiel du
// BTS Opticien-Lunetier s'importe depuis son PDF (vue Référentiels → Importer un
// fichier) : l'extraction propose, tu valides. Ne prends pas ces chiffres pour
// argent comptant, ils servent à faire tourner la démonstration.

const BASE = process.env.BASE || "http://127.0.0.1:3200";
const EMAIL = process.env.EMAIL || "admin@test.co";
const PW = process.env.PW || "pw12345678";
const CLEAN = process.argv.includes("--clean");
const TAG = "DÉMO";

let cookie = "", csrf = "";
const H = () => ({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf });
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt.slice(0, 200); }
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const del = (p) => call("DELETE", p);

async function login() {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) });
  if (!r.ok) throw new Error(`connexion refusée (${r.status}) — vérifie EMAIL et PW`);
  const jar = {};
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  csrf = jar.ac_csrf;
}

// --- Suppression de la démo ---------------------------------------------------
async function clean() {
  const campuses = (await get("/api/campuses")).filter((c) => c.name.includes(TAG));
  for (const c of campuses) {
    for (const s of await get(`/api/sessions?campusId=${c.id}`)) await del(`/api/sessions/${s.id}`);
    for (const k of await get(`/api/classes?campusId=${c.id}`)) await del(`/api/classes/${k.id}`);
    for (const r of await get(`/api/rooms?campusId=${c.id}`)) await del(`/api/rooms/${r.id}`);
    for (const p of await get(`/api/periods?campusId=${c.id}`)) await del(`/api/periods/${p.id}`);
    await del(`/api/campuses/${c.id}`);
    console.log(`  campus supprimé : ${c.name}`);
  }
  for (const t of (await get("/api/teachers")).filter((x) => x.name.includes(TAG))) await del(`/api/teachers/${t.id}`);
  for (const r of (await get("/api/curricula")).filter((x) => x.name.includes(TAG))) await del(`/api/curricula/${r.id}`);
  console.log("Démo supprimée.");
}

// --- Création -----------------------------------------------------------------
async function seed() {
  const step = (n, t) => console.log(`\n${n}. ${t}`);

  step(1, "Campus et filières");
  const campus = await post("/api/campuses", {
    name: `ISO Paris 15 — ${TAG}`, city: "Paris", region: "Île-de-France",
    network: "ISO", address: "12 rue de Vaugirard, 75015 Paris", capacity: 120,
  });
  await call("PATCH", `/api/campuses/${campus.id}/filieres`, { filieres: [
    { nom: "BTS Opticien-Lunetier 1re année", type: "BTS", niveau: "1A", modalite: "initial", effectif: 24, capacite: 30, frais: 7200 },
    { nom: "BTS Opticien-Lunetier 2e année", type: "BTS", niveau: "2A", modalite: "alternance", effectif: 21, capacite: 30, frais: 8100 },
  ] });
  const filieres = (await get("/api/campuses")).find((c) => c.id === campus.id).filieres;
  console.log(`   ${campus.name} — ${filieres.length} filières, ${filieres.reduce((a, f) => a + (f.effectif || 0), 0)} étudiants`);

  step(2, "Référentiel (volumes ILLUSTRATIFS — à remplacer par l'import du PDF officiel)");
  const cur = await post("/api/curricula", {
    name: `BTS Opticien-Lunetier — ${TAG}`, diploma: "BTS", level: "Niveau 5",
    source: "Saisie de démonstration",
    modules: [
      { code: "U1", label: "Culture générale et expression", heures: 120, year: 1 },
      { code: "U2", label: "Langue vivante (anglais)", heures: 90, year: 1 },
      { code: "U3", label: "Mathématiques et sciences physiques", heures: 150, year: 1 },
      { code: "U41", label: "Optique géométrique et physique", heures: 180, year: 1 },
      { code: "U42", label: "Travaux pratiques d'optique", heures: 120, year: 1, requiresRoom: "optique" },
      { code: "U51", label: "Analyse de la vision", heures: 140, year: 2, requiresRoom: "optique" },
      { code: "U52", label: "Contactologie", heures: 110, year: 2, requiresRoom: "optique" },
      { code: "U6", label: "Gestion et développement commercial", heures: 100, year: 2 },
      { code: "U7", label: "Atelier de montage-usinage", heures: 90, year: 1, requiresRoom: "atelier" },
    ],
  });
  const tot = (await get("/api/curricula")).find((c) => c.id === cur.id).totalHours;
  console.log(`   ${cur.modules.length} modules, ${tot} h au total`);

  step(3, "Salles — avec leurs spécificités");
  const rooms = [];
  for (const r of [
    { name: "A101 — Amphi", places: 80, kind: "standard" },
    { name: "B201", places: 32, kind: "standard" },
    { name: "B202", places: 32, kind: "standard" },
    { name: "Salle d'optique", places: 24, kind: "optique", equipment: ["banc d'optique", "réfracteur", "frontofocomètre"] },
    { name: "Atelier montage", places: 20, kind: "atelier", equipment: ["meuleuse", "poste de montage"] },
  ]) rooms.push(await post("/api/rooms", { campusId: campus.id, ...r }));
  console.log(`   ${rooms.length} salles dont ${rooms.filter((r) => r.kind !== "standard").length} spécialisées`);

  step(4, "Professeurs et prestataires");
  const dispoLarge = { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "17:00"]] };
  const teachers = [];
  for (const t of [
    { name: `Marie Dupont — ${TAG}`, status: "permanent", heuresAnnuelles: 620, tauxHoraire: 48,
      subjects: ["Optique géométrique et physique", "Travaux pratiques d'optique"], availability: dispoLarge, email: "demo.dupont@example.org" },
    { name: `Paul Roy — ${TAG}`, status: "permanent", heuresAnnuelles: 580, tauxHoraire: 46,
      subjects: ["Analyse de la vision", "Contactologie"], availability: dispoLarge, email: "demo.roy@example.org" },
    { name: `Sophie Bernard — ${TAG}`, status: "vacataire", heuresAnnuelles: 220, tauxHoraire: 52,
      subjects: ["Mathématiques et sciences physiques"],
      // Un vacataire n'est là que deux jours : c'est la contrainte qui coince en premier.
      availability: { mar: [["09:00", "17:00"]], jeu: [["09:00", "17:00"]] } },
    { name: `Claire Moreau — ${TAG}`, status: "vacataire", heuresAnnuelles: 200, tauxHoraire: 44,
      subjects: ["Culture générale et expression", "Langue vivante (anglais)"],
      availability: { lun: [["09:00", "16:00"]], mer: [["09:00", "16:00"]], ven: [["09:00", "16:00"]] } },
    { name: `Cabinet Optic Formation — ${TAG}`, status: "prestataire", company: "Optic Formation SARL",
      contractRef: "BC-2026-114", heuresAnnuelles: 180, tauxHoraire: 85,
      subjects: ["Atelier de montage-usinage", "Gestion et développement commercial"],
      availability: { mer: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } },
  ]) teachers.push(await post("/api/teachers", { ...t, campusIds: [campus.id] }));
  console.log(`   ${teachers.length} intervenants, dont 1 prestataire (${teachers.find((t) => t.status === "prestataire").company})`);

  step(5, "Classes — c'est ICI que le campus est relié au diplôme");
  const classes = [];
  for (const [nom, an, fil] of [["OL 1re année", 1, filieres[0]], ["OL 2e année", 2, filieres[1]]]) {
    classes.push(await post("/api/classes", {
      campusId: campus.id, curriculumId: cur.id, filiereId: fil.id, name: `${nom} — ${TAG}`, year: an,
    }));
  }
  console.log(`   ${classes.length} promotions rattachées au référentiel « ${cur.name} »`);
  console.log("   → campus + référentiel + filière = une classe. Le diplôme se déclare une fois,");
  console.log("     chaque campus le décline en promotions.");

  step(6, "Calendrier scolaire 2026-2027");
  const periods = [
    { kind: "vacances", label: "Toussaint", from: "2026-10-17", to: "2026-11-02" },
    { kind: "vacances", label: "Noël", from: "2026-12-19", to: "2027-01-04" },
    { kind: "vacances", label: "Hiver", from: "2027-02-13", to: "2027-03-01" },
    { kind: "vacances", label: "Printemps", from: "2027-04-10", to: "2027-04-26" },
    { kind: "ferie", label: "Armistice", from: "2026-11-11", to: "2026-11-11" },
    { kind: "ferie", label: "1er mai", from: "2027-05-01", to: "2027-05-01" },
    { kind: "examens", label: "Épreuves blanches", from: "2027-03-15", to: "2027-03-19" },
    { kind: "stage", label: "Stage en magasin", from: "2027-01-11", to: "2027-02-05", classId: classes[1].id },
  ];
  for (const p of periods) await post("/api/periods", { campusId: campus.id, ...p });
  console.log(`   ${periods.length} périodes (le stage ne concerne que la 2e année)`);

  step(7, "Génération de la semaine type");
  const gen = await post("/api/schedule/generate", { campusId: campus.id, seed: 2026, weekOf: "2026-09-07", sessionMinutes: 120, weeksInYear: 34 });
  console.log(`   ${gen.stats.placed}/${gen.stats.demanded} séances placées (${gen.stats.coverage} %) — semaine du ${gen.weekOf}`);
  console.log(`   confort : ${gen.score.classGaps} h de trous étudiants, écart de charge ${gen.score.loadStdev}`);
  for (const d of gen.diagnosis || []) { console.log(`   ⚠ ${d.message}`); console.log(`     → ${d.remedy}`); }

  step(8, "Application sur l'année");
  const applied = await post("/api/schedule/apply", { week: gen.week, weekOf: gen.weekOf, until: "2027-06-30", campusId: campus.id });
  console.log(`   ${applied.created} séances datées (vacances, fériés et stage exclus)`);

  step(9, "Contrôle");
  for (const k of classes) {
    const cov = await get(`/api/schedule/coverage?classId=${k.id}`);
    console.log(`   ${k.name} : ${cov.total.planned} h posées / ${cov.total.due} h dues (${cov.total.pct} %)`);
  }
  const svc = await get(`/api/schedule/service?campusId=${campus.id}`);
  console.log(`   coût du planning : ${Math.round(svc.cost).toLocaleString("fr-FR")} € — écart de charge ${svc.equity.stdev} h`);
  for (const r of svc.rows.filter((r) => r.flags.length)) console.log(`   ⚠ ${r.name} : ${r.flags[0].message}`);
  const usage = await get(`/api/schedule/rooms-usage?campusId=${campus.id}&from=2026-09-07&to=2026-09-13`);
  console.log(`   salles : ${usage.rows.filter((r) => r.sessions).length}/${usage.rows.length} utilisées` + (usage.unused.length ? ` — inoccupées : ${usage.unused.join(", ")}` : ""));

  console.log(`\nTerminé. Ouvre « Enseignement → Emploi du temps », choisis « ${campus.name} ».`);
  console.log("Pour tout retirer : node scripts/seed-demo-planning.mjs --clean");
}

await login();
if (CLEAN) await clean(); else await seed();

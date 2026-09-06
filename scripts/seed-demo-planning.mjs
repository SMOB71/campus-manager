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

  step(2, "Référentiel — maquette officielle du BTS Opticien-Lunetier");
  // Structure des unités d'après le référentiel officiel (arrêté du 3 septembre 1997
  // modifié) : U1 français, U2 LV1, U3 économie-gestion, U41 mathématiques,
  // U42 optique géométrique et physique, U43 étude technique des systèmes optiques,
  // U61 examen de vue / prise de mesures, U62 contrôle d'équipement et réalisation
  // technique, U63 activités professionnelles, UF1 LV2 facultative.
  // Volumes hebdomadaires ~33 h en 1re année et ~34 h en 2e : à confirmer avec la
  // grille de TON établissement (l'import du PDF officiel les remplacera).
  const cur = await post("/api/curricula", {
    name: `BTS Opticien-Lunetier — ${TAG}`, diploma: "BTS", level: "Niveau 5 (bac+2)",
    source: "Structure officielle ; volumes à confirmer par import du référentiel",
    modules: [
      // --- 1re année ---
      { code: "U1", label: "Culture générale et expression", heuresSemaine: 2, year: 1 },
      { code: "U2", label: "Langue vivante 1 — anglais", heuresSemaine: 3, year: 1 },
      { code: "U3", label: "Économie et gestion de l'entreprise", heuresSemaine: 4, year: 1 },
      { code: "U41", label: "Mathématiques", heuresSemaine: 2, year: 1 },
      { code: "U42", label: "Optique géométrique et physique", heuresSemaine: 5, year: 1 },
      { code: "U43", label: "Étude technique des systèmes optiques", heuresSemaine: 4, year: 1, requiresRoom: "optique" },
      { code: "U61", label: "Examen de vue et prise de mesures", heuresSemaine: 6, year: 1, requiresRoom: "optique" },
      { code: "U62", label: "Contrôle d'équipement et réalisation technique", heuresSemaine: 6, year: 1, requiresRoom: "atelier" },
      { code: "UF1", label: "Langue vivante 2 (facultatif)", heuresSemaine: 1, year: 1 },
      // --- 2e année ---
      { code: "U1", label: "Culture générale et expression", heuresSemaine: 2, year: 2 },
      { code: "U2", label: "Langue vivante 1 — anglais", heuresSemaine: 3, year: 2 },
      { code: "U3", label: "Économie, gestion et droit de l'optique", heuresSemaine: 4, year: 2 },
      { code: "U41", label: "Mathématiques", heuresSemaine: 2, year: 2 },
      { code: "U42", label: "Optique physiologique", heuresSemaine: 4, year: 2 },
      { code: "U43", label: "Étude technique des systèmes optiques", heuresSemaine: 3, year: 2, requiresRoom: "optique" },
      { code: "U61", label: "Analyse de la vision et contactologie", heuresSemaine: 7, year: 2, requiresRoom: "optique" },
      { code: "U62", label: "Réalisation technique et montage", heuresSemaine: 6, year: 2, requiresRoom: "atelier" },
      { code: "U63", label: "Activités professionnelles et communication", heuresSemaine: 2, year: 2 },
      { code: "UF1", label: "Langue vivante 2 (facultatif)", heuresSemaine: 1, year: 2 },
    ],
  });
  const meta = (await get("/api/curricula")).find((c) => c.id === cur.id);
  console.log(`   ${cur.modules.length} unités — ${meta.weeklyByYear[1]} h/semaine en 1re année, ${meta.weeklyByYear[2]} h/semaine en 2e`);
  console.log("   (structure officielle ; les volumes exacts se remplacent par l'import du PDF)");

  step(3, "Salles — avec leurs spécificités");
  const rooms = [];
  for (const r of [
    { name: "A101 — Amphi", places: 80, kind: "standard" },
    { name: "B201", places: 32, kind: "standard" },
    { name: "B202", places: 32, kind: "standard" },
    { name: "Salle d'optique", places: 28, kind: "optique", equipment: ["banc d'optique", "réfracteur", "frontofocomètre"] },
    { name: "Salle d'optique 2", places: 28, kind: "optique", equipment: ["réfracteur"] },
    { name: "Atelier montage", places: 28, kind: "atelier", equipment: ["meuleuse", "poste de montage"] },
  ]) rooms.push(await post("/api/rooms", { campusId: campus.id, ...r }));
  console.log(`   ${rooms.length} salles dont ${rooms.filter((r) => r.kind !== "standard").length} spécialisées`);

  // Horaires d'ouverture réels : le mercredi après-midi est fermé, le vendredi
  // s'arrête plus tôt. La grille de génération s'y cale au lieu d'un 8 h–18 h partout.
  await call("PUT", `/api/campuses/${campus.id}/hours`, { hours: {
    lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]],
    mer: [["08:00", "12:30"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "17:00"]], sam: [],
  } });
  console.log("   horaires : lun-jeu 8h-18h, mer matin seulement, ven jusqu'à 17h, samedi fermé");

  step(4, "Professeurs et prestataires");
  const dispoLarge = { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "17:00"]] };
  const teachers = [];
  for (const t of [
    { name: `Marie Dupont — ${TAG}`, status: "permanent", heuresAnnuelles: 620, tauxHoraire: 48,
      subjects: ["Optique géométrique et physique", "Optique physiologique", "Étude technique des systèmes optiques"], availability: dispoLarge, email: "demo.dupont@example.org" },
    { name: `Paul Roy — ${TAG}`, status: "permanent", heuresAnnuelles: 580, tauxHoraire: 46,
      subjects: ["Examen de vue et prise de mesures", "Analyse de la vision et contactologie"], availability: dispoLarge, email: "demo.roy@example.org" },
    { name: `Sophie Bernard — ${TAG}`, status: "vacataire", heuresAnnuelles: 220, tauxHoraire: 52,
      subjects: ["Mathématiques"],
      // Un vacataire n'est là que deux jours : c'est la contrainte qui coince en premier.
      availability: { mar: [["09:00", "17:00"]], jeu: [["09:00", "17:00"]] } },
    { name: `Claire Moreau — ${TAG}`, status: "vacataire", heuresAnnuelles: 200, tauxHoraire: 44,
      subjects: ["Culture générale et expression", "Langue vivante 1 — anglais", "Langue vivante 2 (facultatif)"],
      availability: { lun: [["09:00", "16:00"]], mer: [["09:00", "16:00"]], ven: [["09:00", "16:00"]] } },
    { name: `Cabinet Optic Formation — ${TAG}`, status: "prestataire", company: "Optic Formation SARL",
      contractRef: "BC-2026-114", heuresAnnuelles: 180, tauxHoraire: 85,
      subjects: ["Contrôle d'équipement et réalisation technique", "Réalisation technique et montage",
                 "Économie et gestion de l'entreprise", "Économie, gestion et droit de l'optique",
                 "Activités professionnelles et communication"],
      availability: { mer: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } },
    { name: `Julien Faure — ${TAG}`, status: "permanent", heuresAnnuelles: 600, tauxHoraire: 47,
      subjects: ["Examen de vue et prise de mesures", "Analyse de la vision et contactologie", "Étude technique des systèmes optiques"], availability: dispoLarge },
    { name: `Nadia Bensaïd — ${TAG}`, status: "permanent", heuresAnnuelles: 590, tauxHoraire: 46,
      subjects: ["Contrôle d'équipement et réalisation technique", "Réalisation technique et montage"], availability: dispoLarge },
    { name: `Thomas Leroy — ${TAG}`, status: "vacataire", heuresAnnuelles: 300, tauxHoraire: 50,
      subjects: ["Économie et gestion de l'entreprise", "Économie, gestion et droit de l'optique", "Activités professionnelles et communication"],
      availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]] } },
    { name: `Hélène Girard — ${TAG}`, status: "vacataire", heuresAnnuelles: 280, tauxHoraire: 45,
      subjects: ["Mathématiques", "Optique géométrique et physique"],
      availability: { lun: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], ven: [["08:00", "17:00"]] } },
  ]) teachers.push(await post("/api/teachers", { ...t, campusIds: [campus.id] }));
  console.log(`   ${teachers.length} intervenants (${teachers.filter((t) => t.status === "permanent").length} permanents, ${teachers.filter((t) => t.status === "vacataire").length} vacataires, 1 prestataire)`);

  step(5, "Classes — c'est ICI que le campus est relié au diplôme");
  const classes = [];
  for (const [nom, an, fil] of [["OL 1re année", 1, filieres[0]], ["OL 2e année", 2, filieres[1]]]) {
    classes.push(await post("/api/classes", {
      campusId: campus.id, curriculumId: cur.id, filiereId: fil.id, name: `${nom} — ${TAG}`, year: an,
      modalite: fil.modalite,
      rythme: fil.modalite === "alternance" ? "2 sem. école / 2 sem. entreprise" : "",
      weeksAtSchool: fil.modalite === "alternance" ? 17 : null,
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
  // Alternance : une semaine sur deux en entreprise pour la 2e année. Sans ces
  // périodes, la récurrence poserait des cours pendant que la classe est en poste.
  for (let i = 0; i < 17; i++) {
    const d = new Date("2026-09-21T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i * 28);
    const a = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 11);
    periods.push({ kind: "entreprise", label: "En entreprise", from: a, to: d.toISOString().slice(0, 10), classId: classes[1].id });
  }
  for (const p of periods) await post("/api/periods", { campusId: campus.id, ...p });
  console.log(`   ${periods.length} périodes — dont ${periods.filter((p) => p.kind === "entreprise").length} semaines en entreprise pour la 2e année (alternance)`);

  step(7, "Génération de la semaine type");
  const gen = await post("/api/schedule/generate", { campusId: campus.id, seed: 2026, weekOf: "2026-09-07", sessionMinutes: 120, weeksInYear: 36, maxHoursPerDayClass: 8, maxHoursPerDayTeacher: 7, restarts: 20 });
  console.log(`   ${gen.stats.placed}/${gen.stats.demanded} séances placées (${gen.stats.coverage} %) — semaine du ${gen.weekOf}`);
  console.log(`   confort : ${gen.score.classGaps} h de trous étudiants, écart de charge ${gen.score.loadStdev}`);
  for (const d of gen.diagnosis || []) { console.log(`   ⚠ ${d.message}`); console.log(`     → ${d.remedy}`); }

  step(8, "Application sur l'année");
  const applied = await post("/api/schedule/apply", { week: gen.week, weekOf: gen.weekOf, until: "2027-06-30", campusId: campus.id });
  console.log(`   ${applied.created} séances datées (vacances, fériés et stage exclus)`);

  step(9, "Contrôle");
  for (const k of classes) {
    const cov = await get(`/api/schedule/coverage?classId=${k.id}`);
    console.log(`   ${k.name} : ${cov.weeklyDue} h/semaine dues — ${cov.total.planned} h posées / ${cov.total.due} h sur ${cov.weeks} semaines (${cov.total.pct} %)`);
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

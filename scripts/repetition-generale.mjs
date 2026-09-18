// Répétition générale — une promotion complète, de l'inscription aux déclarations.
//
// POURQUOI CE SCRIPT EXISTE. L'application a sept cent dix-huit tests, et zéro
// apprenant réel. Les tests unitaires vérifient chaque pièce ; ils ne vérifient
// pas que la chaîne tient bout à bout — qu'un contrat déposé donne une facture,
// qu'un émargement clos alimente un certificat de réalisation, qu'une promotion
// de quinze apprentis passe les seuils de publication.
//
// Ce script joue une année entière sur une instance JETABLE, dans l'ordre réel,
// et signale tout ce qui casse ou refuse. Il ne touche JAMAIS la production :
// une promotion fictive dans la base réelle serait exactement le genre de
// pollution qu'on ne sait plus retirer six mois après.
//
// Il ne remplace pas la vraie mise en service : personne n'a encore signé, payé
// ni contrôlé. Mais il dit ce qui casserait au premier essai.
//
//   node scripts/repetition-generale.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(os.tmpdir(), "repet-"));
const EFFECTIF = 15;   // au-dessus du seuil de publication des indicateurs

let BASE = "", cookie = "", csrf = "", enfant = null;
const etapes = [];

function noter(phase, libelle, etat, detail = "") {
  etapes.push({ phase, libelle, etat, detail });
  const icone = { ok: "  ok ", refus: " REFUS", casse: " CASSE", note: "  · " }[etat] || "  ? ";
  console.log(`${icone} ${libelle}${detail ? ` — ${detail}` : ""}`);
}

const H = () => ({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf });
async function call(method, chemin, corps) {
  const r = await fetch(BASE + chemin, { method, headers: H(), body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* HTML ou vide */ }
  return { status: r.status, json, texte };
}
const GET = (c) => call("GET", c);
const POST = (c, b) => call("POST", c, b);
const PATCH = (c, b) => call("PATCH", c, b);

// Un appel attendu en succès. Tout autre résultat est une CASSE : la chaîne
// s'arrête là où un utilisateur réel se serait arrêté.
async function doit(phase, libelle, promesse) {
  const r = await promesse;
  if (r.status >= 200 && r.status < 300) { noter(phase, libelle, "ok"); return r.json; }
  noter(phase, libelle, "casse", `HTTP ${r.status} — ${r.json?.error || r.texte.slice(0, 120)}`);
  return null;
}
// Un appel dont on ATTEND le refus : c'est une garde qui fait son travail.
async function refuse(phase, libelle, promesse) {
  const r = await promesse;
  if (r.status >= 400) { noter(phase, libelle, "refus", r.json?.error?.slice(0, 110) || `HTTP ${r.status}`); return true; }
  noter(phase, libelle, "casse", `accepté alors qu'il devait être refusé (HTTP ${r.status})`);
  return false;
}

async function demarrer() {
  enfant = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PORT: "0", DATA_DIR: dir,
      DATA_KEY: "repetition_generale_jetable_0123456789",
      SESSION_SECRET: "repet", OPENAI_API_KEY: "sk-test",
      ADMIN_EMAIL: "repet@test.co", APP_PASSWORD: "pw12345678",
      NODE_ENV: "test", DATABASE_URL: "",
    },
  });
  let sortie = "", erreurs = "";
  enfant.stdout.on("data", (d) => { sortie += d; });
  enfant.stderr.on("data", (d) => { erreurs += d; });
  const limite = Date.now() + 30000;
  for (;;) {
    const m = sortie.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      BASE = `http://127.0.0.1:${m[1]}`;
      try { if ((await fetch(BASE + "/health")).ok) break; } catch { /* pas prêt */ }
    }
    if (Date.now() > limite) throw new Error(`serveur non démarré\n${erreurs.slice(-600)}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  const lr = await fetch(BASE + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "repet@test.co", password: "pw12345678" }),
  });
  const jar = {};
  for (const c of lr.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  csrf = jar.ac_csrf;
}

async function jouer() {
  // ===== Phase 1 — l'organisme existe =====
  console.log("\n— Phase 1 : l'organisme existe\n");
  const campus = await doit("1", "Création du campus", POST("/api/campuses", {
    name: "CFA Répétition", city: "Saint-Denis", siret: "12345678900012",
    numeroDeclaration: "11930000000", dirigeant: "S. Francese", address: "1 rue du Test",
    referentHandicap: "C. Martin",
  }));
  if (!campus) return;
  const cid = campus.id;

  await doit("1", "Règlement intérieur établi", PATCH("/api/documents-of/reglement", {
    campusId: cid, reglement: {
      version: "2026-1", dateApplication: "2026-09-01",
      hygieneSecurite: "Consignes incendie, trousse de secours, équipements de protection.",
      disciplinaire: "Assiduité, ponctualité, respect du matériel.",
      sanctions: "Avertissement, blâme, exclusion temporaire ou définitive.",
      procedure: "Convocation écrite, entretien, possibilité d'assistance, notification motivée.",
      representation: "Élection d'un délégué titulaire et d'un suppléant au premier trimestre.",
    },
  }));

  // ===== Phase 2 — l'offre et la capacité à former =====
  console.log("\n— Phase 2 : offre et capacité\n");
  const cur = await doit("2", "Référentiel BTS", POST("/api/curricula", {
    name: "BTS Opticien-Lunetier", codeRncp: "35338", level: "5", dureeCycleAnnees: 2,
    modules: [
      { code: "M1", label: "Optique géométrique et physique", heuresSemaine: 8, year: 1 },
      { code: "M2", label: "Analyse de la vision", heuresSemaine: 7, year: 1 },
      { code: "M3", label: "Contactologie", heuresSemaine: 5, year: 1 },
      { code: "M4", label: "Gestion et communication", heuresSemaine: 5, year: 1 },
    ],
    blocks: [{ code: "B1", label: "Analyse de la vision" }, { code: "B2", label: "Équipement optique" }],
  }));
  const salle = await doit("2", "Salle équipée", POST("/api/rooms", { campusId: cid, name: "Plateau optique", places: 20, kind: "atelier" }));
  const classe = await doit("2", "Classe en alternance", POST("/api/classes", {
    campusId: cid, curriculumId: cur?.id, name: "BTS OL 1re année", year: 1, modalite: "alternance",
  }));
  if (!classe) return;

  await doit("2", "Certification : habilitation déclarée", POST("/api/certifications", {
    campusId: cid, curriculumId: cur.id,
    habilitation: {
      regime: "habilitation", certificateur: "Ministère de l'Éducation nationale",
      reference: "HAB-2025-118", dateDebut: "2025-09-01", dateFin: "2029-08-31",
      exigences: [{ id: "e1", libelle: "Livret de suivi visé par le maître d'apprentissage" }],
    },
  }));

  // ===== Phase 3 — l'équipe =====
  console.log("\n— Phase 3 : l'équipe\n");
  const profs = [];
  for (const [nom, matiere] of [["Claire Martin", "Optique géométrique et physique"], ["Paul Sivan", "Analyse de la vision"]]) {
    const t = await doit("3", `Intervenant ${nom}`, POST("/api/teachers", {
      name: nom, email: `${nom.split(" ")[0].toLowerCase()}@cfa.fr`, status: "vacataire",
      campusIds: [cid], subjects: [matiere], tauxHoraire: 45, heuresAnnuelles: 250,
      matricule: `M${profs.length + 1}`, regle: "+10 % préparation",
      availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] },
    }));
    if (t) profs.push(t);
  }
  for (const t of profs) {
    await doit("3", `Contrat de ${t.name}`, POST("/api/contrats-intervenants", {
      campusId: cid, teacherId: t.id, nature: "cdd", motif: "accroissement",
      poste: t.subjects[0], dateDebut: "2026-09-01", dateFin: "2027-08-31",
      signeLe: "2026-08-25", dpaeLe: "2026-08-24", conventionCollective: "OF privés",
    }));
  }

  // ===== Phase 4 — la promotion =====
  console.log(`\n— Phase 4 : la promotion (${EFFECTIF} apprentis)\n`);
  const apprenants = [];
  for (let i = 0; i < EFFECTIF; i++) {
    const l = await POST("/api/learners", {
      campusId: cid, nom: `NOM${String(i + 1).padStart(2, "0")}`, prenom: `Prenom${i + 1}`,
      email: `apprenti${i + 1}@exemple.fr`, dateNaissance: i < 3 ? "2009-05-12" : "2005-03-08",
    });
    if (l.status !== 200) { noter("4", `Apprenant ${i + 1}`, "casse", l.json?.error || `HTTP ${l.status}`); continue; }
    apprenants.push(l.json);
    await POST(`/api/learners/${l.json.id}/enrollments`, {
      campusId: cid, classId: classe.id, statut: "inscrit", schoolYear: "2026-2027",
    });
  }
  noter("4", `${apprenants.length}/${EFFECTIF} apprentis inscrits`, apprenants.length === EFFECTIF ? "ok" : "casse");
  noter("4", "Dont 3 mineurs — le planning doit les voir", "note");

  await doit("4", "Remise du règlement intérieur tracée", POST("/api/documents-of/remise", { campusId: cid }));

  // ===== Phase 5 — le rythme et le planning =====
  console.log("\n— Phase 5 : rythme d'alternance et planning\n");
  const rythme = await doit("5", "Rythme 2 semaines centre / 2 semaines entreprise", POST("/api/schedule/rythme/apply", {
    classId: classe.id, debut: "2026-09-07", fin: "2027-06-30", centre: 2, entreprise: 2,
  }));
  if (rythme) noter("5", `${rythme.weeksAtSchool} semaines en centre`, "note");

  // Une journée de 9 h pour une classe où siègent des mineurs : la garde des
  // durées légales doit refuser, et c'est tout l'objet du contrôle.
  await refuse("5", "Journée de 9 h avec des mineurs : refusée", POST("/api/sessions", {
    campusId: cid, classId: classe.id, roomId: salle?.id, teacherId: profs[0]?.id,
    moduleId: cur.modules[0].id, date: "2026-09-08", start: "08:00", end: "17:00", kind: "cours",
  }));

  let posees = 0;
  for (let j = 0; j < 20 && posees < 8; j++) {
    const d = new Date(Date.UTC(2026, 8, 7 + j)).toISOString().slice(0, 10);
    for (const [debut, fin, prof, mod] of [["09:00", "12:00", 0, 0], ["13:30", "16:30", 1, 1]]) {
      const r = await POST("/api/sessions", {
        campusId: cid, classId: classe.id, roomId: salle?.id, teacherId: profs[prof]?.id,
        moduleId: cur.modules[mod].id, date: d, start: debut, end: fin, kind: "cours",
      });
      if (r.status === 200) posees++;
    }
  }
  noter("5", `${posees} séances posées sur les semaines en centre`, posees ? "ok" : "casse");

  // ===== Phase 6 — émargement =====
  console.log("\n— Phase 6 : émargement\n");
  const seances = (await GET(`/api/sessions?campusId=${cid}&from=2026-09-01&to=2026-12-31`)).json || [];
  let feuilles = 0, closes = 0;
  for (const s of seances.slice(0, 4)) {
    // La feuille s'ouvre depuis la SÉANCE : c'est le geste « faire l'appel ».
    const f = await POST(`/api/sessions/${s.id}/attendance`, {});
    if (f.status !== 200) { noter("6", `Ouverture de la feuille du ${s.date}`, "casse", f.json?.error || `HTTP ${f.status}`); continue; }
    feuilles++;
    const entrees = apprenants.map((a, i) => ({ learnerId: a.id, status: i === 0 ? "absent" : "present" }));
    await PATCH(`/api/attendance/sheets/${f.json.id}/entries`, { entries: entrees });
    const c = await POST(`/api/attendance/sheets/${f.json.id}/lock`, {});
    if (c.status === 200) closes++;
  }
  noter("6", `${feuilles} feuilles ouvertes, ${closes} closes et scellées`, closes ? "ok" : "casse");

  // ===== Phase 7 — publication des résultats =====
  console.log("\n— Phase 7 : ce qui se publie, et ce qui ne se publie pas\n");
  const croise = await POST("/api/exploitation/croiser", { campusId: cid, source: "resultats", ligne: "classe", colonne: "obtenu" });
  if (croise.json?.degenere) noter("7", "Croisement dégénéré : déclaré non exploitable", "ok", "une seule colonne, le masquage serait décoratif");
  else if (croise.json?.masquees) noter("7", `Croisement masqué (${croise.json.masquees} cases)`, "ok");
  else noter("7", "Croisement publié sans masquage", "note", `${EFFECTIF} inscrits, au-dessus du seuil`);

  await refuse("7", "Export nominatif sans finalité : refusé", POST("/api/exploitation/exporter", {
    campusId: cid, source: "apprenants", champs: ["nom", "prenom", "classe"],
  }));

  // ===== Phase 8 — les gardes de conformité =====
  console.log("\n— Phase 8 : les gardes\n");
  await refuse("8", "Convention servie à un particulier : refusée", POST("/api/actes", {
    campusId: cid, type: "convention", payeur: "particulier", intitule: "BTS OL",
    objectifs: "x", nature: "apprentissage", dureeHeures: 1350, dates: "x", effectif: 1,
    prix: 9000, moyens: "x", evaluation: "x", resiliation: "x", acheteur: "x",
    programme: { intitule: "BTS OL" }, echeances: [{ montant: 9000, date: "2026-10-01" }],
  }));
  await refuse("8", "Tarif sur une offre d'apprentissage : refusé", POST("/api/offres", {
    campusId: cid, nature: "apprentissage", intitule: "BTS OL", objectifs: "x", prerequis: "Bac",
    publicVise: "16-29 ans", dureeHeures: 1350, modalites: "presentiel", delaiAcces: "3 mois",
    tarif: "—", tarifMontant: 9000, evaluation: "x", accessibilite: "x", debouches: "x", contact: "x",
  }));
  await refuse("8", "CDD sans motif de recours : refusé", POST("/api/contrats-intervenants", {
    campusId: cid, teacherId: profs[0]?.id, nature: "cdd", poste: "Autre",
    dateDebut: "2027-09-01", dateFin: "2028-06-30",
  }));

  // ===== Phase 9 — l'état de mise en service =====
  console.log("\n— Phase 9 : où en est l'organisme\n");
  const chantier = (await GET(`/api/chantier?campusId=${cid}`)).json;
  if (chantier?.chantiers) {
    for (const c of chantier.chantiers) {
      noter("9", c.titre, c.sansObjet ? "note" : c.fait ? "ok" : "refus", c.sansObjet ? "sans objet" : c.fait ? "" : c.enjeu.slice(0, 90));
    }
  }
  const demarrage = (await GET(`/api/demarrage?campusId=${cid}`)).json;
  if (demarrage) {
    noter("9", `Contrôle de mise en service : ${demarrage.bloquants} bloquant(s), ${demarrage.importants} important(s)`,
      demarrage.exploitable ? "ok" : "refus");
    // Un compteur ne dit pas quoi faire. On nomme les points, et ce qu'ils
    // empêchent — c'est la seule partie exploitable de ce contrôle.
    for (const p of (demarrage.points || []).filter((x) => x.niveau !== "conseille")) {
      noter("9", `  ${p.quoi}`, p.niveau === "bloquant" ? "refus" : "note", p.empeche);
    }
  }
}

// ---------- Exécution ----------
try {
  await demarrer();
  console.log(`\nRÉPÉTITION GÉNÉRALE — instance jetable, la production n'est pas touchée.`);
  await jouer();
} catch (e) {
  console.error("\nInterrompu :", e.message);
} finally {
  const casses = etapes.filter((e) => e.etat === "casse");
  const refus = etapes.filter((e) => e.etat === "refus");
  console.log("\n" + "—".repeat(72));
  console.log(`${etapes.length} étapes jouées · ${casses.length} cassées · ${refus.length} refus attendus ou points ouverts`);
  if (casses.length) {
    console.log("\nCE QUI A CASSÉ — un utilisateur réel se serait arrêté là :");
    for (const c of casses) console.log(`  · [${c.phase}] ${c.libelle} — ${c.detail}`);
  } else {
    console.log("\nAucune rupture de chaîne. Les refus ci-dessus sont des gardes qui ont fonctionné.");
  }
  console.log("\nCe script ne remplace pas la mise en service : personne n'a signé, payé ni contrôlé.");
  try { enfant?.kill("SIGKILL"); } catch { /* déjà mort */ }
  rmSync(dir, { recursive: true, force: true });
}

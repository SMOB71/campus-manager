import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store isolé : DATA_DIR temporaire + chiffrement actif. À définir AVANT l'import du store.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmtest-"));
process.env.DATA_KEY = "test-key-abc123";
const store = await import("../lib/store.js");
const { buildOpeningTasks, buildOpeningBudget } = await import("../lib/calc.js");
const demarrage = await import("../lib/demarrage.js");

test("campus : create + list", () => {
  const c = store.addCampus({ name: "Test Nantes", city: "Nantes" });
  assert.ok(c.id);
  assert.ok(store.listCampuses().some((x) => x.id === c.id));
});

test("addKpi : merge par (campus, mois) sans écraser les champs absents", () => {
  const c = store.addCampus({ name: "KpiCampus" });
  store.addKpi({ campusId: c.id, month: "2026-06", students: 200, occupancy: 80, revenue: 100000 });
  store.addKpi({ campusId: c.id, month: "2026-06", payroll: 55000, charges: 25000 }); // 2e écriture partielle
  const k = store.latestKpi(c.id);
  assert.equal(k.students, 200);      // conservé
  assert.equal(k.revenue, 100000);    // conservé
  assert.equal(k.payroll, 55000);     // ajouté
  assert.equal(k.charges, 25000);
  // un seul enregistrement pour ce mois
  assert.equal(store.listKpi(c.id).filter((x) => x.month === "2026-06").length, 1);
});

test("setKpiPostes : l'agrégat du poste = somme des sous-lignes", () => {
  const c = store.addCampus({ name: "PostesCampus" });
  store.setKpiPostes(c.id, "2026-05", "charges", [{ label: "Loyer", amount: 12000 }, { label: "Énergie", amount: 3000 }]);
  const k = store.listKpi(c.id).find((x) => x.month === "2026-05");
  assert.equal(k.charges, 15000);
  assert.equal(k.postes.charges.length, 2);
  assert.equal(store.setKpiPostes(c.id, "2026-05", "invalide", []), null); // poste inconnu
});

test("openings : create + seed tâches + budget", () => {
  const o = store.addOpening({ name: "Ouv Rennes", city: "Rennes", targetDate: "2027-09-06", budget: 500000 });
  store.setOpeningTasks(o.id, buildOpeningTasks(o.targetDate));
  const got = store.getOpening(o.id);
  assert.ok(got.tasks.length > 30);
  store.setOpeningBudget(o.id, buildOpeningBudget(500000));
  assert.equal(store.getOpening(o.id).budgetLines.find((l) => l.lot === "travaux").planned, 200000);
});

test("openings : lien campus (conversion) sans doublon", () => {
  const o = store.addOpening({ name: "Ouv Lyon", targetDate: "2027-09-06" });
  const c = store.addCampus({ name: "Lyon issu ouverture" });
  store.setOpeningCampus(o.id, c.id);
  assert.equal(store.getOpening(o.id).campusId, c.id);
});

test("scenarios : create + list + delete", () => {
  const s = store.addScenario({ name: "Cible 2026", target: 1500000, rows: [{ id: "x", rev: 600000, pay: 300000, chg: 120000 }] });
  assert.ok(store.listScenarios().some((x) => x.id === s.id));
  store.deleteScenario(s.id);
  assert.ok(!store.listScenarios().some((x) => x.id === s.id));
});

test("backup + restore : rollback d'un état", () => {
  const c = store.addCampus({ name: "AvantBackup" });
  const snap = store.backupNow();
  assert.ok(snap.ok && snap.name, "backupNow renvoie désormais un résultat, pas un nom brut");
  store.deleteCampus(c.id);
  assert.ok(!store.listCampuses().some((x) => x.id === c.id)); // supprimé
  const r = store.restoreBackup(snap.name);
  assert.equal(r.ok, true);
  assert.ok(store.listCampuses().some((x) => x.id === c.id)); // revenu
  assert.deepEqual(store.restoreBackup("../../etc/passwd"), { error: "nom de sauvegarde invalide" });
});

test("documents : indicateur Qualiopi filtrable", () => {
  const c = store.addCampus({ name: "DocCampus" });
  store.addDocument({ campusId: c.id, name: "preuve1.pdf", indicator: "3", file: "f1" });
  store.addDocument({ campusId: c.id, name: "autre.pdf", indicator: "7", file: "f2" });
  assert.equal(store.listDocuments(c.id, "3").length, 1);
  assert.equal(store.listDocuments(c.id, "3")[0].name, "preuve1.pdf");
  assert.equal(store.listDocuments(c.id).length, 2);
});

// --- Comités de pilotage & fiche action détaillée ---

test("normTask : les champs de la fiche survivent à une renormalisation complète", () => {
  // setOpeningTasks réapplique normTask à TOUTES les tâches : tout champ absent de
  // normTask serait effacé en silence. C'est le piège qui rend ce test nécessaire.
  const o = store.addOpening({ name: "Ouv Fiche", targetDate: "2027-09-01" });
  const t = store.addOpeningTask(o.id, {
    title: "Sécuriser le bail", lot: "immo", description: "6 ans fermes",
    accountable: "DAF", consulted: "Juridique", informed: "CODIR", progress: 30,
  });
  store.addTaskOutput(o.id, t.id, { label: "Bail signé", owner: "DAF" });
  store.addTaskComment(o.id, t.id, { by: "Stéphane", text: "Bailleur d'accord" });

  store.setOpeningTasks(o.id, store.getOpening(o.id).tasks); // la renormalisation
  const after = store.getOpening(o.id).tasks.find((x) => x.id === t.id);
  assert.equal(after.description, "6 ans fermes");
  assert.equal(after.accountable, "DAF");
  assert.equal(after.progress, 30);
  assert.equal(after.outputs.length, 1);
  assert.equal(after.comments.length, 1);
});

test("progress : borné à 0-100, vidable", () => {
  const o = store.addOpening({ name: "Ouv Progress" });
  const t = store.addOpeningTask(o.id, { title: "T", progress: 420 });
  assert.equal(t.progress, 100);
  assert.equal(store.updateOpeningTask(o.id, t.id, { progress: -5 }).progress, 0);
  assert.equal(store.updateOpeningTask(o.id, t.id, { progress: "" }).progress, null);
});

test("livrable : statut contraint, fichier optionnel", () => {
  const o = store.addOpening({ name: "Ouv Livrable" });
  const t = store.addOpeningTask(o.id, { title: "T" });
  const out = store.addTaskOutput(o.id, t.id, { label: "Dossier ERP", status: "n'importe quoi" });
  assert.equal(out.status, "todo");        // valeur inconnue → défaut
  assert.equal(out.documentId, null);      // le suivi marche sans fichier
  assert.equal(store.updateTaskOutput(o.id, t.id, out.id, { status: "validated" }).status, "validated");
  assert.equal(store.updateTaskOutput(o.id, t.id, out.id, { status: "bidon" }).status, "validated"); // refusé
  store.deleteTaskOutput(o.id, t.id, out.id);
  assert.equal(store.getOpening(o.id).tasks[0].outputs.length, 0);
});

test("comité : portée, séances, et lien vers les actions", () => {
  const o = store.addOpening({ name: "Ouv COPIL" });
  const c = store.addCommittee({ scope: "opening", scopeId: o.id, name: "COPIL", members: [{ name: "Marie", role: "DAF" }] });
  assert.equal(c.members[0].userId, null);   // membre sans compte applicatif
  const s = store.addSession(c.id, { date: "2026-10-01", agendaItems: [{ text: "Point bail" }] });
  assert.equal(s.status, "planned");
  const t = store.addOpeningTask(o.id, { title: "Action du comité", committeeId: c.id, sessionId: s.id });
  store.linkSessionTask(c.id, s.id, t.id);
  store.linkSessionTask(c.id, s.id, t.id);   // idempotent
  const back = store.getCommittee(c.id);
  assert.deepEqual(back.sessions[0].taskIds, [t.id]);
  assert.equal(back.sessions[0].agendaItems.length, 1);
  // filtrage par portée : un comité réseau ne doit pas remonter ici
  store.addCommittee({ scope: "network", name: "CODIR" });
  assert.equal(store.listCommittees({ scope: "opening", scopeId: o.id }).length, 1);
  assert.equal(store.listCommittees({ scope: "network" }).length, 1);
});

test("comité : scope inconnu retombe sur opening, suppression propre", () => {
  const c = store.addCommittee({ name: "X", scope: "galaxie" });
  assert.equal(c.scope, "opening");
  store.deleteCommittee(c.id);
  assert.equal(store.getCommittee(c.id), null);
});

test("checklist : l'avancement se dérive des étapes et reprend la main sans elles", () => {
  const o = store.addOpening({ name: "Ouv Checklist" });
  const t = store.addOpeningTask(o.id, { title: "Recruter le directeur", progress: 10 });
  assert.equal(t.progress, 10);                       // saisi librement tant qu'il n'y a pas d'étape

  const s1 = store.addTaskStep(o.id, t.id, { text: "Rédiger la fiche de poste" });
  store.addTaskStep(o.id, t.id, { text: "Passer les entretiens" });
  const get = () => store.getOpening(o.id).tasks.find((x) => x.id === t.id);
  assert.equal(get().progress, 0);                    // 0/2 dès la 1re étape
  store.updateTaskStep(o.id, t.id, s1.id, { done: true });
  assert.equal(get().progress, 50);                   // 1/2

  // la saisie manuelle est ignorée tant que la checklist existe
  store.updateOpeningTask(o.id, t.id, { progress: 99 });
  assert.equal(get().progress, 50);

  store.deleteTaskStep(o.id, t.id, s1.id);
  assert.equal(get().progress, 0);                    // 0/1 restant
  store.deleteTaskStep(o.id, t.id, get().steps[0].id);
  store.updateOpeningTask(o.id, t.id, { progress: 42 });
  assert.equal(get().progress, 42);                   // plus d'étape → saisie reprise

  // les étapes survivent aussi à la renormalisation
  store.addTaskStep(o.id, t.id, { text: "Signer" });
  store.setOpeningTasks(o.id, store.getOpening(o.id).tasks);
  assert.equal(get().steps.length, 1);
});

test("paramètres d'ouverture réseau : normalisation, zéro préservé, lignes inutiles écartées", () => {
  const s = store.setOpeningSettings({
    milestones: [{ title: "  Comité réseau  ", lot: "gouv", m: 0, critical: true }, { title: "   " }],
    thresholds: [{ label: "DG", minAmount: 100000, approver: "DG", leadDays: 0 }],
    leadTimes: [{ family: "refraction", leadWeeks: 30, amount: 145000 }, { family: "", supplier: "Orphelin" }],
  });
  assert.equal(s.milestones.length, 1, "un jalon sans titre ne sert à rien");
  assert.equal(s.milestones[0].title, "Comité réseau");
  // m: 0 et leadDays: 0 sont des valeurs VALIDES (jalon le jour J, validation immédiate).
  // `Number(v) || null` les aurait effacées en « non renseigné ».
  assert.equal(s.milestones[0].m, 0);
  assert.equal(s.thresholds[0].leadDays, 0);
  // Une ligne sans famille ne s'applique à aucune commande : la garder laisserait
  // croire qu'un délai fournisseur est pris en compte alors qu'il est ignoré.
  assert.equal(s.leadTimes.length, 1);
  assert.ok(s.milestones[0].id && s.leadTimes[0].id);

  // Patch partiel : ce qu'on ne passe pas n'est pas effacé.
  const s2 = store.setOpeningSettings({ thresholds: [] });
  assert.equal(s2.milestones.length, 1);
  assert.equal(s2.thresholds.length, 0);
  assert.equal(store.getOpeningSettings().leadTimes.length, 1);
});

test("COUVERTURE STATIQUE de touch() : aucun mutateur sur place ne doit l'oublier", async () => {
  // Le test de round-trip qui protège la classification exige une base PostgreSQL, donc
  // il est SAUTÉ en local et en CI sans base : cinq mutateurs sont passés au travers
  // (updateOpeningTask, updateTaskOutput, updateTaskStep, updateSession, linkSessionTask).
  // Conséquence : assigner un responsable, cocher une sous-étape, valider un livrable ou
  // saisir un compte rendu de COPIL était conservé en mémoire mais JAMAIS écrit en base —
  // perdu au premier redémarrage, sans le moindre message.
  //
  // Celui-ci lit le source et ne dépend de rien. Une fonction qui modifie un objet
  // IMBRIQUÉ dans une ligne de collection doit marquer la LIGNE avec touch(), sinon le
  // persister — qui compare des références — ne voit rien changer.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/store.js", import.meta.url), "utf8");
  // Helpers de persistance : ils valent touch(), donc ils DOIVENT le faire. On le vérifie
  // avant de s'en servir comme dispense, sinon la dispense serait un trou.
  const HELPERS = ["ecrireOuverture"];
  for (const h of HELPERS) {
    const corps = src.split(`function ${h}(`)[1]?.split("\n}")[0] || "";
    assert.ok(corps.includes("touch("), `le helper ${h}() doit marquer la ligne avec touch()`);
  }
  const manquants = [];
  for (const bloc of src.split(/\nexport (?:async )?function /).slice(1)) {
    const nom = bloc.split("(")[0];
    const corps = bloc.split("\nexport ")[0];
    // Les écritures passent soit par write(db), soit par un helper de persistance qui
    // marque lui-même la ligne. Ignorer le helper sortirait toute une famille du garde :
    // c'est exactement ce qui est arrivé en introduisant ecrireOuverture().
    const ecrit = corps.includes("write(db)") || HELPERS.some((h) => corps.includes(h + "("));
    const marque = corps.includes("touch(") || HELPERS.some((h) => corps.includes(h + "("));
    if (!ecrit || marque) continue;
    const vars = new Set([
      ...[...corps.matchAll(/(?:const|let)\s+(\w+)\s*=[^\n;]*\.find\(/g)].map((m) => m[1]),
      ...[...corps.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(?db\.\w+/g)].map((m) => m[1]),
      // Destructuration : `const [, t] = findTask(...)` jetait l'ouverture ET échappait à
      // la détection. Les huit fonctions de la famille « tâche » sont passées par là.
      ...[...corps.matchAll(/(?:const|let)\s*\[[^\]]*\]\s*=\s*\w+\(/g)]
        .flatMap((m) => m[0].replace(/^.*\[|\].*$/g, "").split(",").map((x) => x.trim()).filter(Boolean)),
    ]);
    for (const v of vars) {
      // Affectation d'un champ, d'un index, Object.assign — ou mutation d'un tableau
      // imbriqué (`t.outputs.push(...)`), qui ne change pas davantage la référence.
      const surPlace = new RegExp(
        `\\b${v}(?:\\.\\w+)+\\s*=[^=]` +
        `|\\b${v}\\[[^\\]]+\\]\\s*=[^=]` +
        `|Object\\.assign\\(\\s*${v}\\b` +
        `|\\b${v}(?:\\.\\w+)+\\.(?:push|pop|shift|unshift|splice|sort|reverse)\\(`);
      if (surPlace.test(corps)) { manquants.push(nom); break; }
    }
  }
  assert.deepEqual(manquants, [], `modification sur place non marquée par touch() : ${manquants.join(", ")}`);
});

test("les mutations imbriquées marquent bien leur ligne de collection", () => {
  const o = store.addOpening({ name: "Marquage", targetDate: "2028-09-04" });
  const t = store.addOpeningTask(o.id, { title: "Tâche", lot: "gouv" });
  const st = store.addTaskStep(o.id, t.id, { text: "Étape" });
  const ou = store.addTaskOutput(o.id, t.id, { label: "Livrable" });
  // Les quatre chemins qui perdaient leur écriture. On vérifie ici qu'ils produisent bien
  // le résultat attendu ; la garantie de persistance est portée par le test statique
  // ci-dessus et par le round-trip PostgreSQL.
  store.updateOpeningTask(o.id, t.id, { owner: "Claire", status: "doing" });
  store.updateTaskStep(o.id, t.id, st.id, { done: true });
  store.updateTaskOutput(o.id, t.id, ou.id, { status: "validated" });
  const relu = store.getOpening(o.id).tasks.find((x) => x.id === t.id);
  assert.equal(relu.owner, "Claire");
  assert.equal(relu.status, "doing");
  assert.equal(relu.steps[0].done, true);
  assert.equal(relu.outputs[0].status, "validated");

  const c = store.addCommittee({ name: "COPIL", scope: "opening", scopeId: o.id });
  const se = store.addSession(c.id, { date: "2027-01-15" });
  store.updateSession(c.id, se.id, { minutes: "Compte rendu", status: "held" });
  const sr = store.getCommittee(c.id).sessions[0];
  assert.equal(sr.minutes, "Compte rendu");
  assert.equal(sr.status, "held");
});

test("sauvegarde fichier : refusée en base, jamais silencieuse", async () => {
  // En mode fichier (ce test), elle fonctionne. En PostgreSQL elle doit REFUSER : db.json
  // est figé depuis la bascule, donc une « sauvegarde » y serait un instantané périmé
  // horodaté du jour, et la restaurer écraserait toute la base de production.
  assert.equal(store.sauvegardeFichierActive(), true, "sans DATABASE_URL, le mode fichier reste actif");
  const r = store.backupNow();
  assert.ok(r.ok && r.name);

  // On recharge le store avec DATABASE_URL pour vérifier le refus, sans toucher à la base.
  // usePg() est évalué à CHAQUE appel : la variable doit rester posée pendant les
  // vérifications, pas seulement pendant l'import.
  process.env.DATABASE_URL = "postgres://personne@127.0.0.1:1/neant";
  try {
    const enBase = await import("../lib/store.js?pg=" + Math.random());
    assert.equal(enBase.sauvegardeFichierActive(), false);
    assert.match(enBase.backupNow().error, /PostgreSQL/);
    assert.match(enBase.restoreBackup(r.name).error, /PostgreSQL/);
    assert.deepEqual(enBase.listBackupsMeta(), [], "ne présente pas des copies périmées comme l'état sauvegardé");
  } finally {
    delete process.env.DATABASE_URL;
  }
});

// TOUT CE QUE LE CONTRÔLE DE MISE EN SERVICE VÉRIFIE DOIT ÊTRE ENREGISTRABLE.
//
// `referentHandicap` était contrôlé par lib/demarrage.js sans figurer dans la
// liste blanche du store : le point ne pouvait être levé sur aucun campus,
// jamais. Une alerte permanente qu'on ne peut pas éteindre n'alerte plus —
// elle apprend à ignorer l'écran qui la porte.
test("les champs de campus contrôlés au démarrage sont réellement enregistrables", () => {
  const c = store.addCampus({
    name: "Contrôle", siret: "12345678900012", numeroDeclaration: "11930000000",
    dirigeant: "S. Francese", referentHandicap: "C. Martin", referentMobilite: "P. Sivan",
    uai: "0931234X", address: "1 rue du Test",
  });
  for (const f of ["siret", "numeroDeclaration", "dirigeant", "referentHandicap", "referentMobilite", "uai", "address"]) {
    assert.ok(c[f], `${f} perdu à la création`);
  }
  // Et modifiables ensuite : un champ qu'on ne peut poser qu'à la création se
  // retrouve bloqué sur tous les campus déjà existants.
  const maj = store.updateCampus(c.id, { referentHandicap: "A. Nouveau", numeroDeclaration: "11930000099" });
  assert.equal(maj.referentHandicap, "A. Nouveau");
  assert.equal(maj.numeroDeclaration, "11930000099");

  // Le contrôle ne doit plus rien reprocher sur ces points.
  const restants = demarrage.controler({ campus: maj, curricula: [{ modules: [{}] }], classes: [{}], teachers: [{}] })
    .points.map((p) => p.cle);
  for (const cle of ["siret", "nda", "dirigeant", "referent_handicap", "adresse", "nom"]) {
    assert.equal(restants.includes(cle), false, `« ${cle} » reproché alors que le champ est renseigné`);
  }
});

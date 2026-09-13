// Tests de la couche de persistance. Ils exigent une vraie base : une couche
// PostgreSQL testée contre un simulacre ne prouve rien du seul comportement
// qui compte ici — celui de PostgreSQL.
// Sans DATABASE_URL_TEST, ils sont SIGNALÉS comme non exécutés, jamais passés
// en silence : un test vert qui n'a rien testé est pire que pas de test.
import { test, before, after, skip } from "node:test";
import assert from "node:assert/strict";

const URL_TEST = process.env.DATABASE_URL_TEST;
let db = null;

before(async () => {
  if (!URL_TEST) return;
  process.env.DATABASE_URL = URL_TEST;
  db = await import("../lib/db.js");
  await db.ensureSchema();
  // Table d'essai vidée : on ne veut pas dépendre de ce qu'un run précédent a laissé.
  for (const c of ["learners", "grades"]) await db.replaceCollection(c, []);
});
after(async () => { if (db) await db.close(); });

const siBase = (nom, fn) => test(nom, { skip: URL_TEST ? false : "DATABASE_URL_TEST absent — base de test non fournie" }, fn);

siBase("schéma : une table par collection, créé de façon idempotente", async () => {
  // Rejoué à chaque démarrage : une instance neuve ne doit pas exiger d'étape
  // de migration manuelle.
  await db.ensureSchema();
  await db.ensureSchema();
  const c = await db.counts();
  assert.equal(Object.keys(c).length, db.COLLECTION_NAMES.length);
  assert.ok(db.COLLECTION_NAMES.includes("learners"));
});

siBase("écriture d'une ligne : insertion puis mise à jour au même identifiant", async () => {
  await db.put("learners", { id: "t1", campusId: "c1", nom: "Dupont", prenom: "Léa" });
  await db.put("learners", { id: "t1", campusId: "c1", nom: "Dupont", prenom: "Léa", telephone: "0600" });
  const all = await db.loadAll();
  const l = all.learners.filter((x) => x.id === "t1");
  assert.equal(l.length, 1, "une mise à jour ne crée pas de doublon");
  assert.equal(l[0].telephone, "0600");
});

siBase("colonnes générées : les filtres réellement utilisés sont indexés en SQL", async () => {
  // C'est ce que le fichier chiffré ne permettait pas du tout : interroger.
  await db.put("learners", { id: "t2", campusId: "c2", nom: "Martin", prenom: "Sami" });
  const { rows } = await db.getPool().query("select id from learners where campus_id = $1", ["c2"]);
  assert.deepEqual(rows.map((r) => r.id), ["t2"]);
});

siBase("écriture groupée : un import coûte un aller-retour, pas trois cents", async () => {
  const lot = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, campusId: "c3", nom: `N${i}`, prenom: "X" }));
  assert.equal(await db.putMany("learners", lot), 300);
  const { rows } = await db.getPool().query("select count(*)::int n from learners where campus_id = $1", ["c3"]);
  assert.equal(rows[0].n, 300);
  assert.equal(await db.putMany("learners", []), 0);
});

siBase("suppression unitaire et groupée", async () => {
  await db.put("learners", { id: "d1", campusId: "c4", nom: "A", prenom: "B" });
  await db.put("learners", { id: "d2", campusId: "c4", nom: "C", prenom: "D" });
  assert.equal(await db.del("learners", "d1"), 1);
  assert.equal(await db.del("learners", "inexistant"), 0, "supprimer l'absent n'est pas une erreur");
  assert.equal(await db.delMany("learners", ["d2"]), 1);
  assert.equal(await db.delMany("learners", []), 0);
});

siBase("remplacement d'une collection : transactionnel, tout ou rien", async () => {
  // Réservé à la restauration d'une sauvegarde. Si l'écriture échoue au milieu,
  // on ne doit pas se retrouver avec la moitié de l'ancien et la moitié du neuf.
  await db.replaceCollection("grades", [{ id: "g1", learnerId: "l1", score: 12 }, { id: "g2", learnerId: "l1", score: 14 }]);
  let all = await db.loadAll();
  assert.equal(all.grades.length, 2);
  await db.replaceCollection("grades", [{ id: "g3", learnerId: "l2", score: 8 }]);
  all = await db.loadAll();
  assert.deepEqual(all.grades.map((g) => g.id), ["g3"], "l'ancien contenu a bien disparu");
});

siBase("singletons : les objets de configuration n'ont pas besoin d'une table chacun", async () => {
  await db.putSingleton("settings", { smicMensuel: 1867.02 });
  const all = await db.loadAll();
  assert.equal(all.settings.smicMensuel, 1867.02);
  await db.putSingleton("settings", { smicMensuel: 1900 });
  assert.equal((await db.loadAll()).settings.smicMensuel, 1900);
});

siBase("entrées invalides refusées avant d'atteindre la base", async () => {
  await assert.rejects(() => db.put("collection_inventee", { id: "x" }), /collection inconnue/);
  await assert.rejects(() => db.put("learners", { nom: "sans id" }), /ligne sans id/);
  await assert.rejects(() => db.del("collection_inventee", "x"), /collection inconnue/);
});

siBase("l'écriture d'une ligne ne dépend PAS du volume — c'est tout l'objet du chantier", async () => {
  // Le magasin fichier réécrivait la base entière : 159 ms à 120 000 notes.
  // Ici le coût doit rester stable quand le volume est multiplié par dix.
  // MÉTHODE DE MESURE. L'écriture coûte ~1,5 ms : à cette échelle, une pause du
  // ramasse-miettes ou une autre suite de tests qui frappe la même base suffit à tripler
  // une mesure isolée. Comparer deux mesures uniques par un ratio produisait un échec
  // intermittent (« 1,40 ms → 5,26 ms ») sans aucune régression derrière — le pire genre
  // de test, celui qu'on finit par ignorer. On prend donc la MÉDIANE de cinq séries, qui
  // absorbe les valeurs aberrantes, et on ajoute une tolérance absolue en plus du ratio.
  // Ce que le test doit prouver reste intact : si le coût était linéaire, dix fois plus de
  // données donneraient dix fois le temps, très au-delà de la marge.
  const serie = async () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) await db.put("grades", { id: "perf", learnerId: "l0", score: i });
    return Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  };
  const mesure = async () => {
    const v = [];
    for (let i = 0; i < 5; i++) v.push(await serie());
    return v.sort((a, b) => a - b)[2];
  };
  await db.replaceCollection("grades", Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, learnerId: "lx", score: 10 })));
  const petit = await mesure();
  await db.putMany("grades", Array.from({ length: 9000 }, (_, i) => ({ id: `q${i}`, learnerId: "ly", score: 10 })));
  const grand = await mesure();
  const plafond = Math.max(petit * 3, petit + 5);
  assert.ok(grand < plafond, `écriture non constante : ${petit.toFixed(2)} ms → ${grand.toFixed(2)} ms (plafond ${plafond.toFixed(2)} ms)`);
});

siBase("RIEN N'EST PERDU : après écriture, la base relue doit égaler la mémoire", async () => {
  // C'est LE test qui protège la classification « muté en place / jamais muté ».
  // Une collection mal classée perdrait ses mises à jour : la mémoire les
  // porterait, la base non — et personne ne s'en apercevrait avant un
  // redémarrage. On le vérifie ici, à chaque exécution.
  process.env.DATABASE_URL = URL_TEST;
  const store = await import("../lib/store.js?rechargement=" + Math.random());
  await store.init();

  const campus = store.addCampus({ name: "Campus Round-trip" });
  const l = store.addLearner({ campusId: campus.id, nom: "Aller", prenom: "Retour" });
  const e = store.addEnrollment({ learnerId: l.id, campusId: campus.id, schoolYear: "2026-2027" });

  // Mutation EN PLACE : c'est exactement ce qu'une comparaison de références
  // laisserait passer.
  store.updateLearner(l.id, { telephone: "0611223344", ine: "INE-RT" });
  store.updateEnrollment(e.id, { statut: "stagiaire" });
  await store.flush();

  const enBase = await db.loadAll();
  const lBase = enBase.learners.find((x) => x.id === l.id);
  assert.equal(lBase.telephone, "0611223344", "mise à jour en place perdue — collection mal classée");
  assert.equal(lBase.ine, "INE-RT");
  assert.equal(enBase.enrollments.find((x) => x.id === e.id).statut, "stagiaire");

  // Suppression
  store.deleteLearner(l.id);
  await store.flush();
  assert.equal((await db.loadAll()).learners.find((x) => x.id === l.id), undefined);

  // Mutation d'un objet IMBRIQUÉ dans une ligne — une tâche dans une ouverture, une étape
  // dans une tâche, une séance dans un comité. C'est l'angle mort qui a coûté neuf
  // fonctions : ni ce round-trip ni le test structurel ne descendaient sous la ligne.
  //
  // UNE PHASE PAR FONCTION, SÉPARÉE PAR UN FLUSH. Ce n'est pas de la coquetterie :
  // touch() mémorise la RÉFÉRENCE de la ligne et pg.put sérialise la ligne ENTIÈRE plus
  // tard, dans la chaîne asynchrone. Un seul marquage emporte donc toutes les mutations
  // imbriquées faites avant son exécution — y compris celles qui n'ont rien marqué. En
  // enchaînant les mutations sans flush, on ne teste plus rien : retirer le touch d'UNE
  // fonction laissait le test passer, couvert par le touch d'une autre. Le flush vide la
  // file, donc chaque phase ne peut être sauvée que par son propre marquage.
  const ouv = store.addOpening({ name: "Ouverture round-trip", targetDate: "2028-09-04" });
  const tache = store.addOpeningTask(ouv.id, { title: "Tâche imbriquée", lot: "gouv" });
  const com = store.addCommittee({ name: "COPIL round-trip", scope: "opening", scopeId: ouv.id });
  const seance = store.addSession(com.id, { date: "2027-05-12" });
  await store.flush();

  const relire = async () => {
    const d = await db.loadAll();
    return {
      t: d.openings.find((x) => x.id === ouv.id).tasks.find((x) => x.id === tache.id),
      s: d.committees.find((x) => x.id === com.id).sessions[0],
    };
  };

  store.updateOpeningTask(ouv.id, tache.id, { owner: "Claire", status: "doing" });
  await store.flush();
  assert.equal((await relire()).t.owner, "Claire", "updateOpeningTask : responsable perdu");

  const etape = store.addTaskStep(ouv.id, tache.id, { text: "Sous-étape" });
  await store.flush();
  assert.equal((await relire()).t.steps?.length, 1, "addTaskStep : sous-étape perdue");

  store.updateTaskStep(ouv.id, tache.id, etape.id, { done: true });
  await store.flush();
  assert.equal((await relire()).t.steps[0].done, true, "updateTaskStep : coche perdue");

  const livrable = store.addTaskOutput(ouv.id, tache.id, { label: "Livrable" });
  await store.flush();
  assert.equal((await relire()).t.outputs?.length, 1, "addTaskOutput : livrable perdu");

  store.updateTaskOutput(ouv.id, tache.id, livrable.id, { status: "validated" });
  await store.flush();
  assert.equal((await relire()).t.outputs[0].status, "validated", "updateTaskOutput : validation perdue");

  store.addTaskComment(ouv.id, tache.id, { by: "Claire", text: "Commentaire" });
  await store.flush();
  assert.equal((await relire()).t.comments?.length, 1, "addTaskComment : commentaire perdu");

  store.updateSession(com.id, seance.id, { minutes: "Compte rendu", status: "held" });
  await store.flush();
  assert.equal((await relire()).s.minutes, "Compte rendu", "updateSession : compte rendu perdu");

  store.linkSessionTask(com.id, seance.id, tache.id);
  await store.flush();
  assert.deepEqual((await relire()).s.taskIds, [tache.id], "linkSessionTask : rattachement perdu");

  // Suppressions imbriquées : elles doivent aussi atteindre la base.
  store.deleteTaskStep(ouv.id, tache.id, etape.id);
  await store.flush();
  assert.equal((await relire()).t.steps.length, 0, "deleteTaskStep : suppression perdue");

  store.deleteTaskOutput(ouv.id, tache.id, livrable.id);
  await store.flush();
  assert.equal((await relire()).t.outputs.length, 0, "deleteTaskOutput : suppression perdue");
});

siBase("COUVERTURE DE touch() : aucune modification sur place ne doit échapper", async () => {
  // Le chemin chaud ne sérialise plus rien : une modification sur place n'est
  // détectée QUE si la fonction appelle touch(). Un oubli perdrait la mise à
  // jour en base sans que rien ne le signale avant un redémarrage.
  // Ce test exerce les mutations en place réelles, puis compare la mémoire à la
  // base ligne à ligne.
  process.env.DATABASE_URL = URL_TEST;
  const store = await import("../lib/store.js?couverture=" + Math.random());
  await store.init();

  const campus = store.addCampus({ name: "Campus Couverture" });
  const l = store.addLearner({ campusId: campus.id, nom: "A", prenom: "B" });
  const e = store.addEnrollment({ learnerId: l.id, campusId: campus.id, schoolYear: "2026-2027" });
  const cur = store.addCurriculum({ name: "Cur", modules: [{ code: "U1", label: "M", coefficient: 1 }] });
  const k = store.addClass({ campusId: campus.id, name: "K1", curriculumId: cur.id });
  const t = store.addTeacher({ campusId: campus.id, name: "Prof" });
  const r = store.addRoom({ campusId: campus.id, name: "Salle" });
  const pa = store.addPartner({ campusId: campus.id, name: "Entreprise" });

  // Mutations EN PLACE — chacune passe par Object.assign ou une affectation de champ.
  store.updateLearner(l.id, { telephone: "0600000000", ine: "INE-COUV" });
  store.updateEnrollment(e.id, { statut: "stagiaire" });
  store.updateClass(k.id, { name: "K1 renommée" });
  store.updateTeacher(t.id, { email: "prof@x.fr" });
  store.updateRoom(r.id, { capacity: 30 });
  store.updatePartner(pa.id, { siret: "73282932000074" });
  store.updateCurriculum(cur.id, { name: "Cur renommé" });
  store.updateCampusPart(campus.id, { city: "Lyon" });
  store.setConsent(l.id, { image: true });

  store.updateCampus(campus.id, { city: "Lyon" });
  // Remplacements PAR INDEX : reprendre une décision existante remplace la ligne
  // à sa place dans le tableau — ni ajout, ni suppression, ni Object.assign.
  store.setPositionnement({ learnerId: l.id, date: "2026-08-01", modalite: "entretien", prerequis: "satisfaits", realisePar: "X" });
  store.setPositionnement({ learnerId: l.id, date: "2026-08-15", modalite: "test", prerequis: "satisfaits", realisePar: "Y" });

  const v = await store.verifierCoherence();
  assert.deepEqual(v.ecarts, [], "modification(s) sur place perdue(s) — touch() manquant : " +
    v.ecarts.map((x) => `${x.collection}/${x.id} (${x.motif})`).join(", "));
  assert.equal(v.ok, true);

  // Et la base porte bien les nouvelles valeurs.
  const enBase = await db.loadAll();
  assert.equal(enBase.learners.find((x) => x.id === l.id).telephone, "0600000000");
  assert.equal(enBase.enrollments.find((x) => x.id === e.id).statut, "stagiaire");
  assert.equal(enBase.classes.find((x) => x.id === k.id).name, "K1 renommée");
  assert.equal(enBase.campuses.find((x) => x.id === campus.id).city, "Lyon");
  const pos = enBase.positionnements.filter((x) => x.learnerId === l.id);
  assert.equal(pos.length, 1, "un seul positionnement par apprenant");
  assert.equal(pos[0].date, "2026-08-15", "le remplacement par index doit être persisté");
});

siBase("STRUCTUREL : toute fonction mutant une ligne sur place appelle touch()", async () => {
  // Le chemin chaud ne sérialise plus rien (c'était 326 à 432 ms par écriture à
  // 30 campus). La contrepartie est une discipline, et une discipline non
  // vérifiée se perd. Ce test relit lib/store.js et échoue si une fonction
  // modifie une ligne sur place sans la marquer — y compris par accès calculé
  // `row[k] = …`, forme qui m'avait échappé au premier passage.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/store.js", import.meta.url), "utf8");
  const lignes = src.split("\n");
  const oublis = [];
  for (let i = 0; i < lignes.length; i++) {
    if (!lignes[i].includes("write(db)")) continue;
    let debut = i;
    while (debut > 0 && !/^export (?:async )?function /.test(lignes[debut])) debut--;
    const nom = (/^export (?:async )?function (\w+)/.exec(lignes[debut]) || [])[1] || "?";
    const corps = lignes.slice(debut, i).join("\n");
    const marques = new Set([...corps.matchAll(/touch\("(\w+)", (\w+)\)/g)].map((m) => m[1] + "|" + m[2]));
    // Forme distincte : remplacement d'une ligne PAR INDEX (db.x[i] = ligne).
    // Même tableau, même longueur, référence de ligne différente : le raccourci
    // de diff() ne la voit pas. C'est ainsi que deux cas m'avaient échappé.
    for (const m of corps.matchAll(/db\.(\w+)\[[^\]]+\]\s*=\s*(\w+)\s*[;,)]/g)) {
      const [, coll, v] = m;
      if (!marques.has(coll + "|" + v)) oublis.push(`${nom} → ${coll} (remplacement par index de ${v})`);
    }
    for (const m of corps.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(?db\.(\w+)\b/g)) {
      const [, v, coll] = m;
      const apres = corps.slice(m.index + m[0].length);
      const enPlace = new RegExp(`Object\\.assign\\(\\s*${v}\\b`).test(apres)
        || new RegExp(`\\b${v}\\.[A-Za-z_]+\\s*=[^=]`).test(apres)
        || new RegExp(`\\b${v}\\[[^\\]]+\\]\\s*=[^=]`).test(apres);
      if (enPlace && !marques.has(coll + "|" + v)) oublis.push(`${nom} → ${coll} (variable ${v})`);
    }
  }
  assert.deepEqual(oublis, [], "modification sur place non marquée :\n  " + oublis.join("\n  "));
});

siBase("planning : le magasin de séances persiste et survit, lui aussi", async () => {
  // Le planning est le magasin le PLUS écrit de l'application. Il souffrait du
  // même mal que le magasin principal : fichier unique réécrit en entier.
  process.env.DATABASE_URL = URL_TEST;
  const ss = await import("../lib/sessionstore.js?planning=" + Math.random());
  await ss.init();
  await db.replaceCollection("sessions", []);
  await ss.init();   // reflet repris sur une base vide

  const s = ss.addSession({ campusId: "cP", classId: "kP", teacherId: "tP", date: "2027-03-01", start: "09:00", end: "12:00", kind: "cours" });
  assert.ok(s.id);
  // Mutation EN PLACE : c'est elle qu'une détection par référence manquerait.
  ss.updateSession(s.id, { status: "done", notes: "séance assurée" });
  await ss.flush();

  const v = await ss.verifierCoherence();
  assert.deepEqual(v.ecarts, [], "modification de séance perdue — touch() manquant");

  const enBase = (await db.loadAll()).sessions || [];
  const enr = enBase.find((x) => x.id === s.id);
  assert.equal(enr.status, "done");
  assert.equal(enr.notes, "séance assurée");
  // Les colonnes générées rendent le planning interrogeable en SQL, ce que le
  // fichier chiffré ne permettait pas.
  const { rows } = await db.getPool().query("select id from sessions where class_id = $1 and date = $2", ["kP", "2027-03-01"]);
  assert.deepEqual(rows.map((r) => r.id), [s.id]);

  ss.deleteSession(s.id);
  await ss.flush();
  assert.equal(((await db.loadAll()).sessions || []).find((x) => x.id === s.id), undefined);
});

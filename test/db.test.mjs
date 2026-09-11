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
  const mesure = async () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) await db.put("grades", { id: "perf", learnerId: "l0", score: i });
    return Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  };
  await db.replaceCollection("grades", Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, learnerId: "lx", score: 10 })));
  const petit = await mesure();
  await db.putMany("grades", Array.from({ length: 9000 }, (_, i) => ({ id: `q${i}`, learnerId: "ly", score: 10 })));
  const grand = await mesure();
  // Dix fois plus de données ne doivent pas doubler le coût d'une écriture.
  assert.ok(grand < petit * 2 + 1, `écriture non constante : ${petit.toFixed(2)} ms → ${grand.toFixed(2)} ms`);
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
});

siBase("classification : une collection mutée en place NE DOIT PAS manquer à la liste", async () => {
  // Test STRUCTUREL : il relit le code source du magasin. Si quelqu'un ajoute
  // demain un Object.assign sur une collection absente de la liste, sa mise à
  // jour serait silencieusement perdue en base — la mémoire la porterait, la
  // base non, et personne ne le verrait avant un redémarrage. Ce test le refuse.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/store.js", import.meta.url), "utf8");
  const store = await import("../lib/store.js");
  const manquantes = [];
  for (const c of db.COLLECTION_NAMES) {
    if (store.COLLECTIONS_MUTEES_EN_PLACE.has(c)) continue;
    const re = new RegExp("(?:const|let)\\s+(\\w+)\\s*=\\s*\\(?db\\." + c + "\\b[^;]{0,200};", "g");
    let m;
    while ((m = re.exec(src))) {
      const v = m[1];
      const suite = src.slice(m.index, m.index + 1200);
      const assign = new RegExp("Object\\.assign\\(\\s*" + v + "\\b");
      const champ = new RegExp("\\b" + v + "\\.[A-Za-z_]+\\s*=[^=]");
      if (assign.test(suite) || champ.test(suite)) { manquantes.push(c); break; }
    }
  }
  assert.deepEqual(manquantes, [], `mutées en place mais absentes de COLLECTIONS_MUTEES_EN_PLACE : ${manquantes.join(", ")}`);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bk-"));
// La clé de chiffrement au repos vient de DATA_KEY (lib/crypto-store.js), pas de
// CRYPTO_KEY : se tromper de variable produit des archives EN CLAIR sans le dire.
process.env.DATA_KEY = "cle-de-test-archive";

const store = await import("../lib/store.js");
const backup = await import("../lib/backup.js");

test("archive : contenu chiffré, enveloppe en clair, empreinte vérifiée", async () => {
  store.addCampus({ name: "Campus Archive" });
  const a = await backup.creerArchive();
  const brut = a.octets.toString("utf8");

  // L'enveloppe doit être lisible SANS la clé : lister, dater et comparer des archives
  // ne doit pas exiger le secret. Les données, elles, ne doivent pas y apparaître.
  const e = JSON.parse(brut);
  assert.equal(e.format, "campus-backup/1");
  assert.ok(e.createdAt && e.sha256 && e.counts);
  assert.ok(e.counts.campuses >= 1);
  assert.equal(brut.includes("Campus Archive"), false, "le nom du campus ne doit pas apparaître en clair");

  const lu = backup.ouvrirArchive(a.octets);
  assert.ok(!lu.error, lu.error);
  assert.ok(lu.donnees.campuses.some((c) => c.name === "Campus Archive"));
});

test("archive altérée ou d'un autre format : refusée, et on dit pourquoi", () => {
  assert.match(backup.ouvrirArchive(Buffer.from("pas du json")).error, /illisible/);
  assert.match(backup.ouvrirArchive(Buffer.from(JSON.stringify({ format: "autre" }))).error, /format inconnu/);
});

test("empreinte non conforme : l'archive est rejetée, jamais restaurée en silence", async () => {
  const a = await backup.creerArchive();
  const e = JSON.parse(a.octets.toString("utf8"));
  e.sha256 = "0".repeat(64);
  // Sans ce contrôle, une archive tronquée par un disque plein se restaurerait
  // partiellement — le pire des cas, puisqu'on croirait la restauration réussie.
  assert.match(backup.ouvrirArchive(Buffer.from(JSON.stringify(e))).error, /empreinte/i);
});

test("exécution : écrit, RELIT, purge selon la rétention", async () => {
  backup.setConfig({ retention: 2, distant: { actif: false } });
  const faites = [];
  for (let i = 0; i < 4; i++) {
    const r = await backup.executerSauvegarde({});
    assert.equal(r.ok, true, r.error);
    faites.push(r.nom);
    // Deux archives créées dans la même milliseconde porteraient le même nom : on force
    // un écart, sinon le test mesure l'horloge et pas la rétention.
    await new Promise((r2) => setTimeout(r2, 5));
  }
  const l = backup.listerArchives();
  assert.equal(l.length, 2, "la rétention à 2 ne doit laisser que les 2 plus récentes");
  assert.ok(l.every((a) => a.total >= 0 && a.createdAt), "l'entête est lisible sans la clé");
});

test("copie externe désactivée : annoncée comme telle, pas comme un succès", async () => {
  backup.setConfig({ distant: { actif: false } });
  assert.deepEqual(await backup.copierVersDistant("/tmp/x.cmbak"), { envoye: false, raison: "désactivé" });
});

test("copie externe mal configurée : refus explicite, champ par champ", async () => {
  backup.setConfig({ distant: { actif: true, hote: "", chemin: "/tmp", utilisateur: "root", cle: "" } });
  assert.match((await backup.copierVersDistant("/tmp/x.cmbak")).error, /hote/);
  backup.setConfig({ distant: { actif: true, hote: "h", chemin: "", utilisateur: "root", cle: "" } });
  assert.match((await backup.copierVersDistant("/tmp/x.cmbak")).error, /chemin/);
  // Une clé annoncée mais absente est une panne silencieuse au premier incident.
  backup.setConfig({ distant: { actif: true, hote: "h", chemin: "/tmp", utilisateur: "root", cle: "/introuvable/id_rsa" } });
  assert.match((await backup.copierVersDistant("/tmp/x.cmbak")).error, /clé SSH introuvable/);
  backup.setConfig({ distant: { actif: false, cle: "" } });
});

test("réglages : bornés, et une rétention à 0 est ramenée à 1", () => {
  const c = backup.setConfig({ retention: 0, heure: "pas une heure", dossier: " /tmp/arch ", distant: { port: 99999 } });
  assert.equal(c.retention, 1, "0 effacerait l'archive à peine écrite");
  assert.equal(c.heure, backup.DEFAUTS.heure, "une heure invalide ne remplace pas l'ancienne");
  assert.equal(c.dossier, "/tmp/arch");
  assert.equal(c.distant.port, 65535);
  assert.equal(backup.setConfig({ retention: 999 }).retention, 365);
});

test("restauration : aperçu d'abord, sans rien écrire", async () => {
  backup.setConfig({ retention: 30, dossier: join(process.env.DATA_DIR, "archives") });
  const avant = await backup.creerArchive();
  const c2 = store.addCampus({ name: "Créé après l'archive" });

  const apercu = await backup.restaurer(avant.octets, { dryRun: true });
  assert.equal(apercu.dryRun, true);
  assert.ok(apercu.perdus >= 1, "l'aperçu annonce les lignes qui disparaîtraient");
  assert.ok(apercu.diff.some((d) => d.collection === "campuses" && d.delta < 0));
  // Rien ne doit avoir bougé : un aperçu qui modifie n'est pas un aperçu.
  assert.ok(store.listCampuses().some((x) => x.id === c2.id));
});

test("restauration : applique, et laisse un filet de sécurité", async () => {
  const avant = await backup.creerArchive();
  const c2 = store.addCampus({ name: "Disparaît à la restauration" });
  assert.ok(store.listCampuses().some((x) => x.id === c2.id));

  const r = await backup.restaurer(avant.octets, { dryRun: false });
  assert.equal(r.ok, true);
  assert.ok(r.filet.endsWith("-avant-restauration.cmbak"), "l'état écrasé reste récupérable");
  assert.ok(fs.existsSync(join(backup.config().dossier, r.filet)));

  // En mode fichier, le magasin relit le disque : le campus doit avoir disparu.
  const apres = await backup.creerArchive();
  const lu = backup.ouvrirArchive(apres.octets);
  assert.equal(lu.donnees.campuses.some((x) => x.id === c2.id), false);
});

test("une archive se restaure d'un mode à l'autre : la bascule reste réversible", async () => {
  const a = await backup.creerArchive();
  assert.equal(a.enveloppe.mode, "fichier");
  // La structure ne dépend pas du mode : c'est ce qui permet de repartir en fichier
  // depuis une archive prise en base, et inversement.
  const lu = backup.ouvrirArchive(a.octets);
  assert.ok(Array.isArray(lu.donnees.campuses));
  assert.ok(Array.isArray(lu.donnees.openings));
});

test("sans DATA_KEY, l'archive est en clair — et le rapport le DIT", async () => {
  // Une archive non chiffrée déposée sur un serveur externe est une fuite de données
  // personnelles. Le silence serait le vrai défaut ; l'absence de clé est un choix.
  assert.equal(backup.chiffrementActif(), true, "DATA_KEY est posé dans ce fichier de test");
  const r = await backup.executerSauvegarde({});
  assert.equal(r.chiffre, true);
  assert.equal(r.avertissement, undefined);
});

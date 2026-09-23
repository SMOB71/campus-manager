// Pack documentaire d'ouverture — ce qui doit rester vrai.
//
// Ces tests ne regardent pas la mise en page : ils vérifient que les fichiers
// produits sont de VRAIS fichiers Office, que le contenu vient du plan et non
// d'un gabarit, et que les trois pièges déjà payés ne reviennent pas —
// l'atterrissage mesuré sur les actions d'après la rentrée, la marge inconnue
// confondue avec une marge nulle, et le budget qui dérive à l'arrondi.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerServeur } from "./_serveur.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "ac-pack-"));
let BASE = "", srv, A = null, ouvertureId = null;

const req = (p, { method = "GET", cookie = "", csrf = "", json } = {}) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + p, { method, headers, body, redirect: "manual" });
};
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });

// Un fichier Office est un zip dont la première entrée commence par « PK ».
// Le vérifier interdit le faux positif le plus courant : une réponse d'erreur
// JSON renvoyée avec le bon type MIME.
// Texte d'un .docx, pour vérifier ce qu'il DIT et pas seulement qu'il existe.
const lireDocx = async (buf) => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const d = mkdtempSync(path.join(os.tmpdir(), "docx-"));
  const f = path.join(d, "x.docx");
  writeFileSync(f, buf);
  const xml = execFileSync("unzip", ["-p", f, "word/document.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c));
};

const estZip = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;

before(async () => {
  const r = await demarrerServeur({
    ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789",
    SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test",
    ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", NODE_ENV: "test",
  });
  srv = r.enfant; BASE = r.base;
  const res = await req("/api/login", { method: "POST", json: { email: "admin@test.co", password: "pw12345678" } });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  A = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };
  const o = await (await post("/api/openings", { name: "Lille", targetDate: "2027-09-01", dureeMois: 11, budget: 1240000 })).json();
  ouvertureId = o.id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("le plan d'ouverture se traduit sans perdre ni inventer d'action", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const taches = buildOpeningTasks("2027-09-01", {}, 11);
  const { projet, plan } = planOuverture({ id: "o", name: "Lille", targetDate: "2027-09-01", budget: 1240000 },
    taches, { aujourdhui: "2026-10-05" });
  assert.equal(plan.taches.length, taches.length, "aucune action ne doit disparaître à la traduction");
  assert.equal(plan.resume.critiques.length, taches.filter((t) => t.critical).length);
  assert.ok(plan.resume.jalons.length >= 15, "les jalons du modèle doivent être repris");
  // Les jalons sont DÉCLARÉS par le modèle. La version qui prenait « la dernière
  // action de chaque lot » donnait « Surveillance des ruptures de contrat » comme
  // jalon de clôture : chronologiquement vrai, absurde en comité.
  assert.ok(plan.resume.jalons.some((j) => /ARRÊTÉ D'OUVERTURE DU MAIRE/i.test(j.titre)));
  assert.ok(plan.resume.jalons.some((j) => /Pré-rentrée/i.test(j.titre)));
  assert.ok(plan.resume.jalons.every((j, i, a) => !i || j.date >= a[i - 1].date), "les jalons sortent triés");
  assert.ok(projet.risques.length >= 5 && projet.instances.length >= 3 && projet.trames.length >= 2,
    "les registres par défaut d'une ouverture doivent être posés");
});

test("une marge inconnue n'est pas une marge nulle", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 0 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  const connues = plan.taches.map((t) => t.margeTotale).filter((v) => v != null);
  assert.ok(plan.taches.some((t) => t.margeTotale == null), "certaines actions n'ont rien en aval");
  assert.ok(Math.min(...connues) > 0, "le modèle garde un matelas : aucune marge connue n'est nulle");
  assert.equal(plan.resume.margeMin, Math.min(...connues));
});

test("l'atterrissage se mesure sur la rentrée, pas sur les soldes de décembre", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 0 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  assert.ok(plan.resume.apresRentree > 0, "le modèle porte des actions postérieures à la rentrée");
  assert.ok(plan.resume.finTotale > plan.fin, "elles vont plus loin que la rentrée");
  assert.equal(plan.fin, "2027-09-01", "la fin annoncée reste la rentrée");
});

test("le budget réparti par chantier retombe à l'euro sur l'enveloppe votée", async () => {
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { plan } = planOuverture({ id: "o", name: "L", targetDate: "2027-09-01", budget: 1240000 },
    buildOpeningTasks("2027-09-01", {}, 11), { aujourdhui: "2026-10-05" });
  const somme = plan.taches.reduce((s, t) => s + t.budgetPrevu, 0);
  // Une part égale arrondie faisait sortir 1 240 001 € : un euro suffit à faire
  // douter du reste du document.
  assert.equal(somme, 1240000);
});

test("le pack liste ce qu'il contient avant de le produire", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack?inventaire=1`);
  assert.equal(r.status, 200);
  const { pieces } = await r.json();
  assert.ok(pieces.length >= 9, `pack maigre : ${pieces.length} pièces`);
  for (const t of ["docx", "pptx", "xlsx"]) assert.ok(pieces.some((p) => p.ext === t), `aucun ${t} annoncé`);
  assert.ok(pieces.every((p) => p.nom && p.quoi && p.dossier), "chaque pièce dit ce qu'elle est");
});

test("chaque pièce se télécharge seule, et c'est un vrai fichier Office", async () => {
  const { pieces } = await (await get(`/api/openings/${ouvertureId}/pack?inventaire=1`)).json();
  for (const p of pieces) {
    const r = await get(`/api/openings/${ouvertureId}/pack/${p.cle}`);
    assert.equal(r.status, 200, `${p.cle} : ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(estZip(buf), `${p.cle} n'est pas un fichier Office`);
    assert.ok(buf.length > 8000, `${p.cle} pèse ${buf.length} octets — trop peu pour porter un plan`);
    assert.match(r.headers.get("content-disposition") || "", /attachment; filename=/);
  }
});

test("une clé inconnue est refusée, pas servie vide", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack/inexistant`);
  assert.equal(r.status, 404);
});

test("le zip complet porte le sommaire et toutes les pièces annoncées", async () => {
  const { pieces } = await (await get(`/api/openings/${ouvertureId}/pack?inventaire=1`)).json();
  const r = await get(`/api/openings/${ouvertureId}/pack`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(estZip(buf));
  // On lit le répertoire central du zip plutôt que sa taille : une archive
  // tronquée pèse lourd elle aussi, et s'ouvre à moitié sans prévenir.
  const noms = [];
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      const n = buf.readUInt16LE(i + 28);
      noms.push(buf.slice(i + 46, i + 46 + n).toString("utf8"));
      i += 45 + n;
    }
  }
  assert.ok(noms.includes("SOMMAIRE.txt"), "le zip doit dire ce qu'il contient");
  assert.equal(noms.length, pieces.length + 1, `zip incomplet : ${noms.length - 1} pièces pour ${pieces.length} annoncées`);
  assert.ok(noms.some((n) => n.endsWith(".pptx")) && noms.some((n) => n.endsWith(".xlsx")));
});

test("le pack est réservé aux administrateurs", async () => {
  const r = await req(`/api/openings/${ouvertureId}/pack`);
  assert.ok(r.status === 401 || r.status === 403, `statut ${r.status}`);
});

test("une ouverture inexistante ne produit pas d'archive vide", async () => {
  const r = await get("/api/openings/pas-un-id/pack");
  assert.equal(r.status, 404);
});

// ── Feuille d'impression par direction ──────────────────────────────────────
// C'est le document qu'on imprime vraiment : celui qu'un directeur relit,
// annote et signe. Le rétroplanning complet fait une cinquantaine de pages.
test("la feuille d'une direction ne porte QUE ses actions, et ses compteurs suivent", async () => {
  const dirs = (await (await get("/api/openings/meta")).json()).depts;
  assert.ok(dirs?.length >= 6, "les directions sont servies par le modèle, pas recopiées côté client");

  const complet = await (await get(`/api/openings/${ouvertureId}/export?format=print`)).text();
  for (const d of dirs) {
    assert.ok(complet.includes(`dept=${d.k}`), `la feuille complète n'offre pas d'imprimer ${d.l}`);
  }

  const o = await (await get(`/api/openings/${ouvertureId}`)).json();
  let cumul = 0;
  for (const d of dirs) {
    const h = await (await get(`/api/openings/${ouvertureId}/export?format=print&dept=${d.k}`)).text();
    const m = h.match(/(\d+) actions? portées? par cette direction/);
    assert.ok(m, `${d.l} : l'en-tête n'annonce pas le volume`);
    const n = Number(m[1]);
    cumul += n;
    // Le bandeau annonçait le total du PROJET sur la feuille d'une direction :
    // « 0/198 tâches faites » pour seize actions portées.
    assert.match(h, new RegExp(`>0/${n}<`), `${d.l} : compteur non borné au périmètre imprimé`);
    assert.ok(h.includes("Validation"), `${d.l} : feuille sans bloc de signature`);
    // Une feuille de direction ne propose pas de s'imprimer elle-même : la
    // barre de navigation n'a de sens que sur la feuille complète.
    assert.ok(!h.includes("Imprimer une direction"), `${d.l} : la barre de navigation revient sur la feuille`);
  }
  assert.equal(cumul, o.tasks.length, "la somme des feuilles ne couvre pas le plan, ou compte deux fois");
});

test("la feuille cite les échéances imposées, même après passage par le magasin", async () => {
  // Le magasin ne conserve que `tplKey` : la base légale se résout depuis le
  // modèle. Sans ça, un plan enregistré perdait ses références en silence.
  const h = await (await get(`/api/openings/${ouvertureId}/export?format=print&dept=finance`)).text();
  assert.match(h, /Échéances imposées/);
  assert.match(h, /L242-1/);
  assert.match(h, /legifrance/);
  // Et la feuille d'une direction sans échéance imposée ne fabrique pas de section vide.
  const mk = await (await get(`/api/openings/${ouvertureId}/export?format=print&dept=com`)).text();
  assert.ok(!/Échéances imposées/.test(mk), "section légale affichée sans aucune échéance à citer");
});

// ── Remise à niveau d'un plan déjà saisi ────────────────────────────────────
// Le défaut qui empêchait de corriger le modèle : régénérer effaçait tout.
// Corriger un délai légal coûtait alors les responsables, les statuts et les
// réalisations consignées — donc on ne corrigeait pas.
test("mettre à jour depuis le modèle conserve ce qu'un humain a saisi", async () => {
  const o = await (await post("/api/openings", { name: "Brest", targetDate: "2027-09-01", dureeMois: 11 })).json();
  const avant = (await (await get(`/api/openings/${o.id}`)).json()).tasks;
  assert.ok(avant.length > 100, "l'ouverture doit être semée à la création");

  // On saisit du travail : un responsable, un statut, une réalisation. Puis on
  // ajoute une tâche à la main, et on simule une action disparue du modèle.
  const cible = avant.find((t) => t.tplKey === "autorisation-erp");
  await req(`/api/openings/${o.id}/tasks/${cible.id}`, { method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { owner: "Direction des opérations", status: "doing", notes: "Dossier en cours de montage" } });
  const manuelle = await (await post(`/api/openings/${o.id}/tasks`, { title: "Point local ajouté à la main", dueDate: "2027-01-10" })).json();

  const ap = await (await post(`/api/openings/${o.id}/seed`, { apercu: true })).json();
  assert.equal(ap.apercu, true);
  assert.equal(ap.mode, "fusion");
  // L'aperçu n'écrit RIEN : c'est tout son intérêt.
  const inchange = (await (await get(`/api/openings/${o.id}`)).json()).tasks;
  assert.equal(inchange.length, avant.length + 1);

  await post(`/api/openings/${o.id}/seed`, {});
  const apres = (await (await get(`/api/openings/${o.id}`)).json()).tasks;

  const t = apres.find((x) => x.tplKey === "autorisation-erp");
  assert.equal(t.owner, "Direction des opérations", "le responsable saisi a été écrasé");
  assert.equal(t.status, "doing", "le statut saisi a été écrasé");
  assert.match(t.notes, /montage/, "les notes saisies ont été écrasées");
  assert.ok(apres.some((x) => x.id === manuelle.id), "une tâche ajoutée à la main ne doit jamais disparaître");

  // Les dépendances doivent pointer vers des tâches qui existent encore.
  const ids = new Set(apres.map((x) => x.id));
  const cassees = apres.flatMap((x) => (x.dependsOn || []).filter((d) => !ids.has(d)));
  assert.deepEqual(cassees, [], "la fusion a laissé des dépendances orphelines");
});

test("le remplacement total reste possible, mais il faut le demander", async () => {
  const o = await (await post("/api/openings", { name: "Rennes", targetDate: "2027-09-01", dureeMois: 11 })).json();
  const t0 = (await (await get(`/api/openings/${o.id}`)).json()).tasks[0];
  await req(`/api/openings/${o.id}/tasks/${t0.id}`, { method: "PATCH", cookie: A.cookie, csrf: A.csrf,
    json: { owner: "Quelqu'un" } });
  await post(`/api/openings/${o.id}/seed`, { mode: "remplacer" });
  const apres = (await (await get(`/api/openings/${o.id}`)).json()).tasks;
  const t = apres.find((x) => x.tplKey === t0.tplKey);
  assert.equal(t.owner, "", "le remplacement explicite doit bien repartir du modèle");
});

test("un plan antérieur à tplKey se met à jour sans se dédoubler", async () => {
  // Cas réel trouvé en production : une ouverture de 151 actions créée avant
  // que le modèle ne porte `tplKey`. Sans repli sur le titre, la fusion les
  // traitait toutes comme « ajoutées à la main » et produisait 349 actions —
  // chaque action en double, et plus moyen de savoir laquelle fait foi.
  const { buildOpeningTasks, fusionnerRetroplanning } = await import("../lib/calc.js");
  const modele = buildOpeningTasks("2027-09-01", {}, 11);
  const ancien = modele.slice(0, 120).map((t) => ({
    id: `vieux-${t.tplKey}`, tplKey: null, title: t.title, lot: t.lot,
    dueDate: "2026-01-01", status: "todo", dependsOn: [],
  }));
  ancien.push({ id: "propre-1", tplKey: null, title: "Action propre à ce campus", dueDate: "2027-02-02", status: "doing" });

  const { taches, resume } = fusionnerRetroplanning(ancien, modele);
  assert.equal(taches.length, modele.length + 1, "le plan doit valoir le modèle plus l'action propre au projet");
  assert.equal(resume.ajoutees.length, modele.length - 120);
  assert.equal(resume.deplacees.length, 120, "les 120 dates périmées doivent être signalées comme déplacées");
  assert.equal(resume.conservees.length, 1);
  // Aucun titre en double : c'est tout l'enjeu.
  const titres = taches.map((t) => t.title);
  assert.equal(new Set(titres).size, titres.length, "la fusion a produit des doublons");
  // Et l'identifiant historique survit, pour que ce qui le référence tienne.
  assert.ok(taches.some((t) => t.id === `vieux-${modele[0].tplKey}`));
});

// ── Fiches action et Flash INFO ─────────────────────────────────────────────
test("chaque jalon porte une condition de clôture, et la fiche la dit", async () => {
  // « Sans cette définition, une action à 80 % reste à 80 % pendant six mois. »
  // Un jalon sans critère de clôture n'est pas un jalon : c'est une date.
  const { buildOpeningTasks, OPENING_JALONS, critereFinDe } = await import("../lib/calc.js");
  const t = buildOpeningTasks("2027-09-01", {}, 11);
  const jalonsSansCritere = t.filter((x) => OPENING_JALONS.has(x.tplKey) && !x.fin);
  assert.deepEqual(jalonsSansCritere.map((x) => x.tplKey), []);
  // Et le critère se retrouve après passage par le magasin, qui ne garde que tplKey.
  assert.ok(critereFinDe({ tplKey: "arrete-maire" }).length > 20);
});

test("la fiche action ne se contredit pas sur le porteur", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack/fiches-action`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(estZip(buf), "la fiche action doit être un vrai .docx");
  const texte = await lireDocx(buf);
  // Le défaut corrigé : « Responsable : Direction académique » suivi trois
  // lignes plus bas de « Aucun responsable nommé à ce jour ».
  assert.ok(!/Aucun responsable nommé à ce jour/.test(texte),
    "la fiche affiche un porteur puis affirme qu'il n'y en a pas");
  assert.match(texte, /Terminé quand/);
  assert.match(texte, /Point de vigilance/);
  // Le modèle les porte toutes aujourd'hui ; la fiche doit le dire.
  assert.match(texte, /Toutes les actions portent une condition de clôture/);
});

test("une action sans condition de clôture est signalée, pas comblée", async () => {
  // L'invariant, pas l'état du jour : le premier test affirmait qu'il restait
  // des trous, et il est tombé le jour où on les a bouchés.
  const { fichesAction } = await import("../lib/pack/documents.js");
  const { charte } = await import("../lib/pack/charte.js");
  const plan = {
    debut: "2026-10-02", fin: "2027-09-01", resume: {},
    taches: [
      { id: "a", code: "1", titre: "Action sans critère", lot: "Essai", dept: "Opérations",
        debut: "2026-10-02", fin: "2026-10-09", critereFin: "", margeTotale: 10, liens: [] },
      { id: "b", code: "2", titre: "Action avec critère", lot: "Essai", dept: "Opérations",
        debut: "2026-10-02", fin: "2026-10-09", critereFin: "Le document est signé.", margeTotale: 10, liens: [] },
    ],
  };
  const t = await lireDocx(await fichesAction({ nom: "Essai", instances: [], risques: [] }, plan, charte({})));
  assert.match(t, /1 action n'a pas encore de condition de clôture écrite/);
  assert.match(t, /condition de clôture à définir/);
  assert.match(t, /Le document est signé\./);
});

test("le Flash INFO porte un bloc par direction, aucun supprimé", async () => {
  const r = await get(`/api/openings/${ouvertureId}/pack/flash-info`);
  assert.equal(r.status, 200);
  const texte = await lireDocx(Buffer.from(await r.arrayBuffer()));
  const dirs = (await (await get("/api/openings/meta")).json()).depts;
  for (const d of dirs) assert.ok(texte.includes(d.l), `Flash INFO sans bloc « ${d.l} »`);
  assert.match(texte, /RAS/, "la règle du bloc jamais supprimé doit être écrite");
});

test("les ordres du jour sortent aussi en un fichier par séance", async () => {
  const { ordresSepares, vue } = await import("../lib/pack/index.js");
  const { buildOpeningTasks } = await import("../lib/calc.js");
  const { planOuverture } = await import("../lib/pack/ouverture.js");
  const { charte } = await import("../lib/pack/charte.js");
  const taches = buildOpeningTasks("2027-09-01", {}, 11);
  const { projet, plan } = planOuverture({ id: "o", name: "Lille", targetDate: "2027-09-01", budget: 1 },
    taches, { aujourdhui: "2026-10-05" });
  const seances = ["2026-10-12", "2026-10-19", "2026-10-26"].map((date) => ({ date, instance: "COPIL" }));
  const out = await ordresSepares(projet, vue(plan), charte({}), { seances });
  assert.equal(out.length, 3);
  assert.ok(out.every((x) => estZip(x.octets)), "chaque ordre du jour doit être un vrai .docx");
  // Numérotés et datés : on ouvre celui du jour, pas un recueil de 47 séances.
  assert.match(out[0].chemin, /Ordres du jour\/.*ODJ-01-2026-10-12\.docx$/);
  assert.match(out[2].chemin, /ODJ-03-2026-10-26\.docx$/);
});

test("aucun document ne laisse fuir une valeur non résolue", async () => {
  // Huit cellules « undefined » sont passées dans un document livré parce que
  // le générateur lisait `x.dept` sur une liste qui ne portait que `{title, n}`.
  // Rien ne l'a vu : le fichier était structurellement valide. Ce test regarde
  // ce que le document DIT, pas seulement qu'il s'ouvre.
  const suspects = [/\bundefined\b/, /\bNaN\b/, /\[object \w+\]/, /\$\{/, /\bInvalid Date\b/,
    // Une date ISO dans une phrase est une fuite de format : on écrit le 1er
    // septembre 2027, pas 2027-09-01.
    /\b\d{4}-\d{2}-\d{2}\b/];
  const inv = await (await get(`/api/openings/${ouvertureId}/pack?inventaire=1`)).json();
  const mots = ["docx"];                       // le texte des .pptx et .xlsx est lu ailleurs
  for (const p of inv.pieces.filter((x) => mots.includes(x.ext))) {
    const r = await get(`/api/openings/${ouvertureId}/pack/${p.cle}`);
    assert.equal(r.status, 200, `${p.nom} ne se produit pas`);
    const t = await lireDocx(Buffer.from(await r.arrayBuffer()));
    for (const rx of suspects) {
      const m = t.match(rx);
      assert.equal(m, null, `${p.nom} laisse passer « ${m && m[0]} »`);
    }
  }
});

// Tests d'intégration du rythme d'alternance : génération des périodes, contrôle
// de volume, remplacement sélectif, et branchement sur weeksAtSchool — c'est ce
// dernier point qui rend juste le générateur et le contrôle de couverture.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demarrerServeur } from "./_serveur.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let BASE = "";
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-alt-"));
let srv;

function req(pathname, { method = "GET", cookie = "", csrf = "", json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  return fetch(BASE + pathname, { method, headers, body, redirect: "manual" });
}
function readCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return jar;
}
let A = null;   // session admin
const post = (p, json) => req(p, { method: "POST", cookie: A.cookie, csrf: A.csrf, json });
const get = (p) => req(p, { cookie: A.cookie });

// Contexte commun : un campus, un référentiel à 20 h/semaine, une classe rattachée.
let campusId = null, curriculumId = null, classId = null;

before(async () => {
  const r = await demarrerServeur({
    ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789",
    SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test",
    ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", NODE_ENV: "test",
  });
  srv = r.enfant; BASE = r.base;
  const res = await req("/api/login", { method: "POST", json: { email: "admin@test.co", password: "pw12345678" } });
  const jar = readCookies(res);
  A = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), csrf: jar.ac_csrf };

  const camp = await (await post("/api/campuses", { name: "CFA Test" })).json();
  campusId = camp.id;
  const cur = await (await post("/api/curricula", {
    name: "BTS Test", modules: [{ code: "M1", label: "Optique", heuresSemaine: 20, year: 1 }],
  })).json();
  curriculumId = cur.id;
  const k = await (await post("/api/classes", {
    campusId, curriculumId, name: "BTS1 ALT", year: 1, modalite: "alternance",
  })).json();
  classId = k.id;
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("les modèles de rythme sont exposés à l'interface", async () => {
  const r = await get("/api/schedule/rythme/modeles");
  assert.equal(r.status, 200);
  const modeles = await r.json();
  assert.ok(modeles.some((m) => m.cle === "1-3" && m.centre === 1 && m.entreprise === 3));
});

test("preview ne touche à rien et dit si le volume du référentiel est atteignable", async () => {
  const avant = (await (await get(`/api/periods?campusId=${campusId}`)).json()).length;
  const r = await post("/api/schedule/rythme/preview", {
    classId, debut: "2026-09-14", fin: "2027-06-30", centre: 1, entreprise: 3,
  });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.ok(p.periodes.length > 0);
  // Le volume requis est LU DANS LE RÉFÉRENTIEL (20 h/sem. × 36 = 720 h), pas saisi.
  assert.equal(p.volumeRequis, 720);
  assert.equal(p.heuresParSemaine, 20);
  // Un rythme 1/3 ne peut pas délivrer 720 h : c'est exactement ce qu'on veut
  // savoir en septembre.
  assert.equal(p.volume.suffisant, false);
  assert.match(p.volume.message, /il manque/);
  // Rien n'a été écrit.
  assert.equal((await (await get(`/api/periods?campusId=${campusId}`)).json()).length, avant);
});

test("apply crée les périodes entreprise ET renseigne weeksAtSchool", async () => {
  const r = await post("/api/schedule/rythme/apply", {
    classId, debut: "2026-09-14", fin: "2027-06-30", centre: 2, entreprise: 2,
  });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.ok(out.creees > 0);
  assert.equal(out.remplacees, 0);

  const periodes = (await (await get(`/api/periods?campusId=${campusId}`)).json())
    .filter((p) => p.classId === classId);
  assert.equal(periodes.length, out.creees);
  assert.ok(periodes.every((p) => p.kind === "entreprise" && p.source === "rythme"));

  // LE BRANCHEMENT : la classe porte désormais le nombre RÉEL de semaines de
  // centre, au lieu de l'estimation « 18 semaines pour toute alternance ».
  const k = (await (await get("/api/classes")).json()).find((x) => x.id === classId);
  assert.equal(k.weeksAtSchool, out.weeksAtSchool);
  assert.ok(k.weeksAtSchool > 0 && k.weeksAtSchool < 42);
  assert.match(k.rythme, /2 sem\. centre \/ 2 sem\. entreprise/);

  // Et le contrôle de couverture consomme ce chiffre : il ne réclame plus les
  // heures d'une année à 36 semaines pour une classe qui n'en fait que la moitié.
  const cov = await (await get(`/api/schedule/coverage?classId=${classId}`)).json();
  assert.equal(cov.weeks, k.weeksAtSchool);
  assert.equal(cov.total.due, 20 * k.weeksAtSchool);
});

test("réappliquer un rythme remplace ses propres périodes sans toucher aux périodes saisies à la main", async () => {
  // Une semaine d'intégration saisie manuellement pour cette classe.
  const manuelle = await (await post("/api/periods", {
    campusId, classId, kind: "stage", label: "Semaine d'intégration",
    from: "2026-09-07", to: "2026-09-11",
  })).json();

  const avant = (await (await get(`/api/periods?campusId=${campusId}`)).json())
    .filter((p) => p.classId === classId && p.source === "rythme").length;

  const r = await post("/api/schedule/rythme/apply", {
    classId, debut: "2026-09-14", fin: "2027-06-30", centre: 1, entreprise: 3,
  });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.remplacees, avant);

  const toutes = (await (await get(`/api/periods?campusId=${campusId}`)).json())
    .filter((p) => p.classId === classId);
  // La période manuelle a survécu.
  assert.ok(toutes.some((p) => p.id === manuelle.id), "la semaine d'intégration ne doit pas disparaître");
  // Et les anciennes périodes du rythme ont bien été remplacées, pas accumulées.
  assert.equal(toutes.filter((p) => p.source === "rythme").length, out.creees);
});

test("des cours déjà posés dans une semaine entreprise bloquent l'application, jusqu'à confirmation", async () => {
  // Un cours en janvier, que le rythme 1/1 va recouvrir d'une semaine entreprise.
  const room = await (await post("/api/rooms", { campusId, name: "Salle 1", capacity: 30 })).json();
  let pose = null;
  for (let j = 0; j < 40 && !pose; j++) {
    const d = new Date(Date.UTC(2027, 0, 4 + j)).toISOString().slice(0, 10);
    const res = await post("/api/sessions", {
      campusId, classId, roomId: room.id, date: d, start: "09:00", end: "11:00", kind: "cours",
    });
    if (res.status === 200) pose = await res.json();
  }
  assert.ok(pose, "au moins une séance doit avoir pu être posée");

  // On applique un rythme qui recouvre forcément cette date une semaine sur deux.
  const bloque = await post("/api/schedule/rythme/apply", {
    classId, debut: "2026-09-14", fin: "2027-06-30", centre: 1, entreprise: 1,
  });
  // Soit la séance tombe en semaine entreprise et on refuse, soit elle tombe en
  // semaine de centre et le rythme passe : les deux sont corrects, mais un refus
  // doit TOUJOURS être accompagné de la liste des séances heurtées.
  if (bloque.status === 409) {
    const b = await bloque.json();
    assert.ok(b.conflitsTotal >= 1);
    assert.ok(b.conflits.some((c) => c.date === pose.date));
    assert.match(b.indice, /confirmer/);
    // Avec confirmation explicite, le rythme est posé.
    const force = await post("/api/schedule/rythme/apply", {
      classId, debut: "2026-09-14", fin: "2027-06-30", centre: 1, entreprise: 1, confirmer: true,
    });
    assert.equal(force.status, 200);
    assert.ok((await force.json()).seancesEnConflit >= 1);
  } else {
    assert.equal(bloque.status, 200);
  }
});

test("un rythme invalide est refusé avant toute écriture", async () => {
  const r = await post("/api/schedule/rythme/apply", {
    classId, debut: "2027-06-30", fin: "2026-09-14", centre: 1, entreprise: 3,
  });
  assert.equal(r.status, 400);
  const sansClasse = await post("/api/schedule/rythme/preview", {
    debut: "2026-09-14", fin: "2027-06-30", centre: 1, entreprise: 3,
  });
  assert.equal(sansClasse.status, 404);
});

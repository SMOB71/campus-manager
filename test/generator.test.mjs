import test from "node:test";
import assert from "node:assert/strict";
import { generateWeek, buildDemand, buildSlots, scoreWeek, DEFAULT_OPTIONS } from "../lib/generator.js";
import { toMin } from "../lib/schedule.js";

// Jeu d'essai : un BTS Opticien-Lunetier à deux promotions, trois professeurs,
// trois salles dont un atelier d'optique. Cas réaliste et faisable.
function scenario(over = {}) {
  return {
    classes: [
      { id: "k1", campusId: "c1", curriculumId: "cur1", name: "BTS OL 1" },
      { id: "k2", campusId: "c1", curriculumId: "cur1", name: "BTS OL 2" },
    ],
    curricula: [{ id: "cur1", modules: [
      { id: "m1", code: "M1", label: "Optique geometrique", heures: 180 },
      { id: "m2", code: "M2", label: "Contactologie", heures: 120 },
      { id: "m3", code: "M3", label: "TP optique", heures: 108, requiresRoom: "optique" },
      { id: "m4", code: "M4", label: "Gestion", heures: 72 },
    ] }],
    teachers: [
      { id: "t1", name: "Marie", subjects: ["Optique geometrique", "TP optique"], heuresAnnuelles: 600,
        availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "12:30"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } },
      { id: "t2", name: "Paul", subjects: ["Contactologie", "Gestion"], heuresAnnuelles: 500,
        availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } },
      { id: "t3", name: "Sophie", subjects: ["Optique geometrique", "Gestion"], heuresAnnuelles: 400,
        availability: { mar: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]] } },
    ],
    rooms: [
      { id: "r1", campusId: "c1", name: "B12", places: 30, kind: "standard" },
      { id: "r2", campusId: "c1", name: "B14", places: 30, kind: "standard" },
      { id: "r3", campusId: "c1", name: "Atelier", places: 24, kind: "optique" },
    ],
    sizes: { k1: 24, k2: 22 },
    probeDates: { lun: "2026-09-14", mar: "2026-09-15", mer: "2026-09-16", jeu: "2026-09-17", ven: "2026-09-18" },
    ...over,
  };
}

// Vérification indépendante du générateur : on relit sa sortie sans lui faire confiance.
function collisions(week) {
  const bad = [];
  for (const kind of ["teacherId", "roomId", "classId"]) {
    const seen = new Map();
    for (const s of week) {
      if (!s[kind]) continue;
      const key = `${s[kind]}|${s.day}`;
      for (const other of seen.get(key) || []) {
        if (toMin(s.start) < toMin(other.end) && toMin(other.start) < toMin(s.end)) bad.push({ kind, a: other, b: s });
      }
      seen.set(key, [...(seen.get(key) || []), s]);
    }
  }
  return bad;
}

test("génère une semaine complète et SANS AUCUNE collision", () => {
  const r = generateWeek(scenario(), { seed: 42 });
  assert.equal(r.stats.coverage, 100, "toutes les séances demandées sont placées");
  assert.equal(r.unplaced.length, 0);
  // Le test qui compte : on recompte les collisions nous-mêmes.
  assert.deepEqual(collisions(r.week), [], "professeur, salle ou classe en double");
});

test("respecte les exigences de salle et de capacité", () => {
  const sc = scenario();
  const r = generateWeek(sc, { seed: 7 });
  const atelier = sc.rooms.find((x) => x.kind === "optique");
  for (const s of r.week) {
    const room = sc.rooms.find((x) => x.id === s.roomId);
    const mod = sc.curricula[0].modules.find((m) => m.id === s.moduleId);
    if (mod.requiresRoom) assert.equal(s.roomId, atelier.id, `${mod.label} doit être en atelier`);
    assert.ok(room.places >= sc.sizes[s.classId], "salle assez grande");
  }
});

test("n'affecte un cours qu'à un professeur qui enseigne la matière", () => {
  const sc = scenario();
  const r = generateWeek(sc, { seed: 3 });
  for (const s of r.week) {
    const t = sc.teachers.find((x) => x.id === s.teacherId);
    const mod = sc.curricula[0].modules.find((m) => m.id === s.moduleId);
    assert.ok(t.subjects.includes(mod.label), `${t.name} n'enseigne pas ${mod.label}`);
  }
});

test("respecte les disponibilités déclarées jour par jour", () => {
  const sc = scenario();
  const r = generateWeek(sc, { seed: 11 });
  for (const s of r.week) {
    const t = sc.teachers.find((x) => x.id === s.teacherId);
    const plages = t.availability[s.day];
    assert.ok(plages && plages.length, `${t.name} n'est pas déclaré le ${s.day}`);
    assert.ok(plages.some(([a, b]) => toMin(s.start) >= toMin(a) && toMin(s.end) <= toMin(b)),
      `${t.name} ${s.day} ${s.start}-${s.end} hors de ses plages`);
  }
});

test("ne remplit jamais la pause déjeuner", () => {
  const r = generateWeek(scenario(), { seed: 5 });
  const a = toMin(DEFAULT_OPTIONS.lunchStart), b = toMin(DEFAULT_OPTIONS.lunchEnd);
  for (const s of r.week) {
    assert.ok(!(toMin(s.start) < b && a < toMin(s.end)), `${s.day} ${s.start}-${s.end} empiète sur le déjeuner`);
  }
});

test("les plafonds légaux sont des contraintes DURES, pas des constats", () => {
  // Un seul professeur, contrat de 100 h par an, face à 480 h de référentiel :
  // il est mathématiquement impossible de tout placer sans exploser le contrat.
  // Le générateur doit refuser, pas produire un planning illégal.
  const sc = scenario({
    classes: [{ id: "k1", campusId: "c1", curriculumId: "cur1", name: "BTS OL 1" }],
    teachers: [{ id: "t1", name: "Seule", subjects: [], heuresAnnuelles: 100,
      availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } }],
  });
  const r = generateWeek(sc, { seed: 9 });
  assert.ok(r.unplaced.length > 0, "le générateur doit renoncer plutôt que dépasser le contrat");
  const codes = r.diagnosis.map((d) => d.code);
  assert.ok(codes.some((c) => c === "prof-plafond-hsupp" || c === "prof-plafond-hebdo"),
    `un plafond légal doit être cité, obtenu : ${codes.join(", ")}`);

  // Et en désactivant l'option, il place davantage : la contrainte était bien active.
  const libre = generateWeek(sc, { seed: 9, enforceLegalLimits: false });
  assert.ok(libre.stats.placed > r.stats.placed, "sans les plafonds, le solveur place plus");
});

test("diagnostic : dit QUOI manque et QUE faire, pas seulement qu'il a échoué", () => {
  // On retire l'atelier : les TP d'optique deviennent impossibles.
  const sc = scenario({ rooms: [
    { id: "r1", campusId: "c1", name: "B12", places: 30, kind: "standard" },
    { id: "r2", campusId: "c1", name: "B14", places: 30, kind: "standard" },
  ] });
  const r = generateWeek(sc, { seed: 13 });
  const d = r.diagnosis.find((x) => x.code === "salle-specifique-absente");
  assert.ok(d, `le manque de salle doit être identifié, obtenu : ${r.diagnosis.map((x) => x.code).join(", ")}`);
  assert.ok(d.hours > 0, "le volume non plaçable est chiffré");
  assert.ok(d.modules.includes("TP optique"), "le module concerné est nommé");
  assert.match(d.remedy, /salle/i, "un remède concret est proposé");
  // Le reste du planning est quand même produit : un blocage n'annule pas tout.
  assert.ok(r.stats.placed > 0, "les autres cours sont placés malgré le blocage");
  assert.deepEqual(collisions(r.week), []);
});

test("diagnostic : matière sans professeur déclaré", () => {
  const sc = scenario({ teachers: [
    { id: "t1", name: "Marie", subjects: ["Optique geometrique"], heuresAnnuelles: 900,
      availability: { lun: [["08:00", "18:00"]], mar: [["08:00", "18:00"]], mer: [["08:00", "18:00"]], jeu: [["08:00", "18:00"]], ven: [["08:00", "18:00"]] } },
  ] });
  const r = generateWeek(sc, { seed: 17 });
  assert.ok(r.unplaced.length > 0);
  assert.ok(r.diagnosis.some((d) => /prof/.test(d.code)), "le manque de professeur est identifié");
});

test("déterminisme : même graine, même planning", () => {
  const a = generateWeek(scenario(), { seed: 123 });
  const b = generateWeek(scenario(), { seed: 123 });
  assert.deepEqual(a.week, b.week, "un planning doit être régénérable à l'identique");
  const c = generateWeek(scenario(), { seed: 999 });
  assert.notDeepEqual(a.week, c.week, "une autre graine explore une autre solution");
});

test("buildDemand : convertit le volume annuel en séances hebdomadaires", () => {
  const u = buildDemand(
    [{ id: "k1", campusId: "c1", curriculumId: "cur1" }],
    [{ id: "cur1", modules: [{ id: "m1", label: "X", heures: 144 }, { id: "m2", label: "Y", heures: 0 }] }],
    { weeksInYear: 36, sessionMinutes: 120 },
  );
  // 144 h / 36 semaines = 4 h/semaine = 2 séances de 2 h.
  assert.equal(u.length, 2);
  assert.ok(u.every((x) => x.moduleId === "m1"), "un module à 0 h ne génère aucune séance");
});

test("buildSlots : la grille exclut le déjeuner et respecte l'amplitude", () => {
  const s = buildSlots({ days: ["lun"], dayStart: "08:00", dayEnd: "18:00", slotMinutes: 60, sessionMinutes: 120 });
  assert.ok(s.every((x) => toMin(x.start) >= toMin("08:00") && toMin(x.end) <= toMin("18:00")));
  assert.ok(s.every((x) => !(toMin(x.start) < toMin("13:30") && toMin("12:30") < toMin(x.end))));
  assert.ok(s.length > 0);
});

test("score : pénalise les trous et le déséquilibre de charge", () => {
  const slot = (day, start, end) => ({ day, start, end, from: toMin(start), to: toMin(end) });
  const compact = [
    { unit: { classId: "k1" }, slot: slot("lun", "08:00", "10:00"), teacher: { id: "t1" }, room: { id: "r1" } },
    { unit: { classId: "k1" }, slot: slot("lun", "10:00", "12:00"), teacher: { id: "t1" }, room: { id: "r1" } },
  ];
  const troue = [
    { unit: { classId: "k1" }, slot: slot("lun", "08:00", "10:00"), teacher: { id: "t1" }, room: { id: "r1" } },
    { unit: { classId: "k1" }, slot: slot("lun", "16:00", "18:00"), teacher: { id: "t1" }, room: { id: "r2" } },
  ];
  assert.equal(scoreWeek(compact, {}).classGaps, 0);
  assert.equal(scoreWeek(troue, {}).classGaps, 6);
  assert.ok(scoreWeek(troue, {}).penalty > scoreWeek(compact, {}).penalty);
  assert.equal(scoreWeek(troue, {}).roomChanges, 1, "changer de salle dans la journée est compté");
});

test("performance : une génération reste sous la seconde", () => {
  const t0 = Date.now();
  generateWeek(scenario(), { seed: 1 });
  assert.ok(Date.now() - t0 < 1000, "le générateur doit rester interactif");
});

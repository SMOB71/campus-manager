import test from "node:test";
import assert from "node:assert/strict";
import {
  toMin, hoursOf, overlaps, dayKeyOf, isoWeekKey,
  withinAvailability, isUnavailableOn, conflictsFor, hasHardBlock,
  coverage, serviceOf, equity, expandWeekly, SERVICE_LIMITS,
} from "../lib/schedule.js";

// --- Temps ---

test("toMin : comparaison correcte des horaires", () => {
  assert.equal(toMin("09:00"), 540);
  assert.equal(toMin("9:00"), 540);
  assert.equal(toMin("23:59"), 1439);
  assert.equal(toMin("24:00"), null);
  assert.equal(toMin("09:60"), null);
  assert.equal(toMin("neuf heures"), null);
  // Le piège que le format minutes évite : en chaînes, "9:00" > "10:00".
  assert.ok(toMin("09:00") < toMin("10:00"));
});

test("hoursOf : durée décimale, zéro si incohérent", () => {
  assert.equal(hoursOf({ start: "09:00", end: "12:00" }), 3);
  assert.equal(hoursOf({ start: "09:00", end: "10:30" }), 1.5);
  assert.equal(hoursOf({ start: "12:00", end: "09:00" }), 0);
  assert.equal(hoursOf({}), 0);
});

test("overlaps : deux cours qui se touchent ne sont PAS en conflit", () => {
  const d = "2026-09-14";
  const a = { date: d, start: "10:00", end: "12:00" };
  assert.equal(overlaps(a, { date: d, start: "12:00", end: "14:00" }), false, "bornes jointives");
  assert.equal(overlaps(a, { date: d, start: "08:00", end: "10:00" }), false);
  assert.equal(overlaps(a, { date: d, start: "11:00", end: "13:00" }), true);
  assert.equal(overlaps(a, { date: d, start: "10:30", end: "11:00" }), true, "inclus");
  assert.equal(overlaps(a, { date: "2026-09-15", start: "11:00", end: "13:00" }), false, "autre jour");
});

test("dayKeyOf / isoWeekKey", () => {
  assert.equal(dayKeyOf("2026-09-14"), "lun");
  assert.equal(dayKeyOf("2026-09-19"), "sam");
  assert.equal(dayKeyOf("pas une date"), null);
  assert.equal(isoWeekKey("2026-09-14"), isoWeekKey("2026-09-18"), "même semaine ISO");
  assert.notEqual(isoWeekKey("2026-09-14"), isoWeekKey("2026-09-21"));
});

// --- Disponibilité ---

const prof = {
  id: "t1", name: "Marie Dupont", heuresAnnuelles: 600, tauxHoraire: 45,
  subjects: ["Optique géométrique"],
  availability: { lun: [], mar: [["09:00", "12:30"]], mer: [["09:00", "12:30"], ["14:00", "17:30"]] },
  unavailable: [{ id: "u1", from: "2026-10-19", to: "2026-10-23", reason: "congé" }],
};

test("disponibilité : plages propres à chaque jour", () => {
  assert.equal(withinAvailability(prof, "2026-09-15", "09:00", "12:00"), true, "mardi matin, dans la plage");
  assert.equal(withinAvailability(prof, "2026-09-15", "09:00", "13:00"), false, "déborde de 30 min");
  assert.equal(withinAvailability(prof, "2026-09-15", "14:00", "16:00"), false, "mardi après-midi non déclaré");
  assert.equal(withinAvailability(prof, "2026-09-16", "14:00", "16:00"), true, "mercredi a deux plages");
  assert.equal(withinAvailability(prof, "2026-09-14", "09:00", "10:00"), false, "lundi : aucune plage");
  // Jeudi n'est pas déclaré du tout → pas de contrainte connue, on n'invente pas.
  assert.equal(withinAvailability(prof, "2026-09-17", "09:00", "10:00"), true);
});

test("indisponibilité datée : prime sur le motif hebdomadaire", () => {
  assert.equal(isUnavailableOn(prof, "2026-10-21"), true);
  // Un mercredi normalement disponible, mais en congé cette semaine-là.
  assert.equal(dayKeyOf("2026-10-21"), "mer");
  assert.equal(withinAvailability(prof, "2026-10-21", "09:00", "12:00"), false);
});

// --- Conflits ---

const base = { id: "s1", date: "2026-09-15", start: "09:00", end: "12:00", classId: "c1", teacherId: "t1", roomId: "r1" };

test("conflits : professeur, salle et classe déjà pris", () => {
  const rival = { id: "s2", date: "2026-09-15", start: "10:00", end: "11:00", classId: "c9", teacherId: "t1", roomId: "r9" };
  const c = conflictsFor(base, [rival], {});
  assert.ok(c.some((x) => x.code === "teacherId" && x.level === "block"));
  assert.ok(hasHardBlock(c));

  const salle = { id: "s3", date: "2026-09-15", start: "11:00", end: "13:00", classId: "c9", teacherId: "t9", roomId: "r1" };
  assert.ok(conflictsFor(base, [salle], {}).some((x) => x.code === "roomId"));

  // Une séance annulée ne bloque plus rien.
  assert.equal(conflictsFor(base, [{ ...rival, status: "cancelled" }], {}).length, 0);
  // Et une séance ne se bloque pas elle-même lors d'un déplacement.
  assert.equal(conflictsFor(base, [base], {}).length, 0);
});

test("conflits : horaires incohérents et amplitude", () => {
  assert.ok(conflictsFor({ ...base, start: "12:00", end: "09:00" }, [], {}).some((x) => x.code === "horaire"));
  const tot = conflictsFor({ ...base, start: "06:00", end: "08:00" }, [], {});
  assert.ok(tot.some((x) => x.code === "amplitude"));
});

test("conflits : disponibilité bloquante mais forçable", () => {
  const c = conflictsFor({ ...base, date: "2026-09-14" }, [], { teacher: prof });
  const dispo = c.find((x) => x.code === "disponibilite");
  assert.ok(dispo);
  assert.equal(dispo.level, "block-forcable");
  assert.equal(hasHardBlock(c), false, "forçable ≠ blocage dur");
});

test("conflits : calendrier scolaire", () => {
  const periods = [
    { kind: "vacances", label: "Toussaint", from: "2026-10-17", to: "2026-11-02" },
    { kind: "examens", label: "Blancs", from: "2026-12-14", to: "2026-12-18" },
    { kind: "stage", from: "2027-01-05", to: "2027-01-30", classId: "c1" },
  ];
  const vac = conflictsFor({ ...base, date: "2026-10-20" }, [], { periods });
  assert.ok(vac.some((x) => x.code === "calendrier" && /Vacances/.test(x.message)));

  // En période d'examens : un cours est signalé, une épreuve ne l'est pas.
  assert.ok(conflictsFor({ ...base, date: "2026-12-15" }, [], { periods }).some((x) => x.code === "calendrier"));
  assert.equal(conflictsFor({ ...base, date: "2026-12-15", kind: "examen" }, [], { periods }).length, 0);

  // Le stage ne concerne QUE la classe visée.
  assert.ok(conflictsFor({ ...base, date: "2027-01-12" }, [], { periods }).some((x) => x.code === "calendrier"));
  assert.equal(conflictsFor({ ...base, date: "2027-01-12", classId: "c2" }, [], { periods }).length, 0);
});

test("conflits : capacité et spécificité de salle", () => {
  const petite = { name: "B12", places: 20 };
  assert.ok(conflictsFor(base, [], { room: petite, classSize: 28 }).some((x) => x.code === "capacite" && x.level === "warn"));

  const tp = { id: "m1", code: "M3", label: "Travaux pratiques d'optique", requiresRoom: "optique" };
  const banale = { name: "B12", places: 30, kind: "standard", equipment: [] };
  const atelier = { name: "Atelier optique", places: 30, kind: "optique", equipment: ["banc"] };
  assert.ok(conflictsFor(base, [], { room: banale, module: tp }).some((x) => x.code === "salle-equipement"));
  assert.equal(conflictsFor(base, [], { room: atelier, module: tp }).length, 0);
});

test("conflits : professeur non déclaré sur la matière (alerte seulement)", () => {
  const c = conflictsFor(base, [], { teacher: { ...prof, availability: {} }, module: { id: "m2", code: "M5", label: "Contactologie" } });
  const m = c.find((x) => x.code === "matiere");
  assert.ok(m && m.level === "warn");
  assert.equal(hasHardBlock(c), false);
});

// --- Couverture du référentiel ---

test("couverture : dû / posé / réalisé et manque par module", () => {
  const cur = { modules: [{ id: "m1", code: "M1", label: "Optique", heures: 120 }, { id: "m2", code: "M2", label: "Gestion", heures: 60 }] };
  const ses = [
    { moduleId: "m1", start: "09:00", end: "12:00", status: "done" },      // 3 h
    { moduleId: "m1", start: "14:00", end: "17:00", status: "planned" },   // 3 h
    { moduleId: "m1", start: "09:00", end: "12:00", status: "cancelled" }, // ignorée
    { moduleId: "m2", start: "09:00", end: "10:00", status: "done" },      // 1 h
  ];
  const c = coverage(cur, ses);
  const m1 = c.rows.find((r) => r.moduleId === "m1");
  assert.equal(m1.planned, 6);
  assert.equal(m1.done, 3);
  assert.equal(m1.gap, 114, "une séance annulée ne compte pas comme posée");
  assert.equal(c.total.due, 180);
  assert.equal(c.total.planned, 7);
});

// --- Service et seuils légaux ---

test("service : heures dues, posées, supplémentaires et coût", () => {
  const ses = [
    { teacherId: "t1", date: "2026-09-14", start: "09:00", end: "12:00", status: "done" },
    { teacherId: "t1", date: "2026-09-15", start: "09:00", end: "12:00", status: "planned" },
    { teacherId: "t2", date: "2026-09-15", start: "09:00", end: "12:00", status: "planned" },
  ];
  const s = serviceOf({ ...prof, heuresAnnuelles: 5 }, ses);
  assert.equal(s.planned, 6);
  assert.equal(s.done, 3);
  assert.equal(s.overtime, 1, "6 h posées pour 5 h dues");
  assert.equal(s.cost, 270, "6 h × 45 €");
});

test("service : les deux plafonds légaux se déclenchent", () => {
  // 30 h sur une seule semaine → au-delà des 28 h hebdomadaires.
  const semaine = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"].map((date) => ({
    teacherId: "t1", date, start: "08:00", end: "14:00", status: "planned",   // 6 h × 5 = 30 h
  }));
  const s1 = serviceOf({ id: "t1", heuresAnnuelles: 600 }, semaine);
  assert.equal(s1.peakHours, 30);
  assert.ok(s1.flags.some((f) => f.code === "hebdo" && f.level === "high"));

  // 60 h supplémentaires → au-delà des 48 h annuelles.
  const s2 = serviceOf({ id: "t1", heuresAnnuelles: 10 }, [
    { teacherId: "t1", date: "2026-09-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2026-10-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2026-11-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2026-12-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2027-01-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2027-02-14", start: "08:00", end: "18:00", status: "planned" },
    { teacherId: "t1", date: "2027-03-14", start: "08:00", end: "18:00", status: "planned" },
  ]);
  assert.equal(s2.overtime, 60);
  assert.ok(s2.flags.some((f) => f.code === "hsupp" && f.level === "high"));
  assert.equal(SERVICE_LIMITS.overtimeYearMax, 48);
});

test("équité : l'écart de charge se voit, la moyenne le cache", () => {
  const e = equity([{ planned: 100 }, { planned: 100 }, { planned: 100 }]);
  assert.equal(e.stdev, 0);
  const d = equity([{ planned: 20 }, { planned: 180 }]);
  assert.equal(d.mean, 100, "même moyenne");
  assert.ok(d.stdev > 0);
  assert.equal(d.spread, 160);
});

// --- Récurrence ---

test("récurrence : saute vacances, fériés et stage de la classe", () => {
  const periods = [
    { kind: "vacances", from: "2026-10-17", to: "2026-11-02" },
    { kind: "examens", from: "2026-09-28", to: "2026-09-30" },       // NON sautée
    { kind: "stage", from: "2026-11-09", to: "2026-11-16", classId: "c2" },
  ];
  const out = expandWeekly({ date: "2026-09-14", start: "09:00", end: "12:00", classId: "c1" }, "2026-11-16", periods);
  const dates = out.map((s) => s.date);
  assert.ok(dates.includes("2026-09-14"));
  assert.ok(dates.includes("2026-09-28"), "une période d'examens ne supprime pas la séance");
  assert.ok(!dates.includes("2026-10-19"), "vacances sautées");
  assert.ok(!dates.includes("2026-10-26"), "vacances sautées");
  assert.ok(dates.includes("2026-11-09"), "le stage vise la classe c2, pas c1");
  assert.ok(out.every((s) => s.start === "09:00"), "les autres champs sont conservés");
});

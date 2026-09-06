// Générateur d'emploi du temps — logique pure, sans I/O.
//
// STRATÉGIE : on génère la SEMAINE TYPE, pas les 36 semaines de l'année.
// C'est ainsi qu'une école fonctionne réellement, et c'est un problème 36 fois plus
// petit — donc soluble proprement en JavaScript, là où l'année entière exigerait un
// solveur industriel. La semaine obtenue est ensuite déroulée par expandWeekly()
// (lib/schedule.js), qui saute vacances, fériés et stages ; coverage() vérifie
// ensuite que le volume annuel du référentiel est bien atteint.
//
// ALGORITHME : glouton guidé par la contrainte la plus forte (MRV — on place d'abord
// ce qui a le moins de places possibles), avec retour arrière borné et redémarrages
// aléatoires. On garde le meilleur des N essais selon un score de confort.
//
// CE QUI LE DISTINGUE DU MARCHÉ :
//  1. Il refuse de produire un planning illégal. Les plafonds de service (28 h
//     hebdomadaires, 48 h supplémentaires annuelles) sont des contraintes DURES,
//     pas des indicateurs constatés après coup. Aucun éditeur du marché ne connaît
//     la paie, donc aucun ne peut faire ça.
//  2. Quand il échoue, il dit POURQUOI et sur quelle ressource. Un générateur qui
//     rend « 18 h non placées » sans explication est inutilisable ; celui-ci dit
//     quelle salle, quel professeur ou quel créneau a bloqué, et combien de fois.
//  3. Il optimise le confort réel — trous dans la journée des étudiants, équilibre
//     de charge entre professeurs, stabilité de salle — pas seulement l'absence de
//     collision.

import { toMin, toHHMM, hoursOf, withinAvailability, isoWeekKey, round2, SERVICE_LIMITS } from "./schedule.js";

export const WEEK_DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam"];

export const DEFAULT_OPTIONS = {
  days: ["lun", "mar", "mer", "jeu", "ven"],
  dayStart: "08:00",
  dayEnd: "18:00",
  slotMinutes: 60,                  // granularité de la grille
  lunchStart: "12:30",
  lunchEnd: "13:30",                // créneau réservé, jamais rempli
  sessionMinutes: 120,              // durée d'un cours par défaut
  maxHoursPerDayClass: 7,
  maxHoursPerDayTeacher: 6,
  restarts: 12,                     // redémarrages aléatoires
  weeksInYear: 36,
  enforceLegalLimits: true,
};

// ---------------------------------------------------------------------------
// Demande : ce qu'il faut placer chaque semaine
// ---------------------------------------------------------------------------

// Convertit le volume annuel du référentiel en séances hebdomadaires.
// Un module de 120 h sur 36 semaines = 3,33 h/semaine ≈ 2 séances de 2 h une
// semaine sur deux — on arrondit à l'entier supérieur en séances et coverage()
// dira ensuite s'il y a trop ou pas assez.
export function buildDemand(classes, curricula, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const units = [];
  for (const k of classes) {
    const cur = curricula.find((c) => c.id === k.curriculumId);
    if (!cur) continue;
    for (const m of cur.modules || []) {
      const total = m.heures == null ? 0 : Number(m.heures) || 0;
      if (total <= 0) continue;
      const weekly = total / o.weeksInYear;
      const perWeek = Math.max(1, Math.round((weekly * 60) / o.sessionMinutes));
      for (let i = 0; i < perWeek; i++) {
        units.push({
          id: `${k.id}:${m.id}:${i}`,
          classId: k.id, campusId: k.campusId, moduleId: m.id,
          label: m.label || m.code, requiresRoom: m.requiresRoom || null,
          durationMin: o.sessionMinutes,
          annualHours: total,
        });
      }
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Grille de créneaux
// ---------------------------------------------------------------------------

export function buildSlots(opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const start = toMin(o.dayStart), end = toMin(o.dayEnd);
  const lunchA = toMin(o.lunchStart), lunchB = toMin(o.lunchEnd);
  const slots = [];
  for (const day of o.days) {
    for (let t = start; t + o.sessionMinutes <= end; t += o.slotMinutes) {
      const t2 = t + o.sessionMinutes;
      // La pause déjeuner est un créneau réservé : la chevaucher est exclu.
      if (lunchA != null && lunchB != null && t < lunchB && lunchA < t2) continue;
      slots.push({ day, start: toHHMM(t), end: toHHMM(t2), from: t, to: t2 });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// État d'occupation
// ---------------------------------------------------------------------------

function newState() {
  return { placed: [], busy: { teacher: new Map(), room: new Map(), klass: new Map() }, hours: { teacher: new Map(), klass: new Map() } };
}
const keyOf = (id, day) => `${id}|${day}`;
function occupied(state, kind, id, slot) {
  const list = state.busy[kind].get(keyOf(id, slot.day));
  return !!list && list.some(([a, b]) => a < slot.to && slot.from < b);
}
function occupy(state, kind, id, slot) {
  const k = keyOf(id, slot.day);
  const list = state.busy[kind].get(k) || [];
  list.push([slot.from, slot.to]);
  state.busy[kind].set(k, list);
}
function release(state, kind, id, slot) {
  const k = keyOf(id, slot.day);
  const list = (state.busy[kind].get(k) || []).filter(([a, b]) => !(a === slot.from && b === slot.to));
  if (list.length) state.busy[kind].set(k, list); else state.busy[kind].delete(k);
}
const addHours = (map, id, h) => map.set(id, round2((map.get(id) || 0) + h));

// ---------------------------------------------------------------------------
// Faisabilité d'un placement
// ---------------------------------------------------------------------------

// Le générateur est DÉLIBÉRÉMENT plus strict que l'éditeur sur les disponibilités.
// L'éditeur laisse passer un jour non renseigné : la fiche est souvent incomplète et
// l'utilisateur qui pose un cours à la main sait ce qu'il fait. Le générateur, lui,
// ne doit rien inventer — un professeur qui a déclaré ses mardis et ses jeudis n'a
// pas dit qu'il était libre le lundi. Un professeur sans AUCUNE disponibilité
// déclarée reste considéré comme libre : c'est l'état de départ des fiches.
export function generatorAvailable(teacher, slot, ctx = {}) {
  const av = teacher?.availability || {};
  if (!Object.keys(av).length) return true;
  const ranges = av[slot.day];
  if (!Array.isArray(ranges) || !ranges.length) return false;
  const probe = ctx.probeDates?.[slot.day];
  // Avec une date témoin, on réutilise la logique déjà testée (indisponibilités
  // datées comprises) plutôt que d'en réécrire une variante divergente.
  if (probe) return withinAvailability(teacher, probe, slot.start, slot.end);
  const s = toMin(slot.start), e = toMin(slot.end);
  return ranges.some(([a, b]) => toMin(a) != null && toMin(b) != null && s >= toMin(a) && e <= toMin(b));
}

// Renvoie null si le placement est possible, sinon le CODE du blocage — c'est ce
// code qui alimentera le diagnostic d'échec.
export function whyNot(unit, slot, teacher, room, state, ctx, o) {
  const hours = unit.durationMin / 60;

  if (occupied(state, "klass", unit.classId, slot)) return "classe-occupee";
  if (teacher && occupied(state, "teacher", teacher.id, slot)) return "prof-occupe";
  if (room && occupied(state, "room", room.id, slot)) return "salle-occupee";

  if (teacher) {
    if (!generatorAvailable(teacher, slot, ctx)) return "prof-indisponible";

    const dayH = (state.hours.teacher.get(`${teacher.id}|${slot.day}`) || 0) + hours;
    if (dayH > o.maxHoursPerDayTeacher) return "prof-journee-pleine";

    if (o.enforceLegalLimits) {
      const weekH = (state.hours.teacher.get(teacher.id) || 0) + hours;
      // Plafond hebdomadaire légal : contrainte DURE, pas un indicateur.
      if (weekH > (ctx.limits?.weeklyMaxHours ?? SERVICE_LIMITS.weeklyMaxHours)) return "prof-plafond-hebdo";
      // Plafond annuel d'heures supplémentaires, ramené à la semaine type.
      const due = teacher.heuresAnnuelles;
      if (due != null && due > 0) {
        const annual = weekH * o.weeksInYear;
        const overtime = annual - due;
        if (overtime > (ctx.limits?.overtimeYearMax ?? SERVICE_LIMITS.overtimeYearMax)) return "prof-plafond-hsupp";
      }
    }
  }

  const dayHK = (state.hours.klass.get(`${unit.classId}|${slot.day}`) || 0) + hours;
  if (dayHK > o.maxHoursPerDayClass) return "classe-journee-pleine";

  if (unit.requiresRoom) {
    if (!room) return "salle-specifique-absente";
    const has = [room.kind, ...(room.equipment || [])].filter(Boolean).map((x) => String(x).toLowerCase());
    if (!has.includes(String(unit.requiresRoom).toLowerCase())) return "salle-specifique-absente";
  }
  if (room && ctx.sizes?.[unit.classId] != null && room.places != null && ctx.sizes[unit.classId] > room.places) {
    return "salle-trop-petite";
  }
  return null;
}

// Candidats (créneau, professeur, salle) pour une unité, avec les raisons de rejet.
function candidates(unit, state, ctx, o, collect) {
  const out = [];
  const profs = ctx.teachersByModule.get(unit.moduleId) || [];
  const rooms = ctx.roomsByCampus.get(unit.campusId) || [];
  for (const slot of ctx.slots) {
    for (const { t: teacher, tier } of profs) {
      for (const room of rooms) {
        const bad = whyNot(unit, slot, teacher, room, state, ctx, o);
        if (bad) { if (collect) collect.set(bad, (collect.get(bad) || 0) + 1); continue; }
        out.push({ slot, teacher, room, tier });
      }
    }
  }
  if (!profs.length && collect) collect.set("aucun-prof-declare", (collect.get("aucun-prof-declare") || 0) + 1);
  if (!rooms.length && collect) collect.set("aucune-salle", (collect.get("aucune-salle") || 0) + 1);
  return out;
}

function apply(state, unit, choice) {
  const { slot, teacher, room } = choice;
  const h = unit.durationMin / 60;
  occupy(state, "klass", unit.classId, slot);
  if (teacher) occupy(state, "teacher", teacher.id, slot);
  if (room) occupy(state, "room", room.id, slot);
  addHours(state.hours.klass, `${unit.classId}|${slot.day}`, h);
  if (teacher) { addHours(state.hours.teacher, `${teacher.id}|${slot.day}`, h); addHours(state.hours.teacher, teacher.id, h); }
  state.placed.push({ unit, ...choice });
}
// Rend l'entrée dépilée : l'appelant DOIT remettre son unité dans la file.
// Sans ça, chaque retour arrière perdait une séance en silence — ni placée, ni
// signalée comme non plaçable, donc un trou invisible dans l'emploi du temps.
function undo(state) {
  const last = state.placed.pop();
  if (!last) return null;
  const { unit, slot, teacher, room } = last;
  const h = unit.durationMin / 60;
  release(state, "klass", unit.classId, slot);
  if (teacher) release(state, "teacher", teacher.id, slot);
  if (room) release(state, "room", room.id, slot);
  addHours(state.hours.klass, `${unit.classId}|${slot.day}`, -h);
  if (teacher) { addHours(state.hours.teacher, `${teacher.id}|${slot.day}`, -h); addHours(state.hours.teacher, teacher.id, -h); }
  return last;
}

// ---------------------------------------------------------------------------
// Score de confort — ce qui sépare un planning valide d'un planning vivable
// ---------------------------------------------------------------------------

export function scoreWeek(placed, ctx, o = DEFAULT_OPTIONS) {
  const byClassDay = new Map(), byTeacherDay = new Map(), roomsByClassDay = new Map();
  const teacherWeek = new Map();
  for (const p of placed) {
    const ck = `${p.unit.classId}|${p.slot.day}`;
    (byClassDay.get(ck) || byClassDay.set(ck, []).get(ck)).push(p.slot);
    if (p.teacher) {
      const tk = `${p.teacher.id}|${p.slot.day}`;
      (byTeacherDay.get(tk) || byTeacherDay.set(tk, []).get(tk)).push(p.slot);
      teacherWeek.set(p.teacher.id, round2((teacherWeek.get(p.teacher.id) || 0) + hoursOf(p.slot)));
    }
    if (p.room) {
      const rk = `${p.unit.classId}|${p.slot.day}`;
      const set = roomsByClassDay.get(rk) || new Set();
      set.add(p.room.id); roomsByClassDay.set(rk, set);
    }
  }
  const gapsOf = (map) => {
    let gaps = 0;
    for (const slots of map.values()) {
      const s = slots.slice().sort((a, b) => a.from - b.from);
      for (let i = 1; i < s.length; i++) gaps += Math.max(0, (s[i].from - s[i - 1].to) / 60);
    }
    return round2(gaps);
  };
  const classGaps = gapsOf(byClassDay);
  const teacherGaps = gapsOf(byTeacherDay);
  let roomChanges = 0;
  for (const set of roomsByClassDay.values()) roomChanges += Math.max(0, set.size - 1);

  const loads = [...teacherWeek.values()];
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  const stdev = loads.length ? Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length) : 0;

  // Pénalités : un trou pour 30 étudiants coûte plus qu'un trou pour un professeur.
  const penalty = round2(classGaps * 3 + teacherGaps * 1 + roomChanges * 0.5 + stdev * 2);
  return { classGaps, teacherGaps, roomChanges, loadStdev: round2(stdev), penalty };
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

// Générateur pseudo-aléatoire déterministe : à graine égale, résultat égal.
// Indispensable pour que les tests soient reproductibles et qu'un planning
// puisse être régénéré à l'identique.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function solveOnce(units, ctx, o, seed) {
  const state = newState();
  const rand = rng(seed);
  const remaining = units.slice();
  const unplaced = [];
  let backtracks = 0;
  const maxBacktracks = Math.max(50, units.length * 4);

  while (remaining.length) {
    // MRV : on place d'abord l'unité qui a le moins d'options. Un TP exigeant
    // l'atelier avec un vacataire du mardi matin n'a qu'une place possible ;
    // le poser en dernier, c'est le condamner.
    let best = null, bestOpts = null, bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const opts = candidates(remaining[i], state, ctx, o, null);
      if (best === null || opts.length < bestOpts.length) { best = remaining[i]; bestOpts = opts; bestIdx = i; }
      if (opts.length === 0) break;                       // impasse : traiter tout de suite
    }
    remaining.splice(bestIdx, 1);

    if (!bestOpts.length) {
      if (backtracks < maxBacktracks && state.placed.length) {
        backtracks++;
        const freed = undo(state);
        remaining.push(best);
        if (freed) remaining.push(freed.unit);   // sans ça, la séance dépilée disparaît
        continue;
      }
      const why = new Map();
      candidates(best, state, ctx, o, why);
      unplaced.push({ unit: best, reasons: [...why.entries()].sort((a, b) => b[1] - a[1]) });
      continue;
    }
    // Parmi les options, on préfère celles qui collent au reste de la journée
    // (moins de trous) ; le tirage aléatoire départage et permet aux
    // redémarrages d'explorer des solutions différentes.
    // Le rang du professeur prime sur l'heure : mieux vaut un spécialiste l'après-midi
    // qu'un polyvalent le matin.
    bestOpts.sort((a, b) => (a.tier - b.tier) || (a.slot.from - b.slot.from));
    const bestTier = bestOpts[0].tier;
    bestOpts = bestOpts.filter((x) => x.tier === bestTier);
    const window = bestOpts.slice(0, Math.max(1, Math.ceil(bestOpts.length * 0.35)));
    apply(state, best, window[Math.floor(rand() * window.length)]);
  }
  return { state, unplaced, backtracks };
}

// Point d'entrée. `ctx` : { classes, curricula, teachers, rooms, sizes, probeDates, limits }
export function generateWeek(ctx, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const slots = buildSlots(o);
  const units = buildDemand(ctx.classes || [], ctx.curricula || [], o);

  // Index : quels professeurs peuvent assurer quel module, quelles salles par campus.
  // Deux rangs de professeurs par module, et l'ordre compte.
  // Rang 1 : ceux qui déclarent la matière. Rang 2 : ceux qui ne déclarent AUCUNE
  // matière — considérés polyvalents faute de mieux, parce qu'une fiche vide ne doit
  // pas rendre un professeur inutilisable au démarrage.
  // Sans cette hiérarchie, un contact importé sans matière raflait tout l'enseignement
  // pendant que le spécialiste déclaré restait à zéro heure. Le rang 2 ne sert donc
  // qu'en dernier recours, quand le rang 1 est saturé ou indisponible.
  const teachersByModule = new Map();
  for (const cur of ctx.curricula || []) {
    for (const m of cur.modules || []) {
      const label = String(m.label || "").toLowerCase(), code = String(m.code || "").toLowerCase();
      const actifs = (ctx.teachers || []).filter((t) => t.active !== false);
      const declares = actifs.filter((t) => (t.subjects || []).some((s) => {
        const v = String(s).toLowerCase();
        return v === label || v === code;
      }));
      const polyvalents = actifs.filter((t) => !(t.subjects || []).length);
      teachersByModule.set(m.id, [
        ...declares.map((t) => ({ t, tier: 0 })),
        ...polyvalents.map((t) => ({ t, tier: 1 })),
      ]);
    }
  }
  const roomsByCampus = new Map();
  for (const r of ctx.rooms || []) {
    const list = roomsByCampus.get(r.campusId) || [];
    list.push(r); roomsByCampus.set(r.campusId, list);
  }
  const full = { ...ctx, slots, teachersByModule, roomsByCampus };

  let best = null;
  for (let i = 0; i < o.restarts; i++) {
    const run = solveOnce(units, full, o, (o.seed || 1) + i * 7919);
    const sc = scoreWeek(run.state.placed, full, o);
    // Le critère premier reste le nombre de cours placés : un planning élégant
    // mais incomplet ne sert à rien. Le confort ne départage qu'à égalité.
    const rank = run.unplaced.length * 1000 + sc.penalty;
    if (!best || rank < best.rank) best = { rank, run, score: sc };
    if (!run.unplaced.length && sc.penalty === 0) break;
  }

  const placed = best.run.state.placed.map((p) => ({
    classId: p.unit.classId, campusId: p.unit.campusId, moduleId: p.unit.moduleId,
    teacherId: p.teacher?.id || null, roomId: p.room?.id || null,
    day: p.slot.day, start: p.slot.start, end: p.slot.end,
    label: p.unit.label,
  }));

  return {
    week: placed,
    unplaced: best.run.unplaced.map((u) => ({
      classId: u.unit.classId, moduleId: u.unit.moduleId, label: u.unit.label,
      hours: u.unit.durationMin / 60, reasons: u.reasons,
    })),
    score: best.score,
    stats: {
      demanded: units.length, placed: placed.length,
      coverage: units.length ? Math.round((placed.length / units.length) * 100) : 100,
      backtracks: best.run.backtracks, restarts: o.restarts,
    },
    diagnosis: diagnose(best.run.unplaced, full),
  };
}

// ---------------------------------------------------------------------------
// Diagnostic — la partie que le marché ne fait pas
// ---------------------------------------------------------------------------

const REASON_LABEL = {
  "classe-occupee": "la classe a déjà cours sur tous les créneaux restants",
  "prof-occupe": "les professeurs qualifiés sont déjà en cours",
  "salle-occupee": "les salles compatibles sont déjà prises",
  "prof-indisponible": "aucun professeur qualifié n'est disponible sur les créneaux libres",
  "prof-journee-pleine": "les professeurs atteignent leur maximum journalier",
  "prof-plafond-hebdo": "placer ce cours dépasserait le plafond légal de 28 h hebdomadaires",
  "prof-plafond-hsupp": "placer ce cours dépasserait le plafond de 48 h supplémentaires annuelles",
  "classe-journee-pleine": "les journées de la classe sont pleines",
  "salle-specifique-absente": "aucune salle ne possède l'équipement exigé par le module",
  "salle-trop-petite": "aucune salle disponible n'a la capacité suffisante",
  "aucun-prof-declare": "aucun professeur n'est déclaré sur cette matière",
  "aucune-salle": "aucune salle n'est déclarée sur ce campus",
};

// Transforme « 18 h non placées » en « il vous manque une salle d'optique ».
// C'est la différence entre un outil qui constate et un outil qui sert.
export function diagnose(unplaced, ctx) {
  if (!unplaced?.length) return [];
  const byReason = new Map();
  for (const u of unplaced) {
    const top = u.reasons?.[0]?.[0];
    if (!top) continue;
    const cur = byReason.get(top) || { code: top, hours: 0, modules: new Set() };
    cur.hours = round2(cur.hours + u.unit.durationMin / 60);
    cur.modules.add(u.unit.label);
    byReason.set(top, cur);
  }
  return [...byReason.values()]
    .sort((a, b) => b.hours - a.hours)
    .map((r) => ({
      code: r.code,
      hours: r.hours,
      modules: [...r.modules],
      message: `${r.hours} h non placées — ${REASON_LABEL[r.code] || r.code}.`,
      remedy: REMEDY[r.code] || null,
    }));
}

// Ce qu'il faut changer pour débloquer. Un diagnostic sans remède est une plainte.
const REMEDY = {
  "salle-specifique-absente": "Déclarer une salle avec cet équipement, ou retirer l'exigence du module.",
  "salle-trop-petite": "Dédoubler le groupe, ou affecter une salle plus grande.",
  "aucun-prof-declare": "Renseigner la matière sur la fiche d'un professeur.",
  "aucune-salle": "Créer au moins une salle sur ce campus.",
  "prof-indisponible": "Élargir les disponibilités déclarées, ou recruter un intervenant.",
  "prof-plafond-hebdo": "Répartir sur un second professeur : le plafond légal est atteint.",
  "prof-plafond-hsupp": "Le contrat annuel est saturé — avenant, ou second intervenant.",
  "prof-journee-pleine": "Autoriser une journée plus longue, ou étaler sur un autre jour.",
  "classe-journee-pleine": "Ouvrir un jour supplémentaire, ou réduire le volume hebdomadaire.",
  "salle-occupee": "Ajouter une salle, ou déplacer un autre cours.",
  "prof-occupe": "Qualifier un second professeur sur cette matière.",
  "classe-occupee": "Réduire le volume hebdomadaire demandé par le référentiel.",
};

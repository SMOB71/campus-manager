// Logique pure du module Plannings — aucune I/O, aucun état.
// Extraite ici pour être testable sans serveur, comme lib/calc.js.
//
// Ce fichier porte ce qui distingue le module d'un simple éditeur de créneaux :
// poser un cours n'est pas seulement éviter un doublon de salle, c'est vérifier que
// le volume du référentiel sera atteint et que le contrat du professeur est tenu.

// --- Seuils réglementaires (enseignement privé indépendant) ---
// Le contrat fixe un nombre annuel d'heures ; tout dépassement bascule en heures
// supplémentaires, et deux plafonds ne peuvent être franchis sans faute.
// Surchargables par établissement via les réglages.
export const SERVICE_LIMITS = {
  weeklyMaxHours: 28,        // au-delà, l'enseignant ne peut être contraint
  overtimeYearMax: 48,       // heures supplémentaires maximales sur l'année scolaire
};

export const DAY_KEYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

// --- Calendrier scolaire : les périodes qui interdisent ou changent la nature d'un cours ---
// Un emploi du temps ne se lit pas seul : la même case du lundi 10 h est valide en
// novembre, interdite pendant les vacances, et réservée aux épreuves en période d'examens.
export const PERIOD_KINDS = {
  vacances: "Vacances scolaires",
  ferie: "Jour férié",
  examens: "Période d'examens",
  stage: "Période de stage",
  // En alternance, les semaines en entreprise ne sont pas des vacances : l'école
  // est ouverte, la classe n'est simplement pas là. Sans ce type, une série
  // hebdomadaire poserait des cours pendant que les étudiants sont en poste.
  entreprise: "Semaine en entreprise",
};
export const SESSION_KINDS = {
  cours: "Cours",
  examen: "Examen",
  rattrapage: "Rattrapage",
  reunion: "Réunion pédagogique",
};

// Périodes couvrant une date. Une période de stage ne vaut que pour la classe visée
// (les autres promotions continuent leurs cours).
export function periodsOn(dateISO, periods = [], classId = null) {
  return (periods || []).filter((p) => {
    if (!p?.from || !p?.to || dateISO < p.from || dateISO > p.to) return false;
    if (p.classId && classId && p.classId !== classId) return false;
    if (p.classId && !classId) return false;
    return true;
  });
}

// --- Temps ---
// Les heures sont manipulées en minutes depuis minuit : comparer "9:00" et "10:00"
// en chaînes marche par accident, "9:00" vs "10:00" ne marche pas.
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return h * 60 + mn;
}
export function toHHMM(min) {
  if (min == null || !Number.isFinite(min)) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Durée d'une séance en heures décimales (1 h 30 → 1.5).
export function hoursOf(s) {
  const a = toMin(s?.start), b = toMin(s?.end);
  if (a == null || b == null || b <= a) return 0;
  return (b - a) / 60;
}
export function dayKeyOf(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DAY_KEYS[d.getUTCDay()];
}

// Deux créneaux se chevauchent-ils ? Deux séances qui se touchent (10:00–12:00 et
// 12:00–14:00) ne se chevauchent PAS : c'est le cas le plus fréquent d'un emploi du
// temps, le confondre avec un conflit rendrait l'éditeur inutilisable.
export function overlaps(a, b) {
  if (!a || !b || a.date !== b.date) return false;
  const a1 = toMin(a.start), a2 = toMin(a.end), b1 = toMin(b.start), b2 = toMin(b.end);
  if ([a1, a2, b1, b2].some((v) => v == null)) return false;
  return a1 < b2 && b1 < a2;
}

// --- Disponibilité d'un professeur ---
// Une indisponibilité datée (congé, mission) prime sur le motif hebdomadaire.
export function isUnavailableOn(teacher, dateISO) {
  return (teacher?.unavailable || []).some((u) => {
    const from = u.from || u.to, to = u.to || u.from;
    return from && to && dateISO >= from && dateISO <= to;
  });
}
// Le créneau tient-il ENTIÈREMENT dans une plage déclarée ce jour-là ?
// Un cours à cheval sur la fin de disponibilité est une erreur, pas un demi-succès.
export function withinAvailability(teacher, dateISO, start, end) {
  if (isUnavailableOn(teacher, dateISO)) return false;
  const day = dayKeyOf(dateISO);
  const ranges = teacher?.availability?.[day];
  // Deux silences à ne pas confondre :
  //  - jour absent de la fiche  → non renseigné, aucune contrainte connue, on laisse passer ;
  //  - jour présent mais vide   → déclaration explicite « je ne suis pas là », on bloque.
  // Les assimiler rendrait la saisie « lundi : rien » sans effet, donc trompeuse.
  if (!Array.isArray(ranges)) return true;
  if (!ranges.length) return false;
  const s = toMin(start), e = toMin(end);
  if (s == null || e == null) return false;
  return ranges.some((r) => {
    const a = toMin(r?.[0]), b = toMin(r?.[1]);
    return a != null && b != null && s >= a && e <= b;
  });
}

// --- Conflits ---
// `ctx` fournit ce que la séance ne porte pas : { teacher, room, klass, module, amplitude }
// Renvoie une liste ordonnée : les blocages d'abord, les alertes ensuite.
export function conflictsFor(session, others = [], ctx = {}) {
  const out = [];
  const push = (level, code, message) => out.push({ level, code, message });

  const s = toMin(session?.start), e = toMin(session?.end);
  if (s == null || e == null) { push("block", "horaire", "Horaires invalides."); return out; }
  if (e <= s) { push("block", "horaire", "L'heure de fin précède l'heure de début."); return out; }

  const amp = ctx.amplitude || { start: "07:00", end: "22:00" };
  if (s < toMin(amp.start) || e > toMin(amp.end)) {
    push("block", "amplitude", `Hors de l'amplitude d'ouverture (${amp.start}–${amp.end}).`);
  }

  // Un déplacement compare la séance à toutes les autres SAUF elle-même.
  const rivals = others.filter((o) => o && o.id !== session.id && o.status !== "cancelled" && overlaps(o, session));
  for (const [key, label] of [["teacherId", "Le professeur"], ["roomId", "La salle"], ["classId", "La classe"]]) {
    if (!session[key]) continue;
    const clash = rivals.find((o) => o[key] === session[key]);
    if (clash) push("block", key, `${label} a déjà cours de ${clash.start} à ${clash.end}.`);
  }

  if (ctx.teacher && !withinAvailability(ctx.teacher, session.date, session.start, session.end)) {
    const reason = isUnavailableOn(ctx.teacher, session.date) ? "est indisponible ce jour-là" : "n'a pas déclaré être disponible sur ce créneau";
    push("block-forcable", "disponibilite", `${ctx.teacher.name || "Le professeur"} ${reason}.`);
  }

  // Calendrier : vacances, fériés, examens, stage de la classe.
  const kind = session.kind || "cours";
  for (const p of periodsOn(session.date, ctx.periods, session.classId)) {
    if (p.kind === "vacances" || p.kind === "ferie") {
      // Forçable : un rattrapage pendant les vacances est rare mais légitime.
      push("block-forcable", "calendrier", `${PERIOD_KINDS[p.kind]}${p.label ? ` — ${p.label}` : ""} du ${p.from} au ${p.to}.`);
    } else if (p.kind === "examens" && kind !== "examen") {
      push("block-forcable", "calendrier", `Période d'examens${p.label ? ` (${p.label})` : ""} : seules les épreuves y sont attendues.`);
    } else if (p.kind === "stage" || p.kind === "entreprise") {
      const quoi = p.kind === "stage" ? "en stage" : "en entreprise";
      push("block-forcable", "calendrier", `La classe est ${quoi} du ${p.from} au ${p.to}.`);
    }
  }

  const places = ctx.room?.places, size = ctx.classSize;
  if (places != null && size != null && size > places) {
    push("warn", "capacite", `Salle de ${places} places pour ${size} inscrits.`);
  }
  // Spécificité de salle : un TP d'optique sans banc d'optique n'a pas lieu.
  // Le module déclare ce qu'il exige, la salle ce qu'elle offre.
  const need = ctx.module?.requiresRoom;
  if (need && ctx.room) {
    const has = [ctx.room.kind, ...(ctx.room.equipment || [])].filter(Boolean).map((x) => String(x).toLowerCase());
    if (!has.includes(String(need).toLowerCase())) {
      push("block-forcable", "salle-equipement", `« ${ctx.module.label || ctx.module.code} » demande une salle « ${need} » — ${ctx.room.name || "cette salle"} ne l'est pas.`);
    }
  }
  if (ctx.teacher && ctx.module && Array.isArray(ctx.teacher.subjects) && ctx.teacher.subjects.length) {
    const known = ctx.teacher.subjects.some((x) => String(x).toLowerCase() === String(ctx.module.label || "").toLowerCase()
      || String(x).toLowerCase() === String(ctx.module.code || "").toLowerCase());
    if (!known) push("warn", "matiere", `${ctx.teacher.name || "Ce professeur"} n'est pas déclaré sur « ${ctx.module.label || ctx.module.code} ».`);
  }

  const rank = { block: 0, "block-forcable": 1, warn: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
export const isBlocking = (c) => c.level === "block";
export const hasHardBlock = (list) => (list || []).some(isBlocking);

// --- Couverture du référentiel ---
// Le calcul qu'aucun éditeur du marché ne fait : les heures posées couvriront-elles
// le volume dû, et sinon à partir de quand est-ce mathématiquement perdu ?
// `year` restreint aux modules de l'année suivie : un référentiel décrit tout le
// diplôme, mais une promotion de 1re année n'est comptable que de sa propre année.
// Sans ce filtre, une classe affichait 27 % de couverture alors qu'elle était à jour.
// `weeks` = nombre de semaines de cours de la classe (moitié en alternance). Il sert
// a convertir la maquette hebdomadaire en volume annuel du, sans quoi une formation
// decrite en heures/semaine afficherait un du a zero.
export function coverage(curriculum, sessions = [], { today, endDate, year, weeks = 36 } = {}) {
  let mods = curriculum?.modules || [];
  if (year != null) mods = mods.filter((m) => m.year == null || Number(m.year) === Number(year));
  const byModule = new Map();
  for (const s of sessions) {
    if (!s || s.status === "cancelled" || !s.moduleId) continue;
    const cur = byModule.get(s.moduleId) || { planned: 0, done: 0 };
    const h = hoursOf(s);
    cur.planned += h;
    if (s.status === "done") cur.done += h;
    byModule.set(s.moduleId, cur);
  }
  const rows = mods.map((m) => {
    const got = byModule.get(m.id) || { planned: 0, done: 0 };
    const due = m.heuresSemaine != null ? round2(Number(m.heuresSemaine) * weeks)
              : (m.heures == null ? 0 : Number(m.heures) || 0);
    const gap = round2(due - got.planned);
    return {
      moduleId: m.id, code: m.code, label: m.label, due,
      planned: round2(got.planned), done: round2(got.done),
      gap,                                   // >0 = heures encore à poser
      pct: due ? Math.round((got.planned / due) * 100) : null,
      donePct: due ? Math.round((got.done / due) * 100) : null,
      atRisk: gap > 0 && !!endDate && !!today && today <= endDate
        ? gap > weeksBetween(today, endDate) * 8   // 8 h/semaine = rythme max réaliste par module
        : false,
    };
  });
  const due = rows.reduce((a, r) => a + r.due, 0);
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  const done = rows.reduce((a, r) => a + r.done, 0);
  return {
    rows,
    total: { due: round2(due), planned: round2(planned), done: round2(done), gap: round2(due - planned),
             pct: due ? Math.round((planned / due) * 100) : null },
  };
}

// --- Service d'un professeur ---
// Heures dues au contrat vs posées vs réalisées, et les deux plafonds légaux.
export function serviceOf(teacher, sessions = [], limits = SERVICE_LIMITS) {
  const mine = sessions.filter((s) => s && s.teacherId === teacher?.id && s.status !== "cancelled");
  const planned = mine.reduce((a, s) => a + hoursOf(s), 0);
  const done = mine.filter((s) => s.status === "done").reduce((a, s) => a + hoursOf(s), 0);
  const due = teacher?.heuresAnnuelles == null ? null : Number(teacher.heuresAnnuelles) || 0;
  const overtime = due == null ? 0 : Math.max(0, round2(planned - due));

  // Semaine la plus chargée : c'est elle qui déclenche le plafond hebdomadaire.
  const byWeek = new Map();
  for (const s of mine) {
    const k = isoWeekKey(s.date);
    if (!k) continue;
    byWeek.set(k, round2((byWeek.get(k) || 0) + hoursOf(s)));
  }
  let peakWeek = null, peakHours = 0;
  for (const [k, h] of byWeek) if (h > peakHours) { peakHours = h; peakWeek = k; }

  const flags = [];
  if (peakHours > limits.weeklyMaxHours) {
    flags.push({ level: "high", code: "hebdo", message: `${peakHours} h posées sur la semaine ${peakWeek} — plafond ${limits.weeklyMaxHours} h.` });
  }
  if (overtime > limits.overtimeYearMax) {
    flags.push({ level: "high", code: "hsupp", message: `${overtime} h supplémentaires engagées — plafond annuel ${limits.overtimeYearMax} h.` });
  } else if (overtime > limits.overtimeYearMax * 0.8) {
    flags.push({ level: "medium", code: "hsupp", message: `${overtime} h supplémentaires — on approche du plafond de ${limits.overtimeYearMax} h.` });
  }
  if (due != null && due > 0 && planned < due * 0.8) {
    flags.push({ level: "low", code: "sous-service", message: `${round2(planned)} h posées pour ${due} h dues.` });
  }

  return {
    teacherId: teacher?.id, name: teacher?.name || "",
    due, planned: round2(planned), done: round2(done), overtime,
    peakWeek, peakHours: round2(peakHours),
    cost: teacher?.tauxHoraire == null ? null : round2(planned * (Number(teacher.tauxHoraire) || 0)),
    flags,
  };
}

// Écart de charge entre professeurs d'un même campus : une moyenne cache un
// déséquilibre, l'écart-type le montre.
export function equity(services = []) {
  const vals = services.map((s) => s.planned).filter((v) => v > 0);
  if (vals.length < 2) return { count: vals.length, mean: vals[0] ? round2(vals[0]) : 0, stdev: 0, spread: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const stdev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { count: vals.length, mean: round2(mean), stdev: round2(stdev), spread: round2(Math.max(...vals) - Math.min(...vals)) };
}

// --- Récurrence ---
// Matérialise N séances hebdomadaires, en sautant les périodes non travaillées.
// `periods` = le calendrier du campus : on saute vacances, fériés et stages de la
// classe. Les périodes d'examens ne sont PAS sautées (on peut vouloir y poser des
// épreuves) — c'est la détection de conflits qui avertit au cas par cas.
export function expandWeekly(base, untilISO, periods = []) {
  const out = [];
  if (!base?.date || !untilISO) return out;
  const closed = (periods || []).filter((p) => p && p.from && p.to
    && ["vacances", "ferie", "stage", "entreprise"].includes(p.kind)
    && (!p.classId || !base.classId || p.classId === base.classId));
  let d = new Date(`${base.date}T12:00:00Z`);
  const end = new Date(`${untilISO}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  let guard = 0;
  while (d <= end && guard++ < 400) {          // garde-fou : 400 semaines max
    const iso = d.toISOString().slice(0, 10);
    if (!closed.some((p) => iso >= p.from && iso <= p.to)) out.push({ ...base, date: iso });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

// --- Utilitaires ---
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function weeksBetween(a, b) {
  const d1 = new Date(`${a}T12:00:00Z`), d2 = new Date(`${b}T12:00:00Z`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.round((d2 - d1) / (7 * 86400000)));
}
// Clé de semaine ISO ("2026-S37") pour agréger la charge hebdomadaire.
export function isoWeekKey(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));   // jeudi de la semaine
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}

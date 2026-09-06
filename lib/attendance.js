// Émargement — logique pure (aucune I/O), testable sans serveur.
//
// CE QUI EST EN JEU : la feuille d'émargement est la preuve de réalisation de
// l'action de formation. C'est elle que le financeur contrôle, et c'est sur elle
// que se calcule le prorata d'assiduité de la facturation. Une feuille modifiable
// après coup sans trace ne vaut rien devant un contrôle.
//
// LE MÉCANISME : une feuille close est figée puis CHAÎNÉE — son empreinte inclut
// l'empreinte de la feuille close précédente du même campus. Modifier une feuille
// ancienne casse toutes les empreintes suivantes, ce qui est détectable par un
// simple recalcul. Une correction légitime ne réécrit donc jamais la feuille : elle
// ajoute un avenant, lui-même chaîné et horodaté.

import crypto from "crypto";

export const ATTENDANCE_STATUSES = ["present", "absent", "retard", "excuse"];
export const STATUS_LABEL = { present: "Présent", absent: "Absent", retard: "Retard", excuse: "Absence excusée" };

// Modes de recueil de la présence, par ordre de force probante décroissante.
export const SIGN_MODES = ["signature", "code", "declaratif"];

export const GENESIS_HASH = "0".repeat(64);

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// Sérialisation canonique : clés triées, aucun espace, pour qu'une même feuille
// donne toujours la même empreinte quel que soit l'ordre d'écriture des champs.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

// Les champs qui engagent la preuve. Tout le reste (libellés d'affichage, noms
// recopiés) est volontairement exclu : seul le fond est scellé.
export function sheetPayload(sheet) {
  return {
    campusId: sheet.campusId || null,
    sessionId: sheet.sessionId || null,
    date: sheet.date || "",
    start: sheet.start || "",
    end: sheet.end || "",
    classId: sheet.classId || null,
    teacherId: sheet.teacherId || null,
    signMode: sheet.signMode || "declaratif",
    lockedAt: sheet.lockedAt || "",
    lockedBy: sheet.lockedBy || "",
    seq: sheet.seq ?? null,
    entries: (sheet.entries || [])
      .map((e) => ({
        learnerId: e.learnerId || null,
        status: e.status || "",
        minutesLate: Number(e.minutesLate) || 0,
        justified: !!e.justified,
        reason: String(e.reason || ""),
        signedAt: e.signedAt || "",
        // L'empreinte du tracé, pas le tracé lui-même : une image de 30 Ko par
        // élève n'a pas à transiter dans le calcul, son empreinte suffit à prouver
        // qu'elle n'a pas changé.
        signatureHash: e.signatureHash || "",
      }))
      .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId))),
    amendments: (sheet.amendments || []).map((a) => ({
      at: a.at || "", by: a.by || "", learnerId: a.learnerId || null,
      from: a.from || "", to: a.to || "", reason: String(a.reason || ""),
    })),
  };
}

export function hashSheet(sheet, prevHash) {
  return sha256((prevHash || GENESIS_HASH) + "|" + canonical(sheetPayload(sheet)));
}

export const hashSignature = (dataUri) => (dataUri ? sha256(String(dataUri)) : "");

// Vérifie une chaîne complète (feuilles closes d'un campus, ordonnées par seq).
// Renvoie le premier maillon rompu s'il y en a un — c'est le rapport qu'on montre
// au contrôleur, et celui qui alerte si quelqu'un a touché au fichier.
export function verifyChain(sheets = []) {
  const ordered = sheets.slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let prev = GENESIS_HASH;
  for (const s of ordered) {
    if ((s.prevHash || GENESIS_HASH) !== prev) {
      return { ok: false, brokenAt: s.id, seq: s.seq, reason: "maillon précédent incohérent" };
    }
    const expected = hashSheet(s, prev);
    if (s.hash !== expected) {
      return { ok: false, brokenAt: s.id, seq: s.seq, reason: "contenu modifié après clôture" };
    }
    prev = s.hash;
  }
  return { ok: true, count: ordered.length, lastHash: prev };
}

// Durée d'une séance en minutes (les horaires sont en "HH:MM").
export function sessionMinutes(sheet) {
  const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(sheet.start), b = toMin(sheet.end);
  return a != null && b != null && b > a ? b - a : 0;
}

// Synthèse d'une feuille : effectifs par statut et minutes d'absence réellement
// constatées — c'est cette valeur qui alimentera le prorata de facturation.
export function sheetStats(sheet) {
  const dur = sessionMinutes(sheet);
  const st = { present: 0, absent: 0, retard: 0, excuse: 0 };
  let absentMinutes = 0, unjustifiedMinutes = 0;
  for (const e of sheet.entries || []) {
    if (st[e.status] !== undefined) st[e.status]++;
    if (e.status === "absent" || e.status === "excuse") {
      absentMinutes += dur;
      if (!e.justified && e.status === "absent") unjustifiedMinutes += dur;
    } else if (e.status === "retard") {
      const late = Math.min(Number(e.minutesLate) || 0, dur);
      absentMinutes += late;
      if (!e.justified) unjustifiedMinutes += late;
    }
  }
  const total = (sheet.entries || []).length;
  const plannedMinutes = dur * total;
  return {
    durationMinutes: dur, total, ...st, absentMinutes, unjustifiedMinutes, plannedMinutes,
    attendanceRate: plannedMinutes > 0 ? Math.round(((plannedMinutes - absentMinutes) / plannedMinutes) * 1000) / 10 : null,
  };
}

// Agrégat sur une période (rapport financeur, prorata de facturation).
export function periodStats(sheets = []) {
  let planned = 0, absent = 0, unjustified = 0, signed = 0;
  for (const s of sheets) {
    const st = sheetStats(s);
    planned += st.plannedMinutes;
    absent += st.absentMinutes;
    unjustified += st.unjustifiedMinutes;
    if (s.status === "locked") signed++;
  }
  return {
    sheets: sheets.length, lockedSheets: signed,
    plannedMinutes: planned, absentMinutes: absent, unjustifiedMinutes: unjustified,
    realizedMinutes: Math.max(0, planned - absent),
    attendanceRate: planned > 0 ? Math.round(((planned - absent) / planned) * 1000) / 10 : null,
  };
}

// Code de séance : 6 caractères sans ambiguïté visuelle (ni 0/O ni 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateSessionCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Notes et bulletins — logique pure (aucune I/O), testable sans serveur.
//
// Les règles de calcul sont l'endroit où un ERP scolaire se trompe silencieusement :
// une absence comptée comme un zéro fait perdre une année à un élève, un rattrapage
// mal pris en compte fausse un jury. Tout est donc explicite ici, et testé.

export const ASSESSMENT_TYPES = { devoir: "Devoir", examen: "Examen", tp: "TP", oral: "Oral", projet: "Projet", ccf: "CCF" };

// BLOCS DE COMPÉTENCES — la logique de certification, distincte de la logique scolaire.
//
// Un titre ou diplôme inscrit au RNCP se valide PAR BLOC, sans compensation entre
// blocs : une excellente moyenne en optique ne rattrape pas un bloc d'anglais non
// acquis. Chaque bloc est capitalisable et se conserve. Une moyenne générale
// compensée ne dit donc RIEN sur ce qu'il reste à valider — c'est une logique de
// lycée, et l'appliquer à un CFA induit l'apprenti en erreur sur sa certification.
export const BLOCK_STATUSES = ["acquis", "non_acquis", "en_cours"];
export const BLOCK_LABEL = { acquis: "Acquis", non_acquis: "Non acquis", en_cours: "En cours" };

// Seuil de validation d'un bloc. Paramétrable : certaines certifications exigent
// davantage, et une note éliminatoire peut bloquer indépendamment de la moyenne.
export const SEUIL_VALIDATION_BLOC = 10;

// Une absence n'est PAS un zéro : elle sort du calcul tant qu'elle n'est pas
// convertie en note (rattrapage) ou explicitement sanctionnée par l'équipe.
export function isCounted(grade) {
  if (!grade) return false;
  if (grade.absent && !grade.zeroSiAbsent) return false;
  return grade.score != null && grade.score !== "";
}

// Note ramenée sur 20 (un devoir sur 40 ou sur 10 ne doit pas peser faux).
export function normalized(grade, assessment) {
  const max = Number(assessment?.maxScore) || 20;
  const raw = grade.absent && grade.zeroSiAbsent ? 0 : Number(grade.score);
  if (!Number.isFinite(raw) || max <= 0) return null;
  return (raw / max) * 20;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Moyenne pondérée par coefficient. Renvoie null si aucune note ne compte —
// « pas de note » et « zéro » sont deux choses différentes.
export function weightedAverage(entries) {
  let sum = 0, weight = 0;
  for (const { value, coefficient } of entries) {
    if (value == null) continue;
    const c = Number(coefficient);
    const w = Number.isFinite(c) && c >= 0 ? c : 1;
    if (w === 0) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? round2(sum / weight) : null;
}

// Moyenne d'un apprenant par matière, puis moyenne générale.
// `assessments` et `grades` sont bruts ; le regroupement se fait ici.
export function learnerReport({ learnerId, assessments = [], grades = [], modules = [], from = null, to = null }) {
  // Filtre de période : un « bulletin du 1er semestre » était impossible, tout
  // l'historique entrait systématiquement dans le calcul.
  const retenues = (from || to) ? assessments.filter((a) => {
    const d = a.date || "";
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return true;
  }) : assessments;
  const byAssessment = new Map(retenues.map((a) => [a.id, a]));
  const mine = grades.filter((g) => g.learnerId === learnerId);
  const perModule = new Map();

  for (const g of mine) {
    const a = byAssessment.get(g.assessmentId);
    if (!a) continue;
    const key = a.moduleId || "_autres";
    const bucket = perModule.get(key) || { moduleId: a.moduleId || null, entries: [], absences: 0, count: 0 };
    if (!isCounted(g)) {
      if (g.absent) bucket.absences++;
    } else {
      const v = normalized(g, a);
      if (v != null) { bucket.entries.push({ value: v, coefficient: a.coefficient, label: a.label, date: a.date, raw: g.score, max: a.maxScore }); bucket.count++; }
    }
    perModule.set(key, bucket);
  }

  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const rows = [...perModule.values()].map((b) => {
    const mod = b.moduleId ? moduleById.get(b.moduleId) : null;
    return {
      moduleId: b.moduleId,
      label: mod?.label || (b.moduleId ? "Matière inconnue" : "Autres évaluations"),
      code: mod?.code || "",
      coefficient: Number(mod?.coefficient) || 1,
      average: weightedAverage(b.entries),
      count: b.count, absences: b.absences,
      details: b.entries,
    };
  }).sort((a, b) => (a.code || a.label).localeCompare(b.code || b.label));

  const general = weightedAverage(rows.map((r) => ({ value: r.average, coefficient: r.coefficient })));
  return { learnerId, modules: rows, average: general, mention: mention(general) };
}

// Agrège les matières par bloc de compétences et statue bloc par bloc.
// `blocks` = [{ id, code, label, moduleIds[], seuil?, noteEliminatoire? }].
export function blockReport({ modules = [], blocks = [], seuil = SEUIL_VALIDATION_BLOC }) {
  return blocks.map((b) => {
    const membres = modules.filter((m) => (b.moduleIds || []).includes(m.moduleId));
    const moyenne = weightedAverage(membres.map((m) => ({ value: m.average, coefficient: m.coefficient })));
    const seuilBloc = Number(b.seuil) || seuil;
    // Une note éliminatoire bloque l'acquisition, quelle que soit la moyenne.
    const elimine = b.noteEliminatoire != null
      && membres.some((m) => m.average != null && m.average < Number(b.noteEliminatoire));
    let status = "en_cours";
    if (moyenne != null) status = elimine || moyenne < seuilBloc ? "non_acquis" : "acquis";
    return {
      blocId: b.id, code: b.code || "", label: b.label || "Bloc",
      moyenne, seuil: seuilBloc, status, elimine,
      matieres: membres.map((m) => ({ moduleId: m.moduleId, label: m.label, average: m.average })),
      evaluees: membres.filter((m) => m.average != null).length,
      total: membres.length,
    };
  });
}

// Synthèse de certification : ce qu'il reste à valider. C'est la seule information
// que l'apprenti et le jury attendent réellement.
export function certificationSummary(blocs = []) {
  const acquis = blocs.filter((b) => b.status === "acquis");
  const nonAcquis = blocs.filter((b) => b.status === "non_acquis");
  return {
    total: blocs.length,
    acquis: acquis.length,
    nonAcquis: nonAcquis.length,
    enCours: blocs.filter((b) => b.status === "en_cours").length,
    // Le titre complet suppose TOUS les blocs acquis : aucune compensation.
    titreComplet: blocs.length > 0 && acquis.length === blocs.length,
    resteAValider: nonAcquis.concat(blocs.filter((b) => b.status === "en_cours")).map((b) => b.code || b.label),
  };
}

export function mention(avg) {
  if (avg == null) return null;
  if (avg >= 16) return "Très bien";
  if (avg >= 14) return "Bien";
  if (avg >= 12) return "Assez bien";
  if (avg >= 10) return "Passable";
  return "Insuffisant";
}

// Statistiques de classe pour une matière : moyenne, min, max — le contexte sans
// lequel un 11/20 ne veut rien dire.
export function classStats(values = []) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return { average: round2(sum / vals.length), min: round2(Math.min(...vals)), max: round2(Math.max(...vals)), count: vals.length };
}

// Rang d'un apprenant dans sa classe (ex aequo partagent le même rang).
export function ranking(reports = []) {
  const withAvg = reports.filter((r) => r.average != null).sort((a, b) => b.average - a.average);
  const ranks = new Map();
  withAvg.forEach((r, i) => {
    if (i > 0 && withAvg[i - 1].average === r.average) ranks.set(r.learnerId, ranks.get(withAvg[i - 1].learnerId));
    else ranks.set(r.learnerId, i + 1);
  });
  return { ranks, total: withAvg.length };
}

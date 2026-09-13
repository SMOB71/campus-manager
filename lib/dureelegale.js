// Durées légales du travail appliquées à un emploi du temps — logique pure.
//
// POURQUOI UN EMPLOI DU TEMPS DE CFA RELÈVE DU DROIT DU TRAVAIL — le temps passé
// en centre de formation est du TEMPS DE TRAVAIL EFFECTIF pour un apprenti. Ce
// n'est pas du temps scolaire. Les durées maximales, les repos et les pauses s'y
// appliquent donc pleinement, et c'est la grille horaire du CFA qui peut mettre
// l'apprenti — et l'organisme — en infraction. Un logiciel de planning qui
// ignore ce point fabrique des infractions à la place de son utilisateur.
//
// TROIS PARTIS PRIS QUI DÉCOULENT DE LÀ :
//
//   1. UN DÉPASSEMENT LÉGAL BLOQUE, IL NE S'AVERTIT PAS. Un avertissement
//      « forçable » sur une limite d'ordre public est une invitation à passer
//      outre. Seule une DÉROGATION ENREGISTRÉE — avec sa référence — ouvre le
//      passage, parce que c'est exactement ce que la loi prévoit et rien d'autre.
//
//   2. LA RÈGLE APPLICABLE À UNE CLASSE EST CELLE DU PLUS JEUNE INSCRIT. Un seul
//      apprenti de dix-sept ans plafonne la journée de toute la classe à huit
//      heures. Raisonner sur une moyenne d'âge n'aurait aucun sens juridique.
//
//   3. LE CFA NE VOIT QUE SES PROPRES HEURES. Les huit heures quotidiennes sont
//      un total : centre de formation ET entreprise. Un planning de 7 h en
//      centre n'est donc pas « conforme », il est seulement conforme POUR LA
//      PART QUE NOUS CONNAISSONS. Le module le dit au lieu de le laisser croire.
//
// Références vérifiées le 13 septembre 2026 sur legifrance.gouv.fr et
// code.travail.gouv.fr. ⚠️ À revérifier à chaque évolution : les durées des
// jeunes travailleurs ont déjà été assouplies par dérogation sectorielle.

const jour = 864e5;
export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dateMin = (dateISO, hhmm) => new Date(dateISO + "T00:00:00Z").getTime() + (toMin(hhmm) || 0) * 60000;

// Âge révolu à une date donnée.
export function ageA(dateNaissance, dateRef) {
  if (!dateNaissance || !dateRef) return null;
  const n = new Date(dateNaissance + "T00:00:00Z"), r = new Date(dateRef + "T00:00:00Z");
  if (isNaN(n) || isNaN(r)) return null;
  let a = r.getUTCFullYear() - n.getUTCFullYear();
  const m = r.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < n.getUTCDate())) a--;
  return a;
}

// Régimes. Les jeunes travailleurs de moins de seize ans ont un repos quotidien
// plus long (14 h) : la distinction n'est pas cosmétique, elle change la grille.
export const REGIMES = {
  adulte: {
    label: "Salarié majeur",
    maxJour: 10 * 60,          // art. L. 3121-18
    maxSemaine: 48 * 60,       // art. L. 3121-20 (maximum absolu)
    maxSemaineMoyenne: 44 * 60, // art. L. 3121-22, sur 12 semaines consécutives
    reposQuotidien: 11 * 60,   // art. L. 3131-1
    reposHebdo: 35 * 60,       // art. L. 3132-2 (24 h + 11 h)
    travailContinuMax: 6 * 60, // art. L. 3121-16
    pauseMin: 20,
    nuitDebut: null, nuitFin: null,
  },
  mineur: {
    label: "Jeune travailleur de 16 à 18 ans",
    maxJour: 8 * 60,           // art. L. 3162-1 et L. 6222-25
    maxSemaine: 35 * 60,       // durée légale, art. L. 3121-27
    maxSemaineMoyenne: null,
    reposQuotidien: 12 * 60,   // art. L. 3164-1
    reposHebdo: 48 * 60,       // art. L. 3164-2 : deux jours consécutifs
    travailContinuMax: 4.5 * 60, // art. L. 3162-3
    pauseMin: 30,
    nuitDebut: 22 * 60, nuitFin: 6 * 60, // art. L. 3163-1
  },
  mineurDeSeize: {
    label: "Jeune travailleur de moins de 16 ans",
    maxJour: 8 * 60,
    maxSemaine: 35 * 60,
    maxSemaineMoyenne: null,
    reposQuotidien: 14 * 60,   // art. L. 3164-1
    reposHebdo: 48 * 60,
    travailContinuMax: 4.5 * 60,
    pauseMin: 30,
    nuitDebut: 20 * 60, nuitFin: 6 * 60, // art. L. 3163-2
  },
};

export function regimePour(age) {
  if (age == null) return REGIMES.adulte;      // âge inconnu : on ne peut pas inventer une protection
  if (age < 16) return REGIMES.mineurDeSeize;
  if (age < 18) return REGIMES.mineur;
  return REGIMES.adulte;
}

// Régime applicable à un GROUPE : celui du plus jeune. Une classe où figure un
// mineur suit les règles des mineurs, pour tout le monde et toute la journée.
export function regimeDuGroupe(naissances = [], dateRef) {
  const ages = naissances.map((n) => ageA(n, dateRef)).filter((a) => a != null);
  if (!ages.length) return { regime: REGIMES.adulte, age: null, ageInconnu: true };
  const min = Math.min(...ages);
  return { regime: regimePour(min), age: min, ageInconnu: naissances.some((n) => !n) };
}

// La dérogation de l'article L. 6222-25 : cinq heures hebdomadaires au plus,
// accordées par l'inspecteur du travail APRÈS AVIS CONFORME du médecin du
// travail. Elle ne s'invente pas : sans référence enregistrée, elle n'existe pas.
export const DEROGATION_MAX_SEMAINE = 5 * 60;
export function derogationValide(d) {
  return !!(d && d.reference && d.dateDecision && d.avisMedecin);
}

const isoJour = (ms) => new Date(ms).toISOString().slice(0, 10);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const heures = (min) => (min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

// Regroupe les séances par journée et calcule, pour chacune, la durée totale et
// la plus longue période de travail ININTERROMPUE (deux séances séparées de
// moins que la pause minimale forment une seule période continue).
export function journees(seances = [], pauseMin = 20) {
  const parJour = new Map();
  for (const s of seances) {
    if (!s?.date || toMin(s.start) == null || toMin(s.end) == null) continue;
    if (!parJour.has(s.date)) parJour.set(s.date, []);
    parJour.get(s.date).push(s);
  }
  const out = [];
  for (const [date, liste] of parJour) {
    liste.sort((a, b) => toMin(a.start) - toMin(b.start));
    let total = 0, continuMax = 0, continu = 0, finPrec = null, pauses = [];
    for (const s of liste) {
      const d = toMin(s.start), f = toMin(s.end);
      const duree = Math.max(0, f - d);
      total += duree;
      if (finPrec != null) {
        const ecart = d - finPrec;
        if (ecart >= pauseMin) { pauses.push(ecart); continuMax = Math.max(continuMax, continu); continu = 0; }
        else if (ecart > 0) continu += ecart;   // interruption trop courte : le travail reste continu
      }
      continu += duree;
      finPrec = Math.max(finPrec ?? 0, f);
    }
    continuMax = Math.max(continuMax, continu);
    out.push({
      date, total, continuMax, pauses,
      debut: toMin(liste[0].start),
      fin: Math.max(...liste.map((s) => toMin(s.end))),
      seances: liste.length,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const lundiDe = (dateISO) => {
  const d = new Date(dateISO + "T00:00:00Z");
  const j = (d.getUTCDay() + 6) % 7;          // 0 = lundi
  return isoJour(d.getTime() - j * jour);
};

// Contrôle complet. `seances` doit contenir la séance envisagée ET les autres
// séances de la personne ou du groupe sur la période — une durée quotidienne ne
// se juge pas sur une séance isolée.
export function controler({ seances = [], naissances = [], dateRef = null, derogation = null, contexte = "groupe" } = {}) {
  const ref = dateRef || seances[0]?.date || null;
  const { regime, age, ageInconnu } = regimeDuGroupe(naissances, ref);
  const out = [];
  const bloque = (code, message, article) => out.push({ level: "block", code, message, article, regime: regime.label });
  const alerte = (code, message, article) => out.push({ level: "warn", code, message, article, regime: regime.label });

  const jrs = journees(seances, regime.pauseMin);

  for (const j of jrs) {
    // Durée quotidienne
    if (j.total > regime.maxJour) {
      bloque("duree_jour", `${heures(j.total)} le ${j.date} : au-delà du maximum de ${heures(regime.maxJour)} (${regime.label.toLowerCase()}).`,
        regime === REGIMES.adulte ? "L. 3121-18" : "L. 3162-1 et L. 6222-25");
    }
    // Période de travail ininterrompue et pause
    if (j.continuMax > regime.travailContinuMax) {
      bloque("pause", `${heures(j.continuMax)} de travail sans interruption le ${j.date} : une pause d'au moins ${regime.pauseMin} min est due au-delà de ${heures(regime.travailContinuMax)}.`,
        regime === REGIMES.adulte ? "L. 3121-16" : "L. 3162-3");
    }
    // Travail de nuit — interdit aux mineurs, sans forçage possible.
    if (regime.nuitDebut != null) {
      if (j.fin > regime.nuitDebut || j.debut < regime.nuitFin) {
        bloque("nuit", `Séance entre ${hhmm(regime.nuitDebut)} et ${hhmm(regime.nuitFin)} le ${j.date} : le travail de nuit est interdit aux mineurs.`,
          regime === REGIMES.mineurDeSeize ? "L. 3163-2" : "L. 3163-1");
      }
    }
  }

  // Repos quotidien : entre la fin d'une journée et le début de la suivante.
  for (let i = 1; i < jrs.length; i++) {
    const finPrec = dateMin(jrs[i - 1].date, hhmm(jrs[i - 1].fin));
    const debut = dateMin(jrs[i].date, hhmm(jrs[i].debut));
    const repos = Math.round((debut - finPrec) / 60000);
    if (repos < regime.reposQuotidien) {
      bloque("repos_quotidien", `${heures(repos)} entre la fin du ${jrs[i - 1].date} et le début du ${jrs[i].date} : le repos quotidien est de ${heures(regime.reposQuotidien)} consécutives.`,
        regime === REGIMES.adulte ? "L. 3131-1" : "L. 3164-1");
    }
  }

  // Durée hebdomadaire et repos hebdomadaire, semaine civile par semaine civile.
  const semaines = new Map();
  for (const j of jrs) {
    const k = lundiDe(j.date);
    if (!semaines.has(k)) semaines.set(k, []);
    semaines.get(k).push(j);
  }
  const totauxSemaine = [];
  for (const [lundi, liste] of semaines) {
    const total = liste.reduce((s, j) => s + j.total, 0);
    totauxSemaine.push({ lundi, total });
    const plafond = regime.maxSemaine + (derogationValide(derogation) ? Math.min(derogation.heuresHebdo * 60 || 0, DEROGATION_MAX_SEMAINE) : 0);
    if (total > plafond) {
      const mention = derogationValide(derogation) ? ` (dérogation ${derogation.reference} comprise)` : "";
      bloque("duree_semaine", `${heures(total)} sur la semaine du ${lundi} : au-delà de ${heures(plafond)}${mention}.`,
        regime === REGIMES.adulte ? "L. 3121-20" : "L. 3162-1");
    }

    // Repos hebdomadaire : le plus long intervalle sans séance dans la semaine.
    const jours = liste.map((j) => j.date).sort();
    let reposMax = 0;
    for (let i = 1; i < jours.length; i++) {
      const fin = dateMin(jours[i - 1], hhmm(liste.find((x) => x.date === jours[i - 1]).fin));
      const deb = dateMin(jours[i], hhmm(liste.find((x) => x.date === jours[i]).debut));
      reposMax = Math.max(reposMax, Math.round((deb - fin) / 60000));
    }
    // Et l'intervalle qui borde la semaine, si elle n'est pas pleine.
    if (jours.length < 7) reposMax = Math.max(reposMax, (7 - jours.length) * 24 * 60);
    if (reposMax < regime.reposHebdo) {
      bloque("repos_hebdo", `Repos hebdomadaire le plus long : ${heures(reposMax)} sur la semaine du ${lundi}, au lieu de ${heures(regime.reposHebdo)}.`,
        regime === REGIMES.adulte ? "L. 3132-2" : "L. 3164-2");
    }
  }

  // Une dérogation invoquée sans pièce se signale TOUJOURS, qu'elle ait ou non
  // servi à franchir un plafond. La taire quand la semaine bloque déjà
  // laisserait croire qu'il suffit de réduire les heures pour être en règle.
  if (derogation && !derogationValide(derogation)) {
    alerte("derogation_incomplete",
      "Une dérogation est invoquée sans référence, date de décision ou avis conforme du médecin du travail : elle ne peut être opposée à personne.",
      "L. 6222-25");
  }

  // Moyenne sur 12 semaines consécutives (majeurs uniquement).
  if (regime.maxSemaineMoyenne && totauxSemaine.length >= 12) {
    totauxSemaine.sort((a, b) => a.lundi.localeCompare(b.lundi));
    for (let i = 0; i + 12 <= totauxSemaine.length; i++) {
      const fenetre = totauxSemaine.slice(i, i + 12);
      const moy = fenetre.reduce((s, x) => s + x.total, 0) / 12;
      if (moy > regime.maxSemaineMoyenne) {
        bloque("moyenne_12_semaines", `Moyenne de ${heures(Math.round(moy))} par semaine sur les 12 semaines à partir du ${fenetre[0].lundi} : au-delà de ${heures(regime.maxSemaineMoyenne)}.`, "L. 3121-22");
        break;
      }
    }
  }

  return {
    regime: regime.label,
    age, ageInconnu,
    violations: out,
    bloquant: out.some((v) => v.level === "block"),
    // Ce que le contrôle NE dit PAS. Le taire laisserait croire à une conformité
    // que le CFA n'est pas en mesure de constater seul.
    reserve: contexte === "groupe" && regime !== REGIMES.adulte
      ? "Les durées maximales sont un TOTAL centre de formation + entreprise. Ce contrôle ne porte que sur les heures en centre : les heures en entreprise s'y ajoutent."
      : null,
  };
}

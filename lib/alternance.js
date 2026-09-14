// Rythme d'alternance : génération du calendrier et contrôle de faisabilité.
// Logique pure, aucune I/O.
//
// CE QUI MANQUAIT VRAIMENT — le calendrier savait déjà porter des « semaines en
// entreprise » par classe, et la série hebdomadaire les sautait correctement.
// Mais il fallait les déclarer UNE PAR UNE : un rythme « 1 semaine centre pour
// 3 semaines entreprise » sur une année scolaire, c'est une trentaine de
// périodes à saisir à la main, par classe. À la première erreur de saisie, des
// cours se posent pendant que les apprentis sont en poste.
//
// ET SURTOUT, PERSONNE NE VÉRIFIAIT L'ESSENTIEL : le rythme choisi permet-il
// d'atteindre le volume horaire du référentiel ? Un BTS à 1 350 heures avec
// treize semaines en centre à 30 heures n'en délivre que 390. On s'en aperçoit
// en juin, quand il ne reste plus de semaines. Ce contrôle se fait AVANT de
// planifier, pas après.
//
// LE POINT DE DROIT QUE LE CALENDRIER SCOLAIRE FAIT OUBLIER :
//
//   UN APPRENTI N'A PAS DE VACANCES SCOLAIRES. Il est salarié : il a des congés
//   payés, cinq semaines, posées comme dans n'importe quelle entreprise. Pendant
//   les vacances scolaires, il est EN ENTREPRISE.
//
// Traiter les vacances scolaires comme du temps libre pour une classe
// d'apprentis fabrique un calendrier faux : on croit avoir libéré des semaines
// qui étaient déjà du temps entreprise, et on sous-estime le volume disponible
// en centre. Le générateur affecte donc les semaines non travaillées en centre
// à l'entreprise, et distingue les FERMETURES du centre, qui sont autre chose.

const jour = 864e5;
const d = (iso) => new Date(iso + "T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Lundi de la semaine contenant la date.
export function lundiDe(dateISO) {
  const x = d(dateISO);
  const j = (x.getUTCDay() + 6) % 7;
  return iso(x.getTime() - j * jour);
}
const dimancheDe = (lundi) => iso(d(lundi).getTime() + 6 * jour);

// Rythmes courants. Ils se lisent « semaines en centre / semaines en entreprise ».
export const RYTHMES = {
  "1-1": { label: "1 semaine centre / 1 semaine entreprise", centre: 1, entreprise: 1 },
  "1-2": { label: "1 semaine centre / 2 semaines entreprise", centre: 1, entreprise: 2 },
  "1-3": { label: "1 semaine centre / 3 semaines entreprise", centre: 1, entreprise: 3 },
  "2-3": { label: "2 semaines centre / 3 semaines entreprise", centre: 2, entreprise: 3 },
  "2-2": { label: "2 semaines centre / 2 semaines entreprise", centre: 2, entreprise: 2 },
  "3-1": { label: "3 semaines centre / 1 semaine entreprise", centre: 3, entreprise: 1 },
};

export function validateRythme(r = {}) {
  const errors = [];
  if (!r.debut || !r.fin) errors.push("dates de début et de fin d'année requises");
  if (r.debut && r.fin && r.fin <= r.debut) errors.push("fin antérieure au début");
  const centre = Number(r.centre), entreprise = Number(r.entreprise);
  if (!Number.isInteger(centre) || centre < 1) errors.push("nombre de semaines en centre invalide");
  if (!Number.isInteger(entreprise) || entreprise < 0) errors.push("nombre de semaines en entreprise invalide");
  if (centre + entreprise > 12) errors.push("cycle trop long : au-delà de douze semaines, ce n'est plus une alternance");
  if (!r.classId) errors.push("classe requise — un rythme s'applique à une classe, pas à un campus entier");
  return { ok: errors.length === 0, errors };
}

// Génère le calendrier d'alternance : la liste des semaines, chacune marquée
// « centre » ou « entreprise ». Les fermetures du centre sont respectées — une
// semaine de fermeture ne peut pas être une semaine en centre.
export function genererRythme({ debut, fin, centre = 1, entreprise = 3, classId = null,
  commencePar = "centre", fermetures = [] } = {}) {
  const semaines = [];
  if (!debut || !fin) return semaines;
  const fermee = (lundi) => (fermetures || []).some((f) => f.from && f.to
    && dimancheDe(lundi) >= f.from && lundi <= f.to);

  let curseur = lundiDe(debut);
  const borne = lundiDe(fin);
  const cycle = centre + entreprise;
  let position = commencePar === "centre" ? 0 : centre;
  let garde = 0;

  while (curseur <= borne && garde++ < 400) {
    const dansCycle = cycle > 0 ? position % cycle : 0;
    let type = dansCycle < centre ? "centre" : "entreprise";
    let motif = null;
    if (type === "centre" && fermee(curseur)) {
      // Le centre est fermé : l'apprenti n'est pas en vacances pour autant, il
      // est en entreprise. La semaine est REPORTÉE, pas perdue.
      type = "entreprise";
      motif = "centre fermé — semaine reportée";
      position--;   // on ne consomme pas la semaine de centre
    }
    semaines.push({ lundi: curseur, dimanche: dimancheDe(curseur), type, motif });
    curseur = iso(d(curseur).getTime() + 7 * jour);
    position++;
  }
  return semaines.map((s) => ({ ...s, classId }));
}

// Conversion en périodes de calendrier : seules les semaines ENTREPRISE
// deviennent des périodes, puisque ce sont elles qui doivent bloquer les cours.
// Les semaines consécutives sont fusionnées — trente périodes d'une semaine sont
// illisibles là où huit périodes de trois semaines se relisent.
export function versPeriodes(semaines = [], { label = "Alternance" } = {}) {
  const out = [];
  let courante = null;
  for (const s of semaines) {
    if (s.type !== "entreprise") { courante = null; continue; }
    if (courante && d(s.lundi).getTime() === d(courante.to).getTime() + jour) {
      courante.to = s.dimanche;
      continue;
    }
    courante = { kind: "entreprise", from: s.lundi, to: s.dimanche, classId: s.classId || null, label };
    out.push(courante);
  }
  return out;
}

// LE CONTRÔLE QUI MANQUAIT : ce rythme permet-il d'atteindre le volume du
// référentiel ? On le pose avant de planifier, pas en juin.
export function verifierVolume({ semaines = [], heuresParSemaine = 0, volumeRequis = null } = {}) {
  const enCentre = semaines.filter((s) => s.type === "centre").length;
  const enEntreprise = semaines.filter((s) => s.type === "entreprise").length;
  const reportees = semaines.filter((s) => s.motif).length;
  const heures = Math.round(enCentre * (Number(heuresParSemaine) || 0));

  if (!volumeRequis) {
    return { semainesCentre: enCentre, semainesEntreprise: enEntreprise, semainesReportees: reportees,
      heuresDisponibles: heures, volumeRequis: null, suffisant: null,
      message: "Volume du référentiel non renseigné : impossible de dire si ce rythme suffit." };
  }
  const ecart = heures - volumeRequis;
  const suffisant = ecart >= 0;
  return {
    semainesCentre: enCentre, semainesEntreprise: enEntreprise, semainesReportees: reportees,
    heuresDisponibles: heures, volumeRequis, ecart, suffisant,
    // On dit ce qu'il faudrait changer, pas seulement que ça ne va pas.
    message: suffisant
      ? `${enCentre} semaines en centre à ${heuresParSemaine} h = ${heures} h, pour ${volumeRequis} h requises.`
      : `${heures} h disponibles pour ${volumeRequis} h requises : il manque ${-ecart} h. ` +
        `Il faudrait ${Math.ceil(volumeRequis / (heuresParSemaine || 1))} semaines en centre (soit ${Math.ceil(volumeRequis / (heuresParSemaine || 1)) - enCentre} de plus), ` +
        `ou ${Math.ceil(volumeRequis / (enCentre || 1))} h par semaine.`,
  };
}

// Synthèse lisible d'un rythme, pour l'écran de préparation d'année.
export function resume(semaines = []) {
  const parMois = new Map();
  for (const s of semaines) {
    const mois = s.lundi.slice(0, 7);
    if (!parMois.has(mois)) parMois.set(mois, { mois, centre: 0, entreprise: 0 });
    parMois.get(mois)[s.type]++;
  }
  return {
    total: semaines.length,
    centre: semaines.filter((s) => s.type === "centre").length,
    entreprise: semaines.filter((s) => s.type === "entreprise").length,
    reportees: semaines.filter((s) => s.motif).length,
    parMois: [...parMois.values()],
    // Rappel porté par la donnée elle-même : un apprenti n'a pas de vacances
    // scolaires, il a des congés payés. Les semaines hors centre sont des
    // semaines EN ENTREPRISE, pas des semaines libres.
    note: "Les semaines hors centre sont des semaines en entreprise : un apprenti est salarié, il n'a pas de vacances scolaires mais des congés payés.",
  };
}

// Conduite de projet — moteur d'ordonnancement, logique pure.
//
// POURQUOI UN MOTEUR ET PAS UN TABLEAU DE TÂCHES. Les outils du marché
// (Project, Monday, Asana, Wrike) savent tenir une liste de tâches avec des
// dates. Ce qu'ils font mal tient en trois points, et ce sont exactement les
// trois qui coûtent des retards :
//
//   1. L'AVANCEMENT EST DÉCLARÉ. « 85 % fait » est saisi à la main, par la
//      personne qui a intérêt à ce qu'il soit haut. Le chiffre monte vite
//      jusqu'à 90 % puis n'avance plus pendant des semaines. Ici, on ne saisit
//      JAMAIS un pourcentage sur une tâche élémentaire : on saisit le RESTE À
//      FAIRE, en jours. Le pourcentage est dérivé, et la date de fin prévue est
//      recalculée sur le reste, pas sur le déclaré. Une tâche « à 90 % » depuis
//      trois semaines se voit immédiatement : son reste à faire ne descend pas.
//
//   2. LE PASSÉ RESTE PLANIFIÉ. Une tâche jamais démarrée garde sa barre en
//      mars alors qu'on est en juin, et la date de fin du projet, elle, n'a pas
//      bougé. Ici, la planification part de la DATE D'ÉTAT : ce qui n'a pas
//      commencé ne peut pas commencer hier. Le retard remonte au lieu de se
//      cacher dans une barre orpheline.
//
//   3. L'ÉCHÉANCE COMPRIME LE PLAN. Saisir une date de fin « imposée » fait
//      souvent reculer les tâches pour que ça rentre, et le plan ment. Ici une
//      échéance n'ordonnance rien : elle sert au calcul des marges. Si le
//      travail ne rentre pas, la marge devient négative et le retard est
//      affiché en jours. Le plan ne se plie pas pour faire plaisir.
//
// CE QUE LE MODULE NE FAIT PAS, DÉLIBÉRÉMENT. Il ne donne jamais une date
// qu'il ne sait pas calculer. Un enchaînement circulaire, un lien vers une
// tâche inexistante, une tâche de synthèse à laquelle on a accroché une
// dépendance : le calcul s'arrête et NOMME le problème, au lieu de produire un
// diagramme plausible et faux. Un planning faux est plus dangereux que pas de
// planning : on prend des décisions avec.
//
// UNITÉ DE TEMPS : le jour ouvré. Pas l'heure — un projet d'ouverture ou de
// réorganisation ne se pilote pas à l'heure, et une durée en heures donne une
// fausse précision. Le calendrier porte les jours travaillés, les jours fériés
// français et les fermetures du site : une tâche ne progresse pas pendant la
// fermeture de Noël.

// ---------------------------------------------------------------------------
// Dates et calendrier ouvré
// ---------------------------------------------------------------------------

const MS = 86400000;
const jour = (d) => new Date(String(d).slice(0, 10) + "T00:00:00Z");
export const isoJour = (d) => (d instanceof Date ? d : jour(d)).toISOString().slice(0, 10);
export const ajoutJoursCalendaires = (d, n) => isoJour(new Date(jour(d).getTime() + n * MS));
// 1 = lundi … 7 = dimanche (ISO 8601, pas la numérotation de Date qui met
// dimanche en tête — source classique de décalage d'un jour).
export const jourSemaine = (d) => jour(d).getUTCDay() || 7;
const estDateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !Number.isNaN(jour(d).getTime());

export const JOURS_LABEL = { 1: "lundi", 2: "mardi", 3: "mercredi", 4: "jeudi", 5: "vendredi", 6: "samedi", 7: "dimanche" };
export const JOURS_OUVRES_DEFAUT = [1, 2, 3, 4, 5];

// Jours fériés légaux français (art. L. 3133-1 du code du travail). Les dates
// mobiles sont calculées depuis Pâques (algorithme de Meeus) et non codées en
// dur : une table figée se périme, et personne ne remarque qu'un planning
// compte l'Ascension comme un jour travaillé.
export function feriesFR(annee) {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jp = ((h + l - 7 * m + 114) % 31) + 1;
  const paques = `${annee}-${String(mois).padStart(2, "0")}-${String(jp).padStart(2, "0")}`;
  return {
    paques,
    jours: [
      `${annee}-01-01`, ajoutJoursCalendaires(paques, 1), `${annee}-05-01`, `${annee}-05-08`,
      ajoutJoursCalendaires(paques, 39), ajoutJoursCalendaires(paques, 50),
      `${annee}-07-14`, `${annee}-08-15`, `${annee}-11-01`, `${annee}-11-11`, `${annee}-12-25`,
    ],
    // Alsace-Moselle : deux jours fériés de plus (art. L. 3134-13). Un réseau
    // qui ouvre un site à Metz ou Strasbourg doit pouvoir le déclarer ; le
    // module ne le devine pas depuis le code postal.
    alsaceMoselle: [ajoutJoursCalendaires(paques, -2), `${annee}-12-26`],
  };
}

export const DUREE_HORIZON_JOURS = 366 * 8; // huit ans : au-delà, aucun plan n'a de sens

// Construit la liste ordonnée des jours ouvrés. Tout le calcul travaille
// ensuite sur des INDEX dans cette liste : additionner « 12 jours ouvrés » à
// une date devient une addition d'entiers, et les week-ends, fériés et
// fermetures cessent d'être des cas particuliers disséminés dans le code.
export function construireCalendrier({ debut, fin, joursOuvres, feries = true, alsaceMoselle = false, fermetures = [] } = {}) {
  const ouvres = new Set((Array.isArray(joursOuvres) && joursOuvres.length ? joursOuvres : JOURS_OUVRES_DEFAUT).map(Number));
  const d0 = estDateValide(debut) ? isoJour(debut) : isoJour(new Date());
  let d1 = estDateValide(fin) ? isoJour(fin) : ajoutJoursCalendaires(d0, DUREE_HORIZON_JOURS);
  if (d1 < d0) d1 = d0;
  const feriesSet = new Set();
  if (feries) {
    for (let an = Number(d0.slice(0, 4)) - 1; an <= Number(d1.slice(0, 4)) + 1; an++) {
      const f = feriesFR(an);
      for (const x of f.jours) feriesSet.add(x);
      if (alsaceMoselle) for (const x of f.alsaceMoselle) feriesSet.add(x);
    }
  }
  const fermeturesNorm = (fermetures || [])
    .filter((p) => estDateValide(p?.du) && estDateValide(p?.au))
    .map((p) => ({ du: isoJour(p.du), au: isoJour(p.au), motif: String(p.motif || "fermeture") }));
  const estFerme = (d) => fermeturesNorm.find((p) => d >= p.du && d <= p.au) || null;

  const jours = [];
  const idx = new Map();
  for (let d = d0; d <= d1; d = ajoutJoursCalendaires(d, 1)) {
    if (!ouvres.has(jourSemaine(d))) continue;
    if (feriesSet.has(d)) continue;
    if (estFerme(d)) continue;
    idx.set(d, jours.length);
    jours.push(d);
  }
  return {
    jours, idx, debut: d0, fin: d1, joursOuvres: [...ouvres].sort(),
    feries: feriesSet, fermetures: fermeturesNorm,
    estOuvre: (d) => idx.has(isoJour(d)),
    motifNonOuvre(d) {
      const x = isoJour(d);
      if (idx.has(x)) return null;
      if (!ouvres.has(jourSemaine(x))) return `${JOURS_LABEL[jourSemaine(x)]} non travaillé`;
      if (feriesSet.has(x)) return "jour férié";
      const f = estFerme(x);
      return f ? f.motif : "hors horizon du calendrier";
    },
  };
}

// Index du jour ouvré à partir d'une date. `sens` = +1 : le jour même s'il est
// ouvré, sinon le suivant (pour un début) ; -1 : le précédent (pour une fin).
export function indexJour(cal, date, sens = 1) {
  if (!estDateValide(date)) return null;
  let d = isoJour(date);
  if (cal.idx.has(d)) return cal.idx.get(d);
  if (sens > 0) {
    if (d < cal.debut) return 0;
    for (let i = 0; i < 400 && d <= cal.fin; i++) {
      d = ajoutJoursCalendaires(d, 1);
      if (cal.idx.has(d)) return cal.idx.get(d);
    }
    return null;
  }
  if (d > cal.fin) return cal.jours.length - 1;
  for (let i = 0; i < 400 && d >= cal.debut; i++) {
    d = ajoutJoursCalendaires(d, -1);
    if (cal.idx.has(d)) return cal.idx.get(d);
  }
  return null;
}
const dateDe = (cal, i) => cal.jours[Math.max(0, Math.min(cal.jours.length - 1, i))] || null;

// Nombre de jours OUVRÉS entre deux dates, bornes incluses. Sert à dire « trois
// jours de retard » sans compter le week-end, ce qui ferait râler à juste titre.
export function compterJoursOuvres(cal, a, b) {
  const ia = indexJour(cal, a, 1), ib = indexJour(cal, b, -1);
  if (ia == null || ib == null) return null;
  return ib - ia + 1;
}
export function ajouterJoursOuvres(cal, date, n) {
  const i = indexJour(cal, date, n >= 0 ? 1 : -1);
  return i == null ? null : dateDe(cal, i + n);
}

// ---------------------------------------------------------------------------
// Modèle : tâches, liens, contraintes
// ---------------------------------------------------------------------------

// Les quatre types de liens de l'ordonnancement classique, en notation
// française. Le décalage est en jours ouvrés et peut être négatif (recouvrement).
export const TYPES_LIEN = {
  FD: { label: "Fin → Début", aide: "le successeur commence quand le prédécesseur est terminé", court: "FD" },
  DD: { label: "Début → Début", aide: "les deux commencent ensemble", court: "DD" },
  FF: { label: "Fin → Fin", aide: "les deux se terminent ensemble", court: "FF" },
  DF: { label: "Début → Fin", aide: "le successeur ne peut finir qu'une fois le prédécesseur commencé", court: "DF" },
};

export const CONTRAINTES = {
  auplustot: { label: "Dès que possible", aide: "la tâche prend la première place que ses prédécesseurs autorisent" },
  pas_avant: { label: "Pas avant le", aide: "attente externe : autorisation, livraison, ouverture d'un guichet" },
  impose: { label: "Doit commencer le", aide: "date arrêtée avec un tiers — un conflit avec les prédécesseurs sera signalé, jamais corrigé en douce" },
  echeance: { label: "Échéance (au plus tard le)", aide: "n'ordonnance rien : révèle le retard en marge négative" },
};

export const STATUTS_PROJET = {
  cadrage: { label: "Cadrage", actif: true },
  en_cours: { label: "En cours", actif: true },
  suspendu: { label: "Suspendu", actif: true },
  termine: { label: "Terminé", actif: false },
  abandonne: { label: "Abandonné", actif: false },
};

export const STATUTS_TACHE = {
  a_faire: { label: "À faire" },
  en_cours: { label: "En cours" },
  faite: { label: "Faite" },
  abandonnee: { label: "Abandonnée" },
};

const nombre = (v, defaut = 0) => (Number.isFinite(Number(v)) ? Number(v) : defaut);
const texte = (v, max = 400) => String(v ?? "").trim().slice(0, max);

// Normalise une tâche telle qu'elle arrive du magasin ou d'un formulaire.
// Une tâche de synthèse (qui a des enfants) n'a NI durée propre NI lien :
// ses dates sont l'enveloppe de ses enfants. Voir `validerPlan`.
export function normaliserTache(t = {}) {
  const duree = Math.max(0, Math.round(nombre(t.dureeJours, t.jalon ? 0 : 1)));
  const statut = STATUTS_TACHE[t.statut] ? t.statut : "a_faire";
  return {
    id: t.id,
    projetId: t.projetId || null,
    titre: texte(t.titre, 200),
    lot: texte(t.lot, 80),
    parentId: t.parentId || null,
    jalon: !!t.jalon,
    dureeJours: t.jalon ? 0 : duree,
    liens: (Array.isArray(t.liens) ? t.liens : [])
      .filter((l) => l && l.deId)
      .map((l) => ({ deId: l.deId, type: TYPES_LIEN[l.type] ? l.type : "FD", decalage: Math.round(nombre(l.decalage, 0)) })),
    contrainte: CONTRAINTES[t.contrainte?.type] ? { type: t.contrainte.type, date: estDateValide(t.contrainte.date) ? isoJour(t.contrainte.date) : null } : { type: "auplustot", date: null },
    statut,
    // Reste à faire : LA donnée d'avancement. Absent, il vaut la durée pour une
    // tâche non commencée et 0 pour une tâche faite — jamais un pourcentage.
    resteAFaire: t.resteAFaire == null
      ? (statut === "faite" ? 0 : statut === "abandonnee" ? 0 : duree)
      : Math.max(0, Math.round(nombre(t.resteAFaire, duree))),
    debutReel: estDateValide(t.debutReel) ? isoJour(t.debutReel) : null,
    finReelle: estDateValide(t.finReelle) ? isoJour(t.finReelle) : null,
    responsable: texte(t.responsable, 120),
    // Rôle attendu (« directeur de campus », « prestataire réseau »). Un modèle
    // transporte le rôle, jamais la personne : les personnes changent de poste,
    // et une trame qui nomme quelqu'un vieillit en quelques mois.
    role: texte(t.role, 80),
    affectations: (Array.isArray(t.affectations) ? t.affectations : [])
      .filter((a) => a && a.ressourceId)
      .map((a) => ({ ressourceId: a.ressourceId, tauxJour: Math.max(0, Math.min(3, nombre(a.tauxJour, 1))) })),
    budgetPrevu: nombre(t.budgetPrevu, 0),
    budgetDepense: nombre(t.budgetDepense, 0),
    note: texte(t.note, 2000),
    ordre: nombre(t.ordre, 0),
  };
}

// ---------------------------------------------------------------------------
// Registres de pilotage
// ---------------------------------------------------------------------------
// Un plan seul ne fait pas un dossier de projet. Ce qui se présente en comité,
// c'est ce que le plan NE DIT PAS : les risques ouverts, les cibles chiffrées,
// les changements demandés, les fournisseurs engagés, les instances qui décident.
// Ces cinq registres vivent sur le projet parce qu'ils lui survivent moins bien
// ailleurs : dans un tableur joint, ils divergent du plan en deux semaines.
export const IMPACTS = { faible: "Faible", moyen: "Moyen", eleve: "Élevé" };
export const STATUTS_RISQUE = { ouvert: "Ouvert", encours: "En cours de traitement", resolu: "Résolu", caduc: "Caduc" };
export const STATUTS_CR = { soumis: "Soumis", evalue: "Évalué", accepte: "Accepté", refuse: "Refusé" };

const ligne = (x, champs, defauts = {}) => {
  const out = { id: x.id || null };
  for (const [c, n] of Object.entries(champs)) out[c] = texte(x[c], n);
  return { ...defauts, ...out };
};

export function normaliserRegistres(p = {}) {
  const tab = (v) => (Array.isArray(v) ? v : []);
  return {
    risques: tab(p.risques).filter((r) => r?.titre).map((r) => ({
      ...ligne(r, { titre: 400, chantier: 120, proprietaire: 120, echeance: 40, commentaire: 600 }),
      impact: IMPACTS[r.impact] ? r.impact : "moyen",
      statut: STATUTS_RISQUE[r.statut] ? r.statut : "ouvert",
      // Plan B : un risque sans porte de sortie n'est pas piloté, il est subi.
      seuil: texte(r.seuil, 300), planB: texte(r.planB, 600), decideur: texte(r.decideur, 120),
      declenche: !!r.declenche,
    })),
    kpis: tab(p.kpis).filter((k) => k?.indicateur).map((k) => ({
      ...ligne(k, { indicateur: 200, cible: 200, echeance: 80, valeur: 80, commentaire: 400 }),
      // « Officiel » = engagé devant la direction ; « opérationnel » = propre au plan.
      // Les mélanger fait passer une cible interne pour un engagement budgétaire.
      type: k.type === "operationnel" ? "operationnel" : "officiel",
    })),
    changements: tab(p.changements).filter((c) => c?.description).map((c) => ({
      ...ligne(c, { description: 600, demandeur: 120, chantier: 120, decideur: 120, decision: 400, dateDemande: 40, dateDecision: 40 }),
      impact: IMPACTS[c.impact] ? c.impact : "moyen",
      statut: STATUTS_CR[c.statut] ? c.statut : "soumis",
    })),
    fournisseurs: tab(p.fournisseurs).filter((f) => f?.nom).map((f) => ({
      ...ligne(f, { nom: 160, prestation: 300, chantier: 120, statut: 120, signature: 40, renouvellement: 40, sla: 200, contact: 120, notes: 400 }),
      budget: nombre(f.budget, 0),
    })),
    instances: tab(p.instances).filter((i) => i?.nom).map((i) => ligne(i, { nom: 160, frequence: 120, composition: 600, role: 600 })),
    // Ordre du jour type d'une instance : { instance, etapes:[{duree, sujet, intervenant}] }
    trames: tab(p.trames).filter((t) => t?.instance).map((t) => ({
      instance: texte(t.instance, 160), duree: texte(t.duree, 60),
      participants: texte(t.participants, 600),
      etapes: tab(t.etapes).filter((e) => e?.sujet).map((e) => ligne(e, { duree: 40, sujet: 400, intervenant: 160 })),
    })),
  };
}

export function normaliserProjet(p = {}) {
  return {
    id: p.id,
    campusId: p.campusId || null,
    nom: texte(p.nom, 160),
    objectif: texte(p.objectif, 2000),
    pilote: texte(p.pilote, 120),
    statut: STATUTS_PROJET[p.statut] ? p.statut : "cadrage",
    debut: estDateValide(p.debut) ? isoJour(p.debut) : isoJour(new Date()),
    calendrier: {
      joursOuvres: Array.isArray(p.calendrier?.joursOuvres) && p.calendrier.joursOuvres.length ? p.calendrier.joursOuvres.map(Number) : JOURS_OUVRES_DEFAUT,
      feries: p.calendrier?.feries !== false,
      alsaceMoselle: !!p.calendrier?.alsaceMoselle,
      fermetures: (Array.isArray(p.calendrier?.fermetures) ? p.calendrier.fermetures : [])
        .filter((f) => estDateValide(f?.du) && estDateValide(f?.au))
        .map((f) => ({ du: isoJour(f.du), au: isoJour(f.au), motif: texte(f.motif, 120) || "fermeture" })),
    },
    ressources: (Array.isArray(p.ressources) ? p.ressources : []).map((r) => ({
      id: r.id, nom: texte(r.nom, 120), role: texte(r.role, 80),
      // Capacité en part de journée consacrée AU PROJET. 0,4 pour un directeur
      // de campus qui garde son campus à faire tourner : c'est la valeur réaliste,
      // et c'est elle qui fait apparaître les surcharges que « 1 ETP » masque.
      capaciteJour: Math.max(0, Math.min(3, nombre(r.capaciteJour, 1))),
      cout: nombre(r.cout, 0),
    })),
    budget: nombre(p.budget, 0),
    reference: p.reference || null,
    archive: !!p.archive,
    // Cadrage : ce qu'une note de cadrage exige et qu'un plan ne porte pas.
    contexte: texte(p.contexte, 4000),
    perimetre: texte(p.perimetre, 4000),
    horsPerimetre: texte(p.horsPerimetre, 2000),
    commanditaire: texte(p.commanditaire, 160),
    sponsor: texte(p.sponsor, 160),
    coSponsor: texte(p.coSponsor, 160),
    relaisDG: texte(p.relaisDG, 160),
    ...normaliserRegistres(p),
  };
}

// ---------------------------------------------------------------------------
// Validation : ce qui empêche un calcul honnête
// ---------------------------------------------------------------------------

export function validerPlan(taches) {
  const erreurs = [];
  const ids = new Set(taches.map((t) => t.id));
  const enfants = new Map();
  for (const t of taches) if (t.parentId) enfants.set(t.parentId, (enfants.get(t.parentId) || 0) + 1);

  for (const t of taches) {
    const nom = t.titre || t.id;
    if (!t.titre) erreurs.push({ tacheId: t.id, message: "tâche sans intitulé" });
    if (t.parentId && !ids.has(t.parentId)) erreurs.push({ tacheId: t.id, message: `« ${nom} » est rattachée à une tâche de synthèse qui n'existe plus` });
    if (t.parentId === t.id) erreurs.push({ tacheId: t.id, message: `« ${nom} » se contient elle-même` });
    const estSynthese = enfants.has(t.id);
    if (estSynthese && t.liens.length) {
      // Refus assumé. Une tâche de synthèse avec dépendance produit un planning
      // que personne ne sait expliquer : l'enveloppe contraint ses propres
      // enfants, qui contraignent l'enveloppe. Le lien se pose sur une feuille.
      erreurs.push({ tacheId: t.id, message: `« ${nom} » regroupe d'autres tâches : la dépendance se pose sur une tâche élémentaire, pas sur le regroupement` });
    }
    if (estSynthese && t.dureeJours > 0) {
      erreurs.push({ tacheId: t.id, message: `« ${nom} » regroupe d'autres tâches : sa durée est celle de ses enfants, elle ne se saisit pas`, corrigible: true });
    }
    for (const l of t.liens) {
      if (l.deId === t.id) erreurs.push({ tacheId: t.id, message: `« ${nom} » dépend d'elle-même` });
      else if (!ids.has(l.deId)) erreurs.push({ tacheId: t.id, message: `« ${nom} » dépend d'une tâche supprimée` });
    }
    if (t.resteAFaire > t.dureeJours && t.dureeJours > 0) {
      erreurs.push({ tacheId: t.id, message: `« ${nom} » : reste à faire (${t.resteAFaire} j) supérieur à la durée (${t.dureeJours} j) — c'est possible, mais la durée doit alors être corrigée`, avertissement: true });
    }
  }
  const cycle = chercherCycle(taches);
  if (cycle) {
    const nomDe = (id) => taches.find((t) => t.id === id)?.titre || id;
    erreurs.push({ cycle, message: `enchaînement circulaire : ${cycle.map(nomDe).join(" → ")} → ${nomDe(cycle[0])}. Aucune date n'est calculable tant qu'il subsiste.` });
  }
  return { ok: !erreurs.some((e) => !e.avertissement), erreurs };
}

// Détection de cycle par parcours en profondeur, qui RENVOIE le cycle trouvé.
// Dire « il y a un cycle » sans dire lequel oblige à le chercher à la main sur
// un diagramme de deux cents tâches.
export function chercherCycle(taches) {
  const parId = new Map(taches.map((t) => [t.id, t]));
  const etat = new Map(); // 0 = non vu, 1 = en cours, 2 = fini
  const pile = [];
  let trouve = null;
  const visiter = (id) => {
    if (trouve) return;
    const t = parId.get(id);
    if (!t) return;
    etat.set(id, 1);
    pile.push(id);
    for (const l of t.liens) {
      if (!parId.has(l.deId)) continue;
      const e = etat.get(l.deId) || 0;
      if (e === 1) { trouve = pile.slice(pile.indexOf(l.deId)).reverse(); return; }
      if (e === 0) { visiter(l.deId); if (trouve) return; }
    }
    pile.pop();
    etat.set(id, 2);
  };
  for (const t of taches) if (!etat.get(t.id)) visiter(t.id);
  return trouve;
}

// Ordre topologique (Kahn) : prédécesseurs avant successeurs.
function ordreTopologique(taches) {
  const parId = new Map(taches.map((t) => [t.id, t]));
  const entrants = new Map(taches.map((t) => [t.id, 0]));
  const sortants = new Map(taches.map((t) => [t.id, []]));
  for (const t of taches) {
    for (const l of t.liens) {
      if (!parId.has(l.deId)) continue;
      entrants.set(t.id, entrants.get(t.id) + 1);
      sortants.get(l.deId).push(t.id);
    }
  }
  const file = taches.filter((t) => !entrants.get(t.id)).map((t) => t.id);
  const ordre = [];
  while (file.length) {
    const id = file.shift();
    ordre.push(id);
    for (const s of sortants.get(id) || []) {
      entrants.set(s, entrants.get(s) - 1);
      if (!entrants.get(s)) file.push(s);
    }
  }
  return { ordre, complet: ordre.length === taches.length, sortants };
}

// ---------------------------------------------------------------------------
// Ordonnancement : les deux passes du chemin critique
// ---------------------------------------------------------------------------

// Bornes internes : [debut, finEx) en index de jours ouvrés. `finEx` est le
// premier jour NON occupé — ce qui fait tomber le jalon (durée 0) exactement
// sur son jour, et permet à un successeur en Fin→Début de démarrer le jour même
// où le jalon est atteint, sans le décalage d'un jour que produisent les
// implémentations naïves.
export function ordonnancer(projetBrut = {}, tachesBrutes = [], options = {}) {
  const projet = normaliserProjet(projetBrut);
  const taches = tachesBrutes.map(normaliserTache).filter((t) => t.id);
  const aujourdhui = estDateValide(options.aujourdhui) ? isoJour(options.aujourdhui) : isoJour(new Date());
  const validation = validerPlan(taches);

  const cal = construireCalendrier({
    debut: [projet.debut, aujourdhui, ...taches.map((t) => t.debutReel).filter(Boolean), ...taches.map((t) => t.contrainte.date).filter(Boolean)].sort()[0],
    joursOuvres: projet.calendrier.joursOuvres,
    feries: projet.calendrier.feries,
    alsaceMoselle: projet.calendrier.alsaceMoselle,
    fermetures: projet.calendrier.fermetures,
  });

  if (!validation.ok) {
    return { ok: false, projet, calendrier: cal, erreurs: validation.erreurs, taches: [], resume: null, aujourdhui };
  }

  const parId = new Map(taches.map((t) => [t.id, t]));
  const enfants = new Map();
  for (const t of taches) if (t.parentId && parId.has(t.parentId)) {
    if (!enfants.has(t.parentId)) enfants.set(t.parentId, []);
    enfants.get(t.parentId).push(t.id);
  }
  const estSynthese = (id) => enfants.has(id);
  const feuilles = taches.filter((t) => !estSynthese(t.id));

  const { ordre, complet, sortants } = ordreTopologique(feuilles);
  if (!complet) {
    return { ok: false, projet, calendrier: cal, aujourdhui, taches: [],
      erreurs: [{ message: "enchaînement circulaire résiduel : aucune date n'est calculable" }], resume: null };
  }

  const iDebutProjet = indexJour(cal, projet.debut, 1) ?? 0;
  const iAujourdhui = indexJour(cal, aujourdhui, 1) ?? 0;
  const calc = new Map();

  // ---- Passe avant : au plus tôt -----------------------------------------
  for (const id of ordre) {
    const t = parId.get(id);
    const conflits = [];

    // Durée à planifier = ce qui RESTE. Une tâche commencée ne se replanifie
    // pas sur sa durée initiale : sinon un projet à moitié fait affiche encore
    // sa durée totale devant lui.
    let duree = t.dureeJours;
    if (t.statut === "en_cours") duree = t.resteAFaire;
    if (t.statut === "faite" || t.statut === "abandonnee") duree = 0;

    let debut;
    let finForcee = null;
    if (t.statut === "faite" || t.statut === "abandonnee") {
      // Le réalisé ne se recalcule pas : il se constate. Une tâche déclarée
      // faite SANS date réelle est réputée achevée à la date d'état : ses
      // successeurs peuvent partir maintenant, pas au début du projet — sans
      // quoi le plan les replacerait dans un passé où rien n'a eu lieu.
      const iDeb = t.debutReel ? indexJour(cal, t.debutReel, 1) : null;
      const iFin = t.finReelle ? indexJour(cal, t.finReelle, -1) : null;
      debut = iDeb ?? (iFin != null ? iFin : iAujourdhui);
      finForcee = t.statut === "abandonnee" ? debut : (iFin != null ? Math.max(debut, iFin + 1) : debut);
    } else if (t.statut === "en_cours") {
      debut = indexJour(cal, t.debutReel || aujourdhui, 1) ?? iAujourdhui;
    } else {
      // Rien ne commence dans le passé. C'est la règle qui fait remonter le
      // retard au lieu de le laisser dormir dans une barre orpheline.
      debut = Math.max(iDebutProjet, iAujourdhui);
    }

    let minLiens = -Infinity;
    for (const l of t.liens) {
      const p = calc.get(l.deId);
      if (!p) continue;
      const lag = l.decalage;
      let borne;
      if (l.type === "FD") borne = p.finEx + lag;
      else if (l.type === "DD") borne = p.debut + lag;
      else if (l.type === "FF") borne = p.finEx + lag - duree;
      else borne = p.debut + lag - duree; // DF
      if (borne > minLiens) minLiens = borne;
    }
    if (minLiens > -Infinity) debut = Math.max(debut, minLiens);

    const c = t.contrainte;
    if (c.type === "pas_avant" && c.date) {
      const ic = indexJour(cal, c.date, 1);
      if (ic != null) debut = Math.max(debut, ic);
    }
    if (c.type === "impose" && c.date && t.statut === "a_faire") {
      const ic = indexJour(cal, c.date, 1);
      if (ic != null) {
        // On garde la date imposée et on NOMME le conflit. Décaler en silence
        // revient à décider à la place de celui qui a pris l'engagement.
        if (minLiens > -Infinity && minLiens > ic) {
          conflits.push(`date imposée au ${c.date}, mais les tâches dont elle dépend ne la libèrent que le ${dateDe(cal, minLiens)} — ${minLiens - ic} jour(s) ouvré(s) d'écart`);
        }
        if (ic < iAujourdhui) conflits.push(`date imposée au ${c.date}, déjà passée`);
        debut = ic;
      }
    }

    // Une tâche en cours a commencé à sa date réelle, mais son reste à faire
    // court à partir d'aujourd'hui : c'est ce qui empêche une tâche démarrée
    // en mars et jamais finie d'afficher encore une fin en mars.
    const finEx = finForcee != null ? finForcee
      : t.statut === "en_cours" ? Math.max(iAujourdhui, debut) + duree
      : debut + duree;

    calc.set(id, {
      id, debut, finEx, duree, conflits,
      // Ancrage des marges : le début du travail QUI RESTE, et non la date de
      // début réelle. Sur une tâche commencée il y a dix jours dont il reste
      // trois, partir du début réel fabrique une marge de sept jours qui
      // n'existe pas — et la tâche sort du chemin critique alors qu'elle le
      // commande. C'est le retard qu'on croit avoir le temps d'absorber.
      debutRestant: finEx - duree,
      // Une tâche faite garde sa date de fin réelle si elle est connue.
      finReelleIdx: t.finReelle ? indexJour(cal, t.finReelle, -1) : null,
    });
  }

  // ---- Fin du projet ------------------------------------------------------
  let finProjetEx = iDebutProjet;
  for (const id of ordre) {
    const c = calc.get(id);
    const t = parId.get(id);
    if (t.statut === "abandonnee") continue;
    const fin = t.statut === "faite" && c.finReelleIdx != null ? c.finReelleIdx + 1 : c.finEx;
    if (fin > finProjetEx) finProjetEx = fin;
  }

  // ---- Passe arrière : au plus tard, marges -------------------------------
  const tard = new Map();
  for (const id of [...ordre].reverse()) {
    const t = parId.get(id);
    const c = calc.get(id);
    let finTard = finProjetEx;
    // Une échéance n'ordonnance rien mais elle borne le « au plus tard » :
    // c'est par là que le retard devient un nombre au lieu d'un pressentiment.
    if (t.contrainte.type === "echeance" && t.contrainte.date) {
      const ie = indexJour(cal, t.contrainte.date, -1);
      if (ie != null) finTard = Math.min(finTard, ie + 1);
    }
    for (const sid of sortants.get(id) || []) {
      const s = parId.get(sid), sc = calc.get(sid), st = tard.get(sid);
      if (!s || !sc || !st) continue;
      for (const l of s.liens.filter((x) => x.deId === id)) {
        const lag = l.decalage;
        let borne;
        if (l.type === "FD") borne = st.debutTard - lag;
        else if (l.type === "DD") borne = st.debutTard - lag + c.duree;
        else if (l.type === "FF") borne = st.finTard - lag;
        else borne = st.finTard - lag + c.duree; // DF
        finTard = Math.min(finTard, borne);
      }
    }
    tard.set(id, { finTard, debutTard: finTard - c.duree });
  }

  // ---- Marge libre : le retard absorbable sans bouger AUCUN successeur -----
  const margeLibre = new Map();
  for (const id of ordre) {
    const c = calc.get(id);
    let libre = Infinity;
    const succs = sortants.get(id) || [];
    for (const sid of succs) {
      const s = parId.get(sid), sc = calc.get(sid);
      for (const l of s.liens.filter((x) => x.deId === id)) {
        const lag = l.decalage;
        let jeu;
        if (l.type === "FD") jeu = sc.debut - (c.finEx + lag);
        else if (l.type === "DD") jeu = sc.debut - (c.debut + lag);
        else if (l.type === "FF") jeu = sc.finEx - (c.finEx + lag);
        else jeu = sc.finEx - (c.debut + lag);
        libre = Math.min(libre, jeu);
      }
    }
    if (!succs.length) libre = Math.min(tard.get(id).finTard - c.finEx, finProjetEx - c.finEx);
    margeLibre.set(id, libre === Infinity ? 0 : libre);
  }

  // ---- Sortie par tâche ---------------------------------------------------
  const sortie = new Map();
  for (const t of feuilles) {
    const c = calc.get(t.id);
    const ta = tard.get(t.id);
    const margeTotale = ta.debutTard - c.debutRestant;
    const finIdx = t.statut === "faite" && c.finReelleIdx != null ? c.finReelleIdx : Math.max(c.debut, c.finEx - 1);
    const avancement = t.statut === "faite" ? 1
      : t.statut === "abandonnee" ? 0
      : t.dureeJours > 0 ? Math.max(0, Math.min(1, (t.dureeJours - t.resteAFaire) / t.dureeJours))
      : (t.statut === "en_cours" ? 0.5 : 0);
    const echeance = t.contrainte.type === "echeance" ? t.contrainte.date : null;
    sortie.set(t.id, {
      ...t,
      synthese: false,
      debut: dateDe(cal, c.debut),
      fin: dateDe(cal, finIdx),
      debutIdx: c.debut, finExIdx: c.finEx,
      debutAuPlusTard: dateDe(cal, ta.debutTard),
      finAuPlusTard: dateDe(cal, Math.max(ta.debutTard, ta.finTard - 1)),
      dureePlanifiee: c.duree,
      margeTotale, margeLibre: margeLibre.get(t.id),
      critique: margeTotale <= 0 && t.statut !== "faite" && t.statut !== "abandonnee",
      avancement,
      conflits: c.conflits,
      echeance,
      // Une échéance dépassée se compte en jours ouvrés : « trois jours de
      // retard » sur un vendredi ne veut pas dire lundi.
      echeanceDepassee: echeance && dateDe(cal, finIdx) > echeance ? compterJoursOuvres(cal, echeance, dateDe(cal, finIdx)) - 1 : 0,
    });
  }

  // ---- Tâches de synthèse : enveloppe, jamais saisie ----------------------
  const rollup = (id, profondeur = 0) => {
    const t = parId.get(id);
    const kids = (enfants.get(id) || []).map((k) => (estSynthese(k) ? rollup(k, profondeur + 1) : sortie.get(k))).filter(Boolean);
    const poids = kids.reduce((s, k) => s + Math.max(k.dureeJours || 0, k.jalon ? 0 : 1), 0) || kids.length || 1;
    const item = {
      ...t, synthese: true,
      debut: kids.map((k) => k.debut).filter(Boolean).sort()[0] || null,
      fin: kids.map((k) => k.fin).filter(Boolean).sort().slice(-1)[0] || null,
      debutIdx: Math.min(...kids.map((k) => k.debutIdx ?? Infinity)),
      finExIdx: Math.max(...kids.map((k) => k.finExIdx ?? -Infinity)),
      dureeJours: kids.reduce((s, k) => s + (k.dureeJours || 0), 0),
      dureePlanifiee: kids.reduce((s, k) => s + (k.dureePlanifiee || 0), 0),
      resteAFaire: kids.reduce((s, k) => s + (k.resteAFaire || 0), 0),
      // L'avancement d'un regroupement est PONDÉRÉ par la durée de ses enfants
      // et jamais saisi : c'est ce qui interdit le « 80 % » de confort sur une
      // phase dont la tâche la plus lourde n'a pas commencé.
      avancement: kids.reduce((s, k) => s + (k.avancement || 0) * Math.max(k.dureeJours || 0, k.jalon ? 0 : 1), 0) / poids,
      critique: kids.some((k) => k.critique),
      margeTotale: Math.min(...kids.map((k) => (k.margeTotale == null ? Infinity : k.margeTotale))),
      margeLibre: 0,
      budgetPrevu: (t.budgetPrevu || 0) + kids.reduce((s, k) => s + (k.budgetPrevu || 0), 0),
      budgetDepense: (t.budgetDepense || 0) + kids.reduce((s, k) => s + (k.budgetDepense || 0), 0),
      conflits: [], echeanceDepassee: 0, enfants: kids.map((k) => k.id),
      statut: kids.every((k) => k.statut === "faite") ? "faite" : kids.some((k) => k.statut !== "a_faire") ? "en_cours" : "a_faire",
    };
    sortie.set(id, item);
    return item;
  };
  for (const t of taches) if (estSynthese(t.id) && !parId.get(t.parentId)) rollup(t.id);
  for (const t of taches) if (estSynthese(t.id) && !sortie.has(t.id)) rollup(t.id);

  const liste = taches.map((t) => sortie.get(t.id)).filter(Boolean);
  hierarchiser(liste, parId);

  return {
    ok: true, projet, calendrier: cal, aujourdhui,
    erreurs: validation.erreurs.filter((e) => e.avertissement),
    taches: liste,
    resume: resumer(liste, projet, cal, finProjetEx, aujourdhui),
  };
}

// Numérotation hiérarchique (1, 1.1, 1.2, 2…) et ordre d'affichage.
function hierarchiser(liste, parId) {
  const parParent = new Map();
  for (const t of liste) {
    const k = t.parentId && parId.has(t.parentId) ? t.parentId : "__racine__";
    if (!parParent.has(k)) parParent.set(k, []);
    parParent.get(k).push(t);
  }
  for (const arr of parParent.values()) arr.sort((a, b) => (a.ordre - b.ordre) || String(a.debut || "").localeCompare(String(b.debut || "")));
  const ordonne = [];
  const parcourir = (cle, prefixe, niveau) => {
    (parParent.get(cle) || []).forEach((t, i) => {
      t.code = prefixe ? `${prefixe}.${i + 1}` : String(i + 1);
      t.niveau = niveau;
      t.rang = ordonne.length;
      ordonne.push(t);
      parcourir(t.id, t.code, niveau + 1);
    });
  };
  parcourir("__racine__", "", 0);
  // Réordonne la liste en place sur l'ordre hiérarchique.
  liste.length = 0;
  liste.push(...ordonne);
  return liste;
}

function resumer(liste, projet, cal, finProjetEx, aujourdhui) {
  const feuilles = liste.filter((t) => !t.synthese && t.statut !== "abandonnee");
  const poids = feuilles.reduce((s, t) => s + Math.max(t.dureeJours || 0, t.jalon ? 0 : 1), 0) || 1;
  const avancement = feuilles.reduce((s, t) => s + (t.avancement || 0) * Math.max(t.dureeJours || 0, t.jalon ? 0 : 1), 0) / poids;
  const jalons = liste.filter((t) => t.jalon).map((t) => ({
    id: t.id, titre: t.titre, date: t.fin || t.debut, statut: t.statut,
    critique: t.critique, echeance: t.echeance || null, echeanceDepassee: t.echeanceDepassee || 0,
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const finProjet = dateDe(cal, Math.max(0, finProjetEx - 1));
  const restant = feuilles.reduce((s, t) => s + (t.statut === "faite" ? 0 : t.resteAFaire || 0), 0);
  return {
    debut: projet.debut,
    fin: finProjet,
    dureeOuvree: compterJoursOuvres(cal, projet.debut, finProjet),
    avancement: Math.round(avancement * 1000) / 1000,
    resteAFaireJours: restant,
    taches: liste.filter((t) => !t.synthese).length,
    jalons,
    critiques: liste.filter((t) => t.critique && !t.synthese).map((t) => t.id),
    conflits: liste.filter((t) => t.conflits?.length).map((t) => ({ id: t.id, titre: t.titre, conflits: t.conflits })),
    echeancesDepassees: liste.filter((t) => t.echeanceDepassee > 0).map((t) => ({ id: t.id, titre: t.titre, echeance: t.echeance, fin: t.fin, retard: t.echeanceDepassee })),
    budgetPrevu: liste.filter((t) => !t.synthese).reduce((s, t) => s + (t.budgetPrevu || 0), 0),
    budgetDepense: liste.filter((t) => !t.synthese).reduce((s, t) => s + (t.budgetDepense || 0), 0),
    budgetProjet: projet.budget || 0,
    aujourdhui,
  };
}

// ---------------------------------------------------------------------------
// Charge des ressources
// ---------------------------------------------------------------------------

// Une surcharge se mesure JOUR PAR JOUR. Le total mensuel ment : trois tâches
// de deux jours à plein temps la même semaine tiennent dans un mois « à 40 % ».
export function charge(plan, options = {}) {
  if (!plan?.ok) return { ok: false, ressources: [], pics: [] };
  const cal = plan.calendrier;
  const debut = plan.resume?.debut ? indexJour(cal, plan.resume.debut, 1) ?? 0 : 0;
  const fin = plan.resume?.fin ? indexJour(cal, plan.resume.fin, -1) ?? 0 : 0;
  const ressources = new Map((plan.projet.ressources || []).map((r) => [r.id, { ...r, jours: new Map(), total: 0, surcharge: [] }]));
  const inconnues = new Map();

  for (const t of plan.taches) {
    if (t.synthese || t.statut === "faite" || t.statut === "abandonnee") continue;
    for (const a of t.affectations || []) {
      let r = ressources.get(a.ressourceId);
      if (!r) {
        // Une affectation vers une ressource retirée du projet ne disparaît pas
        // du calcul : elle est signalée. Sinon la charge baisse toute seule.
        if (!inconnues.has(a.ressourceId)) inconnues.set(a.ressourceId, { id: a.ressourceId, taches: [] });
        inconnues.get(a.ressourceId).taches.push(t.titre);
        continue;
      }
      for (let i = t.debutIdx; i < t.finExIdx; i++) {
        r.jours.set(i, (r.jours.get(i) || 0) + a.tauxJour);
        r.total += a.tauxJour;
      }
    }
  }

  const out = [];
  for (const r of ressources.values()) {
    const joursSurcharge = [];
    let pic = 0;
    for (const [i, v] of r.jours) {
      if (v > pic) pic = v;
      if (v > r.capaciteJour + 1e-9) joursSurcharge.push({ date: dateDe(cal, i), charge: Math.round(v * 100) / 100, capacite: r.capaciteJour });
    }
    joursSurcharge.sort((a, b) => a.date.localeCompare(b.date));
    const joursDispo = Math.max(0, fin - debut + 1) * r.capaciteJour;
    out.push({
      id: r.id, nom: r.nom, role: r.role, capaciteJour: r.capaciteJour,
      totalJours: Math.round(r.total * 100) / 100,
      pic: Math.round(pic * 100) / 100,
      tauxOccupation: joursDispo ? Math.round((r.total / joursDispo) * 100) : null,
      joursSurcharge: joursSurcharge.slice(0, options.maxJours || 60),
      nbJoursSurcharge: joursSurcharge.length,
      courbe: [...r.jours.entries()].sort((a, b) => a[0] - b[0]).map(([i, v]) => ({ date: dateDe(cal, i), v: Math.round(v * 100) / 100 })),
    });
  }
  out.sort((a, b) => b.nbJoursSurcharge - a.nbJoursSurcharge || b.totalJours - a.totalJours);
  return { ok: true, ressources: out, inconnues: [...inconnues.values()], surchargees: out.filter((r) => r.nbJoursSurcharge).length };
}

// Nivellement : PROPOSITION, jamais application. L'outil dit de combien il
// faudrait décaler quoi, et ce que ça coûte sur la date de fin ; la décision de
// décaler appartient à celui qui répondra du retard.
export function nivellement(projet, taches, options = {}) {
  const maxIterations = options.maxIterations || 120;
  const decalages = new Map();
  const appliquer = () => taches.map((t) => {
    const d = decalages.get(t.id);
    if (!d) return t;
    const base = normaliserTache(t);
    return { ...base, contrainte: { type: "pas_avant", date: d.date } };
  });

  let plan = ordonnancer(projet, taches, options);
  if (!plan.ok) return { ok: false, erreurs: plan.erreurs, propositions: [] };
  const avant = { fin: plan.resume.fin, surcharges: charge(plan).surchargees, joursSurcharge: charge(plan).ressources.reduce((s, r) => s + r.nbJoursSurcharge, 0) };

  // Surcharges qu'aucun décalage ne résout : une seule tâche dépasse déjà la
  // capacité déclarée, ou les tâches en cause sont toutes commencées. On les
  // met de côté en les NOMMANT — boucler dessus donnerait un nivellement qui
  // tourne sans fin et une promesse de résolution qu'on ne tiendra pas.
  const irreductibles = [];
  for (let it = 0; it < maxIterations; it++) {
    const ch = charge(plan);
    const pire = ch.ressources.find((r) => r.nbJoursSurcharge > 0 && !irreductibles.some((x) => x.ressourceId === r.id));
    if (!pire) break;
    const jour0 = pire.joursSurcharge[0].date;
    const surLeJour = plan.taches.filter((t) => !t.synthese && t.statut !== "faite" && t.statut !== "abandonnee"
      && (t.affectations || []).some((a) => a.ressourceId === pire.id)
      && t.debut <= jour0 && t.fin >= jour0);
    const deplacables = surLeJour.filter((t) => t.statut === "a_faire");
    if (surLeJour.length < 2 || !deplacables.length) {
      irreductibles.push({
        ressourceId: pire.id, nom: pire.nom, date: jour0,
        motif: surLeJour.length < 2
          ? `« ${surLeJour[0]?.titre || "une tâche"} » mobilise à elle seule plus que la capacité déclarée de ${pire.nom} (${pire.capaciteJour} j/j) : il faut renforcer, sous-traiter ou allonger, pas décaler`
          : `toutes les tâches de ${pire.nom} ce jour-là sont déjà commencées : les décaler reviendrait à réécrire le passé`,
      });
      continue;
    }
    // On décale celle qui a le plus de marge — c'est la moins coûteuse. Quand
    // aucune n'a de marge (deux tâches critiques sur la même personne), on
    // décale quand même la plus courte : le conflit est réel, il se paie en
    // jours, et `coutJours` le dit. Refuser de bouger laisserait une surcharge
    // silencieuse, qui se paiera pareil mais sans être annoncée.
    deplacables.sort((a, b) => b.margeTotale - a.margeTotale || a.dureeJours - b.dureeJours
      || String(a.id).localeCompare(String(b.id)));
    const cible = deplacables[0];
    // ON NE DÉCALE PAS D'UN JOUR : on décale JUSTE APRÈS la fin de la tâche
    // concurrente qui se libère en premier. Le pas d'un jour paraît prudent
    // mais il fait osciller le choix d'un tour à l'autre (la tâche qu'on vient
    // de décaler gagne de la marge, donc c'est l'autre qu'on décale ensuite) et
    // les deux avancent en parallèle sans jamais se séparer.
    const finLaPlusProche = surLeJour.filter((x) => x.id !== cible.id).map((x) => x.fin).filter(Boolean).sort()[0];
    const apresConcurrente = finLaPlusProche ? ajouterJoursOuvres(plan.calendrier, finLaPlusProche, 1) : null;
    const dUnJour = ajouterJoursOuvres(plan.calendrier, cible.debut, 1);
    const nouveau = apresConcurrente && apresConcurrente > cible.debut ? apresConcurrente : dUnJour;
    if (!nouveau || nouveau <= cible.debut) break;
    decalages.set(cible.id, { date: nouveau, titre: cible.titre, origine: decalages.get(cible.id)?.origine || cible.debut });
    const suivant = ordonnancer(projet, appliquer(), options);
    if (!suivant.ok) break;
    plan = suivant;
  }

  const chFin = charge(plan);
  const cal = plan.calendrier;
  return {
    ok: true,
    propositions: [...decalages.entries()].map(([id, d]) => ({
      tacheId: id, titre: d.titre, de: d.origine, vers: d.date,
      jours: compterJoursOuvres(cal, d.origine, d.date) - 1,
    })),
    avant,
    apres: { fin: plan.resume.fin, surcharges: chFin.surchargees, joursSurcharge: chFin.ressources.reduce((s, r) => s + r.nbJoursSurcharge, 0) },
    resolu: chFin.surchargees === 0,
    irreductibles,
    coutJours: compterJoursOuvres(cal, avant.fin, plan.resume.fin) - 1,
  };
}

// ---------------------------------------------------------------------------
// Référence (baseline) et dérive
// ---------------------------------------------------------------------------

// Prendre une référence, c'est figer ce qu'on s'est engagé à tenir. Sans elle,
// un planning qui glisse d'une semaine par mois a toujours l'air à jour : il
// affiche des dates cohérentes, simplement ce ne sont plus les mêmes.
export function prendreReference(plan, { par = "", motif = "" } = {}) {
  if (!plan?.ok) return null;
  return {
    prise: new Date().toISOString(),
    par: texte(par, 120),
    motif: texte(motif, 300),
    fin: plan.resume.fin,
    debut: plan.resume.debut,
    taches: plan.taches.filter((t) => !t.synthese).map((t) => ({ id: t.id, titre: t.titre, debut: t.debut, fin: t.fin, duree: t.dureeJours, jalon: t.jalon })),
  };
}

export function derive(plan, reference) {
  if (!plan?.ok || !reference) return { ok: false, lignes: [], finEcart: null };
  const cal = plan.calendrier;
  const parId = new Map((reference.taches || []).map((t) => [t.id, t]));
  const lignes = [];
  for (const t of plan.taches) {
    if (t.synthese) continue;
    const r = parId.get(t.id);
    if (!r) { lignes.push({ id: t.id, titre: t.titre, nouvelle: true, ecart: null, jalon: t.jalon }); continue; }
    const ecart = r.fin && t.fin ? compterJoursOuvres(cal, r.fin, t.fin) - 1 : null;
    lignes.push({ id: t.id, titre: t.titre, jalon: t.jalon, referenceDebut: r.debut, referenceFin: r.fin, debut: t.debut, fin: t.fin, ecart, nouvelle: false });
  }
  const supprimees = (reference.taches || []).filter((r) => !plan.taches.some((t) => t.id === r.id))
    .map((r) => ({ id: r.id, titre: r.titre, supprimee: true }));
  const finEcart = reference.fin && plan.resume.fin ? compterJoursOuvres(cal, reference.fin, plan.resume.fin) - 1 : null;
  return {
    ok: true, reference: { prise: reference.prise, par: reference.par, fin: reference.fin },
    finEcart, lignes: lignes.concat(supprimees),
    glissements: lignes.filter((l) => (l.ecart || 0) > 0).sort((a, b) => b.ecart - a.ecart),
    avances: lignes.filter((l) => (l.ecart || 0) < 0),
  };
}

// ---------------------------------------------------------------------------
// Simulation « et si ? » — sans rien écrire
// ---------------------------------------------------------------------------

// Trois questions qu'on se pose vraiment : si cette tâche glisse de N jours,
// que perd-on ? si on l'allonge ? si on la supprime ? La réponse doit venir
// sans modifier le plan : une simulation qui écrit n'est pas une simulation.
export function simuler(projet, taches, modifications = [], options = {}) {
  const avant = ordonnancer(projet, taches, options);
  if (!avant.ok) return { ok: false, erreurs: avant.erreurs };
  const cal = avant.calendrier;

  const modifiees = taches.map((t) => {
    const m = modifications.find((x) => x.tacheId === t.id);
    if (!m) return t;
    const base = normaliserTache(t);
    const planifiee = avant.taches.find((x) => x.id === t.id);
    const out = { ...base };
    if (m.supprimee) return null;
    if (m.decalageJours) {
      const nouveauDebut = ajouterJoursOuvres(cal, planifiee?.debut || base.debutReel || projet.debut, Number(m.decalageJours));
      if (nouveauDebut) out.contrainte = { type: "pas_avant", date: nouveauDebut };
    }
    if (m.dureeJours != null) {
      out.dureeJours = Math.max(0, Math.round(Number(m.dureeJours)));
      if (out.statut === "a_faire") out.resteAFaire = out.dureeJours;
    }
    if (m.resteAFaire != null) out.resteAFaire = Math.max(0, Math.round(Number(m.resteAFaire)));
    if (Array.isArray(m.affectations)) out.affectations = m.affectations;
    return out;
  }).filter(Boolean);

  // Les liens qui pointaient vers une tâche supprimée sont retirés, sinon le
  // plan simulé serait invalide pour une raison sans rapport avec la question.
  const restants = new Set(modifiees.map((t) => t.id));
  const nettoyees = modifiees.map((t) => ({ ...t, liens: (t.liens || []).filter((l) => restants.has(l.deId)) }));

  const apres = ordonnancer(projet, nettoyees, options);
  if (!apres.ok) return { ok: false, erreurs: apres.erreurs };

  const jalonsAvant = new Map(avant.resume.jalons.map((j) => [j.id, j]));
  const impacts = apres.resume.jalons.map((j) => {
    const a = jalonsAvant.get(j.id);
    return {
      id: j.id, titre: j.titre, avant: a?.date || null, apres: j.date,
      ecart: a?.date && j.date ? compterJoursOuvres(cal, a.date, j.date) - 1 : null,
    };
  }).filter((i) => i.ecart);

  const critiquesAvant = new Set(avant.resume.critiques);
  return {
    ok: true,
    finAvant: avant.resume.fin, finApres: apres.resume.fin,
    ecartJours: compterJoursOuvres(cal, avant.resume.fin, apres.resume.fin) - 1,
    impacts,
    nouvellesCritiques: apres.taches.filter((t) => t.critique && !t.synthese && !critiquesAvant.has(t.id)).map((t) => ({ id: t.id, titre: t.titre })),
    sortiesDuCritique: avant.taches.filter((t) => t.critique && !t.synthese && !apres.resume.critiques.includes(t.id)).map((t) => ({ id: t.id, titre: t.titre })),
    chargeAvant: charge(avant).surchargees,
    chargeApres: charge(apres).surchargees,
  };
}

// ---------------------------------------------------------------------------
// Chemins critiques nommés
// ---------------------------------------------------------------------------

// Lister les tâches critiques ne suffit pas : on veut LA chaîne, dans l'ordre,
// pour savoir où appuyer. Un chemin critique est une suite de tâches à marge
// nulle reliées entre elles.
export function cheminsCritiques(plan) {
  if (!plan?.ok) return [];
  const critiques = plan.taches.filter((t) => t.critique && !t.synthese);
  const parId = new Map(critiques.map((t) => [t.id, t]));
  const aSuccesseur = new Set();
  for (const t of critiques) for (const l of t.liens || []) if (parId.has(l.deId)) aSuccesseur.add(l.deId);
  const departs = critiques.filter((t) => !(t.liens || []).some((l) => parId.has(l.deId)));
  const chaines = [];
  const suivre = (t, chaine) => {
    chaine.push(t);
    const suivants = critiques.filter((s) => (s.liens || []).some((l) => l.deId === t.id));
    if (!suivants.length) { chaines.push([...chaine]); }
    else for (const s of suivants) suivre(s, chaine);
    chaine.pop();
  };
  for (const d of departs) suivre(d, []);
  return chaines
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
    .map((c) => ({
      duree: c.reduce((s, t) => s + (t.dureePlanifiee || 0), 0),
      debut: c[0]?.debut, fin: c[c.length - 1]?.fin,
      taches: c.map((t) => ({ id: t.id, titre: t.titre, debut: t.debut, fin: t.fin, duree: t.dureeJours, statut: t.statut })),
    }));
}

// ---------------------------------------------------------------------------
// Modèles : capturer une trame, la rejouer sur une autre date
// ---------------------------------------------------------------------------

// Aucune trame n'est livrée avec le module. Un modèle imposé par l'éditeur
// décrit son idée du métier, pas le vôtre, et se contourne en trois semaines.
// Un modèle se CAPTURE depuis un projet qui a tourné : c'est le seul contenu
// dont on sait qu'il correspond à la façon dont la maison travaille.
export function modeleDepuisProjet(projet, taches, plan = null, meta = {}) {
  const p = normaliserProjet(projet);
  const norm = taches.map(normaliserTache);
  const calc = plan?.ok ? new Map(plan.taches.map((t) => [t.id, t])) : new Map();
  const cal = plan?.calendrier || construireCalendrier({ debut: p.debut, joursOuvres: p.calendrier.joursOuvres, feries: p.calendrier.feries, fermetures: p.calendrier.fermetures });
  const ref = new Map(norm.map((t, i) => [t.id, `T${i + 1}`]));
  return {
    nom: texte(meta.nom || p.nom, 160),
    description: texte(meta.description || "", 1000),
    origineProjetId: p.id,
    calendrier: p.calendrier,
    roles: [...new Set(norm.flatMap((t) => (t.affectations || []).map((a) => p.ressources.find((r) => r.id === a.ressourceId)?.role || "")).filter(Boolean))],
    taches: norm.map((t) => {
      const c = calc.get(t.id);
      // L'offset est mesuré en jours ouvrés depuis le début du projet source.
      // Il ne sert qu'aux tâches sans prédécesseur : pour les autres, la place
      // se déduit des liens, et figer une date les ferait diverger.
      const offset = c?.debut ? Math.max(0, (compterJoursOuvres(cal, p.debut, c.debut) || 1) - 1) : 0;
      return {
        ref: ref.get(t.id),
        titre: t.titre, lot: t.lot, jalon: t.jalon,
        dureeJours: t.dureeJours,
        parentRef: t.parentId ? ref.get(t.parentId) || null : null,
        liens: (t.liens || []).filter((l) => ref.has(l.deId)).map((l) => ({ ref: ref.get(l.deId), type: l.type, decalage: l.decalage })),
        offset,
        responsable: "", // un modèle ne transporte pas les personnes : elles changent
        role: p.ressources.find((r) => r.id === (t.affectations || [])[0]?.ressourceId)?.role || "",
        budgetPrevu: t.budgetPrevu || 0,
        note: t.note || "",
        ordre: t.ordre,
      };
    }),
  };
}

// Instancie un modèle. `sens` = "depuis" (la date pivot est le début) ou
// "avant" (rétroplanning : la date pivot est la fin visée, et tout se cale à
// rebours). Le rétroplanning est le cas le plus fréquent d'un réseau : la
// rentrée, l'audit, la date de dépôt ne se négocient pas.
export function instancierModele(modele, { datePivot, sens = "depuis", calendrier = null } = {}) {
  const pivot = estDateValide(datePivot) ? isoJour(datePivot) : isoJour(new Date());
  const calSpec = calendrier || modele.calendrier || {};
  const cal = construireCalendrier({
    debut: ajoutJoursCalendaires(pivot, -800),
    joursOuvres: calSpec.joursOuvres, feries: calSpec.feries !== false,
    alsaceMoselle: !!calSpec.alsaceMoselle, fermetures: calSpec.fermetures || [],
  });

  const taches = (modele.taches || []).map((t) => ({
    id: t.ref, titre: t.titre, lot: t.lot, jalon: !!t.jalon,
    dureeJours: t.dureeJours, parentId: t.parentRef || null,
    liens: (t.liens || []).map((l) => ({ deId: l.ref, type: l.type, decalage: l.decalage })),
    budgetPrevu: t.budgetPrevu || 0, note: t.note || "", ordre: t.ordre || 0,
    role: t.role || "", offset: t.offset || 0,
  }));

  // Les tâches sans prédécesseur portent leur offset comme « pas avant » ;
  // les autres se laissent porter par les liens.
  const avecContraintes = (debutProjet) => taches.map((t) => ({
    ...t,
    contrainte: t.liens.length ? { type: "auplustot", date: null }
      : { type: "pas_avant", date: ajouterJoursOuvres(cal, debutProjet, t.offset || 0) },
  }));

  // Premier calcul à blanc pour mesurer l'étendue, puis translation si l'on
  // planifie à rebours.
  const essai = ordonnancer({ debut: pivot, calendrier: calSpec }, avecContraintes(pivot), { aujourdhui: ajoutJoursCalendaires(pivot, -800) });
  let debutProjet = pivot;
  if (sens === "avant" && essai.ok) {
    const etendue = (compterJoursOuvres(essai.calendrier, pivot, essai.resume.fin) || 1) - 1;
    debutProjet = ajouterJoursOuvres(cal, pivot, -etendue) || pivot;
  }
  return {
    debutProjet,
    etendueJours: essai.ok ? (compterJoursOuvres(essai.calendrier, pivot, essai.resume.fin) || 1) : null,
    taches: avecContraintes(debutProjet).map(({ offset, role, ...t }) => ({ ...t, role })),
  };
}

// ---------------------------------------------------------------------------
// Vue portefeuille
// ---------------------------------------------------------------------------

// Un portefeuille n'est pas une liste de projets : c'est la réponse à « lequel
// me coûtera cher si je ne m'en occupe pas cette semaine ». On ne calcule donc
// pas une note de santé sur 100 — un score agrège des choses de natures
// différentes et se laisse tirer vers le haut. On remonte des FAITS, comptés.
export function portefeuille(projets, plansParProjet) {
  const lignes = projets.map((p) => {
    const plan = plansParProjet[p.id];
    if (!plan?.ok) {
      return { id: p.id, nom: p.nom, campusId: p.campusId, statut: p.statut, calculable: false,
        motif: plan?.erreurs?.[0]?.message || "plan non calculable", alertes: [{ niveau: "bloquant", texte: "planning non calculable" }] };
    }
    const r = plan.resume;
    const d = p.reference ? derive(plan, p.reference) : null;
    const ch = charge(plan);
    const alertes = [];
    if (r.echeancesDepassees.length) alertes.push({ niveau: "bloquant", texte: `${r.echeancesDepassees.length} échéance(s) dépassée(s)` });
    if (d?.finEcart > 0) alertes.push({ niveau: d.finEcart > 15 ? "bloquant" : "important", texte: `${d.finEcart} j de retard sur la référence` });
    if (r.conflits.length) alertes.push({ niveau: "important", texte: `${r.conflits.length} date(s) imposée(s) en conflit` });
    if (ch.surchargees) alertes.push({ niveau: "important", texte: `${ch.surchargees} ressource(s) en surcharge` });
    if (!p.reference && STATUTS_PROJET[p.statut]?.actif && p.statut !== "cadrage") alertes.push({ niveau: "conseille", texte: "aucune référence figée : la dérive ne peut pas être mesurée" });
    return {
      id: p.id, nom: p.nom, campusId: p.campusId, statut: p.statut, pilote: p.pilote,
      calculable: true, debut: r.debut, fin: r.fin, avancement: r.avancement,
      resteAFaireJours: r.resteAFaireJours, taches: r.taches,
      prochainJalon: r.jalons.find((j) => j.statut !== "faite") || null,
      derive: d?.finEcart ?? null,
      budgetPrevu: r.budgetPrevu, budgetDepense: r.budgetDepense, budgetProjet: r.budgetProjet,
      surcharges: ch.surchargees, critiques: r.critiques.length,
      alertes,
    };
  });
  const rang = { bloquant: 0, important: 1, conseille: 2 };
  lignes.sort((a, b) => {
    const pa = Math.min(...(a.alertes.map((x) => rang[x.niveau]) || [9]), 9);
    const pb = Math.min(...(b.alertes.map((x) => rang[x.niveau]) || [9]), 9);
    return pa - pb || String(a.fin || "9").localeCompare(String(b.fin || "9"));
  });
  return {
    lignes,
    actifs: lignes.filter((l) => STATUTS_PROJET[l.statut]?.actif).length,
    enAlerte: lignes.filter((l) => l.alertes.some((a) => a.niveau === "bloquant")).length,
    nonCalculables: lignes.filter((l) => !l.calculable).length,
  };
}

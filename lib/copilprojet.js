// Comité de pilotage d'un projet — ordre du jour alimenté par le plan.
//
// POURQUOI CE MODULE EXISTE. Un comité hebdomadaire consomme, chaque semaine,
// une demi-heure de préparation à quelqu'un qui relit le planning, retrouve ce
// qui a bougé et retape les mêmes rubriques. Au bout d'un mois, cette personne
// recopie l'ordre du jour de la semaine précédente en changeant les dates. Le
// comité continue de se tenir, mais il ne regarde plus le projet.
//
// Ici, l'ordre du jour se DÉDUIT du plan : ce qui a glissé depuis la dernière
// séance, les échéances franchies, les tâches critiques qui auraient dû partir,
// les surcharges, les décisions de la séance précédente arrivées à terme. Rien
// n'est saisi deux fois, et rien n'est oublié parce que personne n'a eu le temps.
//
// DEUX RÈGLES QUI NE SE NÉGOCIENT PAS :
//
//   1. AUCUNE PHRASE N'EST INVENTÉE. Le module est déterministe : il ne passe
//      par aucun modèle de langage. Un ordre du jour part par courriel à des
//      gens qui décideront sur cette base ; une formulation « plausible » y
//      ferait plus de dégâts qu'une rubrique manquante. Quand il n'y a rien à
//      signaler, il le DIT — il ne meuble pas.
//
//   2. ON N'ÉCRASE JAMAIS UNE SAISIE HUMAINE. Dès que quelqu'un touche l'ordre
//      du jour, le remplissage automatique se retire définitivement de cette
//      séance (drapeau `agendaAuto`). Un outil qui réécrit par-dessus ce qu'on
//      vient d'ajouter se fait désactiver dans la semaine, et à raison.

import { construireCalendrier, indexJour, compterJoursOuvres, ajoutJoursCalendaires, isoJour, jourSemaine, JOURS_LABEL } from "./projets.js";

const texte = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const frDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "date à fixer");
const frCourt = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "—");

// ---------------------------------------------------------------------------
// Cadence : la récurrence qui fait exister les séances
// ---------------------------------------------------------------------------

// La cadence était jusqu'ici une chaîne libre affichée en bas de la convocation
// (« hebdomadaire »). Elle décrivait une intention sans rien produire : les
// séances se créaient à la main, une par une, et « chaque semaine » tenait à ce
// que quelqu'un y pense chaque semaine.
export const CADENCES = {
  hebdo: { label: "Hebdomadaire", jours: 7 },
  quinzaine: { label: "Toutes les deux semaines", jours: 14 },
  mensuelle: { label: "Mensuelle", jours: null }, // même quantième, voir plus bas
};

export const HORIZON_SEANCES_JOURS = 70; // dix semaines : assez pour réserver, pas trop pour encombrer

export function normaliserRegle(r = {}) {
  if (!r || !CADENCES[r.type]) return null;
  const js = Number(r.jourSemaine);
  return {
    type: r.type,
    // Jour de semaine pour hebdo/quinzaine ; quantième du mois pour mensuelle.
    jourSemaine: js >= 1 && js <= 7 ? js : 2,
    quantieme: Math.max(1, Math.min(28, Number(r.quantieme) || 1)),
    heure: /^\d{2}:\d{2}$/.test(String(r.heure || "")) ? r.heure : "09:00",
    lieu: texte(r.lieu, 160),
    lien: texte(r.lien, 300),
    horizonJours: Math.max(14, Math.min(365, Number(r.horizonJours) || HORIZON_SEANCES_JOURS)),
    // Remplissage automatique de l'ordre du jour, et combien de jours avant la
    // séance. Par défaut 10 : la convocation part à J-7, il faut donc que le
    // brouillon existe AVANT, pour laisser le temps de le relire.
    odjAuto: r.odjAuto !== false,
    odjAvantJours: Math.max(1, Math.min(30, Number(r.odjAvantJours) || 10)),
  };
}

export function libelleRegle(r) {
  if (!r) return "";
  if (r.type === "mensuelle") return `Mensuelle, le ${r.quantieme} de chaque mois à ${r.heure}`;
  return `${CADENCES[r.type].label}, le ${JOURS_LABEL[r.jourSemaine]} à ${r.heure}`;
}

// Dates à créer entre aujourd'hui et l'horizon, en excluant celles qui existent
// déjà. IDEMPOTENT : appelée deux fois le même jour, elle ne propose rien la
// seconde fois. Un cron qui crée un doublon de séance envoie deux convocations
// pour la même réunion, et le comité arrive en ordre dispersé.
export function prochainesSeances(regle, { aujourdhui, existantes = [], calendrier = null } = {}) {
  const r = normaliserRegle(regle);
  if (!r) return [];
  const auj = isoJour(aujourdhui || new Date());
  const fin = ajoutJoursCalendaires(auj, r.horizonJours);
  const cal = calendrier || construireCalendrier({ debut: auj, fin: ajoutJoursCalendaires(fin, 30) });
  const deja = new Set(existantes.map((s) => String(s.date || "").slice(0, 10)).filter(Boolean));

  // Premier candidat.
  let d;
  if (r.type === "mensuelle") {
    d = `${auj.slice(0, 7)}-${String(r.quantieme).padStart(2, "0")}`;
    if (d < auj) {
      const [an, mo] = auj.split("-").map(Number);
      const suivant = mo === 12 ? `${an + 1}-01` : `${an}-${String(mo + 1).padStart(2, "0")}`;
      d = `${suivant}-${String(r.quantieme).padStart(2, "0")}`;
    }
  } else {
    d = auj;
    for (let i = 0; i < 7 && jourSemaine(d) !== r.jourSemaine; i++) d = ajoutJoursCalendaires(d, 1);
  }

  const out = [];
  for (let garde = 0; garde < 120 && d <= fin; garde++) {
    // Une séance tombant un jour férié ou un jour de fermeture est REPORTÉE au
    // jour ouvré suivant, pas supprimée : un comité sauté est un comité qu'on ne
    // rattrape pas, et le 1er mai revient tous les ans.
    let jour = d;
    if (!cal.idx.has(jour)) {
      const i = indexJour(cal, jour, 1);
      if (i != null) jour = cal.jours[i];
    }
    if (jour >= auj && jour <= fin && !deja.has(jour) && !out.includes(jour)) out.push(jour);

    if (r.type === "mensuelle") {
      const [an, mo] = d.split("-").map(Number);
      const suivant = mo === 12 ? `${an + 1}-01` : `${an}-${String(mo + 1).padStart(2, "0")}`;
      d = `${suivant}-${String(r.quantieme).padStart(2, "0")}`;
    } else {
      d = ajoutJoursCalendaires(d, CADENCES[r.type].jours);
    }
  }
  return out.map((date) => ({ date, time: r.heure, place: r.lieu, link: r.lien }));
}

// ---------------------------------------------------------------------------
// L'ordre du jour, déduit du plan
// ---------------------------------------------------------------------------

const MINUTES_MAX = 60;

// `points` porte des rubriques structurées ; `versAgendaItems` les aplatit au
// format que la convocation sait déjà rendre. On garde la structure parce que
// l'écran, lui, a besoin de la gravité et de la décision attendue.
export function ordreDuJour({
  projet, plan, charge = null, derive = null, journal = [],
  seancePrecedente = null, aujourdhui = null, horizonJours = 21,
} = {}) {
  const auj = isoJour(aujourdhui || new Date());
  const points = [];
  const ajouter = (p) => { points.push({ minutes: 5, gravite: "info", porteur: "", ...p }); };

  if (!plan?.ok) {
    return {
      ok: false, points: [{
        cle: "plan-casse", titre: "Le planning n'est pas calculable", minutes: 10, gravite: "bloquant",
        porteur: projet?.pilote || "", decision: "reprendre les enchaînements avant le prochain comité : tant que le plan ne se calcule pas, aucune date annoncée ici ne vaut",
      }],
      chiffres: null, vide: false,
    };
  }

  const r = plan.resume;
  const limite = ajoutJoursCalendaires(auj, horizonJours);
  const depuis = seancePrecedente?.date ? String(seancePrecedente.date).slice(0, 10) : null;

  // 1. Trois chiffres, toujours les mêmes, dans le même ordre. C'est ce qui
  //    permet de comparer deux comptes rendus à trois mois d'écart.
  const chiffres = {
    fin: r.fin,
    derive: derive?.finEcart ?? null,
    avancement: Math.round((r.avancement || 0) * 100),
    resteAFaire: r.resteAFaireJours,
    critiques: r.critiques.length,
  };
  ajouter({
    cle: "avancement", titre: "Point d'avancement", minutes: 5, porteur: projet?.pilote || "",
    decision: "prendre acte",
    detail: `Fin prévue ${frDate(r.fin)} · avancement ${chiffres.avancement} % · reste à faire ${r.resteAFaireJours} j`
      + (derive ? ` · ${derive.finEcart > 0 ? `${derive.finEcart} j de retard sur la référence` : derive.finEcart < 0 ? `${-derive.finEcart} j d'avance` : "conforme à la référence"}`
        : " · aucune référence figée : la dérive ne peut pas être mesurée"),
  });

  // 2. Décisions de la séance précédente arrivées à terme. Un comité qui ne
  //    reprend pas ses propres décisions les transforme en vœux.
  if (seancePrecedente?.resolutions?.length) {
    const echues = seancePrecedente.resolutions.filter((x) => !x.dueDate || x.dueDate <= auj);
    if (echues.length) {
      ajouter({
        cle: "decisions-precedentes", minutes: 10, gravite: "important",
        titre: `Suivi des ${echues.length} décision(s) du comité du ${frCourt(seancePrecedente.date)}`,
        decision: "pour chacune : soldée, ou nouvelle échéance avec son motif",
        detail: echues.slice(0, 8).map((x) => `${texte(x.text, 160)}${x.owner ? ` — ${x.owner}` : ""}${x.dueDate ? ` (pour le ${frCourt(x.dueDate)})` : ""}`).join(" · "),
      });
    }
  }

  // 3. Ce qui a bougé depuis la dernière séance, AVEC LE MOTIF SIGNÉ. C'est la
  //    rubrique qu'aucun outil ne sait produire : elle suppose qu'on ait exigé
  //    une raison au moment où la date a bougé, pas qu'on la reconstitue après.
  const mouvements = (journal || []).filter((j) => !depuis || String(j.at || "").slice(0, 10) > depuis);
  const jalonsDeplaces = mouvements.flatMap((j) => (j.mouvements || []).map((m) => ({ ...m, motif: j.motif, par: j.par, at: j.at })));
  if (jalonsDeplaces.length) {
    ajouter({
      cle: "mouvements", minutes: 10, gravite: jalonsDeplaces.length > 2 ? "important" : "info",
      titre: `${jalonsDeplaces.length} jalon(s) déplacé(s) depuis ${depuis ? `le comité du ${frCourt(depuis)}` : "la création du projet"}`,
      decision: "valider les reports, ou refuser et arbitrer les moyens",
      detail: jalonsDeplaces.slice(0, 6).map((m) => `${texte(m.titre, 80)} : ${frCourt(m.de)} → ${frCourt(m.vers)}${m.motif ? ` (${texte(m.motif, 120)})` : " — sans motif consigné"}`).join(" · "),
    });
  } else if (depuis) {
    ajouter({ cle: "mouvements", titre: "Aucun jalon déplacé depuis le dernier comité", minutes: 2, decision: "prendre acte" });
  }

  // 4. Points bloquants — une entrée par échéance franchie. Elles ne se
  //    regroupent pas : chacune appelle un arbitrage distinct.
  for (const e of r.echeancesDepassees.slice(0, 4)) {
    ajouter({
      cle: `echeance-${e.id}`, minutes: 10, gravite: "bloquant",
      titre: `« ${texte(e.titre, 80)} » dépasse son échéance de ${e.retard} jour(s)`,
      decision: "arbitrer : réduire le contenu, renforcer les moyens, ou acter la nouvelle date et prévenir qui en dépend",
      detail: `échéance ${frDate(e.echeance)} · fin prévue ${frDate(e.fin)}`,
    });
  }

  // 5. Le démarrage, en DEUX signaux qu'il ne faut pas confondre.
  //
  //    (a) RETARD DE LANCEMENT — la tâche devait partir à une date sur laquelle
  //    on s'était engagé, et elle n'est pas partie. Ce constat n'est possible
  //    qu'avec une référence figée : le plan recalculé, lui, replace toujours
  //    une tâche non commencée à aujourd'hui, et le retard y disparaît.
  const enRetardDeLancement = (derive?.lignes || [])
    .map((l) => ({ l, t: plan.taches.find((x) => x.id === l.id) }))
    .filter(({ l, t }) => t && !t.synthese && t.statut === "a_faire" && l.referenceDebut && l.referenceDebut < auj);
  if (enRetardDeLancement.length) {
    ajouter({
      cle: "retard-lancement", minutes: 10, gravite: "bloquant",
      titre: `${enRetardDeLancement.length} tâche(s) devaient être lancées et ne le sont pas`,
      decision: "nommer qui lance quoi cette semaine, ou reconnaître que la référence n'est plus tenable",
      detail: enRetardDeLancement.slice(0, 6).map(({ l, t }) => `${texte(t.titre, 70)} : prévue le ${frCourt(l.referenceDebut)}${t.responsable ? ` — ${t.responsable}` : " — sans responsable"}`).join(" · "),
      porteur: enRetardDeLancement.find(({ t }) => t.responsable)?.t.responsable || projet?.pilote || "",
    });
  }

  //    (b) À LANCER D'ICI LE PROCHAIN COMITÉ — celles qui partent dans la
  //    semaine. Ce n'est PAS un retard : une tâche qui commence aujourd'hui
  //    commence à l'heure, et le dire autrement décrédibilise les vraies
  //    alertes en trois séances. On ne le remonte comme point à trancher que
  //    si personne n'est nommé dessus.
  const fenetre = ajoutJoursCalendaires(auj, 7);
  const aLancer = plan.taches.filter((t) => !t.synthese && t.critique && t.statut === "a_faire"
    && t.debut && t.debut >= auj && t.debut <= fenetre
    && !enRetardDeLancement.some(({ t: x }) => x.id === t.id));
  if (aLancer.length) {
    const orphelines = aLancer.filter((t) => !t.responsable);
    ajouter({
      cle: "a-lancer", minutes: orphelines.length ? 10 : 5,
      gravite: orphelines.length ? "important" : "info",
      titre: orphelines.length
        ? `${orphelines.length} tâche(s) du chemin critique à lancer cette semaine SANS responsable`
        : `${aLancer.length} tâche(s) du chemin critique à lancer d'ici le prochain comité`,
      decision: orphelines.length ? "nommer un responsable par tâche, séance tenante" : "confirmer le lancement",
      detail: aLancer.slice(0, 6).map((t) => `${frCourt(t.debut)} — ${texte(t.titre, 70)}${t.responsable ? ` — ${t.responsable}` : " — sans responsable"}`).join(" · "),
      porteur: aLancer.find((t) => t.responsable)?.responsable || projet?.pilote || "",
    });
  }

  // 6. Dates imposées en conflit : quelqu'un s'est engagé sur une date que le
  //    plan ne tient pas. Ça se règle en comité, pas dans un tableur.
  if (r.conflits.length) {
    ajouter({
      cle: "conflits", minutes: 10, gravite: "important",
      titre: `${r.conflits.length} date(s) imposée(s) que les prédécesseurs ne libèrent pas`,
      decision: "tenir l'engagement en changeant l'amont, ou renégocier la date avec le tiers",
      detail: r.conflits.slice(0, 4).map((c) => `${texte(c.titre, 70)} : ${texte(c.conflits[0], 140)}`).join(" · "),
    });
  }

  // 7. Charge : on ne remonte que ce qui dépasse, et on rappelle que le coût
  //    du décalage est chiffrable — le comité arbitre en connaissant le prix.
  const surchargees = (charge?.ressources || []).filter((x) => x.nbJoursSurcharge > 0);
  if (surchargees.length) {
    ajouter({
      cle: "charge", minutes: 10, gravite: "important",
      titre: `${surchargees.length} personne(s) au-delà de la capacité déclarée`,
      decision: "arbitrer : renforcer, sous-traiter, ou décaler en assumant le coût en jours",
      detail: surchargees.slice(0, 5).map((x) => `${texte(x.nom, 60)} : ${x.nbJoursSurcharge} j au-dessus de ${x.capaciteJour} j/j (pic ${x.pic})`).join(" · "),
    });
  }

  // 8. Ce qui tombe d'ici le prochain horizon — pour que le comité prépare au
  //    lieu de constater.
  const aVenir = r.jalons.filter((j) => j.statut !== "faite" && j.date && j.date >= auj && j.date <= limite);
  ajouter({
    cle: "echeances", minutes: 5,
    titre: aVenir.length ? `Prochaines échéances (${horizonJours} jours) : ${aVenir.length} jalon(s)` : `Aucun jalon dans les ${horizonJours} prochains jours`,
    decision: aVenir.length ? "confirmer que chacun est tenable" : "prendre acte",
    detail: aVenir.slice(0, 8).map((j) => `${frCourt(j.date)} — ${texte(j.titre, 70)}${j.echeance ? " (sous échéance)" : ""}`).join(" · "),
  });

  // Total borné : un ordre du jour de deux heures ne se tient pas, il se subit.
  // On rabote les rubriques informatives avant les bloquantes.
  let total = points.reduce((s, p) => s + p.minutes, 0);
  for (const p of [...points].sort((a, b) => (a.gravite === "bloquant" ? 1 : 0) - (b.gravite === "bloquant" ? 1 : 0))) {
    if (total <= MINUTES_MAX) break;
    const reduit = Math.max(2, Math.floor(p.minutes / 2));
    total -= p.minutes - reduit;
    p.minutes = reduit;
  }

  const rienASignaler = !points.some((p) => p.gravite !== "info");
  return {
    ok: true, chiffres, points, total: points.reduce((s, p) => s + p.minutes, 0),
    vide: rienASignaler,
    note: rienASignaler
      ? "Rien ne bloque ce projet cette semaine : ordre du jour court, centré sur les échéances à venir."
      : "",
  };
}

// Aplatissement au format de la convocation (`agendaItems` : texte + porteur).
export function versAgendaItems(odj) {
  if (!odj?.points) return [];
  return odj.points.map((p) => ({
    text: `${p.titre}${p.detail ? ` — ${p.detail}` : ""}${p.decision ? ` → ${p.decision}` : ""} (${p.minutes} min)`.slice(0, 900),
    owner: p.porteur || "",
  }));
}

// Rendu Markdown, pour l'écran et pour l'export.
export function versMarkdown(odj, { projet, seance } = {}) {
  if (!odj?.points) return "";
  const l = [`# Ordre du jour — ${projet?.nom || "projet"}${seance?.date ? ` — ${frDate(seance.date)}` : ""}`, ""];
  if (odj.note) l.push(`_${odj.note}_`, "");
  odj.points.forEach((p, i) => {
    l.push(`## ${i + 1}. ${p.titre} *(${p.minutes} min${p.porteur ? `, ${p.porteur}` : ""})*`);
    if (p.detail) l.push("", p.detail);
    if (p.decision) l.push("", `**Décision attendue :** ${p.decision}`);
    l.push("");
  });
  l.push(`_Total ${odj.total} min. Ordre du jour établi depuis le planning du projet, sans reformulation : chaque ligne renvoie à une donnée du plan._`);
  return l.join("\n");
}

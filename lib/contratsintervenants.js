// Contrats des intervenants — logique pure, aucune I/O.
//
// CE QUI SE JOUE ICI N'EST PAS DE L'ADMINISTRATIF. Les manquements du droit du
// travail ne se constatent pas à l'échéance : ils se constatent des mois après,
// devant le conseil de prud'hommes ou l'URSSAF, et ils sont alors irréparables.
// Un module de contrats qui se contente de stocker des dates rate l'essentiel.
//
// LES QUATRE RISQUES QUE CE MODULE EXISTE POUR VOIR VENIR :
//
//   1. LA POURSUITE AU-DELÀ DU TERME. Un CDD qui continue après sa date de fin
//      devient un CDI, sans que personne n'ait rien signé (L. 1243-11). C'est
//      l'échéance la plus coûteuse à manquer, et la plus facile à manquer :
//      rien ne se passe le jour du terme, le cours a lieu comme la veille.
//
//   2. LE DÉFAUT D'ÉCRIT. Un CDD non établi par écrit et transmis dans les deux
//      jours ouvrables suivant l'embauche est réputé à durée indéterminée
//      (L. 1242-12 et L. 1242-13). Le motif de recours manquant produit le même
//      effet. Ce sont des requalifications quasi automatiques.
//
//   3. LE DÉLAI DE CARENCE ENTRE DEUX CDD. C'est le risque propre aux
//      organismes de formation, et celui que seul un logiciel peut voir : on
//      réembauche le même vacataire, sur la même matière, d'une année sur
//      l'autre. Enchaîner deux CDD sur le même poste sans respecter le délai de
//      carence expose à la requalification (L. 1244-3). Personne ne tient ce
//      calcul à la main sur trente intervenants.
//
//   4. LA DÉCLARATION PRÉALABLE À L'EMBAUCHE. Elle se fait AVANT la première
//      heure travaillée. Faite après, elle ne répare rien : l'absence de
//      déclaration caractérise le travail dissimulé.
//
// ET UNE DISTINCTION QUI N'EST PAS NÉGOCIABLE :
//
//   UN PRESTATAIRE N'A PAS DE CONTRAT DE TRAVAIL. Lui appliquer une période
//   d'essai ou une déclaration d'embauche, c'est produire exactement les pièces
//   qui serviront à démontrer un lien de subordination — ce que le module de
//   paie refuse déjà de faire dans l'autre sens. Il relève d'un contrat de
//   prestation, avec sa propre obligation : l'attestation de vigilance.
//
// CE QUE LE MODULE NE FAIT PAS : appliquer une convention collective. Celle des
// organismes de formation privés n'est pas celle de l'enseignement privé, les
// minima et les durées d'essai en dépendent, et inventer une règle produirait
// une contrainte fausse présentée comme applicable. Elle est DÉCLARÉE.
//
// ⚠️ Durées, délais et seuils à revérifier avant mise en œuvre : ils dépendent
// de la convention collective applicable et ont évolué.

const jour = 864e5;
const ecart = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);
const isoPlus = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * jour).toISOString().slice(0, 10);

export const NATURES = {
  cdi: { label: "Contrat à durée indéterminée", salarie: true, terme: false },
  cdd: { label: "Contrat à durée déterminée", salarie: true, terme: true },
  prestation: { label: "Contrat de prestation", salarie: false, terme: true },
};

// Motifs de recours licites. Un CDD sans motif est réputé à durée indéterminée :
// la liste est fermée, et « besoin de personnel » n'en fait pas partie.
export const MOTIFS_CDD = {
  remplacement: "Remplacement d'un salarié absent",
  accroissement: "Accroissement temporaire d'activité",
  saisonnier: "Emploi à caractère saisonnier",
  usage: "Usage constant dans le secteur (contrat d'usage)",
};

// Transmission de l'écrit : deux jours ouvrables suivant l'embauche.
export const DELAI_ECRIT_JOURS = 2;
// Attestation de vigilance : renouvelée tous les six mois pour les contrats
// dépassant le seuil réglementaire.
export const VIGILANCE_MOIS = 6;
export const VIGILANCE_SEUIL_EUROS = 5000;
// À partir de quand on prévient sur un terme qui approche.
export const PREAVIS_TERME_JOURS = 45;

// --- Délai de carence entre deux CDD sur le même poste -----------------------
// Un tiers de la durée du contrat précédent s'il a duré quatorze jours ou plus,
// la moitié en deçà. Le calcul se fait en jours d'ouverture de l'entreprise ;
// on l'approxime en jours calendaires, ce qui est le sens prudent — un délai
// calculé plus long que le délai réel ne fait courir aucun risque.
export function carenceRequise(precedent = {}) {
  const duree = ecart(precedent.dateDebut, precedent.dateFin);
  if (duree == null || duree <= 0) return null;
  const jours = duree >= 14 ? Math.ceil(duree / 3) : Math.ceil(duree / 2);
  return {
    dureePrecedente: duree, carenceJours: jours,
    finCarence: precedent.dateFin ? isoPlus(precedent.dateFin, jours) : null,
    regle: duree >= 14 ? "un tiers de la durée du contrat précédent" : "la moitié de la durée du contrat précédent",
  };
}

// --- Validation ---------------------------------------------------------------

export function validateContrat(c = {}) {
  const errors = [], warnings = [];
  const n = NATURES[c.nature];
  if (!n) { errors.push(`nature requise (${Object.keys(NATURES).join(", ")})`); return { ok: false, errors, warnings }; }
  if (!c.teacherId) errors.push("intervenant requis");
  if (!c.dateDebut) errors.push("date de début requise");

  if (n.terme) {
    if (!c.dateFin) errors.push(`${n.label} sans terme : un contrat à durée déterminée doit comporter une date de fin`);
    else if (c.dateDebut && c.dateFin < c.dateDebut) errors.push("terme antérieur au début");
  }

  if (c.nature === "cdd") {
    // Sans motif de recours, le contrat est réputé à durée indéterminée.
    if (!MOTIFS_CDD[c.motif]) {
      errors.push("motif de recours requis : un CDD sans motif est réputé à durée indéterminée (L. 1242-12)");
    }
    if (c.motif === "remplacement" && !String(c.remplace || "").trim()) {
      errors.push("le motif « remplacement » exige de nommer la personne remplacée (L. 1242-12)");
    }
  }

  if (n.salarie) {
    if (!c.conventionCollective) {
      warnings.push("convention collective non déclarée : les minima et la durée d'essai en dépendent, et l'application ne les devine pas");
    }
    if (c.dureeEssaiJours != null && Number(c.dureeEssaiJours) < 0) errors.push("durée de période d'essai invalide");
  } else {
    // Le prestataire n'a pas de contrat de travail : ces notions n'ont pas
    // d'objet, et les porter serait produire une pièce à charge.
    if (c.dureeEssaiJours) errors.push("un contrat de prestation ne comporte pas de période d'essai : cette mention servirait à démontrer un lien de subordination");
    if (c.dpaeLe) errors.push("un prestataire ne fait pas l'objet d'une déclaration préalable à l'embauche");
    if (!String(c.societe || "").trim()) errors.push("société prestataire requise");
  }

  if (c.montant != null && Number(c.montant) < 0) errors.push("montant invalide");
  return { ok: errors.length === 0, errors, warnings };
}

// --- État d'un contrat à une date --------------------------------------------

export function couvre(c = {}, dateISO) {
  if (!c.dateDebut || !dateISO) return false;
  if (c.rompuLe && dateISO > c.rompuLe) return false;
  if (dateISO < c.dateDebut) return false;
  if (NATURES[c.nature]?.terme && c.dateFin && dateISO > c.dateFin) return false;
  return true;
}

export function etatContrat(c = {}, aujourdhui, { preavis = PREAVIS_TERME_JOURS } = {}) {
  const alertes = [];
  const n = NATURES[c.nature] || {};

  if (c.rompuLe) {
    return { etat: "rompu", actif: false, alertes: [{ gravite: "conseille", code: "rompu", message: `Contrat rompu le ${c.rompuLe}${c.motifRupture ? ` — ${c.motifRupture}` : ""}.` }] };
  }
  if (c.dateDebut && aujourdhui < c.dateDebut) {
    // La DPAE se fait AVANT la première heure : c'est maintenant qu'il faut le dire.
    if (n.salarie && !c.dpaeLe) {
      alertes.push({ gravite: "important", code: "dpae_a_faire",
        message: `Déclaration préalable à l'embauche à effectuer avant le ${c.dateDebut} : après la première heure travaillée, elle ne répare rien.` });
    }
    return { etat: "a_venir", actif: false, alertes };
  }

  // 1. LE DÉFAUT D'ÉCRIT — requalification quasi automatique.
  if (c.nature === "cdd" && c.dateDebut) {
    const limite = isoPlus(c.dateDebut, DELAI_ECRIT_JOURS);
    if (!c.signeLe && aujourdhui > limite) {
      alertes.push({ gravite: "bloquant", code: "ecrit_tardif",
        message: `CDD non signé au-delà du ${limite} (deux jours ouvrables après l'embauche) : il est réputé à durée indéterminée (L. 1242-13).` });
    }
  }
  // 2. LA DPAE, une fois le contrat commencé.
  if (n.salarie && !c.dpaeLe) {
    alertes.push({ gravite: "bloquant", code: "dpae_manquante",
      message: "Aucune déclaration préalable à l'embauche enregistrée alors que le contrat a commencé : son absence caractérise le travail dissimulé." });
  }

  // 3. LA PÉRIODE D'ESSAI — elle se rompt pendant, pas après.
  let finEssai = null;
  if (n.salarie && c.dureeEssaiJours && c.dateDebut) {
    finEssai = isoPlus(c.dateDebut, Number(c.dureeEssaiJours));
    const reste = ecart(aujourdhui, finEssai);
    if (reste != null && reste >= 0 && reste <= 14) {
      alertes.push({ gravite: "important", code: "essai_fin",
        message: `Période d'essai jusqu'au ${finEssai} (${reste} jour(s)). Passée cette date, la rupture relève du régime du licenciement.` });
    }
  }

  // 4. LE TERME — l'échéance la plus coûteuse, et rien ne se passe ce jour-là.
  if (n.terme && c.dateFin) {
    const reste = ecart(aujourdhui, c.dateFin);
    if (reste < 0) {
      alertes.push({
        gravite: "bloquant", code: "terme_depasse",
        message: c.nature === "cdd"
          ? `Terme dépassé depuis le ${c.dateFin}. Si la relation de travail se poursuit, le contrat devient à durée indéterminée (L. 1243-11) — et cela se constate, pas se décide.`
          : `Contrat de prestation échu depuis le ${c.dateFin} : les interventions postérieures sont sans support contractuel.`,
      });
      return { etat: "echu", actif: false, finEssai, alertes };
    }
    if (reste <= preavis) {
      alertes.push({ gravite: "important", code: "terme_proche",
        message: `Terme le ${c.dateFin} (${reste} jour(s)) : décider maintenant du renouvellement, d'un nouveau contrat ou de l'arrêt.` });
    }
  }

  return { etat: "en_cours", actif: true, finEssai, alertes };
}

// --- Risques de requalification sur l'HISTORIQUE ------------------------------
// C'est ce qu'un logiciel voit et qu'un humain ne tient pas : trente
// intervenants, plusieurs années, le même poste.

export function risquesRequalification(contrats = [], { aujourdhui } = {}) {
  const risques = [];
  // On raisonne par intervenant ET par poste : la carence s'apprécie sur le
  // poste, pas sur la personne.
  const groupes = new Map();
  for (const c of contrats) {
    if (c.nature !== "cdd") continue;
    const cle = `${c.teacherId}|${(c.poste || "").trim().toLowerCase()}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(c);
  }

  for (const [cle, liste] of groupes) {
    const tries = liste.slice().sort((a, b) => String(a.dateDebut).localeCompare(String(b.dateDebut)));
    for (let i = 1; i < tries.length; i++) {
      const prec = tries[i - 1], suiv = tries[i];
      if (!prec.dateFin || !suiv.dateDebut) continue;
      const car = carenceRequise(prec);
      if (!car?.finCarence) continue;
      if (suiv.dateDebut < car.finCarence) {
        risques.push({
          code: "carence", gravite: "bloquant",
          teacherId: prec.teacherId, poste: prec.poste || null,
          contrats: [prec.id, suiv.id],
          message: `Deux CDD enchaînés sur le même poste : le précédent s'est achevé le ${prec.dateFin}, le suivant démarre le ${suiv.dateDebut}, alors que le délai de carence court jusqu'au ${car.finCarence} (${car.regle}, L. 1244-3).`,
        });
      }
    }
    // Trois CDD consécutifs sur le même poste : même en respectant les carences,
    // c'est le signe d'un besoin permanent, et donc d'un poste à pourvoir en CDI.
    if (tries.length >= 3) {
      risques.push({
        code: "succession", gravite: "important",
        teacherId: tries[0].teacherId, poste: tries[0].poste || null,
        contrats: tries.map((c) => c.id),
        message: `${tries.length} CDD successifs sur le même poste : la succession révèle un besoin permanent, que le CDD n'a pas vocation à couvrir.`,
      });
    }
  }

  // Poursuite au-delà du terme : détectée sur les dates, pas sur une déclaration.
  if (aujourdhui) {
    for (const c of contrats) {
      if (c.nature !== "cdd" || c.rompuLe || !c.dateFin) continue;
      if (c.dateFin < aujourdhui && c.poursuiteConstatee) {
        risques.push({
          code: "poursuite", gravite: "bloquant", teacherId: c.teacherId, contrats: [c.id],
          message: `Des interventions ont eu lieu après le terme du ${c.dateFin} : la relation s'est poursuivie, le contrat est devenu à durée indéterminée (L. 1243-11).`,
        });
      }
    }
  }
  return risques;
}

// --- Vigilance URSSAF (prestataires) ------------------------------------------
export function vigilanceUrssaf(contrat = {}, attestations = [], aujourdhui) {
  if (NATURES[contrat.nature]?.salarie !== false) return null;
  const montant = Number(contrat.montant) || 0;
  if (montant < VIGILANCE_SEUIL_EUROS) {
    return { requise: false, motif: `montant inférieur au seuil de ${VIGILANCE_SEUIL_EUROS} € : l'obligation de vigilance ne s'applique pas` };
  }
  const recentes = attestations
    .filter((a) => a.contratId === contrat.id && a.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const derniere = recentes[0] || null;
  if (!derniere) {
    return { requise: true, aJour: false, derniere: null, alerte: {
      gravite: "bloquant", code: "vigilance_absente",
      message: `Aucune attestation de vigilance pour un contrat de ${montant} € : le donneur d'ordre est solidairement responsable en cas de travail dissimulé (L. 8222-1).` } };
  }
  const age = ecart(derniere.date, aujourdhui);
  const perimee = age != null && age > VIGILANCE_MOIS * 30;
  return {
    requise: true, aJour: !perimee, derniere: derniere.date, ageJours: age,
    alerte: perimee ? {
      gravite: "important", code: "vigilance_perimee",
      message: `Attestation de vigilance du ${derniere.date}, soit plus de ${VIGILANCE_MOIS} mois : elle se renouvelle tous les six mois pendant l'exécution du contrat.` } : null,
  };
}

// --- Couverture du planning ---------------------------------------------------
// Symétrique du contrôle d'habilitation à la certification : affecter une
// séance à quelqu'un dont aucun contrat ne couvre la date, c'est faire
// travailler sans support contractuel.

export function couvertureSeances(contrats = [], seances = []) {
  const nonCouvertes = [];
  for (const s of seances) {
    if (!s?.date || s.status === "cancelled") continue;
    if (!contrats.some((c) => couvre(c, s.date))) nonCouvertes.push(s);
  }
  return {
    total: seances.length, nonCouvertes: nonCouvertes.length,
    dates: [...new Set(nonCouvertes.map((s) => s.date))].sort(),
    // Le message dit la conséquence, pas le décompte.
    alerte: nonCouvertes.length ? {
      gravite: "bloquant", code: "hors_contrat",
      message: `${nonCouvertes.length} séance(s) affectée(s) à des dates qu'aucun contrat ne couvre (première : ${[...new Set(nonCouvertes.map((s) => s.date))].sort()[0]}) : ces heures s'exécutent sans support contractuel.`,
    } : null,
  };
}

// --- Tableau de bord ----------------------------------------------------------
export function tableauDeBord({ contrats = [], attestations = [], aujourdhui, noms = {} } = {}) {
  const lignes = contrats.map((c) => {
    const e = etatContrat(c, aujourdhui);
    const v = vigilanceUrssaf(c, attestations, aujourdhui);
    return {
      ...c, nom: noms[c.teacherId] || c.teacherId,
      natureLabel: NATURES[c.nature]?.label || c.nature,
      motifLabel: MOTIFS_CDD[c.motif] || null,
      etat: e.etat, actif: e.actif, finEssai: e.finEssai ?? null,
      alertes: [...e.alertes, ...(v?.alerte ? [v.alerte] : [])],
      vigilance: v,
    };
  });
  const risques = risquesRequalification(contrats, { aujourdhui });
  const bloquants = lignes.reduce((a, l) => a + l.alertes.filter((x) => x.gravite === "bloquant").length, 0)
    + risques.filter((r) => r.gravite === "bloquant").length;
  return {
    total: lignes.length,
    actifs: lignes.filter((l) => l.actif).length,
    echus: lignes.filter((l) => l.etat === "echu").length,
    bloquants, risques,
    lignes: lignes.sort((a, b) =>
      b.alertes.filter((x) => x.gravite === "bloquant").length - a.alertes.filter((x) => x.gravite === "bloquant").length
      || String(a.dateFin || "9999").localeCompare(String(b.dateFin || "9999"))),
    reserve: "Ce suivi porte sur ce que les dates permettent de constater. Il ne vaut pas conseil : la convention collective applicable, les usages de branche et la qualification réelle de la relation s'y ajoutent.",
  };
}

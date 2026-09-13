// Mobilité internationale des apprentis (Erasmus+ et hors Union) — logique pure.
//
// LA CONSÉQUENCE QUE LE RESTE DE L'APPLICATION DOIT CONNAÎTRE :
//
//   Pendant une mobilité à l'étranger, le contrat d'apprentissage est MIS EN
//   VEILLE (art. L. 6222-42 du code du travail) : il est suspendu, et avec lui
//   les obligations de l'employeur. L'apprenti n'est ni présent en entreprise,
//   ni absent du CFA — il est ailleurs, et c'est prévu.
//
// Sans cette notion, une mobilité de six semaines apparaît comme six semaines
// d'absence : l'assiduité s'effondre, l'alerte de décrochage se déclenche sur un
// apprenti exemplaire, et l'attestation d'assiduité remise au financeur affiche
// un trou inexplicable. Le module fournit donc les périodes à NEUTRALISER, et
// c'est ce que les autres modules doivent consommer.
//
// DEUX RÉGIMES, QUI N'ONT PAS LES MÊMES PIÈCES :
//
//   • Mobilité dans l'Union européenne : convention entre le CFA, l'employeur,
//     l'apprenti et la structure d'accueil. Le contrat français continue de
//     s'appliquer ou est mis en veille selon la durée.
//   • Mobilité HORS Union : la mise en veille est la règle, et l'apprenti relève
//     du droit du pays d'accueil. La couverture sociale doit être vérifiée
//     séparément — c'est le point où l'on découvre trop tard qu'un apprenti
//     n'était couvert pour rien.
//
// ⚠️ Régime juridique à revérifier : il a évolué en 2019 puis en 2023.

export const REGIMES = {
  ue: { label: "Union européenne", miseEnVeilleObligatoire: false },
  hors_ue: { label: "Hors Union européenne", miseEnVeilleObligatoire: true },
};

export const ETATS = {
  projet: "Projet",
  conventionnee: "Conventionnée",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

// Au-delà de quatre semaines, la mise en veille devient la règle pratique même
// dans l'Union : en deçà, le contrat français peut continuer de s'appliquer.
export const SEUIL_MISE_EN_VEILLE_JOURS = 28;

const jours = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5) + 1 : null);

export function dureeJours(m = {}) { return jours(m.dateDebut, m.dateFin); }

export function validateMobilite(m = {}, contrat = null) {
  const errors = [], warnings = [];
  if (!m.dateDebut || !m.dateFin) errors.push("dates de début et de fin requises");
  if (m.dateDebut && m.dateFin && m.dateFin < m.dateDebut) errors.push("date de fin antérieure à la date de début");
  if (!REGIMES[m.regime]) errors.push(`régime requis (${Object.keys(REGIMES).join(", ")})`);
  if (!String(m.pays || "").trim()) errors.push("pays d'accueil requis");
  if (!String(m.structureAccueil || "").trim()) errors.push("structure d'accueil requise");
  if (m.etat && !ETATS[m.etat]) errors.push("état inconnu");

  const duree = dureeJours(m);
  const regime = REGIMES[m.regime];
  const veilleAttendue = regime?.miseEnVeilleObligatoire || (duree != null && duree > SEUIL_MISE_EN_VEILLE_JOURS);

  if (["conventionnee", "en_cours", "terminee"].includes(m.etat) && !m.convention) {
    errors.push("aucune convention enregistrée — elle lie le CFA, l'employeur, l'apprenti et la structure d'accueil");
  }
  if (veilleAttendue && m.miseEnVeille === false) {
    warnings.push(`mobilité de ${duree} jour(s) ${regime?.label.toLowerCase()} sans mise en veille du contrat : vérifier, la suspension est normalement la règle ici (art. L. 6222-42)`);
  }
  // Le point où l'on découvre trop tard que personne n'était couvert.
  if (m.regime === "hors_ue" && !m.couvertureSociale) {
    warnings.push("couverture sociale hors Union non attestée : elle ne découle pas du contrat français et doit être vérifiée séparément");
  }
  if (contrat?.dateFin && m.dateFin && m.dateFin > contrat.dateFin) {
    errors.push("la mobilité se termine après le contrat d'apprentissage");
  }
  if (!m.referentCfa) warnings.push("aucun référent mobilité désigné au CFA");
  return { ok: errors.length === 0, errors, warnings, duree, veilleAttendue };
}

// Périodes à NEUTRALISER dans les calculs d'assiduité. C'est la sortie que les
// autres modules consomment : sans elle, une mobilité ressemble à un abandon.
export function periodesNeutralisees(mobilites = []) {
  return mobilites
    .filter((m) => ["conventionnee", "en_cours", "terminee"].includes(m.etat) && m.dateDebut && m.dateFin)
    .map((m) => ({ from: m.dateDebut, to: m.dateFin, motif: `mobilité ${REGIMES[m.regime]?.label || ""} — ${m.pays}`.trim() }));
}

export function estEnMobilite(mobilites = [], dateISO) {
  return periodesNeutralisees(mobilites).some((p) => dateISO >= p.from && dateISO <= p.to);
}

// Retire d'une liste de séances celles qui tombent pendant une mobilité. Le
// résultat dit aussi COMBIEN ont été retirées : une neutralisation silencieuse
// serait invérifiable.
export function filtrerSeances(seances = [], mobilites = []) {
  const periodes = periodesNeutralisees(mobilites);
  if (!periodes.length) return { retenues: seances, neutralisees: 0, periodes };
  const retenues = seances.filter((s) => !periodes.some((p) => s.date >= p.from && s.date <= p.to));
  return { retenues, neutralisees: seances.length - retenues.length, periodes };
}

// Synthèse d'un campus : ce qu'un responsable mobilité regarde.
export function tableauDeBord(mobilites = [], { aujourdhui } = {}) {
  const lignes = mobilites.map((m) => {
    const v = validateMobilite(m);
    const duree = dureeJours(m);
    const enCours = m.dateDebut && m.dateFin && aujourdhui >= m.dateDebut && aujourdhui <= m.dateFin;
    return {
      ...m, duree, enCours,
      etatLabel: ETATS[m.etat] || "Projet",
      regimeLabel: REGIMES[m.regime]?.label || "",
      alertes: [...v.errors.map((e) => ({ gravite: "bloquant", message: e })),
                ...v.warnings.map((w) => ({ gravite: "avertissement", message: w }))],
    };
  });
  return {
    total: lignes.length,
    enCours: lignes.filter((l) => l.enCours).length,
    joursCumules: lignes.reduce((s, l) => s + (l.duree || 0), 0),
    // Une mobilité sans convention est une mobilité qui n'existe pas
    // juridiquement : c'est le premier chiffre à regarder.
    sansConvention: lignes.filter((l) => ["conventionnee", "en_cours", "terminee"].includes(l.etat) && !l.convention).length,
    lignes: lignes.sort((a, b) => String(a.dateDebut).localeCompare(String(b.dateDebut))),
  };
}

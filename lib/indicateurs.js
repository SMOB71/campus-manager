// Indicateurs de résultats à publier — article L. 6111-8 du code du travail.
//
// L'OBLIGATION — chaque année, pour chaque centre de formation d'apprentis, sont
// rendus publics : le taux d'obtention du diplôme ou de la qualification, le
// taux de poursuite d'études, le taux d'interruption en cours de formation, le
// taux d'insertion professionnelle des sortants, la valeur ajoutée de
// l'établissement, et — propre aux CFA — le taux de rupture des contrats
// d'apprentissage.
//
// LA CONDITION QUE PRESQUE TOUS LES OUTILS OUBLIENT :
//
//   « … LORSQUE LES EFFECTIFS CONCERNÉS SONT SUFFISANTS. »
//
// Publier un taux de réussite sur trois apprentis n'informe personne et
// DÉSIGNE quelqu'un : avec 2 sur 3, le tiers qui a échoué est identifiable par
// toute personne connaissant la promotion. Ce n'est pas une précaution
// statistique, c'est une question de protection des personnes. Le module refuse
// donc de publier sous un seuil, et le dit au lieu d'afficher « 67 % ».
//
// CE QUE NOUS CALCULONS, ET CE QUE NOUS NE POUVONS PAS CALCULER :
//
//   • Calculables ici : obtention, interruption en cours de formation, rupture
//     de contrat — ce sont nos propres données.
//   • NON calculables ici : insertion professionnelle et valeur ajoutée. Elles
//     viennent du dispositif national InserJeunes, qui croise des fichiers
//     sociaux dont nous ne disposons pas. Les « estimer » depuis nos données
//     produirait un chiffre faux publié sous une obligation légale : le module
//     les porte comme des valeurs DÉCLARÉES, avec leur source et leur millésime.
//
// ⚠️ Seuil et modalités de diffusion fixés par arrêté : à revérifier.

// Seuil retenu. Le code dit « effectifs suffisants » sans le chiffrer ; la
// pratique administrative se situe autour d'une dizaine. On prend un seuil
// prudent et EXPLICITE plutôt qu'un silence qui laisserait publier n'importe quoi.
export const SEUIL_EFFECTIF = 10;

export const INDICATEURS = {
  obtention: { label: "Taux d'obtention du diplôme ou de la qualification", source: "etablissement" },
  poursuite: { label: "Taux de poursuite d'études", source: "declare" },
  interruption: { label: "Taux d'interruption en cours de formation", source: "etablissement" },
  insertion: { label: "Taux d'insertion professionnelle des sortants", source: "inserjeunes" },
  valeurAjoutee: { label: "Valeur ajoutée de l'établissement", source: "inserjeunes" },
  rupture: { label: "Taux de rupture des contrats d'apprentissage", source: "etablissement" },
};

export const SOURCES = {
  etablissement: "Calculé sur les données de l'établissement",
  inserjeunes: "Dispositif national InserJeunes",
  declare: "Déclaré par l'établissement",
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

// Un taux n'est publiable que si son dénominateur est suffisant. On renvoie le
// taux ET l'effectif : un pourcentage sans son effectif n'est pas une information.
function taux(numerateur, denominateur, { seuil = SEUIL_EFFECTIF } = {}) {
  const suffisant = denominateur >= seuil;
  return {
    valeur: suffisant ? pct(numerateur, denominateur) : null,
    effectif: denominateur,
    publiable: suffisant,
    motif: suffisant ? null
      : `effectif insuffisant (${denominateur} < ${seuil}) : publier un taux sur si peu de personnes ne renseigne pas et rend les individus identifiables`,
  };
}

// Calcul de ce qui relève de nos données. `cohorte` = les inscrits d'une année
// sur une formation donnée.
export function calculer({ inscriptions = [], certifications = [], contrats = [], seuil = SEUIL_EFFECTIF } = {}) {
  const effectif = inscriptions.length;

  // Interruption : sortie avant le terme, hors diplômés. Un apprenti dont le
  // contrat est rompu mais qui reste en formation n'a PAS interrompu son
  // parcours — c'est la confusion la plus fréquente entre rupture et abandon.
  const interrompus = inscriptions.filter((e) => ["abandon", "sorti"].includes(e.statut) && !e.diplome).length;

  // Obtention : parmi les présentés, ceux qui ont obtenu. Rapporter les reçus à
  // l'effectif de départ mélangerait échec et abandon.
  const presentes = certifications.filter((c) => c.presente).length;
  const obtenus = certifications.filter((c) => c.obtenu).length;

  // Rupture : contrats rompus sur contrats conclus.
  const conclus = contrats.length;
  const rompus = contrats.filter((c) => c.status === "rompu" || c.rupture?.stage === "confirmee").length;

  return {
    effectif,
    obtention: { ...taux(obtenus, presentes, { seuil }), presentes, obtenus, source: "etablissement" },
    interruption: { ...taux(interrompus, effectif, { seuil }), source: "etablissement" },
    rupture: { ...taux(rompus, conclus, { seuil }), conclus, rompus, source: "etablissement" },
  };
}

export function validateDeclaration(d = {}) {
  const errors = [], warnings = [];
  for (const [cle, def] of Object.entries(INDICATEURS)) {
    if (def.source === "etablissement") continue;
    const v = d[cle];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push(`${def.label} : taux attendu entre 0 et 100`);
  }
  // Un chiffre sans millésime ni source n'est pas publiable : le lecteur ne peut
  // ni le dater ni le vérifier.
  if ((d.insertion != null || d.valeurAjoutee != null) && !d.millesime) {
    errors.push("millésime requis pour les indicateurs issus d'InserJeunes — un taux sans année ne veut rien dire");
  }
  if (d.poursuite != null && !d.sourcePoursuite) warnings.push("taux de poursuite d'études déclaré sans source indiquée");
  return { ok: errors.length === 0, errors, warnings };
}

// Assemblage de la publication. `declares` porte ce que nous ne savons pas
// calculer, avec sa provenance.
export function publier({ calcul = {}, declares = {}, formation = "", annee = null, seuil = SEUIL_EFFECTIF } = {}) {
  const lignes = [];
  for (const [cle, def] of Object.entries(INDICATEURS)) {
    if (def.source === "etablissement") {
      const c = calcul[cle];
      lignes.push({
        cle, label: def.label, source: def.source, sourceLabel: SOURCES[def.source],
        valeur: c?.valeur ?? null, effectif: c?.effectif ?? null,
        publiable: !!c?.publiable, motif: c?.motif || null,
      });
    } else {
      const v = declares[cle];
      const present = v !== undefined && v !== null && v !== "";
      lignes.push({
        cle, label: def.label, source: def.source, sourceLabel: SOURCES[def.source],
        valeur: present ? Number(v) : null,
        millesime: declares.millesime || null,
        publiable: present,
        motif: present ? null : `non renseigné — cet indicateur provient ${def.source === "inserjeunes" ? "du dispositif national InserJeunes" : "d'une déclaration de l'établissement"} et ne peut pas être calculé ici`,
      });
    }
  }
  const manquants = lignes.filter((l) => !l.publiable);
  return {
    formation, annee, seuil,
    lignes,
    manquants: manquants.map((l) => `${l.label} — ${l.motif}`),
    // « Complet » ne veut pas dire « conforme » : la diffusion elle-même (site
    // internet, format) relève d'un arrêté que ce module ne contrôle pas.
    complet: manquants.length === 0,
    reserve: "L'obligation porte aussi sur les MODALITÉS de diffusion, fixées par arrêté. Ce tableau fournit les valeurs ; leur publication reste à effectuer sur les supports prévus.",
  };
}

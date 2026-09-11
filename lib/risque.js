// Risque de décrochage — logique pure (aucune I/O).
//
// Toutes les données existaient déjà : assiduité, résultats, rupture, suivi en
// entreprise. Aucune ne disait rien seule. Un apprenti qui décroche coche
// presque toujours plusieurs cases à la fois, et c'est le CROISEMENT qui alerte
// utilement — un absentéisme isolé en période d'examens n'a pas le même sens
// qu'un absentéisme accompagné d'une chute des résultats et d'un contrat rompu.
//
// DEUX PRINCIPES DE CONCEPTION, appris des alertes qu'on finit par ignorer :
//
//   1. Un score ne sert à rien sans ses MOTIFS. « Risque 72 % » ne se traite
//      pas ; « 4 absences non justifiées ce mois, moyenne passée de 12 à 8, et
//      aucune visite en entreprise depuis 7 mois » se traite. Le score ne sert
//      qu'à trier ; ce sont les motifs qu'on lit.
//
//   2. On ne signale JAMAIS un fait qu'on a soi-même provoqué. Un apprenant
//      dispensé de suivre un bloc n'est pas absent de ce bloc : le compter
//      absent fabriquerait une alerte sur quelqu'un de parfaitement à jour, et
//      trois alertes fausses suffisent à faire ignorer toutes les autres.
//
// Les seuils sont paramétrables parce qu'un CFA du bâtiment et une école de
// commerce n'ont pas le même absentéisme normal.

export const SEUILS_DEFAUT = {
  absenteismeAlerte: 15,      // % d'heures manquées au-delà duquel on regarde
  absenteismeCritique: 30,
  moyenneFaible: 9,           // sous le seuil de validation
  chuteMoyenne: 3,            // points perdus d'une période à l'autre
  suiviJours: 182,            // sans rencontre en entreprise
};

export const NIVEAUX = { faible: "Faible", moyen: "À surveiller", eleve: "Élevé", critique: "Critique" };

// Chaque signal porte son poids ET sa phrase. La phrase est ce qui sera lu.
function signaux(d, seuils) {
  const out = [];
  const {
    tauxAbsenteisme = null, absencesNonJustifiees = 0,
    moyenne = null, moyennePrecedente = null,
    blocsNonAcquis = 0, blocsTotal = 0,
    ruptureOuverte = false, sansContrat = false,
    joursSansSuivi = null,
  } = d;

  if (tauxAbsenteisme != null && tauxAbsenteisme >= seuils.absenteismeCritique) {
    out.push({ poids: 35, code: "absenteisme_critique", texte: `${Math.round(tauxAbsenteisme)} % d'heures manquées sur la période.` });
  } else if (tauxAbsenteisme != null && tauxAbsenteisme >= seuils.absenteismeAlerte) {
    out.push({ poids: 20, code: "absenteisme", texte: `${Math.round(tauxAbsenteisme)} % d'heures manquées sur la période.` });
  }
  if (absencesNonJustifiees >= 3) {
    out.push({ poids: 15, code: "absences_injustifiees", texte: `${absencesNonJustifiees} absences non justifiées.` });
  }
  if (moyenne != null && moyenne < seuils.moyenneFaible) {
    out.push({ poids: 20, code: "moyenne_faible", texte: `Moyenne générale à ${String(Math.round(moyenne * 10) / 10).replace(".", ",")}.` });
  }
  if (moyenne != null && moyennePrecedente != null && moyennePrecedente - moyenne >= seuils.chuteMoyenne) {
    out.push({
      poids: 20, code: "chute_resultats",
      texte: `Moyenne passée de ${String(Math.round(moyennePrecedente * 10) / 10).replace(".", ",")} à ${String(Math.round(moyenne * 10) / 10).replace(".", ",")}.`,
    });
  }
  if (blocsTotal > 0 && blocsNonAcquis >= Math.ceil(blocsTotal / 2)) {
    out.push({ poids: 15, code: "blocs_non_acquis", texte: `${blocsNonAcquis} bloc(s) non acquis sur ${blocsTotal}.` });
  }
  // La rupture n'est pas un risque de décrochage : c'est un décrochage en cours.
  if (ruptureOuverte) out.push({ poids: 30, code: "rupture", texte: "Rupture de contrat engagée." });
  else if (sansContrat) out.push({ poids: 20, code: "sans_contrat", texte: "Sans contrat d'alternance en cours." });

  if (joursSansSuivi != null && joursSansSuivi > seuils.suiviJours) {
    out.push({ poids: 15, code: "sans_suivi", texte: `Aucune rencontre en entreprise depuis ${joursSansSuivi} jours.` });
  }
  return out;
}

export function risqueDecrochage(donnees = {}, { seuils = {} } = {}) {
  const s = { ...SEUILS_DEFAUT, ...seuils };
  const liste = signaux(donnees, s);
  const brut = liste.reduce((t, x) => t + x.poids, 0);
  const score = Math.min(100, brut);

  // Un signal isolé ne fait pas un décrochage. Deux signaux concordants, oui —
  // c'est le croisement qui a du sens, pas l'accumulation arithmétique.
  const niveau = liste.length === 0 ? "faible"
    : donnees.ruptureOuverte && liste.length >= 2 ? "critique"
    : score >= 60 ? "critique"
    : score >= 35 ? "eleve"
    : liste.length >= 2 ? "moyen"
    : "faible";

  return {
    score, niveau, niveauLabel: NIVEAUX[niveau],
    signaux: liste.map((x) => ({ code: x.code, texte: x.texte })),
    // Ce qui sera affiché en une ligne dans une liste de cent apprenants.
    resume: liste.length ? liste.map((x) => x.texte).join(" ") : "Aucun signal.",
    aTraiter: niveau === "eleve" || niveau === "critique",
    seuils: s,
  };
}

// Assiduité corrigée des allègements. Sans cette correction, un apprenant
// dispensé de suivre un bloc apparaît massivement absent — et l'alerte se
// déclenche sur quelqu'un qui n'a rien à se reprocher.
export function tauxAbsenteismeCorrige({ minutesPrevues = 0, minutesManquees = 0, minutesAllegees = 0 } = {}) {
  const du = Math.max(0, minutesPrevues - minutesAllegees);
  if (du <= 0) return null;
  const manquees = Math.max(0, minutesManquees - minutesAllegees);
  return Math.round((Math.min(manquees, du) / du) * 1000) / 10;
}

// Classement d'une promotion : on ne traite pas cent dossiers, on traite les
// premiers. Tri par niveau puis par score, à niveau égal.
const ORDRE = { critique: 0, eleve: 1, moyen: 2, faible: 3 };
export function classerPromotion(evaluations = []) {
  return evaluations
    .slice()
    .sort((a, b) => (ORDRE[a.risque.niveau] - ORDRE[b.risque.niveau]) || (b.risque.score - a.risque.score));
}

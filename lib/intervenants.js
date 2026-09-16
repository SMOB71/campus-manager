// Dossier des intervenants et masse horaire — logique pure, aucune I/O.
//
// DEUX BESOINS QUI N'EN FONT QU'UN : la RH ne peut rédiger un contrat que si
// elle dispose du volume d'heures et des matières ; et c'est ce même volume,
// agrégé, qui se compare au budget du campus. Tenir les deux séparément,
// c'est garantir qu'ils divergent — la RH contractualise des heures que le
// budget ne connaît pas.
//
// D'OÙ LE PARTI PRIS : LE VOLUME N'EST PAS SAISI, IL EST DÉRIVÉ.
//
//   Les heures d'un intervenant se lisent dans ce qui lui est réellement
//   affecté — séances posées, matières, classes. Un nombre tapé à la main dans
//   un tableur se décorrèle du planning dès la première modification, et
//   personne ne sait plus lequel des deux fait foi. Ici le planning fait foi, et
//   l'écart avec le contrat signé est AFFICHÉ au lieu d'être découvert.
//
// LES DEUX PIÈGES QUE CE MODULE EXISTE POUR FERMER :
//
//   1. LE TAUX HORAIRE BRUT N'EST PAS LE COÛT EMPLOYEUR. Comparer
//      « heures × taux » à une ligne budgétaire qui est une masse salariale
//      CHARGÉE sous-estime la dépense d'environ 40 %. On tiendrait un budget sur
//      le papier en le dépassant en réalité. Le coefficient de charges est donc
//      obligatoire et DÉCLARÉ — il dépend du statut et de la convention, nous ne
//      l'inventons pas.
//
//   2. UN BUDGET ANNUEL COMPARÉ À DES HEURES CUMULÉES EST TOUJOURS RASSURANT
//      JUSQU'EN MARS. 30 % du budget consommé en novembre n'est pas une bonne
//      nouvelle si l'année n'est écoulée qu'à 20 %. Le module rapporte donc la
//      consommation à l'AVANCEMENT de l'année et projette l'atterrissage.
//
// CE QUE CE MODULE NE STOCKE PAS, VOLONTAIREMENT : numéro de sécurité sociale,
// coordonnées bancaires, pièce d'identité. Ces données sont nécessaires à la
// DPAE et au bulletin, donc au LOGICIEL DE PAIE — les recopier ici ferait une
// seconde base des informations les plus sensibles, sans usage propre. Le
// dossier les marque « à transmettre à la RH », il ne les conserve pas.
//
// ⚠️ Taux de charges, minima et heures connexes dépendent de la convention
// collective applicable. À déclarer par l'établissement, à revérifier.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const vide = (v) => !String(v ?? "").trim();

// Ce dont la RH a besoin pour rédiger. Chaque champ dit CE QU'IL BLOQUE : une
// liste de cases à cocher sans conséquence ne se remplit jamais.
export const CHAMPS_RH = [
  { cle: "name", label: "Nom et prénom", bloque: "aucun contrat ne peut être édité", ou: "ici" },
  { cle: "email", label: "Courriel", bloque: "ni convocation, ni envoi du contrat à signer", ou: "ici" },
  { cle: "status", label: "Statut (salarié ou prestataire)", bloque: "la nature même du contrat : contrat de travail ou contrat de prestation", ou: "ici" },
  { cle: "subjects", label: "Matières enseignées", bloque: "l'objet du contrat, et la vérification que l'intervenant est déclaré sur ce qu'il enseigne", ou: "ici" },
  { cle: "tauxHoraire", label: "Taux horaire", bloque: "la rémunération au contrat et tout chiffrage budgétaire", ou: "ici" },
  { cle: "heuresAnnuelles", label: "Heures prévues au contrat", bloque: "le volume contractuel — comparé ici aux heures réellement affectées", ou: "ici" },
  { cle: "campusIds", label: "Campus de rattachement", bloque: "l'imputation budgétaire et le lieu d'exécution", ou: "ici" },
  // Propre au prestataire.
  { cle: "company", label: "Société", bloque: "le contrat de prestation et la vigilance URSSAF", ou: "ici", si: "prestataire" },
  // Propre au salarié.
  { cle: "matricule", label: "Matricule paie", bloque: "le rapprochement avec le logiciel de paie", ou: "ici", si: "salarie" },
  { cle: "regle", label: "Règle heures de face-à-face → heures payées", bloque: "l'export de paie : sans elle, préparation et correction ne sont pas payées", ou: "ici", si: "salarie" },
];

// Ce que la RH doit obtenir MAIS que l'application ne conserve pas.
export const A_TRANSMETTRE_RH = [
  { label: "Numéro de sécurité sociale", pourquoi: "déclaration préalable à l'embauche et bulletin de paie" },
  { label: "Coordonnées bancaires", pourquoi: "versement du salaire ou règlement des factures" },
  { label: "Pièce d'identité et autorisation de travail", pourquoi: "obligation de vérification à l'embauche" },
  { label: "Attestation de vigilance URSSAF", pourquoi: "prestataire : obligation du donneur d'ordre, à renouveler tous les six mois" },
];

const estPrestataire = (t = {}) => t.status === "prestataire";

function valeurRenseignee(t, cle) {
  const v = t?.[cle];
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return !vide(v);
}

// Dossier d'un intervenant : ce qui manque, et ce que ça empêche.
export function dossierRh(intervenant = {}) {
  const presta = estPrestataire(intervenant);
  const applicables = CHAMPS_RH.filter((c) =>
    !c.si || (c.si === "prestataire" ? presta : !presta));
  const lignes = applicables.map((c) => ({
    ...c, renseigne: valeurRenseignee(intervenant, c.cle),
  }));
  const manquants = lignes.filter((l) => !l.renseigne);
  return {
    teacherId: intervenant.id || null, nom: intervenant.name || "",
    statut: intervenant.status || null, prestataire: presta,
    lignes, manquants,
    complet: manquants.length === 0,
    completude: lignes.length ? Math.round(((lignes.length - manquants.length) / lignes.length) * 100) : null,
    aTransmettre: A_TRANSMETTRE_RH.filter((x) => !presta || /URSSAF|bancaires|identité/i.test(x.label)),
    // Rappelé ici parce que c'est le moment où l'on est tenté de tout saisir.
    reserve: "Les pièces ci-dessus sont nécessaires à la RH mais ne sont pas conservées dans l'application : les recopier ici ferait une seconde base des données les plus sensibles, sans usage propre.",
  };
}

// --- Volume horaire : dérivé du planning, jamais saisi ------------------------

// `affectations` = séances posées pour cet intervenant, déjà filtrées sur
// l'année. `libelles` traduit les identifiants de modules.
export function volumeContractuel(intervenant = {}, affectations = [], { libelles = {} } = {}) {
  const parModule = new Map();
  let total = 0;
  for (const s of affectations) {
    if (!s || s.status === "cancelled") continue;
    const h = heuresDe(s);
    total += h;
    const cle = s.moduleId || "—";
    if (!parModule.has(cle)) parModule.set(cle, { moduleId: s.moduleId || null, label: libelles[s.moduleId] || "Non rattaché", heures: 0, seances: 0 });
    const g = parModule.get(cle);
    g.heures = round2(g.heures + h);
    g.seances++;
  }
  const contrat = intervenant.heuresAnnuelles == null ? null : Number(intervenant.heuresAnnuelles);
  const ecart = contrat == null ? null : round2(total - contrat);
  return {
    heuresAffectees: round2(total),
    heuresAuContrat: contrat,
    ecart,
    matieres: [...parModule.values()].sort((a, b) => b.heures - a.heures),
    // On nomme l'écart plutôt que de l'afficher nu : un directeur doit savoir
    // s'il doit faire un avenant ou s'il paie des heures qu'il n'a pas prévues.
    alerte: contrat == null
      ? { gravite: "important", message: "Aucun volume au contrat : impossible de dire si les heures affectées sont couvertes." }
      : ecart > 0
        ? { gravite: "important", message: `${ecart} h affectées au-delà du contrat (${contrat} h) : elles se paieront en heures supplémentaires ou demanderont un avenant.` }
        : ecart < -0.01 && contrat > 0 && total < contrat * 0.8
          ? { gravite: "conseille", message: `${round2(-ecart)} h de moins que le contrat : le service n'est pas rempli, l'heure est payée sans être posée.` }
          : null,
  };
}

function heuresDe(s) {
  const m = (t) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(s.start), b = m(s.end);
  return a != null && b != null && b > a ? round2((b - a) / 60) : 0;
}

// --- Coût : brut et chargé ----------------------------------------------------

// LE PIÈGE N° 1. Le coût employeur d'un salarié n'est pas son brut : il faut y
// ajouter les charges patronales. Un prestataire, lui, n'en génère pas — il
// facture. Confondre les deux fausse le budget dans les deux sens.
export const COEFFICIENT_DEFAUT = null;   // aucun défaut : il doit être déclaré

export function coutIntervenant({ heures = 0, tauxHoraire = null, statut = "vacataire", coefficientCharges = null } = {}) {
  const taux = tauxHoraire == null ? null : Number(tauxHoraire);
  if (taux == null || !Number.isFinite(taux)) {
    return { heures: round2(heures), brut: null, charge: null, motif: "taux horaire non renseigné" };
  }
  const brut = round2(heures * taux);
  if (statut === "prestataire") {
    // Pas de charges patronales : la facture EST le coût. Lui appliquer un
    // coefficient de charges gonflerait le budget d'une dépense qui n'existe pas.
    return { heures: round2(heures), brut, charge: brut, prestataire: true, coefficient: 1 };
  }
  if (coefficientCharges == null) {
    return {
      heures: round2(heures), brut, charge: null,
      motif: "coefficient de charges patronales non déclaré : le coût employeur ne peut pas être calculé, et le brut seul sous-estime la dépense d'environ 40 %",
    };
  }
  return { heures: round2(heures), brut, charge: round2(brut * Number(coefficientCharges)), coefficient: Number(coefficientCharges) };
}

// --- Masse horaire d'un campus face au budget --------------------------------

// `avancement` = part de l'année écoulée (0 à 1). C'est lui qui transforme un
// pourcentage rassurant en alerte.
export function avancementAnnee(debut, fin, aujourdhui) {
  if (!debut || !fin || !aujourdhui) return null;
  const j = (a, b) => (new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5;
  const total = j(debut, fin);
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, j(debut, aujourdhui) / total));
}

export function masseCampus({ dossiers = [], budget = null, coefficientCharges = null, avancement = null } = {}) {
  const lignes = dossiers.map((d) => {
    const c = coutIntervenant({
      heures: d.volume.heuresAffectees, tauxHoraire: d.intervenant.tauxHoraire,
      statut: d.intervenant.status, coefficientCharges,
    });
    return {
      teacherId: d.intervenant.id, nom: d.intervenant.name,
      statut: d.intervenant.status, prestataire: d.intervenant.status === "prestataire",
      heures: c.heures, brut: c.brut, charge: c.charge, motif: c.motif || null,
      heuresAuContrat: d.volume.heuresAuContrat, ecart: d.volume.ecart,
      dossierComplet: d.dossier.complet,
    };
  }).sort((a, b) => (b.charge ?? b.brut ?? 0) - (a.charge ?? a.brut ?? 0));

  const heures = round2(lignes.reduce((a, l) => a + l.heures, 0));
  const chiffrables = lignes.filter((l) => l.charge != null);
  const cout = round2(chiffrables.reduce((a, l) => a + l.charge, 0));
  const nonChiffres = lignes.filter((l) => l.charge == null);

  const alertes = [];
  // Un total calculé sur une partie des intervenants n'est pas un total : le
  // dire, sinon le budget paraît tenu parce qu'il manque des lignes.
  if (nonChiffres.length) {
    alertes.push({
      gravite: "important", code: "incomplet",
      message: `${nonChiffres.length} intervenant(s) non chiffrés (${[...new Set(nonChiffres.map((l) => l.motif))].join(" ; ")}) : le total ci-dessus est partiel.`,
    });
  }

  let consommation = null, projection = null;
  if (budget != null && budget > 0 && !nonChiffres.length) {
    consommation = Math.round((cout / budget) * 100);
    if (avancement != null && avancement > 0.05) {
      // LE PIÈGE N° 2 : rapporter la consommation à l'avancement de l'année.
      projection = round2(cout / avancement);
      const depassement = projection - budget;
      if (depassement > 0) {
        alertes.push({
          gravite: "bloquant", code: "trajectoire",
          message: `À ce rythme, l'atterrissage est de ${round2(projection)} € pour un budget de ${round2(budget)} € — soit ${round2(depassement)} € de dépassement. L'année est écoulée à ${Math.round(avancement * 100)} % et le budget consommé à ${consommation} %.`,
        });
      }
    }
    if (consommation > 100) {
      alertes.push({ gravite: "bloquant", code: "depasse", message: `Budget déjà dépassé de ${round2(cout - budget)} €.` });
    }
  } else if (budget == null) {
    alertes.push({ gravite: "conseille", code: "sans_budget", message: "Aucun budget d'heures d'enseignement déclaré pour ce campus : la masse ne se compare à rien." });
  }

  const dossiersIncomplets = lignes.filter((l) => !l.dossierComplet).length;
  if (dossiersIncomplets) {
    alertes.push({
      gravite: "important", code: "dossiers",
      message: `${dossiersIncomplets} dossier(s) incomplet(s) : la RH ne peut pas rédiger les contrats correspondants.`,
    });
  }

  return {
    intervenants: lignes.length, heures, cout, budget,
    consommation, projection, avancement,
    coefficientCharges,
    horsContrat: round2(lignes.reduce((a, l) => a + Math.max(0, l.ecart || 0), 0)),
    lignes, alertes,
    reserve: "Le coût chargé dépend du coefficient déclaré, qui varie selon le statut et la convention collective. Ce tableau prépare un arbitrage, il ne remplace pas la paie.",
  };
}

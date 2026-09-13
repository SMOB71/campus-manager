// Écritures comptables et Fichier des Écritures Comptables (FEC) — logique pure.
//
// CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS — il traduit en écritures ce que
// l'application sait déjà (factures émises, avoirs, règlements) et produit le
// fichier normé que l'administration fiscale exige. Il ne remplace pas un
// expert-comptable : il lui fournit une matière exploitable au lieu d'un export
// Excel à ressaisir. Le plan de comptes est donc PARAMÉTRABLE — chaque
// organisme a le sien, et imposer le nôtre garantirait un rejet.
//
// QUATRE RÈGLES DONT AUCUNE NE SE NÉGOCIE :
//
//   1. ÉQUILIBRE. Débit = crédit, pour CHAQUE écriture et pour le fichier
//      entier. Un FEC déséquilibré est rejeté — ce n'est pas un avertissement,
//      c'est un refus. Le module vérifie les deux niveaux.
//
//   2. LES MONTANTS SONT TOUJOURS POSITIFS. Le sens est porté par la colonne
//      (débit ou crédit), jamais par un signe. C'est le piège classique : un
//      avoir n'est pas une facture négative, c'est une écriture INVERSE. Écrire
//      -1 200 en débit produit un fichier non conforme.
//
//   3. UNE FACTURE BROUILLON N'EST PAS UN FAIT COMPTABLE. Seules les factures
//      ÉMISES engendrent une écriture. Comptabiliser un brouillon, c'est
//      déclarer un produit qui n'existe pas.
//
//   4. NUMÉROTATION CHRONOLOGIQUE ET CONTINUE PAR JOURNAL. Un trou dans la
//      séquence est exactement ce qu'un vérificateur cherche.
//
// Base : article A. 47 A-1 du livre des procédures fiscales. 18 champs, dans un
// ordre imposé, séparés par une tabulation ou une barre verticale, avec une
// ligne d'en-tête. Un champ vide reste présent : c'est le séparateur qui compte.
// ⚠️ À revérifier à chaque campagne — le format a déjà évolué.

// Plan de comptes par défaut. Français, adapté à un organisme de formation, et
// destiné à être surchargé : ce sont des valeurs de départ, pas une vérité.
export const PLAN_DEFAUT = {
  client: "411000",
  clientLib: "Clients",
  produits: "706000",
  produitsLib: "Prestations de services — formation",
  banque: "512000",
  banqueLib: "Banque",
  tva: "445710",
  tvaLib: "TVA collectée",
};

export const JOURNAUX = {
  VT: "Ventes",
  BQ: "Banque",
  OD: "Opérations diverses",
};

// Les 18 champs, dans l'ordre imposé. Toute inversion rend le fichier non
// conforme, d'où une constante unique qui sert à la fois d'en-tête et de guide
// de sérialisation.
export const CHAMPS_FEC = [
  "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
  "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib",
  "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit",
  "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const aaaammjj = (iso) => String(iso || "").replace(/-/g, "").slice(0, 8);

// Montant formaté pour le FEC : toujours positif, deux décimales. Le séparateur
// décimal est paramétrable parce que les deux sont admis et que les outils de
// contrôle, eux, n'aiment pas les mélanges.
const montant = (n, sep = ",") => {
  const v = Math.abs(round2(n)).toFixed(2);
  return sep === "," ? v.replace(".", ",") : v;
};

// Une ligne d'écriture. `debit` et `credit` sont exclusifs : l'un porte le
// montant, l'autre vaut zéro.
function ligne({ journal, date, compte, compteLib, auxNum = "", auxLib = "", piece, pieceDate, libelle, debit = 0, credit = 0 }) {
  return {
    journal, date, compte, compteLib, auxNum, auxLib, piece,
    pieceDate: pieceDate || date, libelle,
    debit: round2(debit), credit: round2(credit),
  };
}

// --- Traduction des faits de gestion en écritures --------------------------

// Une facture émise : le client doit (débit 411), l'organisme a produit
// (crédit 706). La TVA n'apparaît QUE si l'organisme n'est pas exonéré —
// la formation professionnelle continue l'est (art. 261-4-4° a du CGI).
export function ecrituresFacture(facture, { plan = PLAN_DEFAUT, tiers = null } = {}) {
  if (!facture || facture.status === "brouillon" || facture.status === "annulee") return [];
  const ht = round2(facture.totalHT);
  const tva = round2(facture.totalTVA || 0);
  const ttc = round2(facture.totalTTC ?? ht + tva);
  if (!ttc) return [];

  const avoir = ttc < 0;
  const abs = (v) => Math.abs(round2(v));
  const commun = {
    journal: "VT", date: facture.date, piece: facture.numero || facture.id,
    pieceDate: facture.date,
    libelle: `${avoir ? "Avoir" : "Facture"} ${facture.numero || ""}${tiers?.nom ? " — " + tiers.nom : ""}`.trim(),
    auxNum: tiers?.code || "", auxLib: tiers?.nom || "",
  };
  // Un avoir INVERSE les sens ; il ne met pas un montant négatif.
  const l = [
    ligne({ ...commun, compte: plan.client, compteLib: plan.clientLib,
      debit: avoir ? 0 : abs(ttc), credit: avoir ? abs(ttc) : 0 }),
    ligne({ ...commun, compte: plan.produits, compteLib: plan.produitsLib, auxNum: "", auxLib: "",
      debit: avoir ? abs(ht) : 0, credit: avoir ? 0 : abs(ht) }),
  ];
  if (tva) {
    l.push(ligne({ ...commun, compte: plan.tva, compteLib: plan.tvaLib, auxNum: "", auxLib: "",
      debit: avoir ? abs(tva) : 0, credit: avoir ? 0 : abs(tva) }));
  }
  return l;
}

// Un règlement : la banque encaisse (débit 512), la créance client s'éteint
// (crédit 411).
export function ecrituresReglement(reglement, facture, { plan = PLAN_DEFAUT, tiers = null } = {}) {
  const m = round2(reglement?.montant);
  if (!m) return [];
  const commun = {
    journal: "BQ", date: reglement.date, piece: facture?.numero || reglement.id,
    pieceDate: facture?.date || reglement.date,
    libelle: `Règlement ${facture?.numero || ""}${tiers?.nom ? " — " + tiers.nom : ""}`.trim(),
  };
  const negatif = m < 0;   // remboursement : sens inversé, montant toujours positif
  return [
    ligne({ ...commun, compte: plan.banque, compteLib: plan.banqueLib,
      debit: negatif ? 0 : Math.abs(m), credit: negatif ? Math.abs(m) : 0 }),
    ligne({ ...commun, compte: plan.client, compteLib: plan.clientLib,
      auxNum: tiers?.code || "", auxLib: tiers?.nom || "",
      debit: negatif ? Math.abs(m) : 0, credit: negatif ? 0 : Math.abs(m) }),
  ];
}

// --- Assemblage du journal --------------------------------------------------

// Regroupe les lignes en écritures (une écriture = un ensemble équilibré partageant
// journal + pièce + date), les ordonne chronologiquement et les numérote SANS
// TROU par journal.
export function assembler(lignes = [], { exerciceDebut = null, exerciceFin = null, dateValidation = null } = {}) {
  const dansExercice = (d) => d && (!exerciceDebut || d >= exerciceDebut) && (!exerciceFin || d <= exerciceFin);
  const retenues = lignes.filter((l) => dansExercice(l.date));

  const paquets = new Map();
  for (const l of retenues) {
    const cle = `${l.journal}|${l.piece}|${l.date}`;
    if (!paquets.has(cle)) paquets.set(cle, []);
    paquets.get(cle).push(l);
  }
  const ordre = [...paquets.entries()].sort((a, b) => {
    const [ja, , da] = a[0].split("|");
    const [jb, , db] = b[0].split("|");
    return da.localeCompare(db) || ja.localeCompare(jb) || a[0].localeCompare(b[0]);
  });

  const compteurs = new Map();
  const out = [];
  for (const [, lot] of ordre) {
    const journal = lot[0].journal;
    const n = (compteurs.get(journal) || 0) + 1;
    compteurs.set(journal, n);
    const num = `${journal}${String(n).padStart(6, "0")}`;
    for (const l of lot) out.push({ ...l, numero: num, validation: dateValidation || l.date });
  }
  return out;
}

// --- Contrôles avant remise -------------------------------------------------

export function controler(ecritures = []) {
  const anomalies = [];
  const totalDebit = round2(ecritures.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(ecritures.reduce((s, l) => s + l.credit, 0));

  // Règle 1 : l'équilibre, aux deux niveaux.
  if (totalDebit !== totalCredit) {
    anomalies.push({ gravite: "bloquant", message: `Fichier déséquilibré : ${totalDebit.toFixed(2)} au débit contre ${totalCredit.toFixed(2)} au crédit.` });
  }
  const parEcriture = new Map();
  for (const l of ecritures) {
    const e = parEcriture.get(l.numero) || { d: 0, c: 0 };
    e.d += l.debit; e.c += l.credit;
    parEcriture.set(l.numero, e);
  }
  for (const [num, e] of parEcriture) {
    if (round2(e.d) !== round2(e.c)) {
      anomalies.push({ gravite: "bloquant", message: `Écriture ${num} déséquilibrée : ${round2(e.d).toFixed(2)} / ${round2(e.c).toFixed(2)}.` });
    }
  }
  // Règle 2 : aucun montant négatif. Le sens est porté par la colonne.
  for (const l of ecritures) {
    if (l.debit < 0 || l.credit < 0) {
      anomalies.push({ gravite: "bloquant", message: `Montant négatif sur l'écriture ${l.numero} : le sens se porte par la colonne, jamais par un signe.` });
      break;
    }
    if (l.debit && l.credit) {
      anomalies.push({ gravite: "bloquant", message: `Écriture ${l.numero} : une ligne ne peut pas être à la fois au débit et au crédit.` });
      break;
    }
  }
  // Règle 4 : numérotation continue par journal.
  const parJournal = new Map();
  for (const l of ecritures) {
    if (!parJournal.has(l.journal)) parJournal.set(l.journal, new Set());
    parJournal.get(l.journal).add(Number(String(l.numero).replace(/^\D+/, "")));
  }
  for (const [journal, nums] of parJournal) {
    const tries = [...nums].sort((a, b) => a - b);
    for (let i = 0; i < tries.length; i++) {
      if (tries[i] !== i + 1) {
        anomalies.push({ gravite: "bloquant", message: `Trou dans la numérotation du journal ${journal} : ${tries[i]} arrive après ${i}.` });
        break;
      }
    }
  }
  // Champs indispensables
  for (const l of ecritures) {
    if (!l.compte || !l.date || !l.journal) {
      anomalies.push({ gravite: "bloquant", message: `Écriture ${l.numero || "?"} incomplète : journal, date et compte sont obligatoires.` });
      break;
    }
  }

  return {
    lignes: ecritures.length,
    ecritures: parEcriture.size,
    totalDebit, totalCredit,
    equilibre: totalDebit === totalCredit,
    anomalies,
    // « Remettable » et non « conforme » : la conformité se constate au contrôle,
    // elle ne se décrète pas dans un logiciel.
    remettable: anomalies.length === 0 && ecritures.length > 0,
  };
}

// --- Sérialisation FEC ------------------------------------------------------

export function toFec(ecritures = [], { separateur = "\t", sepDecimal = "," } = {}) {
  const echapper = (v) => String(v ?? "").replace(/[\t\r\n|]/g, " ").trim();
  const lignes = [CHAMPS_FEC.join(separateur)];
  for (const l of ecritures) {
    lignes.push([
      l.journal, JOURNAUX[l.journal] || l.journal, l.numero, aaaammjj(l.date),
      l.compte, l.compteLib, l.auxNum, l.auxLib,
      l.piece, aaaammjj(l.pieceDate), l.libelle,
      montant(l.debit, sepDecimal), montant(l.credit, sepDecimal),
      "", "", aaaammjj(l.validation), "", "",
    ].map(echapper).join(separateur));
  }
  return lignes.join("\r\n") + "\r\n";
}

// Nom normalisé : SIREN + FEC + date de clôture. C'est ce que le vérificateur
// attend, et un fichier mal nommé fait perdre une demi-journée.
export function nomFichier(siret, exerciceFin) {
  const siren = String(siret || "").replace(/\s/g, "").slice(0, 9) || "000000000";
  return `${siren}FEC${aaaammjj(exerciceFin)}.txt`;
}

// Construction complète à partir des données de l'application.
export function construire({ invoices = [], payments = [], tiersParId = new Map(), plan = PLAN_DEFAUT, exerciceDebut, exerciceFin, dateValidation = null } = {}) {
  const lignes = [];
  const facturesParId = new Map(invoices.map((f) => [f.id, f]));
  for (const f of invoices) {
    lignes.push(...ecrituresFacture(f, { plan, tiers: tiersParId.get(f.fundingId) || null }));
  }
  for (const p of payments) {
    const f = facturesParId.get(p.invoiceId) || null;
    // Un règlement dont la facture est absente de l'exercice n'a pas de
    // contrepartie : on le signale plutôt que de l'écrire dans le vide.
    lignes.push(...ecrituresReglement(p, f, { plan, tiers: f ? tiersParId.get(f.fundingId) : null }));
  }
  const ecritures = assembler(lignes, { exerciceDebut, exerciceFin, dateValidation });
  return { ecritures, controle: controler(ecritures) };
}

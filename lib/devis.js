// Devis et suivi commercial — logique pure, aucune I/O.
//
// LA CHAÎNE QUE CE MODULE FERME : offre du catalogue → devis → convention ou
// contrat → facturation. Chaque maillon reprend le précédent SANS RESSAISIE,
// parce que c'est la ressaisie qui fabrique les écarts — un tarif publié à
// 9 000 €, un devis à 8 500, une convention à 9 000 et une facture à 8 500.
//
// LA GARDE CENTRALE, ET ELLE EST JURIDIQUE :
//
//   UN DEVIS ACCEPTÉ N'EST PAS UNE CONVENTION.
//
//   C'est la confusion la plus naturelle — le client a dit oui, l'affaire est
//   faite — et la plus coûteuse. Un devis est une offre commerciale ; la
//   convention de formation est le document que le code du travail exige
//   (art. L. 6353-2), avec ses mentions obligatoires. Démarrer une formation
//   sur un devis signé, c'est l'exécuter sans le document requis : les mentions
//   manquantes ne sont pas des détails de forme, ce sont elles qui définissent
//   ce qui a été vendu. Le module transforme donc le devis EN acte, il ne le
//   promeut jamais au rang d'acte.
//
// LE SECOND PIÈGE, PLUS TERRE À TERRE : un devis a une DURÉE DE VALIDITÉ.
// Accepté après expiration, il n'engage plus aux conditions affichées — et
// entre-temps les tarifs ont pu changer, ou le niveau de prise en charge de la
// branche. Un logiciel qui ignore l'expiration laisse signer des conditions que
// l'organisme ne peut plus tenir.
//
// CE QUE CE MODULE NE FAIT PAS : un CRM. Il n'y a pas d'objet « opportunité »
// distinct, parce qu'il n'y en a pas besoin : pour un organisme de formation,
// le pipeline commercial EST la liste des devis en cours. Ajouter une entité
// parallèle obligerait à la tenir synchronisée avec les devis, et elle
// divergerait dès la première semaine.
//
// ⚠️ Durée de validité par défaut : c'est un usage, pas une règle. À fixer par
// l'établissement.

const jour = 864e5;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isoPlus = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * jour).toISOString().slice(0, 10);
const ecart = (a, b) => (a && b ? Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / jour) : null);

export const VALIDITE_DEFAUT_JOURS = 30;

// Les étapes SONT le pipeline. Ordonnées : c'est ce qui permet un entonnoir.
export const ETAPES = {
  brouillon: { label: "Brouillon", rang: 0, ouvert: true },
  envoye: { label: "Envoyé", rang: 1, ouvert: true },
  relance: { label: "Relancé", rang: 2, ouvert: true },
  accepte: { label: "Accepté", rang: 3, ouvert: false },
  refuse: { label: "Refusé", rang: 4, ouvert: false },
  expire: { label: "Expiré", rang: 5, ouvert: false },
  transforme: { label: "Transformé en acte", rang: 6, ouvert: false },
};

export function validateDevis(d = {}) {
  const errors = [], warnings = [];
  if (!String(d.client || "").trim()) errors.push("client requis");
  if (d.etape && !ETAPES[d.etape]) errors.push("étape inconnue");
  const lignes = Array.isArray(d.lignes) ? d.lignes : [];
  if (!lignes.length) errors.push("aucune ligne : un devis sans prestation ne chiffre rien");
  for (const l of lignes) {
    if (!String(l?.libelle || "").trim()) errors.push("une ligne sans libellé");
    const q = Number(l?.quantite), pu = Number(l?.prixUnitaire);
    if (!Number.isFinite(q) || q <= 0) errors.push(`quantité invalide sur « ${l?.libelle || "?"} »`);
    if (!Number.isFinite(pu) || pu < 0) errors.push(`prix unitaire invalide sur « ${l?.libelle || "?"} »`);
  }
  if (d.dateEmission && d.dateValidite && d.dateValidite < d.dateEmission) {
    errors.push("date de validité antérieure à l'émission");
  }
  if (!d.dateValidite) warnings.push("aucune date de validité : un devis sans terme engage indéfiniment aux conditions affichées");
  return { ok: errors.length === 0, errors, warnings };
}

export function totaux(d = {}) {
  const lignes = (d.lignes || []).map((l) => ({
    ...l, total: round2((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0)),
  }));
  const ht = round2(lignes.reduce((a, l) => a + l.total, 0));
  // La formation professionnelle est en principe exonérée de TVA lorsque
  // l'organisme détient l'attestation prévue à cet effet ; le taux est donc
  // DÉCLARÉ et vaut zéro par défaut, plutôt que d'appliquer 20 % à tort.
  const taux = d.tauxTva == null ? 0 : Number(d.tauxTva);
  const tva = round2(ht * taux);
  return { lignes, ht, taux, tva, ttc: round2(ht + tva) };
}

// État d'un devis à une date : c'est ici que l'expiration se constate, plutôt
// que d'attendre que quelqu'un change l'étape à la main.
export function etatDevis(d = {}, aujourdhui, { relanceJours = 10 } = {}) {
  const etape = ETAPES[d.etape] ? d.etape : "brouillon";
  const alertes = [];

  const expire = d.dateValidite && aujourdhui && aujourdhui > d.dateValidite;
  if (expire && ETAPES[etape].ouvert) {
    alertes.push({
      gravite: "important", code: "expire",
      message: `Devis expiré depuis le ${d.dateValidite} : il n'engage plus aux conditions affichées. Les tarifs ou le niveau de prise en charge ont pu changer entre-temps.`,
    });
  }
  if (etape === "accepte" && !d.acteId) {
    // LA GARDE CENTRALE, rappelée là où elle se joue.
    alertes.push({
      gravite: "bloquant", code: "sans_acte",
      message: "Devis accepté mais aucun acte établi : un devis n'est pas une convention de formation (art. L. 6353-2). Démarrer sur ce document, c'est exécuter sans le document requis.",
    });
  }
  if (etape === "envoye" && d.dateEnvoi && aujourdhui) {
    const depuis = ecart(d.dateEnvoi, aujourdhui);
    if (depuis != null && depuis >= relanceJours) {
      alertes.push({ gravite: "conseille", code: "a_relancer", message: `Envoyé il y a ${depuis} jours, sans réponse ni relance.` });
    }
  }
  return {
    etape: expire && ETAPES[etape].ouvert ? "expire" : etape,
    ouvert: ETAPES[etape].ouvert && !expire,
    expire: !!expire,
    alertes,
  };
}

// --- La transformation, et ce qu'elle refuse de faire ------------------------

// Prépare le contenu d'un acte à partir d'un devis. Le type se déduit du payeur,
// comme toujours : le devis ne le décide pas.
export function versActe(devis = {}, { payeur, programme = null } = {}) {
  const t = totaux(devis);
  const type = payeur === "particulier" ? "contrat" : "convention";
  return {
    type, payeur,
    intitule: devis.intitule || devis.lignes?.[0]?.libelle || "",
    objectifs: devis.objectifs || "",
    nature: devis.natureAction || "formation",
    dureeHeures: devis.dureeHeures ?? null,
    dates: devis.dateDebut && devis.dateFin ? `${devis.dateDebut} → ${devis.dateFin}` : "",
    dateDebut: devis.dateDebut || null, dateFin: devis.dateFin || null,
    effectif: devis.effectif ?? null,
    prix: t.ttc,
    moyens: devis.moyens || "", evaluation: devis.evaluation || "",
    // Ce qui n'était pas dans le devis reste VIDE : le pré-remplir d'un
    // « à compléter » ferait passer une mention manquante pour une mention
    // renseignée, et la validation de l'acte ne la verrait plus.
    resiliation: devis.resiliation || "",
    acheteur: payeur === "particulier" ? "" : devis.client || "",
    beneficiaire: payeur === "particulier" ? devis.client || "" : "",
    programme,
    devisId: devis.id || null,
  };
}

// Ce qui empêche la transformation. On refuse tôt : transformer un devis
// expiré, c'est contractualiser des conditions qu'on ne tient plus.
export function peutTransformer(devis = {}, aujourdhui) {
  const e = etatDevis(devis, aujourdhui);
  if (devis.acteId) return { autorise: false, motif: "ce devis a déjà été transformé en acte" };
  if (devis.etape !== "accepte") {
    return { autorise: false, motif: "seul un devis accepté se transforme en convention ou en contrat" };
  }
  if (e.expire) {
    return {
      autorise: false, forcable: true,
      motif: `devis expiré depuis le ${devis.dateValidite} : le transformer contractualiserait des conditions qui ne sont plus garanties. Réémettre un devis, ou confirmer en connaissance de cause.`,
    };
  }
  return { autorise: true };
}

// --- Pipeline ----------------------------------------------------------------
// Le pipeline commercial EST la liste des devis. Pas d'entité parallèle à tenir
// synchronisée — elle divergerait dès la première semaine.

export function pipeline(devis = [], aujourdhui) {
  const lignes = devis.map((d) => {
    const t = totaux(d);
    const e = etatDevis(d, aujourdhui);
    return {
      id: d.id, client: d.client, intitule: d.intitule || "",
      etape: e.etape, etapeLabel: ETAPES[e.etape]?.label || e.etape,
      ouvert: e.ouvert, montant: t.ttc,
      dateEmission: d.dateEmission || null, dateValidite: d.dateValidite || null,
      acteId: d.acteId || null, alertes: e.alertes,
    };
  });
  const parEtape = Object.keys(ETAPES).map((cle) => {
    const mien = lignes.filter((l) => l.etape === cle);
    return { etape: cle, label: ETAPES[cle].label, n: mien.length, montant: round2(mien.reduce((a, l) => a + l.montant, 0)) };
  });
  const ouverts = lignes.filter((l) => l.ouvert);
  const decides = lignes.filter((l) => ["accepte", "refuse", "transforme"].includes(l.etape));
  const gagnes = lignes.filter((l) => ["accepte", "transforme"].includes(l.etape));
  return {
    total: lignes.length,
    enCours: ouverts.length,
    montantEnCours: round2(ouverts.reduce((a, l) => a + l.montant, 0)),
    montantGagne: round2(gagnes.reduce((a, l) => a + l.montant, 0)),
    // Le taux se calcule sur les devis DÉCIDÉS : inclure ceux qui sont encore
    // en cours ferait baisser mécaniquement le chiffre chaque fois qu'on émet.
    tauxTransformation: decides.length ? Math.round((gagnes.length / decides.length) * 100) : null,
    parEtape, lignes,
    bloquants: lignes.reduce((a, l) => a + l.alertes.filter((x) => x.gravite === "bloquant").length, 0),
    reserve: "Le taux de transformation porte sur les devis tranchés. Les devis en cours n'y entrent pas : ils ne sont ni gagnés ni perdus.",
  };
}

// Date de validité par défaut, pour ne pas laisser le champ vide.
export function validiteParDefaut(dateEmission, jours = VALIDITE_DEFAUT_JOURS) {
  return dateEmission ? isoPlus(dateEmission, jours) : null;
}

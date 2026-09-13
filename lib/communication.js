// Envois en masse (courriel, SMS) — logique pure, aucun envoi réel ici.
//
// LA DISTINCTION QUI DÉCIDE DE TOUT, ET QUI EST JURIDIQUE AVANT D'ÊTRE TECHNIQUE :
//
//   • Un message de GESTION — convocation à une épreuve, changement de salle,
//     relance d'un justificatif d'absence — exécute le contrat de formation. Il
//     n'exige pas de consentement, et un apprenant ne peut pas s'y soustraire :
//     s'il pouvait se désinscrire de sa convocation d'examen, l'organisme
//     manquerait à son obligation d'information.
//
//   • Un message de PROSPECTION — journée portes ouvertes, offre de formation
//     continue — relève du consentement préalable (art. L. 34-5 du code des
//     postes et communications électroniques pour le courriel, et davantage
//     encore pour le SMS). Il exige un consentement et un lien de retrait.
//
// Confondre les deux se paie dans les deux sens : soumettre une convocation au
// consentement, c'est ne pas convoquer ; envoyer une invitation commerciale sans
// consentement, c'est une infraction. Le module refuse donc de traiter une
// campagne dont la nature n'est pas déclarée, et applique à chacune ses règles.
//
// TROIS AUTRES PARTIS PRIS :
//
//   1. LE DESTINATAIRE EST RÉSOLU, JAMAIS DEVINÉ. Un envoi part vers une liste
//      nominative, construite depuis les données de l'application (une classe,
//      les tuteurs d'une promotion…) et vérifiable avant expédition. Pas de
//      « tous les contacts ».
//
//   2. CE QUI EST PARTI EST TRACÉ. Qui, quoi, quand, par quel canal. C'est
//      autant une exigence RGPD qu'un besoin d'exploitation : « je n'ai jamais
//      reçu la convocation » est une objection qu'il faut pouvoir instruire.
//
//   3. LE SMS COÛTE ET SE COMPTE. Un message de plus de 160 caractères est
//      facturé en plusieurs SMS. Afficher le coût avant l'envoi évite la
//      surprise sur la facture — et les accents comptent double dans certains
//      encodages, ce qui surprend toujours.

export const CANAUX = {
  email: { label: "Courriel", limiteCar: null },
  sms: { label: "SMS", limiteCar: 160 },
};

export const NATURES = {
  gestion: {
    label: "Message de gestion (exécution du contrat)",
    consentementRequis: false,
    retraitRequis: false,
    aide: "Convocation, changement de planning, relance de justificatif. Le destinataire ne peut pas s'y soustraire.",
  },
  prospection: {
    label: "Message de prospection",
    consentementRequis: true,
    retraitRequis: true,
    aide: "Journée portes ouvertes, offre de formation. Exige un consentement préalable et un lien de retrait.",
  },
};

export const AUDIENCES = {
  classe: "Apprenants d'une classe",
  promotion: "Apprenants d'une année scolaire",
  tuteurs: "Maîtres d'apprentissage des apprenants d'une classe",
  representants: "Représentants légaux des apprenants mineurs",
  intervenants: "Intervenants d'un campus",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Numéros français, mobiles uniquement : envoyer un SMS sur un fixe coûte sans
// jamais arriver.
const MOBILE_RE = /^(?:\+33|0)\s*[67](?:[\s.-]*\d{2}){4}$/;

export const emailValide = (v) => EMAIL_RE.test(String(v || "").trim());
export const mobileValide = (v) => MOBILE_RE.test(String(v || "").trim());

// Segments SMS. Les caractères hors GSM-7 (é, à, œ, emoji…) font basculer le
// message en UCS-2, où la limite tombe à 70 caractères par segment. Un texte de
// 80 caractères peut donc coûter un SMS ou deux selon sa ponctuation.
const GSM7 = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
export function segmentsSms(texte = "") {
  const s = String(texte);
  if (!s.length) return { segments: 0, encodage: "GSM-7", limite: 160 };
  const gsm = GSM7.test(s);
  const limite = gsm ? 160 : 70;
  const limiteMulti = gsm ? 153 : 67;   // l'en-tête de concaténation consomme de la place
  const segments = s.length <= limite ? 1 : Math.ceil(s.length / limiteMulti);
  return { segments, encodage: gsm ? "GSM-7" : "UCS-2", limite, caracteres: s.length };
}

// Substitution des variables du modèle. Une variable non résolue est signalée :
// envoyer « Bonjour {{prenom}} » à trois cents personnes est un incident.
export function fusionner(modele = "", donnees = {}) {
  const manquantes = new Set();
  const texte = String(modele).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, cle) => {
    const v = donnees[cle];
    if (v === undefined || v === null || v === "") { manquantes.add(cle); return `{{${cle}}}`; }
    return String(v);
  });
  return { texte, manquantes: [...manquantes] };
}

// Préparation d'un envoi. Rien ne part d'ici : la fonction dit ce qui partirait,
// à qui, à quel coût, et ce qui l'empêche.
export function preparer({ canal = "email", nature = null, sujet = "", corps = "", destinataires = [], lienRetrait = null } = {}) {
  const errors = [], warnings = [];
  const c = CANAUX[canal];
  const n = NATURES[nature];

  if (!c) errors.push(`canal inconnu (${Object.keys(CANAUX).join(", ")})`);
  // La nature n'a pas de valeur par défaut : la deviner serait trancher une
  // question juridique à la place de l'organisme.
  if (!n) errors.push(`nature du message requise (${Object.keys(NATURES).join(", ")}) — elle détermine les obligations applicables`);
  if (!String(corps || "").trim()) errors.push("corps du message requis");
  if (canal === "email" && !String(sujet || "").trim()) errors.push("objet du courriel requis");
  if (!destinataires.length) errors.push("aucun destinataire");

  const retenus = [], ecartes = [];
  for (const d of destinataires) {
    const adresse = canal === "email" ? String(d.email || "").trim() : String(d.telephone || "").trim();
    if (!adresse) { ecartes.push({ ...d, motif: canal === "email" ? "aucune adresse" : "aucun numéro" }); continue; }
    if (canal === "email" && !emailValide(adresse)) { ecartes.push({ ...d, motif: "adresse invalide" }); continue; }
    if (canal === "sms" && !mobileValide(adresse)) { ecartes.push({ ...d, motif: "numéro non mobile ou invalide" }); continue; }
    // Le consentement ne se vérifie QUE pour la prospection. L'exiger pour une
    // convocation reviendrait à ne pas convoquer.
    if (n?.consentementRequis && !d.consentement) { ecartes.push({ ...d, motif: "consentement absent pour un message de prospection" }); continue; }
    if (d.optOut && n?.consentementRequis) { ecartes.push({ ...d, motif: "s'est retiré des envois de prospection" }); continue; }
    const f = fusionner(corps, d.variables || {});
    if (f.manquantes.length) { ecartes.push({ ...d, motif: `variables non résolues : ${f.manquantes.join(", ")}` }); continue; }
    retenus.push({ ...d, adresse, texte: f.texte });
  }

  if (n?.retraitRequis && !lienRetrait) errors.push("un message de prospection doit porter un lien de retrait");
  if (ecartes.length && !retenus.length) errors.push("aucun destinataire exploitable");

  const cout = canal === "sms"
    ? retenus.reduce((s, r) => s + segmentsSms(r.texte).segments, 0)
    : retenus.length;
  const multi = canal === "sms" ? retenus.filter((r) => segmentsSms(r.texte).segments > 1).length : 0;
  if (multi) warnings.push(`${multi} message(s) dépassent un SMS : ils seront facturés en plusieurs segments (les accents font tomber la limite à 70 caractères).`);
  if (ecartes.length) warnings.push(`${ecartes.length} destinataire(s) écarté(s) — voir le détail avant d'envoyer.`);

  return {
    canal, nature, natureLabel: n?.label || null,
    sujet, retenus, ecartes,
    total: retenus.length,
    coutSms: canal === "sms" ? cout : 0,
    errors, warnings,
    // « Envoyable » : c'est une décision technique. La pertinence du message
    // reste celle de son auteur.
    envoyable: errors.length === 0 && retenus.length > 0,
  };
}

// Trace d'un envoi, destinée au journal. Ni le corps complet ni le numéro ne
// sont conservés en clair : on garde de quoi prouver l'envoi, pas de quoi
// reconstituer une base de contacts.
export function tracer({ campagneId, canal, nature, sujet, destinataire, adresse, statut = "envoye", erreur = null, envoyeLe = null }) {
  const masque = (a) => {
    const s = String(a || "");
    if (s.includes("@")) { const [n, d] = s.split("@"); return `${n.slice(0, 2)}***@${d}`; }
    return s.length > 4 ? `${s.slice(0, 4)}***${s.slice(-2)}` : "***";
  };
  return {
    campagneId, canal, nature, sujet: String(sujet || "").slice(0, 120),
    destinataireId: destinataire?.id || null,
    destinataireNom: destinataire?.nom || "",
    adresseMasquee: masque(adresse),
    statut, erreur: erreur ? String(erreur).slice(0, 200) : null,
    envoyeLe: envoyeLe || new Date().toISOString(),
  };
}

// Synthèse d'une campagne : c'est elle qui permet d'instruire « je n'ai jamais
// reçu la convocation ».
export function bilan(traces = []) {
  const envoyes = traces.filter((t) => t.statut === "envoye");
  const echecs = traces.filter((t) => t.statut === "echec");
  return {
    total: traces.length,
    envoyes: envoyes.length,
    echecs: echecs.length,
    parCanal: Object.keys(CANAUX).map((c) => ({ canal: c, total: traces.filter((t) => t.canal === c).length })).filter((x) => x.total),
    detailEchecs: echecs.map((t) => ({ destinataire: t.destinataireNom, adresse: t.adresseMasquee, erreur: t.erreur })),
  };
}

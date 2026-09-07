// Politique de conservation des données — RGPD art. 5.1.e.
//
// POURQUOI UN MODULE DÉDIÉ : une durée de conservation éparpillée dans le code
// n'est ni auditable ni défendable. Ici, chaque catégorie de données porte sa
// durée, sa base juridique et son mode de suppression, au même endroit. C'est ce
// tableau qu'on montre à un DPO, et c'est lui qui pilote la purge automatique.
//
// PRINCIPE DE CONCEPTION : les durées sont des DÉFAUTS de l'éditeur, surchargeables
// par établissement (le responsable de traitement, c'est le client, pas nous).
// Aucune purge ne s'exécute sans qu'une durée soit explicitement définie ici.

export const LEGAL_BASIS = {
  contrat: "Exécution du contrat de formation",
  obligation: "Obligation légale",
  interet: "Intérêt légitime",
  consentement: "Consentement",
};

// `months: null` = conservation liée au cycle de vie de l'entité mère (pas de purge
// par ancienneté), traitée par la cascade d'effacement et non par le calendrier.
export const RETENTION_POLICY = {
  signatures: {
    label: "Signatures manuscrites d'émargement (images)",
    months: 13,
    basis: "obligation",
    why: "Preuve de réalisation opposable pendant un cycle de contrôle financeur complet. Au-delà, l'empreinte conservée dans la feuille scellée suffit à prouver l'intégrité : l'image devient une donnée d'identification sans usage.",
    method: "Suppression des fichiers image ; la feuille et son scellement restent intacts.",
  },
  attendanceSheets: {
    label: "Feuilles d'émargement",
    months: 60,
    basis: "obligation",
    why: "Preuve de réalisation de l'action de formation : contrôles financeur, Qualiopi et prescription administrative.",
    method: "Suppression des feuilles closes antérieures ; le journal d'ancrage conserve la trace des empreintes publiées.",
  },
  candidates: {
    label: "Candidatures non converties",
    months: 24,
    basis: "interet",
    why: "Durée usuelle de conservation d'un prospect en formation (deux campagnes de recrutement). Une candidature convertie suit le sort du dossier apprenant.",
    method: "Suppression des candidatures jamais rattachées à un dossier apprenant.",
  },
  portalAccessRevoked: {
    label: "Accès portail révoqués ou expirés",
    months: 12,
    basis: "interet",
    why: "Traçabilité des accès accordés, utile en cas d'incident de sécurité. Au-delà, l'enregistrement ne contient plus qu'un nom et des dates d'usage.",
    method: "Suppression des accès révoqués ou expirés.",
  },
  anchors: {
    label: "Journal d'ancrage de la chaîne d'émargement",
    months: 60,
    basis: "obligation",
    why: "Aligné sur la conservation des feuilles d'émargement : un ancrage sans les feuilles qu'il atteste n'a plus d'objet.",
    method: "Suppression des ancrages antérieurs.",
  },
  audit: {
    label: "Journal d'audit applicatif",
    months: 12,
    basis: "interet",
    why: "Traçabilité des actions et sécurité du système.",
    method: "Purge par date (mécanisme existant).",
  },
  learners: {
    label: "Dossiers apprenants, inscriptions, notes, contrats",
    months: null,
    basis: "contrat",
    why: "Conservés pendant la scolarité puis pendant la durée de prescription applicable aux titres et diplômes. La suppression intervient sur demande d'effacement ou par décision de l'établissement, non par un calendrier automatique.",
    method: "Effacement en cascade à la demande (voir purgeLearner).",
  },
};

export const RETENTION_KEYS = Object.keys(RETENTION_POLICY);

// Durée effective : réglage de l'établissement s'il existe, défaut éditeur sinon.
export function retentionMonths(key, settings = {}) {
  const override = settings?.retention?.[key];
  if (override === null) return null;                       // « ne jamais purger », choix explicite
  if (override !== undefined && override !== "" && Number.isFinite(Number(override))) return Number(override);
  return RETENTION_POLICY[key]?.months ?? null;
}

// Date limite : tout ce qui est antérieur est purgeable. `null` = pas de purge.
export function cutoffDate(key, settings = {}, now = new Date()) {
  const months = retentionMonths(key, settings);
  if (months == null) return null;
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

// Vue lisible de la politique, pour l'écran RGPD et le registre des traitements.
export function policyView(settings = {}) {
  return RETENTION_KEYS.map((key) => {
    const p = RETENTION_POLICY[key];
    const months = retentionMonths(key, settings);
    return {
      key, label: p.label, months,
      isDefault: months === p.months,
      defaultMonths: p.months,
      basis: p.basis, basisLabel: LEGAL_BASIS[p.basis] || p.basis,
      why: p.why, method: p.method,
    };
  });
}

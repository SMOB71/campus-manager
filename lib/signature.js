// Signature électronique de documents — logique pure (aucune I/O).
//
// CE QUE CE MODULE PRODUIT, EXACTEMENT, ET POURQUOI C'EST ÉCRIT NOIR SUR BLANC
//
// Le règlement eIDAS distingue trois niveaux : SIMPLE, AVANCÉE, QUALIFIÉE. Ils
// n'ont pas la même valeur probatoire, et la différence ne se rattrape pas après
// coup, devant un juge ou un financeur.
//
//   • Ce module produit une signature ÉLECTRONIQUE SIMPLE : identification du
//     signataire par un lien nominatif à usage unique, horodatage, empreinte du
//     document signé, et scellement de l'ensemble dans une chaîne inaltérable.
//     C'est juridiquement recevable — une signature ne peut pas être écartée au
//     seul motif qu'elle est électronique — mais la charge de la preuve pèse sur
//     celui qui s'en prévaut.
//
//   • Il ne produit NI signature avancée NI signature qualifiée. Celles-ci
//     exigent un dispositif de création de signature et, pour la qualifiée, un
//     certificat délivré par un prestataire de confiance qualifié. Prétendre les
//     fournir sans prestataire serait un mensonge coûteux le jour où le document
//     est contesté.
//
// D'où le champ `niveau`, toujours présent, toujours « simple », et repris sur
// le certificat de preuve. Un connecteur vers un prestataire qualifié pourra
// élever ce niveau ; tant qu'il n'existe pas, le module ne le prétend pas.
//
// LE DOCUMENT SIGNÉ EST FIGÉ PAR SON EMPREINTE. Signer « le contrat » ne veut
// rien dire : on signe UN état du document. Si l'empreinte change après coup, la
// signature ne vaut plus pour la nouvelle version — et le module le détecte.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const NIVEAU = "simple";
export const NIVEAU_LABEL = "Signature électronique simple (eIDAS)";

export const ETATS = {
  brouillon: "Brouillon",
  envoye: "Envoyée aux signataires",
  partiel: "Partiellement signée",
  signe: "Signée par toutes les parties",
  refuse: "Refusée",
  expire: "Expirée",
};

// Les parties d'un contrat d'apprentissage. L'ordre n'a pas d'importance
// juridique, mais l'exhaustivité si : un contrat auquel il manque une signature
// n'est pas un contrat.
export const ROLES = {
  apprenant: "Apprenant",
  representant: "Représentant légal",
  employeur: "Employeur",
  organisme: "Organisme de formation",
};

export const sha256 = (v) => createHash("sha256").update(String(v ?? ""), "utf8").digest("hex");

// Jeton de signature : nominatif, à usage unique, jamais stocké en clair — même
// règle que les accès portail. Un jeton relisible en base est un jeton volé.
export function genererJeton() {
  const jeton = randomBytes(32).toString("base64url");
  return { jeton, hash: sha256(jeton) };
}
export function jetonCorrespond(jeton, hashStocke) {
  if (!jeton || !hashStocke) return false;
  const a = Buffer.from(sha256(jeton), "utf8");
  const b = Buffer.from(String(hashStocke), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Sérialisation canonique : deux objets identiques doivent donner la même
// empreinte quel que soit l'ordre des clés, sinon la vérification échouerait
// pour une raison qui n'a rien à voir avec une altération.
export function canonique(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonique).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonique(v[k])).join(",") + "}";
}

export const empreinteDocument = (doc) => sha256(canonique(doc));

export function validateDemande(d = {}) {
  const errors = [], warnings = [];
  if (!String(d.titre || "").trim()) errors.push("titre du document requis");
  if (!d.empreinte) errors.push("empreinte du document requise — on ne signe pas « le contrat », on signe un état du contrat");
  const parties = Array.isArray(d.parties) ? d.parties : [];
  if (!parties.length) errors.push("au moins une partie signataire requise");
  for (const p of parties) {
    if (!ROLES[p.role]) errors.push(`rôle inconnu : ${p.role}`);
    if (!String(p.nom || "").trim()) errors.push("nom d'un signataire manquant");
    if (!p.email && !p.telephone) errors.push(`aucun moyen de joindre ${p.nom || "un signataire"}`);
  }
  // Un contrat d'apprentissage sans l'employeur n'est pas un contrat.
  if (d.type === "contrat_apprentissage") {
    for (const requis of ["apprenant", "employeur", "organisme"]) {
      if (!parties.some((p) => p.role === requis)) errors.push(`partie obligatoire absente : ${ROLES[requis]}`);
    }
  }
  if (d.expireLe && d.envoyeLe && d.expireLe < d.envoyeLe) errors.push("date d'expiration antérieure à l'envoi");
  if (!d.expireLe) warnings.push("aucune date d'expiration : une demande de signature qui traîne finit par être signée par erreur");
  return { ok: errors.length === 0, errors, warnings };
}

// Enregistrement d'une signature. Les éléments de preuve sont figés ici : ils ne
// doivent plus jamais bouger, c'est tout leur intérêt.
export function signer({ demande, partieId, jeton, ip = null, userAgent = null, maintenant = null, prevHash = null }) {
  const partie = (demande?.parties || []).find((p) => p.id === partieId);
  if (!partie) return { error: "signataire inconnu" };
  if (partie.signeLe) return { error: "cette partie a déjà signé" };
  if (!jetonCorrespond(jeton, partie.jetonHash)) return { error: "lien de signature invalide" };

  const horodatage = maintenant || new Date().toISOString();
  if (demande.expireLe && horodatage.slice(0, 10) > demande.expireLe) {
    return { error: `demande expirée le ${demande.expireLe}` };
  }

  const preuve = {
    partieId, role: partie.role, nom: partie.nom,
    // L'empreinte du document AU MOMENT de la signature : c'est elle qui permet
    // de dire plus tard si le document a changé depuis.
    empreinteDocument: demande.empreinte,
    signeLe: horodatage,
    ip: ip || null,
    // L'agent est tronqué : il sert à caractériser l'acte, pas à profiler.
    agent: userAgent ? String(userAgent).slice(0, 120) : null,
    niveau: NIVEAU,
  };
  // Chaînage : chaque signature scelle la précédente. Reprendre une signature
  // isolée sans refaire toute la chaîne devient impossible.
  const hash = sha256((prevHash || "GENESIS") + "|" + canonique(preuve));
  return { preuve: { ...preuve, prevHash: prevHash || null, hash } };
}

// État d'une demande après les signatures recueillies.
export function etatDemande(demande = {}) {
  const parties = demande.parties || [];
  const signees = parties.filter((p) => p.signeLe);
  let etat = demande.etat || "brouillon";
  if (demande.refuseLe) etat = "refuse";
  else if (signees.length && signees.length === parties.length) etat = "signe";
  else if (signees.length) etat = "partiel";
  else if (demande.envoyeLe) etat = "envoye";
  return {
    etat, etatLabel: ETATS[etat],
    niveau: NIVEAU, niveauLabel: NIVEAU_LABEL,
    total: parties.length,
    signees: signees.length,
    manquantes: parties.filter((p) => !p.signeLe).map((p) => `${ROLES[p.role] || p.role} — ${p.nom}`),
    complet: signees.length > 0 && signees.length === parties.length,
  };
}

// Vérification d'intégrité : la chaîne tient-elle, et le document est-il resté
// celui qui a été signé ?
export function verifier({ demande = {}, empreinteActuelle = null } = {}) {
  const preuves = (demande.parties || []).filter((p) => p.preuve).map((p) => p.preuve)
    .sort((a, b) => String(a.signeLe).localeCompare(String(b.signeLe)));
  const problemes = [];
  let prev = null;
  for (const p of preuves) {
    const { hash, prevHash, ...corps } = p;
    const attendu = sha256((prev || "GENESIS") + "|" + canonique(corps));
    if (prevHash !== prev) problemes.push({ gravite: "critique", message: `Chaînage rompu à la signature de ${p.nom}.` });
    if (hash !== attendu) problemes.push({ gravite: "critique", message: `Signature de ${p.nom} altérée depuis son enregistrement.` });
    prev = hash;
  }
  // Le document a-t-il bougé APRÈS avoir été signé ? C'est la question que pose
  // un contradicteur, et il faut pouvoir y répondre par un calcul.
  if (empreinteActuelle && demande.empreinte && empreinteActuelle !== demande.empreinte) {
    problemes.push({
      gravite: "critique",
      message: "Le document a été modifié depuis la demande de signature : les signatures recueillies ne valent pas pour cette version.",
    });
  }
  return {
    signatures: preuves.length,
    intact: problemes.length === 0,
    problemes,
    niveau: NIVEAU, niveauLabel: NIVEAU_LABEL,
    // Dit explicitement ce que la preuve ne couvre PAS.
    reserve: "Signature électronique simple : recevable, mais la charge de la preuve pèse sur celui qui s'en prévaut. Une signature avancée ou qualifiée exige un prestataire de confiance.",
  };
}

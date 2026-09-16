// Réalisation d'une étape de projet — logique pure, aucune I/O.
//
// CE QUE « FAIT » DOIT VOULOIR DIRE.
//
// Une case cochée ne dit rien. Six mois plus tard, devant un auditeur, un
// financeur ou simplement devant le comité suivant, « conseil de
// perfectionnement : fait » n'apprend rien : ni quand, ni avec qui, ni ce qui
// s'y est décidé, ni quelle pièce le prouve. Une étape réalisée se compose donc
// de trois choses, et les trois sont nécessaires :
//
//   1. UN COMPTE RENDU — ce qui a été fait, en toutes lettres. C'est le seul
//      élément qui survit au départ de celui qui l'a fait.
//   2. DES PERSONNES RATTACHÉES — pas des chaînes de caractères. On ne convoque
//      pas « le directeur », on convoque quelqu'un à une adresse.
//   3. UNE PIÈCE QUI VALIDE — le compte rendu dit ce qu'on a fait, la pièce le
//      démontre. Un procès-verbal signé, une attestation, un récépissé.
//
// LE PARTI PRIS SUR LES PERSONNES, ET IL ÉVITE UNE DIVERGENCE CERTAINE :
//
//   Un seul répertoire alimente les membres de comité ET les responsabilités
//   des étapes. Deux listes parallèles — « les membres du COPIL » d'un côté,
//   « le responsable de la tâche » de l'autre — se désynchronisent à la
//   première arrivée ou au premier départ, et personne ne sait plus laquelle
//   fait foi le jour où il faut convoquer.
//
// CE QUE LE MODULE NE FAIT PAS : bloquer. Une étape peut être cochée vite, en
// réunion, pour avancer. Mais l'écart est NOMMÉ, et il remonte — parce qu'une
// liste de tâches vertes sans aucune pièce est exactement ce qu'un audit
// démonte en dix minutes.

const vide = (v) => !String(v ?? "").trim();

// Les quatre responsabilités. `convoque` dit qui reçoit quoi : tout le monde
// n'a pas à être convoqué, mais tout le monde doit être joignable.
export const RACI = {
  owner: { label: "Réalise", code: "R", convoque: true },
  accountable: { label: "Approuve", code: "A", convoque: true },
  consulted: { label: "Consulté", code: "C", convoque: true },
  informed: { label: "Informé", code: "I", convoque: false },
};

// Une personne du répertoire projet. `userId` la relie à un compte applicatif
// quand elle en a un ; sans compte, elle reste un participant nommé et
// joignable — ce qui suffit pour la convoquer.
export function validatePersonne(p = {}) {
  const errors = [], warnings = [];
  if (vide(p.nom)) errors.push("nom requis");
  // Sans adresse, la personne ne peut pas être convoquée : c'est le seul
  // objet du répertoire.
  if (vide(p.email)) errors.push("adresse de courriel requise : une personne sans adresse ne peut pas être convoquée");
  else if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(p.email).trim())) errors.push("adresse invalide");
  if (vide(p.role)) warnings.push("aucun rôle indiqué : la lecture d'un ordre du jour y perd");
  return { ok: errors.length === 0, errors, warnings };
}

// Résout les responsabilités d'une étape en personnes réelles.
// `etape` peut porter des identifiants (ownerId, consultedIds…) ET, pour les
// plans anciens, de simples chaînes. On ne jette pas les chaînes : on les
// signale comme NON RÉSOLUES, ce qui est la seule chose honnête à en dire.
export function resoudreRaci(etape = {}, repertoire = []) {
  const parId = new Map(repertoire.map((p) => [p.id, p]));
  const lignes = [];

  for (const [cle, def] of Object.entries(RACI)) {
    const ids = cle === "consulted" || cle === "informed"
      ? (Array.isArray(etape[`${cle}Ids`]) ? etape[`${cle}Ids`] : [])
      : (etape[`${cle}Id`] ? [etape[`${cle}Id`]] : []);

    const personnes = ids.map((id) => parId.get(id)).filter(Boolean);
    const introuvables = ids.filter((id) => !parId.has(id));
    // Le texte libre hérité : on l'affiche, on ne prétend pas l'avoir résolu.
    const libre = String(etape[cle] || "").trim();

    lignes.push({
      cle, label: def.label, code: def.code, convoque: def.convoque,
      personnes, introuvables,
      libre: libre || null,
      // « Non résolu » = un nom écrit à la main, sans personne derrière.
      nonResolu: !!libre && personnes.length === 0,
    });
  }
  return lignes;
}

// Qui peut effectivement recevoir une convocation. C'est la question qui compte
// au moment d'envoyer, et elle se pose avant, pas après l'échec de l'envoi.
export function convocables(etape = {}, repertoire = []) {
  const lignes = resoudreRaci(etape, repertoire);
  const retenus = [], ecartes = [];
  for (const l of lignes) {
    if (!l.convoque) continue;
    for (const p of l.personnes) {
      if (vide(p.email)) { ecartes.push({ nom: p.nom, motif: "aucune adresse enregistrée" }); continue; }
      if (!retenus.some((r) => r.id === p.id)) retenus.push({ ...p, roles: [l.code] });
      else retenus.find((r) => r.id === p.id).roles.push(l.code);
    }
    if (l.nonResolu) {
      ecartes.push({ nom: l.libre, motif: `« ${l.libre} » est un nom saisi à la main : aucune personne du répertoire ne lui correspond, il n'y a donc pas d'adresse où écrire` });
    }
    for (const id of l.introuvables) ecartes.push({ nom: id, motif: "personne supprimée du répertoire" });
  }
  return {
    retenus, ecartes,
    // On ne part pas à moitié : si quelqu'un devait être convoqué et ne peut
    // pas l'être, celui qui envoie doit le savoir AVANT.
    complet: ecartes.length === 0 && retenus.length > 0,
    motif: !retenus.length ? "aucun destinataire joignable" : null,
  };
}

// --- Ce qui fait qu'une étape est réellement réalisée -------------------------

export function validateRealisation(etape = {}, { repertoire = [], documents = [] } = {}) {
  const manques = [];
  const fait = etape.status === "done";
  const parDoc = new Set(documents.map((d) => d.id));

  if (fait) {
    // 1. LE COMPTE RENDU.
    if (vide(etape.realisation?.texte)) {
      manques.push({
        cle: "compte_rendu", gravite: "important",
        message: "Étape cochée sans compte rendu : « fait » n'apprend rien six mois plus tard, ni à un auditeur ni au comité suivant.",
      });
    }
    // 2. LA PIÈCE QUI VALIDE. On ne l'exige que si l'étape annonce un livrable :
    //    toutes les étapes n'en produisent pas.
    const livrables = (etape.outputs || []).filter((o) => String(o.label || "").trim());
    const preuves = (etape.preuves || []).filter((p) => p.documentId);
    if (livrables.length && !preuves.length) {
      manques.push({
        cle: "preuve", gravite: "important",
        message: `${livrables.length} livrable(s) annoncé(s) sans aucune pièce annexée : le compte rendu dit ce qui a été fait, la pièce le démontre.`,
      });
    }
    // Une pièce qui pointe dans le vide est pire que pas de pièce : elle
    // rassure sans rien prouver.
    const orphelines = preuves.filter((p) => !parDoc.has(p.documentId));
    if (orphelines.length) {
      manques.push({
        cle: "preuve_introuvable", gravite: "bloquant",
        message: `${orphelines.length} pièce(s) annexée(s) ne correspondent à aucun document : la référence rassure sans rien démontrer.`,
      });
    }
    if (!etape.realisation?.par) {
      manques.push({ cle: "auteur", gravite: "conseille", message: "Personne n'est identifié comme ayant réalisé l'étape." });
    }
  }

  // 3. LES PERSONNES — indépendant du statut : on doit pouvoir convoquer AVANT.
  const raci = resoudreRaci(etape, repertoire);
  const nonResolus = raci.filter((l) => l.nonResolu);
  if (nonResolus.length) {
    manques.push({
      cle: "raci_non_resolu", gravite: "important",
      message: `${nonResolus.map((l) => `${l.label} : « ${l.libre} »`).join(", ")} — nom saisi à la main. On ne convoque pas une chaîne de caractères : rattacher la personne au répertoire.`,
    });
  }
  if (!raci.some((l) => l.cle === "owner" && (l.personnes.length || l.libre))) {
    manques.push({ cle: "sans_responsable", gravite: "important", message: "Aucun responsable : l'étape n'appartient à personne." });
  }

  return {
    fait, raci, manques,
    bloquants: manques.filter((m) => m.gravite === "bloquant").length,
    // « Documentée » et non « conforme » : on constate qu'il y a de quoi
    // expliquer ce qui a été fait, pas que c'était bien fait.
    documentee: fait && manques.filter((m) => m.gravite !== "conseille").length === 0,
  };
}

// --- Vue d'ensemble d'un plan -------------------------------------------------
// Une liste de tâches vertes sans aucune pièce est ce qu'un audit démonte en
// dix minutes : ce tableau existe pour qu'on le voie avant lui.

export function etatPlan(etapes = [], { repertoire = [], documents = [] } = {}) {
  const lignes = etapes.map((e) => {
    const v = validateRealisation(e, { repertoire, documents });
    return {
      id: e.id, titre: e.title || "", lot: e.lot || "autre", status: e.status,
      doneAt: e.doneAt || null,
      aCompteRendu: !vide(e.realisation?.texte),
      preuves: (e.preuves || []).filter((p) => p.documentId).length,
      documentee: v.documentee, manques: v.manques,
    };
  });
  const faites = lignes.filter((l) => l.status === "done");
  return {
    total: lignes.length, faites: faites.length,
    documentees: faites.filter((l) => l.documentee).length,
    sansCompteRendu: faites.filter((l) => !l.aCompteRendu).length,
    sansPreuve: faites.filter((l) => !l.preuves).length,
    racineNonResolus: lignes.filter((l) => l.manques.some((m) => m.cle === "raci_non_resolu")).length,
    lignes,
    reserve: "« Documentée » signifie qu'il existe de quoi expliquer ce qui a été fait. Ce n'est pas un jugement sur la qualité de l'exécution.",
  };
}

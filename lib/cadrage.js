// Alimenter un projet depuis une note de cadrage.
//
// LE PROBLÈME. Le pack documentaire sort « — à renseigner — » partout tant que
// la fiche du projet est vide : contexte, périmètre, commanditaire, sponsor,
// risques, indicateurs, gouvernance. Or ces informations EXISTENT presque
// toujours déjà — dans la note de cadrage, le compte rendu du comité qui a
// lancé le projet, le mail d'arbitrage, la note au COMEX. Elles sont dans un
// document Word que personne n'a envie de ressaisir dans quinze champs.
//
// Ce module lit ce document et en propose le contenu. Il ne l'écrit pas.
//
// TROIS RÈGLES, et elles sont la raison d'être du fichier :
//
//   1. RIEN N'EST INVENTÉ. L'analyse est déterministe : aucun modèle de langage
//      n'intervient ici. Ce qui n'est pas écrit dans la note ressort comme
//      absent — jamais comblé, jamais déduit « logiquement ».
//
//   2. RIEN N'ENTRE SANS UN CLIC. `analyser()` produit une PROPOSITION. Le
//      rapprochement avec le projet (`fusionner`) ne se fait que sur les
//      rubriques que l'humain a retenues. C'est la règle de la maison, déjà
//      posée sur la finance et les référentiels : une donnée qui s'écrit toute
//      seule est une donnée que personne ne relit.
//
//   3. AUCUNE DATE N'EST DEVINÉE. Une date ne vaut que si elle est écrite en
//      toutes lettres ou en chiffres (ISO, jj/mm/aaaa, « 12 juin 2026 »).
//      « fin du premier trimestre » reste du texte et remonte comme tel : un
//      planning qui s'invente un 31 mars produit des engagements que personne
//      n'a pris.
//
// CE QU'IL DIT EN PLUS, et qui vaut le détour : la liste de ce que la note ne
// dit PAS. Savoir avant de générer les documents que le sponsor et les
// indicateurs manquent vaut mieux que de le découvrir dans un Word déjà
// diffusé.

const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const propre = (s) => String(s || "").replace(/\s+/g, " ").trim();
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

// Rubriques reconnues. Les synonymes sont ceux qu'on rencontre réellement dans
// les notes : une note de cadrage écrite par une direction générale ne dit pas
// « hors périmètre », elle dit « ce qui n'est pas couvert ».
export const RUBRIQUES = [
  { cle: "objectif", type: "texte", mots: ["objectif", "objectifs", "but", "finalite", "finalites", "resultat attendu", "resultats attendus"] },
  { cle: "contexte", type: "texte", mots: ["contexte", "situation", "constat", "pourquoi", "enjeu", "enjeux", "origine"] },
  { cle: "horsPerimetre", type: "texte", mots: ["hors perimetre", "hors-perimetre", "exclusions", "exclu", "exclus", "ce qui n'est pas couvert", "non couvert", "ne comprend pas"] },
  { cle: "perimetre", type: "texte", mots: ["perimetre", "champ", "couvre", "inclus", "contenu du projet"] },
  { cle: "commanditaire", type: "ligne", mots: ["commanditaire", "maitre d'ouvrage", "moa", "demandeur"] },
  { cle: "sponsor", type: "ligne", mots: ["sponsor", "parrain", "sponsor executif"] },
  { cle: "coSponsor", type: "ligne", mots: ["co-sponsor", "cosponsor", "co sponsor"] },
  { cle: "relaisDG", type: "ligne", mots: ["relais dg", "relais direction", "referent direction generale"] },
  { cle: "pilote", type: "ligne", mots: ["pilote", "chef de projet", "cheffe de projet", "responsable du projet", "moe", "directeur de projet"] },
  { cle: "budget", type: "montant", mots: ["budget", "enveloppe", "cout", "couts", "investissement"] },
  { cle: "chantiers", type: "liste", mots: ["chantiers", "lots", "axes", "phases", "volets", "ateliers", "workstreams", "plan d'action", "actions", "taches"] },
  { cle: "jalons", type: "liste", mots: ["jalons", "echeances", "dates cles", "etapes cles", "calendrier"] },
  { cle: "risques", type: "liste", mots: ["risques", "points de vigilance", "aleas", "menaces", "points durs"] },
  { cle: "kpis", type: "liste", mots: ["indicateurs", "kpi", "kpis", "criteres de succes", "mesure du succes", "cibles"] },
  { cle: "instances", type: "liste", mots: ["gouvernance", "instances", "comites", "comite de pilotage", "pilotage"] },
  { cle: "fournisseurs", type: "liste", mots: ["prestataires", "fournisseurs", "partenaires", "sous-traitants"] },
];

// Les rubriques que le pack documentaire marque « — à renseigner — » quand elles
// manquent. C'est exactement cette liste que l'on renvoie comme « absent ».
export const ATTENDUES = ["objectif", "contexte", "perimetre", "horsPerimetre", "commanditaire", "sponsor", "pilote", "budget", "risques", "kpis", "instances", "chantiers"];

const EST_TITRE = [
  /^#{1,6}\s+(.+?)\s*$/,                       // markdown
  /^\s*\d+(?:\.\d+)*[.)]\s+(.{3,80})\s*$/,     // « 3. Périmètre », « 2.1 Gouvernance »
  /^\s*([A-ZÉÈÀÂÎÔÛÇ][A-ZÉÈÀÂÎÔÛÇ\s'’\-]{3,60})\s*$/, // TITRE EN CAPITALES
];
const EST_PUCE = /^\s*(?:[-–—*•·]|\d+[.)])\s+(.+?)\s*$/;

function titreDe(ligne) {
  for (const re of EST_TITRE) {
    const m = ligne.match(re);
    if (m) return propre(m[1]);
  }
  // « Périmètre : ... » en tête de ligne vaut titre si la valeur est courte.
  const m = ligne.match(/^\s*([A-Za-zÀ-ÿ'’ -]{3,40})\s*:\s*(.*)$/);
  if (m) return propre(m[1]);
  return null;
}

function rubriqueDe(titre) {
  const t = sansAccent(titre).replace(/[:•.\-–—]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Les plus spécifiques d'abord : « hors périmètre » avant « périmètre ».
  for (const r of RUBRIQUES) {
    for (const mot of r.mots) {
      if (t === mot || t.startsWith(mot + " ") || t.endsWith(" " + mot) || t.includes(" " + mot + " ")) return r;
    }
  }
  return null;
}

// --- Valeurs typées -------------------------------------------------------

// Une date n'est retenue QUE si elle est écrite. Le reste reste du texte.
export function dateDe(s) {
  const t = String(s || "");
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = sansAccent(t).match(/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})\b/);
  if (m) return `${m[3]}-${String(MOIS.indexOf(m[2]) + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

// Durées : la semaine vaut 5 jours ouvrés, le mois 20. Ce sont des conversions,
// pas des estimations — et elles sont dites à l'écran avant validation.
export function dureeDe(s) {
  const t = sansAccent(s);
  const m = t.match(/\b(\d{1,3})\s*(jours?|j\b|semaines?|sem\b|mois)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (/^mois/.test(m[2])) return { jours: n * 20, source: `${n} mois` };
  if (/^sem/.test(m[2])) return { jours: n * 5, source: `${n} semaine${n > 1 ? "s" : ""}` };
  return { jours: n, source: `${n} j` };
}

export function montantDe(s) {
  const t = String(s || "").replace(/ | /g, " ");
  const m = t.match(/([\d][\d  .,]*)\s*(k€|K€|m€|M€|€|euros?)/i);
  if (!m) return null;
  const brut = Number(m[1].replace(/[  .]/g, "").replace(",", "."));
  if (!Number.isFinite(brut)) return null;
  const u = m[2].toLowerCase();
  return Math.round(u.startsWith("k") ? brut * 1000 : u.startsWith("m") ? brut * 1000000 : brut);
}

const IMPACTS_MOTS = { eleve: ["eleve", "fort", "critique", "majeur", "haut"], moyen: ["moyen", "modere"], faible: ["faible", "bas", "mineur"] };
export function impactDe(s) {
  const t = sansAccent(s);
  for (const [cle, mots] of Object.entries(IMPACTS_MOTS)) if (mots.some((m) => new RegExp(`\\b${m}\\b`).test(t))) return cle;
  return null;
}

// Une puce peut porter des précisions : « Migrer les données — resp. Marc —
// 15 j — échéance 2026-06-30 ». On découpe sur les séparateurs francs, et on
// ne retient que ce qui est étiqueté ou sans ambiguïté.
export function detailsDePuce(texte) {
  const segments = String(texte).split(/\s+[—–]\s+|\s+\|\s+|\s*;\s*/).map(propre).filter(Boolean);
  const titre = segments.shift() || propre(texte);
  const out = { titre, responsable: "", duree: null, echeance: null, impact: null, reste: [] };
  for (const seg of segments) {
    // « resp. : Marc » comme « resp. Marc » : l'étiquette s'écrit avec ou sans
    // deux-points, et exiger le signe faisait perdre le porteur une fois sur deux.
    const m = seg.match(/^([A-Za-zÀ-ÿ'’ .]{2,22})\s*:\s*(.+)$/)
      || seg.match(/^(resp\.?|responsable|porteur|pilote|owner|echeance|échéance|duree|durée|impact)\s+(.+)$/i);
    const cle = m ? sansAccent(m[1]) : "";
    const val = m ? propre(m[2]) : seg;
    if (/^(resp|responsable|porteur|pilote|owner)/.test(cle)) { out.responsable = val; continue; }
    if (/^(echeance|date|pour le|deadline|livraison)/.test(cle)) { out.echeance = dateDe(val) || null; if (!out.echeance) out.reste.push(seg); continue; }
    if (/^(duree|charge|effort)/.test(cle)) { out.duree = dureeDe(val); continue; }
    if (/^impact/.test(cle)) { out.impact = impactDe(val); continue; }
    const d = dateDe(seg), du = dureeDe(seg), im = /impact/.test(sansAccent(seg)) ? impactDe(seg) : null;
    if (d) { out.echeance = d; continue; }
    if (du) { out.duree = du; continue; }
    if (im) { out.impact = im; continue; }
    out.reste.push(seg);
  }
  // Une date écrite dans le titre même compte aussi.
  if (!out.echeance) out.echeance = dateDe(titre);
  if (!out.duree) out.duree = dureeDe(titre);
  return out;
}

// --- Analyse --------------------------------------------------------------

export function analyser(texte = "") {
  const lignes = String(texte).replace(/\r/g, "").split("\n");
  const blocs = new Map();       // cle de rubrique -> { lignes:[], puces:[] }
  const inline = new Map();      // « Sponsor : Mme X » rencontré en ligne
  let courant = null;
  let nom = "";
  let niveauChantier = null;

  for (const brute of lignes) {
    const ligne = brute.replace(/\t/g, " ");
    if (!propre(ligne)) { continue; }

    const titre = titreDe(ligne);
    const rub = titre ? rubriqueDe(titre) : null;

    // Titre de document : le premier H1, ou « Note de cadrage — X ».
    if (!nom) {
      const h1 = ligne.match(/^#\s+(.+)$/);
      if (h1) nom = propre(h1[1].replace(/^note de cadrage\s*[—–-]\s*/i, ""));
    }

    if (rub) {
      // « Sponsor : Mme Dupont » — la valeur est sur la ligne du titre.
      const apres = ligne.match(/:\s*(.+)$/);
      if (apres && (rub.type === "ligne" || rub.type === "montant")) {
        inline.set(rub.cle, propre(apres[1]));
        courant = null;
        continue;
      }
      courant = rub.cle;
      niveauChantier = null;
      if (!blocs.has(courant)) blocs.set(courant, { lignes: [], puces: [] });
      if (apres && propre(apres[1])) blocs.get(courant).lignes.push(propre(apres[1]));
      continue;
    }

    // Un titre non reconnu ferme la rubrique en cours : sans cela, tout le
    // reste du document se déverserait dans la dernière rubrique vue.
    if (titre && !rub && /^#{1,6}\s/.test(ligne)) {
      // Sauf s'il s'agit d'un sous-titre dans « chantiers » : c'est un chantier.
      if (courant === "chantiers" && /^#{3,6}\s/.test(ligne)) { niveauChantier = titre; blocs.get("chantiers").puces.push({ texte: titre, chantier: null, titreDeChantier: true }); continue; }
      courant = null;
      continue;
    }
    if (!courant) {
      // Hors rubrique : on récolte quand même les « Label : valeur » utiles.
      const m = ligne.match(/^\s*([A-Za-zÀ-ÿ'’ -]{3,40})\s*:\s*(.+)$/);
      const r2 = m ? rubriqueDe(m[1]) : null;
      if (r2 && (r2.type === "ligne" || r2.type === "montant")) inline.set(r2.cle, propre(m[2]));
      continue;
    }

    const puce = ligne.match(EST_PUCE);
    if (puce) blocs.get(courant).puces.push({ texte: propre(puce[1]), chantier: niveauChantier });
    else blocs.get(courant).lignes.push(propre(ligne));
  }

  const texteDe = (cle) => {
    const b = blocs.get(cle);
    const v = inline.get(cle);
    if (v) return v;
    if (!b) return "";
    const tout = [...b.lignes, ...b.puces.map((p) => `- ${p.texte}`)].join("\n");
    return propre(tout).length ? tout.trim() : "";
  };
  const pucesDe = (cle) => (blocs.get(cle)?.puces || []).filter((p) => !p.titreDeChantier);

  const champs = {
    nom,
    objectif: texteDe("objectif"),
    contexte: texteDe("contexte"),
    perimetre: texteDe("perimetre"),
    horsPerimetre: texteDe("horsPerimetre"),
    commanditaire: propre(inline.get("commanditaire") || texteDe("commanditaire")).slice(0, 160),
    sponsor: propre(inline.get("sponsor") || texteDe("sponsor")).slice(0, 160),
    coSponsor: propre(inline.get("coSponsor") || texteDe("coSponsor")).slice(0, 160),
    relaisDG: propre(inline.get("relaisDG") || texteDe("relaisDG")).slice(0, 160),
    pilote: propre(inline.get("pilote") || texteDe("pilote")).slice(0, 160),
    budget: montantDe(inline.get("budget") || texteDe("budget")) || 0,
  };

  const risques = pucesDe("risques").map((p) => {
    const d = detailsDePuce(p.texte);
    return {
      titre: d.titre, impact: d.impact || "moyen", statut: "ouvert",
      proprietaire: d.responsable, echeance: d.echeance || "",
      // Le plan B ne s'invente pas : s'il n'est pas dans la note, il reste vide
      // et le document le montrera comme manquant.
      planB: d.reste.join(" — "), seuil: "", decideur: "",
    };
  });
  const kpis = pucesDe("kpis").map((p) => {
    const d = detailsDePuce(p.texte);
    const chiffre = p.texte.match(/([<>≥≤]?\s*[\d][\d  .,]*\s*(?:%|€|k€|M€|j|jours?|points?)?)\s*$/i);
    return { indicateur: d.titre, cible: chiffre ? propre(chiffre[1]) : d.reste.join(" — "), echeance: d.echeance || "", type: "officiel", valeur: "" };
  });
  const instances = pucesDe("instances").map((p) => {
    const d = detailsDePuce(p.texte);
    return { nom: d.titre, frequence: d.reste.find((x) => /hebdo|mensuel|quinzaine|trimestr|semaine|mois/i.test(x)) || "", composition: d.reste.filter((x) => !/hebdo|mensuel|quinzaine|trimestr|semaine|mois/i.test(x)).join(" — "), role: "" };
  });
  const fournisseurs = pucesDe("fournisseurs").map((p) => {
    const d = detailsDePuce(p.texte);
    return { nom: d.titre, prestation: d.reste.join(" — "), budget: montantDe(p.texte) || 0, contact: d.responsable };
  });
  const jalons = pucesDe("jalons").map((p) => {
    const d = detailsDePuce(p.texte);
    return { titre: d.titre, date: d.echeance || null, texteDate: d.echeance ? "" : d.reste.join(" — ") || propre(p.texte) };
  });

  // Chantiers et actions : une puce sous un sous-titre appartient à ce chantier.
  const actions = pucesDe("chantiers").map((p) => {
    const d = detailsDePuce(p.texte);
    return {
      titre: d.titre, chantier: p.chantier || "",
      dureeJours: d.duree?.jours || null, dureeSource: d.duree?.source || "",
      echeance: d.echeance || null, responsable: d.responsable,
    };
  });
  const chantiers = [...new Set(actions.map((a) => a.chantier).filter(Boolean))];

  const registres = { risques, kpis, instances, fournisseurs, changements: [] };
  const present = (cle) => {
    if (cle === "chantiers") return actions.length > 0;
    if (["risques", "kpis", "instances"].includes(cle)) return registres[cle].length > 0;
    if (cle === "budget") return champs.budget > 0;
    return !!propre(champs[cle]);
  };

  return {
    champs, registres, actions, chantiers, jalons,
    trouve: ATTENDUES.filter(present),
    absent: ATTENDUES.filter((c) => !present(c)),
    // Ce que la note dit sans qu'on sache le ranger : on le montre au lieu de
    // le jeter, c'est souvent là que se cache l'information qui manque.
    datesNonLues: jalons.filter((j) => !j.date).map((j) => j.titre),
    vide: !ATTENDUES.some(present),
  };
}

// --- Rapprochement avec le projet ----------------------------------------

// `choix` liste les rubriques retenues par l'humain. Rien d'autre n'est repris.
// `ecraser` reste faux par défaut : une note de cadrage relue six mois plus
// tard ne doit pas effacer ce que le projet a appris entre-temps.
export function fusionner(projet = {}, proposition = {}, { choix = null, ecraser = false } = {}) {
  const retenu = (cle) => !choix || choix.includes(cle);
  const patch = {};
  const conflits = [];

  for (const [cle, val] of Object.entries(proposition.champs || {})) {
    if (cle === "nom" || !retenu(cle)) continue;
    const vide = val === "" || val == null || val === 0;
    if (vide) continue;
    const actuel = projet[cle];
    const dejaRempli = actuel !== "" && actuel != null && actuel !== 0;
    if (dejaRempli && String(actuel) !== String(val)) {
      conflits.push({ cle, actuel: String(actuel).slice(0, 120), propose: String(val).slice(0, 120) });
      if (!ecraser) continue;
    }
    patch[cle] = val;
  }

  for (const cle of ["risques", "kpis", "instances", "fournisseurs"]) {
    if (!retenu(cle)) continue;
    const neufs = proposition.registres?.[cle] || [];
    if (!neufs.length) continue;
    const existants = Array.isArray(projet[cle]) ? projet[cle] : [];
    const clefDe = (x) => sansAccent(x.titre || x.indicateur || x.nom || "");
    const vus = new Set(existants.map(clefDe));
    // On AJOUTE ce qui manque, on ne remplace jamais le registre : les entrées
    // déjà travaillées (plan B, seuil, décideur) ne sont pas dans la note.
    const ajouts = neufs.filter((x) => !vus.has(clefDe(x)));
    if (ajouts.length) patch[cle] = [...existants, ...ajouts];
  }

  return { patch, conflits, ajoutees: Object.keys(patch) };
}

// Les tâches à créer, à partir des chantiers/actions et des jalons datés.
// Les actions sans durée écrite sortent à 1 jour ET marquées : c'est à
// l'écran de validation de trancher, pas au parseur.
export function tachesDepuisProposition(proposition = {}, { dureeDefaut = 1 } = {}) {
  const out = [];
  const parChantier = new Map();
  for (const a of proposition.actions || []) {
    const c = a.chantier || "";
    if (!parChantier.has(c)) parChantier.set(c, []);
    parChantier.get(c).push(a);
  }
  for (const [chantier, actions] of parChantier) {
    const ref = chantier ? `C${out.length}` : null;
    if (chantier) out.push({ ref, titre: chantier, synthese: true, dureeJours: 0 });
    for (const a of actions) {
      out.push({
        ref: `T${out.length}`, parentRef: ref, titre: a.titre,
        dureeJours: a.dureeJours || dureeDefaut,
        dureeDeduite: !a.dureeJours,
        dureeSource: a.dureeSource || "",
        responsable: a.responsable || "",
        contrainte: a.echeance ? { type: "echeance", date: a.echeance } : { type: "auplustot", date: null },
      });
    }
  }
  for (const j of proposition.jalons || []) {
    if (!j.date) continue;   // un jalon sans date écrite n'entre pas dans le plan
    out.push({ ref: `J${out.length}`, titre: j.titre, jalon: true, dureeJours: 0, contrainte: { type: "echeance", date: j.date } });
  }
  return out;
}

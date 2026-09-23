// Le pack documentaire complet, produit par l'application.
//
// Un projet cadré dans l'outil doit pouvoir sortir sous la forme que réclame
// une direction générale : des Word à relire, des PowerPoint à projeter, un
// classeur pour travailler hors application. Rien ici n'est saisi deux fois —
// tout descend du plan et des registres.
import { ZipArchive } from "archiver";
import { charte, nomFichier, jourFR } from "./charte.js";
import * as doc from "./documents.js";
import * as ppt from "./presentations.js";
import { classeurPilotage } from "./classeur.js";

// Les générateurs lisent `plan.debut` et `plan.fin` ; `ordonnancer` les range
// dans `plan.resume`. On aplatit ici, une fois, plutôt que dans dix endroits.
export function vue(plan) {
  return { ...plan, debut: plan.resume?.debut || plan.projet?.debut || "", fin: plan.resume?.fin || "" };
}

// Un ordre du jour utile parle de la période À VENIR, pas de celle qui vient de
// s'écouler : on rattache à chaque séance les jalons qui tombent d'ici la
// suivante, et les arbitrages dont l'échéance arrive dans le même intervalle.
// Une séance qui n'annonce que du passé ne sert qu'à constater.
export function enrichirSeances(projet, plan, seances = []) {
  const jalons = plan.taches.filter((t) => t.jalon).map((t) => ({ titre: t.titre, fin: t.fin || t.debut, lot: t.lot }));
  const ouverts = projet.risques.filter((r) => r.statut === "ouvert" || r.statut === "encours");
  const liste = seances.filter((s) => s?.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return liste.map((s, i) => {
    const suivante = liste[i + 1]?.date || null;
    const dans = (d) => !!d && d >= s.date && (!suivante || d < suivante);
    return {
      ...s,
      libelle: s.libelle || s.instance || projet.instances[0]?.nom || "Séance",
      jalons: jalons.filter((j) => dans(j.fin)),
      // Sans échéance datée, un risque élevé reste à l'ordre du jour de chaque
      // séance : c'est le seul traitement honnête d'un risque non calendé.
      risques: ouverts.filter((r) => dans(r.echeance) || (!r.echeance && r.impact === "eleve")),
    };
  });
}

export const PIECES = [
  { cle: "note-cadrage", nom: "Note de cadrage", dossier: "1 - Cadrage", ext: "docx",
    quoi: "Contexte, périmètre, hors périmètre, gouvernance, budget, risques.", faire: (p, l, c) => doc.noteCadrage(p, l, c) },
  { cle: "one-pager", nom: "Une page de synthèse", dossier: "1 - Cadrage", ext: "docx",
    quoi: "Le projet sur une seule page, pour un comité qui n'aura pas lu le reste.", faire: (p, l, c) => doc.onePager(p, l, c) },
  { cle: "plan-synthese", nom: "Plan de projet — synthèse", dossier: "2 - Plan", ext: "docx",
    quoi: "Les chantiers, les jalons, le chemin critique.", faire: (p, l, c) => doc.planSynthese(p, l, c) },
  { cle: "plan-detaille", nom: "Plan de projet — détaillé", dossier: "2 - Plan", ext: "docx",
    quoi: "Toutes les actions, dates, porteurs et dépendances.", faire: (p, l, c) => doc.planDetaille(p, l, c) },
  { cle: "fiches-action", nom: "Fiches action", dossier: "2 - Plan", ext: "docx",
    quoi: "Une fiche par action : ce qui doit exister à la fin, et à quelle condition elle est terminée.",
    faire: (p, l, c) => doc.fichesAction(p, l, c) },
  { cle: "frise", nom: "Frise", dossier: "2 - Plan", ext: "docx",
    quoi: "Ce qui se passe en meme temps : la charge par chantier mois par mois, et les jalons sur l'axe du temps.",
    faire: (p, l, c) => doc.frisePlan(p, l, c) },
  { cle: "deck-comex", nom: "Présentation COMEX", dossier: "3 - Présentations", ext: "pptx",
    quoi: "La demande de décision : chiffres, budget, arbitrages, engagements.", faire: (p, l, c) => ppt.deckComex(p, l, c) },
  { cle: "deck-lancement", nom: "Comité de lancement", dossier: "3 - Présentations", ext: "pptx",
    quoi: "La séance de lancement, ordre du jour compris.",
    faire: (p, l, c) => ppt.deckLancement(p, l, c, p.trames.find((t) => /lancement|copil|pilotage/i.test(t.instance)) || p.trames[0]) },
  { cle: "deck-ensemble", nom: "Vue d'ensemble du projet", dossier: "3 - Présentations", ext: "pptx",
    quoi: "Le dossier complet en diapositives, chantier par chantier.", faire: (p, l, c) => ppt.deckVueEnsemble(p, l, c) },
  { cle: "pilotage", nom: "Classeur de pilotage", dossier: "4 - Travailler hors application", ext: "xlsx",
    quoi: "La chaîne rejouée en formules : on saisit un retard, tout se recalcule.", faire: (p, l, c) => classeurPilotage(p, l, c) },
  { cle: "trames", nom: "Trames de réunion", dossier: "5 - Gouvernance", ext: "docx",
    quoi: "Ordre du jour type et compte rendu type de chaque instance.", faire: (p, l, c) => doc.trames(p, l, c) },
  { cle: "ordres-du-jour", nom: "Ordres du jour des séances", dossier: "5 - Gouvernance", ext: "docx",
    quoi: "Un ordre du jour prérempli par séance programmée.", faire: (p, l, c, o) => doc.ordresDuJour(p, l, c, enrichirSeances(p, l, o.seances)),
    sauter: (p, l, o) => !(o.seances || []).length },
  { cle: "flash-info", nom: "Flash INFO", dossier: "5 - Gouvernance", ext: "docx",
    quoi: "Ce que le comité diffuse aux équipes après la séance, un bloc par direction.",
    faire: (p, l, c) => doc.flashInfo(p, l, c) },
  { cle: "onboarding", nom: "Kit d'intégration", dossier: "6 - Intégration", ext: "docx",
    quoi: "Ce qu'un nouvel arrivant doit savoir : rôles, chantiers, ses actions, qui lui donne quoi.", faire: (p, l, c) => doc.kitOnboarding(p, l, c) },
];

// Les ordres du jour, un fichier par séance. Le recueil groupé reste utile pour
// poser le calendrier ; le jour de la séance, on ouvre le sien.
export async function ordresSepares(projet, plan, ch, options = {}) {
  const seances = enrichirSeances(projet, plan, options.seances);
  const out = [];
  for (const [i, s] of seances.entries()) {
    const octets = await doc.ordresDuJour(projet, plan, ch, [s]);
    const num = String(i + 1).padStart(2, "0");
    out.push({
      nom: `${nomFichier(projet.nom)}-ODJ-${num}-${s.date}.docx`,
      chemin: `5 - Gouvernance/Ordres du jour/${nomFichier(projet.nom)}-ODJ-${num}-${s.date}.docx`,
      octets, type: "docx", libelle: `Ordre du jour — ${s.libelle} du ${s.date}`,
      quoi: "Une séance, un fichier.",
    });
  }
  return out;
}

const SOMMAIRE = {
  cle: "sommaire", nom: "Sommaire du pack", dossier: "0 - Sommaire", ext: "docx",
  quoi: "Ce que contient le pack, et pour qui chaque document est fait.",
};

export function inventaire(projet, plan, options = {}) {
  const l = vue(plan);
  return [SOMMAIRE, ...PIECES.filter((p) => !(p.sauter && p.sauter(projet, l, options)))
    .map(({ cle, nom, dossier, ext, quoi }) => ({ cle, nom, dossier, ext, quoi }))];
}

// Descripteurs des pièces telles qu'elles seront nommées dans le pack : c'est
// ce que le sommaire liste.
const descripteurs = (projet, l, options) =>
  PIECES.filter((p) => !(p.sauter && p.sauter(projet, l, options)))
    .map((p) => ({ cle: p.cle, nom: `${nomFichier(projet.nom)}-${nomFichier(p.nom)}.${p.ext}`,
                   dossier: p.dossier, ext: p.ext, quoi: p.quoi }));

// Produit une pièce. Renvoie { nom, chemin, octets, type }.
export async function piece(cle, projet, plan, settings = {}, options = {}) {
  const ch = charte(settings), l = vue(plan);
  if (cle === SOMMAIRE.cle) {
    const octets = await doc.sommairePack(projet, l, ch, descripteurs(projet, l, options));
    const base = `00-${nomFichier(projet.nom)}-Sommaire-du-pack.docx`;
    return { nom: base, chemin: base, octets, type: "docx", libelle: SOMMAIRE.nom };
  }
  const p = PIECES.find((x) => x.cle === cle);
  if (!p) return { error: "document inconnu" };
  const octets = await p.faire(projet, l, ch, options);
  const base = `${nomFichier(projet.nom)}-${nomFichier(p.nom)}.${p.ext}`;
  return { nom: base, chemin: `${p.dossier}/${base}`, octets, type: p.ext, libelle: p.nom };
}

export async function pack(projet, plan, settings = {}, options = {}) {
  const ch = charte(settings), l = vue(plan);
  const pieces = [];
  const echecs = [];
  for (const p of PIECES) {
    if (p.sauter && p.sauter(projet, l, options)) continue;
    try {
      const octets = await p.faire(projet, l, ch, options);
      if (!octets?.length) throw new Error("fichier vide");
      const base = `${nomFichier(projet.nom)}-${nomFichier(p.nom)}.${p.ext}`;
      pieces.push({ cle: p.cle, nom: base, chemin: `${p.dossier}/${base}`, octets, type: p.ext, libelle: p.nom, quoi: p.quoi });
    } catch (e) {
      // Une pièce qui casse ne doit pas emporter le pack — mais elle doit être
      // DITE. Un zip silencieusement incomplet est le pire des deux mondes.
      echecs.push({ cle: p.cle, nom: p.nom, error: String(e?.message || e) });
    }
  }
  // Le sommaire liste les autres pièces. Il se produit depuis leurs
  // DESCRIPTEURS, pas depuis leurs octets : c'est ce qui permet de le produire
  // seul, et d'annoncer exactement ce que le zip contiendra.
  try {
    const octets = await doc.sommairePack(projet, l, ch, descripteurs(projet, l, options));
    pieces.unshift({ cle: "sommaire", nom: `00-${nomFichier(projet.nom)}-Sommaire-du-pack.docx`,
      chemin: `00-${nomFichier(projet.nom)}-Sommaire-du-pack.docx`, octets, type: "docx",
      libelle: "Sommaire du pack", quoi: "Ce que contient le pack, et pour qui chaque document est fait." });
  } catch (e) {
    echecs.push({ cle: "sommaire", nom: "Sommaire du pack", error: String(e?.message || e) });
  }
  return { pieces, echecs, ch };
}

function sommaire(projet, pieces, echecs, ch, separes = 0) {
  const lignes = [
    `${projet.nom} — pack documentaire`,
    `${ch.emetteur} · ${ch.mention}`,
    `Édité le ${jourFR(new Date().toISOString().slice(0, 10))}`,
    "",
    `${pieces.length} document${pieces.length > 1 ? "s" : ""} :`,
    "",
  ];
  let dossier = "";
  for (const p of pieces) {
    if (p.chemin.split("/")[0] !== dossier) {
      dossier = p.chemin.split("/")[0];
      lignes.push(`${dossier}`);
    }
    lignes.push(`   · ${p.nom}  (${Math.round(p.octets.length / 1024)} Ko)`);
    lignes.push(`     ${p.quoi}`);
  }
  if (echecs.length) {
    lignes.push("", "Documents NON produits — à signaler :", "");
    for (const e of echecs) lignes.push(`   · ${e.nom} : ${e.error}`);
  }
  if (separes) lignes.push("", `   · 5 - Gouvernance/Ordres du jour/ : ${separes} fichiers, un par séance`);
  lignes.push("", "Le classeur de pilotage est le seul fichier destiné à être modifié :",
    "les autres se régénèrent depuis l'application dès que le plan bouge.");
  return Buffer.from(lignes.join("\r\n"), "utf8");
}

// Écrit le zip dans un flux (la réponse HTTP, ou un fichier).
export async function zipper(projet, plan, settings, options, flux) {
  const { pieces, echecs, ch } = await pack(projet, plan, settings, options);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const fini = new Promise((ok, ko) => { zip.on("end", ok); zip.on("close", ok); zip.on("error", ko); });
  zip.pipe(flux);
  for (const p of pieces) zip.append(p.octets, { name: p.chemin });
  let separes = [];
  try {
    separes = await ordresSepares(projet, vue(plan), ch, options);
    for (const s of separes) zip.append(s.octets, { name: s.chemin });
  } catch (e) {
    echecs.push({ cle: "ordres-separes", nom: "Ordres du jour séparés", error: String(e?.message || e) });
  }
  zip.append(sommaire(projet, pieces, echecs, ch, separes.length), { name: "SOMMAIRE.txt" });
  await zip.finalize();
  await fini;
  return { pieces: pieces.map(({ octets, ...r }) => r), separes: separes.length, echecs };
}

export const nomZip = (projet) => `${nomFichier(projet.nom)}-pack.zip`;

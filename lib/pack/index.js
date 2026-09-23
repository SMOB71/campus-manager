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
  const actions = plan.taches.filter((t) => !t.synthese);
  const aujourdhui = plan.resume?.aujourdhui || plan.aujourdhui || new Date().toISOString().slice(0, 10);
  const ouverts = projet.risques.filter((r) => r.statut === "ouvert" || r.statut === "encours");
  const liste = seances.filter((s) => s?.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const trameDe = (nom) => projet.trames.find((t) => t.instance === nom)
    || projet.trames.find((t) => /copil|pilotage/i.test(t.instance)) || projet.trames[0] || null;

  // Le report ne vaut que jusqu'à la PROCHAINE séance : au-delà, on ne sait
  // pas ce qui aura été soldé. Répéter le retard du jour sur les trente ordres
  // du jour suivants n'informe personne et discrédite le document.
  const prochaine = liste.find((x) => x.date >= aujourdhui)?.date || null;

  return liste.map((s, i) => {
    const suivante = liste[i + 1]?.date || null;
    const precedente = liste[i - 1]?.date || null;
    // La période d'une séance va de CETTE séance à la suivante : c'est ce qui
    // doit être soldé d'ici le prochain comité. Une séance qui ne parle que du
    // passé ne sert qu'à constater.
    const dans = (d) => !!d && d >= s.date && (!suivante || d < suivante);
    const periode = actions.filter((t) => dans(t.fin));
    return {
      ...s,
      libelle: s.libelle || s.instance || projet.instances[0]?.nom || "Séance",
      trame: trameDe(s.libelle || s.instance),
      jalons: periode.filter((t) => t.jalon),
      // Les actions à solder d'ici la séance suivante. Sans elles, l'ordre du
      // jour d'un COPIL hebdomadaire tenait en trois lignes génériques pour un
      // plan de deux cents actions.
      actions: periode.filter((t) => !t.jalon),
      // Ce qui était dû depuis la séance précédente : c'est ce que le comité
      // passe en revue, « soldé ou non ». On ne parle pas de RETARD dans un
      // ordre du jour pré-rempli — un plan qui n'a pas commencé n'a rien en
      // retard, et annoncer soixante retards en décembre serait faux.
      echues: actions.filter((t) => t.fin && t.fin < s.date && (!precedente || t.fin >= precedente)),
      // REPORTÉES : déjà passées en revue à une séance précédente et toujours
      // pas soldées. Elles reviennent à chaque ordre du jour tant qu'elles ne
      // sont pas closes — c'est la règle d'un comité, un point non tranché ne
      // disparaît pas parce que la semaine est finie.
      //
      // Bornées à AUJOURD'HUI : pour une séance à venir, on ne peut pas savoir
      // ce qui sera en retard. Sans cette borne, un ordre du jour de juin
      // listait cent cinquante actions « reportées » sur un plan qui n'avait
      // pas commencé.
      reportees: !precedente || (prochaine && s.date > prochaine) ? [] : actions.filter((t) =>
        t.fin && t.fin < precedente && t.fin < aujourdhui && t.statut !== "faite"),
      critiquesSansPorteur: periode.filter((t) => t.critique && !t.responsable),
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

// Une feuille par direction : c'est le document qu'on envoie à un directeur,
// et le seul qu'il lira en entier. Comme les ordres du jour, ce n'est pas UNE
// pièce mais N fichiers — autant que de directions portant des actions.
export async function feuillesDirection(projet, plan, ch) {
  const directions = [...new Set(plan.taches.filter((t) => !t.synthese).map((t) => t.dept).filter(Boolean))].sort();
  const out = [];
  for (const d of directions) {
    const octets = await doc.feuilleDirection(projet, plan, ch, d);
    const nom = `${nomFichier(projet.nom)}-Feuille-de-route-${nomFichier(d)}.${ch.format === "pdf" ? "pdf" : "docx"}`;
    out.push({ nom, chemin: `3 - Par direction/${nom}`, octets, type: ch.format === "pdf" ? "pdf" : "docx",
               libelle: `Feuille de route — ${d}`, quoi: "Les actions de cette direction et leurs échéances." });
  }
  return out;
}

export function inventaire(projet, plan, options = {}) {
  const l = vue(plan);
  return [
    { ...SOMMAIRE, fichier: `00-${nomFichier(projet.nom)}-Sommaire-du-pack.docx` },
    ...PIECES.filter((p) => !(p.sauter && p.sauter(projet, l, options)))
      .map(({ cle, nom, dossier, ext, quoi }) => ({
        cle, nom, dossier, ext, quoi,
        // Le nom du fichier tel qu'il sera dans le pack : c'est lui qui permet
        // de vérifier qu'on a livré ce qu'on avait annoncé.
        fichier: `${nomFichier(projet.nom)}-${nomFichier(nom)}.${ext}`,
      })),
  ];
}

// Descripteurs des pièces telles qu'elles seront nommées dans le pack : c'est
// ce que le sommaire liste.
const descripteurs = (projet, l, options) =>
  PIECES.filter((p) => !(p.sauter && p.sauter(projet, l, options)))
    .map((p) => ({ cle: p.cle, nom: `${nomFichier(projet.nom)}-${nomFichier(p.nom)}.${p.ext}`,
                   dossier: p.dossier, ext: p.ext, quoi: p.quoi }));

// Produit une pièce. Renvoie { nom, chemin, octets, type }.
export async function piece(cle, projet, plan, settings = {}, options = {}) {
  // `format: "pdf"` ne convertit rien : il rend le MÊME document avec l'autre
  // moteur. Les PowerPoint et le classeur restent dans leur format natif — un
  // deck aplati en PDF n'est plus un deck.
  const pdf = options.format === "pdf";
  const ch = charte(settings, { format: pdf ? "pdf" : "docx" }), l = vue(plan);
  if (cle === SOMMAIRE.cle) {
    const octets = await doc.sommairePack(projet, l, ch, descripteurs(projet, l, options));
    const base = `00-${nomFichier(projet.nom)}-Sommaire-du-pack.${pdf ? "pdf" : "docx"}`;
    return { nom: base, chemin: base, octets, type: pdf ? "pdf" : "docx", libelle: SOMMAIRE.nom };
  }
  const p = PIECES.find((x) => x.cle === cle);
  if (!p) return { error: "document inconnu" };
  if (pdf && p.ext !== "docx") return { error: "ce document n'existe qu'en format natif" };
  const octets = await p.faire(projet, l, ch, options);
  const ext = pdf ? "pdf" : p.ext;
  const base = `${nomFichier(projet.nom)}-${nomFichier(p.nom)}.${ext}`;
  return { nom: base, chemin: `${p.dossier}/${base}`, octets, type: ext, libelle: p.nom };
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

function sommaire(projet, pieces, echecs, ch, separes = 0, pdfs = 0, feuilles = 0) {
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
  if (pdfs) lignes.push("", `   · 6 - PDF/ : ${pdfs} documents, pour qui n'a pas Office`);
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
  // Dossier PDF : chaque document Word rendu une seconde fois, pour qui n'a pas
  // Office. Un échec ici ne prive pas du pack — il est signalé, pas caché.
  let pdfs = 0;
  try {
    const chPdf = charte(settings, { format: "pdf" });
    const l2 = vue(plan);
    const sPdf = await doc.sommairePack(projet, l2, chPdf, descripteurs(projet, l2, options));
    zip.append(sPdf, { name: `6 - PDF/00-${nomFichier(projet.nom)}-Sommaire-du-pack.pdf` });
    pdfs += 1;
    for (const p of PIECES) {
      if (p.ext !== "docx" || (p.sauter && p.sauter(projet, l2, options))) continue;
      const octets = await p.faire(projet, l2, chPdf, options);
      zip.append(octets, { name: `6 - PDF/${p.dossier}/${nomFichier(projet.nom)}-${nomFichier(p.nom)}.pdf` });
      pdfs += 1;
    }
  } catch (e) {
    echecs.push({ cle: "pdf", nom: "Dossier PDF", error: String(e?.message || e) });
  }

  // Une feuille par direction, dans le zip et en PDF.
  let feuilles = 0;
  try {
    const l3 = vue(plan);
    for (const f of await feuillesDirection(projet, l3, ch)) {
      zip.append(f.octets, { name: f.chemin }); feuilles += 1;
    }
    for (const f of await feuillesDirection(projet, l3, charte(settings, { format: "pdf" }))) {
      zip.append(f.octets, { name: `6 - PDF/${f.chemin}` });
    }
  } catch (e) {
    echecs.push({ cle: "directions", nom: "Feuilles de route par direction", error: String(e?.message || e) });
  }

  let separes = [];
  try {
    separes = await ordresSepares(projet, vue(plan), ch, options);
    for (const s of separes) zip.append(s.octets, { name: s.chemin });
  } catch (e) {
    echecs.push({ cle: "ordres-separes", nom: "Ordres du jour séparés", error: String(e?.message || e) });
  }
  zip.append(sommaire(projet, pieces, echecs, ch, separes.length, pdfs, feuilles), { name: "SOMMAIRE.txt" });
  await zip.finalize();
  await fini;
  return { pieces: pieces.map(({ octets, ...r }) => r), separes: separes.length, pdfs, feuilles, echecs };
}

export const nomZip = (projet) => `${nomFichier(projet.nom)}-pack.zip`;

// Les présentations du pack.
//
// Règle de fabrication héritée des decks précédents : une diapositive se pose
// par sa HAUTEUR disponible, jamais par un empilement d'éléments dont on espère
// qu'ils tiendront. Chaque bloc connaît sa hauteur, et rien n'est écrit sous le
// filet de pied de page — c'est là que débordent les textes longs.
import PptxGenJS from "pptxgenjs";
import { courtFR, jourFR, euros } from "./charte.js";
import { IMPACTS, STATUTS_RISQUE } from "../projets.js";

const W = 10, H = 5.625, PIED = H - 0.46;
const ou = (v, d = "—") => (String(v || "").trim() ? String(v).trim() : d);
const coupe = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));
// Les registres stockent les échéances en ISO. On ne les montre jamais telles
// quelles : « 2027-02-28 » dans une colonne Échéance est une fuite de format.
const quand = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? courtFR(v) : ou(v));

function atelier(ch) {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_16x9";
  p.author = ch.emetteur;
  const F = ch.police;

  const couverture = (titre, sous, note) => {
    const s = p.addSlide();
    s.background = { color: ch.fond };
    s.addText(ch.marque.toUpperCase(), { x: 0.62, y: 0.55, w: 8.8, h: 0.34, fontSize: 17, bold: true, color: "FFFFFF", charSpacing: 1.6, fontFace: F });
    s.addText(ch.baseline, { x: 0.62, y: 0.92, w: 8.8, h: 0.24, fontSize: 9, bold: true, color: ch.accent, charSpacing: 2.6, fontFace: F });
    s.addText(String(titre).toUpperCase(), { x: 0.62, y: 2.1, w: 8.8, h: 1.1, fontSize: 32, bold: true, color: "FFFFFF", valign: "top", fontFace: F });
    if (sous) s.addText(sous, { x: 0.62, y: 3.25, w: 8.8, h: 0.4, fontSize: 15, bold: true, color: ch.accent, fontFace: F });
    if (note) s.addText(note, { x: 0.62, y: 3.8, w: 8.8, h: 0.4, fontSize: 11, color: "D8DEEC", fontFace: F });
    s.addText(`${ch.emetteur} — ${ch.mention}`, { x: 0.62, y: H - 0.42, w: 6, h: 0.26, fontSize: 9, italic: true, color: "AEB8D0", fontFace: F });
    return s;
  };
  const slide = (eyebrow, titre, chapeau) => {
    const s = p.addSlide();
    s.background = { color: "FFFFFF" };
    if (eyebrow) s.addText(String(eyebrow).toUpperCase(), { x: 0.55, y: 0.3, w: W - 1.1, h: 0.24, fontSize: 9.5, bold: true, color: ch.accent, charSpacing: 1.6, fontFace: F });
    s.addText(titre, { x: 0.55, y: 0.56, w: W - 1.1, h: 0.5, fontSize: 24, bold: true, color: ch.encre, fontFace: F });
    if (chapeau) s.addText(chapeau, { x: 0.55, y: 1.08, w: W - 1.1, h: 0.36, fontSize: 11, italic: true, color: ch.gris, fontFace: F });
    s.addShape(p.ShapeType.rect, { x: 0.55, y: PIED, w: W - 1.1, h: 0.008, fill: { color: ch.bordure } });
    s.addText(`${ch.emetteur} — ${ch.mention}`, { x: 0.55, y: H - 0.4, w: 6, h: 0.26, fontSize: 9, italic: true, color: ch.gris, fontFace: F });
    s.addText(ch.marque, { x: W - 2.5, y: H - 0.4, w: 1.95, h: 0.26, fontSize: 9, bold: true, color: ch.encre, align: "right", fontFace: F });
    return s;
  };
  // Cartes : 1 à 4 par rangée, hauteur fixe, texte borné.
  const cartes = (s, y, items, { cols = 2, h = 1.3 } = {}) => {
    const w = (W - 1.1 - (cols - 1) * 0.25) / cols;
    items.forEach((it, i) => {
      const x = 0.55 + (i % cols) * (w + 0.25), yy = y + Math.floor(i / cols) * (h + 0.22);
      s.addShape(p.ShapeType.rect, { x, y: yy, w, h, fill: { color: i % 2 ? ch.clair : "F7F8FB" } });
      s.addShape(p.ShapeType.rect, { x, y: yy, w: 0.05, h, fill: { color: i % 2 ? ch.encre : ch.accent } });
      s.addText(it[0], { x: x + 0.22, y: yy + 0.14, w: w - 0.4, h: 0.32, fontSize: 13, bold: true, color: ch.encre, fontFace: F });
      s.addText(it[1], { x: x + 0.22, y: yy + 0.5, w: w - 0.4, h: h - 0.62, fontSize: 9.5, color: ch.gris, fontFace: F, lineSpacingMultiple: 1.06 });
    });
  };
  const chiffres = (s, y, items) => items.forEach((it, i) => {
    const w = (W - 1.1 - 3 * 0.2) / 4, x = 0.55 + i * (w + 0.2);
    s.addShape(p.ShapeType.rect, { x, y, w, h: 1.05, fill: { color: i % 2 ? ch.clair : "F7F8FB" } });
    s.addShape(p.ShapeType.rect, { x, y, w, h: 0.05, fill: { color: i % 2 ? ch.encre : ch.accent } });
    s.addText(String(it[0]), { x, y: y + 0.16, w, h: 0.48, fontSize: 26, bold: true, color: i % 2 ? ch.encre : ch.accent, align: "center", fontFace: F });
    s.addText(it[1], { x: x + 0.08, y: y + 0.64, w: w - 0.16, h: 0.34, fontSize: 8.5, color: ch.gris, align: "center", fontFace: F, lineSpacingMultiple: 1.02 });
  });
  // Combien de lignes tiennent réellement entre `y` et le filet de pied. C'est
  // une mesure, pas une constante : un `max` deviné à 8 débordait dès que la
  // hauteur de ligne changeait, et la note « … et N autres » finissait SOUS le
  // pied de page.
  const capacite = (y, hauteur) => Math.max(1, Math.floor((PIED - 0.12 - y) / hauteur) - 1);

  const poser = (s, y, entetes, larg, lignes, hauteur) => {
    const rows = [
      entetes.map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: ch.encre, fontSize: 10 } })),
      ...lignes.map((l, n) => l.map((v) => ({ text: String(v ?? ""), options: { fontSize: 9.5, color: ch.encre, fill: n % 2 ? ch.clair : "FFFFFF" } }))),
    ];
    s.addTable(rows, { x: 0.55, y, w: W - 1.1, colW: larg.map((c) => ((W - 1.1) * c) / 100),
      border: { pt: 0.5, color: ch.bordure }, fontFace: F, valign: "middle", rowH: hauteur, autoPage: false });
    return y + (lignes.length + 1) * hauteur;
  };

  // Tableau sur une diapositive : borné à ce qui tient, et le reste est ANNONCÉ.
  const tableau = (s, y, entetes, larg, lignes, { max = 99, hauteur = 0.34, renvoi = "voir le plan d'action détaillé" } = {}) => {
    const n = Math.min(max, capacite(y, hauteur), lignes.length);
    const bas = poser(s, y, entetes, larg, lignes.slice(0, n), hauteur);
    const reste = lignes.length - n;
    if (reste > 0) s.addText(`… et ${reste} autre${reste > 1 ? "s" : ""} — ${renvoi}.`,
      { x: 0.55, y: Math.min(bas + 0.06, PIED - 0.28), w: W - 1.1, h: 0.24, fontSize: 9, italic: true, color: ch.gris, fontFace: F });
    return bas;
  };

  // Tableau qui NE tronque pas : il continue sur autant de diapositives qu'il
  // faut. Un dossier de projet qui annonce 187 actions doit les porter ; la
  // troncature était une dérobade déguisée en mise en page.
  const tableaux = (entete, entetes, larg, lignes, { hauteur = 0.34, y = 1.6 } = {}) => {
    const capPremiere = capacite(y, hauteur), capSuite = capacite(1.15, hauteur);
    let pages = 1;
    if (lignes.length > capPremiere) pages = 1 + Math.ceil((lignes.length - capPremiere) / capSuite);
    // Répartition à peu près égale : sans cela, la dernière page n'emportait que
    // le reliquat — une diapositive « (suite) » pour une seule ligne.
    const parPage = Math.ceil(lignes.length / pages);
    const sorties = [];
    let reste = lignes.slice(), page = 0;
    do {
      const s = slide(entete.eyebrow, page ? `${entete.titre} (suite)` : entete.titre, page ? "" : entete.chapeau);
      const yy = page ? 1.15 : y;
      const n = Math.min(capacite(yy, hauteur), parPage, reste.length) || 1;
      poser(s, yy, entetes, larg, reste.slice(0, n), hauteur);
      reste = reste.slice(n);
      sorties.push(s); page += 1;
    } while (reste.length);
    return sorties;
  };
  // Frise : jalons répartis sur une ligne, libellés étagés pour ne pas se toucher.
  const frises = (eyebrow, titre, jalons, { parVue = 5 } = {}) => {
    const lots = [];
    for (let i = 0; i < jalons.length; i += parVue) lots.push(jalons.slice(i, i + parVue));
    return lots.map((groupe, i) => {
      const s = slide(eyebrow, lots.length > 1 ? `${titre} — ${courtFR(groupe[0].fin)} au ${courtFR(groupe[groupe.length - 1].fin)}` : titre,
        lots.length > 1 ? `Période ${i + 1} sur ${lots.length} · ${groupe.length} jalons` : `${jalons.length} jalons`);
      frise(s, 1.92, groupe);
      // Sous la frise, le détail lisible : la frise donne le rythme, le tableau
      // donne le texte entier. Un libellé tronqué sur la frise ne suffit pas à
      // un comité qui doit le valider. y et parVue sont accordés pour que le
      // tableau porte exactement le groupe, sans renvoi.
      tableau(s, 3.20, ["Jalon", "Échéance", "Chantier"], [58, 16, 26],
        groupe.map((j) => [coupe(j.titre, 100), courtFR(j.fin), coupe(ou(j.lot), 34)]), { hauteur: 0.30 });
      return s;
    });
  };

  const frise = (s, y, jalons, titre) => {
    const montre = jalons.slice(0, 6);
    if (!montre.length) return;
    if (titre) s.addText(titre, { x: 0.55, y: y - 0.3, w: W - 1.1, h: 0.26, fontSize: 10, bold: true, color: ch.accent, fontFace: F });
    const x0 = 0.9, x1 = W - 0.9, pas = montre.length > 1 ? (x1 - x0) / (montre.length - 1) : 0;
    s.addShape(p.ShapeType.rect, { x: x0, y: y + 0.3, w: x1 - x0, h: 0.03, fill: { color: ch.accent } });
    montre.forEach((j, i) => {
      const x = x0 + i * pas, dessous = i % 2 === 1;
      s.addShape(p.ShapeType.ellipse, { x: x - 0.07, y: y + 0.24, w: 0.15, h: 0.15, fill: { color: ch.accent } });
      s.addText(courtFR(j.fin), { x: x - 0.7, y: y + (dessous ? 0.46 : -0.04), w: 1.4, h: 0.22,
        fontSize: 9.5, bold: true, color: ch.encre, align: "center", fontFace: F });
      s.addText(coupe(j.titre, 46), { x: x - 0.88, y: y + (dessous ? 0.70 : -0.42), w: 1.76, h: 0.38,
        fontSize: 8, color: ch.gris, align: "center", valign: dessous ? "top" : "bottom",
        fontFace: F, lineSpacingMultiple: 1.02 });
    });
  };
  return { p, couverture, slide, cartes, chiffres, tableau, tableaux, frise, frises, F };
}

const stats = (projet, plan) => {
  const actions = plan.taches.filter((t) => !t.synthese);
  const jalons = plan.taches.filter((t) => t.jalon);
  const lots = [...new Set(plan.taches.map((t) => t.lot).filter(Boolean))];
  const faites = actions.filter((t) => t.statut === "faite").length;
  return { actions, jalons, lots, faites,
    critiques: actions.filter((t) => t.critique).length,
    budget: actions.reduce((s, t) => s + (t.budgetPrevu || 0), 0) || projet.budget };
};

// ── A. Présentation COMEX — la décision ─────────────────────────────────────
export async function deckComex(projet, plan, ch) {
  const a = atelier(ch), { p } = a, st = stats(projet, plan);
  a.couverture(projet.nom, "Présentation du projet — COMEX",
    `${ch.emetteur} · ${jourFR(plan.debut || projet.debut)} → ${jourFR(plan.fin)}`);

  let s = a.slide("Résumé exécutif", "Ce que nous demandons au comité", ou(projet.objectif, ""));
  a.chiffres(s, 1.6, [[st.lots.length, "CHANTIERS"], [st.actions.length, "ACTIONS"],
    [st.jalons.length, "JALONS"], [st.critiques, "SUR LE CHEMIN CRITIQUE"]]);
  s.addShape(p.ShapeType.rect, { x: 0.55, y: 3.0, w: W - 1.1, h: 1.0, fill: { color: ch.fond } });
  s.addText("LA DÉCISION DEMANDÉE", { x: 0.8, y: 3.14, w: 8.4, h: 0.24, fontSize: 9.5, bold: true, color: ch.accent, charSpacing: 1.4, fontFace: a.F });
  s.addText(`Valider le plan, désigner les porteurs${st.budget ? `, acter le budget de ${euros(st.budget)}` : ""}.`,
    { x: 0.8, y: 3.42, w: 8.4, h: 0.48, fontSize: 13, color: "FFFFFF", fontFace: a.F });

  if (projet.contexte) {
    s = a.slide("Constat", "Pourquoi maintenant");
    s.addText(projet.contexte.slice(0, 700), { x: 0.55, y: 1.5, w: W - 1.1, h: 3.3, fontSize: 13, color: ch.encre, fontFace: a.F, lineSpacingMultiple: 1.18 });
  }

  s = a.slide("Organisation", `Le plan s'organise en ${st.lots.length} chantier${st.lots.length > 1 ? "s" : ""}`);
  a.cartes(s, 1.55, st.lots.slice(0, 6).map((l) => {
    const ts = plan.taches.filter((t) => t.lot === l && !t.synthese);
    const j = ts.filter((x) => x.jalon).slice(-1)[0];
    return [l, `${ts.length} actions${j ? ` · jalon : ${coupe(j.titre, 46)} (${courtFR(j.fin)})` : ""}`];
  }), { cols: 2, h: 1.05 });

  a.frises("Planning", "Frise des jalons", st.jalons);

  if (projet.instances.length) {
    s = a.slide("Gouvernance", "Le cycle de réunions");
    a.tableau(s, 1.55, ["Instance", "Fréquence", "Rôle"], [26, 20, 54],
      projet.instances.map((i) => [i.nom, ou(i.frequence), coupe(ou(i.role), 90)]), { max: 6 });
  }
  if (projet.fournisseurs.length || st.budget) {
    // La répartition par chantier existe toujours dès qu'une enveloppe est
    // votée : l'afficher vaut mieux qu'une ligne « Budget de projet » seule,
    // qui laissait une diapositive vide devant le comité qui doit la voter.
    const parLot = st.lots.map((l) => [l,
      plan.taches.filter((t) => t.lot === l && !t.synthese).reduce((x, t) => x + (t.budgetPrevu || 0), 0)])
      .filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    const total = parLot.reduce((x, [, v]) => x + v, 0) || st.budget || 1;
    if (parLot.length) {
      a.tableaux({ eyebrow: "Budget", titre: "Répartition de l'enveloppe par chantier",
        chapeau: `${euros(st.budget)} votés · ${parLot.length} chantiers dotés` },
        ["Chantier", "Montant", "Part", "Actions"], [46, 20, 14, 20],
        // Pas de ligne TOTAL : elle est déjà dans le chapeau, et elle suffisait à
        // faire déborder le tableau sur une diapositive « (suite) » qui ne
        // portait qu'elle.
        parLot.map(([l, v]) => [l, euros(v), `${Math.round((v / total) * 100)} %`,
          String(plan.taches.filter((t) => t.lot === l && !t.synthese).length)]), { hauteur: 0.36 });
    }
    if (projet.fournisseurs.length) {
      a.tableaux({ eyebrow: "Budget", titre: "Fournisseurs engagés" },
        ["Fournisseur", "Prestation", "Montant", "Statut"], [24, 40, 16, 20],
        projet.fournisseurs.map((f) => [coupe(f.nom, 40), coupe(ou(f.prestation), 90), euros(f.budget), ou(f.statut)]),
        { hauteur: 0.40 });
    }
  }
  const ouverts = projet.risques.filter((r) => r.statut === "ouvert");
  if (ouverts.length) {
    a.tableaux({ eyebrow: "Arbitrages", titre: "Points à trancher", chapeau: "Classés par impact, pas par ordre d'arrivée." },
      ["Point d'arbitrage", "Impact", "Propriétaire", "Échéance"], [50, 14, 22, 14],
      ouverts.slice().sort((x, y) => (y.impact === "eleve") - (x.impact === "eleve"))
        .map((r) => [coupe(r.titre, 95), IMPACTS[r.impact], ou(r.proprietaire), quand(r.echeance)]),
      { hauteur: 0.42 });
  }
  if (projet.kpis.length) {
    a.tableaux({ eyebrow: "Performance", titre: "Cibles chiffrées" },
      ["Indicateur", "Cible", "Échéance", "Mesuré"], [38, 28, 18, 16],
      projet.kpis.map((k) => [coupe(k.indicateur, 60), coupe(ou(k.cible), 44), quand(k.echeance), ou(k.valeur, "non mesuré")]),
      { hauteur: 0.40 });
  }
  s = a.slide("Décision", "Ce qui est attendu du comité");
  [["Valider le plan", `${st.actions.length} actions, ${st.jalons.length} jalons, fin visée ${jourFR(plan.fin)}`],
   ["Désigner les porteurs", `${st.actions.filter((t) => !t.responsable).length} actions sans responsable à ce jour`],
   ["Acter le budget", st.budget ? euros(st.budget) : "à chiffrer"],
   ["Arrêter le rythme des instances", projet.instances.map((i) => i.nom).join(" · ") || "à définir"],
  ].forEach(([t, d], i) => {
    const y = 1.6 + i * 0.85;
    s.addShape(p.ShapeType.ellipse, { x: 0.55, y: y + 0.02, w: 0.36, h: 0.36, fill: { color: ch.accent } });
    s.addText(String(i + 1), { x: 0.55, y: y + 0.02, w: 0.36, h: 0.36, fontSize: 13, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: a.F });
    s.addText(t, { x: 1.08, y, w: 8.4, h: 0.28, fontSize: 13.5, bold: true, color: ch.encre, fontFace: a.F });
    s.addText(d, { x: 1.08, y: y + 0.29, w: 8.4, h: 0.42, fontSize: 10, color: ch.gris, fontFace: a.F });
  });
  return Buffer.from(await p.write({ outputType: "nodebuffer" }));
}

// ── B. COPIL de lancement — la séance elle-même ─────────────────────────────
export async function deckLancement(projet, plan, ch, trame) {
  const a = atelier(ch), { p } = a, st = stats(projet, plan);
  a.couverture("Comité de lancement", projet.nom,
    `${ou(trame?.duree, "1 h 30")} · ${ou(projet.sponsor ? `Sponsor : ${projet.sponsor}` : "", "")}`);

  let s = a.slide("Ordre du jour", ou(trame?.duree, "Déroulé de la séance"));
  const etapes = trame?.etapes?.length ? trame.etapes
    : [{ duree: "10 min", sujet: "Contexte et enjeux", intervenant: ou(projet.sponsor, "Sponsor") },
       { duree: "20 min", sujet: "Présentation du plan et des chantiers", intervenant: ou(projet.pilote, "Pilote") },
       { duree: "15 min", sujet: "Budget et arbitrages", intervenant: "Direction financière" },
       { duree: "10 min", sujet: "Désignation des porteurs", intervenant: ou(projet.relaisDG, "Direction générale") },
       { duree: "5 min", sujet: "Prochaines étapes", intervenant: ou(projet.pilote, "Pilote") }];
  a.tableau(s, 1.55, ["Durée", "Sujet", "Intervenant"], [14, 58, 28],
    etapes.map((e) => [ou(e.duree), coupe(e.sujet, 88), ou(e.intervenant)]), { max: 9 });

  a.tableaux({ eyebrow: "Le plan", titre: "Les chantiers et leurs jalons" },
    ["Chantier", "Actions", "Jalon de fin", "Échéance"], [26, 12, 44, 18],
    st.lots.map((l) => {
      const ts = plan.taches.filter((t) => t.lot === l && !t.synthese);
      const j = ts.filter((x) => x.jalon).slice(-1)[0];
      return [l, String(ts.length), j ? coupe(j.titre, 55) : "—", j ? courtFR(j.fin) : "—"];
    }));

  a.frises("Planning", "Les jalons du projet", st.jalons);

  const sans = st.actions.filter((t) => !t.responsable);
  a.tableaux({ eyebrow: "Décision", titre: "Désignation des porteurs",
    chapeau: sans.length ? `${sans.length} action${sans.length > 1 ? "s" : ""} attend${sans.length > 1 ? "ent" : ""} un nom.` : "Toutes les actions ont un porteur." },
    ["Chantier", "Actions", "Porteur désigné"], [40, 12, 48],
    st.lots.map((l) => [l, String(plan.taches.filter((t) => t.lot === l && !t.synthese).length), "………………………………………"]),
    { hauteur: 0.44, y: 1.7 });

  const ouverts = projet.risques.filter((r) => r.statut === "ouvert");
  if (ouverts.length) {
    a.tableaux({ eyebrow: "Arbitrages", titre: "À trancher en séance" },
      ["Point", "Impact", "Propriétaire"], [58, 16, 26],
      ouverts.map((r) => [coupe(r.titre, 105), IMPACTS[r.impact], ou(r.proprietaire)]), { hauteur: 0.42 });
  }
  return Buffer.from(await p.write({ outputType: "nodebuffer" }));
}

// ── C. Vue d'ensemble — le dossier complet ──────────────────────────────────
export async function deckVueEnsemble(projet, plan, ch) {
  const a = atelier(ch), { p } = a, st = stats(projet, plan);
  a.couverture(projet.nom, "Présentation du projet — vue d'ensemble",
    `${st.lots.length} chantiers · ${st.actions.length} actions · fin visée ${jourFR(plan.fin)}`);

  let s = a.slide("Résumé", "Ce qu'il faut retenir", ou(projet.objectif, ""));
  a.chiffres(s, 1.7, [[st.lots.length, "CHANTIERS"], [st.actions.length, "ACTIONS"],
    [st.jalons.length, "JALONS"], [`${Math.round((st.faites / Math.max(1, st.actions.length)) * 100)} %`, "AVANCEMENT"]]);
  a.frise(s, 3.5, st.jalons.slice(0, 5), "Les cinq premiers jalons");

  // Le dossier complet porte TOUS les jalons, pas les cinq de la synthèse.
  a.frises("Planning", "Les jalons du projet", st.jalons);

  for (const l of st.lots) {
    const ts = plan.taches.filter((t) => t.lot === l && !t.synthese);
    a.tableaux({ eyebrow: "Chantier", titre: l, chapeau: `${ts.length} actions · ${ts.filter((t) => t.critique).length} sur le chemin critique` },
      ["Action", "Échéance", "Marge (j)", "Porteur"], [56, 14, 12, 18],
      ts.map((t) => [coupe(t.titre, 92), courtFR(t.fin), t.jalon ? "—" : String(t.margeTotale ?? ""), ou(t.responsable || t.dept)]));
  }
  a.tableaux({ eyebrow: "Chemin critique", titre: "Là où le retard coûte",
    chapeau: `${plan.taches.filter((t) => t.critique && !t.synthese).length} actions sans marge d'organisation : un jour perdu sur l'une d'elles décale la fin d'autant.` },
    ["Action", "Chantier", "Échéance", "Porteur"], [46, 20, 14, 20],
    plan.taches.filter((t) => t.critique && !t.synthese)
      .map((t) => [coupe(t.titre, 82), coupe(ou(t.lot), 30), courtFR(t.fin), ou(t.responsable || t.dept)]));

  if (projet.risques.length) {
    a.tableaux({ eyebrow: "Risques", titre: "Registre des risques et plans B" },
      ["Risque", "Impact", "Statut", "Plan B"], [34, 11, 17, 38],
      projet.risques.map((r) => [coupe(r.titre, 110), IMPACTS[r.impact], STATUTS_RISQUE[r.statut], coupe(ou(r.planB, "— à écrire"), 130)]),
      { hauteur: 0.60 });
  }
  s = a.slide("Prochaines étapes", "Ce qui démarre maintenant");
  a.tableau(s, 1.6, ["Action", "Début", "Responsable"], [58, 16, 26],
    st.actions.filter((t) => t.statut !== "faite").slice(0, 8)
      .map((t) => [coupe(t.titre, 100), courtFR(t.debut), ou(t.responsable)]), { max: 8 });
  return Buffer.from(await p.write({ outputType: "nodebuffer" }));
}

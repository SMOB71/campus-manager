// Le classeur de pilotage — conçu pour servir SANS l'application.
//
// Ce n'est pas un export : c'est le modèle rejoué en formules. On saisit un
// avancement ou un retard, et le classeur repropage la chaîne, recalcule
// l'atterrissage et dit ce qui sort de sa marge. Un export figé ne sert qu'à
// constater ; celui-ci sert à décider.
//
// Deux pièges tenus :
//   · MAXIFS/MINIFS s'écrivent « _xlfn.MAXIFS » dans le fichier — sans le
//     préfixe, Excel affiche #NOM? (exceljs ne l'ajoute pas).
//   · la propagation exige que les actions soient rangées dans l'ordre
//     topologique : une ligne ne peut lire que des lignes déjà calculées.
import ExcelJS from "exceljs";
import { jourFR, euros } from "./charte.js";
import { IMPACTS, STATUTS_RISQUE, STATUTS_CR, STATUTS_TACHE } from "../projets.js";

const SERIE = 25569; // 1970-01-01 en numéro de série Excel
const num = (iso) => (iso ? Math.round(new Date(iso + "T00:00:00Z").getTime() / 86400000) + SERIE : null);
const ou = (v, d = "") => (String(v ?? "").trim() ? String(v).trim() : d);
// Cellule date : un ISO devient une vraie date Excel, le texte libre reste du
// texte. Sans ça, « 2027-02-28 » se retrouvait dans les registres — illisible,
// et ni triable ni filtrable.
const jour = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim())
  ? { value: num(String(v).trim()), numFmt: "dd/mm/yyyy" }
  : ou(v));

function habiller(ch) {
  const ENCRE = { argb: "FF" + ch.encre }, ACCENT = { argb: "FF" + ch.accent };
  const CLAIR = { argb: "FF" + ch.clair }, BORD = { argb: "FF" + ch.bordure };
  const police = (extra = {}) => ({ name: ch.police, size: 10, ...extra });
  const filet = { style: "thin", color: BORD };
  return {
    ENCRE, ACCENT, CLAIR, police,
    cadres: { top: filet, left: filet, bottom: filet, right: filet },
    titre(ws, texte, sous, largeur) {
      ws.mergeCells(1, 1, 1, largeur);
      const c = ws.getCell(1, 1);
      c.value = texte; c.font = police({ size: 15, bold: true, color: { argb: "FFFFFFFF" } });
      c.fill = { type: "pattern", pattern: "solid", fgColor: ENCRE };
      c.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(1).height = 30;
      ws.mergeCells(2, 1, 2, largeur);
      const s = ws.getCell(2, 1);
      s.value = sous; s.font = police({ size: 9, italic: true, color: { argb: "FF" + ch.gris } });
      s.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(2).height = 18;
    },
    entetes(ws, ligne, libelles, largeurs, colonne = 1) {
      const r = ws.getRow(ligne);
      libelles.forEach((t, i) => {
        const c = r.getCell(i + colonne);
        c.value = t;
        c.font = police({ bold: true, size: 9.5, color: { argb: "FFFFFFFF" } });
        c.fill = { type: "pattern", pattern: "solid", fgColor: ENCRE };
        c.alignment = { vertical: "middle", wrapText: true, indent: 1 };
        c.border = { top: filet, left: filet, bottom: filet, right: filet };
      });
      r.height = 30;
      if (largeurs) largeurs.forEach((w, i) => (ws.getColumn(i + colonne).width = w));
      ws.views = [{ state: "frozen", ySplit: ligne }];
      ws.autoFilter = { from: { row: ligne, column: colonne }, to: { row: ligne, column: colonne + libelles.length - 1 } };
    },
    corps(ws, depart, lignes, { zebre = true, colonne = 1 } = {}) {
      lignes.forEach((vals, n) => {
        const r = ws.getRow(depart + n);
        vals.forEach((v, i) => {
          const c = r.getCell(i + colonne);
          // `formula` est un accesseur en lecture seule sur Cell : l'écrire
          // directement lève. Une formule ne s'installe que par `value`.
          if (v && typeof v === "object" && !(v instanceof Date)) {
            const { formula, value, numFmt, ...reste } = v;
            if (formula !== undefined) c.value = { formula };
            else if (value !== undefined) c.value = value;
            if (numFmt) c.numFmt = numFmt;
            Object.assign(c, reste);
          } else c.value = v;
          c.font = c.font || police();
          c.border = { top: filet, left: filet, bottom: filet, right: filet };
          if (zebre && n % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: CLAIR };
          c.alignment = { vertical: "middle", wrapText: true, indent: 1, ...(c.alignment || {}) };
        });
      });
    },
    // Saisie : fond blanc franc + contour accent. L'utilisateur doit voir d'un
    // coup d'œil les DEUX colonnes qu'il a le droit de toucher.
    saisie(ws, col, de, a) {
      for (let r = de; r <= a; r++) {
        const c = ws.getCell(r, col);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDF0" } };
        c.border = { top: { style: "thin", color: ACCENT }, left: { style: "thin", color: ACCENT },
                     bottom: { style: "thin", color: ACCENT }, right: { style: "thin", color: ACCENT } };
        c.protection = { locked: false };
      }
    },
  };
}

// Tri topologique : indispensable, la propagation par formules ne sait lire
// que vers le haut. Un cycle (impossible en théorie, le plan est validé)
// laisserait des lignes en fin de liste plutôt que de boucler.
function ordonner(taches) {
  const parId = new Map(taches.map((t) => [t.id, t]));
  const vus = new Set(), sortie = [];
  const visiter = (t, pile = new Set()) => {
    if (vus.has(t.id) || pile.has(t.id)) return;
    pile.add(t.id);
    for (const l of t.liens || []) { const p = parId.get(l.deId); if (p) visiter(p, pile); }
    pile.delete(t.id);
    if (!vus.has(t.id)) { vus.add(t.id); sortie.push(t); }
  };
  taches.forEach((t) => visiter(t));
  return sortie;
}

export async function classeurPilotage(projet, plan, ch, options = {}) {
  const h = habiller(ch);
  const wb = new ExcelJS.Workbook();
  wb.creator = ch.emetteur;
  wb.created = new Date(plan.resume?.aujourdhui ? plan.resume.aujourdhui + "T00:00:00Z" : Date.now());

  const actions = ordonner(plan.taches.filter((t) => !t.synthese));
  const rang = new Map(actions.map((t, i) => [t.id, i]));
  const LIG = 5;                                  // 1re ligne de données d'« Actions »
  const L = (id) => LIG + rang.get(id);           // ligne Excel d'une action
  const fin = actions.length ? LIG + actions.length - 1 : LIG;

  // ── 1. Mode d'emploi ──────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Mode d'emploi", { properties: { tabColor: h.ENCRE } });
    h.titre(ws, `${projet.nom} — classeur de pilotage`, `${ch.emetteur} · ${ch.mention} · édité le ${jourFR(wb.created.toISOString().slice(0, 10))}`, 2);
    ws.getColumn(1).width = 34; ws.getColumn(2).width = 96;
    h.entetes(ws, 4, ["Ce que vous faites", "Ce que le classeur fait"], [34, 96]);
    h.corps(ws, 5, [
      ["Onglet « Actions », colonne Avancement", "Rien d'automatique : c'est votre déclaration d'état. Sert au tableau de bord et au taux d'avancement."],
      ["Onglet « Actions », colonne Retard constaté (j)", "LA colonne qui pilote. Le retard se propage aux actions suivantes, l'atterrissage se recalcule, et la marge restante diminue d'autant."],
      ["Colonne Fin projetée", "Calculée. Reprend la fin de la dernière action bloquante, plus le décalage, plus la durée. Ne pas écraser : la chaîne se casserait."],
      ["Colonne Marge restante (j)", "Marge de départ moins le glissement. À zéro, l'action est sur le chemin critique : tout jour de plus décale la fin du projet."],
      ["Colonne Hors marge ?", "« OUI » signifie que cette action fait glisser la date de fin. C'est la seule alerte à regarder en réunion."],
      ["Onglet « Tableau de bord »", "Se met à jour seul. Atterrissage, nombre d'actions en retard, actions hors marge, marge minimale restante, budget engagé."],
      ["Onglet « Frise »", "Barres recalculées sur les dates projetées, pas sur les dates de départ : la frise suit le réel."],
      ["Onglets registres", "Risques, indicateurs, changements, fournisseurs, instances : saisie libre, ce sont vos registres de gouvernance."],
      ["Onglet « Liens »", "La mécanique. Une ligne par dépendance. À ne modifier que pour corriger un enchaînement réellement faux."],
      ["Réimport dans l'application", "Ce classeur se relit : les colonnes Avancement, Retard constaté, Statut, Budget dépensé et Responsable sont reprises."],
    ], {});
  }

  // ── 2. Tableau de bord ────────────────────────────────────────────────────
  // Une liste de quinze lignes de texte ne se lit pas : tout y a le même poids,
  // et rien ne change de couleur quand la situation se dégrade. Ce qu'un COPIL
  // regarde tient en quatre chiffres — on les pose en tuiles, et on les fait
  // virer au rouge tout seuls.
  {
    const ws = wb.addWorksheet("Tableau de bord", { properties: { tabColor: h.ACCENT }, views: [{ showGridLines: false }] });
    const A = `Actions!`;
    const ATT = `_xlfn.MAXIFS(${A}N${LIG}:N${fin},${A}V${LIG}:V${fin},"NON")`;
    const REF = `_xlfn.MAXIFS(${A}I${LIG}:I${fin},${A}V${LIG}:V${fin},"NON")`;

    ws.getColumn(1).width = 3;
    for (let c = 2; c <= 9; c++) ws.getColumn(c).width = 17;
    ws.getColumn(10).width = 3;

    h.titre(ws, `${projet.nom} — tableau de bord`, "Tout est calculé depuis l'onglet « Actions ». Rien à saisir ici.", 10);

    // Quatre tuiles : la date à annoncer, l'écart, ce qui pousse cette date, et
    // le maillon le plus tendu. Le reste est du détail, il vient dessous.
    const tuiles = [
      { titre: "ATTERRISSAGE", formule: ATT, fmt: "dd/mm/yyyy", note: "date de rentrée projetée" },
      { titre: "GLISSEMENT", formule: `${ATT}-${REF}`, fmt: '0 "j"', note: "écart à la rentrée visée", alerte: "sup0" },
      { titre: "HORS MARGE", formule: `COUNTIF(${A}Q${LIG}:Q${fin},"OUI")`, fmt: "0", note: "actions qui poussent la date", alerte: "sup0" },
      { titre: "MARGE MINIMALE", formule: `MIN(${A}P${LIG}:P${fin})`, fmt: '0 "j"', note: "le maillon le plus tendu", alerte: "faible" },
    ];
    const T0 = 4;
    tuiles.forEach((t, i2) => {
      const c1 = 2 + i2 * 2;
      ws.mergeCells(T0, c1, T0, c1 + 1);
      ws.mergeCells(T0 + 1, c1, T0 + 2, c1 + 1);
      ws.mergeCells(T0 + 3, c1, T0 + 3, c1 + 1);
      const tete = ws.getCell(T0, c1);
      tete.value = t.titre;
      tete.font = h.police({ bold: true, size: 9, color: { argb: "FFFFFFFF" } });
      tete.fill = { type: "pattern", pattern: "solid", fgColor: h.ENCRE };
      tete.alignment = { horizontal: "center", vertical: "middle" };
      const v = ws.getCell(T0 + 1, c1);
      v.value = { formula: t.formule };
      v.numFmt = t.fmt;
      v.font = h.police({ bold: true, size: 26, color: h.ENCRE });
      v.alignment = { horizontal: "center", vertical: "middle" };
      v.fill = { type: "pattern", pattern: "solid", fgColor: h.CLAIR };
      const n = ws.getCell(T0 + 3, c1);
      n.value = t.note;
      n.font = h.police({ size: 9, color: { argb: "FF" + ch.gris }, italic: true });
      n.alignment = { horizontal: "center", vertical: "middle" };
      // L'alerte est PORTÉE PAR LE CLASSEUR : on saisit un retard, la tuile
      // vire au rouge sans que personne ait à relire une ligne de texte.
      const ref = ws.getCell(T0 + 1, c1).address;
      if (t.alerte === "sup0") {
        ws.addConditionalFormatting({ ref, rules: [{
          type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 1,
          style: { font: { bold: true, size: 26, color: { argb: "FFFFFFFF" } },
                   fill: { type: "pattern", pattern: "solid", bgColor: h.ACCENT } } }] });
      }
      if (t.alerte === "faible") {
        ws.addConditionalFormatting({ ref, rules: [
          { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1,
            style: { font: { bold: true, size: 26, color: { argb: "FFFFFFFF" } },
                     fill: { type: "pattern", pattern: "solid", bgColor: h.ACCENT } } },
          { type: "cellIs", operator: "lessThan", formulae: ["5"], priority: 2,
            style: { font: { bold: true, size: 26, color: { argb: "FF8A5A00" } },
                     fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDF3E0" } } } },
        ] });
      }
    });
    ws.getRow(T0).height = 16;
    ws.getRow(T0 + 1).height = 26;
    ws.getRow(T0 + 2).height = 16;
    ws.getRow(T0 + 3).height = 14;

    const D0 = T0 + 6;
    const mesures = [
      ["Rentrée visée", { formula: REF, numFmt: "dd/mm/yyyy" }, "La date du plan initial."],
      ["Dernière action du projet", { formula: `MAX(${A}N${LIG}:N${fin})`, numFmt: "dd/mm/yyyy" }, "Y compris les actions d'après la rentrée (bilans, soldes administratifs)."],
      ["Actions en retard", { formula: `COUNTIF(${A}O${LIG}:O${fin},">0")`, numFmt: "0" }, "Fin projetée au-delà de la fin prévue."],
      ["Avancement moyen", { formula: `AVERAGE(${A}K${LIG}:K${fin})`, numFmt: "0 %" }, "Moyenne des avancements déclarés."],
      ["Actions terminées", { formula: `COUNTIF(${A}L${LIG}:L${fin},"Terminée")&" / "&${actions.length}`, numFmt: "@" }, "Sur la base de la colonne Statut."],
      ["Actions sur le chemin critique", { formula: `COUNTIF(${A}G${LIG}:G${fin},"OUI")`, numFmt: "0" }, "Aucune marge de départ : à surveiller en priorité."],
      ["Jalons du projet", { formula: `COUNTIF(${A}F${LIG}:F${fin},"OUI")`, numFmt: "0" }, "Détail dans l'onglet « Jalons »."],
      ["Risques ouverts", { formula: `COUNTIF(Risques!G2:G400,"Ouvert")`, numFmt: "0" }, "Registre des risques, statut « Ouvert »."],
      ["Budget prévu", { formula: `SUM(${A}R${LIG}:R${fin})`, numFmt: '# ##0 "€"' }, "Somme des budgets d'action."],
      ["Budget dépensé", { formula: `SUM(${A}S${LIG}:S${fin})`, numFmt: '# ##0 "€"' }, "Somme des dépenses saisies."],
      ["Reste à engager", { formula: `SUM(${A}R${LIG}:R${fin})-SUM(${A}S${LIG}:S${fin})`, numFmt: '# ##0 "€"' }, "Prévu moins dépensé."],
    ];
    ws.getCell(D0 - 1, 2).value = "Le détail";
    ws.getCell(D0 - 1, 2).font = h.police({ bold: true, size: 12, color: h.ACCENT });
    h.entetes(ws, D0, ["Indicateur", "Valeur", "Lecture"], null, 2);
    ws.mergeCells(D0, 3, D0, 4);
    ws.mergeCells(D0, 5, D0, 9);
    // Les entêtes posés, on recale les largeurs : la colonne 1 sert de marge.
    ws.getColumn(2).width = 34;
    h.corps(ws, D0 + 1, mesures.map(([l, v]) => [l, v, ""]), { colonne: 2 });
    mesures.forEach(([l, v, note], k) => {
      const r = D0 + 1 + k;
      ws.mergeCells(r, 3, r, 4);
      ws.mergeCells(r, 5, r, 9);
      const c = ws.getCell(r, 3);
      c.font = h.police({ bold: true, size: 11, color: h.ENCRE });
      c.alignment = { horizontal: "center", vertical: "middle" };
      const n = ws.getCell(r, 5);
      n.value = note;
      n.font = h.police({ size: 9.5, color: { argb: "FF" + ch.gris } });
      n.alignment = { vertical: "middle", indent: 1, wrapText: true };
    });
    ws.views = [{ showGridLines: false }];

    const y = D0 + mesures.length + 3;
    ws.mergeCells(y, 2, y, 9);
    const b = ws.getCell(y, 2);
    b.value = "La seule colonne à tenir à jour est « Retard constaté (j) » dans l'onglet Actions. Tout le reste en découle.";
    b.font = h.police({ bold: true, color: { argb: "FFFFFFFF" } });
    b.fill = { type: "pattern", pattern: "solid", fgColor: h.ACCENT };
    b.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(y).height = 24;
  }

  // ── 3. Actions — le cœur ──────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Actions", { properties: { tabColor: h.ENCRE } });
    h.titre(ws, "Suivi des actions", "Colonnes encadrées en couleur = à vous. Les autres se calculent — les écraser casse la propagation.", 24);
    h.entetes(ws, 4, ["Id", "Code", "Chantier", "Action", "Responsable", "Jalon ?", "Critique ?",
      "Début prévu", "Fin prévue", "Durée (j)", "Avancement", "Statut", "Retard constaté (j)",
      "Fin projetée", "Glissement (j)", "Marge restante (j)", "Hors marge ?", "Budget prévu",
      "Budget dépensé", "Bloquée par", "Direction", "Après la rentrée ?", "Date imposée par", "Terminé quand"],
      [10, 9, 24, 52, 20, 8, 9, 12, 12, 8, 11, 14, 13, 12, 11, 12, 11, 13, 13, 26, 14, 15, 34, 62]);

    const lignes = actions.map((t) => {
      const r = L(t.id);
      // MAXPRED est un jeton, remplacé une fois l'onglet « Liens » écrit : sa
      // colonne D porte « fin projetée du prédécesseur + décalage », et MAXIFS
      // y prend le maximum pour cette action — la dépendance la plus
      // contraignante gagne, comme dans le calcul de l'application.
      return [
        t.id, ou(t.code), ou(t.lot), ou(t.titre), ou(t.responsable),
        t.jalon ? "OUI" : "", t.critique ? "OUI" : "",
        { value: num(t.debut), numFmt: "dd/mm/yyyy" },
        { value: num(t.fin), numFmt: "dd/mm/yyyy" },
        { value: t.dureeJours ?? 0, numFmt: "0" },
        { value: t.avancement || 0, numFmt: "0 %" },
        STATUTS_TACHE[t.statut] || "À faire",
        { value: 0, numFmt: "0" },
        { formula: `IF(MAXPRED=0,H${r}+M${r},MAX(I${r},MAXPRED+MAX(J${r},1)-1)+M${r})`, numFmt: "dd/mm/yyyy" },
        { formula: `N${r}-I${r}`, numFmt: "0" },
        // Marge inconnue (rien en aval) : la cellule reste vide. MIN et COUNTIF
        // ignorent le vide — un zéro, lui, écrasait la marge minimale du plan.
        t.margeTotale == null ? "" : { formula: `${t.margeTotale}-O${r}`, numFmt: "0" },
        { formula: `IF(N(P${r})<0,"OUI","")` },
        { value: t.budgetPrevu || 0, numFmt: '# ##0 "€"' },
        { value: t.budgetDepense || 0, numFmt: '# ##0 "€"' },
        (t.liens || []).map((l) => plan.taches.find((x) => x.id === l.deId)?.code).filter(Boolean).join(", "),
        ou(t.dept || t.direction),
        t.apresRentree ? "OUI" : "NON",
        t.baseLegale || "",
        t.critereFin || "— à définir —",
      ];
    });
    h.corps(ws, LIG, lignes);
    // Le placeholder MAXPRED n'est remplacé qu'ici, une fois le nombre de liens
    // connu : la plage doit couvrir tout l'onglet Liens, pas une ligne.
    h.saisie(ws, 11, LIG, fin); h.saisie(ws, 13, LIG, fin);
    h.saisie(ws, 12, LIG, fin); h.saisie(ws, 19, LIG, fin);
    ws.getColumn(1).hidden = true;
    for (let r = LIG; r <= fin; r++) {
      ws.getCell(r, 17).font = h.police({ bold: true, color: h.ACCENT });
      ws.getCell(r, 7).font = h.police({ bold: true, color: h.ACCENT });
      ws.getCell(r, 12).dataValidation = {
        type: "list", allowBlank: false, formulae: [`"${Object.values(STATUTS_TACHE).join(",")}"`],
        showErrorMessage: true, errorTitle: "Statut inconnu", error: "Choisir dans la liste.",
      };
      ws.getCell(r, 11).dataValidation = {
        type: "decimal", operator: "between", formulae: [0, 1], allowBlank: true,
        showErrorMessage: true, errorTitle: "Avancement", error: "Entre 0 % et 100 %.",
      };
    }

    // Rangs de service, masqués : ils numérotent les lignes de chaque
    // catégorie pour que la feuille « Cette semaine » les retrouve par un
    // simple INDEX/MATCH. Les formules matricielles (SMALL + IF) ne
    // s'évaluent pas pareil selon la version d'Excel, et une liste qui
    // affiche discrètement les mauvaises lignes est pire qu'une liste vide.
    for (let r = LIG; r <= fin; r++) {
      ws.getCell(r, 24).value = { formula: `IF(AND($N${r}<TODAY(),$L${r}<>"Terminée"),COUNTIFS($N$${LIG}:$N${r},"<"&TODAY(),$L$${LIG}:$L${r},"<>Terminée"),"")` };
      ws.getCell(r, 25).value = { formula: `IF(AND($N${r}>=TODAY(),$N${r}<=TODAY()+14,$L${r}<>"Terminée"),COUNTIFS($N$${LIG}:$N${r},">="&TODAY(),$N$${LIG}:$N${r},"<="&TODAY()+14,$L$${LIG}:$L${r},"<>Terminée"),"")` };
      ws.getCell(r, 26).value = { formula: `IF($Q${r}="OUI",COUNTIF($Q$${LIG}:$Q${r},"OUI"),"")` };
    }
    for (const c of [24, 25, 26]) ws.getColumn(c).hidden = true;

    // Une ligne qui pousse la date de fin doit SE VOIR. Sans mise en forme
    // conditionnelle, il fallait relire deux cents lignes pour trouver la
    // seule qui compte — et personne ne le fait.
    ws.addConditionalFormatting({ ref: `A${LIG}:W${fin}`, rules: [
      { type: "expression", formulae: [`$Q${LIG}="OUI"`], priority: 1,
        style: { font: { bold: true, color: { argb: "FF7A1230" } },
                 fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFBE9EE" } } } },
      { type: "expression", formulae: [`AND($L${LIG}<>"Terminée",$M${LIG}>0)`], priority: 2,
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDF3E0" } } } },
      { type: "expression", formulae: [`$L${LIG}="Terminée"`], priority: 3,
        style: { font: { color: { argb: "FF9AA4BB" } } } },
    ] });
    // Et la marge restante se lit en couleur : rouge si elle est dépassée,
    // ambre sous cinq jours.
    ws.addConditionalFormatting({ ref: `P${LIG}:P${fin}`, rules: [
      { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1,
        style: { font: { bold: true, color: { argb: "FFFFFFFF" } },
                 fill: { type: "pattern", pattern: "solid", bgColor: h.ACCENT } } },
      { type: "cellIs", operator: "lessThan", formulae: ["5"], priority: 2,
        style: { font: { bold: true, color: { argb: "FF8A5A00" } },
                 fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDF3E0" } } } },
    ] });
  }

  // ── 4. Liens — la mécanique de propagation ───────────────────────────────
  {
    // Feuille MASQUÉE : c'est la mécanique de propagation, pas un document.
    // Exposée, elle faisait croire à une quinzième chose à tenir à jour.
    const ws = wb.addWorksheet("Liens", { properties: { tabColor: { argb: "FF9AA4BB" } }, state: "hidden" });
    h.entetes(ws, 1, ["Prédécesseur (id)", "Action (id)", "Décalage (j)", "Fin projetée du prédécesseur", "Lecture"],
      [18, 16, 14, 26, 60]);
    const liens = [];
    for (const t of actions) for (const l of t.liens || []) {
      if (!rang.has(l.deId)) continue;
      liens.push([l.deId, t.id, l.decalageJours || 0,
        { formula: `IFERROR(INDEX(Actions!$N:$N,MATCH($A${liens.length + 2},Actions!$A:$A,0))+$C${liens.length + 2},0)`, numFmt: "0" },
        `${ou(plan.taches.find((x) => x.id === l.deId)?.titre)} → ${ou(t.titre)}`]);
    }
    h.corps(ws, 2, liens.length ? liens : [["", "", "", "", "Aucune dépendance : les actions sont indépendantes."]]);
    const derniere = Math.max(2, liens.length + 1);
    // Remplacement du placeholder, maintenant que la plage est connue.
    const wsA = wb.getWorksheet("Actions");
    for (let r = LIG; r <= fin; r++) {
      const c = wsA.getCell(r, 14);
      const pred = `_xlfn.MAXIFS(Liens!$D$2:$D$${derniere},Liens!$B$2:$B$${derniere},$A${r})`;
      c.value = { formula: String(c.formula || "").replace(/MAXPRED/g, pred) };
      c.numFmt = "dd/mm/yyyy";
    }
  }

  // ── 4bis. Cette semaine ──────────────────────────────────────────────────
  // Un classeur de deux cents lignes ne dit pas quoi faire lundi matin. Cette
  // feuille le dit : ce qui est dû, ce qui est en retard, ce qui pousse la
  // date. Elle est ENTIÈREMENT calculée — elle suit la date du jour, donc elle
  // est juste sans qu'on y touche.
  {
    const ws = wb.addWorksheet("Cette semaine", { properties: { tabColor: h.ACCENT }, views: [{ showGridLines: false }] });
    const A = `Actions!`;
    ws.getColumn(1).width = 3;
    ws.getColumn(2).width = 12; ws.getColumn(3).width = 62; ws.getColumn(4).width = 24;
    ws.getColumn(5).width = 12; ws.getColumn(6).width = 11; ws.getColumn(7).width = 13;
    h.titre(ws, "Cette semaine", "Calculé depuis la date du jour : rien à saisir, rien à trier.", 7);

    const bloc = (ligne, titre, sousTitre, critere) => {
      ws.mergeCells(ligne, 2, ligne, 7);
      const t = ws.getCell(ligne, 2);
      t.value = titre;
      t.font = h.police({ bold: true, size: 12, color: { argb: "FFFFFFFF" } });
      t.fill = { type: "pattern", pattern: "solid", fgColor: h.ENCRE };
      t.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(ligne).height = 20;
      const st = ws.getCell(ligne + 1, 2);
      ws.mergeCells(ligne + 1, 2, ligne + 1, 7);
      st.value = sousTitre;
      st.font = h.police({ size: 9.5, italic: true, color: { argb: "FF" + ch.gris } });
      st.alignment = { vertical: "middle", indent: 1 };
      h.entetes(ws, ligne + 2, ["Échéance", "Action", "Porteur", "Marge (j)", "Statut", "Hors marge"], null, 2);
      // Les lignes sont RAMENÉES par formule depuis l'onglet Actions : le
      // classeur se met à jour tout seul quand une date bouge ou qu'un statut
      // change. Une liste figée aurait menti dès la première semaine.
      for (let k = 0; k < 15; k++) {
        const r = ligne + 3 + k;
        const rang = k + 1;
        const cols = [["B", "N"], ["C", "D"], ["D", "E"], ["E", "P"], ["F", "L"], ["G", "Q"]];
        for (const [dest, src] of cols) {
          const c = ws.getCell(`${dest}${r}`);
          // INDEX/MATCH sur la colonne de rang : aucune formule matricielle,
          // donc le même résultat quelle que soit la version d'Excel.
          c.value = { formula: `IFERROR(INDEX(${A}$${src}$${LIG}:$${src}$${fin},MATCH(${rang},${A}$${critere}$${LIG}:$${critere}$${fin},0)),"")` };
          c.font = h.police({ size: 10 });
          c.alignment = { vertical: "middle", wrapText: dest === "C", indent: 1 };
          if (dest === "B") c.numFmt = "dd/mm/yyyy";
          if (dest === "E") c.numFmt = "0";
        }
        if (k % 2) for (const [dest] of cols) ws.getCell(`${dest}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: h.CLAIR };
      }
      ws.addConditionalFormatting({ ref: `B${ligne + 3}:G${ligne + 17}`, rules: [
        { type: "expression", formulae: [`$G${ligne + 3}="OUI"`], priority: 1,
          style: { font: { bold: true, color: { argb: "FF7A1230" } },
                   fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFBE9EE" } } } },
      ] });
      return ligne + 18;
    };

    // « Aujourd'hui » vient de TODAY() dans les colonnes de rang : la feuille
    // ne vieillit pas, elle suit la date à chaque ouverture.
    let y = 4;
    y = bloc(y, "En retard — échéance passée, non soldé",
      "À traiter en premier : ce sont elles qui poussent la date de rentrée.",
"X");
    y = bloc(y + 1, "À solder dans les 14 jours",
      "La semaine qui vient et la suivante.",
"Y");
    bloc(y + 1, "Hors marge — décale la rentrée",
      "Quelle que soit leur échéance : leur retard est déjà supérieur à leur marge.",
"Z");

    const z = y + 20;
    ws.mergeCells(z, 2, z, 7);
    const n = ws.getCell(z, 2);
    n.value = "Ces trois listes suivent la date du jour et se recalculent à chaque ouverture. Elles affichent les quinze premières lignes de chaque catégorie : au-delà, filtrer l'onglet « Actions ».";
    n.font = h.police({ size: 9, italic: true, color: { argb: "FF" + ch.gris } });
    n.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(z).height = 26;
    ws.views = [{ showGridLines: false }];
  }

  // ── 5. Jalons ─────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Jalons");
    h.titre(ws, "Jalons", "Dates projetées reprises de l'onglet « Actions » : elles bougent avec les retards saisis.", 6);
    h.entetes(ws, 4, ["Code", "Jalon", "Chantier", "Date de référence", "Date projetée", "Glissement (j)"],
      [9, 62, 24, 16, 16, 13]);
    const js = actions.filter((t) => t.jalon);
    h.corps(ws, 5, js.length ? js.map((t) => [ou(t.code), ou(t.titre), ou(t.lot),
      { value: num(t.fin), numFmt: "dd/mm/yyyy" },
      { formula: `INDEX(Actions!$N:$N,${L(t.id)})`, numFmt: "dd/mm/yyyy" },
      { formula: `INDEX(Actions!$O:$O,${L(t.id)})`, numFmt: "0" },
    ]) : [["", "Aucun jalon déclaré.", "", "", "", ""]]);
  }

  // ── 6. Frise ──────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Frise");
    const debut = actions.map((t) => t.debut).filter(Boolean).sort()[0] || projet.debut;
    const finMax = actions.map((t) => t.fin).filter(Boolean).sort().slice(-1)[0] || debut;
    const semaines = Math.min(80, Math.max(1, Math.ceil((new Date(finMax) - new Date(debut)) / (7 * 86400000)) + 6));
    h.titre(ws, "Frise", `${semaines} semaines depuis le ${jourFR(debut)}. Les barres suivent les dates PROJETÉES : saisir un retard déplace la barre.`, 3 + semaines);
    const d0 = num(debut);
    const entetes = ["Chantier", "Action", "Resp."];
    for (let s = 0; s < semaines; s++) entetes.push("");
    h.entetes(ws, 4, entetes, [22, 44, 16, ...Array(semaines).fill(3.2)]);
    for (let s = 0; s < semaines; s++) {
      const c = ws.getCell(4, 4 + s);
      c.value = { formula: `TEXT(${d0 + s * 7},"dd/mm")` };
      c.alignment = { textRotation: 90, vertical: "middle", horizontal: "center" };
      c.font = h.police({ bold: true, size: 7.5, color: { argb: "FFFFFFFF" } });
    }
    const lignes = actions.map((t) => {
      const r = L(t.id);
      const cellules = [ou(t.lot), ou(t.titre), ou(t.responsable)];
      for (let s = 0; s < semaines; s++) {
        const a = d0 + s * 7, b = a + 6;
        cellules.push({ formula: `IF(AND(Actions!$N${r}>=${a},Actions!$N${r}-MAX(Actions!$J${r},1)+1<=${b}),"█","")` });
      }
      return cellules;
    });
    h.corps(ws, 5, lignes);
    for (let n = 0; n < actions.length; n++) for (let s = 0; s < semaines; s++) {
      const c = ws.getCell(5 + n, 4 + s);
      c.font = h.police({ size: 9, color: actions[n].critique ? h.ACCENT : h.ENCRE });
      c.alignment = { horizontal: "center", vertical: "middle" };
    }
    ws.views = [{ state: "frozen", xSplit: 3, ySplit: 4 }];
  }

  // ── 7. Responsabilités ───────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Responsabilités");
    h.titre(ws, "Responsabilités", "Qui porte quoi, et ce que chaque porteur doit obtenir des autres avant de commencer.", 5);
    h.entetes(ws, 4, ["Responsable", "Actions portées", "Dont sur le chemin critique", "Chantiers", "Première échéance"],
      [24, 16, 22, 40, 16]);
    const noms = [...new Set(actions.map((t) => t.responsable).filter(Boolean))].sort();
    h.corps(ws, 5, noms.length ? noms.map((nom) => {
      const s = actions.filter((t) => t.responsable === nom);
      return [nom, s.length, s.filter((t) => t.critique).length,
        [...new Set(s.map((t) => t.lot).filter(Boolean))].join(", "),
        { value: num(s.map((t) => t.fin).filter(Boolean).sort()[0]), numFmt: "dd/mm/yyyy" }];
    }) : [["Aucun responsable désigné.", "", "", "", ""]]);
    const y = 5 + Math.max(1, noms.length) + 1;
    const orphelines = actions.filter((t) => !t.responsable);
    ws.mergeCells(y, 1, y, 5);
    const b = ws.getCell(y, 1);
    b.value = orphelines.length
      ? `${orphelines.length} action(s) sans responsable — à nommer : ${orphelines.slice(0, 6).map((t) => t.code).join(", ")}${orphelines.length > 6 ? "…" : ""}`
      : "Toutes les actions ont un responsable.";
    b.font = h.police({ bold: true, color: orphelines.length ? h.ACCENT : h.ENCRE });
    b.alignment = { vertical: "middle", indent: 1 };
  }

  // ── 8 à 12. Registres de gouvernance ─────────────────────────────────────
  const registre = (nom, sous, entetes, largeurs, lignes, vide) => {
    const ws = wb.addWorksheet(nom);
    h.titre(ws, nom, sous, entetes.length);
    h.entetes(ws, 4, entetes, largeurs);
    h.corps(ws, 5, lignes.length ? lignes : [[vide, ...Array(entetes.length - 1).fill("")]]);
    return ws;
  };
  registre("Délais légaux", "Ces dates sont posées par un texte ou par le calendrier d'un tiers. Saisir un retard dessus ne les repousse pas : il révèle un problème à traiter ailleurs.",
    ["Texte ou calendrier", "Ce qu'il impose", "Action du plan", "Échéance", "Source"], [34, 58, 50, 13, 46],
    (projet.sources || []).flatMap((src) => src.actions.map((a, i) => [
      i ? "" : src.texte, i ? "" : src.regle, a.titre, { value: num(a.fin), numFmt: "dd/mm/yyyy" }, i ? "" : src.url,
    ])),
    "Aucune échéance légale identifiée sur ce plan.");
  // Le classeur portait le PLAN mais pas sa gouvernance : aucune trace des
  // séances tenues ni des décisions prises. Un plan sans relevé de décisions
  // se rediscute à chaque comité.
  {
    const ws = wb.addWorksheet("Suivi des séances");
    h.titre(ws, "Suivi des séances", "Une ligne par séance. Ce qui s'y est dit ne vit nulle part ailleurs.", 7);
    h.entetes(ws, 4, ["Date", "Instance", "Tenue ?", "Présents", "Points traités", "Décisions prises", "Compte rendu diffusé le"],
      [13, 24, 11, 34, 44, 44, 18]);
    const seances = (options.seances || []).filter((x) => x?.date);
    h.corps(ws, 5, seances.length
      ? seances.map((x) => [{ value: num(x.date), numFmt: "dd/mm/yyyy" }, ou(x.instance || x.libelle, projet.instances[0]?.nom), "", "", "", "", ""])
      : [["", projet.instances[0]?.nom || "", "", "", "", "", ""]]);
    for (let r = 5; r < 5 + Math.max(1, seances.length); r++) {
      for (const c of [3, 4, 5, 6, 7]) h.saisie(ws, c, r, r);
      ws.getRow(r).height = 26;
      ws.getCell(r, 3).dataValidation = { type: "list", allowBlank: true, formulae: ['"Tenue,Reportée,Annulée"'] };
    }
  }

  {
    const ws = wb.addWorksheet("Relevé de décisions");
    h.titre(ws, "Relevé de décisions", "Le registre cumulé. Une décision qui n'est pas ici n'a pas été prise.", 6);
    h.entetes(ws, 4, ["Date", "Séance", "Décision", "Motif", "Porteur", "Pour quand"], [13, 22, 50, 40, 20, 14]);
    h.corps(ws, 5, Array.from({ length: 40 }, () => ["", "", "", "", "", ""]));
    for (let r = 5; r < 45; r++) { h.saisie(ws, 1, r, r); for (const c of [2, 3, 4, 5, 6]) h.saisie(ws, c, r, r); ws.getRow(r).height = 22; }
  }

  registre("Instances", "Le cycle de réunions du projet : qui se réunit, à quel rythme, pour décider quoi.",
    ["Instance", "Fréquence", "Composition", "Rôle et décisions"], [24, 16, 44, 56],
    projet.instances.map((i) => [i.nom, ou(i.frequence), ou(i.composition), ou(i.role)]),
    "Aucune instance déclarée — à définir avant le lancement.");

  {
    const ws = registre("Risques", "Un risque sans plan B n'est pas piloté : il est subi. La colonne « Plan B » n'est pas optionnelle.",
      ["Risque", "Chantier", "Impact", "Seuil de déclenchement", "Plan B", "Décideur", "Statut", "Échéance", "Commentaire"],
      [46, 18, 11, 34, 44, 16, 17, 13, 34],
      projet.risques.map((r) => [r.titre, ou(r.chantier), IMPACTS[r.impact], ou(r.seuil), ou(r.planB), ou(r.decideur || r.proprietaire), STATUTS_RISQUE[r.statut], jour(r.echeance), ou(r.commentaire)]),
      "Aucun risque identifié — improbable sur un projet de cette taille.");
    // Colonne G lue par le tableau de bord (COUNTIF « Ouvert ») : liste fermée.
    for (let r = 5; r < 5 + Math.max(1, projet.risques.length) + 40; r++) {
      ws.getCell(r, 7).dataValidation = { type: "list", allowBlank: true, formulae: [`"${Object.values(STATUTS_RISQUE).join(",")}"`] };
      ws.getCell(r, 3).dataValidation = { type: "list", allowBlank: true, formulae: [`"${Object.values(IMPACTS).join(",")}"`] };
    }
  }
  {
    const ws = registre("Budget", "Le budget se suit par action dans l'onglet « Actions ». Ici, la vue par chantier et par fournisseur.",
      ["Chantier", "Budget prévu", "Budget dépensé", "Reste", "Actions"], [30, 16, 16, 16, 12],
      [...new Set(actions.map((t) => t.lot).filter(Boolean))].map((l) => [
        l, null, null, null, actions.filter((t) => t.lot === l).length,
      ]),
      "Aucun chantier budgété.");
    const lots = [...new Set(actions.map((t) => t.lot).filter(Boolean))];
    lots.forEach((l, i) => {
      const r = 5 + i;
      ws.getCell(r, 2).value = { formula: `_xlfn.SUMIFS(Actions!$R$${LIG}:$R$${fin},Actions!$C$${LIG}:$C$${fin},$A${r})` };
      ws.getCell(r, 2).numFmt = '# ##0 "€"';
      ws.getCell(r, 3).value = { formula: `_xlfn.SUMIFS(Actions!$S$${LIG}:$S$${fin},Actions!$C$${LIG}:$C$${fin},$A${r})` };
      ws.getCell(r, 3).numFmt = '# ##0 "€"';
      ws.getCell(r, 4).value = { formula: `$B${r}-$C${r}` };
      ws.getCell(r, 4).numFmt = '# ##0 "€"';
    });
    const y = 5 + Math.max(1, lots.length);
    ws.getCell(y, 1).value = "TOTAL";
    ws.getCell(y, 1).font = h.police({ bold: true, color: { argb: "FFFFFFFF" } });
    ws.getCell(y, 1).fill = { type: "pattern", pattern: "solid", fgColor: h.ENCRE };
    [2, 3, 4].forEach((c) => {
      const cell = ws.getCell(y, c);
      cell.value = { formula: `SUM(${String.fromCharCode(64 + c)}5:${String.fromCharCode(64 + c)}${y - 1})` };
      cell.numFmt = '# ##0 "€"';
      cell.font = h.police({ bold: true, color: { argb: "FFFFFFFF" } });
      cell.fill = { type: "pattern", pattern: "solid", fgColor: h.ENCRE };
    });
    ws.getCell(y + 2, 1).value = `Budget de projet voté : ${euros(projet.budget)}`;
    ws.getCell(y + 2, 1).font = h.police({ italic: true, color: h.ENCRE });
  }
  registre("Indicateurs", "Cibles engagées devant la direction (« officiel ») et cibles internes au plan (« opérationnel »).",
    ["Indicateur", "Type", "Cible", "Échéance", "Valeur mesurée", "Commentaire"], [40, 16, 30, 14, 16, 40],
    projet.kpis.map((k) => [k.indicateur, k.type === "operationnel" ? "Opérationnel" : "Officiel", ou(k.cible), jour(k.echeance), ou(k.valeur), ou(k.commentaire)]),
    "Aucun indicateur cible — le projet n'a alors pas de critère de réussite.");
  registre("Changements", "Toute demande qui modifie le périmètre, le budget ou une date de jalon passe ici avant d'entrer au plan.",
    ["Description", "Demandeur", "Chantier", "Impact", "Décideur", "Statut", "Décision", "Demandé le", "Décidé le"],
    [50, 16, 18, 11, 16, 14, 40, 13, 13],
    projet.changements.map((c) => [c.description, ou(c.demandeur), ou(c.chantier), IMPACTS[c.impact], ou(c.decideur), STATUTS_CR[c.statut], ou(c.decision), jour(c.dateDemande), jour(c.dateDecision)]),
    "Aucune demande de changement enregistrée.");
  registre("Fournisseurs", "Prestataires, montants, engagements de service et dates de renouvellement à ne pas manquer.",
    ["Fournisseur", "Prestation", "Chantier", "Budget", "Statut", "Signature", "Renouvellement", "Engagement de service", "Contact", "Notes"],
    [24, 34, 18, 14, 16, 13, 15, 30, 18, 30],
    projet.fournisseurs.map((f) => [f.nom, ou(f.prestation), ou(f.chantier), { value: f.budget || 0, numFmt: '# ##0 "€"' },
      ou(f.statut), jour(f.signature), jour(f.renouvellement), ou(f.sla), ou(f.contact), ou(f.notes)]),
    "Aucun fournisseur référencé.");

  return Buffer.from(await wb.xlsx.writeBuffer());
}

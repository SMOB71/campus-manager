// Le même document, en PDF — rendu, pas converti.
//
// Les générateurs Word appellent `briques(ch)` et empilent des éléments. Ce
// module offre EXACTEMENT la même surface, mais produit un PDF via pdfkit.
// Les documents ne sont donc pas traduits depuis le .docx : ils sont rendus une
// seconde fois depuis la même source. Un convertisseur perd toujours quelque
// chose — nos fonds de tableau, par exemple, disparaissaient et laissaient du
// texte blanc sur blanc.
//
// pdfkit plutôt qu'un navigateur sans interface : Chromium pèse 400 Mo dans
// l'image serveur, pdfkit en pèse 10 et ne dépend de rien d'installé sur la
// machine. Les polices standard PDF suffisent — Helvetica est métriquement
// compatible avec l'Arial de la charte.
import PDFDocument from "pdfkit";

const A4 = { largeur: 595.28, hauteur: 841.89 };

// Les polices standard du PDF encodent en WinAnsi, qui ne connait ni la fleche
// ni le signe moins typographique : « 02 octobre 2026 \u2192 01 septembre 2027 »
// sortait « 2026 !' 2027 ». Embarquer une police Unicode reglerait le cas, mais
// Arial n'est pas libre et le serveur Linux ne l'a pas. On convertit donc les
// quelques caracteres concernes vers leur equivalent WinAnsi : le sens est
// garde, le rendu aussi.
const HORS_WINANSI = { "\u2192": "\u203A", "\u2190": "\u2039", "\u2212": "-", "\u2588": "\u25A0",
                       "\u2713": "v", "\u2264": "<=", "\u2265": ">=", "\u00A0": " " };
const lisible = (t) => String(t ?? "").replace(/[\u2190\u2192\u2212\u2588\u2713\u2264\u2265\u00A0]/g,
  (c) => HORS_WINANSI[c] || c);
const gris = (h) => "#" + String(h || "3C4453").replace(/^#/, "");
// Les tailles du modèle Word sont en demi-points ; le PDF travaille en points.
const pt = (demi) => (demi || 20) / 2;

export function briquesPdf(ch, margeLat = 1000) {
  // La marge Word est en twips (1/20e de point) : on la convertit pour que les
  // deux rendus aient la même largeur utile, et donc les mêmes retours à la ligne.
  const marge = Math.max(28, margeLat / 20);
  const UTILE = A4.largeur - marge * 2;
  const pct = (n) => Math.round((UTILE * n) / 100);

  // Une pile d'ordres de dessin, exécutée à la fin : c'est ce qui permet aux
  // générateurs de construire leur document comme avec docx, sans savoir
  // qu'ils écrivent un PDF.
  const el = (type, o) => ({ __pdf: type, ...o });

  const P = (t, o = {}) => el("p", { texte: String(t ?? ""), ...o });
  const H1 = (t) => el("h", { texte: String(t ?? ""), taille: 20, couleur: ch.encre, avant: 0, apres: 8, gras: true });
  const H2 = (t) => el("h", { texte: String(t ?? ""), taille: 14, couleur: ch.accent, avant: 16, apres: 6, gras: true });
  const H3 = (t) => el("h", { texte: String(t ?? ""), taille: 11.5, couleur: ch.encre, avant: 11, apres: 5, gras: true });
  const FILET = () => el("filet", {});
  const PUCE = (t) => el("puce", { texte: String(t ?? "") });
  const SAUT = () => el("saut", {});

  const cell = (c, o = {}) => ({ contenu: Array.isArray(c) ? c : [c], ...o });
  const ligne = (cellules, o = {}) => ({ cellules, ...o });
  const tete = (labels, larg) => ligne(labels.map((t, i) => cell(P(t, { bold: true, color: "FFFFFF", size: 16, after: 0 }),
    { width: larg[i], fill: ch.encre })), { entete: true });
  const table = (rows, larg) => el("table", { rows, larg });
  const grille = (labels, larg, lignes, o = {}) => table([
    tete(labels, larg),
    ...lignes.map((ls, n) => ligne(ls.map((v, i) => cell(
      Array.isArray(v) ? v : P(v, { size: o.size ?? 17, after: 0, bold: i === 0 && o.premiereGras }),
      { width: larg[i], fill: n % 2 ? ch.clair : undefined })), { hauteur: o.hauteur })),
  ], larg);
  const fiche = (paires, l = 26) => table(paires.map(([k, v]) => ligne([
    cell(P(k, { bold: true, size: 17, color: "FFFFFF", after: 0 }), { width: l, fill: ch.encre }),
    cell(P(v, { size: 17, after: 0 }), { width: 100 - l, fill: ch.clair }),
  ])), [l, 100 - l]);
  const zone = (n, cols = 1) => table(
    Array.from({ length: n }, () => ligne(Array.from({ length: cols }, () => cell(P("", { after: 110 }), { width: Math.round(100 / cols) })))),
    Array.from({ length: cols }, () => Math.round(100 / cols)));
  // En Word, deux tableaux collés produisent un « contenu illisible ». En PDF
  // le problème n'existe pas, mais la fonction doit exister : les générateurs
  // l'appellent sans savoir quel moteur les rend.
  const separer = (items) => items;
  const bandeau = () => [];
  const titre = (t, sous) => [
    el("entete", { marque: ch.marque, baseline: ch.baseline }),
    el("h", { texte: String(t).toUpperCase(), taille: 22, couleur: ch.encre, avant: 6, apres: 4, gras: true }),
    ...(sous ? [P(sous, { size: 20, color: ch.accent, italics: true, bold: true, after: 200 })] : []),
  ];

  function rendre(nom, elements) {
    return new Promise((ok, ko) => {
      const doc = new PDFDocument({ size: "A4", margins: { top: marge, bottom: marge + 14, left: marge, right: marge }, autoFirstPage: true });
      doc.info.Title = nom;
      doc.info.Author = ch.emetteur;
      const morceaux = [];
      doc.on("data", (d) => morceaux.push(d));
      doc.on("end", () => ok(Buffer.concat(morceaux)));
      doc.on("error", ko);

      const bas = () => A4.hauteur - marge - 14;
      const place = (h) => { if (doc.y + h > bas()) doc.addPage(); };

      const ecrire = (p) => {
        const taille = pt(p.size ?? 20);
        doc.font(p.bold ? "Helvetica-Bold" : p.italics ? "Helvetica-Oblique" : "Helvetica")
           .fontSize(taille).fillColor(gris(p.color || ch.encre));
        return taille;
      };

      // Hauteur d'une cellule : on mesure AVANT de dessiner, sinon une ligne
      // qui déborde coupe le tableau en deux pages au milieu d'une cellule.
      const hauteurCellule = (c, largeur) => {
        let h = 4;
        for (const p of c.contenu) {
          if (!p || p.__pdf !== "p") continue;
          const taille = pt(p.size ?? 20);
          doc.font(p.bold ? "Helvetica-Bold" : "Helvetica").fontSize(taille);
          h += doc.heightOfString(lisible(p.texte) || " ", { width: largeur - 8 }) + (p.after ?? 60) / 40;
        }
        return Math.max(h + 4, 14);
      };

      const dessinerTable = (t) => {
        const cols = t.larg.map((w) => (UTILE * w) / 100);
        for (const r of t.rows) {
          const hauts = r.cellules.map((c, i) => hauteurCellule(c, cols[i]));
          let h = Math.max(...hauts, r.hauteur ? r.hauteur / 20 : 0);
          // Un entête ne reste jamais seul en bas de page.
          place(r.entete ? h + 24 : h);
          const y0 = doc.y;
          let x = marge;
          r.cellules.forEach((c, i) => {
            if (c.fill) doc.rect(x, y0, cols[i], h).fill("#" + String(c.fill).replace(/^#/, ""));
            doc.rect(x, y0, cols[i], h).lineWidth(0.4).stroke("#" + String(ch.bordure).replace(/^#/, ""));
            let y = y0 + 3;
            for (const p of c.contenu) {
              if (!p || p.__pdf !== "p") continue;
              const taille = ecrire(p);
              doc.text(lisible(p.texte) || " ", x + 4, y, { width: cols[i] - 8, align: p.align || "left" });
              y = doc.y + (p.after ?? 60) / 40;
              void taille;
            }
            x += cols[i];
          });
          doc.y = y0 + h;
          doc.x = marge;
        }
        doc.y += 6;
      };

      for (const e of elements.flat()) {
        if (!e) continue;
        if (e.__pdf === "saut") { doc.addPage(); continue; }
        if (e.__pdf === "entete") {
          doc.font("Helvetica-Bold").fontSize(11).fillColor(gris(ch.encre))
             .text(lisible(e.marque), marge, doc.y, { width: UTILE, align: "right" });
          doc.font("Helvetica-Bold").fontSize(5.5).fillColor(gris(ch.accent))
             .text(lisible(String(e.baseline || "").toUpperCase()), { width: UTILE, align: "right", characterSpacing: 1.6 });
          doc.y += 10; doc.x = marge;
          continue;
        }
        if (e.__pdf === "filet") {
          place(10);
          doc.moveTo(marge, doc.y).lineTo(marge + UTILE, doc.y).lineWidth(1).stroke("#" + String(ch.accent).replace(/^#/, ""));
          doc.y += 10; doc.x = marge;
          continue;
        }
        if (e.__pdf === "table") { dessinerTable(e); continue; }
        if (e.__pdf === "h") {
          doc.y += e.avant;
          doc.font("Helvetica-Bold").fontSize(e.taille).fillColor(gris(e.couleur));
          place(e.taille * 2);
          doc.text(lisible(e.texte), marge, doc.y, { width: UTILE });
          doc.y += e.apres; doc.x = marge;
          continue;
        }
        if (e.__pdf === "puce") {
          doc.font("Helvetica").fontSize(pt(20)).fillColor(gris(ch.encre));
          const h = doc.heightOfString(lisible(e.texte), { width: UTILE - 14 });
          place(h + 4);
          const y = doc.y;
          doc.text("•", marge, y, { width: 10 });
          doc.text(lisible(e.texte), marge + 14, y, { width: UTILE - 14 });
          doc.y += 3; doc.x = marge;
          continue;
        }
        if (e.__pdf === "p") {
          const taille = ecrire(e);
          const h = doc.heightOfString(lisible(e.texte) || " ", { width: UTILE });
          place(h + taille);
          doc.text(lisible(e.texte) || " ", marge, doc.y, { width: UTILE, align: e.align || "left" });
          doc.y += (e.after ?? 120) / 20; doc.x = marge;
        }
      }
      doc.end();
    });
  }

  return { UTILE, pct, P, H1, H2, H3, FILET, PUCE, SAUT, cell, ligne, table, tete, grille, fiche, zone,
           separer, bandeau, titre, rendre, document: () => null, PageBreak: null, AlignmentType: {} };
}

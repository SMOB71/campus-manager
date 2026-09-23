// Briques Word partagées par les générateurs du pack.
//
// Quatre pièges OOXML sont neutralisés ici, une fois pour toutes — ils ont tous
// été payés en documents que Word déclarait illisibles ou en tableaux écrasés :
//   1. deux <w:tbl> consécutifs           → Word « contenu illisible »  (separer)
//   2. largeur en pourcentage sur tblW/tcW → refusée                    (twips)
//   3. bordure w:sz < 2                    → ignorée                    (0,5 pt mini)
//   4. absence de <w:tblGrid>              → colonnes écrasées hors de Word (largeurs)
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, ImageRun, Footer, PageNumber, PageBreak, HeightRule } from "docx";

// Espace insécable : une cellule vraiment vide se replie à un caractère dans les
// moteurs qui ne sont pas Word, et le tableau paraît cassé.
export const VIDE = " ";

export function briques(ch, margeLat = 1000) {
  const UTILE = 11906 - margeLat * 2;
  const pct = (n) => Math.round((UTILE * n) / 100);
  const BORD = { style: BorderStyle.SINGLE, size: 4, color: ch.bordure };

  const P = (t, o = {}) => new Paragraph({
    spacing: { before: o.before ?? 0, after: o.after ?? 100 }, alignment: o.align,
    children: [new TextRun({ text: t === "" || t == null ? VIDE : String(t), size: o.size ?? 19,
      color: o.color, bold: o.bold, italics: o.italics, font: ch.police })],
  });
  const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: String(t).toUpperCase(), bold: true, size: 30, color: ch.encre, font: ch.police })] });
  const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 110 },
    children: [new TextRun({ text: t, bold: true, size: 23, color: ch.accent, font: ch.police })] });
  const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 90 },
    children: [new TextRun({ text: t, bold: true, size: 20, color: ch.encre, font: ch.police })] });
  const FILET = () => new Paragraph({ spacing: { before: 0, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: ch.accent } }, children: [] });
  const PUCE = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 70 },
    children: [new TextRun({ text: t, size: 19, color: ch.encre, font: ch.police })] });

  const cell = (c, o = {}) => new TableCell({
    children: Array.isArray(c) ? c : [c],
    width: o.width ? { size: pct(o.width), type: WidthType.DXA } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined,
    columnSpan: o.span,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
  });
  const table = (rows, larg) => new Table({
    ...(larg ? { columnWidths: larg.map(pct) } : {}),
    width: { size: UTILE, type: WidthType.DXA },
    borders: { top: BORD, bottom: BORD, left: BORD, right: BORD, insideHorizontal: BORD, insideVertical: BORD },
    rows,
  });
  const tete = (labels, larg) => new TableRow({ tableHeader: true,
    children: labels.map((l, i) => cell(P(l, { bold: true, color: "FFFFFF", size: 16, after: 0 }), { width: larg[i], fill: ch.encre })) });
  // Tableau complet : en-tête + lignes de texte, zébré. Le cas courant.
  // `hauteur` (en twips) force une hauteur MINIMALE de ligne : c'est ce qui
  // rend une grille vide remplissable à la main. Sans elle, une ligne sans
  // texte se réduit à un filet et le document imprimé n'offre pas de quoi
  // écrire.
  const grille = (labels, larg, lignes, o = {}) => table([
    tete(labels, larg),
    ...lignes.map((ls, n) => new TableRow({
      ...(o.hauteur ? { height: { value: o.hauteur, rule: HeightRule.ATLEAST } } : {}),
      children: ls.map((v, i) => cell(
        Array.isArray(v) ? v : P(v, { size: o.size ?? 17, after: 0, bold: i === 0 && o.premiereGras }),
        { width: larg[i], fill: n % 2 ? ch.clair : undefined })) })),
  ], larg);
  // Fiche clé/valeur sur deux colonnes.
  const fiche = (paires, l = 26) => table(paires.map(([k, v]) => new TableRow({ children: [
    cell(P(k, { bold: true, size: 17, color: "FFFFFF", after: 0 }), { width: l, fill: ch.encre }),
    cell(P(v, { size: 17, after: 0 }), { width: 100 - l, fill: ch.clair }),
  ] })), [l, 100 - l]);
  // Lignes vides encadrées, pour écrire à la main.
  const zone = (n, cols = 1) => table(
    Array.from({ length: n }, () => new TableRow({
      children: Array.from({ length: cols }, () => cell(P("", { after: 110 }), { width: Math.round(100 / cols) })) })),
    Array.from({ length: cols }, () => Math.round(100 / cols)));

  const separer = (items) => {
    const out = [];
    for (const it of items.filter(Boolean)) {
      if (out.length && out[out.length - 1] instanceof Table && it instanceof Table) out.push(new Paragraph({ children: [] }));
      out.push(it);
    }
    return out;
  };
  const bandeau = () => [
    ...(ch.logo ? [new Paragraph({ spacing: { after: 240 }, alignment: AlignmentType.RIGHT,
      children: [new ImageRun({ data: Buffer.from(ch.logo, "base64"), transformation: { width: 190, height: 59 } })] })] : []),
    new Paragraph({ spacing: { after: 0 }, alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: ch.marque, bold: true, size: 24, color: ch.encre, font: ch.police })] }),
    new Paragraph({ spacing: { after: 300 }, alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: ch.baseline, bold: true, size: 12, color: ch.accent, characterSpacing: 60, font: ch.police })] }),
  ];
  const pied = () => new Footer({ children: [new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: ch.bordure } },
    spacing: { before: 120 },
    children: [
      new TextRun({ text: `${ch.marque} – ${ch.emetteur} | ${ch.mention}`, italics: true, size: 15, color: ch.gris, font: ch.police }),
      new TextRun({ text: "\t\tPage ", size: 15, color: ch.gris, font: ch.police }),
      new TextRun({ children: [PageNumber.CURRENT], size: 15, color: ch.gris, font: ch.police }),
      new TextRun({ text: "/", size: 15, color: ch.gris, font: ch.police }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: ch.gris, font: ch.police }),
    ] })] });

  const titre = (t, sous) => [
    ...bandeau(),
    new Paragraph({ spacing: { before: 200, after: 0 },
      children: [new TextRun({ text: String(t).toUpperCase(), bold: true, size: 44, color: ch.encre, font: ch.police })] }),
    ...(sous ? [new Paragraph({ spacing: { before: 100, after: 160 },
      children: [new TextRun({ text: sous, bold: true, italics: true, size: 24, color: ch.accent, font: ch.police })] })] : []),
    FILET(),
  ];

  const document = (nom, elements) => new Document({
    creator: ch.emetteur, title: nom, description: `${ch.marque} — ${ch.mention}`,
    styles: { default: { document: { run: { font: ch.police, size: 19, color: ch.encre } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: margeLat, right: margeLat } } },
      footers: { default: pied() },
      children: separer(elements),
    }],
  });
  const rendre = async (nom, elements) => Packer.toBuffer(document(nom, elements));

  return { UTILE, pct, P, H1, H2, H3, FILET, PUCE, cell, table, tete, grille, fiche, zone,
           separer, bandeau, titre, document, rendre, PageBreak, AlignmentType };
}

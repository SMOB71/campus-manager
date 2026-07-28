// Export d'un livrable : Markdown brut, HTML imprimable (PDF), ou Word (.docx).
// Système documentaire « Campus Manager » — identité teal/corail, typo éditoriale.
import { marked } from "marked";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, Footer, PageNumber, TableLayoutType } from "docx";

// retire le bloc ```json kpis``` technique avant export
function stripKpis(md) {
  return md.replace(/```json[\s\S]*?```/g, "").trim();
}

const TASK_EYEBROW = {
  pnl: "Compte d'exploitation",
  compte_rendu: "Compte rendu",
  ordre_du_jour: "Ordre du jour",
  note_cadrage: "Note de cadrage",
  synthese_reseau: "Synthèse réseau",
};

export function toMarkdown(deliverable) {
  return `# ${deliverable.title}\n\n_${deliverable.campusName || ""} — ${deliverable.createdAt}_\n\n${stripKpis(deliverable.content)}`;
}

function frLong(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

// SVG du logo « quad » (auto-porté, pour la sortie écran/PDF).
const QUAD_SVG = `<svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="26" height="26" rx="7" fill="#0D1B2A"/>
  <rect x="36" y="2" width="26" height="26" rx="7" fill="#0B6E5F"/>
  <rect x="2" y="36" width="26" height="26" rx="7" fill="#0B6E5F"/>
  <circle cx="49" cy="49" r="13" fill="#FF6A4D"/>
</svg>`;

// ---- Sortie PDF / impression (CSS navigateur complet) ----
function printHtml(deliverable) {
  const body = marked.parse(stripKpis(deliverable.content));
  const eyebrow = TASK_EYEBROW[deliverable.task] || "Document de pilotage";
  const meta = [deliverable.campusName, frLong(deliverable.createdAt)].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${deliverable.title}</title>
<style>
  :root{
    --ink:#0D1B2A; --teal:#0B6E5F; --teal-soft:#EAF3EF; --sand:#E2DACD;
    --muted:#5A6672; --coral:#FF6A4D; --danger:#C94B33; --paper:#FBF9F5;
  }
  *{box-sizing:border-box}
  html{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
  body{
    font-family:"Iowan Old Style",Georgia,"Times New Roman",serif;
    color:var(--ink); background:var(--paper); margin:0;
    font-size:15px; line-height:1.6;
  }
  .sheet{max-width:820px; margin:0 auto; background:#fff; padding:44px 56px 64px;
    box-shadow:0 1px 40px rgba(13,27,42,.08); min-height:100vh;}
  /* Bouton d'impression — écran uniquement */
  .toolbar{position:sticky; top:0; z-index:5; display:flex; justify-content:flex-end;
    gap:8px; max-width:820px; margin:0 auto 12px; padding-top:18px;}
  .toolbar button{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    background:var(--teal); color:#fff; border:none; padding:10px 18px; border-radius:10px;
    font-weight:600; font-size:14px; cursor:pointer; box-shadow:0 2px 10px rgba(11,110,95,.28);}
  .toolbar button:hover{background:#095648}
  /* Lettre à en-tête */
  .letterhead{display:flex; align-items:center; justify-content:space-between; gap:16px;}
  .brand{display:flex; align-items:center; gap:12px;}
  .brand .wm{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.15;}
  .brand .wm b{display:block; font-size:15px; font-weight:800; letter-spacing:.2px; color:var(--ink);}
  .brand .wm span{display:block; font-size:10.5px; letter-spacing:2.5px; text-transform:uppercase; color:var(--teal); font-weight:600;}
  .doctype{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; font-size:10.5px;
    letter-spacing:2px; text-transform:uppercase; color:var(--muted); text-align:right;}
  .rule{height:2px; background:linear-gradient(90deg,var(--teal) 0 64px,var(--sand) 64px); margin:18px 0 26px; border:0;}
  /* Titre du document */
  .eyebrow{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; display:inline-flex; align-items:center;
    gap:8px; font-size:11px; letter-spacing:2.5px; text-transform:uppercase; color:var(--teal); font-weight:700; margin:0 0 10px;}
  .eyebrow::before{content:""; width:22px; height:3px; background:var(--coral); border-radius:2px; display:inline-block;}
  h1.title{font-size:30px; line-height:1.15; margin:0 0 8px; color:var(--ink); font-weight:700; text-wrap:balance;}
  .meta{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--muted); font-size:13px; margin:0 0 8px;}
  .doc-body{margin-top:28px;}
  /* Contenu (markdown rendu) */
  .doc-body h1{font-size:22px; color:var(--teal); margin:26px 0 10px; padding-bottom:4px; border-bottom:2px solid var(--sand);}
  .doc-body h2{font-size:18px; color:var(--teal); margin:26px 0 10px; padding-bottom:5px; border-bottom:2px solid var(--sand);
    display:flex; align-items:baseline; gap:9px;}
  .doc-body h2::before{content:""; width:10px; height:10px; background:var(--coral); border-radius:2px; flex:0 0 auto; transform:translateY(1px);}
  .doc-body h3{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; font-size:14px; letter-spacing:.3px;
    color:var(--ink); margin:18px 0 6px; font-weight:700;}
  .doc-body p{margin:9px 0;}
  .doc-body ul,.doc-body ol{margin:9px 0 9px 4px; padding-left:22px;}
  .doc-body li{margin:5px 0;}
  .doc-body li::marker{color:var(--teal);}
  .doc-body strong{color:var(--ink); font-weight:700;}
  .doc-body a{color:var(--teal);}
  .doc-body blockquote{margin:14px 0; padding:12px 18px; background:var(--teal-soft);
    border-left:4px solid var(--teal); border-radius:0 8px 8px 0; color:#12332c;
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; font-size:14px;}
  .doc-body blockquote p{margin:4px 0;}
  .doc-body hr{border:0; border-top:1px solid var(--sand); margin:22px 0;}
  /* Tableaux — famille sans, chiffres tabulaires */
  .doc-body table{width:100%; border-collapse:collapse; margin:16px 0; font-size:13px;
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; font-variant-numeric:tabular-nums;
    border:1px solid var(--sand); border-radius:8px; overflow:hidden;}
  .doc-body thead th{background:var(--teal); color:#fff; font-weight:600; text-align:left;
    padding:9px 12px; font-size:12px; letter-spacing:.3px;}
  .doc-body tbody td{padding:8px 12px; border-top:1px solid var(--sand); vertical-align:top;}
  .doc-body tbody tr:nth-child(even){background:#F7FAF9;}
  .doc-body td[align="right"],.doc-body th[align="right"]{text-align:right;}
  .doc-body td[align="center"],.doc-body th[align="center"]{text-align:center;}
  /* Pied de page */
  .footer{margin-top:40px; padding-top:14px; border-top:1px solid var(--sand);
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--muted); font-size:11px;
    display:flex; justify-content:space-between; gap:12px;}
  @page{margin:16mm 14mm 18mm;}
  @media print{
    body{background:#fff;}
    .toolbar{display:none;}
    .sheet{box-shadow:none; max-width:none; margin:0; padding:0; min-height:0;}
    .doc-body h1,.doc-body h2,.doc-body h3{break-after:avoid;}
    .doc-body table,.doc-body blockquote,.doc-body li{break-inside:avoid;}
  }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="sheet">
    <div class="letterhead">
      <div class="brand">${QUAD_SVG}<div class="wm"><b>Campus Manager</b><span>Pilotage réseau</span></div></div>
      <div class="doctype">${eyebrow}</div>
    </div>
    <hr class="rule">
    <div class="eyebrow">${eyebrow}</div>
    <h1 class="title">${deliverable.title}</h1>
    ${meta ? `<div class="meta">${meta}</div>` : ""}
    <div class="doc-body">${body}</div>
    <div class="footer"><span>Campus Manager — document confidentiel</span><span>Généré le ${frLong(deliverable.createdAt)}</span></div>
  </div>
</body></html>`;
}

// ---- Sortie Word (.docx) — construite avec docx.js (OOXML propre, ouvrable dans Word) ----
// Tailles docx = demi-points (16 pt → 32). Couleurs = hex sans #.
const WC = { ink: "0D1B2A", teal: "0B6E5F", tealSoft: "EAF3EF", sand: "E2DACD", muted: "5A6672", white: "FFFFFF", bandSub: "BFE3DA", quote: "12332C" };
const alignOf = (a) => (a === "right" ? AlignmentType.RIGHT : a === "center" ? AlignmentType.CENTER : AlignmentType.LEFT);
const cellTokens = (c) => (c && c.tokens ? c.tokens : [{ type: "text", text: typeof c === "string" ? c : (c && c.text) || "" }]);

// tokens inline marked → TextRun[]
function inlineRuns(tokens, opts = {}) {
  const out = [];
  for (const t of tokens || []) {
    if (t.type === "strong") out.push(...inlineRuns(t.tokens, { ...opts, bold: true, color: WC.ink }));
    else if (t.type === "em") out.push(...inlineRuns(t.tokens, { ...opts, italics: true }));
    else if (t.type === "codespan") out.push(new TextRun({ text: t.text, font: "Consolas", ...opts }));
    else if (t.type === "link") out.push(...inlineRuns(t.tokens, { ...opts, color: WC.teal }));
    else if (t.type === "br") out.push(new TextRun({ break: 1 }));
    else out.push(new TextRun({ text: t.text ?? "", ...opts }));
  }
  return out.length ? out : [new TextRun({ text: "", ...opts })];
}
// puce : concatène les tokens inline des blocs de l'item
function listInline(item) {
  const inl = [];
  for (const b of item.tokens || []) { if (b.tokens) inl.push(...b.tokens); else if (b.text) inl.push({ type: "text", text: b.text }); }
  return inl;
}
function tableBorders() {
  const s = { style: BorderStyle.SINGLE, size: 4, color: WC.sand };
  return { top: s, bottom: s, left: s, right: s, insideHorizontal: s, insideVertical: s };
}
// token bloc marked → éléments docx (Paragraph | Table)
function blockToDocx(tok) {
  if (tok.type === "heading") {
    const sz = { 1: 32, 2: 27, 3: 23 }[tok.depth] || 23;
    return [new Paragraph({ spacing: { before: 240, after: 80 }, border: tok.depth <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: WC.sand, space: 2 } } : undefined, children: inlineRuns(tok.tokens, { bold: true, color: tok.depth === 3 ? WC.ink : WC.teal, font: "Georgia", size: sz }) })];
  }
  if (tok.type === "paragraph") return [new Paragraph({ spacing: { after: 120 }, children: inlineRuns(tok.tokens, { color: WC.ink, size: 22 }) })];
  if (tok.type === "list") return tok.items.map((it) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inlineRuns(listInline(it), { color: WC.ink, size: 22 }) }));
  if (tok.type === "blockquote") return (tok.tokens || []).map((b) => new Paragraph({ shading: { type: ShadingType.CLEAR, fill: WC.tealSoft }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: WC.teal, space: 8 } }, spacing: { before: 80, after: 80 }, children: inlineRuns(b.tokens, { color: WC.quote, size: 21 }) }));
  if (tok.type === "hr") return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: WC.sand } }, spacing: { after: 120 } })];
  if (tok.type === "table") {
    const m = { top: 60, bottom: 60, left: 120, right: 120 };
    const n = tok.header.length || 1;
    // Largeurs de colonnes explicites (twips) — sinon Word écrase les colonnes à 1 caractère.
    // Largeur utile A4 ≈ 9638 twips (marges 1021 g/d). 1re colonne (libellés) plus large.
    const usable = 9638;
    const first = n > 1 ? Math.round(usable * 0.42) : usable;
    const rest = n > 1 ? Math.round((usable - first) / (n - 1)) : 0;
    const colW = Array.from({ length: n }, (_, i) => (i === 0 ? first : rest));
    const cell = (c, i, hdr) => new TableCell({
      width: { size: colW[i], type: WidthType.DXA }, margins: m,
      shading: hdr ? { type: ShadingType.CLEAR, fill: WC.teal } : undefined,
      children: [new Paragraph({ alignment: alignOf(tok.align[i]), children: inlineRuns(cellTokens(c), hdr ? { bold: true, color: WC.white, size: 19 } : { color: WC.ink, size: 21 }) })],
    });
    const header = new TableRow({ tableHeader: true, children: tok.header.map((c, i) => cell(c, i, true)) });
    const rows = tok.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }));
    return [new Table({ width: { size: usable, type: WidthType.DXA }, columnWidths: colW, layout: TableLayoutType.FIXED, borders: tableBorders(), rows: [header, ...rows] })];
  }
  if (tok.type === "space") return [];
  return tok.text ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: tok.text, size: 22, color: WC.ink })] })] : [];
}

export function toHtml(deliverable) {
  return printHtml(deliverable);
}

export async function toDocx(deliverable) {
  const eyebrow = (TASK_EYEBROW[deliverable.task] || "Document de pilotage").toUpperCase();
  const meta = [deliverable.campusName, frLong(deliverable.createdAt)].filter(Boolean).join(" · ");
  const bodyEls = marked.lexer(stripKpis(deliverable.content)).flatMap(blockToDocx);
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const bandBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
  const head = [
    // Bandeau teal pleine largeur — cellule de tableau (fond fiable dans Word ET Quick Look)
    new Table({ width: { size: 9638, type: WidthType.DXA }, columnWidths: [9638], layout: TableLayoutType.FIXED, borders: bandBorders, rows: [
      new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: WC.teal }, margins: { top: 120, bottom: 120, left: 160, right: 160 }, borders: bandBorders, children: [new Paragraph({ children: [
        new TextRun({ text: "Campus Manager", bold: true, color: WC.white, size: 27 }),
        new TextRun({ text: "    ·    PILOTAGE RÉSEAU", color: WC.bandSub, size: 16 }),
      ] })] })] }),
    ] }),
    new Paragraph({ spacing: { before: 320, after: 20 }, children: [new TextRun({ text: eyebrow, bold: true, color: WC.teal, size: 17 })] }),
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: deliverable.title, bold: true, color: WC.ink, font: "Georgia", size: 42 })] }),
    ...(meta ? [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: meta, color: WC.muted, size: 19 })] })] : []),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: WC.teal } }, spacing: { after: 200 } }),
  ];
  const footer = new Footer({ children: [new Paragraph({ children: [
    new TextRun({ text: `Campus Manager — document confidentiel · Généré le ${frLong(deliverable.createdAt)} · p. `, color: WC.muted, size: 16 }),
    new TextRun({ children: [PageNumber.CURRENT], color: WC.muted, size: 16 }),
  ] })] });
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: WC.ink } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1021, right: 1021 } } },
      footers: { default: footer },
      children: [...head, ...bodyEls],
    }],
  });
  return await Packer.toBuffer(doc);
}

// Export d'un livrable : Markdown brut, HTML imprimable (PDF), ou Word (.docx).
// Système documentaire « Campus Manager » — identité teal/corail, typo éditoriale.
import { marked } from "marked";
import HTMLtoDOCX from "html-to-docx";

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

// ---- Sortie Word (.docx) ----
// IMPORTANT : html-to-docx (1.8) IGNORE le bloc <style> — seuls les styles INLINE sont
// rendus (couleurs, fonds, tailles, bordures). On injecte donc le style sur chaque balise.
const WORD_STYLE = {
  h1: "font-family:Georgia,serif;font-size:16pt;color:#0B6E5F;font-weight:bold;margin:16pt 0 6pt;",
  h2: "font-family:Georgia,serif;font-size:13.5pt;color:#0B6E5F;font-weight:bold;margin:15pt 0 5pt;",
  h3: "font-family:Georgia,serif;font-size:11.5pt;color:#0D1B2A;font-weight:bold;margin:11pt 0 3pt;",
  p: "font-size:11pt;color:#0D1B2A;margin:5pt 0;",
  li: "font-size:11pt;color:#0D1B2A;margin:2pt 0;",
  table: "border-collapse:collapse;width:100%;margin:9pt 0;",
  th: "background-color:#0B6E5F;color:#FFFFFF;font-weight:bold;border:0.75pt solid #0B6E5F;padding:6pt 9pt;font-size:10pt;",
  td: "border:0.75pt solid #C7CDD4;padding:5pt 9pt;font-size:10.5pt;color:#0D1B2A;",
  blockquote: "background-color:#EAF3EF;color:#12332C;border-left:3pt solid #0B6E5F;padding:7pt 12pt;margin:9pt 0;font-size:10.5pt;",
  strong: "color:#0D1B2A;font-weight:bold;",
  a: "color:#0B6E5F;",
  hr: "border:none;border-top:1pt solid #E2DACD;",
};
// Injecte le style inline dans chaque balise ouvrante générée par marked (en préservant href…).
// html-to-docx ignore l'attribut `align` → on le convertit en `text-align` inline (colonnes de chiffres).
function inlineStyleWord(html) {
  return html.replace(
    /<(h1|h2|h3|p|li|table|th|td|blockquote|strong|a|hr)((?:\s[^>]*)?)>/g,
    (m, tag, attrs) => {
      const align = (attrs.match(/align="(left|right|center)"/) || [])[1];
      const style = (WORD_STYLE[tag] || "") + (align ? `text-align:${align};` : "");
      return `<${tag}${attrs} style="${style}">`;
    },
  );
}

function wordHtml(deliverable) {
  const body = inlineStyleWord(marked.parse(stripKpis(deliverable.content)));
  const eyebrow = TASK_EYEBROW[deliverable.task] || "Document de pilotage";
  const meta = [deliverable.campusName, frLong(deliverable.createdAt)].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${deliverable.title}</title></head>
<body style="font-family:Calibri,Arial,sans-serif;color:#0D1B2A;">
  <p style="background-color:#0B6E5F;padding:12pt 14pt;margin:0;">
    <span style="color:#FFFFFF;font-size:13.5pt;font-weight:bold;">Campus Manager</span>
    <span style="color:#BFE3DA;font-size:8pt;">&nbsp;&nbsp;·&nbsp;&nbsp;PILOTAGE RÉSEAU</span>
  </p>
  <p style="color:#0B6E5F;font-size:8.5pt;font-weight:bold;margin:18pt 0 1pt;">${eyebrow.toUpperCase()}</p>
  <p style="font-family:Georgia,serif;font-size:21pt;color:#0D1B2A;font-weight:bold;margin:0 0 3pt;">${deliverable.title}</p>
  ${meta ? `<p style="color:#5A6672;font-size:9.5pt;margin:0 0 4pt;">${meta}</p>` : ""}
  <hr style="border:none;border-top:1.5pt solid #0B6E5F;margin:2pt 0 12pt;">
  ${body}
</body></html>`;
}

export function toHtml(deliverable) {
  return printHtml(deliverable);
}

export async function toDocx(deliverable) {
  const html = wordHtml(deliverable);
  const footer = `<p style="color:#5A6672;font-size:8pt;">Campus Manager — document confidentiel · Généré le ${frLong(deliverable.createdAt)} · p. </p>`;
  return await HTMLtoDOCX(html, null, {
    margins: { top: 1134, right: 1021, bottom: 1134, left: 1021 }, // ~2 cm / 1,8 cm
    font: "Calibri",
    fontSize: 22, // 11 pt (demi-points)
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  }, footer);
}

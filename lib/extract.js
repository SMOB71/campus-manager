// Extraction de texte depuis un fichier uploade (Excel, CSV, PDF, texte).
import * as XLSX from "xlsx";
import zlib from "zlib";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Lecture d'une entrée d'archive ZIP par le répertoire central. Un .docx est un
// zip : sans cela, une note de cadrage déposée en Word ressortait en binaire
// illisible — et c'est le format dans lequel ces notes existent réellement.
// On passe par le répertoire central plutôt que par les en-têtes locaux, parce
// que ces derniers portent parfois une taille nulle (descripteur différé) et
// qu'on lirait alors un fichier vide sans le savoir.
function lireEntreeZip(buf, nom) {
  const FIN = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === FIN) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("archive illisible");
  const nb = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < nb; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(p + 10);
    const taille = buf.readUInt32LE(p + 20);
    const nomLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nomEntree = buf.toString("utf8", p + 46, p + 46 + nomLen);
    if (nomEntree === nom) {
      const lnomLen = buf.readUInt16LE(local + 26);
      const lextraLen = buf.readUInt16LE(local + 28);
      const debut = local + 30 + lnomLen + lextraLen;
      const brut = buf.subarray(debut, debut + taille);
      return methode === 0 ? brut : zlib.inflateRawSync(brut);
    }
    p += 46 + nomLen + extraLen + commLen;
  }
  throw new Error(`entrée ${nom} absente de l'archive`);
}

// Le XML Word vers du texte lisible. On conserve les paragraphes et les puces :
// c'est sur eux que l'analyse de la note de cadrage s'appuie pour distinguer un
// titre d'une liste.
function docxVersTexte(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(buffer, filename = "") {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "docx") {
    const xml = lireEntreeZip(buffer, "word/document.xml").toString("utf8");
    // Le style Word ne traverse pas : un titre mis en forme redevient une ligne
    // de texte. L'analyse reconnaît d'autres marqueurs (numérotation, « Label : »,
    // capitales), et un titre perdu vaut mieux qu'un contenu inventé.
    return docxVersTexte(xml);
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const parts = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      // rendu tabule, lisible par le modele
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: " | ", blankrows: false });
      if (csv.trim()) parts.push(`# Feuille : ${name}\n${csv}`);
    }
    return parts.join("\n\n");
  }

  if (ext === "pdf") {
    // pdf-parse charge en lazy (evite l'auto-test au require)
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return (data.text || "").trim();
  }

  // texte brut / markdown / autre
  return buffer.toString("utf8");
}

// Extraction de texte depuis un fichier uploade (Excel, CSV, PDF, texte).
import * as XLSX from "xlsx";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

export async function extractText(buffer, filename = "") {
  const ext = (filename.split(".").pop() || "").toLowerCase();

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

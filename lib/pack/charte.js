// Charte du pack documentaire.
//
// Les documents sortent au nom du RÉSEAU, pas au nom de l'outil : un COMEX ne
// reçoit pas une note de cadrage signée « Campus Manager ». Les jetons sont donc
// lus dans les paramètres, avec un repli sur la charte par défaut. Un logo
// déposé par le réseau (PNG) est utilisé s'il existe ; sinon le bandeau est
// typographique, ce qui reste net à l'impression et ne casse jamais.
export const CHARTE_DEFAUT = {
  marque: "Healthcademia",
  baseline: "PATHWAYS TO YOUR FUTURE",
  emetteur: "Direction des Opérations",
  mention: "Document interne",
  encre: "141C34",      // texte principal
  accent: "A01A40",     // titres de section, chiffres qui comptent
  fond: "1C3196",       // aplats de couverture
  clair: "EDF0F6",      // aplats de tableau
  bordure: "C9D0DA",
  gris: "3C4453",
  police: "Arial",
};

export function charte(settings = {}) {
  const c = settings?.pack || {};
  const out = { ...CHARTE_DEFAUT };
  for (const k of Object.keys(CHARTE_DEFAUT)) if (c[k]) out[k] = String(c[k]);
  // Les couleurs se saisissent avec ou sans dièse : on normalise une fois ici
  // plutôt que de s'en souvenir dans chaque générateur.
  for (const k of ["encre", "accent", "fond", "clair", "bordure", "gris"]) {
    out[k] = String(out[k]).replace(/^#/, "").toUpperCase().slice(0, 6);
  }
  out.logo = c.logo || null;              // data: base64 PNG, optionnel
  return out;
}

// Format français des dates : un document daté « 2027-03-04 » n'a pas été relu.
export const jourFR = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};
export const courtFR = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
};
export const euros = (n) => (Number(n) || 0).toLocaleString("fr-FR") + " €";
// Nom de fichier sûr : accents retirés, espaces et ponctuation réduits.
export const nomFichier = (s) =>
  String(s || "document").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

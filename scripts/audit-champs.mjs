// Chasse au défaut récurrent : un champ LU par un module et ÉCRIT nulle part.
//
// Ce défaut ne lève aucune erreur. Il produit un silence — et un silence dans
// un tableau de contrôle se lit « tout va bien ». Rencontré quatre fois en une
// semaine : matricule/regle, foad, referentHandicap, valideJusquau.
//
// Méthode : on relève tout ce que le store ÉCRIT réellement (normaliseurs et
// listes blanches), puis tout ce que les modules purs LISENT sur leurs objets
// de domaine, et on affiche la différence. Ce n'est pas une preuve — beaucoup
// de lectures portent sur des objets construits en mémoire — mais c'est une
// liste de candidats bien plus courte que le code entier.

import fs from "node:fs";
import path from "node:path";

const RACINE = process.argv[2];
// Le store principal n'est pas le seul a ecrire : les seances, les feuilles
// d'emargement et les comptes ont le leur. Les ignorer faisait ressortir
// `start`, `end` ou `minutesLate` comme jamais ecrits.
const store = ["store.js", "sessionstore.js", "attendancestore.js", "userstore.js", "authstore.js"]
  .map((f) => { try { return fs.readFileSync(path.join(RACINE, "lib", f), "utf8"); } catch { return ""; } })
  .join("\n");

// --- Ce que le store écrit ---------------------------------------------------
const ecrits = new Set();

// 1. Les clefs des littéraux d'objet dans les normaliseurs et les add*.
for (const m of store.matchAll(/^\s{2,6}([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)) ecrits.add(m[1]);
// 2. Les listes blanches en ligne : for (const f of ["a", "b"])
for (const m of store.matchAll(/for \(const f of \[([^\]]+)\]/g)) {
  for (const c of m[1].matchAll(/"([a-zA-Z0-9_]+)"/g)) ecrits.add(c[1]);
}
// 2 bis. Les listes blanches NOMMÉES : const CAMPUS_FIELDS = [...]. Sans cette
// résolution, tous les champs d'identité du campus ressortaient en faux positif.
for (const m of store.matchAll(/const\s+[A-Z_]+\s*=\s*\[([^\]]+)\]/g)) {
  for (const c of m[1].matchAll(/"([a-zA-Z0-9_]+)"/g)) ecrits.add(c[1]);
}
// 3. Les affectations directes : x.champ = …
for (const m of store.matchAll(/\b[a-z]\.([a-zA-Z][a-zA-Z0-9_]*)\s*=/g)) ecrits.add(m[1]);
// 4. Les tests d'appartenance : if ("champ" in patch)
for (const m of store.matchAll(/"([a-zA-Z0-9_]+)"\s+in\s+patch/g)) ecrits.add(m[1]);

// --- Ce que les modules lisent -----------------------------------------------
// On ne regarde que les modules de DOMAINE : ceux qui reçoivent des objets du
// store. Les modules techniques (crypto, db, persistance) n'en consomment pas.
const TECHNIQUES = new Set(["db.js", "persistance.js", "crypto-store.js", "store.js",
  "sessionstore.js", "attendancestore.js", "userstore.js", "authstore.js", "auth.js",
  "mailbox.js", "prompts.js", "export.js", "extract.js", "salesforce.js", "si.js",
  "stripe.js", "provisioning.js", "apikeys.js", "portal.js", "backup.js", "chain.js",
  "retention.js", "publicapi.js", "agenda.js", "alerts.js", "brief.js", "validators.js"]);

// Les variables qui désignent clairement un objet de domaine venu du store.
const PORTEURS = /\b(campus|qualiopi|teacher|intervenant|learner|apprenant|contrat|contract|offre|devis|acte|enquete|dossier|etape|seance|session|classe|cur|curriculum|habilitation|reglement|sheet|feuille|ressource|mobilite|o|c|t|d|e|r|s)\b/;

const candidats = new Map();
for (const f of fs.readdirSync(path.join(RACINE, "lib"))) {
  if (!f.endsWith(".js") || TECHNIQUES.has(f)) continue;
  const src = fs.readFileSync(path.join(RACINE, "lib", f), "utf8");
  // On retire commentaires et chaînes : un mot dans un message d'erreur n'est
  // pas une lecture de champ.
  const net = src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");

  for (const m of net.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\??\.([a-zA-Z][a-zA-Z0-9_]*)\b/g)) {
    const [, porteur, champ] = m;
    if (!PORTEURS.test(porteur)) continue;
    if (ecrits.has(champ)) continue;
    // Méthodes et propriétés du langage : ce ne sont pas des champs métier.
    if (/^(map|filter|find|reduce|length|push|slice|some|every|includes|join|sort|split|trim|toString|toISOString|getTime|concat|forEach|flatMap|indexOf|replace|match|test|keys|values|entries|has|get|set|add|toLowerCase|toUpperCase|padStart|startsWith|endsWith|repeat|toFixed|localeCompare|setMonth|getMonth|setDate|getDate|getUTCDay|setUTCDate|toLocaleDateString|flat|from|now|max|min|round|ceil|floor|abs|isArray|assign|fromEntries|charAt|substring|exec|reverse|findIndex|at|pop|shift|unshift|splice)$/.test(champ)) continue;
    if (!candidats.has(champ)) candidats.set(champ, new Set());
    candidats.get(champ).add(f);
  }
}

// --- Restitution --------------------------------------------------------------
const tries = [...candidats.entries()]
  .filter(([, fichiers]) => fichiers.size >= 1)
  .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));

console.log(`${ecrits.size} champs écrits par le store · ${tries.length} candidats lus sans être écrits\n`);
console.log("Les plus suspects — lus par PLUSIEURS modules (comme valideJusquau) :\n");
for (const [champ, fichiers] of tries.filter(([, f]) => f.size > 1)) {
  console.log(`  ${champ.padEnd(26)} ${[...fichiers].join(", ")}`);
}
console.log("\nLus par un seul module :\n");
const seuls = tries.filter(([, f]) => f.size === 1);
for (const [champ, fichiers] of seuls) console.log(`  ${champ.padEnd(26)} ${[...fichiers][0]}`);

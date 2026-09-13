import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Port attribué par le système (PORT=0) et lu sur la sortie du serveur ENFANT.
// Auparavant le port était dérivé du PID (`3500 + pid % 400`) et la sortie ignorée : si
// le port était déjà pris — un serveur resté d'une exécution précédente — l'enfant mourait,
// la sonde /health répondait quand même (depuis l'AUTRE serveur), et les tests
// interrogeaient des données qui n'étaient pas les leurs. Un seul test échouait, celui qui
// dépendait de données créées juste avant : instabilité incompréhensible.
async function demarrerServeur(env) {
  const enfant = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...env, PORT: "0" },
  });
  let sortie = "", erreurs = "";
  enfant.stdout.on("data", (d) => { sortie += d; });
  enfant.stderr.on("data", (d) => { erreurs += d; });
  let sorti = null;
  enfant.on("exit", (code) => { sorti = code; });

  const limite = Date.now() + 30000;   // démarrage à froid (jsdom/scrypt) peut être lent
  for (;;) {
    const m = sortie.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      const base = `http://127.0.0.1:${m[1]}`;
      try { if ((await fetch(base + "/health")).ok) return { enfant, base }; } catch { /* pas encore prêt */ }
    }
    // Échouer vite ET en disant pourquoi : attendre 30 s pour « serveur non démarré »
    // n'apprend rien, alors que la sortie d'erreur de l'enfant dit tout.
    if (sorti != null) throw new Error(`serveur arrêté (code ${sorti})\n${erreurs.slice(-800)}`);
    if (Date.now() > limite) throw new Error(`serveur non démarré\n${erreurs.slice(-800)}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

export { demarrerServeur };

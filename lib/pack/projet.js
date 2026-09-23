// Un projet branché sur le pack documentaire.
//
// Le pack (note de cadrage, plan, présentations, classeur, trames, ordres du
// jour, kit d'intégration) a été écrit contre une forme générique { projet,
// plan }. L'ouverture de campus s'y branche par `ouverture.js`, qui doit
// traduire un rétroplanning à échéances. Un projet à durées, lui, sort déjà de
// `ordonnancer()` dans la bonne forme : ce fichier ne fait donc que compléter
// les quelques champs que les générateurs attendent en plus, et brancher la
// gouvernance réelle.
//
// CE QU'IL NE FAIT PAS : inventer du contenu. Un projet sans risques déclarés
// produit un registre des risques vide, et les documents l'écrivent en toutes
// lettres. Un document qui comble les trous tout seul se fait signer sans être
// lu — c'est la règle du générateur, on ne la contourne pas en la nourrissant
// de généralités.
import { ordonnancer, normaliserProjet, cheminsCritiques, charge } from "../projets.js";
import { ordreDuJour } from "../copilprojet.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const frDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const frLong = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—");

// La gouvernance déclarée dans la fiche prime. À défaut, on DÉCRIT le comité
// qui existe réellement — ce n'est pas une invention, c'est une lecture : le
// comité a une cadence, des membres et un ordre du jour qui se répète.
export function gouvernanceDepuisCopil(committee, odj = null) {
  if (!committee) return { instances: [], trames: [] };
  const membres = (committee.members || []).map((m) => `${m.name}${m.role ? ` (${m.role})` : ""}`).join(", ");
  const instance = {
    nom: committee.name || "Comité de pilotage",
    frequence: committee.cadence || "",
    composition: membres,
    role: "Arbitrer ce que le plan remonte : reports de jalons, échéances franchies, moyens et priorités.",
  };
  const etapes = (odj?.points || []).map((p) => ({
    duree: `${p.minutes} min`, sujet: p.titre, intervenant: p.porteur || "",
  }));
  return {
    instances: [instance],
    trames: etapes.length ? [{
      instance: instance.nom,
      duree: `${odj.total} min`,
      participants: membres,
      etapes,
    }] : [],
  };
}

// Traduit un projet et son plan calculé dans la forme attendue par le pack.
export function planProjet(p, taches, { aujourdhui = new Date().toISOString().slice(0, 10), committee = null, seances = [] } = {}) {
  const base = normaliserProjet(p);
  const plan = ordonnancer(p, taches, { aujourdhui });
  if (!plan.ok) return { projet: base, plan, options: { seances }, erreurs: plan.erreurs };

  // Le chemin le plus long parmi les chaînes critiques : c'est lui que les
  // documents surlignent. Les autres tâches à marge nulle en font partie sans
  // être sur la même chaîne.
  const chaines = cheminsCritiques(plan);
  const surLong = new Set((chaines[0]?.taches || []).map((t) => t.id));
  const roleDe = new Map((base.ressources || []).map((r) => [r.id, r.role || ""]));

  // CHANTIER — les documents groupent les actions par « lot ». Une ouverture de
  // campus a des lots déclarés ; un projet, lui, se structure en arborescence.
  // L'équivalent naturel d'un chantier est donc la tâche de synthèse qui
  // chapeaute l'action. Sans cette traduction, le plan détaillé perdait
  // silencieusement toutes les actions rangées sous une phase — et un document
  // qui perd des lignes sans le dire est pire qu'un document absent.
  const parId = new Map(plan.taches.map((t) => [t.id, t]));
  const lotDe = (t) => {
    if (String(t.lot || "").trim()) return t.lot.trim();
    let cur = t, garde = 0;
    while (cur.parentId && parId.has(cur.parentId) && garde++ < 20) cur = parId.get(cur.parentId);
    if (cur.id !== t.id) return cur.titre;
    // Action de premier niveau sans regroupement : elle a son propre bac, elle
    // ne disparaît pas.
    return t.synthese ? t.titre : "Actions hors chantier";
  };

  const tachesPack = plan.taches.map((t) => ({
    ...t,
    lot: lotDe(t),
    // « Direction » dans les documents : chez nous, le rôle porté par la
    // ressource affectée, à défaut celui attendu sur la tâche.
    dept: (t.affectations || []).map((a) => roleDe.get(a.ressourceId)).find(Boolean) || t.role || "",
    surCheminLePlusLong: surLong.has(t.id),
    echeance: t.echeance || null,
    // Le classeur lit `decalageJours` ; le moteur stocke `decalage`. On expose
    // les deux plutôt que de renommer dans le moteur, dont les liens sont déjà
    // écrits en base.
    liens: (t.liens || []).map((l) => ({ ...l, decalageJours: l.decalage })),
  }));

  const marges = tachesPack.filter((t) => !t.synthese && t.margeTotale != null).map((t) => t.margeTotale);
  const gouv = gouvernanceDepuisCopil(committee, committee ? ordreDuJour({
    projet: base, plan, charge: charge(plan),
    derive: null, journal: [], seancePrecedente: null, aujourdhui,
  }) : null);

  const projet = {
    ...base,
    // Les registres saisis priment ; le comité ne sert de source que là où rien
    // n'a été déclaré.
    instances: base.instances?.length ? base.instances : gouv.instances,
    trames: base.trames?.length ? base.trames : gouv.trames,
    sources: [],
  };

  const resume = {
    ...plan.resume,
    cheminLePlusLong: [...surLong],
    margeMin: marges.length ? Math.min(...marges) : null,
    horsMarge: tachesPack.filter((t) => !t.synthese && t.margeTotale < 0).length,
    ruptures: [], glissement: 0,
    finTotale: plan.resume.fin, apresRentree: 0,
  };

  return {
    projet,
    plan: { ...plan, projet, taches: tachesPack, resume, debut: resume.debut, fin: resume.fin },
    options: { seances },
  };
}

// ---------------------------------------------------------------------------
// Le plan imprimable (HTML → PDF par le navigateur)
// ---------------------------------------------------------------------------

// Pourquoi du HTML imprimé par le navigateur plutôt qu'un PDF généré : la mise
// en page des tableaux longs y est correcte sans effort, et la sortie suit la
// charte sans dupliquer un moteur de rendu. C'est le choix déjà fait ailleurs
// dans l'application.
export function htmlPlanProjet(projet, plan, { lot = "" } = {}) {
  const r = plan.resume || {};
  const toutes = (plan.taches || []).filter((t) => !t.synthese);
  const taches = lot ? toutes.filter((t) => (t.lot || "") === lot) : toutes;
  const lots = [...new Set(toutes.map((t) => t.lot || "").filter(Boolean))];
  const jalons = (r.jalons || []);
  const kpi = (v, l, ton) => `<div class="k${ton ? " k-" + ton : ""}"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`;
  const pastille = (t) => `<span class="b ${t.statut === "faite" ? "b-good" : t.statut === "en_cours" ? "b-warn" : "b-todo"}">${
    t.statut === "faite" ? "Faite" : t.statut === "en_cours" ? "En cours" : t.statut === "abandonnee" ? "Abandonnée" : "À faire"}</span>`;

  const ligne = (t) => `<tr class="${t.critique ? "crit" : ""}">
    <td class="num">${esc(t.code || "")}</td>
    <td>${t.jalon ? "◆ " : ""}${esc(t.titre)}${t.critique ? ' <span class="cc">chemin critique</span>' : ""}</td>
    <td>${esc(t.lot || "—")}</td>
    <td class="num">${t.jalon ? "—" : `${t.dureeJours} j`}</td>
    <td class="num">${frDate(t.debut)}</td>
    <td class="num">${frDate(t.fin)}</td>
    <td class="num">${t.margeTotale == null ? "—" : `${t.margeTotale} j`}</td>
    <td class="num">${t.statut === "faite" ? "—" : `${t.resteAFaire} j`}</td>
    <td>${esc(t.responsable || "—")}</td>
    <td>${pastille(t)}</td></tr>`;

  const sections = lots.length
    ? lots.filter((l) => !lot || l === lot).map((l) => `<h2>${esc(l)}</h2>
        <table><thead><tr><th>N°</th><th>Action</th><th>Lot</th><th>Durée</th><th>Début</th><th>Fin</th><th>Marge</th><th>Reste</th><th>Responsable</th><th>Statut</th></tr></thead>
        <tbody>${taches.filter((t) => (t.lot || "") === l).map(ligne).join("")}</tbody></table>`).join("")
    : `<table><thead><tr><th>N°</th><th>Action</th><th>Lot</th><th>Durée</th><th>Début</th><th>Fin</th><th>Marge</th><th>Reste</th><th>Responsable</th><th>Statut</th></tr></thead>
       <tbody>${taches.map(ligne).join("")}</tbody></table>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(projet.nom)} — plan</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0D1B2A; margin: 0; background: #fff; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 22px 26px 40px; }
  .band { background: #0B6E5F; color: #fff; padding: 16px 26px; }
  .eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #FF6A4D; font-weight: 700; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 25px; margin: 4px 0 2px; }
  .sub { font-size: 13px; opacity: .9; }
  h2 { font-family: Georgia, serif; font-size: 17px; color: #0B6E5F; margin: 24px 0 8px; border-bottom: 2px solid #0B6E5F; padding-bottom: 4px; }
  .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0 4px; }
  .k { border: 1px solid #E2DACD; border-radius: 10px; padding: 9px 14px; min-width: 128px; background: #F9F7F3; }
  .k .v { font-size: 19px; font-weight: 700; } .k .l { font-size: 11px; color: #5A6672; text-transform: uppercase; letter-spacing: .04em; }
  .k-bad .v { color: #C94B33; } .k-good .v { color: #0B6E5F; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 8px; }
  th { background: #0B6E5F; color: #fff; text-align: left; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 5px 8px; border-bottom: 1px solid #EDE7DA; vertical-align: top; }
  tbody tr:nth-child(even) { background: #FAF8F4; }
  tr.crit td { background: #FFF1ED; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cc { color: #C94B33; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .b { font-size: 10px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
  .b-good { background: #E4F1EE; color: #0B6E5F; } .b-warn { background: #F8EFDC; color: #A86A12; } .b-todo { background: #EFEAE0; color: #5A6672; }
  .alerte { border-left: 4px solid #C94B33; background: #F9E6E1; padding: 9px 13px; margin: 10px 0; font-size: 12.5px; }
  .pied { margin-top: 26px; border-top: 1px solid #E2DACD; padding-top: 8px; font-size: 10.5px; color: #7A8590; }
  .noprint { margin: 14px 0; }
  @media print { .noprint { display: none; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; } }
</style></head><body>
<div class="band"><div class="eyebrow">Campus Manager · Plan de projet</div>
  <h1>${esc(projet.nom)}</h1>
  <div class="sub">${esc(projet.pilote ? `Piloté par ${projet.pilote}` : "")}${projet.sponsor ? ` · Sponsor : ${esc(projet.sponsor)}` : ""} · Édité le ${frLong(new Date().toISOString())}</div></div>
<div class="wrap">
  <button class="noprint" onclick="window.print()" style="background:#0B6E5F;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;cursor:pointer;">Imprimer / PDF</button>
  ${lot ? `<p class="noprint" style="font-size:12.5px;color:#5A6672;">Vue restreinte au lot « ${esc(lot)} ».</p>` : ""}
  ${projet.objectif ? `<p style="font-size:13px;max-width:70ch;">${esc(projet.objectif)}</p>` : ""}

  <div class="kpis">
    ${kpi(frDate(r.fin), "fin prévue")}
    ${kpi(`${Math.round((r.avancement || 0) * 100)} %`, "avancement constaté")}
    ${kpi(`${r.resteAFaireJours} j`, "reste à faire")}
    ${kpi(toutes.length, "actions")}
    ${kpi((r.critiques || []).length, "sans marge", (r.critiques || []).length ? "bad" : "good")}
    ${kpi((r.echeancesDepassees || []).length, "échéances dépassées", (r.echeancesDepassees || []).length ? "bad" : "good")}
  </div>

  ${(r.echeancesDepassees || []).length ? `<div class="alerte"><b>Échéances dépassées.</b> ${
    r.echeancesDepassees.map((e) => `« ${esc(e.titre)} » : échéance au ${frDate(e.echeance)}, fin prévue au ${frDate(e.fin)} — ${e.retard} jour(s) de retard.`).join(" ")}
    <div style="margin-top:4px;color:#5A6672;">L'échéance n'a pas comprimé le plan : elle affiche le retard.</div></div>` : ""}

  ${jalons.length ? `<h2>Jalons</h2><table><thead><tr><th>Jalon</th><th>Date</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>
    ${jalons.map((j) => `<tr><td>◆ ${esc(j.titre)}</td><td class="num">${frDate(j.date)}</td>
      <td class="num">${j.echeance ? frDate(j.echeance) : "—"}</td>
      <td>${j.echeanceDepassee > 0 ? `<span class="b b-warn">${j.echeanceDepassee} j de retard</span>` : j.statut === "faite" ? '<span class="b b-good">atteint</span>' : '<span class="b b-todo">à venir</span>'}</td></tr>`).join("")}
    </tbody></table>` : ""}

  <h2>${lot ? "Actions du lot" : "Plan détaillé"}</h2>
  ${sections}

  <div class="pied">Édité depuis Campus Manager le ${frLong(new Date().toISOString())}. Les dates de début et de fin ne sont pas saisies : elles sont calculées depuis les durées, les enchaînements et le calendrier ouvré. La marge indique de combien une action peut glisser sans décaler la fin du projet.</div>
</div></body></html>`;
}

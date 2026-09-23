// Les documents Word du pack, produits depuis le projet et son plan calculé.
// Aucun n'invente de contenu : ce qui n'est pas renseigné s'affiche comme tel,
// parce qu'un document qui comble les trous tout seul se fait signer sans être lu.
import { Paragraph, TableRow, PageBreak } from "docx";
import { briques } from "./mise-en-page.js";
import { jourFR, courtFR, euros } from "./charte.js";
import { STATUTS_TACHE, IMPACTS, STATUTS_RISQUE, STATUTS_CR } from "../projets.js";

const A_RENSEIGNER = "— à renseigner —";
const ou = (v, d = A_RENSEIGNER) => (String(v || "").trim() ? String(v).trim() : d);
// Les registres stockent les échéances en ISO. « 2027-02-28 » dans une colonne
// Échéance est une fuite de format : on formate, et on laisse passer le texte
// libre (« fin du premier trimestre ») tel quel.
const quand = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? courtFR(v) : ou(v, "—"));
const lots = (plan) => [...new Set(plan.taches.map((t) => t.lot).filter(Boolean))];
const parLot = (plan, l) => plan.taches.filter((t) => t.lot === l && !t.synthese);
const jalons = (plan) => plan.taches.filter((t) => t.jalon);

// Les échéances commandées par un texte ou par le calendrier d'un tiers. Un
// comité qui cherche à gagner trois semaines doit savoir lesquelles se
// négocient — aucune de celles-ci.
function blocDelaisLegaux(projet, plan, b, ch, titre) {
  if (!projet.sources?.length) return [];
  const e = [
    b.H2(titre),
    b.P("Ces dates ne relèvent pas de l'organisation du projet : elles sont posées par un texte ou par le calendrier d'un tiers. Elles ne se rattrapent pas en ajoutant des moyens.",
      { italics: true, color: ch.gris, size: 17, after: 140 }),
  ];
  for (const s of projet.sources) {
    e.push(b.H3(s.texte),
      b.P(s.regle, { size: 17, after: 80 }),
      b.grille(["Action du plan", "Chantier", "Échéance"], [56, 26, 18],
        s.actions.map((a) => [a.titre, ou(a.lot, "—"), courtFR(a.fin)]), { size: 16 }),
      b.P(`Source : ${s.url}`, { size: 15, color: ch.gris, italics: true, after: 180 }));
  }
  return e;
}

// ── 1. Note de cadrage ──────────────────────────────────────────────────────
export async function noteCadrage(projet, plan, ch) {
  const b = briques(ch);
  const e = [
    ...b.titre("Note de cadrage", projet.nom),
    b.fiche([
      ["Objet", "Cadrage formel du projet avant lancement — à valider en comité"],
      ["Commanditaire", ou(projet.commanditaire || projet.sponsor)],
      ["Sponsor", ou(projet.sponsor)],
      ["Co-sponsor", ou(projet.coSponsor)],
      ["Rédaction", ch.emetteur],
      ["Horizon", `${jourFR(plan.debut || projet.debut)} → ${jourFR(plan.fin)}`],
    ], 24),
    b.H2("1. Contexte"),
    b.P(ou(projet.contexte, "— contexte à renseigner dans la fiche du projet —"), { after: 140 }),
    b.H2("2. Objectif"),
    b.P(ou(projet.objectif), { after: 140 }),
    b.H2("3. Périmètre"),
    b.H3("Inclus"),
    ...(projet.perimetre ? projet.perimetre.split("\n").filter(Boolean).map(b.PUCE)
                        : lots(plan).map((l) => b.PUCE(`${l} — ${parLot(plan, l).length} actions`))),
    b.H3("Hors périmètre"),
    ...(projet.horsPerimetre ? projet.horsPerimetre.split("\n").filter(Boolean).map(b.PUCE)
                             : [b.P(A_RENSEIGNER, { color: ch.gris, italics: true })]),
  ];
  if (projet.instances.length) {
    e.push(b.H2("4. Gouvernance"),
      b.grille(["Instance", "Fréquence", "Rôle"], [28, 22, 50],
        projet.instances.map((i) => [i.nom, ou(i.frequence, "—"), ou(i.role, "—")]), { premiereGras: true }));
  }
  e.push(b.H2("5. Livrables attendus"),
    b.grille(["Jalon", "Échéance", "Responsable"], [56, 20, 24],
      jalons(plan).map((j) => [j.titre, courtFR(j.fin), ou(j.responsable, "—")])));
  const budget = plan.taches.reduce((s, t) => s + (t.synthese ? 0 : t.budgetPrevu || 0), 0) || projet.budget;
  if (budget || projet.fournisseurs.length) {
    e.push(b.H2("6. Budget estimé"),
      b.grille(["Poste", "Montant", "Notes"], [40, 20, 40],
        projet.fournisseurs.length
          ? projet.fournisseurs.map((f) => [f.nom, euros(f.budget), ou(f.notes, "—")])
          : [["Budget de projet", euros(budget), "—"]]));
  }
  if (projet.risques.length) {
    e.push(b.H2("7. Risques majeurs identifiés"),
      b.grille(["Risque", "Impact", "Propriétaire", "Échéance"], [50, 14, 20, 16],
        projet.risques.map((r) => [r.titre, IMPACTS[r.impact], ou(r.proprietaire, "—"), quand(r.echeance)])));
  }
  e.push(...blocDelaisLegaux(projet, plan, b, ch, "8. Délais légaux et calendriers imposés"));
  e.push(b.H2(projet.sources?.length ? "9. Validation" : "8. Validation"),
    b.grille(["Rôle", "Nom", "Date", "Signature"], [24, 30, 20, 26], [
      ["Sponsor", ou(projet.sponsor, ""), "", ""],
      ["Co-sponsor", ou(projet.coSponsor, ""), "", ""],
      ["Relais direction générale", ou(projet.relaisDG, ""), "", ""],
    ], { premiereGras: true }));
  return b.rendre("Note de cadrage", e);
}

// ── 2. Plan d'action détaillé ───────────────────────────────────────────────
export async function planDetaille(projet, plan, ch) {
  const b = briques(ch, 800);
  const e = [
    ...b.titre("Plan d'action opérationnel", projet.nom),
    b.fiche([
      ["Objet", "Plan de mise en œuvre — actions, jalons, dépendances"],
      ["Pilote", ou(projet.pilote)],
      ["Horizon", `${jourFR(plan.debut || projet.debut)} → ${jourFR(plan.fin)}`],
      ["Volume", `${plan.taches.filter((t) => !t.synthese).length} actions · ${jalons(plan).length} jalons · ${plan.taches.filter((t) => t.critique).length} sur le chemin critique`],
      ["Rédaction", ch.emetteur],
    ], 22),
    b.H2("1. Objectif du projet"),
    b.P(ou(projet.objectif), { after: 160 }),
  ];
  if (projet.instances.length) {
    e.push(b.H2("2. Cycle de réunions"),
      b.grille(["Instance", "Fréquence", "Composition", "Rôle"], [22, 16, 32, 30],
        projet.instances.map((i) => [i.nom, ou(i.frequence, "—"), ou(i.composition, "—"), ou(i.role, "—")]), { premiereGras: true, size: 16 }));
  }
  e.push(b.H2("3. Organisation en chantiers"));
  for (const l of lots(plan)) {
    const ts = parLot(plan, l);
    const j = ts.filter((t) => t.jalon);
    e.push(b.H3(`${l}  (${ts.length} actions${j.length ? `, ${j.length} jalon${j.length > 1 ? "s" : ""}` : ""})`),
      b.grille(["Action", "Fin", "Resp.", "Marge (j)", "Crit.", "Date imposée par"], [38, 10, 14, 9, 7, 22],
        ts.map((t) => [t.titre, courtFR(t.fin), ou(t.responsable, "—"),
          t.jalon ? "—" : String(t.margeTotale ?? ""), t.critique ? "oui" : "",
          t.baseLegale || ""]), { size: 16 }));
  }
  e.push(b.H2("4. Jalons et livrables"),
    b.grille(["Jalon", "Chantier", "Échéance", "Responsable", "Statut"], [38, 20, 13, 17, 12],
      jalons(plan).map((j) => [j.titre, ou(j.lot, "—"), courtFR(j.fin), ou(j.responsable, "—"),
        STATUTS_TACHE[j.statut]?.label || j.statut]), { size: 16 }));
  e.push(b.H2("5. Chemin critique"),
    b.P("Un jour perdu sur ces actions est un jour perdu sur la date de fin. Agir ailleurs ne rattrape rien.",
      { italics: true, color: ch.gris, size: 17 }),
    b.grille(["Action", "Début", "Fin", "Responsable"], [50, 14, 14, 22],
      plan.taches.filter((t) => t.critique && !t.synthese)
        .map((t) => [t.titre, courtFR(t.debut), courtFR(t.fin), ou(t.responsable, "—")]), { size: 16 }));
  if (projet.risques.length) {
    e.push(b.H2("6. Registre des risques"),
      b.grille(["Risque", "Impact", "Statut", "Propriétaire", "Plan B"], [34, 11, 14, 17, 24],
        projet.risques.map((r) => [r.titre, IMPACTS[r.impact], STATUTS_RISQUE[r.statut], ou(r.proprietaire, "—"), ou(r.planB, "—")]), { size: 16 }));
  }
  if (projet.kpis.length) {
    e.push(b.H2("7. Cibles chiffrées"),
      b.grille(["Type", "Indicateur", "Cible", "Échéance", "Mesuré"], [14, 30, 26, 16, 14],
        projet.kpis.map((k) => [k.type === "officiel" ? "Officiel" : "Opérationnel", k.indicateur,
          ou(k.cible, "—"), quand(k.echeance), ou(k.valeur, "non mesuré")]), { size: 16 }));
  }
  e.push(...blocDelaisLegaux(projet, plan, b, ch, "8. Délais légaux et calendriers imposés"));
  if (projet.fournisseurs.length) {
    e.push(b.H2(projet.sources?.length ? "9. Fournisseurs" : "8. Fournisseurs"),
      b.grille(["Fournisseur", "Prestation", "Statut", "Budget"], [24, 38, 20, 18],
        projet.fournisseurs.map((f) => [f.nom, ou(f.prestation, "—"), ou(f.statut, "—"), euros(f.budget)]), { size: 16 }));
  }
  return b.rendre("Plan d'action opérationnel", e);
}

// ── 3. Plan d'action — synthèse ─────────────────────────────────────────────
export async function planSynthese(projet, plan, ch) {
  const b = briques(ch);
  const actions = plan.taches.filter((t) => !t.synthese);
  const e = [
    ...b.titre("Plan d'action", `${projet.nom} — synthèse`),
    b.fiche([
      ["Objectif", ou(projet.objectif)],
      ["Horizon", `${jourFR(plan.debut || projet.debut)} → ${jourFR(plan.fin)}`],
      ["Volume", `${actions.length} actions · ${jalons(plan).length} jalons · ${lots(plan).length} chantiers`],
    ], 22),
    b.H2("Les chantiers"),
    b.grille(["Chantier", "Actions", "Jalon principal", "Échéance"], [30, 12, 40, 18],
      lots(plan).map((l) => {
        const ts = parLot(plan, l); const j = ts.filter((x) => x.jalon).slice(-1)[0];
        return [l, String(ts.length), j ? j.titre : "—", j ? courtFR(j.fin) : "—"];
      }), { premiereGras: true }),
  ];
  if (projet.instances.length) {
    e.push(b.H2("Cycle de réunions"),
      b.grille(["Instance", "Fréquence", "Rôle"], [28, 22, 50],
        projet.instances.map((i) => [i.nom, ou(i.frequence, "—"), ou(i.role, "—")]), { premiereGras: true }));
  }
  e.push(b.H2("Les jalons"),
    b.grille(["Jalon", "Échéance", "Responsable"], [58, 18, 24],
      jalons(plan).map((j) => [j.titre, courtFR(j.fin), ou(j.responsable, "—")])));
  const ouverts = projet.risques.filter((r) => r.statut === "ouvert");
  if (ouverts.length) {
    e.push(b.H2("Points à trancher"),
      ...ouverts.map((r, i) => b.P(`${i + 1}.  ${r.titre}${r.proprietaire ? ` — ${r.proprietaire}` : ""}`, { after: 90 })));
  }
  return b.rendre("Plan d'action — synthèse", e);
}

// ── 4. Trames d'ordre du jour ───────────────────────────────────────────────
export async function trames(projet, plan, ch) {
  const b = briques(ch);
  const e = [
    ...b.titre("Format d'ordre du jour", projet.nom),
    b.P("Trames réutilisables, à dupliquer à chaque occurrence. Les cases vides se remplissent avant la séance.",
      { color: ch.gris, italics: true, after: 180 }),
  ];
  const liste = projet.trames.length ? projet.trames
    : projet.instances.map((i) => ({ instance: i.nom, duree: "", participants: i.composition, etapes: [] }));
  if (!liste.length) e.push(b.P("Aucune instance déclarée : ajoutez-les dans la fiche du projet.", { color: ch.accent, italics: true }));
  for (const t of liste) {
    e.push(b.H2(`${t.instance}${t.duree ? ` — ${t.duree}` : ""}`),
      b.P(`Participants : ${ou(t.participants, "—")}`, { size: 17, color: ch.gris, after: 120 }),
      b.grille(["Durée", "Sujet", "Intervenant"], [14, 60, 26],
        t.etapes.length ? t.etapes.map((x) => [ou(x.duree, "—"), x.sujet, ou(x.intervenant, "—")])
                        : [["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""]]));
  }
  return b.rendre("Format d'ordre du jour", e);
}

// ── 5. Ordres du jour pré-remplis, séance par séance ────────────────────────
// Dérivés du registre des risques et des jalons : chaque séance porte ce qui
// échoit dans sa fenêtre. C'est ce qui distingue un ordre du jour d'un gabarit.
export async function ordresDuJour(projet, plan, ch, seances) {
  const b = briques(ch);
  const e = [
    ...b.titre("Ordres du jour", projet.nom),
    b.P("Un ordre du jour par séance, pré-rempli à partir des jalons et du registre des risques. À régénérer si le registre évolue.",
      { color: ch.gris, italics: true, after: 180 }),
  ];
  for (const s of seances) {
    e.push(b.H2(`${s.libelle} — ${jourFR(s.date)}`));
    if (s.jalons.length) {
      e.push(b.P("Jalons de la période", { bold: true, size: 17, after: 60 }),
        ...s.jalons.map((j) => b.PUCE(`${j.titre} — ${courtFR(j.fin)}`)));
    }
    e.push(b.grille(["Durée", "Sujet", "Intervenant"], [14, 60, 26], [
      ["10 min", "Revue d'avancement : jalons de la période, actions en retard", ou(projet.pilote, "Pilote")],
      ...s.risques.map((r) => [`${r.impact === "eleve" ? 10 : 5} min`,
        `[${IMPACTS[r.impact]}] ${r.titre}`, ou(r.proprietaire, "—")]),
      ...(s.risques.length ? [] : [["10 min", "Aucun arbitrage bloquant identifié — revue standard", ou(projet.pilote, "Pilote")]]),
      ["5 min", "Actions prioritaires de la période à venir", ou(projet.pilote, "Pilote")],
    ]));
  }
  return b.rendre("Ordres du jour", e);
}

// ── 6. Kit d'onboarding — une fiche par intervenant ─────────────────────────
export async function kitOnboarding(projet, plan, ch) {
  const b = briques(ch);
  const gouvernance = [
    ["Sponsor", projet.sponsor, "Porte le projet, arbitre les points bloquants, valide les budgets"],
    ["Co-sponsor", projet.coSponsor, "Co-porte le projet, relais opérationnel"],
    ["Relais direction générale", projet.relaisDG, "Co-arbitre les décisions structurantes"],
    ["Pilote du projet", projet.pilote, "Tient le plan, anime les instances, alerte sur les dérives"],
  ].filter(([, n]) => n);
  const e = [
    ...b.titre("Kit d'onboarding", projet.nom),
    b.P("Une fiche par intervenant, remise à sa désignation. Chacune dit la mission, les échéances, les dépendances et les interlocuteurs.",
      { color: ch.gris, italics: true, after: 160 }),
    b.H2("Checklist commune des cinq premiers jours"),
    b.PUCE("Lire sa fiche de mission et la section du plan d'action qui la concerne"),
    b.PUCE(`Point individuel de 30 min avec ${ou(projet.pilote, "le pilote du projet")}`),
    b.PUCE("Prendre en main le classeur de suivi (actions, jalons, risques)"),
    b.PUCE("Identifier ses dépendances avec les autres chantiers"),
    b.PUCE("Préparer une présentation de 3 min de son périmètre pour la première instance"),
  ];
  if (gouvernance.length) {
    e.push(b.H2("Gouvernance"),
      b.grille(["Rôle", "Titulaire", "Responsabilité"], [26, 24, 50],
        gouvernance.map(([r, n, d]) => [r, n, d]), { premiereGras: true }));
  }
  // Une fiche par porteur. À défaut de personne nommée, par DIRECTION : sur une
  // ouverture de campus, le travail est réparti par direction avant d'être
  // nominatif, et un kit vide au prétexte qu'aucun nom n'est saisi ne sert à
  // personne. La fiche dit alors à qui elle s'adresse.
  const porteur = (t) => t.responsable || t.dept || "";
  const noms = [...new Set(plan.taches.filter((t) => !t.synthese && porteur(t)).map(porteur))].sort();
  const parPersonne = plan.taches.some((t) => t.responsable);
  for (const nom of noms) {
    const siennes = plan.taches.filter((t) => !t.synthese && porteur(t) === nom);
    const sesJalons = siennes.filter((t) => t.jalon);
    const amont = [...new Set(siennes.flatMap((t) => (t.liens || [])
      .map((l) => plan.taches.find((x) => x.id === l.deId))
      .filter((q) => q && porteur(q) && porteur(q) !== nom)
      .map((q) => `${q.titre} (${porteur(q)})`)))];
    // Une fiche par page : elles se distribuent une par une.
    e.push(new Paragraph({ children: [new PageBreak()] }));
    e.push(b.H1(`Fiche — ${nom}`),
      b.FILET(),
      b.P(parPersonne ? "Fiche individuelle." : `Fiche de direction : à remettre au responsable désigné de ${nom}, puis à décliner nominativement.`,
        { color: ch.gris, italics: true, after: 120 }),
      b.fiche([
        ["Périmètre", [...new Set(siennes.map((t) => t.lot).filter(Boolean))].join(" · ") || "—"],
        ["Actions", `${siennes.length}, dont ${siennes.filter((t) => t.critique).length} sur le chemin critique`],
        ["Fenêtre", `${courtFR(siennes.map((t) => t.debut).sort()[0])} → ${courtFR(siennes.map((t) => t.fin).sort().slice(-1)[0])}`],
      ], 22),
      b.H2("Vos jalons"),
      sesJalons.length
        ? b.grille(["Jalon", "Échéance"], [72, 28], sesJalons.map((j) => [j.titre, courtFR(j.fin)]))
        : b.P("Aucun jalon porté directement.", { color: ch.gris, italics: true }),
      b.H2("Vos actions"),
      b.grille(["Action", "Début", "Fin", "Marge (j)", "Crit."], [50, 13, 13, 13, 11],
        siennes.map((t) => [t.titre, courtFR(t.debut), courtFR(t.fin), t.jalon ? "—" : String(t.margeTotale ?? ""), t.critique ? "oui" : ""]), { size: 16 }),
      b.H2("Ce dont vous dépendez"),
      amont.length ? b.grille(["Action amont (porteur)"], [100], amont.map((a) => [a]))
                   : b.P("Aucune dépendance déclarée vers un autre porteur.", { color: ch.gris, italics: true }));
  }
  return b.rendre("Kit d'onboarding", e.filter(Boolean));
}

// ── 7. One-pager de communication ───────────────────────────────────────────
export async function onePager(projet, plan, ch) {
  const b = briques(ch);
  const e = [
    ...b.titre(projet.nom, "Ce qui change, et pourquoi"),
    b.table([new TableRow({ children: [
      b.cell([b.P("POURQUOI CE PROJET ?", { bold: true, size: 18, color: ch.accent, after: 80 }),
              b.P(ou(projet.contexte || projet.objectif), { size: 18, after: 0 })], { width: 50, fill: ch.clair }),
      b.cell([b.P("CE QUI CHANGE", { bold: true, size: 18, color: ch.accent, after: 80 }),
              ...lots(plan).slice(0, 5).map((l) => b.P(`• ${l}`, { size: 18, after: 50 }))], { width: 50 }),
    ] })], [50, 50]),
    b.H2("Le calendrier"),
    b.grille(["Jalon", "Quand"], [72, 28], jalons(plan).slice(0, 6).map((j) => [j.titre, jourFR(j.fin)])),
    b.H2("Une question, un retour ?"),
    b.P(`Adressez-vous à ${ou(projet.pilote, "la direction de projet")}${projet.sponsor ? `, ou à ${projet.sponsor}` : ""}.`, { after: 0 }),
  ];
  return b.rendre("One-pager", e);
}

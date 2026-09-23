// L'ouverture de campus branchée sur le pack documentaire.
//
// Une ouverture n'est pas un projet à durées : c'est un rétroplanning à
// ÉCHÉANCES, calculé à rebours de la rentrée. On ne lui invente donc pas de
// durées pour la faire entrer dans le moteur générique — on garde sa chaîne
// (lib/chain.js, les écarts font office de durées) et on traduit son résultat
// dans la forme que les générateurs attendent.
//
// Les durées affichées viennent d'ailleurs : la fenêtre de travail d'une action
// est l'intervalle entre la dernière échéance amont et la sienne. C'est le
// temps réellement disponible, pas une estimation — et c'est ce que la frise
// doit montrer.
import { analyseChain } from "../chain.js";
import { jourFR } from "./charte.js";
import { OPENING_LOTS, OPENING_DEPTS, OPENING_JALONS, deptOf, buildOpeningBudget, OPENING_DUREE_REF } from "../calc.js";

const LOT_LABEL = Object.fromEntries(OPENING_LOTS.map((l) => [l.k, l.l]));
const DEPT_LABEL = Object.fromEntries(OPENING_DEPTS.map((d) => [d.k, d.l]));
const STATUT = { todo: "a_faire", doing: "en_cours", done: "faite", blocked: "en_cours" };
const AVANCEMENT = { todo: 0, doing: 0.5, done: 1, blocked: 0.25 };
const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// Registres par défaut d'une ouverture de campus. Ce ne sont pas des exemples :
// ce sont les risques, cibles et instances que TOUTE ouverture rencontre, avec
// le seuil qui les déclenche et la porte de sortie. L'utilisateur les amende ;
// il ne part pas d'une page blanche, qui reste vide dans neuf cas sur dix.
export function registresOuverture(o = {}, cible = "") {
  const ville = String(o.city || o.name || "").trim();
  const rentree = cible || o.targetDate || "";
  const an = rentree ? rentree.slice(0, 4) : "";
  const avant = (mois, jour = "15") => (an ? `${mois > 8 ? Number(an) - 1 : an}-${String(mois).padStart(2, "0")}-${jour}` : "");
  return {
    risques: [
      { titre: "La commission de sécurité ne donne pas d'avis favorable avant la rentrée",
        chantier: LOT_LABEL.travaux, impact: "eleve",
        seuil: "Visite non programmée à huit semaines de la rentrée, ou réserves prononcées",
        planB: "Ouvrir sur un site provisoire déjà conforme (locaux partagés d'un partenaire) le temps de lever les réserves, et décaler les travaux non bloquants après la rentrée.",
        decideur: "Direction des opérations", proprietaire: "Direction des opérations", statut: "ouvert", echeance: avant(7, "01"),
        commentaire: "C'est le point dur du chemin critique : l'arrêté du maire en dépend, et aucun accueil du public n'est légal sans lui." },
      { titre: "Les travaux d'aménagement dérapent au-delà de la date de réception",
        chantier: LOT_LABEL.travaux, impact: "eleve",
        seuil: "Retard cumulé supérieur à trois semaines au constat de chantier mensuel",
        planB: "Réceptionner par tranches : les salles de cours d'abord, les espaces annexes ensuite. La rentrée se tient avec le minimum conforme.",
        decideur: "Direction des opérations", proprietaire: "Direction des opérations", statut: "ouvert", echeance: avant(6, "30") },
      { titre: "L'objectif d'inscrits n'est pas atteint",
        chantier: LOT_LABEL.marketing, impact: "eleve",
        seuil: "Moins de 60 % de l'objectif en dossiers complets au 31 mai",
        planB: "Ouvrir une session d'admission complémentaire en juillet, renforcer le plan média local, et arbitrer l'ouverture d'une seule promotion au lieu de deux.",
        decideur: "Direction commerciale", proprietaire: "Direction commerciale", statut: "ouvert", echeance: `${an}-05-31` },
      // Le plan est désormais explicite : promesse du directeur en janvier,
      // arrivée en avril après préavis, équipe pédagogique recrutée en mars.
      // Le directeur découvre donc une équipe qu'il n'a pas choisie seul.
      { titre: "Le directeur de campus arrive après le recrutement de son équipe pédagogique",
        chantier: LOT_LABEL.rh, impact: "moyen",
        seuil: "Promesse d'embauche signée après le 31 janvier, ou préavis supérieur à trois mois",
        planB: "Faire siéger le directeur pressenti en jury de recrutement dès sa promesse signée, même à distance, et lui donner un droit de veto écrit sur les recrutements pédagogiques.",
        decideur: "Direction générale", proprietaire: "Ressources humaines", statut: "ouvert", echeance: `${an ? Number(an) : ""}-01-31`,
        commentaire: "Sur onze mois, il n'y a pas de séquence qui mette le directeur en poste avant son équipe : c'est un arbitrage, pas un retard." },
      { titre: "Le corps professoral n'est pas complet à la pré-rentrée",
        chantier: LOT_LABEL.rh, impact: "eleve",
        seuil: "Moins de 80 % des heures du référentiel couvertes au 30 juin",
        planB: "Recours à des vacataires professionnels sur les modules techniques, mutualisation en distanciel depuis un campus du réseau sur les modules transverses.",
        decideur: "Direction académique", proprietaire: "Ressources humaines", statut: "ouvert", echeance: `${an}-06-30` },
      { titre: "Le dossier d'ouverture n'est pas recevable ou l'UAI n'est pas délivré à temps",
        chantier: LOT_LABEL.admin, impact: "eleve",
        seuil: "Aucun accusé de réception du rectorat quatre semaines après dépôt",
        planB: "Relance hiérarchique auprès du rectorat, et bascule de la première promotion sur l'UAI d'un campus existant du réseau si le calendrier l'impose.",
        decideur: "Direction académique", proprietaire: "Direction académique", statut: "ouvert", echeance: avant(12, "15"),
        commentaire: "L'UAI conditionne Carif-Oref, qui conditionne Parcoursup : trois maillons en série, aucun raccourci." },
      // Signalé par la direction académique : le niveau d'autorisation exigé
      // pour la formation initiale n'est pas le même d'un rectorat à l'autre.
      // On ne découvre le process qu'en le demandant, d'où l'action de jour un.
      { titre: "Le rectorat exige des pièces que le calendrier ne permet pas de fournir (photos des locaux aménagés, autorisation préfectorale)",
        chantier: LOT_LABEL.admin, impact: "eleve",
        seuil: "Liste des pièces non obtenue du rectorat six semaines après la demande, ou pièce exigée qui dépend de travaux non terminés",
        planB: "Déposer un dossier en deux temps, avec accord écrit du rectorat sur le complément tardif ; à défaut, avancer la réception d'une salle témoin pour produire les photos exigées.",
        decideur: "Direction académique", proprietaire: "Direction académique", statut: "ouvert", echeance: avant(11, "15"),
        commentaire: "Le risque est plus élevé en double ouverture (formation initiale ET alternance) : deux régimes d'autorisation, deux instructions." },
      // Les deux risques que l'audit des délais légaux a fait apparaître : ils ne
      // relèvent pas de l'exécution mais du calendrier lui-même, et se traitent
      // au lancement ou jamais.
      { titre: "L'autorisation de travaux ERP n'est pas obtenue à temps : quatre mois d'instruction incompressibles",
        chantier: LOT_LABEL.immo, impact: "eleve",
        seuil: "Dossier Cerfa 13824 non déposé fin octobre, ou demande de pièce complémentaire par la mairie (le délai de quatre mois repart à zéro)",
        planB: "Déposer un dossier volontairement minimal mais complet dès que l'avant-projet le permet, et traiter les ajustements par modificatif ; à défaut, décaler la rentrée d'un semestre plutôt que d'ouvrir sans autorisation.",
        decideur: "Direction générale", proprietaire: "Direction des opérations", statut: "ouvert", echeance: avant(10, "31"),
        commentaire: "C'est le délai qui fixe la durée minimale du projet à onze mois : il suppose un local arrêté dès les premières semaines." },
      { titre: "La première promotion ne peut pas être recrutée via Parcoursup",
        chantier: LOT_LABEL.marketing, impact: "eleve",
        seuil: "UAI non délivré à l'ouverture de la carte des formations, à la mi-décembre",
        planB: "Recruter la première promotion en admission directe, comme le font les établissements privés hors contrat, et entrer sur Parcoursup pour la rentrée suivante. Prévoir le budget d'acquisition correspondant, plus élevé.",
        decideur: "Direction générale", proprietaire: "Direction commerciale", statut: "ouvert", echeance: avant(12, "15"),
        commentaire: "Conséquence directe du calendrier : le dossier Parcoursup suppose un UAI, et l'UAI suppose le SIRET, qui suppose le Go/No-Go." },
      { titre: "Le bail n'est pas signé dans la fenêtre qui permet de tenir le chantier",
        chantier: LOT_LABEL.immo, impact: "eleve",
        seuil: "Aucune promesse signée à onze mois de la rentrée",
        planB: "Activer le second site de la short-list, dont le diagnostic est déjà fait, même à loyer supérieur : le temps coûte plus cher que l'écart de loyer.",
        decideur: "Direction générale", proprietaire: "Direction des opérations", statut: "ouvert", echeance: avant(11, "30") },
      // L'instruction ERP dure quatre mois : sur onze mois, le dépôt tombe
      // trois semaines après le lancement. Il n'y a pas de place pour chercher
      // un local ensuite.
      { titre: "Le local n'est pas arrêté à temps pour déposer l'autorisation de travaux ERP",
        chantier: LOT_LABEL.immo, impact: "eleve",
        seuil: "Aucun local arrêté quatre semaines après le lancement du projet",
        planB: "Se rabattre sur un local déjà conforme ERP type R ne nécessitant qu'une déclaration, même à loyer supérieur, ou décaler la rentrée d'un an. Aucune compression d'amont ne rattrape une instruction de quatre mois.",
        decideur: "Direction générale", proprietaire: "Direction des opérations", statut: "ouvert", echeance: avant(11, "01"),
        commentaire: "Quatre mois d'instruction à compter du dossier complet, et le délai repart si la mairie réclame une pièce. C'est ce délai qui fixe la durée minimale d'une ouverture à onze mois." },
      { titre: "La première promotion ne peut pas être recrutée sur Parcoursup",
        chantier: LOT_LABEL.marketing, impact: "moyen",
        seuil: "UAI non délivré à la fermeture de la remontée des formations, à la mi-décembre",
        planB: "Recruter la première promotion en admission directe, comme le font la plupart des formations privées, et déposer sur Parcoursup pour la rentrée suivante.",
        decideur: "Direction commerciale", proprietaire: "Direction académique", statut: "ouvert", echeance: avant(12, "15"),
        commentaire: "Le dossier suppose un UAI, qui n'arrive qu'en décembre sur un projet de onze mois. À décider tôt : l'objectif d'inscrits et le plan média n'ont pas la même forme avec ou sans Parcoursup." },
      { titre: "Le budget travaux dépasse l'enveloppe votée",
        chantier: LOT_LABEL.finance, impact: "moyen",
        seuil: "Devis consolidés supérieurs de plus de 10 % à l'enveloppe",
        planB: "Reporter en année 2 les aménagements non réglementaires (second espace de convivialité, signalétique intérieure premium) et renégocier le lot le plus élevé.",
        decideur: "Direction financière", proprietaire: "Direction financière", statut: "ouvert", echeance: avant(3, "31") },
      { titre: "Le système d'information n'est pas prêt pour accueillir les inscriptions",
        chantier: LOT_LABEL.si, impact: "moyen",
        seuil: "Environnement de production non recetté six semaines avant l'ouverture des inscriptions",
        planB: "Saisie des dossiers sur le système d'un campus existant, reprise des données après bascule.",
        decideur: "Direction des opérations", proprietaire: "Systèmes d'information", statut: "ouvert", echeance: avant(2, "28") },
    ],
    kpis: [
      { indicateur: "Apprenants inscrits à la rentrée", type: "officiel", cible: "objectif arrêté en COPIL — à renseigner", echeance: rentree, valeur: "" },
      { indicateur: "Dossiers complets reçus", type: "operationnel", cible: "six fois l'objectif d'inscrits (ratio de conversion retenu : 1 sur 6)", echeance: `${an}-06-30`, valeur: "" },
      { indicateur: "Coût d'acquisition par apprenant inscrit", type: "operationnel", cible: "budget marketing divisé par l'objectif d'inscrits", echeance: rentree, valeur: "" },
      { indicateur: "Heures du référentiel couvertes par un professeur affecté", type: "officiel", cible: "100 %", echeance: `${an}-08-25`, valeur: "" },
      { indicateur: "Avis favorable de la commission de sécurité", type: "officiel", cible: "obtenu", echeance: avant(7, "15"), valeur: "" },
      { indicateur: "Réception des travaux sans réserve bloquante", type: "officiel", cible: "prononcée", echeance: `${an}-07-31`, valeur: "" },
      { indicateur: "Respect de l'enveloppe budgétaire votée", type: "officiel", cible: "écart inférieur à 5 %", echeance: rentree, valeur: "" },
    ],
    instances: [
      { nom: "COPIL hebdomadaire", frequence: "Hebdomadaire",
        composition: "COMEX complet (Opérations, Finance, Marketing, Académique, RH, Commerce), pilote du projet, invités selon l'ordre du jour",
        role: "Arbitrer, lever les points bloquants, valider les jalons. Seule instance habilitée à décaler une échéance : un jalon ne bouge pas en couloir." },
      { nom: "Revue de chantier", frequence: "Mensuelle sur site, hebdomadaire en phase travaux",
        composition: "Direction des opérations, maître d'œuvre, entreprises des lots en cours",
        role: "Constater l'avancement réel, acter les réserves, tenir la date de réception." },
      { nom: "Point recrutement", frequence: "Hebdomadaire à partir de l'ouverture des candidatures",
        composition: "Direction commerciale, direction marketing, équipe d'admission",
        role: "Suivre le pipeline contre l'objectif, corriger le plan média, décider des sessions complémentaires." },
      { nom: "Revue académique", frequence: "Mensuelle",
        composition: "Direction académique, responsable pédagogique du campus, RH",
        role: "Suivre l'ouverture administrative (UAI, Carif-Oref, Parcoursup) et la constitution du corps professoral." },
    ],
    trames: [
      { instance: "COPIL hebdomadaire", duree: "1 h 30", participants: "COMEX complet, pilote du projet",
        etapes: [
          { duree: "10 min", sujet: "Atterrissage : la date de rentrée est-elle toujours tenue, et de combien a bougé le glissement depuis la semaine dernière", intervenant: "Pilote" },
          { duree: "25 min", sujet: "Actions hors marge, une par une, avec une décision par action", intervenant: "Pilote et porteurs concernés" },
          { duree: "20 min", sujet: "Points d'arbitrage soumis au comité (registre des risques dont le seuil est franchi)", intervenant: "Porteurs concernés" },
          { duree: "15 min", sujet: "Pipeline de recrutement contre objectif", intervenant: "Direction commerciale" },
          { duree: "10 min", sujet: "Chantier : avancement, réserves, date de réception", intervenant: "Direction des opérations" },
          { duree: "10 min", sujet: "Budget : engagements de la semaine et écart à l'enveloppe", intervenant: "Direction financière" },
          { duree: "10 min", sujet: "Relevé de décisions et actions de la semaine, avec porteur et date", intervenant: "Pilote" },
        ] },
      { instance: "Revue de chantier", duree: "1 h", participants: "Direction des opérations, maître d'œuvre, entreprises",
        etapes: [
          { duree: "20 min", sujet: "Tour de chantier : avancement constaté lot par lot", intervenant: "Maître d'œuvre" },
          { duree: "15 min", sujet: "Écarts au planning et mesures de rattrapage", intervenant: "Entreprises" },
          { duree: "15 min", sujet: "Réserves ouvertes et conditions de lever", intervenant: "Maître d'œuvre" },
          { duree: "10 min", sujet: "Points à remonter au COPIL", intervenant: "Direction des opérations" },
        ] },
      { instance: "Point recrutement", duree: "45 min", participants: "Direction commerciale, marketing, admissions",
        etapes: [
          { duree: "10 min", sujet: "Candidatures de la semaine contre objectif cumulé", intervenant: "Admissions" },
          { duree: "15 min", sujet: "Performance du plan média par canal et coût par dossier", intervenant: "Direction marketing" },
          { duree: "10 min", sujet: "Dossiers en attente : ce qui bloque, qui rappelle", intervenant: "Admissions" },
          { duree: "10 min", sujet: "Décisions : réallocation de budget, session complémentaire", intervenant: "Direction commerciale" },
        ] },
    ],
  };
}

// Traduit une ouverture en couple { projet, plan } consommable par le pack.
export function planOuverture(o, taches, { aujourdhui = new Date().toISOString().slice(0, 10), settings = {} } = {}) {
  const cible = o.targetDate || "";
  const items = (taches || []).filter((t) => t?.id && t.dueDate);
  const ch = analyseChain(items, { targetDate: cible, today: aujourdhui });
  // Le chemin critique de ce modèle n'a PAS une marge nulle : le rétroplanning
  // est construit avec un matelas minimal de trois jours entre deux échéances
  // enchaînées. Chercher slack === 0 ne trouvait donc rien, et le plan sortait
  // avec « 0 action sans marge » sur 187 — un mensonge rassurant. C'est le
  // drapeau `critical` du modèle qui dit le chemin critique ; la marge dit
  // combien il en reste.
  const surChemin = new Set(ch.path || []);
  const parId = new Map(items.map((t) => [t.id, t]));

  // Les jalons sont déclarés par le modèle (OPENING_JALONS) : des obtentions et
  // des décisions, pas la dernière ligne de chaque lot. À défaut de clé connue
  // — plan personnalisé, actions ajoutées à la main — on retombe sur la
  // dernière échéance de chaque lot, faute de mieux, et c'est dit ici.
  let estJalon = new Set(items.filter((t) => OPENING_JALONS.has(t.tplKey)).map((t) => t.id));
  if (!estJalon.size) {
    const dernierDuLot = new Map();
    for (const t of items) {
      const p = dernierDuLot.get(t.lot);
      if (!p || String(t.dueDate) > String(p.dueDate)) dernierDuLot.set(t.lot, t);
    }
    estJalon = new Set([...dernierDuLot.values()].map((t) => t.id));
  }

  const budgetTotal = Number(o.budget) || 0;
  const parLot = Object.fromEntries(buildOpeningBudget(budgetTotal).map((l) => [l.lot, l.planned]));
  const nbParLot = {};
  for (const t of items) nbParLot[t.lot] = (nbParLot[t.lot] || 0) + 1;
  const engageParLot = {};
  for (const l of o.budgetLines || []) engageParLot[l.lot] = (engageParLot[l.lot] || 0) + (Number(l.spent) || 0);

  const tachesPack = items
    .slice()
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.lot).localeCompare(String(b.lot)))
    .map((t, i) => {
      const c = ch.byId[t.id] || {};
      const amont = (t.dependsOn || []).filter((p) => parId.has(p));
      const finAmont = amont.map((p) => parId.get(p).dueDate).filter(Boolean).sort().slice(-1)[0] || null;
      // Fenêtre de travail = de la dernière échéance amont à la sienne. Bornée à
      // 90 jours : au-delà, la barre dit « on a tout le temps », ce qui est faux —
      // c'est simplement que rien ne bloque en amont.
      const fenetre = finAmont ? Math.max(1, Math.min(90, jours(finAmont, t.dueDate))) : 1;
      const dept = deptOf(t);
      return {
        id: t.id, code: String(i + 1), titre: t.title,
        lot: LOT_LABEL[t.lot] || t.lot, dept: DEPT_LABEL[dept] || dept,
        jalon: estJalon.has(t.id),
        apresRentree: !!t.afterOpening,
        critique: !!t.critical,
        surCheminLePlusLong: surChemin.has(t.id),
        debut: finAmont ? new Date(new Date(t.dueDate) - (fenetre - 1) * 86400000).toISOString().slice(0, 10) : t.dueDate,
        fin: t.dueDate,
        dureeJours: fenetre,
        // slack null = rien en aval ne contraint cette action. Ce n'est PAS une
        // marge de zéro : l'écrire 0 faisait sortir « marge minimale : 0 jour »
        // sur un plan dont le maillon le plus tendu en a trois. On laisse null,
        // et les vues l'excluent des minimums.
        margeTotale: c.slack == null ? null : c.slack,
        echeance: t.dueDate,
        statut: STATUT[t.status] || "a_faire",
        avancement: AVANCEMENT[t.status] ?? 0,
        responsable: String(t.owner || "").trim(),
        role: DEPT_LABEL[dept] || "",
        // Le budget d'une ouverture est voté par LOT, pas par action : on répartit
        // à parts égales dans le lot plutôt que de laisser toutes les lignes à zéro,
        // et le total par chantier reste juste.
        budgetPrevu: 0,
        budgetDepense: 0,
        synthese: false,
        note: String(t.notes || "").trim(),
        liens: amont.map((p) => ({ deId: p, type: "FD", decalage: 0, decalageJours: 0 })),
      };
    });
  // Répartition du budget par lot, à l'euro : part égale, et le reste de la
  // division sur la première ligne. Sans cela, le total affiché ne tombait pas
  // sur l'enveloppe votée — un écart d'un euro suffit à faire douter du reste.
  for (const [lot, enveloppe] of Object.entries(parLot)) {
    const lignes = tachesPack.filter((t) => t.lot === (LOT_LABEL[lot] || lot));
    if (!lignes.length || !enveloppe) continue;
    const part = Math.floor(enveloppe / lignes.length);
    lignes.forEach((t) => { t.budgetPrevu = part; });
    lignes[0].budgetPrevu += enveloppe - part * lignes.length;
  }
  for (const [lot, depense] of Object.entries(engageParLot)) {
    const lignes = tachesPack.filter((t) => t.lot === (LOT_LABEL[lot] || lot));
    if (lignes.length) lignes[0].budgetDepense = depense;
  }

  const jalons = tachesPack.filter((t) => t.jalon)
    .map((t) => ({ id: t.id, titre: t.titre, date: t.fin, statut: t.statut, critique: t.critique }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const debut = tachesPack.map((t) => t.debut).filter(Boolean).sort()[0] || aujourdhui;
  // L'atterrissage vient de la chaîne, pas du plus grand dueDate : c'est lui qui
  // dit si la rentrée tient, et il diffère de la cible dès qu'une action glisse.
  const fin = ch.landing || cible || tachesPack.map((t) => t.fin).sort().slice(-1)[0] || debut;
  const finTotale = tachesPack.map((t) => t.fin).filter(Boolean).sort().slice(-1)[0] || fin;

  const projet = {
    id: o.id, nom: o.name ? `Ouverture du campus ${o.name}` : "Ouverture de campus",
    campusId: o.campusId || null,
    objectif: `Ouvrir le campus${o.city ? ` de ${o.city}` : ""} pour la rentrée du ${cible ? jourFR(cible) : "—"}, conforme et rempli : locaux recettés et autorisés, corps professoral complet, promotion recrutée.`,
    pilote: String(o.pilot || o.director || "").trim(),
    commanditaire: "Direction générale", sponsor: String(o.sponsor || "").trim() || "Direction générale",
    coSponsor: "", relaisDG: "Direction générale",
    contexte: String(o.context || "").trim() ||
      `Le réseau ouvre un campus${o.city ? ` à ${o.city}` : ""} pour la rentrée du ${cible ? jourFR(cible) : "—"}. Le rétroplanning compte ${tachesPack.length} actions réparties sur ${new Set(tachesPack.map((t) => t.lot)).size} chantiers et ${Object.keys(DEPT_LABEL).length} directions. ${jalons.length} jalons en marquent les étapes, et ${tachesPack.filter((t) => t.critique).length} actions sont sans marge : tout jour perdu sur l'une d'elles décale la rentrée d'autant.`,
    perimetre: "Étude et décision d'implantation, locaux et bail, aménagement et travaux, ouverture administrative et juridique, offre et pédagogie, recrutement du corps professoral et de l'équipe, systèmes d'information, marketing et admissions, lancement et pré-rentrée.",
    horsPerimetre: "L'exploitation courante du campus après la rentrée, qui bascule sur le directeur de campus. Les campus des vagues suivantes. La refonte du référentiel pédagogique.",
    statut: o.status === "ouvert" ? "termine" : "en_cours",
    debut, budget: budgetTotal,
    calendrier: { joursOuvres: [1, 2, 3, 4, 5], feries: true, alsaceMoselle: false, fermetures: [] },
    ressources: [], reference: null, archive: false,
    ...registresOuverture(o, cible),
    // Les registres saisis par l'utilisateur PRIMENT sur les valeurs par défaut :
    // sinon ses arbitrages seraient écrasés à chaque génération du pack.
    ...(o.risques?.length ? { risques: o.risques } : {}),
    ...(o.kpis?.length ? { kpis: o.kpis } : {}),
    ...(o.instances?.length ? { instances: o.instances } : {}),
    ...(o.trames?.length ? { trames: o.trames } : {}),
    ...(o.changements?.length ? { changements: o.changements } : { changements: [] }),
    ...(o.fournisseurs?.length ? { fournisseurs: o.fournisseurs } : { fournisseurs: [] }),
  };

  const plan = {
    ok: true, projet, calendrier: null, erreurs: [], taches: tachesPack, aujourdhui,
    debut, fin,
    resume: {
      debut, fin, cible, glissement: ch.slip || 0, atterrissage: ch.landing || cible,
      finTotale, apresRentree: tachesPack.filter((t) => t.apresRentree).length,
      dureeOuvree: null, aujourdhui,
      avancement: tachesPack.length ? Math.round((tachesPack.reduce((s, t) => s + t.avancement, 0) / tachesPack.length) * 1000) / 1000 : 0,
      taches: tachesPack.length, jalons,
      critiques: tachesPack.filter((t) => t.critique).map((t) => t.id),
      cheminLePlusLong: tachesPack.filter((t) => t.surCheminLePlusLong).map((t) => t.id),
      margeMin: (() => { const m = tachesPack.map((t) => t.margeTotale).filter((v) => v != null); return m.length ? Math.min(...m) : null; })(),
      horsMarge: ch.ruptures.filter((r) => r.slack != null && r.ownDelay > r.slack).length,
      ruptures: ch.ruptures, conflits: [], echeancesDepassees: [],
      budgetPrevu: tachesPack.reduce((s, t) => s + t.budgetPrevu, 0),
      budgetDepense: tachesPack.reduce((s, t) => s + t.budgetDepense, 0),
      budgetProjet: budgetTotal,
    },
  };
  return { projet, plan };
}

export { OPENING_DUREE_REF };

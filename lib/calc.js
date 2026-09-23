// Logique métier PURE (sans I/O) — extraite de server.js pour être testable unitairement.

// Marge d'exploitation (EBIT campus) = CA − masse salariale − autres charges.
export const marginOf = (k) => (k && k.revenue != null ? k.revenue - (k.payroll || 0) - (k.charges || 0) : null);

// Score de santé composite (0-100) : moyenne pondérée des dimensions disponibles.
// Retourne { score, detail:[{label, score}] } (detail trié pire → meilleur) pour l'explicabilité.
export function healthScore({ occupancy, qualiopi, overdue, visitDue, satisfaction, openIncidents }) {
  const parts = []; // [poids, score, label, réel?]
  if (occupancy != null) parts.push([0.30, Math.min(100, occupancy), "Remplissage", true]);
  if (qualiopi != null) parts.push([0.30, qualiopi, "Qualiopi", true]);
  parts.push([0.15, overdue > 0 ? Math.max(0, 100 - overdue * 20) : 100, "Actions à jour", false]);
  parts.push([0.10, visitDue ? 50 : 100, "Cadence visites", false]);
  if (satisfaction != null) parts.push([0.10, Math.max(0, Math.min(100, satisfaction * 10)), "Satisfaction", true]);
  parts.push([0.05, Math.max(0, 100 - (openIncidents || 0) * 15), "Incidents", false]);
  const w = parts.reduce((s, p) => s + p[0], 0);
  if (!w) return { score: null, detail: [], insufficient: true };
  // "Données insuffisantes" si moins de 2 facteurs de fond (remplissage / Qualiopi / satisfaction) renseignés.
  const realCount = parts.filter((p) => p[3]).length;
  return {
    score: Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / w),
    detail: parts.map((p) => ({ label: p[2], score: Math.round(p[1]), weight: Math.round((p[0] / w) * 100), points: Math.round((p[0] / w) * p[1]) })).sort((a, b) => a.score - b.score),
    insufficient: realCount < 2,
  };
}

// Année scolaire (sept → août) contenant `now`.
export function schoolYearRange(now = new Date()) {
  const m = now.getMonth() + 1, y = now.getFullYear();
  const startY = m >= 9 ? y : y - 1;
  return { startY, from: `${startY}-09`, to: `${startY + 1}-08`, label: `${startY}‑${startY + 1}` };
}

// Extrait la ventilation chiffrée des postes depuis le bloc ```json d'un P&L.
export function extractPnlPostes(content) {
  const m = (content || "").match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const p = d.postes;
    if (!p || typeof p !== "object") return null;
    const clean = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && x.label && x.amount != null && !isNaN(Number(x.amount))).map((x) => ({ label: String(x.label).trim(), amount: Number(x.amount) })) : []);
    const out = { month: typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month) ? p.month : null, revenue: clean(p.revenue), payroll: clean(p.payroll), charges: clean(p.charges) };
    if (!out.revenue.length && !out.payroll.length && !out.charges.length) return null;
    return out;
  } catch { return null; }
}

// --- Ouvertures de campus (rétroplanning) ---
export const OPENING_LOTS = [
  // La gouvernance du projet est un lot à part entière : sans note de cadrage, sans
  // registre des risques et sans jalons de décision intermédiaires, une ouverture
  // dérive sans que personne ne puisse dire quand elle a commencé à déraper.
  { k: "gouv", l: "Gouvernance du projet" },
  { k: "etude", l: "Étude & décision" },
  { k: "immo", l: "Locaux & immobilier" },
  { k: "travaux", l: "Aménagement & travaux" },
  { k: "admin", l: "Administratif & juridique" },
  { k: "offre", l: "Offre & pédagogie" },
  { k: "rh", l: "Recrutement & RH" },
  { k: "finance", l: "Finance & gestion" },
  { k: "si", l: "Systèmes d'information" },
  { k: "marketing", l: "Marketing & admissions" },
  { k: "lancement", l: "Lancement & rentrée" },
];
// --- Départements porteurs -------------------------------------------------
// Les LOTS decoupent le projet par nature de travail ; les DEPARTEMENTS disent qui
// porte. Ce sont deux axes differents : le lot « Aménagement & travaux » est un chantier,
// mais c est bien les Operations qui le pilotent. On garde les deux — le lot pour
// organiser le plan, le departement pour l engagement des equipes.
// Les Operations ont le LEAD du projet : elles portent la gouvernance, les locaux, les
// travaux, le SI, le juridique et le lancement.
export const OPENING_DEPTS = [
  { k: "ops", l: "Opérations", lead: true },
  { k: "commerce", l: "Commerce — recrutement élève" },
  { k: "com", l: "Marketing & communication" },
  { k: "academique", l: "Direction académique" },
  { k: "finance", l: "Finance" },
  { k: "rh", l: "Ressources humaines" },
];
const DEPT_PAR_LOT = { gouv: "ops", etude: "ops", immo: "ops", travaux: "ops", si: "ops",
  admin: "ops", lancement: "ops", offre: "academique", rh: "rh", finance: "finance", marketing: "com" };
// Deux lots sont partages : « marketing » melange conquete eleve et communication, et
// « administratif » melange juridique d exploitation et conformite pedagogique. On
// tranche par motif de titre plutot que d eclater les lots, qui structurent le plan.
// Les lots ne suffisent pas : « immobilier », « travaux » ou « administratif » portent
// chacun des actions dont un autre directeur repond (la caution bancaire est au DAF, la
// signaletique au marketing, le DUERP a la RH). Sans ces motifs, les Operations heritaient
// de 106 actions sur 176 par defaut — et les cinq autres directions n'avaient pas de quoi
// valider leur perimetre.
const DEPT_MOTIFS = [
  [/Parcoursup|Journées Portes Ouvertes|CRM admissions|Objectif de recrutement|Recensement des magasins|Conventions avec les enseignes|Lycées & CIO|salons & référencement|Onisep|Argumentaire commercial|remises, bourses|Campagne employeurs|équipe commerciale|techniques d'admission|Étude de marché local|Zone de chalandise|Vivier de recrutement|Débouchés locaux/i, "commerce"],
  // Frontieres de mots OBLIGATOIRES sur les acronymes : sans elles, « etablissement
  // seconDAire » matchait NDA et « diRECTEUR » matchait recteur — deux actions se
  // retrouvaient rattachees a la Direction academique sans rien y faire.
  [/\brectorat\b|\brecteur\b|\bUAI\b|Carif-Oref|Qualiopi|\bNDA\b|\bCFA\b|certificateur|\bjurys?\b|épreuves|positionnement|handicap|mobilité|référentiel BTS|Dimensionnement du plateau|Pré-rentrée|bilan pédagogique|dossier d'ouverture au rectorat/i, "academique"],
  [/Plan de communication|Signalétique|Autorisation d'enseigne|relations presse|porte-parole/i, "com"],
  [/\bDUERP\b|santé au travail|Affichages obligatoires|honorabilité du directeur|sécurité incendie|Déclarations sociales/i, "rh"],
  [/Business plan|Assurances|Souscription des assurances|caution bancaire|Dépôt de garantie|immobilisations|\bSIRET\b|\bKbis\b/i, "finance"],
];
// Base légale d'une tâche ENREGISTRÉE. On la résout depuis la clef du modèle
// plutôt que de la stocker : une référence recopiée dans le magasin vieillit
// sur place — corriger un texte dans le modèle ne l'atteindrait plus, et une
// tâche modifiée à la main garderait une référence devenue fausse.
export function loiDe(tache) {
  const k = tache?.loi || null;
  if (k && OPENING_SOURCES[k]) return k;
  const t = tache?.tplKey ? OPENING_TEMPLATE.find((x) => x.key === tache.tplKey) : null;
  return t?.loi && OPENING_SOURCES[t.loi] ? t.loi : null;
}

export function deptOf(t) {
  for (const [re, d] of DEPT_MOTIFS) if (re.test(t.title)) return d;
  return DEPT_PAR_LOT[t.lot] || "ops";
}

// --- Bases légales ---------------------------------------------------------
// Certaines échéances ne se négocient pas : elles sont posées par un texte ou
// par le calendrier d'un tiers. Les citer À CÔTÉ de la date change ce qu'on
// peut en faire — un COPIL qui veut gagner trois semaines doit savoir si la
// date vient d'une estimation de chef de projet ou de l'instruction d'une
// mairie. Sans la source, toute date se discute ; avec elle, on sait laquelle.
//
// N'entre ici que ce qui a été vérifié à la source. Un article inventé serait
// pire que pas d'article du tout : il ferait passer une approximation pour du
// droit.
export const OPENING_SOURCES = {
  "erp-at": {
    regle: "Instruction de QUATRE MOIS à compter du dossier complet ; au terme, le silence vaut accord. Toute pièce réclamée par la mairie fait repartir le délai à zéro.",
    texte: "Cerfa 13824 — autorisation de construire, d'aménager ou de modifier un ERP",
    url: "https://www.ecologie.gouv.fr/sites/default/files/documents/cerfa_13824-04.pdf",
  },
  "erp-ouverture": {
    regle: "La visite de la commission de sécurité se demande UN MOIS avant la date prévue d'ouverture (deux mois en 1re catégorie). Le maire autorise ensuite l'ouverture par arrêté, après avis de la commission.",
    texte: "Procédure d'autorisation d'ouverture d'un ERP",
    url: "https://www.aube.gouv.fr/Actions-de-l-Etat/Amenagement-du-territoire-urbanisme-construction-logement/Accessibilite/Une-commune-autorite-competente-pour-autoriser-l-ouverture-d-un-ERP/Les-procedures-d-autorisation-d-ouverture-d-un-ERP-au-public",
  },
  "gatel": {
    regle: "Le recteur transmet la déclaration au maire, au préfet et au procureur ; chacun peut s'opposer dans un délai de TROIS MOIS. L'ouverture n'est acquise qu'à l'expiration de ce délai.",
    texte: "Code de l'éducation, art. L731-1 et suivants",
    url: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006071191/LEGISCTA000006166692/",
  },
  "dommages-ouvrage": {
    regle: "Le maître d'ouvrage souscrit l'assurance dommages-ouvrage AVANT L'OUVERTURE DU CHANTIER. Une police signée le jour même ne couvre pas la journée qui commence.",
    texte: "Code des assurances, art. L242-1",
    url: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019265425",
  },
  "dpae": {
    regle: "Au plus tôt HUIT JOURS avant la prise de poste, au plus tard la veille. Une DPAE anticipée est irrecevable ; son absence vaut travail dissimulé.",
    texte: "Déclaration préalable à l'embauche — Urssaf",
    url: "https://www.urssaf.fr/accueil/employeur/embaucher-gerer-salaries/embaucher/declaration-prealable-embauche.html",
  },
  "nda": {
    regle: "Déclaration d'activité dans les TROIS MOIS suivant la signature de la première convention ou du premier contrat de formation ; la DREETS dispose de trente jours pour délivrer le récépissé sur dossier complet.",
    texte: "Code du travail, art. L6351-1 et R6351-6",
    url: "https://pays-de-la-loire.dreets.gouv.fr/FAQ-La-declaration-d-activite-des-organismes-de-formation",
  },
  "parcoursup": {
    regle: "Calendrier national imposé : la carte des formations s'ouvre à la mi-décembre, et la remontée des formations au rectorat se ferme avant. Le dossier suppose un UAI délivré.",
    texte: "Calendrier Parcoursup",
    url: "https://www.parcoursup.gouv.fr/calendrier",
  },
};

// --- Jalons ----------------------------------------------------------------
// Un jalon n'est pas « la dernière action d'un lot » : c'est un point où quelque
// chose est OBTENU ou DÉCIDÉ, et dont l'absence arrête le projet. La première
// version prenait la dernière échéance de chaque lot, ce qui donnait
// « Surveillance des ruptures de contrat des prestataires » comme jalon de
// clôture — vrai chronologiquement, absurde en comité.
//
// Ces vingt points sont ceux qu'une direction générale reconnaît : soit un tiers
// délivre (bail, arrêté, UAI, certificat), soit le comité tranche (Go/No-Go,
// filières, budget), soit un ouvrage est réceptionné. Chacun se répond par oui
// ou par non, ce qui est le test d'un jalon.
export const OPENING_JALONS = new Set([
  "gonogo", "financement",                                     // décision et argent
  "signature-bail", "depot-at-erp", "autorisation-erp",        // le lieu et le droit d'y toucher
  "filieres", "rncp",                                          // ce qu'on enseigne
  "demande-rectorat", "depot-rectorat", "pieces-rectorat", "autorisation-prefecture",
  "uai", "carif-oref", "nda", "qualiopi-audit", "parcoursup", "fin-opposition",  // ouverture administrative
  "presentation-directeur", "presentation-formateurs",         // ce que le terrain doit recevoir
  "lancement-recrut-directeur", "recrut-directeur", "arrivee-directeur",
  "lancement-recrut-pedago", "recrut-pedago", "contrats-travail",     // les gens
  "demarrage-chantier", "achevement-travaux", "reception-travaux",
  "livraison-optique", "passage-commission", "arrete-maire",   // le bâtiment et son autorisation
  "prerentree",                                                // la rentrée elle-même
]);

// --- Durée du plan et recalibrage ------------------------------------------
// Le modèle est écrit pour une ouverture en 15 mois. Raccourcir le projet n'est PAS une
// règle de trois : passé un certain point, les échéances ne sont plus des choix
// d'organisation mais des délais subis — instruction du Cerfa ERP, appel d'offres, durée
// de chantier, délai fournisseur, visite de la commission de sécurité. Les comprimer
// produirait un plan infaisable qui aurait l'air valide.
//
// On ne comprime donc QUE l'amont — étude, décision, recherche du local, négociation du
// bail, conception — et on laisse la chaîne contrainte intacte.
export const OPENING_DUREE_REF = 15;
// PIVOT — mesuré sur le chemin critique, pas supposé. Il passe par : consultation des
// entreprises → comparatif des devis → démarrage du chantier → achèvement du second œuvre
// → vérifications techniques → commission de sécurité → arrêté du maire → pré-rentrée.
// De M−7 à la rentrée, ce sont des durées subies : un appel d'offres, une durée de
// chantier, un mois de convocation de commission, un arrêté qui vient APRÈS l'avis.
// Rien là-dedans ne se négocie avec un chef de projet pressé.
//
// (Le pivot était d'abord placé à M−10,5, la déclaration au recteur. C'était une erreur
// de modèle : cette déclaration porte trois mois d'opposition mais elle a de la marge,
// alors que la conception et l'appel d'offres, eux, sont sur le chemin critique. Résultat,
// tout l'amont se tassait sur 1,5 mois et aucune durée sous 12 mois n'était atteignable.)
export const OPENING_PIVOT = 7;
// Plancher d'amont : en dessous, étudier le marché, décider, trouver le local, le négocier
// et faire concevoir l'aménagement ne tient plus, même avec un local déjà identifié.
export const OPENING_AMONT_MIN = 3;

// Certaines actions ne suivent pas la durée du PROJET mais le calendrier de RECRUTEMENT :
// il n'y a qu'une saison d'admissions par an, un seul cycle Parcoursup, une seule fenêtre
// de JPO. Les comprimer avec le reste envoie la campagne commerciale en janvier pour une
// rentrée de septembre — trop tard, quelle que soit la durée du projet.
// Ces actions portent `fixe: true` dans le modèle et gardent leur échéance.
export function recalibrer(m, duree = OPENING_DUREE_REF, fixe = false) {
  // Une action fixe garde son échéance, mais pas AVANT le début du projet : à la
  // durée minimale, les actions commerciales fixes (objectif de recrutement,
  // site, book) tombaient un mois avant la note de cadrage dont elles dépendent.
  // Le plan disait alors que l'objectif de recrutement est arrêté avant que le
  // projet soit cadré — une inversion qu'aucun COPIL ne peut exécuter.
  if (fixe) return Math.min(m, duree > 0 ? duree : m);
  if (!(duree > 0) || duree >= OPENING_DUREE_REF || m <= OPENING_PIVOT) return m;
  const ref = OPENING_DUREE_REF - OPENING_PIVOT;                       // l'amont du modèle
  const cible = Math.max(OPENING_AMONT_MIN, duree - OPENING_PIVOT);
  return Math.round((OPENING_PIVOT + (m - OPENING_PIVOT) * (cible / ref)) * 100) / 100;
}
// Durée minimale tenable — mesurée, pas déduite.
//
// Le plancher n'est PAS « le pivot plus le plancher d'amont » (10 mois) : ce
// calcul ignorait le délai d'instruction de l'autorisation de travaux ERP,
// QUATRE MOIS à compter du dossier complet. Sous onze mois, le dépôt tombe
// trop tard pour que l'autorisation existe avant le démarrage du chantier, et
// aucune compression d'amont n'y change quoi que ce soit : c'est une mairie
// qui instruit, pas une équipe projet.
//
// Mesuré sur le modèle : 10,75 mois donne 119 jours d'instruction, 11 mois en
// donne 125. Le seuil est donc à onze mois, et un projet annoncé plus court
// ouvre sans autorisation de travaux — c'est-à-dire n'ouvre pas.
export const OPENING_DUREE_MIN = 11;

// Modèle type — m = mois avant la rentrée (négatif = après). critical = chemin critique.
export const OPENING_TEMPLATE = [
  // ===== Gouvernance du projet =====
  { lot: "gouv", title: "Note de cadrage : périmètre, objectifs, critères de succès", m: 15, critical: true, key: "cadrage" },
  { lot: "gouv", title: "Constitution du COPIL hebdomadaire avec le COMEX & désignation du pilote", m: 15, critical: true },
  // Le COPIL est HEBDOMADAIRE et se tient avec le COMEX sur toute la duree du projet : il
  // n'y a donc plus ni COPIL mensuel ni reporting mensuel separe, la seance absorbe les deux.
  // Poser le calendrier des ~65 seances des le depart est un acte de projet a part entiere :
  // des agendas de direction ne se reservent pas au fil de l'eau.
  { lot: "gouv", title: "Calendrier annuel des COPIL hebdomadaires posé dans les agendas du COMEX", m: 15, critical: true },
  { lot: "gouv", title: "Matrice RACI : qui fait, qui valide, qui est consulté", m: 14 },
  { lot: "gouv", title: "Registre des risques & plan de mitigation", m: 14, critical: true },
  { lot: "gouv", title: "Budget de projet & modalités de suivi des écarts", m: 14 },
  { lot: "gouv", title: "Plan de communication du projet (interne, réseau, partenaires)", m: 12 },
  // Le COPIL hebdomadaire arbitre ; le comite technique, lui, traite le chantier dans le
  // detail. Les deux ne se remplacent pas : on ne fait pas passer une reserve de
  // desenfumage devant le COMEX.
  { lot: "gouv", title: "Comité technique hebdomadaire en phase travaux & équipement", m: 6 },
  { lot: "gouv", title: "Format du point hebdomadaire au COMEX : glissement, ruptures par coût, décisions attendues", m: 14 },
  { lot: "gouv", title: "Plan de repli si l'autorisation d'ouverture glisse (report ou site provisoire)", m: 3, critical: true },
  // Des jalons de décision ESPACÉS : un Go/No-Go unique en début de projet ne protège
  // de rien. On re-décide quand l'information nouvelle arrive — après les locaux,
  // après l'ERP, après les premières inscriptions.
  { lot: "gouv", title: "JALON — Go/No-Go après sécurisation des locaux", m: 8.5, critical: true , key: "jalon-locaux", after: ["signature-bail"] },
  { lot: "gouv", title: "JALON — Go/No-Go sur le niveau d'inscriptions (seuil de viabilité)", m: 2, critical: true , key: "jalon-inscriptions", after: ["objectif-recrut", "jpo"] },
  { lot: "gouv", title: "JALON — Go/No-Go après avis de la commission de sécurité", m: 1.25, critical: true , key: "jalon-commission", after: ["passage-commission"] },
  { lot: "gouv", title: "Revue de fin de projet & retour d'expérience capitalisé", m: -1 },

  // ===== Finance & gestion =====
  { lot: "finance", title: "Modèle économique : point mort et effectif minimum viable", m: 15, critical: true },
  { lot: "finance", title: "Plan de financement & apport en fonds propres", m: 14, critical: true , key: "financement", after: ["bp"] },
  { lot: "finance", title: "Prévisionnel de trésorerie mensuel sur 24 mois", m: 13, critical: true , key: "treso", after: ["financement"] },
  { lot: "finance", title: "Structure juridique : établissement secondaire ou société dédiée", m: 13, critical: true , key: "structure-jur", after: ["gonogo"] },
  { lot: "finance", title: "Ouverture du compte bancaire dédié & moyens de paiement", m: 10 },
  { lot: "finance", title: "Régime de TVA de la formation & obligations fiscales du site", m: 10 },
  { lot: "finance", title: "Tarification, échéanciers et modalités de financement (OPCO, CPF)", m: 8, critical: true, key: "tarification", after: ["bp"] },
  { lot: "finance", title: "Assurances : RC professionnelle, multirisque, dommages-ouvrage", m: 8, critical: true },
  { lot: "finance", title: "Suivi budgétaire mensuel : engagé vs réalisé", m: 6 },
  { lot: "finance", title: "Outils de facturation, d'encaissement et de relance", m: 4 },

  // ===== Systèmes d'information =====
  { lot: "si", title: "Raccordements opérateur : fibre, téléphonie (délais longs)", m: 8, critical: true , key: "raccordements", after: ["signature-bail"] },
  { lot: "si", title: "Choix du SI de scolarité & paramétrage du site", m: 6, critical: true , key: "si-scolarite", after: ["gonogo"] },
  { lot: "si", title: "RGPD : référent, registre des traitements, mentions, contrats sous-traitants", m: 4, critical: true },
  { lot: "si", title: "Reprise des données & interfaçage avec le SI du réseau", m: 3 },
  { lot: "si", title: "Création des comptes, adresses mail et annuaire du campus", m: 1.5, key: "comptes", after: ["si-scolarite", "contrats-travail"] },
  { lot: "si", title: "Sauvegardes, sécurité des accès et plan de continuité", m: 2 },

  { lot: "etude", title: "Étude de marché local & analyse concurrentielle", m: 15, critical: true , key: "etude-marche" },
  { lot: "etude", title: "Business plan & budget d'ouverture", m: 14, critical: true , key: "bp", after: ["etude-marche", "vivier"] },
  { lot: "etude", title: "Zone de chalandise : bassin d'emploi et lycées sources", m: 14.5 },
  { lot: "etude", title: "Vivier de recrutement : nombre de candidats atteignables", m: 14.5, critical: true , key: "vivier", after: ["etude-marche"] },
  { lot: "etude", title: "Débouchés locaux : magasins, enseignes, taux d'insertion", m: 13 },
  { lot: "etude", title: "Validation Go / No-Go direction", m: 13, critical: true , key: "gonogo", after: ["bp"] },
  // Le delai ERP force la prospection a demarrer AVANT le Go/No-Go : pour
  // deposer le 1er novembre, il faut un local arrete mi-octobre, alors que la
  // decision tombe le 1er novembre. Ce n'est pas un defaut de sequencement,
  // c'est ce qu'impose un projet de onze mois — et c'est une prise de risque a
  // nommer, pas a masquer derriere une dependance intenable.
  { lot: "immo", title: "Cahier des charges des locaux (surface, zone, ERP) — prospection engagee avant le Go/No-Go, a risque assume", m: 14.5 , key: "cdc-locaux", after: ["etude-marche"] },
  { lot: "immo", title: "Recherche & visites de locaux — local arrêté, sans quoi le dépôt ERP de novembre est manqué", m: 14.2, critical: true , key: "recherche-locaux", after: ["cdc-locaux"] },
  { lot: "immo", title: "Diagnostics techniques du bâtiment (amiante, plomb, structure, DPE)", m: 14, critical: true , key: "diagnostics", after: ["recherche-locaux"] },
  { lot: "immo", title: "Diagnostic d'accessibilité préalable du local", m: 14, critical: true , key: "diag-access", after: ["recherche-locaux"] },
  { lot: "immo", title: "Puissance électrique disponible pour l'atelier et les machines", m: 14, critical: true , key: "puissance-elec", after: ["recherche-locaux"] },
  { lot: "immo", title: "Négociation du bail commercial", m: 11, key: "negoc-bail", after: ["recherche-locaux", "diagnostics"] },
  { lot: "immo", title: "Conditions suspensives au bail : obtention de l'autorisation ERP", m: 10.5, critical: true , key: "cond-susp", after: ["negoc-bail"] },
  { lot: "immo", title: "Dépôt de garantie / caution bancaire", m: 9 },
  { lot: "immo", title: "Signature du bail", m: 9, critical: true , key: "signature-bail", after: ["cond-susp", "financement"] },
  // --- Parcours ERP (type R : établissements d'enseignement) ---
  // Une école est un ERP de type R. Le régime dépend du CLASSEMENT (type + catégorie
  // selon l'effectif), qui conditionne tout le reste : sans arrêté d'ouverture du
  // maire pris après avis de la commission de sécurité, l'établissement ne peut pas
  // accueillir de public. C'est le jalon le plus dur du rétroplanning.
  { lot: "immo", title: "Classement ERP : type R et catégorie selon l'effectif", m: 14, critical: true , key: "classement-erp", after: ["cdc-locaux"] },
  { lot: "immo", title: "DÉPÔT du dossier d'autorisation de travaux ERP (Cerfa 13824) : notice de sécurité + notice d'accessibilité", m: 13.4, critical: true, loi: "erp-at", key: "depot-at-erp", after: ["classement-erp", "diag-access", "plan-amenagement"] },
  { lot: "immo", title: "Autorisation de travaux ERP obtenue — instruction de QUATRE MOIS à compter du dossier complet, silence valant accord", m: 6.1, critical: true , loi: "erp-at", key: "autorisation-erp", after: ["depot-at-erp", "avis-access"] },
  { lot: "immo", title: "Avis de la commission d'accessibilite — rendu PENDANT l'instruction du dossier ERP, pas apres", m: 8 , key: "avis-access", after: ["depot-at-erp"] },
  { lot: "immo", title: "Vérifications techniques initiales par organisme agréé (électricité, désenfumage, SSI, alarme, extincteurs)", m: 3, critical: true , key: "verifs-tech", after: ["achevement-travaux"] },
  { lot: "immo", title: "Demande de visite de la commission de sécurité (1 mois avant, 2 mois en 1re catégorie)", m: 2.5, critical: true , loi: "erp-ouverture", key: "demande-visite", after: ["verifs-tech"] },
  { lot: "immo", title: "Passage de la commission de sécurité & levée des réserves", m: 1.5, critical: true , loi: "erp-ouverture", key: "passage-commission", after: ["demande-visite"] },
  { lot: "immo", title: "ARRÊTÉ D'OUVERTURE DU MAIRE — sans lui, pas d'accueil du public", m: 1, critical: true , loi: "erp-ouverture", key: "arrete-maire", after: ["passage-commission"] },
  { lot: "immo", title: "Registre de sécurité & registre public d'accessibilité ouverts", m: 0.75, key: "registres", after: ["arrete-maire"] },
  { lot: "immo", title: "Plan d'évacuation, consignes affichées & exercice d'évacuation", m: 0.75, key: "evacuation", after: ["arrete-maire"] },
  { lot: "immo", title: "Formation du personnel à la sécurité incendie", m: 0.5 },
  { lot: "immo", title: "État des lieux d'entrée contradictoire", m: 8.5, key: "edl-entree", after: ["signature-bail"] },
  { lot: "immo", title: "Sanitaires conformes ERP, local ménage et local déchets", m: 7 },
  { lot: "immo", title: "Contrôle d'accès, alarme intrusion & gestion des clés/badges", m: 3, critical: true , key: "controle-acces", after: ["achevement-travaux"] },
  { lot: "immo", title: "Stationnement, accès transports en commun & local vélos", m: 10 },
  { lot: "immo", title: "Contrats d'exploitation : énergie, eau, ménage, déchets", m: 3 },
  { lot: "immo", title: "Souscription des assurances : dommages-ouvrage OBLIGATOIRE avant l'ouverture du chantier (art. L242-1), multirisque, RC", m: 6.3, critical: true, loi: "dommages-ouvrage", key: "souscription-assur", after: ["devis"] },
  // --- Aménagement, équipement et approvisionnement ---
  // C'est ici que se perdent les ouvertures. Le matériel pédagogique d'optique
  // (réfracteurs, frontofocomètres, meuleuses) se commande des MOIS à l'avance :
  // une commande passée en juin pour une rentrée de septembre n'arrive pas.
  // Chaque commande porte donc son jalon de livraison, distinct de la commande.

  // Plans
  // Le relevé ne peut plus attendre la négociation du bail : il faut le local
  // mesuré pour dessiner, et le dessin pour déposer l'ERP en novembre.
  { lot: "travaux", title: "Relevé de l'existant & plans de l'état des lieux", m: 13.9, key: "releve", after: ["recherche-locaux"] },
  { lot: "travaux", title: "Plan d'aménagement : salles, atelier, administratif, espaces communs — avant-projet suffisant pour le dépôt ERP", m: 13.7, critical: true , key: "plan-amenagement", after: ["releve"] },
  { lot: "travaux", title: "Plan d'implantation du mobilier et des postes de travail", m: 9.5, key: "plan-mobilier", after: ["plan-amenagement"] },
  { lot: "travaux", title: "Plan des réseaux : courants forts, courants faibles, prises réseau", m: 9.5, critical: true , key: "plan-reseaux", after: ["plan-amenagement"] },
  { lot: "travaux", title: "Plan de calepinage de l'atelier (postes de montage, évacuation, aspiration)", m: 9.5, key: "calepinage", after: ["plan-amenagement", "puissance-elec"] },
  // Un atelier d'optique n'est pas une salle de cours avec des machines dedans.
  // Les meuleuses fonctionnent à l'arrosage : il faut l'eau, l'évacuation, et
  // surtout le traitement des effluents — les boues de meulage ne partent pas à
  // l'égout. Le polycarbonate, lui, se meule à sec : aspiration obligatoire.
  { lot: "travaux", title: "Alimentation en eau et évacuation des postes de meulage", m: 9, critical: true , key: "eau-meulage", after: ["calepinage"] },
  { lot: "travaux", title: "Traitement des effluents de meulage : décanteur ou circuit fermé", m: 9, critical: true , key: "effluents", after: ["calepinage"] },
  { lot: "travaux", title: "Aspiration des poussières (meulage à sec du polycarbonate)", m: 9, critical: true , key: "aspiration", after: ["calepinage"] },
  { lot: "travaux", title: "Contrat d'enlèvement des déchets d'atelier (verres, boues de meulage)", m: 2 },
  // L'examen de vue exige des conditions photométriques maîtrisées : une salle de
  // réfraction mal éclairée fausse les mesures et l'apprentissage.
  { lot: "travaux", title: "Salles de réfraction : occultation et éclairage photométrique maîtrisé", m: 9, critical: true , key: "salles-refraction", after: ["plan-amenagement"] },
  { lot: "travaux", title: "Distance de réfraction conforme (recul ou miroir) dans chaque box", m: 8.5, critical: true , key: "distance-refraction", after: ["salles-refraction"] },

  // Consultation et marchés
  { lot: "travaux", title: "Consultation des entreprises & appel d'offres travaux", m: 7 , key: "appel-offres", after: ["plan-amenagement", "plan-reseaux", "calepinage"] },
  { lot: "travaux", title: "Comparatif des devis & sélection des entreprises", m: 6.8, critical: true , key: "devis", after: ["appel-offres"] },
  // Le PLATEAU TECHNIQUE est ce qui distingue une école d'optique d'une salle de
  // classe. Le BTS OL prépare à une profession réglementée et comporte des épreuves
  // pratiques : sans plateau conforme au référentiel, la formation ne peut pas être
  // dispensée ni les épreuves organisées. Il se dimensionne PAR NOMBRE D'ÉTUDIANTS,
  // pas au forfait — c'est le premier chiffrage à faire, et le plus lourd du budget.
  { lot: "travaux", title: "Dimensionnement du plateau technique : nombre de postes par effectif", m: 9, critical: true , key: "dim-plateau", after: ["gonogo", "filieres"] },
  { lot: "travaux", title: "Conformité du plateau au référentiel BTS OL (à faire valider avant commande)", m: 8, critical: true , key: "conf-plateau", after: ["dim-plateau"] },
  { lot: "travaux", title: "Chiffrage détaillé de l'équipement pédagogique, poste par poste", m: 7, critical: true , key: "chiffrage-equip", after: ["conf-plateau"] },

  // Commandes — délais longs, à passer tôt
  { lot: "travaux", title: "COMMANDE postes de réfraction (réfracteurs, projecteurs de tests, fauteuils)", m: 6, critical: true , family: "refraction", needM: 1.5 , key: "cmd-refraction", after: ["chiffrage-equip", "financement"] },
  { lot: "travaux", title: "COMMANDE instruments d'examen (lampes à fente, kératomètre, autoréfractomètre)", m: 6, critical: true , family: "instruments", needM: 1.5 , key: "cmd-instruments", after: ["chiffrage-equip", "financement"] },
  { lot: "travaux", title: "COMMANDE frontofocomètres & matériel de contrôle", m: 6, critical: true , family: "frontofocometres", needM: 1.5 , key: "cmd-frontofo", after: ["chiffrage-equip", "financement"] },
  { lot: "travaux", title: "COMMANDE matériel de contactologie & consommables associés", m: 5, critical: true , family: "contactologie", needM: 1.5 , key: "cmd-contacto", after: ["chiffrage-equip", "financement"] },
  { lot: "travaux", title: "COMMANDE équipement atelier (meuleuse, traceuse, poste de montage, aspiration)", m: 6, critical: true , family: "atelier", needM: 1.5 , key: "cmd-atelier", after: ["chiffrage-equip", "calepinage", "financement"] },
  { lot: "travaux", title: "COMMANDE mobilier (salles, atelier, administratif, espaces de détente)", m: 5, critical: true , family: "mobilier", needM: 1.5 , key: "cmd-mobilier", after: ["plan-mobilier", "financement"] },
  { lot: "travaux", title: "COMMANDE informatique & audiovisuel (postes, vidéoprojecteurs, écrans)", m: 4 , family: "informatique", needM: 1 , key: "cmd-informatique", after: ["plan-reseaux", "financement"] },
  { lot: "travaux", title: "Suivi des délais de livraison & relances fournisseurs", m: 3, critical: true , key: "suivi-delais", after: ["cmd-refraction", "cmd-atelier", "cmd-mobilier"] },

  // Réalisation et réception
  { lot: "travaux", title: "Achèvement des travaux & fin du second œuvre", m: 3.5, critical: true , key: "achevement-travaux", after: ["demarrage-chantier", "eau-meulage", "effluents", "aspiration", "salles-refraction"] },
  { lot: "travaux", title: "Réception des travaux & levée des réserves", m: 2, critical: true , key: "reception-travaux", after: ["achevement-travaux"] },

  // Livraisons et mise en service
  { lot: "travaux", title: "LIVRAISON & montage du mobilier", m: 1.5, critical: true , key: "livraison-mobilier", after: ["cmd-mobilier", "reception-travaux"] },
  { lot: "travaux", title: "LIVRAISON, installation & mise en service de l'équipement optique", m: 1.5, critical: true , key: "livraison-optique", after: ["cmd-refraction", "cmd-instruments", "cmd-frontofo", "cmd-contacto", "cmd-atelier", "reception-travaux"] },
  { lot: "travaux", title: "Calibration & vérification métrologique des appareils de mesure", m: 1, critical: true , key: "calibration", after: ["livraison-optique"] },
  { lot: "travaux", title: "Protocole d'hygiène du matériel en contact (montures d'essai, réfracteurs, lentilles)", m: 1, critical: true , key: "hygiene", after: ["livraison-optique"] },
  { lot: "travaux", title: "Stock de démarrage : montures d'essai, verres de démonstration, jeux de tests", m: 2 },
  { lot: "travaux", title: "Formation des équipes à l'usage des équipements", m: 0.5 , key: "formation-equip", after: ["calibration", "recrut-pedago"] },

  // Consommables et exploitation
  { lot: "travaux", title: "COMMANDE consommables de démarrage (verres de démonstration, montures d'essai, petit outillage)", m: 2 , family: "consommables", needM: 0.5 },
  { lot: "travaux", title: "COMMANDE fournitures administratives & produits d'entretien", m: 1 , family: "fournitures", needM: 0.5 },
  { lot: "travaux", title: "Inventaire, étiquetage & inscription aux immobilisations", m: 0.5 , key: "inventaire", after: ["livraison-optique", "livraison-mobilier"] },
  { lot: "travaux", title: "Contrats de maintenance & de vérification périodique des équipements", m: 0.5 },
  { lot: "travaux", title: "Câblage courants faibles, prises réseau & bornes wifi", m: 4.5, key: "cablage", after: ["plan-reseaux", "demarrage-chantier"] },
  { lot: "travaux", title: "Démarrage du chantier & second œuvre — au plus tard février-mars pour une rentrée de septembre", m: 6, fixe: true, critical: true , key: "demarrage-chantier", after: ["devis", "autorisation-erp", "edl-entree"] },
  { lot: "travaux", title: "Mise en service informatique, wifi & téléphonie", m: 3, critical: true , key: "mise-service-info", after: ["cablage", "raccordements", "cmd-informatique"] },
  { lot: "travaux", title: "Signalétique intérieure & extérieure", m: 2, key: "signaletique", after: ["charte", "achevement-travaux"] },
  { lot: "admin", title: "Création établissement / SIRET secondaire", m: 11.5, key: "siret", after: ["kbis"] },
  // Déclaration d'ouverture (loi Gatel, 13 avril 2018) : le recteur la transmet au
  // maire, au préfet et au procureur, et CHACUN peut s'opposer dans un délai de
  // TROIS MOIS à compter du dossier complet. Déposer tard, c'est décaler la rentrée.
  // Formalite d'enregistrement, pas une autorisation : rien ne se purge, rien n'attend.
  // Le PROCESS varie d'un rectorat à l'autre pour la formation initiale : ce
  // qu'il faut fournir, sous quelle forme, et si la préfecture doit être
  // saisie. On demande donc le dossier au rectorat concerné dès le lancement,
  // avant même le SIRET — c'est une prise de contact, pas un dépôt, et elle
  // conditionne tout le calendrier administratif qui suit.
  // m:15 sans dépendance, comme la note de cadrage et l'étude de marché : c'est
  // une action de JOUR UN. Placée à 11,5 mois elle retombait fin novembre après
  // recalibrage, soit deux mois perdus à attendre un dossier qu'un appel suffit
  // à demander. Elle n'attend pas le cadrage : on ne signe rien pour écrire au
  // rectorat, et sa réponse conditionne la suite.
  { lot: "admin", title: "Demande du dossier d'ouverture au rectorat concerné, dès le lancement — le process diffère d'un rectorat à l'autre", m: 15, critical: true, loi: "gatel", key: "demande-rectorat" },
  { lot: "admin", title: "Dépôt du dossier d'ouverture au rectorat (formalité d'enregistrement)", m: 11, loi: "gatel", key: "depot-rectorat", after: ["siret", "demande-rectorat"] },
  // Double ouverture initiale + alternance : le rectorat peut exiger des photos
  // des locaux et l'autorisation préfectorale. Les photos ne peuvent pas
  // précéder les travaux — c'est ce qui rend ces pièces tardives alors que le
  // dépôt, lui, est précoce. Les traiter comme un complément au dossier évite
  // de croire le dossier clos dès son dépôt.
  { lot: "admin", title: "Pièces complémentaires exigées par le rectorat : photos des locaux aménagés, plans, effectifs", m: 2.5, critical: true, key: "pieces-rectorat", after: ["demande-rectorat", "achevement-travaux"] },
  { lot: "admin", title: "Autorisation préfectorale d'ouverture, si le rectorat la demande (fréquent en double ouverture initiale + alternance)", m: 2, critical: true, key: "autorisation-prefecture", after: ["pieces-rectorat"] },
  { lot: "admin", title: "Fin du délai d'opposition de trois mois (recteur, maire, préfet, procureur) — l'ouverture n'est acquise qu'à ce terme", m: 6, critical: true, loi: "gatel", key: "fin-opposition", after: ["depot-rectorat"] },
  { lot: "admin", title: "Vérification des conditions de diplôme et d'honorabilité du directeur", m: 7 },
  // Obligations d'employeur, systématiquement oubliées dans les rétroplannings d'ouverture.
  { lot: "admin", title: "DUERP — document unique d'évaluation des risques professionnels", m: 2 },
  { lot: "admin", title: "Adhésion au service de santé au travail & visites d'embauche", m: 2 },
  { lot: "admin", title: "Affichages obligatoires (horaires, convention collective, sécurité)", m: 1 },
  { lot: "admin", title: "PPMS — plan particulier de mise en sûreté", m: 1 },
  // Remonté à M-10 : c'est le code UAI qui identifie l'établissement sur la
  // plateforme de répartition de la taxe. Le demander après avoir déposé la
  // demande d'habilitation n'a pas de sens — et le guichet, lui, ferme en janvier.
  { lot: "admin", title: "Demande de numéro UAI", m: 11, critical: true, key: "uai", after: ["siret"] },
  // L'immatriculation cree l'etablissement ; elle ne dit pas QUI l'engage ni qui repond
  // de sa securite. Sans delegation ecrite, le dirigeant du reseau reste penalement
  // responsable d'un ERP qu'il n'exploite pas — et le directeur ne peut rien signer.
  { lot: "admin", title: "Délégation de pouvoirs au directeur de l'établissement secondaire (engagement, signature, sécurité ERP)", m: 5, critical: true , key: "delegation", after: ["recrut-directeur", "kbis"] },
  // Un etablissement secondaire a ses propres obligations declaratives : elles ne
  // decoulent pas de celles du siege.
  { lot: "admin", title: "Déclarations sociales de l'établissement : URSSAF, retraite, prévoyance", m: 2.5 , key: "declarations-sociales", after: ["siret"] },
  { lot: "admin", title: "Référencement Carif-Oref : saisie de l'offre dans la base nationale", m: 10.5, critical: true , key: "carif-oref", after: ["uai", "rncp"] },
  // Ordre imposé : NDA d'abord (DREETS, via Mon Activité Formation), Qualiopi ensuite.
  // La declaration se depose dans les trois mois suivant la premiere convention,
  // mais sans NDA il n'y a ni certification ni financement possible.
  { lot: "admin", title: "NDA — déclaration d'activité à la DREETS : dans les 3 mois suivant la 1re convention signée, récépissé sous 30 jours (préalable à Qualiopi)", m: 8, critical: true , loi: "nda", key: "nda", after: ["siret"] },
  { lot: "admin", title: "Formalités CFA propres à l'apprentissage", m: 7, critical: true , key: "cfa", after: ["nda"] },
  // LE GUICHET QUI FERME QUATRE MOIS AVANT LA CAMPAGNE. Les demandes
  // d'habilitation se déposent de novembre à janvier, alors que la répartition
  // court de mai à octobre. Un organisme qui y pense au printemps découvre que
  // le guichet est fermé depuis janvier : aucun solde pour l'année, sans
  // rattrapage. C'est pourquoi cette tâche est posée tôt et en chemin critique.
  { lot: "admin", title: "Habilitation à percevoir le solde de la taxe d'apprentissage (SOLTéA) — guichet novembre à janvier", m: 9, critical: true, key: "taxe-hab", after: ["uai"] },
  // Le dépôt du contrat conditionne le financement, et le silence de l'opérateur
  // vaut refus : un contrat que l'on croit validé parce que personne n'a répondu
  // est un contrat non financé.
  { lot: "admin", title: "Procédure de dépôt des contrats d'apprentissage auprès de l'opérateur de compétences", m: 3, critical: true, key: "depot-contrats", after: ["cfa"] },
  { lot: "admin", title: "Enquête annuelle sur les effectifs d'apprentis (SIFA) — calendrier et responsable désignés", m: 1, key: "sifa", after: ["cfa"] },
  { lot: "admin", title: "Audit Qualiopi d'extension de site & obtention du certificat", m: 4, critical: true , key: "qualiopi-audit", after: ["qualiopi-prep"] },
  { lot: "admin", title: "Kbis de l'établissement secondaire & inscription au RCS", m: 12, critical: true , key: "kbis", after: ["structure-jur"] },
  { lot: "admin", title: "Autorisation d'enseigne : déclaration préalable en mairie", m: 5 },
  { lot: "admin", title: "Calendrier du bilan pédagogique et financier (obligation annuelle)", m: -1 },
  { lot: "admin", title: "Préparation du dossier Qualiopi (extension de périmètre)", m: 5, critical: true , key: "qualiopi-prep", after: ["nda", "filieres"] },
  { lot: "offre", title: "Définition des filières & maquettes pédagogiques", m: 12, critical: true , key: "filieres", after: ["gonogo"] },
  { lot: "offre", title: "Titres RNCP / certifications & agréments", m: 11, critical: true , key: "rncp", after: ["filieres"] },
  { lot: "offre", title: "Référent handicap & référent mobilité désignés", m: 5, critical: true },
  { lot: "offre", title: "Habilitation par le certificateur du titre (si titre porté par un tiers)", m: 9, critical: true , key: "habilitation", after: ["rncp"] },
  // Le BTS OL mene a une profession reglementee : les epreuves pratiques se passent
  // sur plateau, et l'alternance suppose des maitres d'apprentissage opticiens.
  { lot: "offre", title: "Organisation des épreuves pratiques : plateau, surveillance, jury", m: 3, critical: true , key: "epreuves-pratiques", after: ["habilitation", "conf-plateau"] },
  { lot: "offre", title: "Vivier de maîtres d'apprentissage opticiens diplômés (conditions d'expérience)", m: 8, critical: true , key: "maitres-apprentissage", after: ["conventions-enseignes"] },
  { lot: "offre", title: "Encadrement des actes pratiqués par les étudiants & couverture assurantielle", m: 5, critical: true },
  { lot: "offre", title: "Test de positionnement à l'entrée & modalités d'adaptation", m: 4, critical: true },
  { lot: "offre", title: "Modalités d'évaluation, jurys et organisation des examens", m: 3 },
  { lot: "offre", title: "Conventions types : stage, alternance, contrat de formation", m: 4, critical: true },
  // « Préétabli » est le mot de l'article L. 6353-1 : un programme reconstitué
  // après coup depuis le planning réalisé est une pièce antidatée.
  { lot: "offre", title: "Programme de formation préétabli : objectifs, prérequis, moyens, modalités d'évaluation", m: 6, critical: true, key: "programme" },
  // Au-delà de 500 heures, l'élection de délégués n'est plus une bonne pratique.
  { lot: "offre", title: "Modalités de représentation des stagiaires : élection de délégués au-delà de 500 heures", m: 5, key: "delegues" },
  // Deux dispositifs que le décret impose de garder DISTINCTS : un questionnaire
  // unique ne couvre ni l'un ni l'autre.
  { lot: "offre", title: "Deux dispositifs d'enquête distincts : satisfaction générale, et évaluation des enseignements par les apprenants", m: 3, key: "enquetes" },
  { lot: "offre", title: "Règlement intérieur & livret d'accueil apprenant", m: 3 },
  { lot: "offre", title: "Conseil de perfectionnement : composition et première réunion", m: 2 },
  { lot: "offre", title: "Conventions de stage & d'alternance avec les magasins indépendants", m: 7 },
  { lot: "offre", title: "Présentation des programmes et de l'organisation académique au directeur de campus — avec le PRN et le responsable pédagogique initiale France", m: 4.5, critical: true, key: "presentation-directeur", after: ["arrivee-directeur", "filieres"] },
  { lot: "offre", title: "Présentation des programmes et de l'organisation académique aux formateurs, en amont de la rentrée", m: 1.5, critical: true, key: "presentation-formateurs", after: ["presentation-directeur", "recrut-pedago"] },
  { lot: "offre", title: "Calendrier académique & emplois du temps", m: 3 , key: "edt", after: ["filieres", "recrut-pedago"] },
  { lot: "rh", title: "Organigramme cible & masse salariale associée", m: 12, critical: true , key: "organigramme", after: ["bp"] },
  { lot: "rh", title: "Fiches de poste & grille de classification (convention collective)", m: 11 , key: "fiches-poste", after: ["organigramme"] },
  // Un recrutement ne se comprime pas avec la durée du projet : il suit le
  // calendrier de l'emploi. Un cadre se source en deux à trois mois et pose
  // trois mois de préavis ; un formateur en poste démissionne au printemps pour
  // septembre, et le vivier est vide après juin. Ces échéances sont donc `fixe`,
  // comme la rampe commerciale — c'est le même défaut de modèle, corrigé de la
  // même façon.
  //
  // Le modèle ne portait que la CLÔTURE du recrutement. Il manquait les deux
  // bouts, qui sont justement ce qui coince sur un projet court : le jour où la
  // recherche démarre, et le jour où la personne est réellement là.
  // m:15 sans `fixe` : la valeur se recalibre sur la durée retenue et tombe donc
  // toujours au PREMIER JOUR du projet, qu'il dure dix mois ou quinze.
  { lot: "rh", title: "Lancement du recrutement du directeur de campus : profil, cabinet ou annonce, sourcing — dès le lancement du projet", m: 15, critical: true, key: "lancement-recrut-directeur" },
  // Trois mois de recherche pour un cadre, quelle que soit la durée du projet :
  // l'échéance est `fixe`. La comprimer ne raccourcit pas un sourcing, elle
  // raccourcit seulement la case du planning.
  { lot: "rh", title: "Recrutement du directeur de campus : promesse d'embauche signée", m: 8, fixe: true, critical: true , key: "recrut-directeur", after: ["lancement-recrut-directeur", "fiches-poste"] },
  // Le préavis est le délai que personne ne met au plan, et c'est lui qui décide
  // si le directeur est là pour recruter son équipe ou s'il la découvre.
  { lot: "rh", title: "Arrivée effective du directeur de campus (fin de préavis — compter trois mois pour un cadre)", m: 5, fixe: true, critical: true, key: "arrivee-directeur", after: ["recrut-directeur"] },
  // Le directeur n'est pas encore en poste quand son équipe se recrute : c'est
  // la direction académique et la RH réseau qui mènent, avec le directeur
  // pressenti en jury dès sa promesse signée. Le plan doit le dire, sinon il
  // suppose une présence qui n'existe pas avant avril.
  { lot: "rh", title: "Lancement du recrutement de l'équipe pédagogique : annonces, bassin local, professionnels en exercice", m: 8.5, fixe: true, critical: true, key: "lancement-recrut-pedago", after: ["filieres", "fiches-poste"] },
  { lot: "rh", title: "Recrutement de l'équipe pédagogique : promesses signées", m: 6, fixe: true, critical: true , key: "recrut-pedago", after: ["lancement-recrut-pedago", "recrut-directeur", "habilitation"] },
  { lot: "rh", title: "Recrutement de l’équipe admissions sur place", m: 7, fixe: true, key: "recrut-admin", after: ["recrut-directeur"] },
  { lot: "rh", title: "Sourcing vacataires & intervenants pro", m: 4 },
  { lot: "rh", title: "Contrats de travail signés & registre unique du personnel", m: 2, critical: true , key: "contrats-travail", after: ["recrut-pedago", "recrut-admin"] },
  // Fenetre legale etroite : au plus tot huit jours avant la prise de poste,
  // au plus tard la veille. Ni avant, ni apres.
  { lot: "rh", title: "DPAE — au plus tôt 8 jours avant la prise de poste, au plus tard la veille (une DPAE anticipée est irrecevable)", m: 0.6, fixe: true, critical: true, loi: "dpae", key: "dpae", after: ["contrats-travail"] },
  { lot: "rh", title: "Mise en place de la paie (prestataire ou interne)", m: 2, critical: true , key: "paie", after: ["contrats-travail"] },
  { lot: "rh", title: "Mutuelle, prévoyance & affiliation des salariés", m: 2 },
  { lot: "rh", title: "Représentation du personnel si l'effectif l'impose", m: 1 },
  { lot: "rh", title: "Onboarding & formation des équipes", m: 1 },
  // --- Relations locales ---
  // Les seuls contacts avec la ville etaient des depots de dossier (declaration
  // d enseigne, arrete du maire). Une implantation se prepare AVEC la collectivite :
  // prevenue tot, elle facilite ; decouverte au moment de l arrete, elle instruit.
  { lot: "marketing", title: "Prise de contact avec la mairie : présentation du projet et du calendrier", m: 12, critical: true , key: "mairie-contact", after: ["gonogo"] },
  { lot: "marketing", title: "Services de la ville : urbanisme, voirie, transports, stationnement", m: 11 , key: "services-ville", after: ["mairie-contact"] },
  { lot: "marketing", title: "Élus locaux & intercommunalité : soutien à l'implantation", m: 11 , key: "elus", after: ["mairie-contact"] },
  { lot: "marketing", title: "Acteurs économiques locaux : CCI, club d'entreprises, mission locale", m: 9 , key: "acteurs-eco", after: ["mairie-contact"] },
  { lot: "marketing", title: "Lycées & CIO du bassin : interventions, forums d'orientation", m: 10 , key: "lycees", after: ["recensement-magasins"] },
  { lot: "marketing", title: "Presse & médias locaux : annonce de l'implantation", m: 6 , key: "presse-amont", after: ["identite"] },
  { lot: "marketing", title: "Riverains & commerces voisins : information chantier, flux et stationnement", m: 5 , key: "riverains", after: ["demarrage-chantier"] },
  { lot: "marketing", title: "Identité locale & supports de communication", m: 10 , key: "identite", after: ["gonogo"] },
  { lot: "marketing", title: "Déclinaison de la charte du réseau : façade, intérieur, supports du campus", m: 7 , key: "charte", after: ["identite", "plan-amenagement"] },
  // ── Rampe commerciale : calée sur le calendrier d'ADMISSIONS, pas sur la durée du
  // projet. Une rentrée de septembre se vend à partir d'octobre : le site ouvert, le book
  // com' en main, l'offre entreprises lancée et les objectifs posés. Décaler d'un trimestre,
  // c'est rater la saison — on ne la rattrape pas, elle revient l'année suivante.
  // (Retour Yvan Perrière, 18 septembre 2026.)
  { lot: "marketing", title: "Site / landing page du campus, avec formulaires de candidature", m: 11, fixe: true, critical: true, key: "site", after: ["cadrage"] },
  // Le book com' est ce que l'équipe admissions a dans les mains : sans lui, elle décrit
  // l'offre de mémoire et les tarifs circulent à l'oral.
  { lot: "marketing", title: "Book com' admissions : plaquette, argumentaire, grille tarifaire", m: 11, fixe: true, critical: true, key: "book-com", after: ["cadrage"] },
  // L'offre entreprises se lance en même temps que l'offre élève : les contrats
  // d'alternance se négocient un an avant la rentrée, pas trois mois avant.
  { lot: "marketing", title: "Offre BtoB entreprises : catalogue, tarifs, lancement commercial", m: 11, fixe: true, critical: true, key: "offre-btob", after: ["cadrage"] },
  // Les JPO virtuelles ouvrent la saison : elles ne demandent pas de local fini, donc rien
  // n'empêche de les tenir tôt — et elles alimentent le pipeline bien avant que les JPO
  // sur site ne soient possibles.
  { lot: "marketing", title: "Journées Portes Ouvertes VIRTUELLES (série)", m: 10, fixe: true, critical: true, key: "jpo-virtuelles", after: ["site", "book-com"] },
  { lot: "marketing", title: "Plan média & campagnes d'acquisition", m: 10, fixe: true, critical: true , key: "plan-media", after: ["site"] },
  { lot: "marketing", title: "Dossier Parcoursup remonté au rectorat — la carte des formations ouvre à la mi-décembre et le dossier suppose l'UAI : si l'UAI arrive en décembre, la 1re promotion se recrute en admission directe", m: 9.9, critical: true , loi: "parcoursup", key: "parcoursup", after: ["uai", "carif-oref"] },
  // Dans l'optique, l'alternance se joue avec les enseignes et les independants du
  // bassin : sans magasins partenaires, pas d'alternants, donc pas de promotion.
  { lot: "marketing", title: "Recensement des magasins d'optique du bassin & prise de contact", m: 11, critical: true , key: "recensement-magasins", after: ["etude-marche"] },
  { lot: "marketing", title: "Conventions avec les enseignes (alternance, taxe d'apprentissage)", m: 9, critical: true , key: "conventions-enseignes", after: ["offre-btob"] },
  { lot: "marketing", title: "Partenariats verriers & fournisseurs (dotation matériel, interventions)", m: 9 },
  { lot: "marketing", title: "Référencement Onisep, annuaires et plateformes d'orientation", m: 9 },
  { lot: "marketing", title: "Calendrier salons & référencement (Parcoursup, etc.)", m: 9, critical: true },
  { lot: "marketing", title: "Argumentaire commercial & messages clés (offre, débouchés, financement)", m: 9 , key: "argumentaire", after: ["rncp", "filieres"] },
  { lot: "marketing", title: "Politique de remises, bourses et échelonnement", m: 8 , key: "remises", after: ["tarification"] },
  { lot: "marketing", title: "Campagne employeurs : capter les contrats d'alternance du bassin", m: 8, critical: true , key: "campagne-employeurs", after: ["conventions-enseignes"] },
  { lot: "marketing", title: "Achat média & leads : budget, canaux, coût par inscrit", m: 7 , key: "achat-leads", after: ["plan-media"] },
  { lot: "marketing", title: "CRM admissions & process de traitement", m: 7 , key: "crm", after: ["site"] },
  { lot: "marketing", title: "Formation de l'équipe commerciale : offre, métier d'opticien, débouchés", m: 4 , key: "formation-offre", after: ["recrut-admin", "argumentaire"] },
  { lot: "marketing", title: "Formation aux techniques d'admission : entretien, objections, CRM", m: 4 , key: "formation-vente", after: ["recrut-admin", "crm"] },
  { lot: "marketing", title: "Journées Portes Ouvertes SUR SITE (série)", m: 5, critical: true , key: "jpo", after: ["jpo-virtuelles", "plan-media"] },
  { lot: "marketing", title: "Objectifs de recrutement par filière & suivi du pipeline", m: 11, fixe: true, critical: true , key: "objectif-recrut", after: ["cadrage"] },
  { lot: "lancement", title: "Pré-rentrée (accueil, EDT, comptes, badges)", m: 0.5, critical: true , key: "prerentree", after: ["arrete-maire", "livraison-optique", "livraison-mobilier", "contrats-travail", "mise-service-info", "edt", "comptes", "depot-rectorat", "pieces-rectorat", "autorisation-prefecture", "presentation-formateurs", "qualiopi-audit"] },
  { lot: "lancement", title: "Répétition générale : parcours étudiant de bout en bout", m: 0.25, critical: true , key: "repetition", after: ["prerentree"] },
  { lot: "lancement", title: "Plan de communication de crise & porte-parole désigné", m: 1 },
  { lot: "lancement", title: "Logistique jour J & répétition", m: 0.1, key: "logistique-jourj", after: ["repetition"] },
  { lot: "lancement", title: "Communication de lancement & relations presse", m: 1 },
  // Les ruptures se concentrent sur les premiers mois, et seule une rencontre
  // associant l'entreprise vaut suivi de l'alternance.
  { lot: "lancement", title: "Premier suivi tripartite apprenti / entreprise / CFA", m: -2, key: "tripartite" },
  { lot: "lancement", title: "Surveillance des ruptures de contrat des premiers mois", m: -3, key: "ruptures" },
  { lot: "lancement", title: "Bilan d'ouverture & plan d'amélioration", m: -1 },
];
// Les familles d'engagement pilotables sont DÉDUITES du modèle, jamais recopiées :
// une liste parallèle finirait par diverger du jour où une commande est ajoutée,
// et le délai saisi par l'utilisateur ne s'appliquerait plus à rien, en silence.
const SEM = 4.345; // semaines par mois
export const OPENING_FAMILIES = OPENING_TEMPLATE.filter((t) => t.family).map((t) => ({
  k: t.family,
  label: t.title.replace(/^COMMANDE /, ""),
  needM: t.needM,
  // Délai implicite du modèle = ce qu'il suppose aujourd'hui. Affiché comme repère
  // pour que l'utilisateur voie ce qu'il corrige quand il saisit son délai réel.
  defaultLeadWeeks: Math.round((t.m - t.needM) * SEM),
}));

// Arithmétique de dates en UTC, jamais en heure locale. `setDate(getDate() - n)` opère en
// LOCAL sur une date parsée en UTC : au franchissement d'un changement d'heure, le
// résultat recule d'un jour. Symptôme observé : après « recalculer les échéances », onze
// tâches d'un plan sain redevenaient en retard et la rentrée glissait d'un jour, sans que
// rien n'ait changé. Un aller-retour date ↔ offset doit être exact.
export const J_MS = 86400000;
export const dateMoinsJours = (base, jours) =>
  new Date(new Date(base).getTime() - jours * J_MS).toISOString().slice(0, 10);

const moisEnDate = (base, m) => {
  const days = Math.round(m * 30.4);
  return { offset: days, dueDate: dateMoinsJours(base, days) };
};

// `settings` = les trois choses qu'un modèle générique ne peut pas deviner :
//   milestones[] jalons propres à la convention de réseau
//   thresholds[] seuils internes de validation budgétaire (+ délai d'obtention)
//   leadTimes[]  délais RÉELS des fournisseurs, par famille d'équipement (+ montant)
// Elles n'ajoutent pas une couche décorative : un délai réel DÉPLACE la date de
// commande (on remonte depuis la date de livraison requise), et un montant au-dessus
// d'un seuil INSÈRE la validation qui doit la précéder. Sans ça, le rétroplanning
// affiche une commande à une date où l'accord budgétaire n'est pas encore obtenu.
// `duree` = durée visée du projet en mois avant la rentrée (défaut : la durée du modèle).
// Elle ne comprime que l'amont — voir recalibrer().
export function buildOpeningTasks(targetDate, settings = {}, duree = OPENING_DUREE_REF) {
  const base = new Date(targetDate);
  if (isNaN(base.getTime())) return [];

  const leads = new Map((settings?.leadTimes || []).filter((l) => l?.family).map((l) => [l.family, l]));
  // Le seuil retenu est le PLUS EXIGEANT que le montant franchit : on trie décroissant
  // et on prend le premier. Trier croissant ferait valider un engagement de 120 k€ par
  // le palier « > 5 k€ » au lieu du palier « > 100 k€ ».
  const seuils = (settings?.thresholds || [])
    .filter((s) => Number(s?.minAmount) > 0)
    .slice()
    .sort((a, b) => Number(b.minAmount) - Number(a.minAmount));

  const out = [];
  // `after` porte des CLEFS de modèle ; `dependsOn` porte des IDENTIFIANTS de tâche.
  // On génère d'abord, on résout ensuite : une tâche peut dépendre d'une suivante dans
  // l'ordre de déclaration, et exiger l'ordre topologique au moment d'écrire le modèle
  // serait une contrainte d'auteur qu'on finirait par violer.
  const parClef = new Map(), validations = new Map();
  for (const [idx, t] of OPENING_TEMPLATE.entries()) {
    const lead = t.family ? leads.get(t.family) : null;
    const semaines = Number(lead?.leadWeeks);
    // Le recalibrage s'applique à l'échéance du MODÈLE. Une commande dont le délai
    // fournisseur est renseigné garde sa date calculée à rebours de la livraison : trente
    // semaines restent trente semaines quelle que soit la durée qu'on vise.
    const m = lead && semaines > 0 ? t.needM + semaines / SEM : recalibrer(t.m, duree, !!t.fixe);

    const montant = Number(lead?.amount);
    const seuil = lead && montant > 0 ? seuils.find((s) => montant >= Number(s.minAmount)) : null;
    let validation = null;
    if (seuil) {
      const jours = Number(seuil.leadDays) > 0 ? Number(seuil.leadDays) / 30.4 : 0;
      const fam = OPENING_FAMILIES.find((f) => f.k === t.family);
      validation = {
        lot: "finance",
        title: `Validation budgétaire « ${seuil.label} » — ${fam?.label || t.family} (${Math.round(montant).toLocaleString("fr-FR")} €)`,
        ...moisEnDate(base, m + jours),
        critical: true, status: "todo", owner: String(seuil.approver || "").trim(), afterOpening: false,
        notes: `Engagement au-dessus du seuil ${Math.round(Number(seuil.minAmount)).toLocaleString("fr-FR")} €. À obtenir AVANT la commande.`,
        // Clef et identifiant stables : sans eux la validation était une tâche flottante,
        // que rien ne reliait à la commande — donc invisible pour le calcul de chaîne, et
        // dupliquée à chaque application des paramètres puisque son titre porte le montant.
        tplKey: `val-${t.family}`, id: `tpl-val-${t.family}`, dependsOn: [],
      };
      out.push(validation);
    }

    const tache = {
      lot: t.lot,
      title: lead?.supplier ? `${t.title} — ${String(lead.supplier).trim()}` : t.title,
      ...moisEnDate(base, m),
      critical: !!t.critical, status: "todo", owner: "",
      notes: lead && semaines > 0 ? `Délai fournisseur ${semaines} semaines, livraison requise à M−${t.needM}.` : "",
      // Clef STABLE du modèle, portée par la tâche. C'est elle qui permet de réappliquer
      // les paramètres sans réapparier au titre — lequel change dès qu'un fournisseur est
      // saisi (« COMMANDE mobilier — Manutan »), ce qui faisait perdre la tâche existante
      // et en créait un doublon.
      tplKey: t.key || `i${idx}`, afterOpening: t.m < 0,
      id: `tpl-${t.key || `i${idx}`}`,
      dependsOn: [],
      // Clef de OPENING_SOURCES quand la date est commandée par un texte ou par
      // le calendrier d'un tiers. Vide pour tout le reste — et c'est le point :
      // savoir quelles dates se négocient et lesquelles non.
      loi: t.loi || null,
    };
    if (t.key) parClef.set(t.key, tache);
    if (validation && t.key) validations.set(t.key, validation);
    out.push(tache);
  }
  for (const t of OPENING_TEMPLATE) {
    if (!t.key || !t.after?.length) continue;
    const cible = parClef.get(t.key);
    if (cible) cible.dependsOn = t.after.map((k) => parClef.get(k)?.id).filter(Boolean);
  }
  // Une commande au-dessus d'un seuil ne peut pas partir avant son accord : on l'ajoute
  // APRÈS la résolution des `after`, qui écrase dependsOn.
  for (const [clef, v] of validations) {
    const cmd = parClef.get(clef);
    if (cmd) cmd.dependsOn = [...cmd.dependsOn, v.id];
  }

  for (const j of settings?.milestones || []) {
    const titre = String(j?.title || "").trim();
    if (!titre) continue;
    out.push({
      lot: j.lot || "gouv", title: titre,
      ...moisEnDate(base, Number(j.m) || 0),
      critical: !!j.critical, status: "todo", afterOpening: (Number(j.m) || 0) < 0,
      owner: String(j.owner || "").trim(), notes: String(j.notes || "").trim(),
    });
  }
  return out;
}
export const OPENING_BUDGET_RATIOS = { travaux: 0.40, immo: 0.10, marketing: 0.18, rh: 0.12, offre: 0.05, admin: 0.05, etude: 0.03, lancement: 0.07 };
export function buildOpeningBudget(total) {
  if (!total) return [];
  return OPENING_LOTS.map((lot) => ({ lot: lot.k, label: lot.l, planned: Math.round((OPENING_BUDGET_RATIOS[lot.k] || 0) * total), committed: 0, spent: 0 }));
}

// --- Remise à niveau d'un rétroplanning enregistré ----------------------------
// Le modèle bouge : on corrige un délai légal, on ajoute une action, on déplace
// une échéance. Un rétroplanning déjà saisi doit pouvoir en bénéficier SANS
// perdre ce qu'on y a mis — responsables, statuts, réalisations consignées,
// pièces, commentaires, étapes.
//
// La régénération d'origine remplaçait tout. Conséquence : toute correction du
// modèle coûtait le travail déjà saisi, donc on ne corrigeait pas. C'est le
// contraire de ce qu'on veut d'un modèle vivant.
//
// L'appariement se fait sur `tplKey`, présent justement pour ça : il survit au
// changement de titre et de date. L'identifiant de la tâche ENREGISTRÉE est
// conservé, parce que d'autres objets le référencent (séances de comité,
// livrables, dépendances) — c'est pourquoi les dépendances du modèle sont
// réécrites vers les identifiants qui survivent.

// Ce qui appartient à l'utilisateur et ne doit jamais être écrasé par le modèle.
const CHAMPS_SAISIS = ["owner", "ownerId", "status", "notes", "description", "accountable", "accountableId",
  "consulted", "consultedIds", "informed", "informedIds", "committeeId", "sessionId", "doneAt",
  "realisation", "preuves", "progress", "outputs", "comments", "steps"];

// Une tâche « travaillée » porte une trace humaine : on ne la supprime pas en
// silence même si le modèle ne la propose plus.
export function tacheTravaillee(t) {
  if (!t) return false;
  if (t.status && t.status !== "todo") return true;
  if (String(t.owner || "").trim() || t.ownerId) return true;
  if (String(t.notes || "").trim() || String(t.description || "").trim()) return true;
  if (t.realisation && String(t.realisation.texte || "").trim()) return true;
  for (const k of ["preuves", "outputs", "comments", "steps"]) if (Array.isArray(t[k]) && t[k].length) return true;
  return Number(t.progress) > 0;
}

// Repli d'appariement pour les plans ANTÉRIEURS à `tplKey` : on compare les
// titres, normalisés (casse, accents, ponctuation, espaces). Sans ce repli, un
// plan de 2026 se retrouvait intégralement traité comme « ajouté à la main »,
// et la mise à jour produisait 349 actions au lieu de 198 — chaque action en
// double. Un plan doublé est pire qu'un plan périmé : on ne sait plus laquelle
// des deux lignes fait foi.
const normTitre = (t) => String(t || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function fusionnerRetroplanning(existantes = [], modele = []) {
  const avant = Array.isArray(existantes) ? existantes : [];
  const neuf = Array.isArray(modele) ? modele : [];
  const parClef = new Map();
  for (const t of avant) if (t?.tplKey && !parClef.has(t.tplKey)) parClef.set(t.tplKey, t);
  const parTitre = new Map();
  for (const t of avant) {
    if (t?.tplKey) continue;                       // la clef prime toujours
    const k = normTitre(t?.title);
    if (k && !parTitre.has(k)) parTitre.set(k, t);
  }
  const apparie = (m) => (m.tplKey && parClef.get(m.tplKey)) || parTitre.get(normTitre(m.title)) || null;
  const consommees = new Set();

  const sortie = [], ajoutees = [], deplacees = [], supprimees = [], gardees = [], conservees = [];
  // `tpl-<clef>` (identifiant du modèle) -> identifiant réellement retenu.
  const idFinal = new Map();
  for (const m of neuf) {
    const a = apparie(m);
    idFinal.set(m.id, a ? a.id : m.id);
  }

  for (const m of neuf) {
    const a = apparie(m);
    if (a) consommees.add(a);
    const base = {
      ...m,
      id: a ? a.id : m.id,
      dependsOn: (m.dependsOn || []).map((i) => idFinal.get(i) || i),
    };
    if (!a) { sortie.push(base); ajoutees.push({ tplKey: m.tplKey, title: m.title, dueDate: m.dueDate }); continue; }
    for (const c of CHAMPS_SAISIS) if (a[c] !== undefined) base[c] = a[c];
    // La date vient du MODÈLE : c'est lui le rétroplanning. Mais aucun
    // déplacement n'est silencieux — ils sont tous rendus à l'appelant.
    if (a.dueDate && m.dueDate && a.dueDate !== m.dueDate) {
      deplacees.push({ tplKey: m.tplKey, title: m.title, de: a.dueDate, a: m.dueDate });
    }
    sortie.push(base);
    gardees.push(m.tplKey);
  }

  const clefsModele = new Set(neuf.map((m) => m.tplKey).filter(Boolean));
  for (const t of avant) {
    if (consommees.has(t)) continue;               // déjà reprise par le modèle
    // Ajoutée à la main : elle n'a jamais appartenu au modèle, elle reste.
    if (!t?.tplKey) {
      // Sans clef ET sans titre reconnu : soit une action propre au projet, soit
      // une action d'un modèle si ancien que son libellé a changé. Dans les deux
      // cas on garde — on ne supprime jamais ce qu'on n'a pas su identifier.
      sortie.push(t); conservees.push({ title: t?.title, motif: "ajoutée à la main ou libellé devenu introuvable" });
      continue;
    }
    if (clefsModele.has(t.tplKey)) continue;
    // Le modèle ne la propose plus. Si quelqu'un y a travaillé, on la garde :
    // effacer une réalisation consignée serait pire qu'un plan un peu long.
    if (tacheTravaillee(t)) { sortie.push(t); conservees.push({ title: t.title, motif: "retirée du modèle mais travaillée" }); }
    else supprimees.push({ tplKey: t.tplKey, title: t.title });
  }

  return {
    taches: sortie,
    resume: {
      avant: avant.length, apres: sortie.length,
      ajoutees, deplacees, supprimees, conservees,
      inchangees: gardees.length - deplacees.length,
    },
  };
}

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
// Modèle type — m = mois avant la rentrée (négatif = après). critical = chemin critique.
export const OPENING_TEMPLATE = [
  // ===== Gouvernance du projet =====
  { lot: "gouv", title: "Note de cadrage : périmètre, objectifs, critères de succès", m: 15, critical: true },
  { lot: "gouv", title: "Constitution du comité de pilotage & désignation du pilote", m: 15, critical: true },
  { lot: "gouv", title: "Matrice RACI : qui fait, qui valide, qui est consulté", m: 14 },
  { lot: "gouv", title: "Registre des risques & plan de mitigation", m: 14, critical: true },
  { lot: "gouv", title: "Budget de projet & modalités de suivi des écarts", m: 14 },
  { lot: "gouv", title: "Plan de communication du projet (interne, réseau, partenaires)", m: 12 },
  // Un COPIL mensuel ne suffit pas en phase travaux : les arbitrages y sont
  // quotidiens. Il faut un point opérationnel court et fréquent à côté.
  { lot: "gouv", title: "Comité technique hebdomadaire en phase travaux & équipement", m: 6 },
  { lot: "gouv", title: "Reporting mensuel à la direction du réseau", m: 12 },
  { lot: "gouv", title: "Plan de repli si l'autorisation d'ouverture glisse (report ou site provisoire)", m: 3, critical: true },
  // Des jalons de décision ESPACÉS : un Go/No-Go unique en début de projet ne protège
  // de rien. On re-décide quand l'information nouvelle arrive — après les locaux,
  // après l'ERP, après les premières inscriptions.
  { lot: "gouv", title: "JALON — Go/No-Go après sécurisation des locaux", m: 9, critical: true },
  { lot: "gouv", title: "JALON — Go/No-Go sur le niveau d'inscriptions (seuil de viabilité)", m: 2, critical: true },
  { lot: "gouv", title: "JALON — Go/No-Go après avis de la commission de sécurité", m: 1.5, critical: true },
  { lot: "gouv", title: "Revue de fin de projet & retour d'expérience capitalisé", m: -1 },

  // ===== Finance & gestion =====
  { lot: "finance", title: "Modèle économique : point mort et effectif minimum viable", m: 15, critical: true },
  { lot: "finance", title: "Plan de financement & apport en fonds propres", m: 14, critical: true },
  { lot: "finance", title: "Prévisionnel de trésorerie mensuel sur 24 mois", m: 13, critical: true },
  { lot: "finance", title: "Structure juridique : établissement secondaire ou société dédiée", m: 13, critical: true },
  { lot: "finance", title: "Ouverture du compte bancaire dédié & moyens de paiement", m: 10 },
  { lot: "finance", title: "Régime de TVA de la formation & obligations fiscales du site", m: 10 },
  { lot: "finance", title: "Tarification, échéanciers et modalités de financement (OPCO, CPF)", m: 8, critical: true },
  { lot: "finance", title: "Assurances : RC professionnelle, multirisque, dommages-ouvrage", m: 8, critical: true },
  { lot: "finance", title: "Suivi budgétaire mensuel : engagé vs réalisé", m: 6 },
  { lot: "finance", title: "Outils de facturation, d'encaissement et de relance", m: 4 },

  // ===== Systèmes d'information =====
  { lot: "si", title: "Raccordements opérateur : fibre, téléphonie (délais longs)", m: 8, critical: true },
  { lot: "si", title: "Choix du SI de scolarité & paramétrage du site", m: 6, critical: true },
  { lot: "si", title: "RGPD : désignation du référent, mentions, contrats sous-traitants", m: 4, critical: true },
  { lot: "si", title: "Reprise des données & interfaçage avec le SI du réseau", m: 3 },
  { lot: "si", title: "Création des comptes, adresses mail et annuaire du campus", m: 2 },
  { lot: "si", title: "Sauvegardes, sécurité des accès et plan de continuité", m: 2 },

  { lot: "etude", title: "Étude de marché local & analyse concurrentielle", m: 15, critical: true },
  { lot: "etude", title: "Business plan & budget d'ouverture", m: 14, critical: true },
  { lot: "etude", title: "Zone de chalandise : bassin d'emploi et lycées sources", m: 14 },
  { lot: "etude", title: "Vivier de recrutement : nombre de candidats atteignables", m: 13, critical: true },
  { lot: "etude", title: "Débouchés locaux : magasins, enseignes, taux d'insertion", m: 13 },
  { lot: "etude", title: "Validation Go / No-Go direction", m: 13, critical: true },
  { lot: "immo", title: "Cahier des charges des locaux (surface, zone, ERP)", m: 13 },
  { lot: "immo", title: "Recherche & visites de locaux", m: 12, critical: true },
  { lot: "immo", title: "Diagnostics techniques du bâtiment (amiante, plomb, structure, DPE)", m: 10, critical: true },
  { lot: "immo", title: "Diagnostic d'accessibilité préalable du local", m: 10, critical: true },
  { lot: "immo", title: "Puissance électrique disponible pour l'atelier et les machines", m: 10, critical: true },
  { lot: "immo", title: "Négociation du bail commercial", m: 10 },
  { lot: "immo", title: "Conditions suspensives au bail : obtention de l'autorisation ERP", m: 9, critical: true },
  { lot: "immo", title: "Dépôt de garantie / caution bancaire", m: 9 },
  { lot: "immo", title: "Signature du bail", m: 9, critical: true },
  // --- Parcours ERP (type R : établissements d'enseignement) ---
  // Une école est un ERP de type R. Le régime dépend du CLASSEMENT (type + catégorie
  // selon l'effectif), qui conditionne tout le reste : sans arrêté d'ouverture du
  // maire pris après avis de la commission de sécurité, l'établissement ne peut pas
  // accueillir de public. C'est le jalon le plus dur du rétroplanning.
  { lot: "immo", title: "Classement ERP : type R et catégorie selon l'effectif", m: 12, critical: true },
  { lot: "immo", title: "Autorisation de travaux ERP (Cerfa) : notice de sécurité + notice d'accessibilité", m: 10, critical: true },
  { lot: "immo", title: "Avis de la commission d'accessibilité", m: 8 },
  { lot: "immo", title: "Vérifications techniques initiales par organisme agréé (électricité, désenfumage, SSI, alarme, extincteurs)", m: 2, critical: true },
  { lot: "immo", title: "Demande de visite de la commission de sécurité (1 mois avant, 2 mois en 1re catégorie)", m: 2, critical: true },
  { lot: "immo", title: "Passage de la commission de sécurité & levée des réserves", m: 1.5, critical: true },
  { lot: "immo", title: "ARRÊTÉ D'OUVERTURE DU MAIRE — sans lui, pas d'accueil du public", m: 1, critical: true },
  { lot: "immo", title: "Registre de sécurité & registre public d'accessibilité ouverts", m: 1 },
  { lot: "immo", title: "Plan d'évacuation, consignes affichées & exercice d'évacuation", m: 0.5 },
  { lot: "immo", title: "Formation du personnel à la sécurité incendie", m: 0.5 },
  { lot: "immo", title: "Dossier ERP & passage commission de sécurité", m: 7, critical: true },
  { lot: "immo", title: "État des lieux d'entrée contradictoire", m: 8 },
  { lot: "immo", title: "Sanitaires conformes ERP, local ménage et local déchets", m: 7 },
  { lot: "immo", title: "Contrôle d'accès, alarme intrusion & gestion des clés/badges", m: 3, critical: true },
  { lot: "immo", title: "Stationnement, accès transports en commun & local vélos", m: 10 },
  { lot: "immo", title: "Contrats d'exploitation : énergie, eau, ménage, déchets", m: 3 },
  { lot: "immo", title: "Souscription des assurances (locaux, RC)", m: 6 },
  // --- Aménagement, équipement et approvisionnement ---
  // C'est ici que se perdent les ouvertures. Le matériel pédagogique d'optique
  // (réfracteurs, frontofocomètres, meuleuses) se commande des MOIS à l'avance :
  // une commande passée en juin pour une rentrée de septembre n'arrive pas.
  // Chaque commande porte donc son jalon de livraison, distinct de la commande.

  // Plans
  { lot: "travaux", title: "Relevé de l'existant & plans de l'état des lieux", m: 9 },
  { lot: "travaux", title: "Plan d'aménagement : salles, atelier, administratif, espaces communs", m: 8, critical: true },
  { lot: "travaux", title: "Plan d'implantation du mobilier et des postes de travail", m: 8 },
  { lot: "travaux", title: "Plan des réseaux : courants forts, courants faibles, prises réseau", m: 8, critical: true },
  { lot: "travaux", title: "Plan de calepinage de l'atelier (postes de montage, évacuation, aspiration)", m: 8 },
  // Un atelier d'optique n'est pas une salle de cours avec des machines dedans.
  // Les meuleuses fonctionnent à l'arrosage : il faut l'eau, l'évacuation, et
  // surtout le traitement des effluents — les boues de meulage ne partent pas à
  // l'égout. Le polycarbonate, lui, se meule à sec : aspiration obligatoire.
  { lot: "travaux", title: "Alimentation en eau et évacuation des postes de meulage", m: 8, critical: true },
  { lot: "travaux", title: "Traitement des effluents de meulage : décanteur ou circuit fermé", m: 8, critical: true },
  { lot: "travaux", title: "Aspiration des poussières (meulage à sec du polycarbonate)", m: 8, critical: true },
  { lot: "travaux", title: "Contrat d'enlèvement des déchets d'atelier (verres, boues de meulage)", m: 2 },
  // L'examen de vue exige des conditions photométriques maîtrisées : une salle de
  // réfraction mal éclairée fausse les mesures et l'apprentissage.
  { lot: "travaux", title: "Salles de réfraction : occultation et éclairage photométrique maîtrisé", m: 8, critical: true },
  { lot: "travaux", title: "Distance de réfraction conforme (recul ou miroir) dans chaque box", m: 8, critical: true },

  // Consultation et marchés
  { lot: "travaux", title: "Consultation des entreprises & appel d'offres travaux", m: 7 },
  { lot: "travaux", title: "Comparatif des devis & sélection des entreprises", m: 6, critical: true },
  // Le PLATEAU TECHNIQUE est ce qui distingue une école d'optique d'une salle de
  // classe. Le BTS OL prépare à une profession réglementée et comporte des épreuves
  // pratiques : sans plateau conforme au référentiel, la formation ne peut pas être
  // dispensée ni les épreuves organisées. Il se dimensionne PAR NOMBRE D'ÉTUDIANTS,
  // pas au forfait — c'est le premier chiffrage à faire, et le plus lourd du budget.
  { lot: "travaux", title: "Dimensionnement du plateau technique : nombre de postes par effectif", m: 9, critical: true },
  { lot: "travaux", title: "Conformité du plateau au référentiel BTS OL (à faire valider avant commande)", m: 8, critical: true },
  { lot: "travaux", title: "Chiffrage détaillé de l'équipement pédagogique, poste par poste", m: 7, critical: true },

  // Commandes — délais longs, à passer tôt
  { lot: "travaux", title: "COMMANDE postes de réfraction (réfracteurs, projecteurs de tests, fauteuils)", m: 6, critical: true , family: "refraction", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE instruments d'examen (lampes à fente, kératomètre, autoréfractomètre)", m: 6, critical: true , family: "instruments", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE frontofocomètres & matériel de contrôle", m: 6, critical: true , family: "frontofocometres", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE matériel de contactologie & consommables associés", m: 5, critical: true , family: "contactologie", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE équipement atelier (meuleuse, traceuse, poste de montage, aspiration)", m: 6, critical: true , family: "atelier", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE mobilier (salles, atelier, administratif, espaces de détente)", m: 5, critical: true , family: "mobilier", needM: 1.5 },
  { lot: "travaux", title: "COMMANDE informatique & audiovisuel (postes, vidéoprojecteurs, écrans)", m: 4 , family: "informatique", needM: 1 },
  { lot: "travaux", title: "Suivi des délais de livraison & relances fournisseurs", m: 3, critical: true },

  // Réalisation et réception
  { lot: "travaux", title: "Réalisation des travaux & second œuvre", m: 4 },
  { lot: "travaux", title: "Réception des travaux & levée des réserves", m: 2, critical: true },

  // Livraisons et mise en service
  { lot: "travaux", title: "LIVRAISON & montage du mobilier", m: 1.5, critical: true },
  { lot: "travaux", title: "LIVRAISON, installation & mise en service de l'équipement optique", m: 1.5, critical: true },
  { lot: "travaux", title: "Calibration & vérification métrologique des appareils de mesure", m: 1, critical: true },
  { lot: "travaux", title: "Protocole d'hygiène du matériel en contact (montures d'essai, réfracteurs, lentilles)", m: 1, critical: true },
  { lot: "travaux", title: "Stock de démarrage : montures d'essai, verres de démonstration, jeux de tests", m: 2 },
  { lot: "travaux", title: "Formation des équipes à l'usage des équipements", m: 0.5 },

  // Consommables et exploitation
  { lot: "travaux", title: "COMMANDE consommables de démarrage (verres de démonstration, montures d'essai, petit outillage)", m: 2 , family: "consommables", needM: 0.5 },
  { lot: "travaux", title: "COMMANDE fournitures administratives & produits d'entretien", m: 1 , family: "fournitures", needM: 0.5 },
  { lot: "travaux", title: "Inventaire, étiquetage & inscription aux immobilisations", m: 0.5 },
  { lot: "travaux", title: "Contrats de maintenance & de vérification périodique des équipements", m: 0.5 },
  { lot: "travaux", title: "Informatique, réseau, wifi & téléphonie", m: 9 },
  { lot: "travaux", title: "Réalisation des travaux & second œuvre", m: 6, critical: true },
  { lot: "travaux", title: "Mobilier & équipement pédagogique — remplacé par les commandes détaillées ci-dessus", m: 4 },
  { lot: "travaux", title: "Informatique, réseau, wifi & téléphonie", m: 3, critical: true },
  { lot: "travaux", title: "Signalétique intérieure & extérieure", m: 2 },
  { lot: "admin", title: "Création établissement / SIRET secondaire", m: 12 },
  // Déclaration d'ouverture (loi Gatel, 13 avril 2018) : le recteur la transmet au
  // maire, au préfet et au procureur, et CHACUN peut s'opposer dans un délai de
  // TROIS MOIS à compter du dossier complet. Déposer tard, c'est décaler la rentrée.
  { lot: "admin", title: "Déclaration d'ouverture au recteur — délai d'opposition de 3 mois (maire, préfet, procureur)", m: 6, critical: true },
  { lot: "admin", title: "Expiration du délai d'opposition — ouverture juridiquement possible", m: 3, critical: true },
  { lot: "admin", title: "Vérification des conditions de diplôme et d'honorabilité du directeur", m: 7 },
  // Obligations d'employeur, systématiquement oubliées dans les rétroplannings d'ouverture.
  { lot: "admin", title: "DUERP — document unique d'évaluation des risques professionnels", m: 2 },
  { lot: "admin", title: "Adhésion au service de santé au travail & visites d'embauche", m: 2 },
  { lot: "admin", title: "Affichages obligatoires (horaires, convention collective, sécurité)", m: 1 },
  { lot: "admin", title: "PPMS — plan particulier de mise en sûreté", m: 1 },
  { lot: "admin", title: "Déclaration d'ouverture au rectorat", m: 6, critical: true },
  { lot: "admin", title: "Demande de numéro UAI", m: 6 },
  { lot: "admin", title: "Conformité RGPD & registre des traitements", m: 5 },
  // Ordre imposé : NDA d'abord (DREETS, via Mon Activité Formation), Qualiopi ensuite.
  // La declaration se depose dans les trois mois suivant la premiere convention,
  // mais sans NDA il n'y a ni certification ni financement possible.
  { lot: "admin", title: "NDA — déclaration d'activité auprès de la DREETS (préalable à Qualiopi)", m: 8, critical: true },
  { lot: "admin", title: "Formalités CFA propres à l'apprentissage", m: 7, critical: true },
  { lot: "admin", title: "Audit Qualiopi d'extension de site & obtention du certificat", m: 4, critical: true },
  { lot: "admin", title: "Kbis de l'établissement secondaire & inscription au RCS", m: 11, critical: true },
  { lot: "admin", title: "Autorisation d'enseigne : déclaration préalable en mairie", m: 5 },
  { lot: "admin", title: "Contrat de licence de marque / affiliation au réseau", m: 12, critical: true },
  { lot: "admin", title: "Calendrier du bilan pédagogique et financier (obligation annuelle)", m: -1 },
  { lot: "admin", title: "Démarche Qualiopi (extension de périmètre)", m: 5, critical: true },
  { lot: "offre", title: "Définition des filières & maquettes pédagogiques", m: 12, critical: true },
  { lot: "offre", title: "Titres RNCP / certifications & agréments", m: 11, critical: true },
  { lot: "offre", title: "Référent handicap & référent mobilité désignés", m: 5, critical: true },
  { lot: "offre", title: "Habilitation par le certificateur du titre (si titre porté par un tiers)", m: 9, critical: true },
  // Le BTS OL mene a une profession reglementee : les epreuves pratiques se passent
  // sur plateau, et l'alternance suppose des maitres d'apprentissage opticiens.
  { lot: "offre", title: "Organisation des épreuves pratiques : plateau, surveillance, jury", m: 3, critical: true },
  { lot: "offre", title: "Vivier de maîtres d'apprentissage opticiens diplômés (conditions d'expérience)", m: 8, critical: true },
  { lot: "offre", title: "Encadrement des actes pratiqués par les étudiants & couverture assurantielle", m: 5, critical: true },
  { lot: "offre", title: "Test de positionnement à l'entrée & modalités d'adaptation", m: 4, critical: true },
  { lot: "offre", title: "Modalités d'évaluation, jurys et organisation des examens", m: 3 },
  { lot: "offre", title: "Conventions types : stage, alternance, contrat de formation", m: 4, critical: true },
  { lot: "offre", title: "Règlement intérieur & livret d'accueil apprenant", m: 3 },
  { lot: "offre", title: "Conseil de perfectionnement : composition et première réunion", m: 2 },
  { lot: "offre", title: "Partenariats entreprises & alternance", m: 7 },
  { lot: "offre", title: "Calendrier académique & emplois du temps", m: 3 },
  { lot: "rh", title: "Organigramme cible & masse salariale associée", m: 12, critical: true },
  { lot: "rh", title: "Fiches de poste & grille de classification (convention collective)", m: 11 },
  { lot: "rh", title: "Recrutement du directeur de campus", m: 10, critical: true },
  { lot: "rh", title: "Recrutement de l'équipe pédagogique", m: 6, critical: true },
  { lot: "rh", title: "Recrutement administratif & admissions", m: 5 },
  { lot: "rh", title: "Sourcing vacataires & intervenants pro", m: 4 },
  { lot: "rh", title: "Contrats de travail, DPAE & registre unique du personnel", m: 2, critical: true },
  { lot: "rh", title: "Mise en place de la paie (prestataire ou interne)", m: 2, critical: true },
  { lot: "rh", title: "Mutuelle, prévoyance & affiliation des salariés", m: 2 },
  { lot: "rh", title: "Représentation du personnel si l'effectif l'impose", m: 1 },
  { lot: "rh", title: "Onboarding & formation des équipes", m: 1 },
  { lot: "marketing", title: "Identité locale & supports de communication", m: 10 },
  { lot: "marketing", title: "Site / landing page du campus", m: 9 },
  { lot: "marketing", title: "Plan média & campagnes d'acquisition", m: 8, critical: true },
  { lot: "marketing", title: "Dossier Parcoursup — calendrier contraint, dépôt à date fixe", m: 10, critical: true },
  // Dans l'optique, l'alternance se joue avec les enseignes et les independants du
  // bassin : sans magasins partenaires, pas d'alternants, donc pas de promotion.
  { lot: "marketing", title: "Recensement des magasins d'optique du bassin & prise de contact", m: 11, critical: true },
  { lot: "marketing", title: "Conventions avec les enseignes (alternance, taxe d'apprentissage)", m: 9, critical: true },
  { lot: "marketing", title: "Partenariats verriers & fournisseurs (dotation matériel, interventions)", m: 9 },
  { lot: "marketing", title: "Relation avec les syndicats professionnels de la filière", m: 8 },
  { lot: "marketing", title: "Référencement Onisep, annuaires et plateformes d'orientation", m: 9 },
  { lot: "marketing", title: "Calendrier salons & référencement (Parcoursup, etc.)", m: 9, critical: true },
  { lot: "marketing", title: "CRM admissions & process de traitement", m: 7 },
  { lot: "marketing", title: "Journées Portes Ouvertes (série)", m: 5, critical: true },
  { lot: "marketing", title: "Objectif de recrutement & suivi du pipeline", m: 8, critical: true },
  { lot: "lancement", title: "Pré-rentrée (accueil, EDT, comptes, badges)", m: 1, critical: true },
  { lot: "lancement", title: "Répétition générale : parcours étudiant de bout en bout", m: 0.5, critical: true },
  { lot: "lancement", title: "Plan de communication de crise & porte-parole désigné", m: 1 },
  { lot: "lancement", title: "Logistique jour J & répétition", m: 0.5 },
  { lot: "lancement", title: "Communication de lancement & relations presse", m: 1 },
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

const moisEnDate = (base, m) => {
  const days = Math.round(m * 30.4);
  const d = new Date(base); d.setDate(d.getDate() - days);
  return { offset: days, dueDate: d.toISOString().slice(0, 10) };
};

// `settings` = les trois choses qu'un modèle générique ne peut pas deviner :
//   milestones[] jalons propres à la convention de réseau
//   thresholds[] seuils internes de validation budgétaire (+ délai d'obtention)
//   leadTimes[]  délais RÉELS des fournisseurs, par famille d'équipement (+ montant)
// Elles n'ajoutent pas une couche décorative : un délai réel DÉPLACE la date de
// commande (on remonte depuis la date de livraison requise), et un montant au-dessus
// d'un seuil INSÈRE la validation qui doit la précéder. Sans ça, le rétroplanning
// affiche une commande à une date où l'accord budgétaire n'est pas encore obtenu.
export function buildOpeningTasks(targetDate, settings = {}) {
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
  for (const t of OPENING_TEMPLATE) {
    const lead = t.family ? leads.get(t.family) : null;
    const semaines = Number(lead?.leadWeeks);
    const m = lead && semaines > 0 ? t.needM + semaines / SEM : t.m;

    const montant = Number(lead?.amount);
    const seuil = lead && montant > 0 ? seuils.find((s) => montant >= Number(s.minAmount)) : null;
    if (seuil) {
      const jours = Number(seuil.leadDays) > 0 ? Number(seuil.leadDays) / 30.4 : 0;
      const fam = OPENING_FAMILIES.find((f) => f.k === t.family);
      out.push({
        lot: "finance",
        title: `Validation budgétaire « ${seuil.label} » — ${fam?.label || t.family} (${Math.round(montant).toLocaleString("fr-FR")} €)`,
        ...moisEnDate(base, m + jours),
        critical: true, status: "todo", owner: String(seuil.approver || "").trim(),
        notes: `Engagement au-dessus du seuil ${Math.round(Number(seuil.minAmount)).toLocaleString("fr-FR")} €. À obtenir AVANT la commande.`,
      });
    }

    out.push({
      lot: t.lot,
      title: lead?.supplier ? `${t.title} — ${String(lead.supplier).trim()}` : t.title,
      ...moisEnDate(base, m),
      critical: !!t.critical, status: "todo", owner: "",
      notes: lead && semaines > 0 ? `Délai fournisseur ${semaines} semaines, livraison requise à M−${t.needM}.` : "",
    });
  }

  for (const j of settings?.milestones || []) {
    const titre = String(j?.title || "").trim();
    if (!titre) continue;
    out.push({
      lot: j.lot || "gouv", title: titre,
      ...moisEnDate(base, Number(j.m) || 0),
      critical: !!j.critical, status: "todo",
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

// API publique : description déclarative des points d'entrée — logique pure.
//
// UNE SEULE SOURCE DE VÉRITÉ. La table ENDPOINTS sert à la fois à monter les
// routes et à produire la spécification OpenAPI. C'est le seul moyen d'éviter
// la dérive qui finit par frapper toute documentation écrite à la main : le
// code change, la doc reste, et un intégrateur perd sa journée sur un champ
// renommé six mois plus tôt. Ici, une route sans description ne se monte pas,
// et une description sans route est détectée par les tests.
//
// L'API publique vit sous /v1 et se distingue de /api, qui reste l'API privée
// du navigateur — authentifiée par cookie et protégée par jeton anti-CSRF. Les
// deux n'ont ni le même public, ni la même authentification, ni les mêmes
// garanties de stabilité : les mélanger reviendrait à s'interdire de faire
// évoluer l'interface sans casser les intégrations.

export const BASE = "/v1";
export const VERSION = "1.0.0";

const param = (nom, description, { requis = false, exemple = null } = {}) =>
  ({ nom, description, requis, exemple });

export const ENDPOINTS = [
  {
    id: "me",
    method: "get", path: "/v1/me", scope: null,
    summary: "Informations sur la clé utilisée",
    description: "Permet à une intégration de vérifier sa configuration : portées accordées, campus autorisés, date d'expiration. À appeler en premier lors d'un branchement.",
    params: [],
  },
  {
    id: "learners.list",
    method: "get", path: "/v1/learners", scope: "learners:read",
    summary: "Lister les apprenants",
    description: "Retourne les dossiers apprenants du campus. Les inscriptions sont incluses. Les données de santé ne sont jamais exposées par cette API.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("q", "Recherche sur le nom, le prénom, l'INE ou l'email"),
    ],
  },
  {
    id: "learners.get",
    method: "get", path: "/v1/learners/:id", scope: "learners:read",
    summary: "Lire un dossier apprenant",
    description: "Dossier complet : état civil, inscriptions, contrats liés.",
    params: [param("id", "Identifiant de l'apprenant", { requis: true })],
  },
  {
    id: "learners.create",
    method: "post", path: "/v1/learners", scope: "learners:write",
    summary: "Créer un dossier apprenant",
    description: "Crée un dossier. Le plafond du plan s'applique : au-delà, la réponse est 402 avec le motif. Aucun doublon n'est détecté automatiquement — vérifier l'INE avant d'appeler.",
    corps: { campusId: "string (requis)", nom: "string (requis)", prenom: "string (requis)", ine: "string", dateNaissance: "AAAA-MM-JJ", email: "string", telephone: "string" },
    params: [],
  },
  {
    id: "enrollments.list",
    method: "get", path: "/v1/enrollments", scope: "learners:read",
    summary: "Lister les inscriptions",
    description: "Inscriptions d'un campus, filtrables par année scolaire. Le statut « stagiaire » désigne un apprenti dont le contrat est rompu mais qui reste en formation.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("schoolYear", "Année scolaire, par exemple 2026-2027"),
    ],
  },
  {
    id: "attendance.list",
    method: "get", path: "/v1/attendance/sheets", scope: "attendance:read",
    summary: "Lister les feuilles d'émargement closes",
    description: "Seules les feuilles CLOSES sont exposées : une feuille ouverte est encore modifiable et ne prouve rien. Chaque feuille porte son empreinte de scellement.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("from", "Date de début, AAAA-MM-JJ"),
      param("to", "Date de fin, AAAA-MM-JJ"),
      param("classId", "Restreindre à une classe"),
    ],
  },
  {
    id: "attendance.verify",
    method: "get", path: "/v1/attendance/verify", scope: "attendance:read",
    summary: "Vérifier l'intégrité de la chaîne d'émargement",
    description: "Recalcule la chaîne d'empreintes du campus et signale toute altération. C'est le contrôle qu'un financeur ou un auditeur peut exécuter lui-même.",
    params: [param("campusId", "Identifiant du campus", { requis: true })],
  },
  {
    id: "contracts.list",
    method: "get", path: "/v1/contracts", scope: "contracts:read",
    summary: "Lister les contrats d'alternance",
    description: "Contrats du campus, avec leur statut et l'état d'une éventuelle rupture.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("status", "Filtrer par statut : brouillon, depose, valide, rompu, termine"),
    ],
  },
  {
    id: "billing.fundings",
    method: "get", path: "/v1/fundings", scope: "billing:read",
    summary: "Lister les financements",
    description: "Dossiers de financement avec leur mode. Rappel : en alternance le montant se calcule au prorata temporis des jours de contrat, l'assiduité n'entre pas dans ce calcul ; en conventionné, ce sont les heures réalisées qui se facturent.",
    params: [param("campusId", "Identifiant du campus", { requis: true })],
  },
  {
    id: "billing.invoices",
    method: "get", path: "/v1/invoices", scope: "billing:read",
    summary: "Lister les factures",
    description: "Factures du campus. Une facture émise est immuable : elle se corrige par avoir, jamais par modification, et son numéro reste dans la séquence.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("status", "Filtrer par statut : brouillon, emise, payee, annulee"),
    ],
  },
  {
    id: "declarations.sifa",
    method: "get", path: "/v1/declarations/sifa", scope: "declarations:read",
    summary: "Données de l'enquête SIFA",
    description: "Une ligne par apprenti présent au 31 décembre de l'année demandée. Les anomalies bloquantes (INE manquant en tête) sont retournées à part : une ligne incomplète est rejetée au dépôt.",
    params: [
      param("campusId", "Identifiant du campus", { requis: true }),
      param("annee", "Année d'observation, par exemple 2026"),
    ],
  },
];

export const ENDPOINT_IDS = ENDPOINTS.map((e) => e.id);

// Conversion du chemin Express (`/v1/learners/:id`) vers la notation OpenAPI
// (`/v1/learners/{id}`).
export const versOpenApiPath = (p) => p.replace(/:([A-Za-z_]+)/g, "{$1}");

const REPONSES_COMMUNES = {
  400: "Paramètre requis manquant ou invalide",
  401: "Clé d'API absente, inconnue, révoquée ou expirée",
  403: "Portée insuffisante, ou campus hors du périmètre de la clé",
  429: "Trop d'appels — voir l'en-tête Retry-After",
};

export function buildOpenApi({ serveur = "https://votre-instance.campusmanager.fr", scopes = {} } = {}) {
  const paths = {};
  for (const e of ENDPOINTS) {
    const chemin = versOpenApiPath(e.path);
    paths[chemin] = paths[chemin] || {};
    const parametres = e.params.map((p) => ({
      name: p.nom,
      in: e.path.includes(`:${p.nom}`) ? "path" : "query",
      required: e.path.includes(`:${p.nom}`) ? true : !!p.requis,
      description: p.description,
      schema: { type: "string" },
    }));
    paths[chemin][e.method] = {
      operationId: e.id,
      summary: e.summary,
      description: e.description,
      tags: [e.path.split("/")[2]],
      security: [{ cleApi: e.scope ? [e.scope] : [] }],
      parameters: parametres,
      ...(e.corps ? {
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(Object.entries(e.corps).map(([k, v]) => [k, { type: "string", description: v }])) } } },
        },
      } : {}),
      responses: {
        200: { description: "Succès" },
        ...Object.fromEntries(Object.entries(REPONSES_COMMUNES).map(([code, d]) => [code, { description: d }])),
        ...(e.method === "post" ? { 402: { description: "Plafond du plan atteint — les données existantes restent accessibles" } } : {}),
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "API Campus Manager",
      version: VERSION,
      description:
        "API publique de votre instance Campus Manager.\n\n" +
        "**Authentification** — en-tête `Authorization: Bearer cm_live_…`. La clé n'est affichée qu'une fois à sa création ; " +
        "seule son empreinte est conservée. Une clé ne peut jamais dépasser les droits du compte qui l'a créée.\n\n" +
        "**Périmètre** — une clé peut être restreinte à certains campus. Dans ce cas, `campusId` est obligatoire sur chaque appel.\n\n" +
        "**Stabilité** — cette API est versionnée sous `/v1`. L'API `/api` utilisée par l'interface web n'est pas publique et change sans préavis.",
    },
    servers: [{ url: serveur }],
    components: {
      securitySchemes: {
        cleApi: { type: "http", scheme: "bearer", description: "Clé d'API au format cm_live_…" },
      },
    },
    security: [{ cleApi: [] }],
    "x-scopes": scopes,
    paths,
  };
}

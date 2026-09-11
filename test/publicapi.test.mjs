import test from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, ENDPOINT_IDS, buildOpenApi, versOpenApiPath, BASE, VERSION } from "../lib/publicapi.js";
import { SCOPE_IDS } from "../lib/apikeys.js";

test("chaque point d'entrée est complètement décrit — sinon il ne se monte pas", () => {
  for (const e of ENDPOINTS) {
    assert.ok(e.id, "identifiant requis");
    assert.ok(["get", "post", "put", "patch", "delete"].includes(e.method), `${e.id} : méthode invalide`);
    assert.ok(e.path.startsWith(BASE + "/"), `${e.id} : l'API publique vit sous ${BASE}`);
    assert.ok(e.summary && e.summary.length > 5, `${e.id} : résumé requis`);
    assert.ok(e.description && e.description.length > 20, `${e.id} : description utile requise`);
    assert.ok(Array.isArray(e.params), `${e.id} : paramètres requis (même vide)`);
    if (e.scope) assert.ok(SCOPE_IDS.includes(e.scope), `${e.id} : portée inconnue ${e.scope}`);
  }
  assert.equal(new Set(ENDPOINT_IDS).size, ENDPOINT_IDS.length, "identifiants uniques");
});

test("tout paramètre de chemin est déclaré, et réciproquement", () => {
  // Un `:id` non documenté est exactement ce qui fait perdre une journée à un
  // intégrateur.
  for (const e of ENDPOINTS) {
    const dansChemin = [...e.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]);
    const declares = e.params.map((p) => p.nom);
    for (const p of dansChemin) assert.ok(declares.includes(p), `${e.id} : paramètre de chemin « ${p} » non documenté`);
  }
});

test("conversion des chemins vers la notation OpenAPI", () => {
  assert.equal(versOpenApiPath("/v1/learners/:id"), "/v1/learners/{id}");
  assert.equal(versOpenApiPath("/v1/learners"), "/v1/learners");
});

test("la spécification décrit exactement les points d'entrée, sans en inventer", () => {
  const spec = buildOpenApi({ serveur: "https://cfa.campusmanager.fr" });
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, VERSION);
  assert.equal(spec.servers[0].url, "https://cfa.campusmanager.fr");

  const operations = Object.values(spec.paths).flatMap((m) => Object.values(m));
  assert.equal(operations.length, ENDPOINTS.length, "autant d'opérations que de points d'entrée");
  assert.deepEqual(operations.map((o) => o.operationId).sort(), [...ENDPOINT_IDS].sort());

  for (const e of ENDPOINTS) {
    const op = spec.paths[versOpenApiPath(e.path)][e.method];
    assert.ok(op, `${e.id} absent de la spécification`);
    // Les erreurs qu'un client doit savoir traiter sont TOUTES documentées.
    for (const code of ["400", "401", "403", "429"]) {
      assert.ok(op.responses[code], `${e.id} : réponse ${code} non documentée`);
    }
    assert.deepEqual(op.security, [{ cleApi: e.scope ? [e.scope] : [] }]);
  }
});

test("les paramètres de chemin sont marqués obligatoires même sans le déclarer", () => {
  const spec = buildOpenApi({});
  const op = spec.paths["/v1/learners/{id}"].get;
  const id = op.parameters.find((p) => p.name === "id");
  assert.equal(id.in, "path");
  assert.equal(id.required, true, "un paramètre de chemin est toujours obligatoire");
  const q = spec.paths["/v1/learners"].get.parameters.find((p) => p.name === "q");
  assert.equal(q.in, "query");
  assert.equal(q.required, false);
});

test("une écriture documente le 402 : le plafond du plan est une réponse attendue", () => {
  const spec = buildOpenApi({});
  assert.ok(spec.paths["/v1/learners"].post.responses["402"]);
  assert.ok(spec.paths["/v1/learners"].post.requestBody);
  // Et une lecture ne prétend pas renvoyer 402.
  assert.equal(spec.paths["/v1/learners"].get.responses["402"], undefined);
});

test("la documentation dit ce qui est stable et ce qui ne l'est pas", () => {
  const spec = buildOpenApi({});
  assert.match(spec.info.description, /Bearer/);
  assert.match(spec.info.description, /n'est affichée qu'une fois/);
  assert.match(spec.info.description, /ne peut jamais dépasser les droits/);
  // Le point le plus important pour un intégrateur : ne pas taper sur /api.
  assert.match(spec.info.description, /n'est pas publique et change sans préavis/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  generate, hash, correspond, depuisEntete, validateCreation, etat, autorise, publique,
  scopesEffectifs, SCOPES, SCOPE_IDS, PREFIXE,
} from "../lib/apikeys.js";

test("génération : secret fort, préfixe identifiable, empreinte seule conservée", () => {
  const { cle, identifiant, hash: h } = generate();
  assert.ok(cle.startsWith(PREFIXE));
  assert.ok(cle.length > PREFIXE.length + 40);
  assert.match(cle.slice(PREFIXE.length), /^[A-Za-z0-9_-]+$/, "sûr dans un en-tête, une URL et un fichier .env");
  assert.equal(h, hash(cle));
  assert.equal(h.length, 64);
  // Le préfixe visible permet de parler d'une clé sans la révéler.
  assert.equal(cle.slice(PREFIXE.length, PREFIXE.length + 8), identifiant);
  assert.equal(generate().cle === generate().cle, false);
});

test("l'empreinte ne permet pas de remonter à la clé, et la comparaison est à temps constant", () => {
  const { cle, hash: h } = generate();
  assert.equal(correspond(cle, h), true);
  assert.equal(correspond(cle + "x", h), false);
  assert.equal(correspond("", h), false);
  assert.equal(correspond(cle, ""), false);
  assert.equal(correspond(cle, null), false);
  assert.equal(h.includes(cle.slice(PREFIXE.length, 16)), false, "l'empreinte ne contient rien du secret");
});

test("la clé se lit dans Authorization, JAMAIS dans l'URL", () => {
  // Une clé en paramètre d'URL finit dans les journaux du proxy et dans
  // l'historique du navigateur.
  const { cle } = generate();
  assert.equal(depuisEntete(`Bearer ${cle}`), cle);
  assert.equal(depuisEntete(`bearer ${cle}`), cle, "la casse du schéma est libre");
  assert.equal(depuisEntete(cle), null, "sans le schéma Bearer, on refuse");
  assert.equal(depuisEntete("Bearer autre_chose"), null, "un jeton sans notre préfixe n'est pas une clé d'API");
  assert.equal(depuisEntete("Basic abc"), null);
  assert.equal(depuisEntete(null), null);
});

test("write implique read sur la MÊME ressource, et rien de plus", () => {
  // Exiger les deux ne protège de rien : cela produit des clés mal configurées.
  assert.deepEqual(scopesEffectifs(["learners:write"]), ["learners:read", "learners:write"]);
  // Mais jamais sur une autre ressource.
  assert.equal(scopesEffectifs(["learners:write"]).includes("billing:read"), false);
  assert.deepEqual(scopesEffectifs(["portée:inventée"]), []);
  for (const s of SCOPE_IDS) assert.ok(SCOPES[s], `${s} doit être décrit à l'utilisateur`);
});

test("UNE CLÉ NE PEUT JAMAIS DÉPASSER LES DROITS DE SON CRÉATEUR", () => {
  // Sans cette règle, un directeur limité à un campus émettrait une clé sans
  // restriction et s'octroierait le réseau : élévation de privilèges déguisée
  // en fonctionnalité d'intégration.
  const directeur = { campusIds: ["c1"] };

  // Il demande une clé sans restriction : elle hérite de SON périmètre.
  const heritee = validateCreation({ nom: "Intégration", scopes: ["learners:read"] }, directeur);
  assert.equal(heritee.ok, true);
  assert.deepEqual(heritee.demande.campusIds, ["c1"]);

  // Il demande explicitement un campus qui n'est pas le sien : refus motivé.
  const escalade = validateCreation({ nom: "X", scopes: ["learners:read"], campusIds: ["c1", "c2"] }, directeur);
  assert.equal(escalade.ok, false);
  assert.match(escalade.errors[0], /hors de votre périmètre/);
  assert.match(escalade.errors[0], /ne peut pas dépasser les droits/);

  // Un administrateur (périmètre null = total) peut émettre une clé non restreinte.
  const admin = validateCreation({ nom: "Globale", scopes: ["learners:read"] }, { campusIds: null });
  assert.equal(admin.ok, true);
  assert.equal(admin.demande.campusIds, null);
  // …et la restreindre s'il le souhaite.
  assert.deepEqual(validateCreation({ nom: "Ciblée", scopes: ["learners:read"], campusIds: ["c9"] }, { campusIds: null }).demande.campusIds, ["c9"]);
});

test("création : nom, portées et date valides exigés", () => {
  const v = validateCreation({}, { campusIds: null });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /nom de la clé requis/.test(e)));
  assert.ok(v.errors.some((e) => /au moins une portée/.test(e)));

  assert.equal(validateCreation({ nom: "X", scopes: ["nimporte:quoi"] }, { campusIds: null }).ok, false);
  const dateFausse = validateCreation({ nom: "X", scopes: ["learners:read"], expiresAt: "31/12/2027" }, { campusIds: null });
  assert.equal(dateFausse.ok, false);
  assert.ok(dateFausse.errors.some((e) => /AAAA-MM-JJ/.test(e)));
});

test("TOUT ÉCHEC EST FERMANT : révoquée, expirée, portée, campus", () => {
  const base = { scopes: ["learners:read"], campusIds: null };

  assert.equal(autorise(null, { scope: "learners:read" }).ok, false);
  assert.equal(autorise(null, {}).code, "cle_inconnue");

  const revoquee = autorise({ ...base, revokedAt: "2026-09-01" }, { scope: "learners:read", aujourdhui: "2026-09-10" });
  assert.equal(revoquee.ok, false);
  assert.match(revoquee.error, /révoquée/);

  const expiree = autorise({ ...base, expiresAt: "2026-09-01" }, { scope: "learners:read", aujourdhui: "2026-09-10" });
  assert.equal(expiree.ok, false);
  assert.match(expiree.error, /expirée/);
  // Le jour même de l'expiration, la clé fonctionne encore.
  assert.equal(autorise({ ...base, expiresAt: "2026-09-10" }, { scope: "learners:read", aujourdhui: "2026-09-10" }).ok, true);

  const portee = autorise(base, { scope: "billing:read", aujourdhui: "2026-09-10" });
  assert.equal(portee.ok, false);
  assert.equal(portee.code, "portee_insuffisante");
  assert.match(portee.error, /billing:read/, "le motif doit être exploitable par l'intégrateur");
});

test("clé restreinte : un appel sans campus est REFUSÉ, jamais élargi en silence", () => {
  const restreinte = { scopes: ["learners:read"], campusIds: ["c1"] };
  assert.equal(autorise(restreinte, { scope: "learners:read", campusId: "c1", aujourdhui: "2026-09-10" }).ok, true);

  const ailleurs = autorise(restreinte, { scope: "learners:read", campusId: "c2", aujourdhui: "2026-09-10" });
  assert.equal(ailleurs.ok, false);
  assert.equal(ailleurs.code, "campus_hors_perimetre");

  const sansCampus = autorise(restreinte, { scope: "learners:read", aujourdhui: "2026-09-10" });
  assert.equal(sansCampus.ok, false);
  assert.equal(sansCampus.code, "campus_requis");
  assert.match(sansCampus.error, /préciser campusId/);
});

test("affichage : ni le secret, ni son empreinte ne sortent jamais", () => {
  const { cle, identifiant, hash: h } = generate();
  const p = publique({ id: "k1", nom: "Intégration paie", identifiant, hash: h, scopes: ["learners:read"], createdAt: "2026-09-01" });
  const serialise = JSON.stringify(p);
  assert.equal(serialise.includes(cle), false);
  assert.equal(serialise.includes(h), false);
  assert.equal(p.hash, undefined);
  assert.equal(p.apercu, `${PREFIXE}${identifiant}…`, "on peut désigner la clé sans la révéler");
  // Une clé jamais utilisée depuis sa création est une clé à faire le ménage.
  assert.equal(p.jamaisUtilisee, true);
  assert.equal(publique({ lastUsedAt: "2026-09-05" }).jamaisUtilisee, false);
});

test("état : sans date d'expiration, une clé ne s'éteint pas d'elle-même", () => {
  assert.deepEqual(etat({}, "2030-01-01"), { actif: true, motif: null });
  assert.equal(etat({ expiresAt: null }, "2030-01-01").actif, true);
});

test("/v1/me : une clé restreinte doit pouvoir lire sa propre configuration", () => {
  // Sans cette exception, une intégration limitée à un campus ne pourrait même
  // pas vérifier sa configuration sans deviner un identifiant de campus.
  const restreinte = { scopes: ["learners:read"], campusIds: ["c1"] };
  assert.equal(autorise(restreinte, { aujourdhui: "2026-09-10", verifierCampus: false }).ok, true);
  // Mais l'exception ne s'étend pas aux accès aux données.
  assert.equal(autorise(restreinte, { scope: "learners:read", aujourdhui: "2026-09-10" }).code, "campus_requis");
  // Et une clé révoquée reste refusée même sur /v1/me.
  assert.equal(autorise({ ...restreinte, revokedAt: "2026-01-01" }, { aujourdhui: "2026-09-10", verifierCampus: false }).ok, false);
});

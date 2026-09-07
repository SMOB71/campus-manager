import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmportal-"));
process.env.DATA_KEY = "test-key-portal";
const store = await import("../lib/store.js");
const { generateToken, hashToken, tokenMatches, expiryFor, accessState, makeRateLimiter, DEFAULT_TTL_DAYS } = await import("../lib/portal.js");

test("generateToken : aléa suffisant, jamais deux fois le même", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = generateToken();
    assert.ok(t.length >= 40, "jeton trop court");
    assert.match(t, /^[A-Za-z0-9_-]+$/); // base64url : copiable dans une URL
    assert.ok(!seen.has(t), "collision de jeton");
    seen.add(t);
  }
});

test("hashToken / tokenMatches : comparaison correcte, jeton jamais déductible", () => {
  const t = generateToken();
  const h = hashToken(t);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.ok(!h.includes(t)); // l'empreinte ne contient rien du jeton
  assert.equal(tokenMatches(t, h), true);
  assert.equal(tokenMatches(generateToken(), h), false);
  assert.equal(tokenMatches(t, "trop court"), false);
  assert.equal(tokenMatches("", h), false);
});

test("accessState : révoqué et expiré sont refusés, avec la raison", () => {
  const futur = new Date(Date.now() + 864e5).toISOString();
  const passe = new Date(Date.now() - 864e5).toISOString();
  assert.equal(accessState({ expiresAt: futur }).valid, true);
  assert.equal(accessState(null).valid, false);
  assert.equal(accessState({ expiresAt: futur, revokedAt: new Date().toISOString() }).reason, "révoqué");
  assert.equal(accessState({ expiresAt: passe }).reason, "expiré");
});

test("expiryFor : durée par défaut selon le type, surchargeable", () => {
  const learner = new Date(expiryFor("learner"));
  const attendu = Date.now() + DEFAULT_TTL_DAYS.learner * 864e5;
  assert.ok(Math.abs(learner.getTime() - attendu) < 60000);
  const court = new Date(expiryFor("learner", 1));
  assert.ok(court.getTime() < Date.now() + 2 * 864e5);
});

test("rate limiter : bloque au-delà du quota, par clé, et se réinitialise", () => {
  const rl = makeRateLimiter({ max: 3, windowMs: 60000 });
  assert.equal(rl.check("ip1").allowed, true);
  assert.equal(rl.check("ip1").allowed, true);
  assert.equal(rl.check("ip1").allowed, true);
  assert.equal(rl.check("ip1").allowed, false); // 4e refusée
  assert.equal(rl.check("ip2").allowed, true);  // une autre adresse n'est pas pénalisée
  rl.reset();
  assert.equal(rl.check("ip1").allowed, true);
});

test("store : créer un accès révoque le précédent du même sujet", () => {
  const campus = store.addCampus({ name: "Campus Portail" });
  const t1 = generateToken();
  const a1 = store.createPortalAccess({ kind: "learner", subjectId: "L1", campusId: campus.id, tokenHash: hashToken(t1), expiresAt: expiryFor("learner") });
  assert.equal(a1.revokedAt, null);

  const t2 = generateToken();
  store.createPortalAccess({ kind: "learner", subjectId: "L1", campusId: campus.id, tokenHash: hashToken(t2), expiresAt: expiryFor("learner") });
  // l'ancien est automatiquement révoqué : un lien transmis par erreur cesse de valoir
  const ancien = store.listPortalAccess({ subjectId: "L1" }).find((a) => a.id === a1.id);
  assert.ok(ancien.revokedAt);
  assert.match(ancien.revokedReason, /remplacé/);
  // et il ne passe plus le contrôle d'état
  assert.equal(accessState(ancien).valid, false);
  assert.equal(accessState(store.findPortalAccessByHash(hashToken(t2))).valid, true);

  // un accès d'un AUTRE sujet n'est pas touché
  const t3 = generateToken();
  store.createPortalAccess({ kind: "learner", subjectId: "L2", campusId: campus.id, tokenHash: hashToken(t3), expiresAt: expiryFor("learner") });
  assert.equal(accessState(store.findPortalAccessByHash(hashToken(t2))).valid, true);
});

test("store : révocation et compteur d'utilisation", () => {
  const campus = store.addCampus({ name: "Campus Portail 2" });
  const t = generateToken();
  const a = store.createPortalAccess({ kind: "tutor", subjectId: "CO1", campusId: campus.id, tokenHash: hashToken(t), expiresAt: expiryFor("tutor") });
  store.touchPortalAccess(a.id);
  store.touchPortalAccess(a.id);
  const used = store.listPortalAccess({ subjectId: "CO1" })[0];
  assert.equal(used.useCount, 2);
  assert.ok(used.lastUsedAt);
  store.revokePortalAccess(a.id, "fin de contrat");
  assert.equal(accessState(store.findPortalAccessByHash(hashToken(t))).reason, "révoqué");
});

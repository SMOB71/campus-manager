// Tests d'intégration sécurité : démarre le serveur sur un store jetable et vérifie
// CSRF, authentification, cloisonnement des rôles, upload interdit, validation métier.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(os.tmpdir(), "ac-sec-"));
let srv;

function req(pathname, { method = "GET", cookie = "", csrf = "", json, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  return fetch(BASE + pathname, { method, headers, body, redirect: "manual" });
}
function readCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of set) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return jar;
}
async function login(email, password) {
  const res = await req("/api/login", { method: "POST", json: { email, password } });
  const jar = readCookies(res);
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return { status: res.status, cookie, csrf: jar.ac_csrf };
}

before(async () => {
  srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, DATA_DIR: dir, DATA_KEY: "test_key_throwaway_0123456789", SESSION_SECRET: "test_secret", OPENAI_API_KEY: "sk-test", ADMIN_EMAIL: "admin@test.co", APP_PASSWORD: "pw12345678", PORT: String(PORT), NODE_ENV: "test" },
  });
  const deadline = Date.now() + 8000;
  for (;;) {
    try { const r = await fetch(BASE + "/health"); if (r.ok) break; } catch { /* pas encore prêt */ }
    if (Date.now() > deadline) throw new Error("serveur non démarré");
    await new Promise((r) => setTimeout(r, 150));
  }
});
after(() => { try { srv.kill("SIGKILL"); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

test("route protégée sans session → 401", async () => {
  const r = await req("/api/campuses");
  assert.equal(r.status, 401);
});

test("login admin → 200 + cookies session & CSRF", async () => {
  const a = await login("admin@test.co", "pw12345678");
  assert.equal(a.status, 200);
  assert.match(a.cookie, /ac_session=/);
  assert.ok(a.csrf && /^[a-f0-9]{48}$/.test(a.csrf), "cookie CSRF présent");
});

test("mutation sans jeton CSRF → 403 ; avec jeton → 200", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const sans = await req("/api/decisions", { method: "POST", cookie: a.cookie, json: { title: "x" } });
  assert.equal(sans.status, 403);
  const avec = await req("/api/decisions", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { title: "Décision test" } });
  assert.equal(avec.status, 200);
});

test("validation métier : occupancy hors bornes → 400", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const camp = await (await req("/api/campuses", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { name: "Campus Test" } })).json();
  const bad = await req("/api/kpi", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { campusId: camp.id, month: "2099-01", occupancy: 150 } });
  assert.equal(bad.status, 400);
  const ok = await req("/api/kpi", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { campusId: camp.id, month: "2099-01", occupancy: 85 } });
  assert.equal(ok.status, 200);
});

test("upload : extension interdite → 400", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const fd = new FormData();
  fd.append("file", new Blob(["MZ"]), "malware.exe");
  const r = await req("/api/upload", { method: "POST", cookie: a.cookie, csrf: a.csrf, form: fd });
  assert.equal(r.status, 400);
});

test("cloisonnement rôles : un directeur n'accède pas aux routes admin", async () => {
  const a = await login("admin@test.co", "pw12345678");
  await req("/api/users", { method: "POST", cookie: a.cookie, csrf: a.csrf, json: { email: "dir@test.co", name: "Dir", role: "directeur", password: "pw12345678", campusIds: [] } });
  const d = await login("dir@test.co", "pw12345678");
  assert.equal(d.status, 200);
  const users = await req("/api/users", { cookie: d.cookie }); // route admin
  assert.equal(users.status, 403);
});

test("compte désactivé → login refusé", async () => {
  const a = await login("admin@test.co", "pw12345678");
  const list = await (await req("/api/users", { cookie: a.cookie, csrf: a.csrf })).json();
  const dir = list.find((u) => u.email === "dir@test.co");
  await req(`/api/users/${dir.id}`, { method: "PATCH", cookie: a.cookie, csrf: a.csrf, json: { active: false } });
  const d = await login("dir@test.co", "pw12345678");
  // verifyUserPassword bloque déjà les comptes inactifs → login rejeté (pas de session émise).
  assert.notEqual(d.status, 200);
  assert.ok(!d.csrf, "aucune session émise pour un compte désactivé");
});

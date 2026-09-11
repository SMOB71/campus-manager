import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSlug, allocatePort, planCreate, renderEnv, renderNginx, dockerRunArgs,
  toRegistry, auditRegistry, motDePasseInitial, secret, SLUGS_RESERVES, PORT_BASE,
  dbName, dbRole, RESEAU,
} from "../lib/provisioning.js";

const BASE = { slug: "cfa-lumiere", nom: "CFA Lumière", adminEmail: "direction@cfa-lumiere.fr", plan: "reseau" };
const OPTS = { aujourdhui: "2026-09-07" };

test("slug : ce qui devient sous-domaine, conteneur et dossier est verrouillé", () => {
  assert.equal(validateSlug("cfa-lumiere").ok, true);
  assert.equal(validateSlug("cfa93").ok, true);

  // Chacun de ces cas casserait l'un des trois usages, ou pire.
  const refus = {
    "": "vide",
    "ab": "trop court",
    "CFA-Lumiere": "majuscules",
    "cfa.lumiere": "un point crée un niveau de sous-domaine",
    "cfa_lumiere": "underscore interdit en DNS",
    "../etc": "échappement de chemin",
    "cfa/lumiere": "séparateur de chemin",
    "cfa lumiere": "espace",
    "-cfa": "commence par un tiret",
    "cfa-": "finit par un tiret",
    "cfa--lumiere": "double tiret",
    "café": "non-ASCII",
  };
  for (const [mauvais, pourquoi] of Object.entries(refus)) {
    assert.equal(validateSlug(mauvais).ok, false, `« ${mauvais} » doit être refusé (${pourquoi})`);
  }
  // Un sous-domaine « admin » ou « facturation » chez un client serait un
  // cadeau fait au premier email de phishing.
  for (const r of ["www", "admin", "api", "facturation", "stripe"]) {
    assert.equal(validateSlug(r).ok, false, `« ${r} » est réservé`);
    assert.ok(SLUGS_RESERVES.includes(r));
  }
});

test("ports : plus bas libre, réutilisation d'un port rendu, plage bornée", () => {
  assert.equal(allocatePort([]), PORT_BASE);
  assert.equal(allocatePort([{ port: 3300 }, { port: 3301 }]), 3302);
  // Un trou laissé par une résiliation se reprend
  assert.equal(allocatePort([{ port: 3300 }, { port: 3302 }]), 3301);
  const pleine = Array.from({ length: 100 }, (_, i) => ({ port: 3300 + i }));
  assert.equal(allocatePort(pleine), null, "plage saturée : refuser plutôt que déborder sur un port d'un autre service");
});

test("création : instance complète, secrets distincts, plafonds du plan", () => {
  const r = planCreate([], BASE, OPTS);
  assert.equal(r.ok, true);
  const i = r.instance;
  assert.equal(i.host, "cfa-lumiere.campusmanager.fr");
  assert.equal(i.conteneur, "cm-cfa-lumiere");
  assert.equal(i.dossier, "/opt/campus-clients/cfa-lumiere");
  assert.equal(i.port, 3300);
  assert.equal(i.statut, "actif");
  assert.equal(r.plafonds.apprenantsMax, 2000);
  // Deux secrets identiques signeraient un générateur cassé
  assert.notEqual(i.dataKey, i.sessionSecret);
  assert.notEqual(i.dataKey, i.dbPassword);
  assert.ok(i.dataKey.length >= 32 && i.sessionSecret.length >= 32);
  assert.ok(i.adminPassword.length >= 12);
});

test("RECRÉER UNE INSTANCE EXISTANTE EST REFUSÉ — la clé de chiffrement est irremplaçable", () => {
  // C'est la propriété de sûreté la plus importante du module : régénérer
  // DATA_KEY rendrait émargements scellés, contrats et factures définitivement
  // illisibles. Le refus doit être un refus, pas un avertissement.
  const registre = [toRegistry(planCreate([], BASE, OPTS).instance)];
  const r = planCreate(registre, BASE, OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.code, "instance_existante");
  assert.match(r.error, /définitivement illisibles/);
  assert.equal(r.instance, undefined, "aucune instance, donc aucune clé, n'est produite");
  // Y compris si le client renvoie un nom ou un plan différent
  const r2 = planCreate(registre, { ...BASE, nom: "Autre nom", plan: "groupe" }, OPTS);
  assert.equal(r2.ok, false);
  assert.equal(r2.instance, undefined);
});

test("création : entrées invalides refusées avant toute génération de secret", () => {
  const cas = [
    [{ ...BASE, slug: "www" }, /réservé/],
    [{ ...BASE, nom: "" }, /nom du client requis/],
    [{ ...BASE, adminEmail: "pas-un-email" }, /email/],
    [{ ...BASE, plan: "platine" }, /plan inconnu/],
    [{ ...BASE, validUntil: "30/06/2027" }, /AAAA-MM-JJ/],
  ];
  for (const [entree, motif] of cas) {
    const r = planCreate([], entree, OPTS);
    assert.equal(r.ok, false);
    assert.match(r.error, motif);
    assert.equal(r.instance, undefined);
  }
});

test("le registre ne contient AUCUN secret", () => {
  // Le registre est lu par l'exploitation et sauvegardé ; les secrets vivent
  // uniquement dans le .env de l'instance.
  const i = planCreate([], BASE, OPTS).instance;
  const publique = toRegistry(i);
  const serialise = JSON.stringify(publique);
  for (const [champ, valeur] of [["dataKey", i.dataKey], ["sessionSecret", i.sessionSecret], ["adminPassword", i.adminPassword], ["dbPassword", i.dbPassword]]) {
    assert.equal(publique[champ], undefined, `${champ} ne doit pas entrer au registre`);
    assert.equal(serialise.includes(valeur), false, `la valeur de ${champ} ne doit apparaître nulle part`);
  }
  assert.equal(publique.slug, "cfa-lumiere");
  assert.equal(publique.port, 3300);
});

test("rendu .env : secrets exploitables, avertissement sur la clé, licence portée", () => {
  const i = planCreate([], { ...BASE, validUntil: "2027-09-30" }, OPTS).instance;
  const env = renderEnv(i);
  assert.match(env, new RegExp(`^DATA_KEY=${i.dataKey}$`, "m"));
  assert.match(env, /^LICENCE_PLAN=reseau$/m);
  assert.match(env, /^LICENCE_VALID_UNTIL=2027-09-30$/m);
  assert.match(env, /^RP_ID=cfa-lumiere\.campusmanager\.fr$/m);
  assert.match(env, /NE JAMAIS régénérer DATA_KEY/);
  // Une valeur avec un saut de ligne casserait le fichier : les secrets sont en
  // base64url précisément pour que cela ne puisse pas arriver.
  for (const s of [i.dataKey, i.sessionSecret, i.adminPassword, i.dbPassword]) {
    assert.equal(/[\n\r"'\\ ]/.test(s), false, `secret non sûr dans un .env : ${s}`);
  }
  // Sans échéance, la ligne est commentée et non vide — une valeur vide serait
  // lue comme une date invalide au démarrage.
  assert.match(renderEnv(planCreate([], BASE, OPTS).instance), /^# LICENCE_VALID_UNTIL=/m);
});

test("vhost nginx : phase ACME en HTTP d'abord, TLS ensuite", () => {
  const i = planCreate([], BASE, OPTS).instance;
  // Servir un vhost HTTPS dont le certificat n'existe pas encore fait échouer le
  // rechargement de nginx — et coupe TOUTES les autres instances au passage.
  const acme = renderNginx(i, { tls: false });
  assert.match(acme, /acme-challenge/);
  assert.equal(/ssl_certificate/.test(acme), false);
  assert.equal(/return 301/.test(acme), false, "en phase ACME, ne pas rediriger vers un HTTPS inexistant");

  const tls = renderNginx(i);
  assert.match(tls, /ssl_certificate \/etc\/letsencrypt\/live\/cfa-lumiere\.campusmanager\.fr\/fullchain\.pem;/);
  assert.match(tls, /proxy_pass http:\/\/172\.19\.0\.1:3300;/);
  assert.match(tls, /return 301 https/);
  assert.match(tls, /server_name cfa-lumiere\.campusmanager\.fr;/);
});

test("docker run : volume de données, bind local, jamais exposé sur 0.0.0.0", () => {
  const i = planCreate([], BASE, OPTS).instance;
  const args = dockerRunArgs(i);
  const p = args[args.indexOf("-p") + 1];
  assert.equal(p, "172.19.0.1:3300:3200");
  assert.equal(p.startsWith("0.0.0.0"), false, "une instance jointe hors du proxy serait servie sans TLS");
  assert.equal(args[args.indexOf("-v") + 1], "/opt/campus-clients/cfa-lumiere/data:/app/data");
  assert.equal(args[args.indexOf("--name") + 1], "cm-cfa-lumiere");
  assert.equal(args[args.indexOf("--restart") + 1], "unless-stopped");
});

test("audit de flotte : collisions détectées, une instance servie à la place d'une autre", () => {
  const sain = [
    { slug: "a-cfa", port: 3300, host: "a-cfa.campusmanager.fr", plan: "reseau" },
    { slug: "b-cfa", port: 3301, host: "b-cfa.campusmanager.fr", plan: "essentiel" },
  ];
  assert.equal(auditRegistry(sain).ok, true);

  const collision = auditRegistry([...sain, { slug: "c-cfa", port: 3300, host: "c-cfa.campusmanager.fr", plan: "essentiel" }]);
  assert.equal(collision.ok, false);
  assert.match(collision.problemes[0].message, /port 3300 partagé/);

  const memeHost = auditRegistry([...sain, { slug: "d-cfa", port: 3302, host: "a-cfa.campusmanager.fr", plan: "essentiel" }]);
  assert.equal(memeHost.ok, false);
  assert.ok(memeHost.problemes.some((p) => /sous-domaine/.test(p.message)));

  const slugPourri = auditRegistry([{ slug: "../evil", port: 3300, host: "x", plan: "essentiel" }]);
  assert.equal(slugPourri.ok, false);
});

test("mot de passe initial : épelable au téléphone, sans caractère ambigu", () => {
  for (let n = 0; n < 200; n++) {
    const mdp = motDePasseInitial();
    assert.equal(mdp.length, 16);
    assert.equal(/[0O1Il]/.test(mdp), false, `caractère ambigu dans « ${mdp} »`);
    assert.match(mdp, /^[a-zA-Z2-9]+$/);
  }
  // Et les secrets machine, eux, sont sûrs dans un fichier et une URL
  assert.match(secret(32), /^[A-Za-z0-9_-]+$/);
});

test("isolation entre clients : une base et un rôle PAR organisme", () => {
  // L'isolation n'est pas logique mais physique : une requête mal filtrée ne
  // peut pas franchir une frontière qui n'existe pas au niveau SQL.
  const i = planCreate([], BASE, OPTS).instance;
  const env = renderEnv(i);
  assert.match(env, new RegExp(`^DATABASE_URL=postgres://cm_cfa_lumiere:${i.dbPassword}@campus-pg:5432/cm_cfa_lumiere$`, "m"));
  assert.equal(dbName("cfa-lumiere"), "cm_cfa_lumiere", "les tirets ne sont pas valides dans un identifiant SQL non cité");
  assert.equal(dbRole("cfa-lumiere"), "cm_cfa_lumiere");
  // Le mot de passe doit traverser une URL de connexion sans encodage : un « / »
  // ou un « @ » y couperait la chaîne en deux.
  assert.match(i.dbPassword, /^[A-Za-z0-9_-]+$/);
  // Le conteneur rejoint le réseau de la flotte, sinon il ne voit pas la base.
  const args = dockerRunArgs(i);
  assert.equal(args[args.indexOf("--network") + 1], RESEAU);
});

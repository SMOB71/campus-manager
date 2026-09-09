import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifySignature, licenceFromSubscription, applyEvent, planFromPrice,
  correspondanceDepuisEnv, STATUTS, TOLERANCE_SECONDES,
} from "../lib/stripe.js";

const SECRET = "whsec_test_0123456789";
const MAP = { price_ess: "essentiel", price_res: "reseau", price_grp: "groupe" };

function signer(payload, { secret = SECRET, ts = 1_760_000_000 } = {}) {
  const sig = createHmac("sha256", secret).update(`${ts}.${payload}`, "utf8").digest("hex");
  return { header: `t=${ts},v1=${sig}`, nowSec: ts };
}

// ---------- Signature ----------

test("signature valide acceptée, corps modifié refusé", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const { header, nowSec } = signer(payload);
  assert.equal(verifySignature({ payload, header, secret: SECRET, nowSec }).ok, true);

  // Un seul caractère change : la signature ne doit plus valoir.
  const altere = payload.replace("evt_1", "evt_2");
  assert.equal(verifySignature({ payload: altere, header, secret: SECRET, nowSec }).ok, false);
});

test("le corps doit être BRUT — re-sérialiser du JSON parsé invalide la signature", () => {
  // Piège classique : express.json() a déjà consommé le corps, on re-stringify,
  // et les espaces changent. La signature devient fausse sans raison apparente.
  const brut = '{"id":"evt_1",  "type":"customer.subscription.updated"}';
  const { header, nowSec } = signer(brut);
  assert.equal(verifySignature({ payload: brut, header, secret: SECRET, nowSec }).ok, true);
  const reserialise = JSON.stringify(JSON.parse(brut));
  assert.equal(verifySignature({ payload: reserialise, header, secret: SECRET, nowSec }).ok, false);
});

test("rejeu : une signature parfaite mais vieille est refusée", () => {
  const payload = '{"id":"evt_1"}';
  const { header, nowSec } = signer(payload);
  const ok = verifySignature({ payload, header, secret: SECRET, nowSec: nowSec + 10 });
  assert.equal(ok.ok, true, "quelques secondes de décalage sont normales");

  const tard = verifySignature({ payload, header, secret: SECRET, nowSec: nowSec + TOLERANCE_SECONDES + 1 });
  assert.equal(tard.ok, false);
  assert.match(tard.error, /rejeu/);

  // Et un horodatage dans le futur est tout aussi suspect.
  const futur = verifySignature({ payload, header, secret: SECRET, nowSec: nowSec - TOLERANCE_SECONDES - 1 });
  assert.equal(futur.ok, false);
});

test("signature : mauvais secret, en-tête illisible, secret absent", () => {
  const payload = '{"id":"evt_1"}';
  const { header, nowSec } = signer(payload);
  assert.equal(verifySignature({ payload, header, secret: "whsec_autre", nowSec }).ok, false);
  assert.equal(verifySignature({ payload, header: "n'importe quoi", secret: SECRET, nowSec }).ok, false);
  assert.equal(verifySignature({ payload, header: `t=${nowSec}`, secret: SECRET, nowSec }).ok, false);
  // Pas de secret configuré = refus, jamais un laissez-passer.
  assert.equal(verifySignature({ payload, header, secret: "", nowSec }).ok, false);
  assert.equal(verifySignature({ payload, header, secret: undefined, nowSec }).ok, false);
});

// ---------- Traduction abonnement → licence ----------

const sub = (over = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1",
  current_period_end: 1_780_000_000,   // 2026-05-28
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_res" } }] },
  ...over,
});

test("abonnement actif : plan, validité et non-suspension", () => {
  const l = licenceFromSubscription(sub(), { correspondance: MAP });
  assert.equal(l.plan, "reseau");
  assert.equal(l.suspendue, false);
  assert.equal(l.validUntil, "2026-05-28");
  assert.equal(l.stripeCustomerId, "cus_1");
  assert.equal(l.stripeSubscriptionId, "sub_1");
});

test("impayé récent : on NE suspend PAS", () => {
  // La période de grâce de la licence joue déjà ce rôle et Stripe relance de son
  // côté. Suspendre au premier échec de carte, c'est bloquer un CFA pour un
  // plafond bancaire.
  assert.equal(STATUTS.past_due.suspendue, false);
  assert.equal(licenceFromSubscription(sub({ status: "past_due" }), { correspondance: MAP }).suspendue, false);
  // Relances épuisées, en revanche, c'est un abandon caractérisé.
  assert.equal(licenceFromSubscription(sub({ status: "unpaid" }), { correspondance: MAP }).suspendue, true);
  assert.equal(licenceFromSubscription(sub({ status: "canceled" }), { correspondance: MAP }).suspendue, true);
});

test("résiliation programmée : rien ne change tant que la période court", () => {
  // Le client a payé jusqu'au terme : il l'utilise jusqu'au terme.
  const l = licenceFromSubscription(sub({ cancel_at_period_end: true }), { correspondance: MAP });
  assert.equal(l.suspendue, false);
  assert.equal(l.validUntil, "2026-05-28");
  assert.equal(l.resiliationProgrammee, true);
});

test("prix inconnu : aucun plan déduit, plutôt qu'un plan faux", () => {
  assert.equal(planFromPrice("price_jamais_vu", MAP), null);
  assert.equal(planFromPrice("price_res", MAP), "reseau");
  // Une correspondance pointant vers un plan inexistant est ignorée
  assert.equal(planFromPrice("price_x", { price_x: "platine" }), null);
  assert.equal(planFromPrice(null, MAP), null);
});

test("correspondance lue dans l'environnement", () => {
  const m = correspondanceDepuisEnv({ STRIPE_PRICE_ESSENTIEL: "price_a", STRIPE_PRICE_GROUPE: "price_c", AUTRE: "x" });
  assert.deepEqual(m, { price_a: "essentiel", price_c: "groupe" });
});

// ---------- Application des événements ----------

const evt = (over = {}) => ({
  id: "evt_1", type: "customer.subscription.updated", created: 1_760_000_000,
  data: { object: sub() }, ...over,
});

test("événement appliqué : l'état reflète l'abonnement", () => {
  const r = applyEvent({}, evt(), { correspondance: MAP });
  assert.equal(r.applique, true);
  assert.equal(r.etat.plan, "reseau");
  assert.equal(r.etat.validUntil, "2026-05-28");
  assert.equal(r.etat.dernierEvenementId, "evt_1");
});

test("DOUBLON : Stripe réémet tant qu'il n'a pas de 2xx — le même événement n'agit qu'une fois", () => {
  const un = applyEvent({}, evt(), { correspondance: MAP });
  const deux = applyEvent(un.etat, evt(), { correspondance: MAP });
  assert.equal(deux.applique, false);
  assert.equal(deux.dejaVu, true);
  assert.deepEqual(deux.etat, un.etat);
});

test("DÉSORDRE : un événement antérieur ne fait pas régresser l'état", () => {
  // Cas réel : la résiliation arrive après le renouvellement qui l'a suivie.
  // L'appliquer laisserait l'instance suspendue alors que le client a repayé.
  const resiliation = applyEvent({}, evt({
    id: "evt_old", type: "customer.subscription.deleted", created: 1_759_000_000,
    data: { object: sub({ status: "canceled" }) },
  }), { correspondance: MAP });
  assert.equal(resiliation.etat.suspendue, true);

  const renouvellement = applyEvent(resiliation.etat, evt({
    id: "evt_new", created: 1_760_000_000, data: { object: sub({ status: "active" }) },
  }), { correspondance: MAP });
  assert.equal(renouvellement.etat.suspendue, false, "le renouvellement, plus récent, doit passer");

  const retardataire = applyEvent(renouvellement.etat, evt({
    id: "evt_retard", type: "customer.subscription.deleted", created: 1_758_000_000,
    data: { object: sub({ status: "canceled" }) },
  }), { correspondance: MAP });
  assert.equal(retardataire.applique, false);
  assert.equal(retardataire.obsolete, true);
  assert.equal(retardataire.etat.suspendue, false, "l'état ne doit pas régresser");
});

test("résiliation : la validité se ferme au jour de l'événement, pas au terme non payé", () => {
  // Sans cela, le current_period_end d'un abonnement supprimé laisserait la
  // licence ouverte jusqu'au bout d'une période que plus personne ne paie.
  const r = applyEvent({}, evt({
    type: "customer.subscription.deleted", created: 1_762_000_000,   // 2025-11-01
    data: { object: sub({ status: "canceled", current_period_end: 1_780_000_000 }) },
  }), { correspondance: MAP });
  assert.equal(r.applique, true);
  assert.equal(r.etat.suspendue, true);
  assert.equal(r.etat.validUntil, "2025-11-01");
  assert.notEqual(r.etat.validUntil, "2026-05-28");
});

test("plan non reconnu : l'existant est conservé, jamais de rétrogradation silencieuse", () => {
  const initial = applyEvent({}, evt(), { correspondance: MAP }).etat;
  assert.equal(initial.plan, "reseau");
  const apres = applyEvent(initial, evt({
    id: "evt_2", created: 1_761_000_000,
    data: { object: sub({ items: { data: [{ price: { id: "price_inconnu" } }] } }) },
  }), { correspondance: MAP });
  assert.equal(apres.applique, true);
  assert.equal(apres.etat.plan, "reseau", "un identifiant de prix non mappé ne doit pas déclasser le client");
});

test("types non suivis acquittés sans effet", () => {
  // Répondre 2xx à ce qu'on ignore : sinon Stripe réémet indéfiniment.
  const r = applyEvent({ plan: "reseau" }, evt({ id: "evt_x", type: "invoice.paid" }), { correspondance: MAP });
  assert.equal(r.applique, false);
  assert.equal(r.ignore, true);
  assert.equal(r.etat.plan, "reseau");
});

test("événement malformé : refus propre, aucun état corrompu", () => {
  for (const mauvais of [{}, { type: "customer.subscription.updated" }, { id: "e", type: "customer.subscription.updated", data: {} }]) {
    const r = applyEvent({ plan: "reseau" }, mauvais, { correspondance: MAP });
    assert.equal(r.applique, false);
    assert.equal(r.etat.plan, "reseau");
  }
});

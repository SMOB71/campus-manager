// Abonnement Stripe → état de licence de l'instance. Logique pure (aucun appel
// réseau, aucune dépendance : la vérification de signature tient en trente
// lignes de crypto standard, et une dépendance de moins sur un chemin qui
// décide qui peut écrire dans l'application est une dépendance de moins à
// auditer).
//
// CE QUE STRIPE EST, ET CE QU'IL N'EST PAS — Stripe est la source de vérité de
// la FACTURATION : quel prix, quelle période payée, quel statut d'abonnement.
// Il n'est pas la source de vérité de ce que le client a le droit de faire :
// cette traduction se fait ici, et elle est délibérément clémente (voir
// lib/licence.js — un impayé ne coupe jamais l'accès aux données).
//
// TROIS PIÈGES DE WEBHOOK, tous traités ici parce qu'aucun ne se voit en
// développement et que tous se produisent en production :
//
//   1. REJEU — un webhook capté puis renvoyé plus tard réactiverait un
//      abonnement résilié. D'où le contrôle d'horodatage dans la signature.
//   2. DOUBLON — Stripe réémet un événement tant qu'il n'a pas reçu de 2xx. Le
//      même événement peut donc arriver plusieurs fois. D'où l'idempotence par
//      identifiant d'événement.
//   3. DÉSORDRE — les événements n'arrivent pas dans l'ordre où ils ont été
//      produits. Une résiliation suivie d'un renouvellement peut se présenter à
//      l'envers, et l'instance resterait suspendue à tort. D'où le refus
//      d'appliquer un événement plus ancien que le dernier appliqué.

import { createHmac, timingSafeEqual } from "node:crypto";
import { PLAN_IDS } from "./licence.js";

export const TOLERANCE_SECONDES = 300;

// Vérification de la signature Stripe (schéma v1). Le corps DOIT être le corps
// brut : re-sérialiser du JSON parsé change les espaces et invalide la signature.
export function verifySignature({ payload, header, secret, toleranceSec = TOLERANCE_SECONDES, nowSec = null }) {
  if (!secret) return { ok: false, error: "aucun secret de webhook configuré" };
  if (!payload || !header) return { ok: false, error: "corps ou signature absents" };

  const parties = String(header).split(",").map((p) => p.split("="));
  const horodatage = parties.find((p) => p[0].trim() === "t")?.[1];
  const signatures = parties.filter((p) => p[0].trim() === "v1").map((p) => (p[1] || "").trim());
  if (!horodatage || !signatures.length) return { ok: false, error: "en-tête de signature illisible" };

  const maintenant = nowSec ?? Math.floor(Date.now() / 1000);
  const age = maintenant - Number(horodatage);
  // Un événement trop vieux est refusé même si sa signature est parfaite : c'est
  // exactement la forme que prend un rejeu.
  if (!Number.isFinite(age) || Math.abs(age) > toleranceSec) {
    return { ok: false, error: `horodatage hors tolérance (${age}s) — rejeu probable` };
  }

  const attendu = createHmac("sha256", secret).update(`${horodatage}.${payload}`, "utf8").digest("hex");
  const attenduBuf = Buffer.from(attendu, "utf8");
  // Comparaison à temps constant : une comparaison naïve laisse fuir la
  // signature octet par octet.
  const correspond = signatures.some((s) => {
    const b = Buffer.from(s, "utf8");
    return b.length === attenduBuf.length && timingSafeEqual(b, attenduBuf);
  });
  return correspond ? { ok: true } : { ok: false, error: "signature invalide" };
}

// Statuts d'abonnement Stripe → ce que l'instance en fait.
// `suspendue` ne veut PAS dire « coupée » : l'application passe en lecture seule
// et le client garde l'accès à ses données et à ses exports.
export const STATUTS = {
  trialing: { suspendue: false, libelle: "période d'essai" },
  active: { suspendue: false, libelle: "actif" },
  // Impayé récent : on ne suspend pas. La période de grâce de la licence joue
  // déjà ce rôle, et Stripe relance de son côté.
  past_due: { suspendue: false, libelle: "impayé en cours de relance" },
  incomplete: { suspendue: false, libelle: "paiement initial en attente" },
  incomplete_expired: { suspendue: true, libelle: "paiement initial jamais abouti" },
  unpaid: { suspendue: true, libelle: "impayé, relances épuisées" },
  canceled: { suspendue: true, libelle: "résilié" },
  paused: { suspendue: true, libelle: "en pause" },
};

// Correspondance identifiant de prix Stripe → plan. Elle vient de la
// configuration : coder un identifiant de prix en dur garantit qu'il sera faux
// le jour où le catalogue change.
export function planFromPrice(priceId, correspondance = {}) {
  if (!priceId) return null;
  const plan = correspondance[priceId];
  return PLAN_IDS.includes(plan) ? plan : null;
}

const jourISO = (secondes) => (secondes ? new Date(Number(secondes) * 1000).toISOString().slice(0, 10) : null);

// Traduction d'un objet abonnement Stripe en état de licence.
export function licenceFromSubscription(sub, { correspondance = {} } = {}) {
  if (!sub || typeof sub !== "object") return null;
  const statut = STATUTS[sub.status] || { suspendue: true, libelle: sub.status || "inconnu" };
  const priceId = sub.items?.data?.[0]?.price?.id || sub.plan?.id || null;
  const plan = planFromPrice(priceId, correspondance);
  return {
    plan,                                   // null = ne pas toucher au plan en place
    // La fin de période payée EST la validité de la licence. `cancel_at_period_end`
    // ne change rien tant que la période court : le client a payé, il l'utilise.
    validUntil: jourISO(sub.current_period_end),
    suspendue: statut.suspendue,
    statutStripe: sub.status || null,
    statutLibelle: statut.libelle,
    resiliationProgrammee: !!sub.cancel_at_period_end,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
    stripeSubscriptionId: sub.id || null,
    priceId,
  };
}

// Événements qui portent un abonnement. Les autres sont acquittés sans effet :
// répondre 2xx à un événement qu'on ignore vaut mieux que laisser Stripe le
// réémettre indéfiniment.
export const EVENEMENTS_SUIVIS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

// Application d'un événement à l'état courant. Fonction PURE : elle renvoie le
// nouvel état, ou dit pourquoi elle n'a rien fait.
export function applyEvent(etatCourant = {}, evenement = {}, { correspondance = {} } = {}) {
  const id = evenement.id;
  if (!id) return { applique: false, motif: "événement sans identifiant", etat: etatCourant };

  // Piège n° 2 — doublon.
  if (etatCourant.dernierEvenementId === id) {
    return { applique: false, motif: "événement déjà appliqué", etat: etatCourant, dejaVu: true };
  }
  if (!EVENEMENTS_SUIVIS.has(evenement.type)) {
    return { applique: false, motif: `type non suivi (${evenement.type})`, etat: etatCourant, ignore: true };
  }
  // Piège n° 3 — désordre. Un événement antérieur au dernier appliqué décrit un
  // passé révolu : l'appliquer ferait régresser l'état.
  const cree = Number(evenement.created) || 0;
  if (etatCourant.dernierEvenementLe && cree && cree < Number(etatCourant.dernierEvenementLe)) {
    return { applique: false, motif: "événement antérieur au dernier appliqué", etat: etatCourant, obsolete: true };
  }

  const sub = evenement.data?.object;
  const traduit = licenceFromSubscription(sub, { correspondance });
  if (!traduit) return { applique: false, motif: "abonnement absent de l'événement", etat: etatCourant };

  // Une résiliation ferme la période au jour de l'événement : sans cela, le
  // `current_period_end` d'un abonnement supprimé laisserait la licence valide
  // jusqu'au terme d'une période que plus personne ne paie.
  const resilie = evenement.type === "customer.subscription.deleted";

  return {
    applique: true,
    etat: {
      ...etatCourant,
      // Un plan non reconnu ne dégrade pas l'existant : mieux vaut un plan
      // périmé qu'un client rétrogradé par une erreur de configuration.
      plan: traduit.plan || etatCourant.plan || null,
      validUntil: resilie ? jourISO(evenement.created) : traduit.validUntil,
      suspendue: traduit.suspendue,
      statutStripe: traduit.statutStripe,
      statutLibelle: resilie ? "résilié" : traduit.statutLibelle,
      resiliationProgrammee: traduit.resiliationProgrammee,
      stripeCustomerId: traduit.stripeCustomerId || etatCourant.stripeCustomerId || null,
      stripeSubscriptionId: traduit.stripeSubscriptionId || etatCourant.stripeSubscriptionId || null,
      priceId: traduit.priceId || etatCourant.priceId || null,
      dernierEvenementId: id,
      dernierEvenementLe: cree || etatCourant.dernierEvenementLe || null,
      dernierEvenementType: evenement.type,
      majLe: new Date().toISOString(),
    },
  };
}

// Correspondance prix → plan lue dans l'environnement.
export function correspondanceDepuisEnv(env = process.env) {
  const m = {};
  for (const plan of PLAN_IDS) {
    const cle = env[`STRIPE_PRICE_${plan.toUpperCase()}`];
    if (cle) m[cle] = plan;
  }
  return m;
}

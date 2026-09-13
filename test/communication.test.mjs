import test from "node:test";
import assert from "node:assert/strict";
import { preparer, segmentsSms, fusionner, tracer, bilan, NATURES, emailValide, mobileValide } from "../lib/communication.js";

const dest = (o = {}) => ({ id: "d1", nom: "Léa Dupont", email: "lea@example.fr", telephone: "0612345678", ...o });

test("LA NATURE DU MESSAGE N'A PAS DE VALEUR PAR DÉFAUT", () => {
  // La deviner reviendrait à trancher une question juridique à la place de
  // l'organisme : un message de gestion et un message de prospection n'ont pas
  // les mêmes obligations.
  const r = preparer({ canal: "email", sujet: "Objet", corps: "Texte", destinataires: [dest()] });
  assert.equal(r.envoyable, false);
  assert.ok(r.errors.some((e) => /nature du message requise/.test(e)));
  assert.equal(NATURES.gestion.consentementRequis, false);
  assert.equal(NATURES.prospection.consentementRequis, true);
});

test("UNE CONVOCATION NE SE SOUMET PAS AU CONSENTEMENT", () => {
  // Si un apprenant pouvait se désinscrire de sa convocation d'examen,
  // l'organisme manquerait à son obligation d'information.
  const r = preparer({
    canal: "email", nature: "gestion", sujet: "Convocation",
    corps: "Vous êtes convoqué le 15 juin.",
    destinataires: [dest({ consentement: false, optOut: true })],
  });
  assert.equal(r.envoyable, true);
  assert.equal(r.total, 1);
  assert.equal(r.ecartes.length, 0, "ni le consentement ni le retrait ne s'opposent à un message de gestion");
});

test("UNE PROSPECTION SANS CONSENTEMENT NE PART PAS", () => {
  const r = preparer({
    canal: "email", nature: "prospection", sujet: "Portes ouvertes",
    corps: "Venez nous rencontrer.", lienRetrait: "https://exemple.fr/retrait",
    destinataires: [dest({ consentement: false }), dest({ id: "d2", nom: "Consentant", consentement: true })],
  });
  assert.equal(r.total, 1);
  assert.equal(r.ecartes.length, 1);
  assert.match(r.ecartes[0].motif, /consentement absent/);

  // Et un retrait est respecté.
  const retrait = preparer({ canal: "email", nature: "prospection", sujet: "X", corps: "Y",
    lienRetrait: "https://exemple.fr/retrait", destinataires: [dest({ consentement: true, optOut: true })] });
  assert.equal(retrait.total, 0);
  assert.match(retrait.ecartes[0].motif, /s'est retiré/);
});

test("une prospection sans lien de retrait est refusée", () => {
  const r = preparer({ canal: "email", nature: "prospection", sujet: "X", corps: "Y",
    destinataires: [dest({ consentement: true })] });
  assert.equal(r.envoyable, false);
  assert.ok(r.errors.some((e) => /lien de retrait/.test(e)));
  // Un message de gestion, lui, n'en a pas besoin.
  assert.equal(preparer({ canal: "email", nature: "gestion", sujet: "X", corps: "Y", destinataires: [dest()] }).envoyable, true);
});

test("VARIABLE NON RÉSOLUE : le destinataire est écarté, pas servi avec « {{prenom}} »", () => {
  // Envoyer « Bonjour {{prenom}} » à trois cents personnes est un incident.
  const f = fusionner("Bonjour {{prenom}}, salle {{salle}}.", { prenom: "Léa" });
  assert.deepEqual(f.manquantes, ["salle"]);
  assert.match(f.texte, /\{\{salle\}\}/);

  const r = preparer({ canal: "email", nature: "gestion", sujet: "Convocation",
    corps: "Bonjour {{prenom}}, salle {{salle}}.",
    destinataires: [dest({ variables: { prenom: "Léa" } }), dest({ id: "d2", variables: { prenom: "Sami", salle: "B12" } })] });
  assert.equal(r.total, 1);
  assert.match(r.ecartes[0].motif, /variables non résolues : salle/);
  assert.match(r.retenus[0].texte, /salle B12/);
});

test("SMS : les accents font tomber la limite de 160 à 70 caractères", () => {
  // C'est la surprise classique sur la facture : un texte de 80 caractères
  // coûte un SMS ou deux selon sa ponctuation.
  const sansAccent = segmentsSms("A".repeat(160));
  assert.equal(sansAccent.segments, 1);
  assert.equal(sansAccent.encodage, "GSM-7");

  const avecAccent = segmentsSms("Convocation à l'épreuve — merci de vous présenter muni de votre pièce d'identité.");
  assert.equal(avecAccent.encodage, "UCS-2");
  assert.equal(avecAccent.limite, 70);
  assert.equal(avecAccent.segments, 2, "79 caractères accentués = deux segments");

  assert.equal(segmentsSms("A".repeat(161)).segments, 2);
  assert.equal(segmentsSms("").segments, 0);
});

test("SMS : le coût est annoncé AVANT l'envoi, et les non-mobiles écartés", () => {
  const r = preparer({
    canal: "sms", nature: "gestion", corps: "Cours annulé demain.",
    destinataires: [dest(), dest({ id: "d2", telephone: "0145678901" }), dest({ id: "d3", telephone: "" })],
  });
  assert.equal(r.total, 1, "un fixe reçoit un SMS qui n'arrivera jamais : on l'écarte");
  assert.equal(r.coutSms, 1);
  assert.ok(r.ecartes.some((e) => /non mobile/.test(e.motif)));
  assert.ok(r.ecartes.some((e) => /aucun numéro/.test(e.motif)));

  const long = preparer({ canal: "sms", nature: "gestion",
    corps: "Votre convocation à l'épreuve de mercredi est décalée à 14 h en salle B12, merci de prévenir votre maître d'apprentissage.",
    destinataires: [dest()] });
  assert.ok(long.coutSms > 1);
  assert.ok(long.warnings.some((w) => /plusieurs segments/.test(w)));
});

test("validation des adresses et des numéros", () => {
  assert.equal(emailValide("a@b.fr"), true);
  assert.equal(emailValide("pas-une-adresse"), false);
  assert.equal(mobileValide("0612345678"), true);
  assert.equal(mobileValide("+33 6 12 34 56 78"), true);
  assert.equal(mobileValide("0145678901"), false, "un fixe n'est pas un mobile");
  assert.equal(mobileValide("06 12 34"), false);
});

test("LA TRACE NE RECONSTITUE PAS UNE BASE DE CONTACTS", () => {
  // On garde de quoi prouver l'envoi, pas de quoi réutiliser les coordonnées.
  const t = tracer({ campagneId: "c1", canal: "email", nature: "gestion", sujet: "Convocation",
    destinataire: { id: "d1", nom: "Léa Dupont" }, adresse: "lea.dupont@example.fr" });
  assert.equal(t.adresseMasquee, "le***@example.fr");
  assert.equal(String(JSON.stringify(t)).includes("lea.dupont@example.fr"), false);
  assert.equal(t.destinataireNom, "Léa Dupont");
  assert.ok(t.envoyeLe);

  const sms = tracer({ campagneId: "c1", canal: "sms", nature: "gestion", destinataire: { id: "d1" }, adresse: "0612345678" });
  assert.equal(sms.adresseMasquee, "0612***78");
});

test("bilan : les échecs sont détaillés — « je n'ai jamais reçu » doit pouvoir s'instruire", () => {
  const traces = [
    tracer({ campagneId: "c1", canal: "email", nature: "gestion", destinataire: { id: "1", nom: "A" }, adresse: "a@x.fr" }),
    tracer({ campagneId: "c1", canal: "email", nature: "gestion", destinataire: { id: "2", nom: "B" }, adresse: "b@x.fr", statut: "echec", erreur: "boîte pleine" }),
  ];
  const b = bilan(traces);
  assert.equal(b.total, 2);
  assert.equal(b.envoyes, 1);
  assert.equal(b.echecs, 1);
  assert.equal(b.detailEchecs[0].destinataire, "B");
  assert.match(b.detailEchecs[0].erreur, /boîte pleine/);
});

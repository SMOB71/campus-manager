import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSession, etatConvocation, deliberation, validateComposition,
  DECISIONS_JURY, DECISIONS_BLOC, SESSION_STATUTS, DELAI_CONVOCATION_JOURS,
} from "../lib/jury.js";

const BLOCS = [
  { blocId: "b1", code: "B1", label: "Technique", status: "acquis", moyenne: 13, seuil: 10 },
  { blocId: "b2", code: "B2", label: "Gestion", status: "non_acquis", moyenne: 8, seuil: 10 },
];

test("session : dates cohérentes, convocation tracée", () => {
  assert.equal(validateSession({ date: "2027-06-15", intitule: "Épreuve E4", lieu: "Campus" }).ok, true);
  const v = validateSession({});
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /date de session/.test(e)));
  assert.ok(v.errors.some((e) => /intitulé/.test(e)));

  const inverse = validateSession({ date: "2027-06-15", intitule: "E4", dateConvocation: "2027-07-01" });
  assert.equal(inverse.ok, false);
  assert.ok(inverse.errors.some((e) => /postérieure à l'épreuve/.test(e)));

  const tenue = validateSession({ date: "2027-06-15", intitule: "E4", statut: "tenue", lieu: "Campus" });
  assert.ok(tenue.warnings.some((w) => /sans trace de convocation/.test(w)));
  assert.ok(Object.keys(SESSION_STATUTS).includes("deliberee"));
});

test("convocation : un délai trop court est un motif de contestation", () => {
  // Et c'est l'organisme qui perd le recours. On le dit avant l'épreuve.
  const court = etatConvocation({ date: "2027-06-15", dateConvocation: "2027-06-12" });
  assert.equal(court.insuffisant, true);
  assert.equal(court.prevenanceJours, 3);
  assert.match(court.alerte, /3 jour\(s\) avant l'épreuve/);

  const correct = etatConvocation({ date: "2027-06-15", dateConvocation: "2027-05-15" });
  assert.equal(correct.insuffisant, false);
  assert.equal(correct.alerte, null);
  assert.equal(correct.delaiJours, DELAI_CONVOCATION_JOURS);

  const absente = etatConvocation({ date: "2027-06-15" });
  assert.equal(absente.convoquee, false);
  assert.match(absente.alerte, /Aucune convocation/);
});

test("le jury est SOUVERAIN, mais tout écart avec le calcul doit être motivé", () => {
  // Un PV où un bloc passe de « non acquis » à « acquis » sans un mot est
  // exactement ce qu'un certificateur relève.
  const sansMotif = deliberation({
    blocsCalcules: BLOCS,
    decisions: { b1: "acquis", b2: "acquis" },
    decisionGlobale: "admis",
  });
  assert.equal(sansMotif.ecarts, 1);
  assert.deepEqual(sansMotif.sansMotif, ["B2"]);
  assert.equal(sansMotif.signable, false);
  assert.ok(sansMotif.manquantes.some((m) => /écart non motivé/.test(m)));

  const motive = deliberation({
    blocsCalcules: BLOCS,
    decisions: { b1: "acquis", b2: "acquis" },
    motifs: { b2: "Progression constante et validation de la situation professionnelle." },
    decisionGlobale: "admis",
  });
  assert.equal(motive.ecarts, 1);
  assert.deepEqual(motive.sansMotif, []);
  assert.equal(motive.signable, true, "le jury peut aller contre le calcul, s'il l'écrit");
});

test("un bloc non prononcé empêche de signer le procès-verbal", () => {
  const d = deliberation({ blocsCalcules: BLOCS, decisions: { b1: "acquis" }, decisionGlobale: "admis_partiel" });
  assert.equal(d.blocsPrononces, 1);
  assert.equal(d.signable, false);
  assert.ok(d.manquantes.some((m) => /1 bloc\(s\) sans décision/.test(m)));
});

test("« admis » avec un bloc non acquis n'est pas soutenable — pas de compensation", () => {
  const d = deliberation({
    blocsCalcules: BLOCS,
    decisions: { b1: "acquis", b2: "non_acquis" },
    decisionGlobale: "admis",
  });
  assert.ok(d.incoherence);
  assert.match(d.incoherence, /sans compensation entre blocs/);
  assert.equal(d.signable, false);
  assert.equal(d.proposeGlobale, "admis_partiel", "la proposition, elle, est cohérente");
});

test("un bloc acquis par dispense arrive déjà acquis : le jury n'a pas à le reprononcer", () => {
  const d = deliberation({
    blocsCalcules: [BLOCS[0], { blocId: "b2", code: "B2", label: "Gestion", status: "acquis_dispense" }],
    decisions: { b1: "acquis", b2: "acquis" },
    decisionGlobale: "admis",
  });
  assert.equal(d.ecarts, 0, "acquis par dispense = proposé acquis, aucun écart");
  assert.equal(d.lignes[1].parDispense, true);
  assert.equal(d.signable, true);
  assert.equal(d.decisionLabel, DECISIONS_JURY.admis);
});

test("décision globale non prononcée : le PV n'est pas signable", () => {
  const d = deliberation({ blocsCalcules: BLOCS, decisions: { b1: "acquis", b2: "non_acquis" } });
  assert.equal(d.signable, false);
  assert.ok(d.manquantes.some((m) => /décision globale/.test(m)));
  assert.deepEqual(Object.keys(DECISIONS_BLOC), ["acquis", "non_acquis", "ajourne"]);
});

test("composition : sans président identifié, le procès-verbal ne vaut rien", () => {
  const v = validateComposition([{ nom: "M. A", role: "formateur" }]);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /président de jury non désigné/.test(e)));
  assert.ok(v.warnings.some((w) => /aucun professionnel du métier/.test(w)));

  assert.equal(validateComposition([]).ok, false);
  const complet = validateComposition([{ nom: "Mme B", role: "president" }, { nom: "M. C", role: "professionnel" }]);
  assert.equal(complet.ok, true);
  assert.deepEqual(complet.warnings, []);
  assert.equal(complet.membres, 2);
});

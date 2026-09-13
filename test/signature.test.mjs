import test from "node:test";
import assert from "node:assert/strict";
import {
  genererJeton, jetonCorrespond, empreinteDocument, validateDemande,
  signer, etatDemande, verifier, NIVEAU, ROLES, canonique,
} from "../lib/signature.js";

function demandeType() {
  const j1 = genererJeton(), j2 = genererJeton(), j3 = genererJeton();
  return {
    demande: {
      titre: "Contrat d'apprentissage", type: "contrat_apprentissage",
      empreinte: empreinteDocument({ numero: "C-1", dateDebut: "2027-09-01" }),
      envoyeLe: "2027-08-01", expireLe: "2027-08-31",
      parties: [
        { id: "p1", role: "apprenant", nom: "Léa Dupont", email: "lea@x.fr", jetonHash: j1.hash },
        { id: "p2", role: "employeur", nom: "Optique Martin", email: "rh@x.fr", jetonHash: j2.hash },
        { id: "p3", role: "organisme", nom: "CFA Lumière", email: "dir@x.fr", jetonHash: j3.hash },
      ],
    },
    jetons: { p1: j1.jeton, p2: j2.jeton, p3: j3.jeton },
  };
}

test("LE NIVEAU EST DIT, ET C'EST « SIMPLE » — jamais avancée ni qualifiée", () => {
  // Prétendre fournir une signature qualifiée sans prestataire de confiance
  // serait un mensonge coûteux le jour où le document est contesté.
  assert.equal(NIVEAU, "simple");
  const { demande, jetons } = demandeType();
  const r = signer({ demande, partieId: "p1", jeton: jetons.p1, maintenant: "2027-08-05T10:00:00Z" });
  assert.equal(r.preuve.niveau, "simple");
  const v = verifier({ demande });
  assert.match(v.niveauLabel, /simple/i);
  assert.match(v.reserve, /charge de la preuve/);
  assert.match(v.reserve, /prestataire de confiance/);
});

test("ON SIGNE UN ÉTAT DU DOCUMENT, PAS « LE DOCUMENT »", () => {
  const v = validateDemande({ titre: "X", parties: [{ role: "apprenant", nom: "A", email: "a@x.fr" }] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /empreinte du document requise/.test(e)));
  // L'empreinte est stable quel que soit l'ordre des clés.
  assert.equal(empreinteDocument({ a: 1, b: 2 }), empreinteDocument({ b: 2, a: 1 }));
  assert.notEqual(empreinteDocument({ a: 1 }), empreinteDocument({ a: 2 }));
  assert.equal(canonique({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("un contrat d'apprentissage sans employeur n'est pas un contrat", () => {
  const v = validateDemande({
    titre: "Contrat", type: "contrat_apprentissage", empreinte: "abc",
    parties: [{ id: "p1", role: "apprenant", nom: "A", email: "a@x.fr" }],
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Employeur/.test(e)));
  assert.ok(v.errors.some((e) => /Organisme de formation/.test(e)));
  assert.ok(Object.keys(ROLES).includes("representant"));
});

test("sans date d'expiration : on avertit — une demande qui traîne finit signée par erreur", () => {
  const { demande } = demandeType();
  const v = validateDemande({ ...demande, expireLe: null });
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /finit par être signée par erreur/.test(w)));
});

test("le jeton est nominatif, à usage unique, et jamais relisible", () => {
  const { demande, jetons } = demandeType();
  const p = demande.parties[0];
  assert.equal(jetonCorrespond(jetons.p1, p.jetonHash), true);
  assert.equal(jetonCorrespond(jetons.p2, p.jetonHash), false, "le jeton d'un autre ne signe pas à sa place");
  assert.equal(jetonCorrespond("", p.jetonHash), false);
  assert.equal(String(JSON.stringify(demande)).includes(jetons.p1), false, "seule l'empreinte est stockée");

  const r = signer({ demande, partieId: "p1", jeton: "inventé", maintenant: "2027-08-05T10:00:00Z" });
  assert.match(r.error, /lien de signature invalide/);
});

test("une demande expirée ne se signe plus", () => {
  const { demande, jetons } = demandeType();
  const r = signer({ demande, partieId: "p1", jeton: jetons.p1, maintenant: "2027-09-15T10:00:00Z" });
  assert.match(r.error, /expirée le 2027-08-31/);
});

test("signer deux fois est refusé", () => {
  const { demande, jetons } = demandeType();
  const r = signer({ demande, partieId: "p1", jeton: jetons.p1, maintenant: "2027-08-05T10:00:00Z" });
  demande.parties[0].signeLe = r.preuve.signeLe;
  demande.parties[0].preuve = r.preuve;
  assert.match(signer({ demande, partieId: "p1", jeton: jetons.p1 }).error, /déjà signé/);
});

test("CHAÎNAGE : chaque signature scelle la précédente", () => {
  const { demande, jetons } = demandeType();
  let prev = null;
  for (const [i, id] of ["p1", "p2", "p3"].entries()) {
    const r = signer({ demande, partieId: id, jeton: jetons[id], ip: "10.0.0.1", userAgent: "Mozilla/5.0",
      maintenant: `2027-08-0${i + 5}T10:00:00Z`, prevHash: prev });
    const partie = demande.parties.find((p) => p.id === id);
    partie.signeLe = r.preuve.signeLe;
    partie.preuve = r.preuve;
    prev = r.preuve.hash;
  }
  const e = etatDemande(demande);
  assert.equal(e.complet, true);
  assert.equal(e.etat, "signe");
  assert.equal(e.signees, 3);
  assert.deepEqual(e.manquantes, []);

  const v = verifier({ demande, empreinteActuelle: demande.empreinte });
  assert.equal(v.intact, true);
  assert.equal(v.signatures, 3);

  // Altérer une preuve rompt la chaîne.
  demande.parties[1].preuve.nom = "Quelqu'un d'autre";
  const casse = verifier({ demande });
  assert.equal(casse.intact, false);
  assert.ok(casse.problemes.some((p) => /altérée/.test(p.message)));
});

test("LE DOCUMENT MODIFIÉ APRÈS SIGNATURE EST DÉTECTÉ", () => {
  // C'est la question que pose un contradicteur, et il faut pouvoir y répondre
  // par un calcul, pas par une affirmation.
  const { demande, jetons } = demandeType();
  const r = signer({ demande, partieId: "p1", jeton: jetons.p1, maintenant: "2027-08-05T10:00:00Z" });
  demande.parties[0].signeLe = r.preuve.signeLe;
  demande.parties[0].preuve = r.preuve;

  const nouvelle = empreinteDocument({ numero: "C-1", dateDebut: "2027-10-01" });   // la date a changé
  const v = verifier({ demande, empreinteActuelle: nouvelle });
  assert.equal(v.intact, false);
  assert.ok(v.problemes.some((p) => /modifié depuis la demande/.test(p.message)));
  assert.ok(v.problemes.some((p) => /ne valent pas pour cette version/.test(p.message)));
});

test("état : partiel tant qu'il manque une partie, et les manquantes sont nommées", () => {
  const { demande, jetons } = demandeType();
  const r = signer({ demande, partieId: "p1", jeton: jetons.p1, maintenant: "2027-08-05T10:00:00Z" });
  demande.parties[0].signeLe = r.preuve.signeLe;
  demande.parties[0].preuve = r.preuve;
  const e = etatDemande(demande);
  assert.equal(e.etat, "partiel");
  assert.equal(e.complet, false);
  assert.equal(e.manquantes.length, 2);
  assert.match(e.manquantes[0], /Employeur — Optique Martin/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { calculer, publier, validateDeclaration, INDICATEURS, SEUIL_EFFECTIF } from "../lib/indicateurs.js";

const inscrits = (n, o = {}) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, statut: "inscrit", ...o }));

test("UN TAUX SUR TROIS PERSONNES N'EST PAS PUBLIABLE — il les DÉSIGNE", () => {
  // Avec 2 réussites sur 3, le tiers qui a échoué est identifiable par toute
  // personne connaissant la promotion. Ce n'est pas une précaution statistique,
  // c'est une question de protection des personnes.
  const c = calculer({
    inscriptions: inscrits(3),
    certifications: [{ presente: true, obtenu: true }, { presente: true, obtenu: true }, { presente: true, obtenu: false }],
    contrats: [],
  });
  assert.equal(c.obtention.publiable, false);
  assert.equal(c.obtention.valeur, null, "aucun taux n'est calculé, pas même pour information");
  assert.match(c.obtention.motif, /rend les individus identifiables/);
  assert.equal(SEUIL_EFFECTIF, 10);
});

test("au-delà du seuil, le taux est publié AVEC son effectif", () => {
  // Un pourcentage sans son effectif n'est pas une information.
  const c = calculer({
    inscriptions: inscrits(20),
    certifications: Array.from({ length: 20 }, (_, i) => ({ presente: true, obtenu: i < 17 })),
    contrats: [],
  });
  assert.equal(c.obtention.publiable, true);
  assert.equal(c.obtention.valeur, 85);
  assert.equal(c.obtention.effectif, 20);
  assert.equal(c.obtention.presentes, 20);
  assert.equal(c.obtention.obtenus, 17);
});

test("OBTENTION : rapportée aux PRÉSENTÉS, pas à l'effectif de départ", () => {
  // Rapporter les reçus à l'effectif initial mélangerait échec et abandon, et
  // ferait passer un abandon pour un échec à l'examen.
  const c = calculer({
    inscriptions: inscrits(20),
    certifications: [...Array.from({ length: 15 }, () => ({ presente: true, obtenu: true })),
                     ...Array.from({ length: 5 }, () => ({ presente: false, obtenu: false }))],
    contrats: [],
  });
  assert.equal(c.obtention.presentes, 15);
  assert.equal(c.obtention.valeur, 100, "15 présentés, 15 obtenus");
});

test("RUPTURE DE CONTRAT ≠ INTERRUPTION DE PARCOURS", () => {
  // Un apprenti dont le contrat est rompu mais qui reste en formation n'a PAS
  // interrompu son parcours : c'est la confusion la plus fréquente du domaine.
  const c = calculer({
    inscriptions: [...inscrits(15), ...inscrits(5, { statut: "stagiaire" })],   // 5 en rupture, toujours en formation
    certifications: [],
    contrats: [...Array.from({ length: 15 }, () => ({ status: "valide" })),
               ...Array.from({ length: 5 }, () => ({ status: "rompu" }))],
  });
  assert.equal(c.interruption.valeur, 0, "personne n'a quitté la formation");
  assert.equal(c.rupture.valeur, 25, "5 ruptures sur 20 contrats");
  assert.equal(c.rupture.conclus, 20);
});

test("INSERTION ET VALEUR AJOUTÉE NE SE CALCULENT PAS ICI — et on le dit", () => {
  // Elles viennent du dispositif national InserJeunes. Les « estimer » depuis
  // nos données produirait un chiffre faux publié sous obligation légale.
  const p = publier({ calcul: calculer({ inscriptions: inscrits(20), certifications: [], contrats: [] }), declares: {} });
  const ins = p.lignes.find((l) => l.cle === "insertion");
  assert.equal(ins.source, "inserjeunes");
  assert.equal(ins.valeur, null);
  assert.match(ins.motif, /dispositif national InserJeunes/);
  assert.equal(p.complet, false);
  assert.ok(p.manquants.some((m) => /Valeur ajoutée/.test(m)));
});

test("un indicateur déclaré exige son millésime — un taux sans année ne veut rien dire", () => {
  assert.equal(validateDeclaration({ insertion: 72 }).ok, false);
  assert.ok(validateDeclaration({ insertion: 72 }).errors.some((e) => /millésime/.test(e)));
  assert.equal(validateDeclaration({ insertion: 72, millesime: "2025" }).ok, true);
  assert.equal(validateDeclaration({ insertion: 150, millesime: "2025" }).ok, false, "un taux hors 0-100");
  assert.ok(validateDeclaration({ poursuite: 12 }).warnings.some((w) => /sans source/.test(w)));
});

test("publication : les six indicateurs de l'article L. 6111-8, tous présents", () => {
  const p = publier({
    calcul: calculer({
      inscriptions: inscrits(20),
      certifications: Array.from({ length: 20 }, () => ({ presente: true, obtenu: true })),
      contrats: Array.from({ length: 20 }, () => ({ status: "valide" })),
    }),
    declares: { insertion: 72, valeurAjoutee: 4, poursuite: 15, sourcePoursuite: "enquête interne", millesime: "2025" },
    formation: "BTS OL", annee: 2026,
  });
  assert.equal(p.lignes.length, 6);
  assert.deepEqual(p.lignes.map((l) => l.cle).sort(), Object.keys(INDICATEURS).sort());
  assert.equal(p.complet, true);
  assert.equal(p.lignes.find((l) => l.cle === "insertion").millesime, "2025");
  // La diffusion elle-même reste à faire : on ne dit pas « conforme ».
  assert.match(p.reserve, /MODALITÉS de diffusion/);
  assert.match(p.reserve, /reste à effectuer/);
});

// Indicateur 29 — actions d'insertion et de poursuite d'études.
// La confusion que ce module existe pour empêcher : répondre par un TAUX à une
// exigence qui porte sur des ACTIONS.
import test from "node:test";
import assert from "node:assert/strict";
import { TYPES, VISEES, validateAction, viseeDe, etatDispositif, parType, MOIS_FENETRE } from "../lib/insertion.js";

const AUJ = "2026-09-15";
const a = (p = {}) => ({ type: "forum", intitule: "Forum entreprises", date: "2026-05-12", participants: 40, resultat: "12 contrats signés", ...p });

test("une action sans date ne se situe dans aucune période auditée", () => {
  assert.equal(validateAction(a({ date: "" })).ok, false);
  assert.equal(validateAction(a({ intitule: "" })).ok, false);
  assert.equal(validateAction(a({ type: "inventé" })).ok, false);
  assert.equal(validateAction(a({ participants: -3 })).ok, false);
  assert.equal(validateAction(a()).ok, true);
});

// Le champ qui sépare une action d'un simple événement.
test("une action sans résultat enregistré est signalée : elle ne démontre rien", () => {
  const v = validateAction(a({ resultat: "" }));
  assert.equal(v.ok, true, "on n'empêche pas la saisie");
  assert.match(v.warnings.join(" "), /ne démontre rien/);
  assert.match(validateAction(a({ participants: 0 })).warnings.join(" "), /a-t-elle eu lieu/);
});

// LA MOITIÉ OUBLIÉE DE L'INDICATEUR.
test("L'INSERTION SEULE NE COUVRE PAS L'EXIGENCE : LA POURSUITE D'ÉTUDES EN FAIT PARTIE", () => {
  const queEmploi = [
    a({ type: "forum", date: "2026-03-01" }),
    a({ type: "atelier_technique", date: "2026-04-01" }),
    a({ type: "relation_entreprise", date: "2026-06-01" }),
  ];
  const e = etatDispositif(queEmploi, { aujourdhui: AUJ });
  assert.equal(e.voies.find((v) => v.voie === "insertion").couvert, true);
  const p = e.voies.find((v) => v.voie === "poursuite");
  assert.equal(p.couvert, false);
  assert.match(p.manque, /aucune action sur 12 mois/);
  assert.equal(e.couvert, false, "trois actions d'insertion ne suffisent pas");

  // Une action sur la poursuite d'études referme la ligne.
  const complet = etatDispositif([...queEmploi,
    a({ type: "information_poursuite", intitule: "Réunion poursuite d'études", date: "2026-02-10", resultat: "8 dossiers déposés" })],
    { aujourdhui: AUJ });
  assert.equal(complet.couvert, true);
});

test("une action « les deux » compte des deux côtés", () => {
  const e = etatDispositif([a({ type: "accompagnement_individuel", date: "2026-05-01", resultat: "18 projets formalisés" })], { aujourdhui: AUJ });
  assert.equal(e.voies.every((v) => v.couvert), true);
  assert.equal(viseeDe({ type: "accompagnement_individuel" }), "les deux");
  // La visée saisie l'emporte sur celle du type.
  assert.equal(viseeDe({ type: "forum", vise: "poursuite" }), "poursuite");
  assert.equal(viseeDe({ type: "forum" }), "insertion");
});

test("des actions sans résultat ne couvrent pas, même nombreuses", () => {
  const sans = new Array(6).fill(0).map((_, i) => a({ type: i % 2 ? "forum" : "passerelle", date: `2026-0${i + 1}-01`, resultat: "" }));
  const e = etatDispositif(sans, { aujourdhui: AUJ });
  assert.equal(e.total, 6);
  assert.equal(e.couvert, false);
  for (const v of e.voies) assert.match(v.manque, /sans résultat enregistré/);
});

test("la fenêtre est glissante : une action d'il y a trois ans ne couvre plus rien", () => {
  const vieilles = [a({ date: "2023-04-01" }), a({ type: "passerelle", date: "2023-05-01" })];
  const e = etatDispositif(vieilles, { aujourdhui: AUJ });
  assert.equal(e.total, 0);
  assert.equal(e.couvert, false);
  assert.equal(e.fenetreDepuis, "2025-09-15");
  assert.equal(MOIS_FENETRE, 12);
});

// LA RÉPONSE À CÔTÉ QU'IL FAUT EMPÊCHER.
test("le module rappelle que le 29 n'est pas un taux d'insertion", () => {
  const e = etatDispositif([], { aujourdhui: AUJ });
  assert.match(e.reserve, /ACTIONS menées, pas sur le taux/);
  assert.match(e.reserve, /indicateur 3/);
  assert.match(e.reserve, /InserJeunes/);
});

test("les participants se cumulent et la diversité des actions se voit", () => {
  const actions = [
    a({ type: "forum", participants: 40 }), a({ type: "forum", participants: 25 }),
    a({ type: "passerelle", participants: 12 }),
  ];
  const e = etatDispositif(actions, { aujourdhui: AUJ });
  assert.equal(e.voies.find((v) => v.voie === "insertion").participants, 65);
  const t = parType(actions);
  assert.equal(t[0].type, "forum");
  assert.equal(t[0].n, 2);
  assert.equal(t[0].participants, 65);
  assert.equal(t.length, 2, "dix fois le même forum couvre moins bien que deux natures d'actions");
});

test("chaque type déclare la voie qu'il sert", () => {
  for (const [cle, t] of Object.entries(TYPES)) {
    assert.ok(t.label, cle);
    assert.ok(VISEES[t.vise], `${cle} : visée « ${t.vise} » inconnue`);
  }
  // Les deux voies sont représentées dans les types proposés.
  const vues = new Set(Object.values(TYPES).map((t) => t.vise));
  assert.ok(vues.has("insertion") && vues.has("poursuite"));
});

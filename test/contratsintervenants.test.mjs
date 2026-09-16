// Contrats des intervenants.
//
// Ce module n'existe pas pour ranger des dates : il existe pour voir venir
// quatre requalifications, dont une qu'aucun humain ne tient à la main —
// le délai de carence entre deux CDD sur le même poste.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NATURES, MOTIFS_CDD, DELAI_ECRIT_JOURS, VIGILANCE_MOIS, VIGILANCE_SEUIL_EUROS,
  carenceRequise, validateContrat, couvre, etatContrat,
  risquesRequalification, vigilanceUrssaf, couvertureSeances, tableauDeBord,
} from "../lib/contratsintervenants.js";

const AUJ = "2026-09-16";
const cdd = (p = {}) => ({
  id: "c1", teacherId: "t1", nature: "cdd", motif: "accroissement", poste: "Optique",
  dateDebut: "2026-09-01", dateFin: "2027-06-30", signeLe: "2026-09-01",
  dpaeLe: "2026-08-28", conventionCollective: "OF privés", dureeEssaiJours: 30, ...p,
});

test("un CDD sans motif de recours est réputé à durée indéterminée", () => {
  const sans = validateContrat(cdd({ motif: null }));
  assert.equal(sans.ok, false);
  assert.match(sans.errors.join(" "), /L\. 1242-12/);
  // Le motif « remplacement » exige de nommer la personne remplacée.
  const rempl = validateContrat(cdd({ motif: "remplacement" }));
  assert.equal(rempl.ok, false);
  assert.match(rempl.errors.join(" "), /nommer la personne remplacée/);
  assert.equal(validateContrat(cdd({ motif: "remplacement", remplace: "C. Martin" })).ok, true);
  // La liste des motifs est fermée.
  assert.equal(validateContrat(cdd({ motif: "besoin de personnel" })).ok, false);
});

test("un CDD sans terme n'en est pas un ; un CDI n'en réclame pas", () => {
  assert.equal(validateContrat(cdd({ dateFin: "" })).ok, false);
  assert.equal(validateContrat({ teacherId: "t1", nature: "cdi", dateDebut: "2026-09-01", conventionCollective: "x", dpaeLe: "2026-08-28" }).ok, true);
  assert.equal(validateContrat(cdd({ dateFin: "2026-08-01" })).ok, false, "terme antérieur au début");
});

// LA DISTINCTION QUI N'EST PAS NÉGOCIABLE.
test("UN PRESTATAIRE N'A NI PÉRIODE D'ESSAI NI DÉCLARATION D'EMBAUCHE", () => {
  const base = { id: "p1", teacherId: "t2", nature: "prestation", societe: "Studio X SARL",
    dateDebut: "2026-09-01", dateFin: "2027-06-30", montant: 8000 };
  assert.equal(validateContrat(base).ok, true);

  // Les porter reviendrait à fabriquer la pièce d'une requalification.
  const essai = validateContrat({ ...base, dureeEssaiJours: 30 });
  assert.equal(essai.ok, false);
  assert.match(essai.errors.join(" "), /lien de subordination/);
  const dpae = validateContrat({ ...base, dpaeLe: "2026-08-28" });
  assert.equal(dpae.ok, false);
  assert.match(dpae.errors.join(" "), /déclaration préalable/);
  // Et la société est obligatoire : c'est elle qui contracte.
  assert.equal(validateContrat({ ...base, societe: "" }).ok, false);
  assert.equal(NATURES.prestation.salarie, false);
});

// RISQUE 1 — LE TERME.
test("LE TERME DÉPASSÉ EST BLOQUANT : RIEN NE SE PASSE CE JOUR-LÀ, ET C'EST LE PROBLÈME", () => {
  const passe = etatContrat(cdd({ dateFin: "2026-06-30" }), AUJ);
  assert.equal(passe.etat, "echu");
  assert.equal(passe.actif, false);
  const a = passe.alertes.find((x) => x.code === "terme_depasse");
  assert.equal(a.gravite, "bloquant");
  assert.match(a.message, /L\. 1243-11/);
  assert.match(a.message, /se constate, pas se décide/);

  // Un terme proche prévient à l'avance : le renouvellement se décide avant.
  const proche = etatContrat(cdd({ dateFin: "2026-10-15" }), AUJ);
  assert.equal(proche.etat, "en_cours");
  assert.equal(proche.alertes.find((x) => x.code === "terme_proche").gravite, "important");
  // Loin, on ne dit rien : une alerte permanente ne se lit plus.
  assert.equal(etatContrat(cdd(), AUJ).alertes.length, 0);
});

// RISQUE 2 — LE DÉFAUT D'ÉCRIT.
test("un CDD non signé passé le délai de transmission est réputé à durée indéterminée", () => {
  const tardif = etatContrat(cdd({ signeLe: null }), AUJ);
  const a = tardif.alertes.find((x) => x.code === "ecrit_tardif");
  assert.equal(a.gravite, "bloquant");
  assert.match(a.message, /L\. 1242-13/);
  assert.equal(DELAI_ECRIT_JOURS, 2);
  // Dans le délai, pas d'alerte.
  const frais = etatContrat(cdd({ dateDebut: AUJ, signeLe: null, dateFin: "2027-06-30" }), AUJ);
  assert.equal(frais.alertes.some((x) => x.code === "ecrit_tardif"), false);
});

// RISQUE 4 — LA DPAE.
test("la DPAE se rappelle AVANT la première heure, et devient bloquante après", () => {
  const avant = etatContrat(cdd({ dateDebut: "2026-10-01", dpaeLe: null }), AUJ);
  assert.equal(avant.etat, "a_venir");
  const a = avant.alertes.find((x) => x.code === "dpae_a_faire");
  assert.equal(a.gravite, "important");
  assert.match(a.message, /ne répare rien/);

  // Le contrat a commencé sans déclaration : ce n'est plus un rappel.
  const apres = etatContrat(cdd({ dpaeLe: null }), AUJ);
  const b = apres.alertes.find((x) => x.code === "dpae_manquante");
  assert.equal(b.gravite, "bloquant");
  assert.match(b.message, /travail dissimulé/);
});

test("la période d'essai se signale avant sa fin, pas après", () => {
  // Essai de 30 jours à partir du 2026-09-01 → fin le 2026-10-01, soit 15 jours.
  assert.equal(etatContrat(cdd(), AUJ).alertes.some((x) => x.code === "essai_fin"), false, "à 15 jours, encore trop tôt");
  const proche = etatContrat(cdd({ dateDebut: "2026-08-28" }), AUJ);
  const a = proche.alertes.find((x) => x.code === "essai_fin");
  assert.ok(a);
  assert.match(a.message, /régime du licenciement/);
  assert.equal(proche.finEssai, "2026-09-27");
});

// RISQUE 3 — CELUI QUE SEUL UN LOGICIEL VOIT.
test("LE DÉLAI DE CARENCE ENTRE DEUX CDD SUR LE MÊME POSTE", () => {
  // Un contrat de 300 jours : carence d'un tiers, soit 100 jours.
  const c = carenceRequise({ dateDebut: "2025-09-01", dateFin: "2026-06-28" });
  assert.equal(c.dureePrecedente, 300);
  assert.equal(c.carenceJours, 100);
  assert.equal(c.finCarence, "2026-10-06");
  assert.match(c.regle, /un tiers/);
  // Un contrat court : la moitié.
  assert.equal(carenceRequise({ dateDebut: "2026-01-01", dateFin: "2026-01-10" }).regle.includes("moitié"), true);

  // Deux CDD enchaînés sur le même poste : la rentrée suivante tombe dans la carence.
  const risques = risquesRequalification([
    { id: "a", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2025-09-01", dateFin: "2026-06-28" },
    { id: "b", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2026-09-01", dateFin: "2027-06-30" },
  ], { aujourdhui: AUJ });
  const car = risques.find((r) => r.code === "carence");
  assert.ok(car, "la carence doit être détectée");
  assert.equal(car.gravite, "bloquant");
  assert.match(car.message, /L\. 1244-3/);
  assert.deepEqual(car.contrats, ["a", "b"]);
});

test("la carence s'apprécie par POSTE, pas seulement par personne", () => {
  // Même intervenant, deux matières différentes : pas de carence entre elles.
  const risques = risquesRequalification([
    { id: "a", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2025-09-01", dateFin: "2026-06-28" },
    { id: "b", teacherId: "t1", nature: "cdd", poste: "Gestion", dateDebut: "2026-09-01", dateFin: "2027-06-30" },
  ], { aujourdhui: AUJ });
  assert.equal(risques.some((r) => r.code === "carence"), false);
});

test("trois CDD successifs révèlent un besoin permanent", () => {
  const risques = risquesRequalification([
    { id: "a", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2023-09-01", dateFin: "2024-06-30" },
    { id: "b", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2024-11-01", dateFin: "2025-06-30" },
    { id: "c", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2025-12-01", dateFin: "2026-06-30" },
  ], { aujourdhui: AUJ });
  const s = risques.find((r) => r.code === "succession");
  assert.ok(s);
  assert.match(s.message, /besoin permanent/);
  assert.equal(s.contrats.length, 3);
});

test("une poursuite constatée après le terme est nommée pour ce qu'elle est", () => {
  const r = risquesRequalification([
    { id: "a", teacherId: "t1", nature: "cdd", poste: "Optique", dateDebut: "2025-09-01", dateFin: "2026-06-30", poursuiteConstatee: true },
  ], { aujourdhui: AUJ });
  const p = r.find((x) => x.code === "poursuite");
  assert.equal(p.gravite, "bloquant");
  assert.match(p.message, /devenu à durée indéterminée/);
});

// LA GARDE PLANNING — symétrique de l'habilitation à la certification.
test("des séances affectées hors couverture contractuelle sont signalées", () => {
  const contrats = [cdd({ dateDebut: "2026-09-01", dateFin: "2026-12-31" })];
  const c = couvertureSeances(contrats, [
    { date: "2026-10-05" }, { date: "2027-01-15" }, { date: "2027-02-01" },
    { date: "2027-03-01", status: "cancelled" },
  ]);
  assert.equal(c.nonCouvertes, 2);
  assert.deepEqual(c.dates, ["2027-01-15", "2027-02-01"]);
  assert.equal(c.alerte.gravite, "bloquant");
  assert.match(c.alerte.message, /sans support contractuel/);

  assert.equal(couvre(contrats[0], "2026-10-05"), true);
  assert.equal(couvre(contrats[0], "2027-01-15"), false);
  // Un contrat rompu ne couvre plus rien après la rupture.
  assert.equal(couvre(cdd({ rompuLe: "2026-10-01" }), "2026-11-01"), false);
  // Un CDI couvre tout ce qui suit son début.
  assert.equal(couvre({ nature: "cdi", dateDebut: "2026-09-01" }, "2030-01-01"), true);
});

// PRESTATAIRE — l'obligation propre.
test("l'attestation de vigilance ne s'exige qu'au-delà du seuil, et se périme à six mois", () => {
  const p = { id: "p1", nature: "prestation", montant: 8000 };
  const absente = vigilanceUrssaf(p, [], AUJ);
  assert.equal(absente.requise, true);
  assert.equal(absente.aJour, false);
  assert.match(absente.alerte.message, /solidairement responsable/);

  const perimee = vigilanceUrssaf(p, [{ contratId: "p1", date: "2025-12-01" }], AUJ);
  assert.equal(perimee.aJour, false);
  assert.match(perimee.alerte.message, /six mois/);

  const bonne = vigilanceUrssaf(p, [{ contratId: "p1", date: "2026-07-01" }], AUJ);
  assert.equal(bonne.aJour, true);
  assert.equal(bonne.alerte, null);

  // Sous le seuil, l'obligation ne s'applique pas — et on ne la réclame pas.
  const petit = vigilanceUrssaf({ id: "p2", nature: "prestation", montant: 2000 }, [], AUJ);
  assert.equal(petit.requise, false);
  assert.equal(VIGILANCE_SEUIL_EUROS, 5000);
  assert.equal(VIGILANCE_MOIS, 6);
  // Un salarié n'est pas concerné.
  assert.equal(vigilanceUrssaf(cdd(), [], AUJ), null);
});

test("le tableau de bord met en tête ce qui est bloquant", () => {
  const t = tableauDeBord({
    contrats: [
      cdd({ id: "sain" }),
      cdd({ id: "echu", dateFin: "2026-06-30" }),
      { id: "presta", teacherId: "t2", nature: "prestation", societe: "X", dateDebut: "2026-01-01", dateFin: "2027-01-01", montant: 9000 },
    ],
    attestations: [], aujourdhui: AUJ, noms: { t1: "C. Martin", t2: "Studio X" },
  });
  assert.equal(t.total, 3);
  assert.equal(t.echus, 1);
  assert.ok(t.bloquants >= 2);
  assert.ok(t.lignes[0].alertes.some((a) => a.gravite === "bloquant"), "les lignes bloquantes passent devant");
  assert.equal(t.lignes.find((l) => l.id === "sain").nom, "C. Martin");
  assert.match(t.reserve, /ne vaut pas conseil/);
});

test("chaque motif et chaque nature portent un libellé exploitable", () => {
  for (const [k, v] of Object.entries(MOTIFS_CDD)) assert.ok(v.length > 8, k);
  for (const [k, v] of Object.entries(NATURES)) {
    assert.ok(v.label, k);
    assert.equal(typeof v.salarie, "boolean");
    assert.equal(typeof v.terme, "boolean");
  }
});

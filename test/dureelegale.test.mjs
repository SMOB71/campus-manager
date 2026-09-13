import test from "node:test";
import assert from "node:assert/strict";
import { controler, ageA, regimePour, regimeDuGroupe, journees, REGIMES, derogationValide } from "../lib/dureelegale.js";

const s = (date, start, end) => ({ date, start, end });
const codes = (r) => r.violations.map((v) => v.code);

test("âge révolu : la veille de l'anniversaire, on a encore 17 ans", () => {
  assert.equal(ageA("2009-06-15", "2027-06-14"), 17);
  assert.equal(ageA("2009-06-15", "2027-06-15"), 18);
  assert.equal(ageA(null, "2027-06-15"), null);
});

test("régimes : moins de 16 ans, 16-18, majeur — trois grilles distinctes", () => {
  assert.equal(regimePour(15), REGIMES.mineurDeSeize);
  assert.equal(regimePour(17), REGIMES.mineur);
  assert.equal(regimePour(18), REGIMES.adulte);
  // Le repos quotidien n'est pas le même : 14 h, 12 h, 11 h.
  assert.equal(REGIMES.mineurDeSeize.reposQuotidien, 14 * 60);
  assert.equal(REGIMES.mineur.reposQuotidien, 12 * 60);
  assert.equal(REGIMES.adulte.reposQuotidien, 11 * 60);
  // Âge inconnu : on ne peut pas inventer une protection qu'on ne sait pas due.
  assert.equal(regimePour(null), REGIMES.adulte);
});

test("LA RÈGLE D'UNE CLASSE EST CELLE DU PLUS JEUNE INSCRIT", () => {
  // Un seul apprenti de 17 ans plafonne la journée de toute la classe à 8 h.
  // Raisonner sur une moyenne d'âge n'aurait aucun sens juridique.
  const g = regimeDuGroupe(["2000-01-01", "2001-01-01", "2010-05-01"], "2027-01-10");
  assert.equal(g.age, 16);
  assert.equal(g.regime, REGIMES.mineur);
  const majeurs = regimeDuGroupe(["2000-01-01", "1998-01-01"], "2027-01-10");
  assert.equal(majeurs.regime, REGIMES.adulte);
  // Une date de naissance manquante est signalée, pas ignorée.
  assert.equal(regimeDuGroupe(["2000-01-01", null], "2027-01-10").ageInconnu, true);
});

test("durée quotidienne : 9 h passent pour un majeur, bloquent pour un mineur", () => {
  const journee = [s("2027-01-11", "08:00", "12:30"), s("2027-01-11", "13:30", "18:00")];
  const majeur = controler({ seances: journee, naissances: ["1990-01-01"], dateRef: "2027-01-11" });
  assert.equal(majeur.bloquant, false);

  const mineur = controler({ seances: journee, naissances: ["2010-06-01"], dateRef: "2027-01-11" });
  assert.equal(mineur.bloquant, true);
  assert.ok(codes(mineur).includes("duree_jour"));
  const v = mineur.violations.find((x) => x.code === "duree_jour");
  assert.match(v.message, /9 h le 2027-01-11/);
  assert.match(v.article, /L\. 3162-1/);
  assert.equal(v.level, "block", "une limite d'ordre public bloque, elle n'avertit pas");
});

test("pause : une interruption trop courte ne coupe pas le travail continu", () => {
  // 4 h, 10 min d'interruption, 1 h : c'est 5 h 10 de travail continu pour un
  // mineur, pas deux périodes. Compter deux périodes laisserait passer la faute.
  const r = controler({
    seances: [s("2027-01-11", "08:00", "12:00"), s("2027-01-11", "12:10", "13:10")],
    naissances: ["2010-06-01"], dateRef: "2027-01-11",
  });
  assert.ok(codes(r).includes("pause"));
  assert.match(r.violations.find((x) => x.code === "pause").message, /5 h 10 de travail sans interruption/);

  // Avec 30 min de pause, les deux périodes sont distinctes et tout passe.
  const ok = controler({
    seances: [s("2027-01-11", "08:00", "12:00"), s("2027-01-11", "12:30", "13:30")],
    naissances: ["2010-06-01"], dateRef: "2027-01-11",
  });
  assert.equal(codes(ok).includes("pause"), false);
});

test("travail de nuit : interdit aux mineurs, et l'heure dépend de l'âge", () => {
  const soir = [s("2027-01-11", "18:00", "22:30")];
  assert.equal(controler({ seances: soir, naissances: ["1990-01-01"], dateRef: "2027-01-11" }).bloquant, false);

  const dixSept = controler({ seances: soir, naissances: ["2010-01-01"], dateRef: "2027-01-11" });
  assert.ok(codes(dixSept).includes("nuit"));
  assert.match(dixSept.violations.find((x) => x.code === "nuit").article, /L\. 3163-1/);

  // Moins de 16 ans : la nuit commence à 20 h, pas à 22 h.
  const quinze = controler({ seances: [s("2027-01-11", "16:00", "20:30")], naissances: ["2012-01-01"], dateRef: "2027-01-11" });
  assert.ok(codes(quinze).includes("nuit"));
  assert.match(quinze.violations.find((x) => x.code === "nuit").article, /L\. 3163-2/);
});

test("repos quotidien : mesuré entre la FIN d'une journée et le DÉBUT de la suivante", () => {
  const tardPuisTot = [s("2027-01-11", "14:00", "21:00"), s("2027-01-12", "07:00", "12:00")];
  // 10 h de repos : conforme pour personne.
  const majeur = controler({ seances: tardPuisTot, naissances: ["1990-01-01"], dateRef: "2027-01-11" });
  assert.ok(codes(majeur).includes("repos_quotidien"));
  assert.match(majeur.violations.find((x) => x.code === "repos_quotidien").article, /L\. 3131-1/);

  // 12 h de repos : conforme pour un majeur, pas pour un mineur de 16-18 ans…
  const douze = [s("2027-01-11", "14:00", "20:00"), s("2027-01-12", "08:00", "12:00")];
  assert.equal(codes(controler({ seances: douze, naissances: ["1990-01-01"], dateRef: "2027-01-11" })).includes("repos_quotidien"), false);
  // …et pour un mineur de moins de 16 ans il en faut 14.
  assert.ok(codes(controler({ seances: douze, naissances: ["2012-01-01"], dateRef: "2027-01-11" })).includes("repos_quotidien"));
});

test("durée hebdomadaire : 35 h pour un mineur, 48 h pour un majeur", () => {
  const semaine = ["2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15"]
    .map((d) => s(d, "08:00", "16:00"));   // 5 × 8 h = 40 h
  const majeur = controler({ seances: semaine, naissances: ["1990-01-01"], dateRef: "2027-01-11" });
  assert.equal(codes(majeur).includes("duree_semaine"), false);

  const mineur = controler({ seances: semaine, naissances: ["2010-06-01"], dateRef: "2027-01-11" });
  assert.ok(codes(mineur).includes("duree_semaine"));
  assert.match(mineur.violations.find((x) => x.code === "duree_semaine").message, /40 h sur la semaine/);
});

test("DÉROGATION : elle n'existe que si elle est enregistrée, pas si elle est invoquée", () => {
  // Cinq heures au plus, accordées par l'inspecteur du travail APRÈS avis
  // conforme du médecin du travail. Sans référence, elle ne s'oppose à personne.
  const semaine = ["2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15"]
    .map((d) => s(d, "08:00", "16:00"));   // 40 h

  const invoquee = controler({ seances: semaine, naissances: ["2010-06-01"], dateRef: "2027-01-11", derogation: { heuresHebdo: 5 } });
  assert.equal(invoquee.bloquant, true, "une dérogation sans pièce ne débloque rien");
  assert.ok(codes(invoquee).includes("derogation_incomplete"));

  const reelle = { reference: "DDETS 2027-114", dateDecision: "2026-12-01", avisMedecin: "favorable", heuresHebdo: 5 };
  assert.equal(derogationValide(reelle), true);
  const avec = controler({ seances: semaine, naissances: ["2010-06-01"], dateRef: "2027-01-11", derogation: reelle });
  assert.equal(codes(avec).includes("duree_semaine"), false, "40 h ≤ 35 + 5");

  // Mais la dérogation est plafonnée : elle ne couvre pas 45 h.
  const trop = ["2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15"].map((d) => s(d, "08:00", "17:00"));
  assert.ok(codes(controler({ seances: trop, naissances: ["2010-06-01"], dateRef: "2027-01-11", derogation: reelle })).includes("duree_semaine"));
});

test("moyenne sur 12 semaines : ne concerne que les majeurs, et exige 12 semaines", () => {
  const seances = [];
  for (let w = 0; w < 12; w++) {
    for (let d = 0; d < 6; d++) {
      const date = new Date(Date.UTC(2027, 0, 4 + w * 7 + d)).toISOString().slice(0, 10);
      seances.push(s(date, "08:00", "16:00"));   // 6 × 8 h = 48 h/semaine
    }
  }
  const r = controler({ seances, naissances: ["1990-01-01"], dateRef: "2027-01-04" });
  assert.ok(codes(r).includes("moyenne_12_semaines"), "48 h sur 12 semaines dépasse la moyenne de 44 h");
  assert.match(r.violations.find((x) => x.code === "moyenne_12_semaines").article, /L\. 3121-22/);
});

test("LE CFA NE VOIT QUE SES PROPRES HEURES — et il le dit", () => {
  // Un planning de 7 h en centre n'est pas « conforme » : les heures en
  // entreprise s'y ajoutent. Taire cette réserve laisserait croire le contraire.
  // 7 h en centre, avec la pause de 30 min que la loi impose : rien à bloquer…
  const r = controler({ seances: [s("2027-01-11", "09:00", "12:30"), s("2027-01-11", "13:00", "16:30")],
    naissances: ["2010-06-01"], dateRef: "2027-01-11" });
  assert.equal(r.bloquant, false);
  // …mais on ne dit pas pour autant que la journée est conforme.
  assert.match(r.reserve, /TOTAL centre de formation \+ entreprise/);
  // Pour un groupe de majeurs, cette réserve n'a pas lieu d'être.
  assert.equal(controler({ seances: [s("2027-01-11", "09:00", "12:30"), s("2027-01-11", "13:00", "16:30")],
    naissances: ["1990-01-01"], dateRef: "2027-01-11" }).reserve, null);
});

test("journées : total, période continue et bornes", () => {
  const j = journees([s("2027-01-11", "08:00", "12:00"), s("2027-01-11", "13:00", "17:00")], 30);
  assert.equal(j.length, 1);
  assert.equal(j[0].total, 480);
  assert.equal(j[0].continuMax, 240, "une pause de 60 min coupe la période continue");
  assert.equal(j[0].debut, 480);
  assert.equal(j[0].fin, 1020);
  // Séance mal formée : ignorée plutôt que comptée de travers.
  assert.equal(journees([{ date: "2027-01-11", start: "bof", end: "12:00" }]).length, 0);
});

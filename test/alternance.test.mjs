import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RYTHMES, lundiDe, validateRythme, genererRythme, versPeriodes, verifierVolume, resume,
} from "../lib/alternance.js";

// 2026-09-14 est un lundi ; 2026-09-16 un mercredi.
const DEBUT = "2026-09-14";
const FIN = "2027-06-30";

test("lundiDe ramène au lundi de la semaine, y compris depuis un dimanche", () => {
  assert.equal(lundiDe("2026-09-14"), "2026-09-14");
  assert.equal(lundiDe("2026-09-16"), "2026-09-14");
  // Le dimanche appartient à la semaine qui vient de finir, pas à la suivante :
  // l'erreur classique est de décaler tout le rythme d'une semaine.
  assert.equal(lundiDe("2026-09-20"), "2026-09-14");
});

test("validateRythme exige une classe et refuse un cycle qui n'en est plus un", () => {
  assert.equal(validateRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3, classId: "k1" }).ok, true);
  const sansClasse = validateRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3 });
  assert.equal(sansClasse.ok, false);
  assert.match(sansClasse.errors.join(" "), /classe/);
  assert.equal(validateRythme({ debut: DEBUT, fin: FIN, centre: 8, entreprise: 8, classId: "k1" }).ok, false);
  assert.equal(validateRythme({ debut: FIN, fin: DEBUT, centre: 1, entreprise: 3, classId: "k1" }).ok, false);
});

test("un rythme 1/3 alterne bien une semaine de centre sur quatre", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3, classId: "k1" });
  assert.equal(s[0].type, "centre");
  assert.equal(s[1].type, "entreprise");
  assert.equal(s[3].type, "entreprise");
  assert.equal(s[4].type, "centre");
  const centre = s.filter((x) => x.type === "centre").length;
  assert.equal(centre, Math.ceil(s.length / 4));
  assert.ok(s.every((x) => x.classId === "k1"));
});

test("commencePar entreprise démarre l'année en poste", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 2, entreprise: 2, classId: "k1", commencePar: "entreprise" });
  assert.equal(s[0].type, "entreprise");
  assert.equal(s[2].type, "centre");
});

// LE POINT DE DROIT : un apprenti est salarié. Une semaine de fermeture du centre
// ne lui rend pas sa liberté, elle le renvoie en entreprise — et la semaine de
// cours qu'il n'a pas eue doit être REPORTÉE, sinon le volume annuel fond
// silencieusement à chaque vacances scolaires.
test("une fermeture du centre reporte la semaine de cours au lieu de la perdre", () => {
  const opts = { debut: DEBUT, fin: "2026-12-20", centre: 1, entreprise: 1, classId: "k1" };
  const sans = genererRythme(opts);
  const avec = genererRythme({
    ...opts,
    fermetures: [{ from: "2026-10-19", to: "2026-11-01" }],   // deux semaines de vacances
  });
  const centreSans = sans.filter((x) => x.type === "centre").length;
  const centreAvec = avec.filter((x) => x.type === "centre").length;
  // Le rythme glisse, il ne rétrécit pas : au plus une semaine de moins en fin de
  // période, jamais les deux semaines fermées.
  assert.ok(centreSans - centreAvec <= 1, `${centreSans} → ${centreAvec}`);
  assert.ok(avec.some((x) => x.motif === "centre fermé — semaine reportée"));
  // Pendant la fermeture, l'apprenti est en entreprise, pas en vacances.
  const pendant = avec.filter((x) => x.lundi >= "2026-10-19" && x.lundi <= "2026-11-01");
  assert.ok(pendant.length > 0);
  assert.ok(pendant.every((x) => x.type === "entreprise"));
});

test("versPeriodes ne retient que les semaines entreprise et fusionne les consécutives", () => {
  const s = genererRythme({ debut: DEBUT, fin: "2026-11-30", centre: 1, entreprise: 3, classId: "k1" });
  const p = versPeriodes(s);
  assert.ok(p.length > 0);
  assert.ok(p.every((x) => x.kind === "entreprise" && x.classId === "k1"));
  // Trois semaines consécutives = UNE période de 21 jours, pas trois périodes.
  const jours = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5) + 1;
  assert.equal(jours(p[0].from, p[0].to), 21);
  // Aucune semaine de centre ne doit se retrouver couverte par une période.
  for (const sem of s.filter((x) => x.type === "centre")) {
    assert.ok(!p.some((x) => sem.lundi >= x.from && sem.lundi <= x.to), `semaine de centre ${sem.lundi} couverte`);
  }
});

// LE CONTRÔLE QUI MANQUAIT VRAIMENT. Un BTS à 1 350 h avec un rythme 1/3 ne peut
// pas les délivrer : il faut le savoir en septembre, pas en juin.
test("verifierVolume refuse un rythme qui ne peut pas délivrer le référentiel", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3, classId: "k1" });
  const v = verifierVolume({ semaines: s, heuresParSemaine: 30, volumeRequis: 1350 });
  assert.equal(v.suffisant, false);
  assert.ok(v.ecart < 0);
  assert.equal(v.heuresDisponibles, v.semainesCentre * 30);
  // Le message doit dire QUOI CHANGER, pas seulement que ça ne va pas.
  assert.match(v.message, /il manque \d+ h/);
  assert.match(v.message, /semaines en centre/);
});

test("verifierVolume accepte un rythme qui tient", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 2, entreprise: 2, classId: "k1" });
  const v = verifierVolume({ semaines: s, heuresParSemaine: 35, volumeRequis: 700 });
  assert.equal(v.suffisant, true);
  assert.ok(v.ecart >= 0);
});

test("sans volume de référentiel, verifierVolume se tait au lieu de conclure", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3, classId: "k1" });
  const v = verifierVolume({ semaines: s, heuresParSemaine: 30, volumeRequis: null });
  assert.equal(v.suffisant, null);
  assert.match(v.message, /non renseigné/);
});

test("resume compte les semaines et porte le rappel sur le statut de salarié", () => {
  const s = genererRythme({ debut: DEBUT, fin: FIN, centre: 1, entreprise: 3, classId: "k1" });
  const r = resume(s);
  assert.equal(r.centre + r.entreprise, r.total);
  assert.ok(r.parMois.length > 0);
  assert.match(r.note, /congés payés/);
});

test("les modèles de rythme sont cohérents avec leur clé", () => {
  for (const [cle, r] of Object.entries(RYTHMES)) {
    const [c, e] = cle.split("-").map(Number);
    assert.equal(r.centre, c, cle);
    assert.equal(r.entreprise, e, cle);
  }
});

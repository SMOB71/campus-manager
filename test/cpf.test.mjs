// Compte personnel de formation.
//
// Le point qui commande tout : le service fait conditionne le paiement, et il
// se LIT dans l'émargement scellé. Aucun champ « heures réalisées » à saisir.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REPERTOIRES, ETATS, EXONERATIONS, DELAI_ENTREE_JOURS, PARTICIPATION_DEFAUT,
  verifierEligibilite, validateDossier, serviceFait, peutDeclarerServiceFait,
  resteACharge, tableauDeBord,
} from "../lib/cpf.js";

const AUJ = "2026-09-18";
const offre = (p = {}) => ({ id: "o1", nature: "continue", intitule: "Titre pro", publiee: true,
  repertoire: "rncp", codeCertification: "35338", ...p });
const qualiopi = { valideJusquau: "2028-06-30" };

// LES QUATRE CONDITIONS, DANS L'ORDRE OÙ ELLES BLOQUENT.
test("sans certification qualité, rien n'est éligible — c'est la condition d'existence", () => {
  const sans = verifierEligibilite({ qualiopi: null, offre: offre(), aujourdhui: AUJ });
  assert.equal(sans.eligible, false);
  assert.match(sans.manques[0].message, /aucun financement mutualisé/);

  const expiree = verifierEligibilite({ qualiopi: { valideJusquau: "2026-01-01" }, offre: offre(), aujourdhui: AUJ });
  assert.equal(expiree.eligible, false);
  assert.match(expiree.manques[0].message, /ne seront pas payés/);
});

test("SEULES LES FORMATIONS CERTIFIANTES SONT ÉLIGIBLES", () => {
  const atelier = verifierEligibilite({ qualiopi, offre: offre({ repertoire: null, codeCertification: "" }), aujourdhui: AUJ });
  assert.equal(atelier.eligible, false);
  assert.match(atelier.manques.map((m) => m.message).join(" "), /ne se vend pas sur ce dispositif/);
  // Un code sans répertoire ne suffit pas non plus.
  assert.equal(verifierEligibilite({ qualiopi, offre: offre({ repertoire: "inventé" }), aujourdhui: AUJ }).eligible, false);
  assert.ok(REPERTOIRES.rncp && REPERTOIRES.rs);
});

test("un organisme qui ne peut pas présenter à la certification ne peut pas la financer", () => {
  const bloque = verifierEligibilite({ qualiopi, offre: offre(), certification: { peutPresenter: false }, aujourdhui: AUJ });
  assert.equal(bloque.eligible, false);
  assert.match(bloque.manques.map((m) => m.message).join(" "), /suppose qu'elle puisse être passée/);

  // Habilitation inconnue : signalé sans bloquer — on ne présume pas l'échec.
  const flou = verifierEligibilite({ qualiopi, offre: offre(), certification: null, aujourdhui: AUJ });
  assert.equal(flou.eligible, true);
  assert.match(flou.manques.map((m) => m.cle).join(" "), /habilitation_inconnue/);

  const ok = verifierEligibilite({ qualiopi, offre: offre(), certification: { peutPresenter: true }, aujourdhui: AUJ });
  assert.deepEqual(ok.manques, []);
});

test("une offre non publiée n'existe pas pour le bénéficiaire, sans bloquer l'éligibilité", () => {
  const v = verifierEligibilite({ qualiopi, offre: offre({ publiee: false }), certification: { peutPresenter: true }, aujourdhui: AUJ });
  assert.equal(v.eligible, true);
  assert.match(v.manques[0].message, /n'existe pas pour le bénéficiaire/);
});

// LE PIÈGE DE CALENDRIER.
test("UNE SESSION QUI DÉMARRE TROP TÔT APRÈS L'INSCRIPTION N'EST PAS FINANÇABLE", () => {
  const trop = validateDossier({ beneficiaire: "Léa", offreId: "o1", dateInscription: "2026-10-01", dateDebut: "2026-10-05" });
  assert.equal(trop.ok, false);
  assert.match(trop.errors.join(" "), /4 jour\(s\).*minimum de 11/);
  assert.match(trop.errors.join(" "), /Décaler le début/);

  assert.equal(validateDossier({ beneficiaire: "Léa", offreId: "o1", dateInscription: "2026-10-01", dateDebut: "2026-10-20" }).ok, true);
  // La règle est PARAMÉTRABLE : c'est une règle du financeur, pas une constante.
  assert.equal(validateDossier({ beneficiaire: "L", offreId: "o1", dateInscription: "2026-10-01", dateDebut: "2026-10-05" }, { delaiEntree: 3 }).ok, true);
  assert.equal(DELAI_ENTREE_JOURS, 11);
  // Une session antérieure à l'inscription est une incohérence, pas un délai.
  assert.match(validateDossier({ beneficiaire: "L", offreId: "o1", dateInscription: "2026-10-20", dateDebut: "2026-10-01" }).errors.join(" "), /avant l'inscription/);
});

// LE CŒUR : LE SERVICE FAIT SE LIT, IL NE SE SAISIT PAS.
test("LE SERVICE FAIT EST LU DANS LES FEUILLES CLOSES, ET SEULEMENT CELLES-LÀ", () => {
  const stats = () => ({ plannedMinutes: 180, total: 1 });
  const feuilles = [
    { status: "locked", entries: [{ learnerId: "l1", status: "present" }] },
    { status: "locked", entries: [{ learnerId: "l1", status: "absent" }] },
    { status: "locked", entries: [{ learnerId: "l1", status: "retard", minutesLate: 60 }] },
    // Feuille ouverte : modifiable, donc sans valeur probante.
    { status: "open", entries: [{ learnerId: "l1", status: "present" }] },
  ];
  const s = serviceFait({ dossier: { learnerId: "l1" }, feuilles, stats });
  assert.equal(s.feuillesRetenues, 3);
  assert.equal(s.feuillesIgnorees, 1);
  assert.equal(s.heuresPrevues, 9, "trois séances de trois heures");
  // 3 h présent + 0 absent + 2 h (3 h moins 1 h de retard) = 5 h.
  assert.equal(s.heuresRealisees, 5);
  assert.equal(s.taux, 56);
  assert.match(s.alerte.message, /tant qu'elles sont modifiables, elles ne prouvent rien/);
  assert.match(s.reserve, /ne se saisissent pas/);
});

test("le service fait est INDIVIDUEL : deux apprenants d'une même session n'ont pas la même assiduité", () => {
  const stats = () => ({ plannedMinutes: 360, total: 2 });
  const feuilles = [{ status: "locked", entries: [
    { learnerId: "l1", status: "present" }, { learnerId: "l2", status: "absent" },
  ] }];
  assert.equal(serviceFait({ dossier: { learnerId: "l1" }, feuilles, stats }).taux, 100);
  assert.equal(serviceFait({ dossier: { learnerId: "l2" }, feuilles, stats }).taux, 0);
  // Un apprenant absent de la feuille n'est simplement pas compté.
  assert.equal(serviceFait({ dossier: { learnerId: "l9" }, feuilles, stats }).heuresPrevues, 0);
});

test("on ne déclare pas un service fait sans feuille close", () => {
  const vide = peutDeclarerServiceFait({ etat: "en_formation" }, { feuillesRetenues: 0 });
  assert.equal(vide.autorise, false);
  assert.match(vide.motif, /rien ne prouve que la formation a eu lieu/);

  // Un dossier payé ou refusé ne se déclare pas.
  assert.equal(peutDeclarerServiceFait({ etat: "paye" }, { feuillesRetenues: 3 }).autorise, false);

  // Assiduité partielle : autorisé, mais en connaissance de cause.
  const partiel = peutDeclarerServiceFait({ etat: "en_formation" }, { feuillesRetenues: 3, taux: 62 });
  assert.equal(partiel.autorise, true);
  assert.equal(partiel.partiel, true);
  assert.match(partiel.motif, /au prorata des heures réalisées/);

  assert.equal(peutDeclarerServiceFait({ etat: "en_formation" }, { feuillesRetenues: 3, taux: 100 }).autorise, true);
});

// LA PARTICIPATION N'EST PAS SYSTÉMATIQUE.
test("présenter la participation comme due par tous ferait renoncer des candidats exonérés", () => {
  const plein = resteACharge({ prix: 2000, droitsDisponibles: 1500 });
  assert.equal(plein.droitsMobilises, 1500);
  assert.equal(plein.complementAFinancer, 500);
  assert.equal(plein.participationForfaitaire, PARTICIPATION_DEFAUT);
  assert.equal(plein.resteACharge, 600);

  const exonere = resteACharge({ prix: 2000, droitsDisponibles: 2000, exoneration: "demandeur_emploi" });
  assert.equal(exonere.participationForfaitaire, 0);
  assert.equal(exonere.resteACharge, 0);
  assert.equal(exonere.exonerationLabel, EXONERATIONS.demandeur_emploi);

  // Des droits supérieurs au prix ne créent pas de crédit.
  assert.equal(resteACharge({ prix: 800, droitsDisponibles: 3000, exoneration: "abondement_employeur" }).complementAFinancer, 0);
  assert.match(plein.reserve, /à revérifier avant de l'annoncer à un candidat/);
});

test("le tableau de bord distingue ce qui attend de ce qui est clos", () => {
  const t = tableauDeBord([
    { etat: "demande", prix: 2000, beneficiaire: "A", offreId: "o1", dateInscription: "2026-09-01", dateDebut: "2026-10-01" },
    { etat: "en_formation", prix: 1500, beneficiaire: "B", offreId: "o1", dateInscription: "2026-08-01", dateDebut: "2026-09-01" },
    { etat: "paye", prix: 1200, beneficiaire: "C", offreId: "o1", dateInscription: "2026-05-01", dateDebut: "2026-06-01" },
    { etat: "refuse", prix: 900, beneficiaire: "D", offreId: "o1", dateInscription: "2026-05-01", dateDebut: "2026-06-01" },
  ], { aujourdhui: AUJ });
  assert.equal(t.total, 4);
  assert.equal(t.ouverts, 2, "payé et refusé sont clos");
  assert.equal(t.enAttente, 1);
  assert.equal(t.aDeclarer, 1);
  assert.equal(t.montantOuvert, 3500);
  assert.match(t.reserve, /ne remplace pas la plateforme du financeur/);
  for (const [k, v] of Object.entries(ETATS)) { assert.ok(v.label, k); assert.equal(typeof v.ouvert, "boolean"); }
});

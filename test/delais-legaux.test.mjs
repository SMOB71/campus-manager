// Délais légaux du rétroplanning d'ouverture.
//
// Ces tests ne vérifient pas un calcul : ils vérifient que le plan n'annonce
// pas des dates que la loi interdit. Chacun cite sa source, parce qu'un délai
// se périme et qu'il faut pouvoir revérifier sans tout rouvrir.
//
// Ils ont tous été écrits APRÈS avoir trouvé la violation correspondante dans
// le modèle — aucun n'est décoratif.
import test from "node:test";
import assert from "node:assert/strict";
import { buildOpeningTasks, OPENING_DUREE_MIN, OPENING_DUREE_REF } from "../lib/calc.js";

const RENTREE = "2027-09-01";
const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const plan = (duree) => {
  const t = buildOpeningTasks(RENTREE, {}, duree);
  return { t, d: (k) => t.find((x) => x.tplKey === k)?.dueDate || null };
};
const DUREES = [OPENING_DUREE_MIN, 12, 13, 14, OPENING_DUREE_REF];

test("autorisation de travaux ERP : quatre mois pleins d'instruction", () => {
  // Cerfa 13824 : l'instruction dure quatre mois à compter du dossier complet,
  // au terme desquels le silence vaut accord. Le dépôt et l'obtention sont
  // deux actions distinctes — le modèle les confondait, et faisait apparaître
  // l'autorisation sept jours après le plan d'aménagement.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(d("depot-at-erp"), `dépôt ERP absent à ${duree} mois`);
    assert.ok(d("autorisation-erp"), `autorisation ERP absente à ${duree} mois`);
    const instruction = jours(d("depot-at-erp"), d("autorisation-erp"));
    assert.ok(instruction >= 122, `${duree} mois : ${instruction} j d'instruction, quatre mois minimum`);
  }
});

test("le chantier ne démarre jamais avant l'autorisation de travaux", () => {
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(d("demarrage-chantier") > d("autorisation-erp"),
      `${duree} mois : chantier le ${d("demarrage-chantier")}, autorisation le ${d("autorisation-erp")}`);
  }
});

test("la durée minimale du modèle est celle que l'instruction ERP autorise", () => {
  // Le plancher était calculé (pivot + amont minimum = 10 mois) sans tenir
  // compte d'un délai que personne ne comprime : une mairie qui instruit.
  const { d } = plan(OPENING_DUREE_MIN);
  assert.ok(jours(d("depot-at-erp"), d("autorisation-erp")) >= 122);
  // Un mois de moins et le délai n'est plus tenu : le plancher est au bon endroit.
  const court = plan(OPENING_DUREE_MIN - 1);
  assert.ok(jours(court.d("depot-at-erp"), court.d("autorisation-erp")) < 122,
    "le plancher est trop haut : une durée plus courte tiendrait encore");
});

test("dommages-ouvrage souscrite AVANT l'ouverture du chantier", () => {
  // Art. L242-1 du code des assurances. Le modèle plaçait la souscription le
  // jour même du démarrage — une police signée le matin ne couvre pas la
  // journée qui commence.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(d("souscription-assur") < d("demarrage-chantier"),
      `${duree} mois : assurance le ${d("souscription-assur")}, chantier le ${d("demarrage-chantier")}`);
  }
});

test("les entreprises sont choisies avant le jour où elles commencent", () => {
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(jours(d("devis"), d("demarrage-chantier")) >= 14,
      `${duree} mois : ${jours(d("devis"), d("demarrage-chantier"))} j entre le choix des devis et le chantier`);
  }
});

test("commission de sécurité : demandée au moins un mois avant la visite", () => {
  // La visite se demande un mois avant la date prévue d'ouverture, délai
  // nécessaire à la convocation des membres de la commission.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    const preavis = jours(d("demande-visite"), d("passage-commission"));
    assert.ok(preavis >= 28, `${duree} mois : ${preavis} j de préavis de commission`);
  }
});

test("l'arrêté du maire précède la pré-rentrée, et la commission précède l'arrêté", () => {
  // Sans arrêté d'ouverture pris après avis de la commission, aucun accueil du
  // public n'est légal — pas même une pré-rentrée.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(d("passage-commission") < d("arrete-maire"), `${duree} mois : commission après l'arrêté`);
    assert.ok(d("arrete-maire") < d("prerentree"), `${duree} mois : arrêté après la pré-rentrée`);
    assert.ok(d("verifs-tech") < d("demande-visite"), `${duree} mois : vérifications techniques après la demande de visite`);
  }
});

test("déclaration d'ouverture : les trois mois d'opposition sont purgés avant la rentrée", () => {
  // Le recteur transmet au maire, au préfet et au procureur ; chacun peut
  // s'opposer dans un délai de trois mois. Le délai était dans un commentaire
  // du code — invisible dans un plan. C'est maintenant une action datée.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(d("fin-opposition"), `fin du délai d'opposition absente à ${duree} mois`);
    assert.ok(jours(d("depot-rectorat"), d("fin-opposition")) >= 90,
      `${duree} mois : ${jours(d("depot-rectorat"), d("fin-opposition"))} j d'opposition, trois mois attendus`);
    assert.ok(d("fin-opposition") < RENTREE, `${duree} mois : opposition non purgée à la rentrée`);
  }
});

test("la demande de dossier au rectorat part au premier jour du projet", () => {
  // Le process diffère d'un rectorat à l'autre : on ne dépose pas un dossier
  // dont on ignore la composition.
  for (const duree of DUREES) {
    const { t, d } = plan(duree);
    const debut = t.map((x) => x.dueDate).sort()[0];
    assert.equal(d("demande-rectorat"), debut, `${duree} mois : demande rectorat le ${d("demande-rectorat")}, projet ouvert le ${debut}`);
    assert.ok(d("demande-rectorat") < d("depot-rectorat"));
  }
});

test("DPAE : dans la fenêtre des huit jours qui précèdent la prise de poste", () => {
  // Au plus tôt huit jours avant, au plus tard la veille. Une DPAE anticipée
  // est irrecevable, et l'absence de DPAE valide est du travail dissimulé. Le
  // modèle la fondait dans la signature des contrats, deux mois plus tôt.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    const avant = jours(d("dpae"), d("prerentree"));
    assert.ok(avant >= 0 && avant <= 8, `${duree} mois : DPAE ${avant} j avant la prise de poste`);
    assert.ok(d("contrats-travail") < d("dpae"), "les contrats se signent avant la déclaration");
  }
});

test("NDA avant l'audit Qualiopi, et Qualiopi avant la rentrée", () => {
  // La déclaration d'activité se fait dans les trois mois de la première
  // convention, et la DREETS dispose de trente jours pour le récépissé. Sans
  // NDA, pas de Qualiopi ; sans Qualiopi, pas de fonds publics.
  for (const duree of DUREES) {
    const { d } = plan(duree);
    assert.ok(jours(d("nda"), d("qualiopi-audit")) >= 60,
      `${duree} mois : ${jours(d("nda"), d("qualiopi-audit"))} j entre NDA et audit`);
    assert.ok(d("qualiopi-audit") < RENTREE);
  }
});

test("aucune dépendance inversée, quelle que soit la durée retenue", () => {
  // Le filet : une action ne peut pas être due avant ce dont elle dépend.
  // C'est ce test qui a fait sortir les inversions introduites en corrigeant
  // les délais légaux eux-mêmes.
  for (const duree of DUREES) {
    const { t } = plan(duree);
    const parId = new Map(t.map((x) => [x.id, x]));
    const inversions = t.flatMap((x) => (x.dependsOn || [])
      .map((p) => parId.get(p))
      .filter((q) => q && q.dueDate > x.dueDate)
      .map((q) => `${duree} mois : ${q.tplKey} (${q.dueDate}) exigé avant ${x.tplKey} (${x.dueDate})`));
    assert.deepEqual(inversions, []);
  }
});

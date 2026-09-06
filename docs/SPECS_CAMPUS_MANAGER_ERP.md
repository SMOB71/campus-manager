# Dossier de specs — Campus Manager ERP

**Cadrage session 1 — 6 septembre 2026 — à relire et annoter par Stéphane.**
**Décision produit : l'ERP se construit DANS Campus Manager** (campusmanager.fr) — pas de nouveau nom ni de nouveau socle ; phasage dans [PLAN_CAMPUS_MANAGER_ERP.md](PLAN_CAMPUS_MANAGER_ERP.md).
Référentiel du projet : tout écart futur se discute contre ce document. Le modèle de données est aligné sur les structures standard des SI de formation du marché (spec complète en notre possession, conservée hors repo) pour garantir l'importabilité des données d'un établissement existant.

---

## 1. Vision

**Campus Manager**, l'ERP des CFA, écoles supérieures privées et organismes de formation (5 à 5 000 apprenants) : toute la gestion — apprenants, planning, assiduité, contrats, facturation, conformité — dans une UX moderne, avec le pilotage et l'IA en standard, une API publique complète, et une reprise de données depuis le SI existant en jours.

- **Cibles** : CFA et écoles multi-sites (cœur), OF mono-site (entrée de gamme), groupes/réseaux (premium).
- **Modèle** : abonnement par apprenant actif/mois, 3 paliers (Essentiel / Pro / Réseau), portails inclus à tous les paliers.
- **Anti-positionnement** : pas un LMS (on s'intègre à Moodle & co), pas un outil de paie.

## 2. Rôles

| Rôle | Portée | Typique |
|---|---|---|
| Admin organisme | toute l'instance | DG, DAF |
| Directeur de site | son/ses sites | directeur de campus |
| Administratif | sites assignés, modules gestion | assistante de direction, chargé alternance |
| Formateur | ses groupes : planning, émargement, notes | enseignant, intervenant |
| Apprenant | son dossier (portail) | étudiant, apprenti |
| Tuteur entreprise | ses alternants (portail, lien signé) | maître d'apprentissage |
| Représentant légal | dossiers liés (portail, mineurs) | parent |
| Super-admin éditeur | support, jamais les données métier sans accréditation tracée | nous |

Modèle de permission : rôle × campus × module — extension du cloisonnement existant (admin/directeur scopé par campusIds) aux nouveaux rôles formateur/apprenant/tuteur, délégations fines par module (ex. administratif « contrats » sans « facturation »).

## 3. Socle technique

- **Stack** : l'existant Campus Manager (Node/Express, store JSON **chiffré AES-256-GCM par instance**, fichiers dédiés pour les gros volumes comme `sessions.json`), étendu module par module.
- **Architecture commerciale** : **une instance dédiée par client** — conteneur + volume chiffré (DATA_KEY propre) + sous-domaine. Isolation totale par établissement (argument sécurité/RGPD/souveraineté), zéro refonte multi-tenant ; réévaluation vers un socle mutualisé Postgres à ~30 clients.
- **Hébergement** : France (VPS OVH actuels pour le réseau et la beta, capacité dédiée à la commercialisation), sauvegardes chiffrées externalisées (le schéma actuel), PRA documenté.
- **Sécurité** : MFA, sessions courtes, audit log immuable, chiffrement au repos, throttling, CSP stricte, pentest avant commercialisation.
- **RGPD by design** : registre des traitements (module RGPD existant, étendu), durées de rétention configurables, export/purge par personne, DPA type.
- **API publique** : chaque fonctionnalité de l'UI passe par l'API publique documentée (dogfooding) ; jetons scopés par module ; webhooks (inscription créée, absence saisie, contrat signé, facture émise…).
- **IA** : fournisseur configurable par instance, cible souveraine FR (cohérent avec le plan IA souveraine Ruliora) ; l'IA **propose, l'humain valide** — aucun chiffre ni document réglementaire auto-validé (règle zéro-hallucination héritée de Campus Manager).

## 4. Modèle de données cible (par domaine)

Conventions : collections du store Campus Manager (les entités volumineuses — émargements, séances — en fichiers dédiés type `sessions.json`), audit sur toute mutation, identifiants externes génériques (`external_ids` : source, code — la clé de toute reprise de données). Les noms ci-dessous sont logiques ; plusieurs existent déjà (campus=site, classes=cohortes, teachers=staff, curricula, rooms, periods, partners→company).

### 4.1 Structure
- **site** (= campus existant, enrichi : SIRET, RNE/UAI, n° de déclaration d'activité, RIB) ; **school_year** (année scolaire).
### 4.2 Offre de formation
- **program** (formation : nom, code diplôme/RNCP, niveau, durées mois/jours/heures, **NPEC**, prix de vente, unité de facturation, nature d'action ; mapping comptable — comptes généraux/analytiques — paramétrable par tenant).
- **cohort** (promotion/session : période, formation, site, dates, capacités min/max, modalité d'enseignement, entrées/sorties permanentes, prix).
- **subject** (matière), **skill_block** (bloc de compétences RNCP), **curriculum** (référentiel horaire par matière — logique reprise de `schedule.js`).
### 4.3 Personnes
- **learner** (dossier apprenant complet : état civil, INE, RQTH, représentant légal, origine scolaire, diplôme obtenu, adresses/contacts) ; **enrollment** (inscription : apprenant × cohorte × année, statut, situation, date de sortie) ; **application** (candidature : vœux multiples, représentant légal, session de test, pièces) — le funnel admissions.
- **staff** (formateur/administratif : matières, site de rattachement, contrat de service → règles `SERVICE_LIMITS` du planning).
### 4.4 Entreprises & contrats
- **company** (SIRET, NAF, forme juridique, convention collective, type employeur, financeur usuel, adresse de facturation, TVA intracom, liens siège/filiales) ; **company_contact** (interlocuteurs).
- **training_contract** (contrat d'alternance : type apprentissage/professionnalisation, dates, maître d'apprentissage, **NPEC, n° dossier financeur, n° de dépôt**, prorogations, **résiliation : date, motif, en cours**) ; **internship** (stage/convention).
### 4.5 Planning & assiduité
- **session** (séance : cohorte, matière, formateur, salle, date, heures, type cours/examen/rattrapage — modèle `schedule.js`) ; **room** ; **calendar_period** (vacances/férié/examens/stage).
- **attendance_sheet** (feuille d'émargement par séance) ; **attendance_entry** (présence/absence/retard par apprenant, signature, horodatage, **hash chaîné**) ; **absence** (durée en minutes, justifiée ou non, motif, justificatif GED) ; **absence_reason** (paramétrable).
### 4.6 Pédagogie
- **assessment** (évaluation), **grade**, **report_card** (bulletin périodique), **learning_record** (livret).
### 4.7 Finance
- **funding_agreement** (prise en charge : OPCO/CPF/entreprise/particulier/région, montants, échéancier) ; **invoice** / **credit_note** (+ lignes) ; **payment** ; **billing_schedule** (échéancier NPEC prorata temporis + règle d'assiduité). Une **vue matérialisée de contrôle** croise en continu minutes prévues/réalisées et facturé/valeur d'assiduité — c'est le tableau de bord anti-reprise financeur.
### 4.8 Conformité & pilotage
- **qualiopi_indicator_status** (par indicateur × audit, preuves GED — porté de `qualiopi.js`) ; **bpf_report**, **sifa_export** (générés, versionnés) ; **kpi_snapshot** (alimenté en continu pour le cockpit).

## 5. Modules

Chaque module = objectif, user stories clés (US), règles métier structurantes (RM), et **docs réels requis** avant codage.

### M0 — Socle produit *(transverse)*
Déjà en place : auth (MFA WebAuthn), rôles admin/directeur scopés, audit, RGPD, chiffrement, CSRF, sauvegardes. À ajouter : rôles formateur/apprenant/tuteur (Bloc 1), provisioning d'instances + Stripe + vitrine campusmanager.fr (Bloc 7).
RM : aucune route sans cloisonnement ; toute mutation auditée ; suppression = anonymisation RGPD, jamais un DELETE physique des dossiers réglementaires.

### M1 — Référentiels *(Bloc 2)*
Sites, années scolaires, formations, cohortes, matières, blocs, salles, motifs d'absence, calendrier (vacances/fériés/examens/stage).
US : je crée une formation avec son référentiel horaire et son NPEC ; je duplique une classe d'une année sur l'autre en 1 clic (une rentrée = 80 % de reconduction). NB : formations/référentiels/classes/salles/périodes existent déjà (module planning) — ce module les enrichit (NPEC, prix, RNCP).
RM : une cohorte a des capacités min/max ; alertes sous-remplissage (pattern cockpit).

### M2 — Apprenants & inscriptions *(Bloc 2)*
Dossier complet, inscriptions multi-années, GED par dossier, **timeline** (tous les événements de la vie de l'apprenant sur une seule vue — ce que les ERP historiques n'ont jamais su montrer).
US : en 3 clics je vois pour un apprenant : inscription, contrat, assiduité du mois, notes, solde de facturation, derniers échanges.
RM : INE facultatif à la création, bloquant pour l'enquête SIFA ; RQTH → référent handicap notifié (Qualiopi ind. 26).

### M3 — Entreprises *(Bloc 2)*
Fiches SIRET (auto-complétées via l'API Recherche d'entreprises de l'État), interlocuteurs, historique relation, offres d'alternance, capacité d'accueil, multi-établissements (siège/filiales).
US : je vois toutes les entreprises « à risque relationnel » (un seul contact, pas d'échange depuis 6 mois, rupture récente).
RM : détection de doublons SIRET à la saisie ET à l'import.

### M4 — Admissions *(Bloc 2)*
Formulaire public de candidature (par site/formation), funnel paramétrable (nouveau → testé → admis → inscrit), sessions de test, conversion candidat → apprenant sans re-saisie.
US : un candidat postule en ligne, dépose ses pièces, reçoit sa convocation ; je pilote mon funnel par formation avec taux de conversion.
RM : consentement RGPD explicite à la candidature ; purge automatique des candidatures non converties (durée paramétrable).

### M5 — Planning *(DÉJÀ LIVRÉ — module Enseignement)*
En production : générateur (semaine type déroulée sur l'année, contraintes légales dures), conflits (salle/prof/classe/période), couverture du référentiel, service et équité, impression A4, iCal, envoi par mail. Reste : temps de trajet inter-sites paramétrable (mineur).

### M6 — Assiduité & émargement *(Bloc 3 — le module le plus sensible)*
Feuille d'émargement par séance ; 3 modes : signature tactile en salle (tablette formateur), code séance saisi par l'apprenant sur son portail, pointage badge (plus tard). Justificatifs, workflow de justification, alertes.
RM : **valeur probante** = horodatage serveur + identité authentifiée + hash chaîné par feuille + export PDF scellé par période/financeur ; une feuille verrouillée ne se modifie que par avenant tracé ; les minutes d'absence alimentent directement le prorata de facturation (M10).
**Docs réels requis** : une feuille d'émargement actuelle + ce que le contrôleur a demandé lors du dernier contrôle financeur.

### M7 — Pédagogie *(Bloc 4)*
Évaluations, notes, moyennes pondérées par matière/bloc, bulletins périodiques (système documentaire éprouvé sur Campus Manager), livret, conseil de classe (saisie collégiale + appréciations, brouillon IA validé par le formateur).
**Docs réels requis** : un bulletin actuel de chaque type d'école du réseau (BTS, Bachelor…).

### M8 — Portails *(Bloc 4)*
- **Apprenant** : planning, absences (+ justifier), notes, documents (certificats de scolarité auto), factures si autofinancé, signature d'émargement.
- **Formateur** : ses séances, appel/émargement en 2 taps, saisie de notes, indisponibilités.
- **Entreprise/tuteur** : ses alternants (assiduité, planning, bulletins), contrats et factures, signalement — extension du portail tuteur (lien signé, zéro mot de passe).
- **Représentant légal** : lecture (mineurs), justification d'absence.
RM : portails = même API publique, scopes réduits ; aucune donnée d'un autre apprenant ne transite (tests de cloisonnement dédiés).

### M9 — Contrats *(Bloc 5)*
Contrat d'apprentissage/professionnalisation : assistant de saisie (données déjà connues pré-remplies : apprenant M2, entreprise M3, formation M1), génération **Cerfa** (version en vigueur — à vérifier au codage), convention de formation, avenants, suivi du dépôt (n° dossier financeur, dépôt DDETS), échéances (fin de période d'essai, fin de contrat), **workflow rupture** (détection → médiation → replacement — différenciateur majeur).
RM : contrôles bloquants avant édition (âge/rémunération légale, cohérence dates formation/contrat, SIRET valide, maître d'apprentissage renseigné) ; e-signature en option (prestataire eIDAS, pas maison).
**Docs réels requis** : 2 Cerfa réels remplis (un apprentissage, un pro), une convention, un avenant, un refus de prise en charge motivé.

### M10 — Financements & facturation *(Bloc 5 — le cœur économique)*
Prise en charge par contrat (OPCO : NPEC + échéancier réglementaire ; CPF ; entreprise ; particulier avec échéancier ; multi-financeurs par dossier). Facturation générée depuis l'échéancier **avec prorata d'assiduité automatique** (les minutes de M6), avoirs, relances, exports comptables (FEC-compatible), lettrage simple des règlements.
RM : une facture émise est immuable (avoir pour corriger) ; **écran de contrôle facturé vs valeur d'assiduité** en continu (anti-reprise financeur) ; **rapport de rapprochement** avec le SI sortant pendant toute migration d'un client (à l'euro près, mois par mois) — c'est un outil produit, pas un script interne.
**Docs réels requis** : notification de prise en charge, échéancier financeur réel, facture émise + avoir, un cas réel de reprise pour absentéisme.

### M11 — Conformité *(Bloc 6)*
**BPF** généré (rubrique par rubrique depuis les données réelles, écarts expliqués ligne à ligne), **SIFA** (export au format de la campagne, contrôles INE/nomenclatures avant dépôt), **Qualiopi** intégré (32 indicateurs, preuves rattachées automatiquement quand elles existent déjà dans le système : émargements → ind. 9, réclamations → ind. 31…), registre des réclamations, enquêtes satisfaction/insertion.
**Docs réels requis** : dernier BPF déposé, dernier export SIFA, dernier rapport d'audit Qualiopi.

### M12 — Pilotage & IA *(Bloc 7 — la vitrine)*
Cockpit multi-sites (santé, heatmap, alertes, priorités — patterns Campus Manager portés en multi-tenant), **prévision de rupture** (score par alternant : pente d'absentéisme, retards, signaux tuteur), anomalies d'assiduité, assistant IA contextualisé aux données du tenant (jamais de chiffre inventé), brouillons (courriers, comptes rendus, réponses réclamations).

### M13 — Reprise de données & intégrations *(transverse, v1 dès Bloc 2)*
**Importeur depuis le SI sortant** : connecteur dédié pour l'ERP dominant du marché (client API déjà écrit et testé, spec complète en notre possession) — référentiels, apprenants + inscriptions, entreprises, contrats, historique d'absences ; rapport d'import (créés/rapprochés/rejetés + raisons) ; rejouable et idempotent (via `external_ids`). Import CSV générique pour les autres. Exports : ICS, XLSX partout, API publique + webhooks pour LMS/compta/BI. **Argument commercial : une école migre en jours, pas en mois.**

## 6. Exigences non-fonctionnelles

Disponibilité cible 99,5 % (SLA early adopters), RTO 4 h / RPO 24 h puis 1 h, p95 < 300 ms sur les listes standards, tests automatisés à chaque module (unitaires + **cloisonnement multi-tenant systématique** — le test « le tenant A ne voit jamais le tenant B » est bloquant en CI), accessibilité RGAA raisonnable sur les portails (secteur handicap-sensible, argument Qualiopi ind. 26).

## 7. Nom & marque

**Décidé : Campus Manager** — le domaine campusmanager.fr est actif avec sa charte (teal/corail). À traiter avant le premier client externe : dépôt INPI de la marque, CGV/DPA, structure de facturation.

## 8. Questions ouvertes pour Stéphane (à annoter)

1. Circuit réel de justification d'absence dans le réseau aujourd'hui (qui reçoit, qui décide, délai) ?
2. Qui saisit les Cerfa aujourd'hui et où ça coince (les 3 erreurs les plus fréquentes) ?
3. La facturation financeurs : gérée par campus ou centralisée ? Qui relance ?
4. Paie des formateurs : hors périmètre confirmé ? (le service du planning peut exporter les heures vers la paie)
5. Mineurs dans le réseau ? (active ou non le portail représentant légal en v1)
6. E-signature : besoin dès la v1 (Cerfa/conventions) ou v1.1 ?
7. Palier de prix cible par apprenant/mois pour l'entrée de gamme (aide à trancher ce qui est « inclus ») ?

## 9. Checklist documents réels à rassembler (avant les blocs concernés)

- [ ] Feuille d'émargement actuelle + attentes du dernier contrôle financeur *(avant Bloc 3)*
- [ ] Bulletins actuels par type d'école *(avant Bloc 4)*
- [ ] 2 Cerfa remplis, convention, avenant, refus de prise en charge motivé *(avant Bloc 5)*
- [ ] Notification de prise en charge + échéancier + facture/avoir + cas de reprise *(avant Bloc 5)*
- [ ] Dernier BPF, dernier SIFA, dernier rapport d'audit Qualiopi *(avant Bloc 6)*
- [ ] Accès API au SI sortant d'un campus *(tout de suite — importeur + rapprochement)*

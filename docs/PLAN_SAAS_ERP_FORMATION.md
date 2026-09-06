# Planning — nouveau SaaS ERP formation

**Date : 6 septembre 2026 — confidentiel. Hypothèse : Claude code l'intégralité, Stéphane pilote produit/marché.**

Objet : créer un **logiciel SaaS commercialisable** pour CFA, écoles et organismes de formation — couverture complète du métier (gestion, alternance, conformité) avec une supériorité nette sur les ERP historiques : UX, pilotage, IA, relation entreprise, API. Ce n'est pas Campus Manager étendu : Campus Manager reste le cockpit interne du réseau et devient le **labo produit** ; le réseau de Stéphane est le **client zéro**.

**Actifs réutilisables déjà écrits dans Campus Manager** (logique pure, portable telle quelle) : le **module planning complet** (`lib/schedule.js` — service des enseignants avec plafonds contractuels et heures sup, disponibilités, référentiels et couverture des volumes, périodes vacances/examens/stage, détection de conflits, génération automatique, ICS), le **connecteur SI campus** (`lib/si.js`, futur importeur), le référentiel **Qualiopi** (`lib/qualiopi.js`), le **système documentaire** Word/PDF (`lib/export.js`) et les patterns cockpit (santé, heatmap, alertes). C'est plusieurs semaines de développement déjà payées.

## Partis pris (ce qui fait la différence)

1. **Multi-tenant dès le premier jour** — un déploiement, N organismes, cloisonnement Postgres RLS par organisation. C'est le socle déjà éprouvé sur Ruliora (RLS org, MFA, audit, RGPD, observabilité des crons) : on réutilise les patterns, pas le code métier.
2. **API-first** — chaque fonction exposée en OpenAPI publique documentée. Un argument commercial en soi face aux ERP historiques fermés.
3. **UX moderne** — web + mobile responsive, portails inclus dans le prix (apprenant, formateur, entreprise, parents), pas en option payante.
4. **IA native** — prévision de rupture, détection d'anomalies d'assiduité, pré-remplissage Cerfa, assistants de rédaction. Les éditeurs historiques ne peuvent structurellement pas suivre.
5. **Pilotage intégré** — le cockpit type Campus Manager (heatmap, santé, alertes) en standard : les ERP historiques gèrent, nous on pilote.
6. **Souveraineté** — hébergement France (OVH/Scaleway), chiffrement au repos, RGPD by design. Cohérent avec le virage IA souveraine déjà décidé chez Ruliora.
7. **Reprise de données industrialisée** — le connecteur SI déjà écrit devient l'outil d'import : un prospect migre ses données en jours, pas en mois. C'est l'arme anti-coût-de-sortie.

## Stack

NestJS + Next.js + PostgreSQL/Drizzle (RLS), Redis, S3-compatible FR pour les documents, file d'emails transactionnels, Stripe pour l'abonnement SaaS. Infra : les deux VPS existants pour le dev/beta, dimensionnement dédié à la commercialisation.

---

## Phasage (démarrage octobre 2026)

### Sprint de cadrage *(2 semaines, oct. 2026, 2-3 sessions)*
Modèle de données métier complet (apprenant, formation, session, groupe, contrat, financement, entreprise — validé contre les modèles des SI du marché), arborescence produit, maquettes des 5 écrans clés, nom + positionnement prix.

### Bloc 1 — Socle SaaS *(oct.-nov. 2026, ~10 sessions)*
Multi-tenant RLS, auth (MFA, SSO plus tard), RBAC (admin organisme, directeur site, formateur, administratif), gestion organisation/sites, journal d'audit, RGPD (registre, export, purge), abonnement Stripe, CI + déploiement, sauvegardes. **Tout le reste s'appuie dessus — zéro dette acceptée ici.**

### Bloc 2 — Référentiels & vie de l'apprenant *(nov.-déc. 2026, ~10 sessions)*
Dossiers apprenants, formations/sessions/groupes, inscriptions et parcours, entreprises et interlocuteurs, GED par dossier. **Importeur SI v1** (via le connecteur existant) : un organisme se peuple en une journée.

### Bloc 3 — Planning & assiduité *(déc. 2026-janv. 2027, ~8 sessions)*
Emplois du temps : **portage du module déjà écrit dans Campus Manager** (logique pure `schedule.js` : conflits salles/profs/disponibilités, service contractuel et heures sup, couverture des référentiels, périodes, génération auto, ICS) vers le modèle multi-tenant — l'essentiel du travail est déjà fait, reste l'adaptation données + UI SaaS. Le gros du bloc devient l'**assiduité** : feuilles d'émargement, **signature à valeur probante** (horodatage serveur, chaînage de hash, exports de preuve par financeur), absences/retards/justificatifs, alertes.

### Bloc 4 — Pédagogie & portails *(janv.-févr. 2027, ~10 sessions)*
Notes, bulletins, livrets, blocs de compétences ; portails apprenant, formateur, entreprise/tuteur, parents. Notifications email/push.

**🏁 Jalon MVP — février 2027** : le client zéro (réseau de Stéphane) démarre en réel sur un premier campus : inscriptions, planning, émargement, notes, portails. Le SI sortant garde contrats et facturation pendant la preuve.

### Bloc 5 — Contrats & financements *(févr.-mai 2027, ~14 sessions)*
Cerfa apprentissage + conventions + avenants avec contrôles de cohérence, suivi OPCO (accords de prise en charge, NPEC), échéanciers et **facturation** (OPCO, CPF, entreprises, particuliers ; prorata assiduité, avoirs), relances. Comparateur double-run vs le SI sortant (l'outil de bascule, réutilisé pour chaque client migré).

### Bloc 6 — Conformité sectorielle *(mai-juil. 2027, ~8 sessions)*
BPF, enquête SIFA, module Qualiopi intégré (indicateurs, preuves, audits — l'expérience Campus Manager resservie en multi-tenant), exports comptables.

### Bloc 7 — Pilotage & IA *(en continu, concentré juil.-août 2027, ~8 sessions)*
Cockpit dirigeant (santé, heatmap multi-sites, alertes), prévision de rupture, anomalies d'assiduité, assistants (courriers, comptes rendus). C'est la vitrine des démos commerciales.

**🏁 Jalon V1 — été 2027** (marge jusqu'à la rentrée) : parité cœur + supériorité différenciante, client zéro complet dessus (hors bascule facturation finale), produit démontrable.

### Année de preuve *(sept. 2027 → été 2028)*
- Client zéro : exercice complet, double-run facturation, contrôle financeur encaissé.
- **3 à 5 organismes early adopters** (tarif fondateur, migration offerte via l'importeur) — le réseau relationnel du DO est le canal.
- Durcissement : montée en charge, SLA, pénétration test, page statut, documentation publique.

**🏁 Commercialisation large : rentrée 2028** — avec des références vérifiables, un importeur rodé et un exercice de facturation prouvé.

---

## Récapitulatif

| Période | Livrable | Sessions |
|---|---|---|
| Oct. 2026 | Cadrage (modèle de données, maquettes, nom) | 2-3 |
| Oct.-nov. 2026 | Socle SaaS multi-tenant | ~10 |
| Nov.-déc. 2026 | Référentiels + importeur SI | ~10 |
| Déc. 2026-janv. 2027 | Planning (portage du module existant) + émargement probant | ~8 |
| Janv.-févr. 2027 | Pédagogie + 4 portails → **MVP client zéro** | ~10 |
| Févr.-mai 2027 | Cerfa + OPCO + facturation | ~14 |
| Mai-juil. 2027 | BPF/SIFA/Qualiopi | ~8 |
| Juil.-août 2027 | Pilotage + IA → **V1 démontrable** | ~8 |
| Sept. 2027-été 2028 | Preuve : exercice complet + 3-5 early adopters | support |
| Rentrée 2028 | **Commercialisation large** | — |

**≈ 70-80 sessions de code sur ~11 mois** pour la V1 (le module planning déjà écrit fait gagner un mois), puis du support. À raison de 3-4 sessions/semaine c'est soutenable en parallèle de Ruliora ; à mi-temps dessus, la V1 peut avancer à mai-juin 2027.

## Ce que le code ne résout pas (à décider en face)

- **Support client externe** : dès le premier client payant hors réseau, il faut un humain joignable (toi au début, puis quelqu'un). C'est LE coût caché du passage en SaaS.
- **Veille réglementaire** : trimestrielle dès le Bloc 5, obligatoire à vie — c'est la rente des éditeurs historiques qu'on internalise.
- **Arbitrage Ruliora vs ce produit** : deux SaaS en parallèle avec le même pilote humain. Mon conseil : caler les sprints ERP sur les creux de Ruliora, et réévaluer la charge au jalon MVP (février 2027).
- **Structure juridique/marque** : filiale, marque, CGV, DPA — à traiter avant le premier client externe (pas avant).

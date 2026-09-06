# Campus Manager ERP — plan de construction

**Date : 6 septembre 2026 — confidentiel. Décision : le produit EST Campus Manager** (campusmanager.fr, déjà en production sur le réseau). Pas de nouveau nom, pas de nouveau socle : les modules ERP se construisent **dans l'application existante**, le réseau de Stéphane reste le client zéro et l'utilise au quotidien pendant la construction.

## Ce que ça change (vs un produit neuf)

- **Zéro portage** : planning (générateur, service des profs, référentiels), Qualiopi, cockpit, GED, exports Word/PDF, utilisateurs/rôles, chiffrement, CSRF, audit — déjà en production et testés (74 tests).
- **Le nom et le domaine existent** : campusmanager.fr est actif, HTTPS, avec sa charte.
- **MVP beaucoup plus tôt** : il manque à Campus Manager les dossiers apprenants individuels, l'émargement, les notes, les contrats et la facturation — pas les 60 % déjà construits.
- **Architecture commerciale : une instance dédiée par client** (conteneur + volume chiffré + sous-domaine, comme l'instance actuelle). Isolation totale par client = argument sécurité/RGPD/souveraineté, et zéro refonte multi-tenant. Provisioning automatisé au Bloc 7. Si le parc dépasse ~30 clients, une migration vers un socle mutualisé Postgres se décidera à ce moment-là, pas avant.

## Phasage (dans Campus Manager, démarrage immédiat)

### Bloc 1 — Apprenants & inscriptions *(oct. 2026, ~6 sessions)*
Rôles étendus (formateur, apprenant, tuteur — en plus d'admin/directeur), dossiers apprenants individuels (état civil, INE, RQTH, représentant légal, GED par dossier), inscriptions par classe/année (les `classes` du module planning deviennent les cohortes), **timeline apprenant** (vue unique : inscription, assiduité, notes, contrat).
La vue Admissions existante se connecte : candidat admis → dossier apprenant sans re-saisie.

### Bloc 2 — Émargement & assiduité *(nov. 2026, ~6 sessions)*
Branché directement sur les **séances du planning existant** : feuille d'émargement par séance, signature tactile ou code séance, absences/retards/justificatifs, workflow de justification.
**Valeur probante** : horodatage serveur, chaînage de hash par feuille, export PDF scellé par période/financeur. Alertes absentéisme dans le cockpit (le seuil existe déjà).

### Bloc 3 — Contrats & notes *(déc. 2026, ~8 sessions)*
Entreprises enrichies (SIRET auto via l'API de l'État, interlocuteurs, offres) ; **contrats d'alternance** (dates, maître d'apprentissage, NPEC, suivi de dépôt, échéances, workflow rupture : détection → médiation → replacement) ; notes, moyennes par matière/bloc, **bulletins** (le système documentaire existant les génère).

**🏁 MVP — janvier 2027** (semestre 2) : le réseau gère apprenants, émargement, notes et contrats dans Campus Manager. Le SI sortant ne garde que Cerfa et facturation.

### Bloc 4 — Portails *(janv.-févr. 2027, ~8 sessions)*
Apprenant (planning, absences + justifier, notes, documents, signature d'émargement), formateur (appel en 2 taps, notes, indisponibilités), tuteur entreprise (extension du lien signé existant : assiduité, planning, bulletins de ses alternants). Représentant légal si mineurs.

### Bloc 5 — Cerfa, financements & facturation *(févr.-mai 2027, ~14 sessions)*
Générateur Cerfa (version en vigueur, contrôles bloquants), conventions, avenants ; prises en charge (OPCO/NPEC, CPF, entreprise, particulier), échéanciers, **facturation avec prorata d'assiduité automatique** (les minutes du Bloc 2), avoirs, relances, exports comptables ; **comparateur double-run** avec le SI sortant — l'outil de bascule, réutilisé pour chaque client migré ensuite. Veille réglementaire trimestrielle instaurée ici.

### Bloc 6 — Conformité *(mai-juin 2027, ~6 sessions)*
BPF généré, export SIFA (contrôles avant dépôt), rattachement automatique des preuves Qualiopi (émargements → ind. 9, réclamations → ind. 31 — le module Qualiopi existe déjà).

### Bloc 7 — Produit commercialisable *(juin-juil. 2027, ~6 sessions)*
Provisioning d'instances (script : conteneur + volume + sous-domaine + DATA_KEY par client), abonnement Stripe, **importeur SI** (le connecteur existant devient l'outil de reprise : un prospect migre en jours), site vitrine sur campusmanager.fr, documentation publique de l'API.

**🏁 V1 commercialisable — été 2027.** Année 2027-28 : exercice complet de facturation en double-run chez le client zéro + 3-5 établissements early adopters (tarif fondateur, instance dédiée, migration offerte). **Commercialisation large : rentrée 2028.**

## Récapitulatif

| Période | Livrable | Sessions |
|---|---|---|
| Oct. 2026 | Apprenants, inscriptions, timeline | ~6 |
| Nov. 2026 | Émargement probant sur le planning existant | ~6 |
| Déc. 2026 | Contrats (+ workflow rupture) + notes/bulletins | ~8 |
| **Janv. 2027** | **🏁 MVP : le réseau vit dans Campus Manager** | — |
| Janv.-févr. 2027 | Portails apprenant/formateur/tuteur | ~8 |
| Févr.-mai 2027 | Cerfa + financements + facturation + comparateur | ~14 |
| Mai-juin 2027 | BPF/SIFA (Qualiopi déjà là) | ~6 |
| Juin-juil. 2027 | Provisioning instances + Stripe + vitrine + importeur | ~6 |
| Été 2027 | **🏁 V1 commercialisable** | — |
| 2027-28 | Preuve (exercice complet) + 3-5 early adopters | support |
| Rentrée 2028 | **Commercialisation large** | — |

**≈ 54-60 sessions sur ~10 mois** — environ 20 sessions de moins que l'option « produit neuf », MVP un mois plus tôt, et le réseau bénéficie de chaque sprint immédiatement.

## Points de vigilance assumés

- **Le store JSON chiffré** tient très bien une instance par client (c'est le modèle actuel) ; les séances sont déjà isolées dans `sessions.json`. Les volumes de l'émargement (une entrée par apprenant × séance) iront dans le même modèle de fichiers dédiés. Réévaluation à ~30 clients.
- **Support client externe** dès le premier payant hors réseau : un humain joignable. À organiser au Bloc 7, pas avant.
- **Veille réglementaire** (Cerfa, NPEC, BPF, SIFA) : trimestrielle à vie dès le Bloc 5.
- Le dossier de specs détaillé (rôles, modèle de données, modules, questions ouvertes, documents réels à fournir) : [SPECS_CAMPUS_MANAGER_ERP.md](SPECS_CAMPUS_MANAGER_ERP.md).

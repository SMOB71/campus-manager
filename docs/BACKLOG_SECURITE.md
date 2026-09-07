# Backlog sécurité — Campus Manager ERP

Points identifiés au fil des sprints, à traiter avant commercialisation.
Tenu à jour à chaque bloc. Priorités : P0 bloquant, P1 avant le bloc indiqué, P2 souhaitable.

| # | Sujet | Prio | Échéance |
|---|---|---|---|
| S-1 | **Ancrage externe de la chaîne d'émargement** | P1 | avant Bloc 5 |
| S-2 | Conservation / purge RGPD des signatures | P2 | Bloc 4 |
| S-3 | Portails : surface exposée (liens signés, rate-limit, cloisonnement) | P1 | Bloc 4 |
| S-4 | Rotation des secrets de connecteurs | P2 | Bloc 7 |
| S-5 | Multi-instances : isolation + restauration vérifiée | P1 | Bloc 7 |
| S-6 | Pentest complet (app + portails + connecteurs) | P0 | Bloc 7 |

## S-1 — Ancrage externe de la chaîne d'émargement

**Le problème.** Le scellement (`lib/attendance.js`) chaîne chaque feuille close à la précédente par empreinte SHA-256 : modifier une feuille ancienne casse toutes les empreintes suivantes, et `verifyChain` le détecte. C'est solide contre une modification *silencieuse* — via l'application, via un accès base, ou par un fichier altéré.

**Sa limite.** Quelqu'un disposant d'un accès complet au serveur peut modifier une feuille **puis recalculer toute la chaîne**. La chaîne redevient cohérente et le contrôle d'intégrité ne voit rien. C'est la limite inhérente à tout chaînage non ancré : la preuve est interne au système qu'elle est censée prouver.

**La parade.** Publier l'empreinte de tête **hors de la machine**, périodiquement :

1. Email quotidien automatique au dirigeant : « chaîne du campus X, N feuilles, empreinte de tête `abc…` » — l'horodatage du serveur de messagerie devient un témoin externe.
2. Copie de l'empreinte dans les sauvegardes off-site déjà en place.
3. Pour les clients à fort enjeu : horodatage qualifié eIDAS auprès d'un tiers de confiance.

Une falsification postérieure exigerait alors de réécrire aussi ces témoins externes, ce qui n'est pas à la portée d'un accès serveur seul.

**Coût.** ~½ session (le calcul de l'empreinte de tête existe déjà : `verifyCampusChain`).

**Quand.** Avant le Bloc 5 — dès que la facturation se calcule sur ces heures, la valeur de la preuve devient financière.

## S-2 — Signatures manuscrites

Les PNG sont chiffrés (AES-256-GCM) dans `data/signatures/`, hors index. Mais rien ne les purge : définir la durée de conservation (alignée sur la durée légale de conservation de la preuve de réalisation) et brancher la purge RGPD existante.

## S-3 — Portails (Bloc 4)

Nouvelle surface exposée à des utilisateurs non-salariés (apprenants, tuteurs). Exigences : liens signés à expiration courte, rate-limit dédié, scopes réduits, et tests automatisés vérifiant qu'aucune donnée d'un autre apprenant ne transite. Revue de sécurité dédiée avant mise en ligne.

## S-4 — Secrets des connecteurs

Jeton SI et secret Salesforce : chiffrés au repos avec `DATA_KEY`, jamais renvoyés au client (couvert par des tests). Reste à documenter la rotation et à vider le cache de jeton lors d'une révocation.

## S-5 — Multi-instances (Bloc 7)

Une instance par client = un conteneur, un volume, une `DATA_KEY` propre. Le provisioning doit automatiser aussi la **vérification de restauration** : une sauvegarde jamais restaurée n'est pas une sauvegarde.

## S-6 — Pentest (Bloc 7)

Avant le premier client externe payant. Périmètre : application, portails, connecteurs, provisioning.

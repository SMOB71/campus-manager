# Backlog sécurité — Campus Manager ERP

Points identifiés au fil des sprints, à traiter avant commercialisation.
Tenu à jour à chaque bloc. Priorités : P0 bloquant, P1 avant le bloc indiqué, P2 souhaitable.

| # | Sujet | Prio | Échéance |
|---|---|---|---|
| S-1 | **Ancrage externe de la chaîne d'émargement** | P1 | avant Bloc 5 |
| S-2 | Conservation / purge RGPD des signatures | P2 | Bloc 4 |
| S-3 | Portails : surface exposée (liens signés, rate-limit, cloisonnement) | ✅ | traité au Bloc 4 |
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

## S-3 — Portails ✅ traité (Bloc 4, 7 septembre 2026)

Ce qui a été mis en place :

- **Accès par lien aléatoire de 32 octets**, pas par mot de passe — demander un mot de passe à 400 apprentis et à leurs tuteurs produit des mots de passe faibles et partagés.
- **Le jeton n'est jamais stocké en clair** : seule son empreinte SHA-256 l'est. Une fuite du store ne donne accès à rien. Il n'est affiché qu'une fois, à la génération.
- **Révocable et daté** : chaque accès porte une expiration, et générer un nouveau lien révoque automatiquement l'ancien (un lien transmis par erreur cesse de valoir).
- **Comparaison à temps constant** du jeton, pour ne pas fuir l'information octet par octet.
- **Limitation de débit dédiée** (30 requêtes/minute/IP) : essayer des jetons au hasard est impraticable.
- **Authentification totalement disjointe** de la session salariée : le portail lit un en-tête `Authorization`, jamais un cookie. Un jeton de portail n'ouvre aucune route salariée, et une session salariée n'ouvre aucune route de portail — les deux sens sont testés.
- **Le jeton vit dans le fragment d'URL** (`#`) : il n'est donc jamais transmis dans la ligne de requête ni écrit dans les journaux d'accès.
- **Portée minimale** : un jeton ne désigne qu'un sujet ; toute donnée renvoyée est filtrée dessus. Un apprenant qui envoie l'identifiant d'un camarade signe quand même pour lui-même ; un tuteur ne voit et ne signale que ses propres alternants. Tests dédiés sur les deux cas.
- **CSRF** : les routes de portail sont exemptées du contrôle double-submit, ce qui est correct *parce que* l'authentification passe par un en-tête qu'une page tierce ne peut pas positionner. Si l'on ajoutait un jour un cookie de portail, il faudrait rétablir la protection.

Reste ouvert : S-2 (purge des signatures) et une revue externe au moment du pentest (S-6).

## S-4 — Secrets des connecteurs

Jeton SI et secret Salesforce : chiffrés au repos avec `DATA_KEY`, jamais renvoyés au client (couvert par des tests). Reste à documenter la rotation et à vider le cache de jeton lors d'une révocation.

## S-5 — Multi-instances (Bloc 7)

Une instance par client = un conteneur, un volume, une `DATA_KEY` propre. Le provisioning doit automatiser aussi la **vérification de restauration** : une sauvegarde jamais restaurée n'est pas une sauvegarde.

## S-6 — Pentest (Bloc 7)

Avant le premier client externe payant. Périmètre : application, portails, connecteurs, provisioning.

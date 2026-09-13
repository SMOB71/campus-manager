# Restaurer Campus Manager

Procédure écrite **avant** d'en avoir besoin. Le jour de l'incident, personne n'improvise.

## Ce qui existe comme sauvegarde

| Mécanisme | Quoi | Où | Fréquence |
|---|---|---|---|
| Archive applicative (`.cmbak`) | 53 collections + documents téléversés, chiffrée, empreinte SHA‑256 | `data/archives` sur le VPS App, + serveur externe si activé | quotidienne 03h10 |
| `pg_dump` (`scripts/backup-pg.sh`) | base PostgreSQL brute | `/opt/campus-pg-backups` sur le VPS App | quotidienne 02h40 |

Les deux sont indépendants. Le `.cmbak` se restaure depuis l'application ; le `pg_dump`
se restaure au niveau base, même si l'application ne démarre plus.

## ⚠ La clé conditionne tout

Les archives sont chiffrées avec `DATA_KEY` (variable du fichier `.env`). **Une archive
sans sa clé est un fichier mort.** Si la clé n'existe que sur le serveur sauvegardé,
la copie externe ne sert à rien le jour où ce serveur brûle.

**À faire une fois, hors serveur** : copier la valeur de `DATA_KEY` dans un gestionnaire
de mots de passe. C'est la seule action de cette page qui ne peut pas être automatisée.

## Cas 1 — Une erreur de saisie, l'application tourne

1. Écran **Sauvegardes** → choisir l'archive → **Restaurer**.
2. Lire l'aperçu : il annonce, collection par collection, ce qui serait **supprimé**.
3. Confirmer. L'état courant est archivé d'abord (`…-avant-restauration.cmbak`), et
   la mémoire de l'application est rechargée — aucun redémarrage nécessaire.

## Cas 2 — La machine est perdue

1. Nouveau serveur, Docker, dépôt cloné, `.env` reconstitué **avec la même `DATA_KEY`**.
2. PostgreSQL : `docker run -d --name campus-pg … postgres:16-alpine`, réseau `campus-net`.
3. Lancer l'application : elle crée le schéma vide.
4. Écran **Sauvegardes** → **Restaurer depuis un fichier** → l'archive récupérée hors site.
5. Vérifier : effectifs par collection dans l'aperçu, puis un contrôle métier
   (une ouverture connue, son nombre de tâches).

## Cas 3 — La base est corrompue, l'application ne démarre plus

```bash
gunzip -c /opt/campus-pg-backups/campus-<date>.sql.gz \
  | docker exec -i campus-pg psql -U postgres -d campus
```
Puis recréer le conteneur applicatif pour recharger la mémoire.

## Vérifications à faire sans attendre l'incident

- **Chaque matin, automatiquement** : fraîcheur de la dernière archive (seuil 36 h),
  relecture des 5 plus récentes, alerte email si quelque chose cloche — y compris si la
  sauvegarde a simplement cessé de tourner.
- **Bouton « Relire les archives »** : rouvre et vérifie les empreintes à la demande.
- **Une fois par trimestre** : restaurer réellement dans une base jetable.
  ```bash
  docker exec campus-pg psql -U postgres -c "CREATE DATABASE campus_e2e;"
  # puis restaurer l'archive dans campus_e2e et comparer les effectifs
  docker exec campus-pg psql -U postgres -c "DROP DATABASE campus_e2e;"
  ```
  Fait le 13 septembre 2026 : **53/53 collections conformes**, mémoire rechargée,
  et une écriture postérieure ne ressuscite pas l'ancien état.

## Ce que cette sauvegarde ne couvre pas

- **Perte de données jusqu'à 24 h** (sauvegarde quotidienne). Pour descendre à quelques
  minutes il faudrait l'archivage des WAL PostgreSQL — non mis en place.
- **Rétention côté serveur externe** : le dossier distant n'est pas purgé, il grossit.
- Les secrets (`.env`) et la configuration système ne sont pas dans l'archive.

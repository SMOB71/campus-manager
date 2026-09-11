#!/usr/bin/env bash
# Sauvegarde de la base PostgreSQL de Campus Manager.
#
# POURQUOI CE SCRIPT EXISTE — en basculant la persistance sur PostgreSQL, les
# sauvegardes en place sont devenues AVEUGLES : elles copiaient data/db.json,
# qui n'est plus ecrit. Sans ce script, l'application tournerait sans aucune
# sauvegarde des donnees vivantes, et personne ne s'en apercevrait avant d'en
# avoir besoin. C'est exactement la panne qu'on ne decouvre qu'au moment ou elle
# coute le plus cher.
#
# Deux principes :
#   - on VERIFIE la sauvegarde produite (une archive illisible n'est pas une
#     sauvegarde), et on refuse de tourner les anciennes tant que la nouvelle
#     n'est pas validee ;
#   - on ALERTE si la derniere sauvegarde valide date de plus d'un jour.
#
# Cron : 40 2 * * * /opt/assistant-campus/scripts/backup-pg.sh

set -uo pipefail

CONTENEUR=${CM_PG_CONTAINER:-campus-pg}
BASE=${CM_PG_DB:-campus}
UTILISATEUR=${CM_PG_USER:-postgres}
DEST=${CM_PG_BACKUP_DIR:-/opt/campus-pg-backups}
RETENTION=${CM_PG_RETENTION:-30}
TO="stephane.francese@ruliora.com"
FROM="noreply@ruliora.com"

log() { echo "$(date -Is) $*"; }
alerte() {
  log "ALERTE: $1"
  command -v sendmail >/dev/null 2>&1 || return 0
  sendmail -t <<MAIL
From: Campus Manager <$FROM>
To: $TO
Subject: [Campus Manager] $1

$2

--
$(hostname):$0
MAIL
}

mkdir -p "$DEST"
HORODATAGE=$(date +%F-%H%M)
FICHIER="$DEST/campus-$HORODATAGE.sql.gz"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEUR"; then
  alerte "base PostgreSQL introuvable" "Le conteneur $CONTENEUR ne tourne pas : aucune sauvegarde n'a pu etre prise."
  exit 1
fi

log "sauvegarde vers $FICHIER"
if ! docker exec "$CONTENEUR" pg_dump -U "$UTILISATEUR" -d "$BASE" --clean --if-exists | gzip > "$FICHIER"; then
  rm -f "$FICHIER"
  alerte "ECHEC de la sauvegarde PostgreSQL" "pg_dump a echoue. Aucune archive produite pour $HORODATAGE."
  exit 1
fi

# Une archive qu'on n'a pas relue n'est pas une sauvegarde. On verifie qu'elle
# se decompresse ET qu'elle contient bien du schema.
if ! gzip -t "$FICHIER" 2>/dev/null; then
  rm -f "$FICHIER"
  alerte "sauvegarde illisible" "L'archive produite ne passe pas le test d'integrite gzip. Elle a ete supprimee."
  exit 1
fi
LIGNES=$(gunzip -c "$FICHIER" | grep -c "CREATE TABLE" || true)
if [ "$LIGNES" -lt 10 ]; then
  rm -f "$FICHIER"
  alerte "sauvegarde suspecte" "Seulement $LIGNES tables dans le dump : archive ecartee plutot que conservee comme fausse assurance."
  exit 1
fi

TAILLE=$(du -h "$FICHIER" | cut -f1)
log "OK — $TAILLE, $LIGNES tables"

# Rotation : seulement APRES validation de la nouvelle.
find "$DEST" -name "campus-*.sql.gz" -type f -mtime +"$RETENTION" -delete

# Copie hors-volume, si un chemin est fourni (cle USB, autre disque, distant).
if [ -n "${CM_PG_OFFSITE:-}" ]; then
  cp "$FICHIER" "$CM_PG_OFFSITE/" 2>/dev/null && log "copie hors-volume : $CM_PG_OFFSITE" \
    || alerte "copie hors-volume impossible" "Destination : $CM_PG_OFFSITE"
fi

# Filet : si la derniere sauvegarde valide est trop vieille, c'est que ce script
# ne tourne plus. On le dit.
RECENTE=$(find "$DEST" -name "campus-*.sql.gz" -mtime -1 | wc -l)
[ "$RECENTE" -eq 0 ] && alerte "aucune sauvegarde recente" "Aucune archive de moins de 24 h dans $DEST."

log "termine"

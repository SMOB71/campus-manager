#!/bin/sh
# Sauvegarde HORS-VOLUME du store chiffré de Campus Manager.
# Le db.json est chiffré au repos (AES-256-GCM) → copier le ciphertext hors du volume
# de l'app est sûr. Objectif : survivre à la perte / recréation du volume Docker de l'app
# (docker rm, wipe du dossier data). Pour la reprise après perte de l'HÔTE, brancher en plus
# une copie off-site (rsync vers un autre VPS) — voir la note en bas.
set -eu

# PÉRIMÈTRE — ne PAS se limiter à db.json : les feuilles d'émargement
# (attendance.json), les signatures manuscrites et les pièces de la GED vivent
# dans des fichiers séparés. Les omettre revenait à ne pas sauvegarder les PREUVES
# DE RÉALISATION de l'action de formation, c'est-à-dire ce qui vaut de l'argent en
# contrôle financeur et ce qu'exige Qualiopi.
DATA_DIR="${DATA_DIR:-/opt/assistant-campus/data}"
DST="${DST:-/opt/backups/campus-manager}"       # hors du volume de l'application
RETENTION_DAYS="${RETENTION_DAYS:-30}"

[ -d "$DATA_DIR" ] || { echo "[backup] dossier de données absent: $DATA_DIR"; exit 0; }
mkdir -p "$DST"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DST/campus-$STAMP.tar.gz"

# Tout est déjà chiffré au repos (AES-256-GCM) : l'archive peut sortir du volume.
tar -czf "$ARCHIVE" -C "$DATA_DIR" \
  $( [ -f "$DATA_DIR/db.json" ] && echo db.json ) \
  $( [ -f "$DATA_DIR/sessions.json" ] && echo sessions.json ) \
  $( [ -f "$DATA_DIR/attendance.json" ] && echo attendance.json ) \
  $( [ -d "$DATA_DIR/signatures" ] && echo signatures ) \
  $( [ -d "$DATA_DIR/docs" ] && echo docs ) 2>/dev/null

# Contrôle immédiat : une archive qu'on ne sait pas relire n'est pas une sauvegarde.
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  echo "[backup] ÉCHEC — archive illisible, elle est supprimée: $ARCHIVE"
  rm -f "$ARCHIVE"
  exit 1
fi

find "$DST" -name 'campus-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
find "$DST" -name 'db-*.json' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true   # ancien format
echo "[backup] OK -> $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1), $(ls "$DST"/campus-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') copies)"

# Off-site (optionnel) : décommenter et configurer une clé SSH App->Data (WireGuard 10.10.0.1).
# rsync -az --delete "$DST/" root@10.10.0.1:/opt/backups/campus-manager/ 2>/dev/null || true

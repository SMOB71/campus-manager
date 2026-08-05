#!/bin/sh
# Sauvegarde HORS-VOLUME du store chiffré de Campus Manager.
# Le db.json est chiffré au repos (AES-256-GCM) → copier le ciphertext hors du volume
# de l'app est sûr. Objectif : survivre à la perte / recréation du volume Docker de l'app
# (docker rm, wipe du dossier data). Pour la reprise après perte de l'HÔTE, brancher en plus
# une copie off-site (rsync vers un autre VPS) — voir la note en bas.
set -eu

SRC="${SRC:-/opt/assistant-campus/data/db.json}"
DST="${DST:-/opt/backups/campus-manager}"       # hors du volume /opt/assistant-campus/data
RETENTION_DAYS="${RETENTION_DAYS:-30}"

[ -f "$SRC" ] || { echo "[backup] source absente: $SRC"; exit 0; }
mkdir -p "$DST"
cp "$SRC" "$DST/db-$(date +%Y%m%d-%H%M%S).json"
# rétention temporelle
find "$DST" -name 'db-*.json' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
echo "[backup] OK -> $DST ($(ls "$DST" | wc -l | tr -d ' ') copies)"

# Off-site (optionnel) : décommenter et configurer une clé SSH App->Data (WireGuard 10.10.0.1).
# rsync -az --delete "$DST/" root@10.10.0.1:/opt/backups/campus-manager/ 2>/dev/null || true

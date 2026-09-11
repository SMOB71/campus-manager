#!/usr/bin/env bash
# Lance les tests de la couche PostgreSQL contre une VRAIE base.
#
# Ils sont exclus du `npm test` par defaut : sans DATABASE_URL_TEST ils se
# signalent comme non executes plutot que de passer au vert sans rien verifier.
#
# ATTENTION sous Docker Desktop macOS : mesurer depuis l'hote traverse le
# passe-plat reseau de la VM, qui s'effondre (79 s pour un count(*) que la base
# execute en 5 ms). Toute mesure de performance doit donc tourner DANS le reseau
# Docker, comme ici — sinon on mesure Docker Desktop, pas PostgreSQL.
set -euo pipefail
RESEAU=cm-net
BASE=cm-pg-test

docker network create "$RESEAU" >/dev/null 2>&1 || true
if ! docker ps --format '{{.Names}}' | grep -q "^${BASE}$"; then
  docker rm -f "$BASE" >/dev/null 2>&1 || true
  docker run -d --name "$BASE" --network "$RESEAU" \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=campus_test postgres:16-alpine >/dev/null
  echo "postgres de test demarre, attente…"
  for _ in $(seq 1 30); do docker exec "$BASE" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi

docker run --rm --network "$RESEAU" -v "$PWD":/app -w /app \
  -e DATABASE_URL_TEST="postgres://postgres:test@${BASE}:5432/campus_test" \
  node:20-alpine node --test test/db.test.mjs

echo
echo "Pour arreter la base de test : docker rm -f ${BASE}"

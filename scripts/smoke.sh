#!/usr/bin/env bash
# Smoke-test des endpoints clés après déploiement.
# Usage : BASE=https://assistant.iarbiter.fr EMAIL=... PW=... bash scripts/smoke.sh
set -u
BASE="${BASE:-https://assistant.iarbiter.fr}"
EMAIL="${EMAIL:?EMAIL requis}"; PW="${PW:?PW requis}"
J="$(mktemp)"; fail=0
code() { curl -s -o /dev/null -w "%{http_code}" -c "$J" -b "$J" "$@"; }
login=$(curl -s -o /dev/null -w "%{http_code}" -c "$J" -b "$J" -X POST "$BASE/api/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
[ "$login" = "200" ] && echo "✓ login" || { echo "✗ login ($login)"; exit 1; }
for ep in /api/me /api/stats /api/network /api/finance /api/finance/annual /api/performance \
          /api/notifications /api/campuses /api/actions /api/openings /api/scenarios \
          /api/documents /api/audit /api/backups /api/report /api/export/network; do
  c=$(code "$BASE$ep")
  if [ "$c" = "200" ]; then echo "✓ $ep"; else echo "✗ $ep ($c)"; fail=1; fi
done
rm -f "$J"
[ "$fail" = "0" ] && echo "== OK ==" || { echo "== ÉCHECS =="; exit 1; }

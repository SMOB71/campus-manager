#!/usr/bin/env bash
# Test d'intégration du CLOISONNEMENT : un directeur ne voit/modifie QUE ses campus,
# et les modules réseau (openings, scénarios, sauvegardes, rapport, audit) sont admin-only.
# Crée un compte directeur temporaire puis le supprime. Usage :
#   BASE=https://assistant.iarbiter.fr EMAIL=admin@x PW='...' bash scripts/security-check.sh
set -u
BASE="${BASE:-https://assistant.iarbiter.fr}"
EMAIL="${EMAIL:?EMAIL admin requis}"; PW="${PW:?PW admin requis}"
A="$(mktemp)"; D="$(mktemp)"; fail=0
say() { if [ "$1" = "$2" ]; then echo "✓ $3"; else echo "✗ $3 (attendu $2, obtenu $1)"; fail=1; fi; }
jq_len() { python3 -c "import sys,json;print(len(json.load(sys.stdin)))"; }

# --- Admin ---
la=$(curl -s -o /dev/null -w "%{http_code}" -c "$A" -b "$A" -X POST "$BASE/api/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
say "$la" 200 "login admin"
CAMPS=$(curl -s -c "$A" -b "$A" "$BASE/api/network")
C0=$(echo "$CAMPS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'])")
C1=$(echo "$CAMPS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[1]['id'] if len(d)>1 else d[0]['id'])")
N0=$(echo "$CAMPS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['name'])")

# --- Créer un directeur temporaire scopé au campus C1 ---
TS=$(python3 -c "import random;print(random.randint(10000,99999))")
DEMAIL="__sec_test_${TS}@example.test"
NEW=$(curl -s -c "$A" -b "$A" -X POST "$BASE/api/users" -H "Content-Type: application/json" \
  -d "{\"name\":\"Sec Test\",\"email\":\"$DEMAIL\",\"password\":\"Test1234!\",\"role\":\"directeur\",\"campusIds\":[\"$C1\"]}")
NUID=$(echo "$NEW" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")  # NB: 'UID' est readonly en bash
[ -n "$NUID" ] && echo "✓ directeur temp créé ($DEMAIL, scope=$C1)" || { echo "✗ création directeur"; echo "$NEW"; exit 1; }

# --- Directeur ---
ld=$(curl -s -o /dev/null -w "%{http_code}" -c "$D" -b "$D" -X POST "$BASE/api/login" -H "Content-Type: application/json" -d "{\"email\":\"$DEMAIL\",\"password\":\"Test1234!\"}")
say "$ld" 200 "login directeur"

# Ne voit qu'1 campus
nc=$(curl -s -c "$D" -b "$D" "$BASE/api/campuses" | jq_len)
say "$nc" 1 "campuses : le directeur ne voit qu'1 campus"
nf=$(curl -s -c "$D" -b "$D" "$BASE/api/finance" | jq_len)
say "$nf" 1 "finance : scopée à 1 campus"
nn=$(curl -s -c "$D" -b "$D" "$BASE/api/network" | jq_len)
say "$nn" 1 "network : scopé à 1 campus"

# Modules réseau => admin-only => 403 (GET)
for ep in /api/openings /api/scenarios /api/backups /api/report /api/audit /api/users; do
  c=$(curl -s -o /dev/null -w "%{http_code}" -c "$D" -b "$D" "$BASE$ep")
  say "$c" 403 "admin-only refusé : $ep"
done
# Synthèse CODIR = admin-only (route POST)
sc=$(curl -s -o /dev/null -w "%{http_code}" -c "$D" -b "$D" -X POST "$BASE/api/network/synthese" -H "Content-Type: application/json" -d '{}')
say "$sc" 403 "admin-only refusé (POST) : /api/network/synthese"
# /api/directors est ACCESSIBLE mais scopé (200 + 1 seul campus)
nd=$(curl -s -c "$D" -b "$D" "$BASE/api/directors" | jq_len)
say "$nd" 1 "directors : accessible mais scopé à 1 campus"

# Accès à un AUTRE campus (C0) interdit
qc=$(curl -s -o /dev/null -w "%{http_code}" -c "$D" -b "$D" "$BASE/api/campuses/$C0/qualiopi")
say "$qc" 403 "qualiopi d'un autre campus : 403"
cc=$(curl -s -o /dev/null -w "%{http_code}" -c "$D" -b "$D" -X POST "$BASE/api/campuses" -H "Content-Type: application/json" -d '{"name":"x"}')
say "$cc" 403 "création de campus refusée au directeur"

# --- Cleanup ---
dd=$(curl -s -o /dev/null -w "%{http_code}" -c "$A" -b "$A" -X DELETE "$BASE/api/users/$NUID")
say "$dd" 200 "suppression directeur temp"
rm -f "$A" "$D"
[ "$fail" = "0" ] && echo "== CLOISONNEMENT OK ==" || { echo "== FUITE DÉTECTÉE =="; exit 1; }

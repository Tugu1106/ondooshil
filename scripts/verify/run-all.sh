#!/usr/bin/env bash
#
# Runs every phase's verification suite against a running dev server.
#
#   npm run dev          # in another terminal
#   npm run verify
#
# WARNING: these scripts reset the database — queue, reveals, and everybody's PIN. They
# are for a development project only. Never point them at the office's live instance.
#
# Each suite assumes a clean slate, so the database is reset before each one rather than
# between assertions.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=${BASE:-http://localhost:3000}
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')

mkdir -p .verify-tmp

if ! curl -s -o /dev/null "$BASE/api/health"; then
  echo "No dev server on $BASE — start one with 'npm run dev' first."
  exit 1
fi

reset() {
  # player_state first: current_item is a foreign key into queue, so the broadcast has to
  # be cleared before the rows it points at can go.
  curl -s -X PATCH "$SB_URL/rest/v1/player_state?id=eq.1" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
    -H 'content-type: application/json' -H 'Prefer: return=minimal' \
    -d '{"current_item":null,"started_at":null}'
  for path in "reveals?day=not.is.null" "queue?id=not.is.null"; do
    curl -s -X DELETE "$SB_URL/rest/v1/$path" \
      -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -H 'Prefer: return=minimal'
  done
  curl -s -X PATCH "$SB_URL/rest/v1/users?id=not.is.null" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
    -H 'content-type: application/json' -H 'Prefer: return=minimal' \
    -d '{"pin_hash":null,"failed_attempts":0,"locked_until":null}'
}

SUITES=(auth-test queue-test timeline-test player-test ownership-test reveal-test sync-static audit)
total_pass=0
total_fail=0

for suite in "${SUITES[@]}"; do
  reset
  output=$(bash "scripts/verify/$suite.sh" 2>&1)
  p=$(grep -c 'PASS' <<<"$output")
  f=$(grep -c 'FAIL' <<<"$output")
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + f))
  printf '%-16s passed %3d   failed %d\n' "$suite" "$p" "$f"
  [ "$f" -gt 0 ] && grep 'FAIL' <<<"$output" | sed 's/^/      /'
done

reset
echo "----------------------------------------"
printf 'TOTAL            passed %3d   failed %d\n' "$total_pass" "$total_fail"
[ "$total_fail" -eq 0 ]

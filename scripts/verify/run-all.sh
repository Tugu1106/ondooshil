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
. "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=${BASE:-http://localhost:3000}
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')

mkdir -p .verify-tmp

if ! curl -s -o /dev/null "$BASE/api/health"; then
  echo "No dev server on $BASE — start one with 'npm run dev' first."
  exit 1
fi

queue_count() {
  curl -s "$SB_URL/rest/v1/queue?select=id" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" |
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))"
}

reset() {
  # Retried, because anything polling /api/state cold-starts the station the instant the
  # broadcast is cleared — and player_state.current_item is a foreign key into queue, so
  # that makes the delete fail. An open browser tab is enough to lose this race.
  for _ in 1 2 3 4 5; do
    curl -s -X PATCH "$SB_URL/rest/v1/player_state?id=eq.1" \
      -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
      -H 'content-type: application/json' -H 'Prefer: return=minimal' \
      -d '{"current_item":null,"started_at":null}'
    for path in "reveals?day=not.is.null" "queue?id=not.is.null"; do
      curl -s -X DELETE "$SB_URL/rest/v1/$path" \
        -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -H 'Prefer: return=minimal'
    done
    [ "$(queue_count)" = "0" ] && break
  done

  curl -s -X PATCH "$SB_URL/rest/v1/users?id=not.is.null" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
    -H 'content-type: application/json' -H 'Prefer: return=minimal' \
    -d '{"pin_hash":null,"failed_attempts":0,"locked_until":null}'

  if [ "$(queue_count)" != "0" ]; then
    echo
    echo "Could not clear the queue after five attempts."
    echo "Something is polling /api/state and restarting the station underneath this suite."
    echo "Close any browser tab open on $BASE and run it again."
    exit 1
  fi
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

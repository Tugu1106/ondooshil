#!/usr/bin/env bash
# Phase 7: three reveals a day, private, and free the second time on the same song.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=http://localhost:3000
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3
ZOO=jNQXAC9IVRw; RICK=dQw4w9WgXcQ; QUEEN=fJ9rUzIMcZQ; GANGNAM=9bZkp7q19f0; PERU=1La4QzGeaaQ

SP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && pwd)"
A="$SP/jarA.txt"; B="$SP/jarB.txt"; S="$SP/state.json"; R="$SP/r.json"
rm -f "$A" "$B" "$S" "$R"
pass=0; fail=0

check() {
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}
sb() { curl -s -X "$1" "$SB_URL/rest/v1/$2" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
  -H 'content-type: application/json' -H 'Prefer: return=minimal' ${3:+-d "$3"}; }
poll() { curl -s -b "$1" "$BASE/api/state" > "$S"; }
jq_() { node -e "const s=require('$S');const v=(function(){ $1 })();console.log(v===undefined||v===null?'':v);"; }
addsong() { curl -s -o /dev/null -b "$1" -H 'content-type: application/json' -d "{\"url\":\"https://youtu.be/$2\",\"showName\":${3:-false}}" -X POST "$BASE/api/queue"; }
reveal() { curl -s -o "$R" -w '%{http_code}' -b "$1" -X POST "$BASE/api/reveal/$2"; }
rname() { node -e "const r=require('$R'); console.log(r.name ?? '')"; }
rleft() { node -e "const r=require('$R'); console.log(r.revealsRemaining ?? '')"; }

echo
echo "=== setup: User 2 queues five anonymous songs, User 3 watches ==="
sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}' >/dev/null
sb DELETE "reveals?day=not.is.null" >/dev/null
sb DELETE "queue?id=not.is.null" >/dev/null
sb PATCH "users?id=not.is.null" '{"pin_hash":null,"failed_attempts":0,"locked_until":null}' >/dev/null
curl -s -o /dev/null -c "$A" -H 'content-type: application/json' -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$B" -H 'content-type: application/json' -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"
for v in "$RICK" "$ZOO" "$QUEEN" "$GANGNAM" "$PERU"; do addsong "$A" "$v"; done
addsong "$B" "$ZOO" true    # User 3's own, name shown

poll "$B"
check "User 3 starts with three reveals" 3 "$(jq_ 'return s.me.revealsRemaining')"
check "User 2's songs are all anonymous to them" 0 "$(grep -o 'User 2' "$S" | wc -l | tr -d ' ')"
ID1=$(jq_ 'return s.upNext.filter(r=>r.addedByName===null)[0].id')
ID2=$(jq_ 'return s.upNext.filter(r=>r.addedByName===null)[1].id')
ID3=$(jq_ 'return s.upNext.filter(r=>r.addedByName===null)[2].id')
ID4=$(jq_ 'return s.upNext.filter(r=>r.addedByName===null)[3].id')

echo
echo "=== 1. Spending a ticket ==="
code=$(reveal "$B" "$ID1")
check "→ 200" 200 "$code"
check "it names the adder" "User 2" "$(rname)"
check "two left" 2 "$(rleft)"
poll "$B"
check "the state agrees" 2 "$(jq_ 'return s.me.revealsRemaining')"
check "that row now shows the name" "User 2" "$(jq_ "return (s.upNext.find(r=>r.id==='$ID1')||{}).addedByName")"
check "and is flagged revealed" "true" "$(jq_ "return (s.upNext.find(r=>r.id==='$ID1')||{}).revealed")"
check "the other rows are still anonymous" "" "$(jq_ "return (s.upNext.find(r=>r.id==='$ID2')||{}).addedByName")"

echo
echo "=== 2. Revealing the same song again is free ==="
code=$(reveal "$B" "$ID1")
check "→ 200" 200 "$code"
check "still two left, not one" 2 "$(rleft)"
poll "$B"
check "the budget did not move" 2 "$(jq_ 'return s.me.revealsRemaining')"

echo
echo "=== 3. The budget runs out at three ==="
reveal "$B" "$ID2" >/dev/null; check "second reveal leaves one" 1 "$(rleft)"
reveal "$B" "$ID3" >/dev/null; check "third reveal leaves none" 0 "$(rleft)"
code=$(reveal "$B" "$ID4")
check "the fourth is refused with 429" 429 "$code"
poll "$B"
check "the fourth song is still anonymous" "" "$(jq_ "return (s.upNext.find(r=>r.id==='$ID4')||{}).addedByName")"
check "no reveals left" 0 "$(jq_ 'return s.me.revealsRemaining')"

echo
echo "=== 4. A repeat is still free once the budget is gone ==="
# The check order matters: an already-revealed song must be answered before the budget is
# consulted, or a repeat looks like a fourth reveal.
code=$(reveal "$B" "$ID1")
check "→ 200, not 429" 200 "$code"
check "it still names the adder" "User 2" "$(rname)"

echo
echo "=== 5. Reveals are private to the spender ==="
poll "$A"
check "User 2's own budget is untouched" 3 "$(jq_ 'return s.me.revealsRemaining')"
# `revealed` describes only the viewer's own spending, so User 2 — who has spent nothing —
# must see it false everywhere, however many tickets User 3 has burned.
check "no row hints that anyone revealed anything" "yes" "$(jq_ '
return [...s.upNext, ...s.playedToday].every(r => r.revealed === false) ? "yes" : "no"')"
check "no field names a revealer" 0 "$(grep -oiE '"reveale[dr]By"|"revealedBy"|"revealCount"' "$S" | wc -l | tr -d ' ')"
# User 3 appears exactly once, on the song they deliberately opted in to show. Every other
# row of theirs stays hidden — one person's showName must not unmask their other songs.
check "User 3 shows only on the song they opted in to" 1 "$(jq_ '
return [...s.upNext, ...s.playedToday].filter(r => r.addedByName === "User 3").length')"
check "and User 3's uuid is nowhere" 0 "$(grep -o "$U3" "$S" | wc -l | tr -d ' ')"
# A third person must not inherit User 3's reveals.
sb DELETE "reveals?user_id=eq.$U3&queue_item_id=eq.$ID2" >/dev/null
poll "$B"
check "revoking one reveal re-hides that row" "" "$(jq_ "return (s.upNext.find(r=>r.id==='$ID2')||{}).addedByName")"

echo
echo "=== 6. Free cases never cost a ticket ==="
sb DELETE "reveals?day=not.is.null" >/dev/null
OWN=$(curl -s -b "$B" "$BASE/api/state" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log((s.upNext.find(r=>r.isMine)||{}).id ?? '')})")
code=$(reveal "$B" "$OWN")
check "revealing your own song is free" 200 "$code"
check "budget stays at three" 3 "$(rleft)"
SHOWN=$(curl -s -b "$A" "$BASE/api/state" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log((s.upNext.find(r=>!r.isMine && r.addedByName)||{}).id ?? '')})")
if [ -n "$SHOWN" ]; then
  code=$(reveal "$A" "$SHOWN")
  check "revealing an opted-in name is free" 200 "$code"
  check "budget stays at three" 3 "$(rleft)"
fi

echo
echo "=== 7. Guards ==="
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/reveal/$ID1")
check "unauthenticated → 401" 401 "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$B" -X POST "$BASE/api/reveal/00000000-0000-0000-0000-000000000000")
check "unknown song → 404" 404 "$code"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
[ "$fail" -eq 0 ]

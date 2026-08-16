#!/usr/bin/env bash
# Phase 6: remove and skip are adder-only, enforced on the server, and skips are silent.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=http://localhost:3000
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3
ZOO=jNQXAC9IVRw
RICK=dQw4w9WgXcQ

SP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && mkdir -p . && pwd -W 2>/dev/null || pwd)"
A="$SP/jarA.txt"; B="$SP/jarB.txt"; S="$SP/state.json"; H="$SP/page.html"
rm -f "$A" "$B" "$S" "$H"
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

echo
echo "=== setup ==="
sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}' >/dev/null
sb DELETE "reveals?day=not.is.null" >/dev/null
sb DELETE "queue?id=not.is.null" >/dev/null
sb PATCH "users?id=not.is.null" '{"pin_hash":null,"failed_attempts":0,"locked_until":null}' >/dev/null
curl -s -o /dev/null -c "$A" -H 'content-type: application/json' -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$B" -H 'content-type: application/json' -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"

addsong "$A" "$RICK"; addsong "$A" "$ZOO"; addsong "$B" "$ZOO"; addsong "$B" "$RICK"
poll "$A"
PLAYING=$(jq_ 'return s.playing.queueItemId')
check "the station is on air" "yes" "$([ -n "$PLAYING" ] && echo yes || echo no)"
check "three songs waiting" 3 "$(jq_ 'return s.upNext.length')"

MINE=$(jq_ 'return (s.upNext.find(r=>r.isMine)||{}).id')
THEIRS=$(jq_ 'return (s.upNext.find(r=>!r.isMine)||{}).id')

echo
echo "=== 1. Remove is adder-only, checked on the server ==="
check "the UI offers remove on my row" "true" "$(jq_ "return (s.upNext.find(r=>r.id==='$MINE')||{}).canRemove")"
check "and not on theirs" "false" "$(jq_ "return (s.upNext.find(r=>r.id==='$THEIRS')||{}).canRemove")"
# Called directly, bypassing the UI entirely — a hidden button is not a permission.
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -X DELETE "$BASE/api/queue/$THEIRS")
check "removing someone else's song → 403" 403 "$code"
poll "$A"
check "their song is still queued" "yes" "$(jq_ "return s.upNext.some(r=>r.id==='$THEIRS') ? 'yes':'no'")"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -X DELETE "$BASE/api/queue/$MINE")
check "removing my own song → 200" 200 "$code"
poll "$A"
check "it is gone from the queue" "no" "$(jq_ "return s.upNext.some(r=>r.id==='$MINE') ? 'yes':'no'")"
check "and it did not land in the history" "no" "$(jq_ "return s.playedToday.some(r=>r.id==='$MINE') ? 'yes':'no'")"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/queue/$THEIRS")
check "unauthenticated remove → 401" 401 "$code"

echo
echo "=== 2. The song on air cannot be removed ==="
code=$(curl -s -o "$SP/r.json" -w '%{http_code}' -b "$A" -X DELETE "$BASE/api/queue/$PLAYING")
check "→ 409, not a foreign-key crash" 409 "$code"
check "code is on_air" "on_air" "$(node -e "console.log(require('$SP/r.json').error.code)")"
check "it points at skip instead" "yes" "$(node -e "console.log(/[Ss]kip/.test(require('$SP/r.json').error.message)?'yes':'no')")"

echo
echo "=== 3. Skip is adder-only ==="
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$B" -X POST "$BASE/api/queue/$PLAYING/skip")
check "someone else skipping my song → 403" 403 "$code"
poll "$A"
check "the song is still on air" "$PLAYING" "$(jq_ 'return s.playing.queueItemId')"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -X POST "$BASE/api/queue/$THEIRS/skip")
check "skipping a song that is not on air → 409" 409 "$code"

echo
echo "=== 4. The adder skips their own song ==="
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -X POST "$BASE/api/queue/$PLAYING/skip")
check "→ 200" 200 "$code"
poll "$A"
check "the station moved on" "yes" "$([ "$(jq_ 'return s.playing.queueItemId')" != "$PLAYING" ] && echo yes || echo no)"
check "the skipped song is marked skipped, not played" "skipped" "$(jq_ "
const r=s.playedToday.find(r=>r.id==='$PLAYING'); return r && r.status")"
check "the next song started at now(), not chained" "yes" "$(jq_ '
const d=Math.abs(new Date(s.playing.startedAt)-new Date(s.serverTime))/1000;
return d < 3 ? "yes" : "no ("+d+"s)"')"

echo
echo "=== 5. The skip is SILENT ==="
# Viewed by the other person: the skipped song was anonymous, and nothing may hint that
# its adder is the one who skipped it.
poll "$B"
check "the skipped row shows no name" "" "$(jq_ "
const r=s.playedToday.find(r=>r.id==='$PLAYING'); return r && r.addedByName")"
check "no 'skipped by' anywhere in the payload" 0 "$(grep -oi 'skipped.by' "$S" | wc -l | tr -d ' ')"
check "the skipper's name is absent entirely" 0 "$(grep -o 'User 2' "$S" | wc -l | tr -d ' ')"
check "the skipper's id is absent entirely" 0 "$(grep -o "$U2" "$S" | wc -l | tr -d ' ')"
check "no skippedBy field on any row" 0 "$(grep -oi 'skippedby' "$S" | wc -l | tr -d ' ')"
check "the row carries only the nine contract fields" "id,videoId,title,durationSec,status,addedByName,isMine,canRemove,revealed" "$(jq_ 'return Object.keys(s.playedToday[0]).join(",")')"

curl -s -b "$B" "$BASE/" > "$H"
check "no 'skipped by' in the rendered page" 0 "$(grep -oi 'skipped by' "$H" | wc -l | tr -d ' ')"
# Comments are stripped: several files *document* that "skipped by X" must never appear,
# and that prose must not be mistaken for the thing it forbids.
check "no 'skipped by' in any shipped code or string" 0 "$(node -e "
const fs=require('fs'), path=require('path');
let hits=0;
const walk=(dir)=>{ for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory()) walk(p);
  else if(/\.(ts|tsx|css)\$/.test(e.name)){
    const code=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
    if(/skipped\s+by/i.test(code)){ hits++; console.error('  hit:',p); }
  }}};
for(const d of ['components','lib','app']) walk(d);
console.log(hits)")"

echo
echo "=== 6. A played song can no longer be removed ==="
DONE_ID=$PLAYING
code=$(curl -s -o "$SP/r.json" -w '%{http_code}' -b "$A" -X DELETE "$BASE/api/queue/$DONE_ID")
check "→ 409" 409 "$code"
check "code is not_pending" "not_pending" "$(node -e "console.log(require('$SP/r.json').error.code)")"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
[ "$fail" -eq 0 ]

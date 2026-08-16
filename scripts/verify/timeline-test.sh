#!/usr/bin/env bash
# Phase 3 exit check: the timeline running for real, against the live database.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=http://localhost:3000
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3
ZOO=jNQXAC9IVRw   # 19 seconds

# Node here is a Windows binary and cannot resolve Git Bash's /tmp paths, so the state
# file has to live somewhere both can see.
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && pwd)"
J="$SP/jar.txt"; J2="$SP/jar2.txt"; S="$SP/state.json"
rm -f "$J" "$J2" "$S"
pass=0; fail=0

check() {
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

sb() { # sb <method> <path> [json]
  curl -s -X "$1" "$SB_URL/rest/v1/$2" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
    -H 'content-type: application/json' -H 'Prefer: return=minimal' \
    ${3:+-d "$3"}
}

poll() { curl -s -b "$J" "$BASE/api/state" > "$S"; }
jq_() { node -e "
const s=require('$S');
const v=(function(){ $1 })();
console.log(v===undefined||v===null?'':v);
"; }

echo
echo "=== setup ==="
# Order matters: player_state.current_item is a foreign key into queue, so the broadcast
# has to be cleared before the rows it points at can go.
err=$(sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}')
[ -n "$err" ] && echo "    player_state clear said: $err"
err=$(sb DELETE "reveals?day=not.is.null"); [ -n "$err" ] && echo "    reveals delete said: $err"
err=$(sb DELETE "queue?id=not.is.null"); [ -n "$err" ] && echo "    queue delete said: $err"
sb PATCH "users?id=not.is.null" '{"pin_hash":null,"failed_attempts":0,"locked_until":null}' >/dev/null
curl -s -o /dev/null -c "$J" -H 'content-type: application/json' \
  -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$J2" -H 'content-type: application/json' \
  -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"
for i in 1 2 3; do
  curl -s -o /dev/null -b "$J" -H 'content-type: application/json' \
    -d "{\"url\":\"https://youtu.be/$ZOO\",\"showName\":false}" -X POST "$BASE/api/queue"
done
# Checked through the database, not /api/state: polling that endpoint is itself what
# cold-starts the station, so "queued but silent" is unobservable through it.
check "three songs pending in the database" 3 "$(curl -s "$SB_URL/rest/v1/queue?status=eq.pending&select=id" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")"
check "the broadcast is silent before anyone polls" "" "$(curl -s "$SB_URL/rest/v1/player_state?id=eq.1&select=current_item" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].current_item ?? ''))")"

echo
echo "=== 1. Cold start from silence ==="
poll
ID1=$(jq_ 'return s.playing && s.playing.queueItemId')
START1=$(jq_ 'return s.playing && s.playing.startedAt')
check "a song is now playing" "yes" "$([ -n "$ID1" ] && echo yes || echo no)"
check "started within a second of now" "yes" "$(jq_ '
const d=Math.abs(new Date(s.playing.startedAt)-new Date(s.serverTime))/1000;
return d < 2 ? "yes" : "no ("+d+"s)"')"
check "the playing song left up next" 2 "$(jq_ 'return s.upNext.length')"
check "playing is not duplicated into up next" "yes" "$(jq_ '
return s.upNext.some(r=>r.id===s.playing.queueItemId) ? "no" : "yes"')"
check "adder may skip their own song" "true" "$(jq_ 'return s.playing.canSkip')"
check "adder sees their own name" "User 2" "$(jq_ 'return s.playing.addedByName')"
check "duration came from YouTube" 19 "$(jq_ 'return s.playing.durationSec')"
# Same moment, different viewer: the anonymity rule must hold on the playing song too.
curl -s -b "$J2" "$BASE/api/state" > "$S"
check "another viewer sees no name on the playing song" "" "$(jq_ 'return s.playing.addedByName')"
check "another viewer may not skip it" "false" "$(jq_ 'return s.playing.canSkip')"
check "the adder's id is nowhere in that payload" "yes" "$(node -e "
const raw=require('fs').readFileSync('$S','utf8');
console.log(raw.includes('$U2')||raw.includes('User 2')?'no':'yes')")"
curl -s -b "$J" "$BASE/api/state" > "$S"

echo
echo "=== 2. Still playing: repeated polls change nothing ==="
sleep 2; poll
check "same song after 2s" "$ID1" "$(jq_ 'return s.playing.queueItemId')"
check "start time unchanged" "$START1" "$(jq_ 'return s.playing.startedAt')"

echo
echo "=== 3. Real transition after 19s — does it accumulate? ==="
echo "    (waiting out the song)"
sleep 19; poll
ID2=$(jq_ 'return s.playing && s.playing.queueItemId')
START2=$(jq_ 'return s.playing && s.playing.startedAt')
check "advanced to a different song" "yes" "$([ "$ID2" != "$ID1" ] && [ -n "$ID2" ] && echo yes || echo no)"
DELTA=$(node -e "console.log((new Date('$START2')-new Date('$START1'))/1000)")
check "new start is EXACTLY previous + 19s, not now()" 19 "$DELTA"
check "the finished song is in played today" "played" "$(jq_ "
const r=s.playedToday.find(r=>r.id==='$ID1'); return r && r.status")"
check "only one song consumed" 1 "$(jq_ 'return s.playedToday.length')"

echo
echo "=== 4. The lunch break: an hour of nobody polling ==="
LUNCH=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)
sb PATCH "player_state?id=eq.1" "{\"started_at\":\"$LUNCH\"}" >/dev/null
poll
ID3=$(jq_ 'return s.playing && s.playing.queueItemId')
check "a song is playing again" "yes" "$([ -n "$ID3" ] && echo yes || echo no)"
check "it is the third song, not the second" "yes" "$([ "$ID3" != "$ID2" ] && [ "$ID3" != "$ID1" ] && echo yes || echo no)"
check "cold-started at now(), not chained" "yes" "$(jq_ '
const d=Math.abs(new Date(s.playing.startedAt)-new Date(s.serverTime))/1000;
return d < 2 ? "yes" : "no ("+d+"s)"')"
check "exactly ONE more song was burned, not the queue" 2 "$(jq_ 'return s.playedToday.length')"
check "nothing left waiting" 0 "$(jq_ 'return s.upNext.length')"

echo
echo "=== 5. Empty queue goes silent ==="
sb PATCH "player_state?id=eq.1" "{\"started_at\":\"$LUNCH\"}" >/dev/null
poll
check "silence, not a repeat or a filler track" "" "$(jq_ 'return s.playing')"
check "all three songs are in the history" 3 "$(jq_ 'return s.playedToday.length')"
check "player_state cleared" "" "$(curl -s "$SB_URL/rest/v1/player_state?id=eq.1&select=current_item" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].current_item ?? ''))")"

echo
echo "=== 6. Adding a song after silence cold-starts it ==="
curl -s -o /dev/null -b "$J" -H 'content-type: application/json' \
  -d "{\"url\":\"https://youtu.be/$ZOO\",\"showName\":true}" -X POST "$BASE/api/queue"
poll
check "the new song started" "yes" "$(jq_ 'return s.playing ? "yes" : "no"')"
check "started at now()" "yes" "$(jq_ '
const d=Math.abs(new Date(s.playing.startedAt)-new Date(s.serverTime))/1000;
return d < 2 ? "yes" : "no"')"
check "show-my-name is honoured while playing" "User 2" "$(jq_ 'return s.playing.addedByName')"

echo
echo "=== 7. Concurrent polls advance the song exactly once ==="
curl -s -o /dev/null -b "$J" -H 'content-type: application/json' \
  -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"
curl -s -o /dev/null -b "$J" -H 'content-type: application/json' \
  -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"
poll
BEFORE=$(jq_ 'return s.playedToday.length')
# Make the current song overdue and immediately let six clients race to advance it.
sb PATCH "player_state?id=eq.1" "{\"started_at\":\"$LUNCH\"}" >/dev/null
for i in 1 2 3 4 5 6; do curl -s -b "$J" -o /dev/null "$BASE/api/state" & done; wait
poll
AFTER=$(jq_ 'return s.playedToday.length')
check "six simultaneous polls consumed exactly one song" 1 "$((AFTER - BEFORE))"
check "one of the two new songs is still waiting" 1 "$(jq_ 'return s.upNext.length')"
check "a song is still playing" "yes" "$(jq_ 'return s.playing ? "yes" : "no"')"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
rm -f "$J" "$S"
[ "$fail" -eq 0 ]

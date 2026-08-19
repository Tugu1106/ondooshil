#!/usr/bin/env bash
# Phase 4 check: onError recovery end to end, and the player's static invariants.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=http://localhost:3000
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3
ZOO=jNQXAC9IVRw

SP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && mkdir -p . && pwd -W 2>/dev/null || pwd)"
J="$SP/jar.txt"; J2="$SP/jar2.txt"; S="$SP/state.json"; H="$SP/page.html"
rm -f "$J" "$J2" "$S" "$H"
pass=0; fail=0

check() {
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

sb() {
  curl -s -X "$1" "$SB_URL/rest/v1/$2" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
    -H 'content-type: application/json' -H 'Prefer: return=representation' ${3:+-d "$3"}
}
poll() { curl -s -b "$J" "$BASE/api/state" > "$S"; }
jq_() { node -e "const s=require('$S');const v=(function(){ $1 })();console.log(v===undefined||v===null?'':v);"; }

echo
echo "=== setup ==="
sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}' >/dev/null
sb DELETE "reveals?day=not.is.null" >/dev/null
sb DELETE "queue?id=not.is.null" >/dev/null
sb PATCH "users?id=not.is.null" '{"pin_hash":null,"failed_attempts":0,"locked_until":null}' >/dev/null
curl -s -o /dev/null -c "$J" -H 'content-type: application/json' -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$J2" -H 'content-type: application/json' -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"

# A video that became unplayable after it was queued — inserted directly, because the add
# pipeline correctly refuses non-embeddable videos up front. This is the case spec §7 is
# about: it passed validation, then the player could not play it.
TODAY=$(curl -s "$BASE/api/health" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).today))")
sb POST "queue" "{\"video_id\":\"BADvideo123\",\"title\":\"Blocked upload\",\"duration_sec\":200,\"added_by\":\"$U2\",\"show_name\":false,\"day\":\"$TODAY\",\"status\":\"pending\"}" >/dev/null
sleep 1
curl -s -o /dev/null -b "$J" -H 'content-type: application/json' -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"

poll
BAD=$(jq_ 'return s.playing && s.playing.queueItemId')
check "the unplayable video is what is on air" "Blocked upload" "$(jq_ 'return s.playing.title')"
check "it exposes its video id to the player" "BADvideo123" "$(jq_ 'return s.playing.videoId')"

echo
echo "=== 1. onError recovery ==="
code=$(curl -s -o "$SP/r.json" -w '%{http_code}' -b "$J" -H 'content-type: application/json' \
  -d '{"videoId":"BADvideo123"}' -X POST "$BASE/api/queue/$BAD/failed")
check "report accepted" 200 "$code"
check "station advanced" "true" "$(node -e "console.log(require('$SP/r.json').advanced)")"
poll
check "moved on to the next song" "Me at the zoo" "$(jq_ 'return s.playing && s.playing.title')"
check "the bad video is marked failed, not played" "failed" "$(jq_ "
const r=s.playedToday.find(r=>r.videoId==='BADvideo123'); return r && r.status")"
check "it started at now(), not chained from the dead song" "yes" "$(jq_ '
const d=Math.abs(new Date(s.playing.startedAt)-new Date(s.serverTime))/1000;
return d < 3 ? "yes" : "no ("+d+"s)"')"
check "history shows it could not play" "yes" "$(jq_ "
const r=s.playedToday.find(r=>r.videoId==='BADvideo123'); return r.status==='failed' ? 'yes':'no'")"

echo
echo "=== 2. The report is guarded ==="
NOW=$(jq_ 'return s.playing.queueItemId')
code=$(curl -s -o "$SP/r.json" -w '%{http_code}' -b "$J" -H 'content-type: application/json' \
  -d '{"videoId":"BADvideo123"}' -X POST "$BASE/api/queue/$BAD/failed")
check "replaying an old report is a no-op" "false" "$(node -e "console.log(require('$SP/r.json').advanced)")"
code=$(curl -s -o "$SP/r.json" -w '%{http_code}' -b "$J" -H 'content-type: application/json' \
  -d '{"videoId":"wrongvideo1"}' -X POST "$BASE/api/queue/$NOW/failed")
check "a mismatched video id cannot kill the current song" "false" "$(node -e "console.log(require('$SP/r.json').advanced)")"
poll
check "so the current song is untouched" "$NOW" "$(jq_ 'return s.playing.queueItemId')"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  -d '{"videoId":"anything123"}' -X POST "$BASE/api/queue/$NOW/failed")
check "unauthenticated report rejected" 401 "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$J" -H 'content-type: application/json' \
  -d '{}' -X POST "$BASE/api/queue/$NOW/failed")
check "missing videoId rejected" 400 "$code"

echo
echo "=== 3. Two clients report the same broken video ==="
sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}' >/dev/null
sb DELETE "queue?id=not.is.null" >/dev/null
sb POST "queue" "{\"video_id\":\"BADvideo123\",\"title\":\"Blocked upload\",\"duration_sec\":200,\"added_by\":\"$U2\",\"show_name\":false,\"day\":\"$TODAY\",\"status\":\"pending\"}" >/dev/null
sleep 1
for i in 1 2; do curl -s -o /dev/null -b "$J" -H 'content-type: application/json' -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"; done
poll
BAD2=$(jq_ 'return s.playing.queueItemId')
for i in 1 2 3 4; do
  curl -s -o /dev/null -b "$J" -H 'content-type: application/json' \
    -d '{"videoId":"BADvideo123"}' -X POST "$BASE/api/queue/$BAD2/failed" &
done; wait
poll
check "four simultaneous reports skipped exactly one song" 1 "$(jq_ 'return s.playedToday.length')"
check "one song still waiting" 1 "$(jq_ 'return s.upNext.length')"

echo
echo "=== 4. Player invariants in the served page ==="
curl -s -b "$J" "$BASE/" > "$H"
# The button names the action rather than the state: it offers "Unmute" while muted and
# "Mute" once audible. "Mute" alone is a substring of "Unmute", so the audible check reads
# aria-pressed instead, which is unambiguous and does not depend on the wording.
check "the speaker toggle is present" "yes" "$(grep -qi 'mute' "$H" && echo yes || echo no)"
check "the page opens muted" "yes" "$(grep -q 'Unmute' "$H" && echo yes || echo no)"
check "and not already audible" "yes" "$(grep -q 'aria-pressed="true"' "$H" && echo no || echo yes)"
# The on-air block renders whether or not anything is playing, because the iframe lives
# inside it and must never be unmounted.
check "the on-air block is rendered server-side" "yes" "$(grep -qE 'On air|Off air' "$H" && echo yes || echo no)"
check "no display:none declaration in the player styles" "yes" "$(node -e "
// Strip comments first: the file *explains* why display:none is forbidden, and that
// prose must not be mistaken for a declaration.
const css=require('fs').readFileSync('components/Player.module.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
console.log(/display\s*:\s*none/.test(css) ? 'no' : 'yes')")"
check "the player mount is never conditionally rendered" "yes" "$(node -e "
const src=require('fs').readFileSync('components/YouTubePlayer.tsx','utf8');
const ret=src.slice(src.lastIndexOf('return ('));
console.log(/&&|\?/.test(ret.split('</div>')[0]) ? 'no' : 'yes')")"
check "songs change via loadVideoById, not a remount" "yes" "$(grep -q 'loadVideoById' components/YouTubePlayer.tsx && echo yes || echo no)"
check "change detection compares the queue item id" "yes" "$(grep -q 'loadedItemRef.current === playing.queueItemId' components/YouTubePlayer.tsx && echo yes || echo no)"
check "no raw Date.now() in playhead maths" "yes" "$(grep -q 'Date.now()' components/NowPlaying.tsx && echo no || echo yes)"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
[ "$fail" -eq 0 ]

#!/usr/bin/env bash
# Phase 5 static invariants — the properties a unit test cannot see and a browser check
# would not reliably catch either.
#
# Deliberately NOT guarded by _guard.sh: this suite only reads source files. It never
# touches the database, so it is safe to run against anything, at any time.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}
has() { grep -q "$2" "$1" && echo yes || echo no; }

echo
echo "=== Timers are cleaned up ==="
check "the 3s poll is cleared on unmount" "yes" "$(has lib/client/useStation.ts 'clearInterval(timer)')"
check "the scheduled transition is cleared" "yes" "$(has lib/client/useStation.ts 'clearTimeout(timer)')"
check "the drift interval is cleared" "yes" "$(has components/YouTubePlayer.tsx 'clearInterval(timer)')"
check "every setInterval/setTimeout has a matching clear" "yes" "$(node -e "
const fs=require('fs');
let ok=true;
for (const f of ['lib/client/useStation.ts','components/YouTubePlayer.tsx','components/NowPlaying.tsx']) {
  const src=fs.readFileSync(f,'utf8');
  const sets=(src.match(/set(Interval|Timeout)\(/g)||[]).length;
  const clears=(src.match(/clear(Interval|Timeout)\(/g)||[]).length;
  if (sets!==clears) { ok=false; console.error(f,sets,clears); }
}
console.log(ok?'yes':'no')")"

echo
echo "=== The drift loop can actually fire ==="
# The bug this guards: `playing` is a fresh object on every 3s poll, so an effect that
# depends on it restarts the 30s interval before it ever fires.
check "drift effect keys on the item id, not the playing object" "yes" "$(node -e "
const src=require('fs').readFileSync('components/YouTubePlayer.tsx','utf8');
const m=src.match(/DRIFT_CHECK_INTERVAL_MS\);[\s\S]*?\}, \[([^\]]*)\]/);
const deps=m?m[1]:'';
console.log(/playingId/.test(deps) && !/\bplaying\b(?!Id)/.test(deps) ? 'yes':'no')")"
check "transition timer keys on the item id too" "yes" "$(node -e "
const src=require('fs').readFileSync('lib/client/useStation.ts','utf8');
const m=src.match(/transitionDelayMs\([\s\S]*?\}, \[([^\]]*)\]/);
console.log(m && /playingId/.test(m[1]) ? 'yes':'no')")"

echo
echo "=== Local controls stay local ==="
check "ListenControls makes no network calls" "yes" "$(grep -qE 'fetch\(|axios|XMLHttpRequest' components/ListenControls.tsx && echo no || echo yes)"
check "the player makes no network calls of its own" "yes" "$(grep -qE '\bfetch\(' components/YouTubePlayer.tsx && echo no || echo yes)"
check "volume and mute are never in a request body" "yes" "$(grep -rqE '(volume|muted)' app/api/ && echo no || echo yes)"
check "no global pause/play/seek endpoint exists" "yes" "$(ls app/api/player 2>/dev/null | grep -q . && echo no || echo yes)"

echo
echo "=== Resume means re-sync ==="
check "a PLAYING state change triggers a drift check" "yes" "$(has components/YouTubePlayer.tsx 'PLAYER_STATE.PLAYING')"
check "re-sync reuses the same 2s tolerance, so it is not jarring" "yes" "$(has components/YouTubePlayer.tsx 'shouldSeek')"

echo
echo "=== Playhead maths never uses the raw clock ==="
# Comments are stripped first: these files *document* that Date.now() must not be used,
# and that prose must not be mistaken for a call.
code() { node -e "
const src=require('fs').readFileSync(process.argv[1],'utf8');
console.log(src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,''))" "$1"; }

check "no Date.now() call in the player" "yes" "$(code components/YouTubePlayer.tsx | grep -q 'Date.now()' && echo no || echo yes)"
check "no Date.now() call in now playing" "yes" "$(code components/NowPlaying.tsx | grep -q 'Date.now()' && echo no || echo yes)"
check "no Date.now() call in the controls" "yes" "$(code components/ListenControls.tsx | grep -q 'Date.now()' && echo no || echo yes)"
# Exactly three, all in useStation: seeding the offset, refining it from the first fetch,
# and serverNow() adding it back on. Any fourth would be a playhead bypassing the offset.
check "Date.now() confined to the three offset sites" 3 "$(code lib/client/useStation.ts | grep -c 'Date.now()')"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
[ "$fail" -eq 0 ]

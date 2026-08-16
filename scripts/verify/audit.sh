#!/usr/bin/env bash
# Phase 8 — the spec §16 landmine checklist, audited fresh against the code.
# Each item was a specific hard-to-diagnose bug during design.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BASE=http://localhost:3000
SB_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2 | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
SECRET=$(grep '^SESSION_SECRET=' .env.local | cut -d= -f2 | tr -d '\r')
YT_KEY=$(grep '^YOUTUBE_API_KEY=' .env.local | cut -d= -f2 | tr -d '\r')
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3
ZOO=jNQXAC9IVRw

SP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && pwd)"
A="$SP/jarA.txt"; B="$SP/jarB.txt"; S="$SP/state.json"
rm -f "$A" "$B" "$S"
pass=0; fail=0

check() {
  if [ "$2" = "$3" ]; then echo "     PASS  $1"; pass=$((pass+1));
  else echo "     FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}
sb() { curl -s -X "$1" "$SB_URL/rest/v1/$2" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" \
  -H 'content-type: application/json' -H 'Prefer: return=minimal' ${3:+-d "$3"}; }
poll() { curl -s -b "$1" "$BASE/api/state" > "$S"; }
jq_() { node -e "const s=require('$S');const v=(function(){ $1 })();console.log(v===undefined||v===null?'':v);"; }
# Source with comments and strings-in-comments removed, so prose describing a rule is
# never mistaken for a violation of it.
# Accepts files as well as directories. An earlier version assumed directories, crashed on
# a file argument, and emitted nothing — which made three "expect 0 matches" checks pass
# for the wrong reason. A check that passes because it crashed is worse than no check.
code() { node -e "
const fs=require('fs'),path=require('path');let out='';
const read=p=>{out+=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'')+'\n';};
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
  if(e.isDirectory())walk(p); else if(/\.(ts|tsx|css)\$/.test(e.name)) read(p);}};
for(const t of process.argv.slice(1)) fs.statSync(t).isDirectory() ? walk(t) : read(t);
if(!out.trim()) { console.error('code(): no source read from '+process.argv.slice(1).join(' ')); process.exit(9); }
console.log(out)" "$@"; }

echo
echo "  setup"
sb PATCH "player_state?id=eq.1" '{"current_item":null,"started_at":null}' >/dev/null
sb DELETE "reveals?day=not.is.null" >/dev/null
sb DELETE "queue?id=not.is.null" >/dev/null
sb PATCH "users?id=not.is.null" '{"pin_hash":null,"failed_attempts":0,"locked_until":null}' >/dev/null
curl -s -o /dev/null -c "$A" -H 'content-type: application/json' -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$B" -H 'content-type: application/json' -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -b "$A" -H 'content-type: application/json' -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"
curl -s -o /dev/null -b "$A" -H 'content-type: application/json' -d "{\"url\":\"https://youtu.be/$ZOO\"}" -X POST "$BASE/api/queue"

echo
echo "  1. /api/state returns serverTime; clients use offset-corrected time everywhere"
poll "$A"
check "serverTime present and parseable" "yes" "$(jq_ 'return !isNaN(new Date(s.serverTime).getTime()) ? "yes":"no"')"
check "Date.now() confined to the three offset sites" 3 "$(code lib/client | grep -c 'Date.now()')"
check "no raw clock in any component" 0 "$(code components | grep -c 'Date.now()')"

echo
echo "  2. Normal transitions use started_at + duration, never now()"
check "the accumulating branch adds duration to started_at" "yes" "$(grep -q 'startedAt.getTime() + item.duration_sec \* 1000' lib/timeline.ts && echo yes || echo no)"
check "unit tests cover it" "yes" "$(grep -qi 'not now()' tests/timeline.test.ts && echo yes || echo no)"

echo
echo "  3. Overshoot > 30s cold-starts instead of chaining"
check "threshold is 30s" 30 "$(node -e "const t=require('fs').readFileSync('lib/timeline.ts','utf8');console.log((t.match(/OVERSHOOT_COLD_START_SEC = (\d+)/)||[])[1])")"
check "comparison is overshoot < threshold" "yes" "$(grep -q 'overshootSec < OVERSHOOT_COLD_START_SEC' lib/timeline.ts && echo yes || echo no)"

echo
echo "  4. player_state updates are conditional on the expected current_item"
check "setCurrent takes an expected id" "yes" "$(grep -q 'expected: string | null' lib/timeline.ts && echo yes || echo no)"
check "null expectation uses IS NULL, not equality" "yes" "$(grep -q "is('current_item', null)" lib/timeline-repo.ts && echo yes || echo no)"
check "a lost race re-reads instead of retrying" "yes" "$(grep -q 'if (!won) return readCurrent(repo)' lib/timeline.ts && echo yes || echo no)"
check "no unconditional update of player_state exists" 0 "$(code lib | grep -c "from('player_state')[^;]*update([^)]*)[^;]*;" || true)"

echo
echo "  5. Clients detect changes by current_item id, not position"
check "the player compares queue item ids" "yes" "$(grep -q 'loadedItemRef.current === playing.queueItemId' components/YouTubePlayer.tsx && echo yes || echo no)"
check "both timers key on the id" "yes" "$(grep -q 'playingId' lib/client/useStation.ts && grep -q 'playingId' components/YouTubePlayer.tsx && echo yes || echo no)"

echo
echo "  6. onError marks failed and advances; never retries"
check "the endpoint exists" "yes" "$([ -f 'app/api/queue/[id]/failed/route.ts' ] && echo yes || echo no)"
check "status set to failed" "yes" "$(grep -q "status: 'failed'" lib/playback.ts && echo yes || echo no)"
check "no retry anywhere in the player" 0 "$(code components/YouTubePlayer.tsx | grep -ci 'retry' || true)"

echo
echo "  7. Live streams and videos over 10 minutes rejected at add time"
check "limit is 600 seconds" 600 "$(node -e "const t=require('fs').readFileSync('lib/youtube.ts','utf8');const m=t.match(/MAX_DURATION_SEC = ([^;]+);/);console.log(eval(m[1]))")"
code_long=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -H 'content-type: application/json' -d '{"url":"https://youtu.be/Gp7XG8Oys3I"}' -X POST "$BASE/api/queue")
check "a 166-minute video is refused" 422 "$code_long"
code_live=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -H 'content-type: application/json' -d '{"url":"https://youtu.be/X4VbdwhkE10"}' -X POST "$BASE/api/queue")
check "a live stream is refused" 422 "$code_live"
code_noembed=$(curl -s -o /dev/null -w '%{http_code}' -b "$A" -H 'content-type: application/json' -d '{"url":"https://youtu.be/_F8jLFfQ9C0"}' -X POST "$BASE/api/queue")
check "a non-embeddable video is refused" 422 "$code_noembed"

echo
echo "  8. Skips are silent"
check "no 'skipped by' in shipped code or strings" 0 "$(code components lib app | grep -ci 'skipped *by' || true)"
check "the skip response says nothing about who" "yes" "$(grep -q 'skipped: true' 'app/api/queue/[id]/skip/route.ts' && echo yes || echo no)"

echo
echo "  9. added_by never sent for un-revealed anonymous songs"
poll "$B"
check "no added_by field in the payload" 0 "$(grep -o 'added_by' "$S" | wc -l | tr -d ' ')"
check "no addedById field" 0 "$(grep -o 'addedById' "$S" | wc -l | tr -d ' ')"
check "no show_name field" 0 "$(grep -o 'show_name' "$S" | wc -l | tr -d ' ')"
check "the adder's uuid is absent" 0 "$(grep -o "$U2" "$S" | wc -l | tr -d ' ')"
check "the adder's name is absent" 0 "$(grep -o 'User 2' "$S" | wc -l | tr -d ' ')"
check "rows carry exactly the nine contract fields" "id,videoId,title,durationSec,status,addedByName,isMine,canRemove,revealed" "$(jq_ 'return Object.keys(s.upNext[0]).join(",")')"
check "serialisation is field-by-field, never a spread" 0 "$(code lib/serialize.ts | grep -c '\.\.\.item' || true)"

echo
echo "  10. Day filter applies to the queue list, not the current-item lookup"
check "loadQueueItem filters by id only" "yes" "$(node -e "
const t=require('fs').readFileSync('lib/timeline-repo.ts','utf8');
const fn=t.slice(t.indexOf('loadQueueItem'), t.indexOf('pickNext'));
console.log(/eq\('id', id\)/.test(fn) && !/eq\('day'/.test(fn) ? 'yes':'no')")"
check "pickNext does filter by day" "yes" "$(node -e "
const t=require('fs').readFileSync('lib/timeline-repo.ts','utf8');
const fn=t.slice(t.indexOf('async pickNext'), t.indexOf('markPlayed'));
console.log(/eq\('day', day\)/.test(fn) ? 'yes':'no')")"
check "a midnight-crossing song is unit tested" "yes" "$(grep -q 'finish after it' tests/timeline.test.ts && echo yes || echo no)"

echo
echo "  11. userId read from the session cookie only, never from a request body"
check "currentUser reads the session" "yes" "$(grep -q 'const session = await getSession' lib/auth.ts && echo yes || echo no)"
# Only the three auth-domain routes may read a userId from a body: claim and set-pin are
# the login step itself (worthless without the PIN), and reset-pin's body names the
# *target*, with the caller still coming from the session.
check "only the 3 auth routes read userId from a body" "auth/claim auth/set-pin owner/reset-pin" "$(node -e "
const fs=require('fs'),path=require('path');const hits=[];
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
  if(e.isDirectory())walk(p);
  else if(e.name==='route.ts'){const src=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
    if(/readString\(body, 'userId'\)/.test(src)) hits.push(p.replace(/\\\\/g,'/').replace('app/api/','').replace('/route.ts',''));}}};
walk('app/api');
console.log(hits.sort().join(' '))")"
check "reset-pin takes its caller from the session" "yes" "$(grep -q 'const caller = await currentUser()' app/owner/../api/owner/reset-pin/route.ts 2>/dev/null || grep -q 'const caller = await currentUser()' app/api/owner/reset-pin/route.ts && echo yes || echo no)"
code_forge=$(curl -s -o /dev/null -w '%{http_code}' -b "$B" -H 'content-type: application/json' -d "{\"userId\":\"$U2\"}" -X POST "$BASE/api/auth/continue")
check "continue ignores a body userId (still 200 as User 3)" 200 "$code_forge"

echo
echo "  12. PINs bcrypt-hashed, 5-attempt lockout in place"
check "cost factor 12" 12 "$(node -e "const t=require('fs').readFileSync('lib/auth.ts','utf8');console.log((t.match(/BCRYPT_COST = (\d+)/)||[])[1])")"
check "5 attempts, 15 minutes" "5 15" "$(node -e "const t=require('fs').readFileSync('lib/auth.ts','utf8');console.log((t.match(/MAX_FAILED_ATTEMPTS = (\d+)/)||[])[1], (t.match(/LOCKOUT_MINUTES = (\d+)/)||[])[1])")"
check "stored PINs are bcrypt hashes" "yes" "$(curl -s "$SB_URL/rest/v1/users?select=pin_hash&pin_hash=not.is.null" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log(r.length>0 && r.every(u=>/^\\\$2[aby]\\\$12\\\$/.test(u.pin_hash))?'yes':'no')})")"
check "no PIN is ever stored or logged in plaintext" 0 "$(code lib app | grep -cE "pin_hash: *pin\b|console\.log\(pin" || true)"

echo
echo "  13. The iframe stays mounted and visible"
check "no display:none declaration in player styles" 0 "$(code components/Player.module.css | grep -c 'display *: *none' || true)"
check "the mount is not conditionally rendered" "yes" "$(node -e "
const src=require('fs').readFileSync('components/YouTubePlayer.tsx','utf8');
const ret=src.slice(src.lastIndexOf('return ('));
console.log(/&&|\?/.test(ret.split('</div>')[0])?'no':'yes')")"
check "songs change via loadVideoById, not a remount" "yes" "$(grep -q 'loadVideoById' components/YouTubePlayer.tsx && echo yes || echo no)"

echo
echo "  14. Audio starts only after the user clicks Listen"
check "listening defaults to false" "yes" "$(grep -q 'useState(false)' components/SignedIn.tsx && echo yes || echo no)"
check "the load effect is gated on listening" "yes" "$(grep -q 'if (!player || !listening) return' components/YouTubePlayer.tsx && echo yes || echo no)"
check "the served page offers Listen, not Stop" "yes" "$(curl -s -b "$A" "$BASE/" | grep -q 'Stop listening' && echo no || echo yes)"

echo
echo "  15. All Supabase access server-side; no secret in a client bundle"
check "db.ts is server-only" "yes" "$(head -3 lib/db.ts | grep -q "import 'server-only'" && echo yes || echo no)"
# Comments stripped: lib/env.ts and .env.example both *forbid* the prefix in prose.
check "no NEXT_PUBLIC_ in shipped code" 0 "$(code lib app components | grep -c 'NEXT_PUBLIC_' || true)"
check "no NEXT_PUBLIC_ assignment in the env template" 0 "$(grep -c '^NEXT_PUBLIC_' .env.example || true)"
check "no supabase import in any client component" 0 "$(grep -rl 'supabase-js' components 2>/dev/null | wc -l | tr -d ' ')"
for name in "$SB_KEY" "$SECRET" "$YT_KEY"; do
  n=$(grep -rl "$name" .next/static 2>/dev/null | wc -l | tr -d ' ')
  check "secret starting $(echo "$name" | cut -c1-8)… absent from the client bundle" 0 "$n"
done
check "the Supabase host is absent from the client bundle" 0 "$(grep -rl 'supabase.co' .next/static 2>/dev/null | wc -l | tr -d ' ')"

echo
echo "  ============================================"
echo "     §16 audit — passed: $pass   failed: $fail"
echo "  ============================================"
[ "$fail" -eq 0 ]

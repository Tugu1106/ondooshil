#!/usr/bin/env bash
# Phase 2 exit-criteria check: URL parsing, validation rejections, round-robin, anonymity.
set -u

BASE=http://localhost:3000
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b   # User 2
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3   # User 3

RICK=dQw4w9WgXcQ        # 3:34, embeddable
ZOO=jNQXAC9IVRw         # 0:19
GANGNAM=9bZkp7q19f0     # 4:13
QUEEN=fJ9rUzIMcZQ       # 6:00
LONG=Gp7XG8Oys3I        # 166 minutes
LIVE=X4VbdwhkE10        # live lofi radio
NOEMBED=_F8jLFfQ9C0     # embeddable = false

SP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.verify-tmp" && mkdir -p . && pwd -W 2>/dev/null || pwd)"
SP_STATE="$SP_DIR/qstate.json"
A=$(mktemp); B=$(mktemp); OUT=$(mktemp)
pass=0; fail=0

check() {
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

add() { # add <jar> <url> [showName]
  local sn=${3:-false}
  curl -s -o "$OUT" -w '%{http_code}' -b "$1" -c "$1" -H 'content-type: application/json' \
    -d "{\"url\":$(printf '%s' "$2" | sed 's/.*/"&"/'),\"showName\":$sn}" -X POST "$BASE/api/queue"
}

state() { curl -s -b "$1" "$BASE/api/state"; }
field() { grep -o "\"$2\":\"[^\"]*\"" <<<"$1" | head -1 | cut -d'"' -f4; }

echo
echo "=== setup: two people sign in ==="
curl -s -o /dev/null -c "$A" -H 'content-type: application/json' \
  -d "{\"userId\":\"$U2\",\"pin\":\"2222\"}" -X POST "$BASE/api/auth/set-pin"
curl -s -o /dev/null -c "$B" -H 'content-type: application/json' \
  -d "{\"userId\":\"$U3\",\"pin\":\"3333\"}" -X POST "$BASE/api/auth/set-pin"
check "User 2 signed in" "User 2" "$(field "$(state "$A")" name)"
check "User 3 signed in" "User 3" "$(field "$(state "$B")" name)"

echo
echo "=== 1. All five URL forms plus a playlist link ==="
for u in \
  "https://www.youtube.com/watch?v=$RICK" \
  "https://youtu.be/$RICK" \
  "https://www.youtube.com/shorts/$RICK" \
  "https://www.youtube.com/embed/$RICK" \
  "https://m.youtube.com/watch?v=$RICK" \
  "https://www.youtube.com/watch?v=$RICK&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&index=7"
do
  code=$(add "$A" "$u")
  check "accepted: $(cut -c1-52 <<<"$u")" 200 "$code"
done
ids=$(state "$A" | grep -o '"videoId":"[^"]*"' | cut -d'"' -f4 | sort -u)
check "all six resolved to the same video id" "$RICK" "$ids"
check "six rows queued (duplicates allowed)" 6 "$(state "$A" | grep -o '"videoId"' | wc -l | tr -d ' ')"

echo
echo "=== 2. Each rejection has its own code and message ==="
code=$(add "$A" "https://www.youtube.com/watch?v=$LONG")
c1=$(grep -o '"code":"[^"]*"' "$OUT" | cut -d'"' -f4); m1=$(grep -o '"message":"[^"]*"' "$OUT" | cut -d'"' -f4)
check "too long → 422 too_long" "422 too_long" "$code $c1"
code=$(add "$A" "https://www.youtube.com/watch?v=$LIVE")
c2=$(grep -o '"code":"[^"]*"' "$OUT" | cut -d'"' -f4); m2=$(grep -o '"message":"[^"]*"' "$OUT" | cut -d'"' -f4)
check "live stream → 422 live_stream" "422 live_stream" "$code $c2"
code=$(add "$A" "https://www.youtube.com/watch?v=$NOEMBED")
c3=$(grep -o '"code":"[^"]*"' "$OUT" | cut -d'"' -f4); m3=$(grep -o '"message":"[^"]*"' "$OUT" | cut -d'"' -f4)
check "not embeddable → 422 not_embeddable" "422 not_embeddable" "$code $c3"
code=$(add "$A" "https://example.com/not-a-video")
c4=$(grep -o '"code":"[^"]*"' "$OUT" | cut -d'"' -f4); m4=$(grep -o '"message":"[^"]*"' "$OUT" | cut -d'"' -f4)
check "junk link → 400 invalid_url" "400 invalid_url" "$code $c4"
code=$(add "$A" "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI")
check "playlist-only link → 400" 400 "$code"
distinct=$(printf '%s\n%s\n%s\n%s\n' "$m1" "$m2" "$m3" "$m4" | sort -u | wc -l | tr -d ' ')
check "all four messages are distinct" 4 "$distinct"
check "queue unchanged by rejections" 6 "$(state "$A" | grep -o '"videoId"' | wc -l | tr -d ' ')"

echo
echo "  messages shown to the user:"
printf '    too long      : %s\n' "$m1"
printf '    live stream   : %s\n' "$m2"
printf '    no embedding  : %s\n' "$m3"
printf '    bad link      : %s\n' "$m4"

echo
echo "=== 3. A lone adder stays FIFO ==="
order=$(state "$A" | grep -o '"title":"[^"]*"' | cut -d'"' -f4 | head -6 | sort -u | wc -l | tr -d ' ')
check "six identical titles, so FIFO is by paste order" 1 "$order"

echo
echo "=== 4. Round-robin interleaves two adders ==="
add "$B" "https://youtu.be/$ZOO" >/dev/null            # User 3, first song
add "$A" "https://youtu.be/$GANGNAM" >/dev/null        # User 2, seventh song
add "$B" "https://youtu.be/$QUEEN" >/dev/null          # User 3, second song
# upNext only. Grepping every title in the payload would also catch `playing` and the
# history, which is what this assertion originally did back when `playing` was always null.
state "$A" > "$SP_STATE"
titles=$(node -e "console.log(require('$SP_STATE').upNext.map(r=>r.title).join('\n'))")
first_zoo=$(grep -n 'Me at the zoo' <<<"$titles" | head -1 | cut -d: -f1)
check "User 3's first song jumps to position 2" 2 "$first_zoo"
pos_queen=$(grep -n 'Bohemian' <<<"$titles" | head -1 | cut -d: -f1)
pos_gangnam=$(grep -n 'GANGNAM' <<<"$titles" | head -1 | cut -d: -f1)
check "User 3's second song precedes User 2's seventh" "yes" "$([ "$pos_queen" -lt "$pos_gangnam" ] && echo yes || echo no)"

echo
echo "=== 5. Anonymity: what User 3 can see of User 2's songs ==="
s=$(state "$B")
check "User 2's name is absent from the payload" 0 "$(grep -o 'User 2' <<<"$s" | wc -l | tr -d ' ')"
check "User 2's id is absent from the payload" 0 "$(grep -o "$U2" <<<"$s" | wc -l | tr -d ' ')"
check "no addedById field exists at all" 0 "$(grep -o 'addedById' <<<"$s" | wc -l | tr -d ' ')"
check "no added_by field exists at all" 0 "$(grep -o 'added_by' <<<"$s" | wc -l | tr -d ' ')"
check "no show_name field leaks" 0 "$(grep -o 'show_name' <<<"$s" | wc -l | tr -d ' ')"
check "anonymous rows carry addedByName null" "yes" "$(grep -q '"addedByName":null' <<<"$s" && echo yes || echo no)"
check "User 3 still sees its own rows as mine" "yes" "$(grep -q '"isMine":true' <<<"$s" && echo yes || echo no)"

echo
echo "=== 6. Show my name opts in ==="
add "$A" "https://youtu.be/$ZOO" true >/dev/null
s=$(state "$B")
check "opted-in song exposes the name to others" "yes" "$(grep -q '"addedByName":"User 2"' <<<"$s" && echo yes || echo no)"
check "the other User 2 songs stay anonymous" "yes" "$([ "$(grep -o '"addedByName":"User 2"' <<<"$s" | wc -l | tr -d ' ')" = "1" ] && echo yes || echo no)"

echo
echo "=== 7. Reveal budget reported honestly ==="
check "three reveals remaining" "yes" "$(grep -q '"revealsRemaining":3' <<<"$s" && echo yes || echo no)"

echo
echo "=== 8. /api/state requires a session ==="
code=$(curl -s -o "$OUT" -w '%{http_code}' "$BASE/api/state")
check "no cookie → 401" 401 "$code"
code=$(curl -s -o "$OUT" -w '%{http_code}' -H 'content-type: application/json' \
  -d "{\"url\":\"https://youtu.be/$RICK\"}" -X POST "$BASE/api/queue")
check "adding without a session → 401" 401 "$code"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
rm -f "$A" "$B" "$OUT"
[ "$fail" -eq 0 ]

#!/usr/bin/env bash
# Phase 1 exit-criteria check. Exercises the auth flows against the running dev server.
set -u

BASE=http://localhost:3000
U1=9f02a37a-7c18-4443-ac89-11d77cc58a8f   # User 1, is_owner
U2=1a744594-fc33-42c5-a916-f5eb9d969c0b   # User 2
U3=8ff75ed7-286e-4a7d-ba43-b53f0493bee3   # User 3

JAR=$(mktemp)
JAR2=$(mktemp)
pass=0; fail=0

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

post() { # post <jar> <path> [json]
  if [ $# -ge 3 ]; then
    curl -s -o /tmp/body -w '%{http_code}' -b "$1" -c "$1" \
      -H 'content-type: application/json' -d "$3" -X POST "$BASE$2"
  else
    curl -s -o /tmp/body -w '%{http_code}' -b "$1" -c "$1" -X POST "$BASE$2"
  fi
}

echo
echo "=== 1. First claim: User 3 sets a PIN ==="
code=$(post "$JAR" /api/auth/set-pin "{\"userId\":\"$U3\",\"pin\":\"1234\"}")
check "set-pin returns 200" 200 "$code"
check "responds with the user" "User 3" "$(grep -o '"name":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"

echo
echo "=== 2. Signed-in page ==="
body=$(curl -s -b "$JAR" "$BASE/")
# The account menu only exists once you are through the gate.
check "page shows the signed-in view" "yes" "$(echo "$body" | grep -q 'aria-haspopup="menu"' && echo yes || echo no)"
check "page shows User 3" "yes" "$(echo "$body" | grep -q 'User 3' && echo yes || echo no)"

echo
echo "=== 3. Log out keeps the device cookie ==="
code=$(post "$JAR" /api/auth/logout)
check "logout returns 200" 200 "$code"
check "device cookie survives" "yes" "$(grep -q office_radio_device "$JAR" && echo yes || echo no)"
body=$(curl -s -b "$JAR" "$BASE/")
check "gate offers Continue" "yes" "$(echo "$body" | grep -q 'Continue' && echo yes || echo no)"
check "gate names User 3" "yes" "$(echo "$body" | grep -q 'User 3' && echo yes || echo no)"
check "gate offers Not you?" "yes" "$(echo "$body" | grep -q 'Not you' && echo yes || echo no)"

echo
echo "=== 4. Continue needs no PIN ==="
code=$(post "$JAR" /api/auth/continue)
check "continue returns 200" 200 "$code"
check "continues as User 3" "User 3" "$(grep -o '"name":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"

echo
echo "=== 5. SECURITY: continue cannot be pointed at another user ==="
post "$JAR" /api/auth/logout >/dev/null
code=$(post "$JAR" /api/auth/continue "{\"userId\":\"$U2\"}")
check "still returns 200" 200 "$code"
check "body userId is IGNORED — still User 3" "User 3" "$(grep -o '"name":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"

echo
echo "=== 6. Continue with no device cookie is refused ==="
code=$(post "$JAR2" /api/auth/continue)
check "returns 401" 401 "$code"
check "code is no_device" "no_device" "$(grep -o '"code":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"

echo
echo "=== 7. A claimed name now requires its PIN ==="
code=$(post "$JAR2" /api/auth/set-pin "{\"userId\":\"$U3\",\"pin\":\"9999\"}")
check "set-pin on claimed name returns 409" 409 "$code"
check "code is pin_already_set" "pin_already_set" "$(grep -o '"code":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"1234\"}")
check "correct PIN returns 200" 200 "$code"

echo
echo "=== 8. Lockout after 5 wrong PINs ==="
rm -f "$JAR2"; JAR2=$(mktemp)
for i in 1 2 3 4; do
  code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"0000\"}")
  remaining=$(grep -o '"attemptsRemaining":[0-9]*' /tmp/body | cut -d: -f2)
  check "attempt $i returns 401, $((5-i)) left" "401 $((5-i))" "$code $remaining"
done
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"0000\"}")
check "5th attempt returns 429" 429 "$code"
check "code is locked_out" "locked_out" "$(grep -o '"code":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"1234\"}")
check "CORRECT pin during lockout still 429" 429 "$code"

echo
echo "=== 9. Owner-only PIN reset ==="
code=$(post "$JAR2" /api/owner/reset-pin "{\"userId\":\"$U3\"}")
check "unauthenticated reset returns 401" 401 "$code"
JAR3=$(mktemp)
post "$JAR3" /api/auth/set-pin "{\"userId\":\"$U2\",\"pin\":\"2222\"}" >/dev/null
code=$(post "$JAR3" /api/owner/reset-pin "{\"userId\":\"$U3\"}")
check "non-owner reset returns 403" 403 "$code"
check "code is not_owner" "not_owner" "$(grep -o '"code":"[^"]*"' /tmp/body | head -1 | cut -d'"' -f4)"
JAR4=$(mktemp)
post "$JAR4" /api/auth/set-pin "{\"userId\":\"$U1\",\"pin\":\"1111\"}" >/dev/null
code=$(post "$JAR4" /api/owner/reset-pin "{\"userId\":\"$U3\"}")
check "owner reset returns 200" 200 "$code"

echo
echo "=== 10. Reset clears the lockout and the PIN ==="
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"1234\"}")
check "old PIN no longer works (409 pin_not_set)" 409 "$code"
code=$(post "$JAR2" /api/auth/set-pin "{\"userId\":\"$U3\",\"pin\":\"4321\"}")
check "User 3 can set a fresh PIN" 200 "$code"

echo
echo "=== 11. Input validation ==="
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"12\"}")
check "short PIN returns 400" 400 "$code"
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"$U3\",\"pin\":\"abcd\"}")
check "non-numeric PIN returns 400" 400 "$code"
code=$(post "$JAR2" /api/auth/claim "{\"userId\":\"00000000-0000-0000-0000-000000000000\",\"pin\":\"1234\"}")
check "unknown user returns 404" 404 "$code"

echo
echo "-----------------------------------------"
echo "  passed: $pass    failed: $fail"
echo "-----------------------------------------"
rm -f "$JAR" "$JAR2" "$JAR3" "$JAR4" /tmp/body
[ "$fail" -eq 0 ]

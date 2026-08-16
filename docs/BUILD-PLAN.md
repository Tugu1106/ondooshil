# Office Radio — Build Plan

Nine phases, **one session each**. Every phase ends with the app in a working, verifiable
state. Phases are ordered so that each one only depends on things already proven.

Source of truth for behaviour is [office-radio-spec.md](../office-radio-spec.md). This
document decides *sequencing, boundaries, and shared contracts* — the things a cold
session cannot re-derive without risking drift.

| # | Phase | Spec § | One-line exit criterion |
|---|---|---|---|
| 0 | Foundation & schema | 2, 4, 13 | `/api/health` reports DB reachable + correct UB date |
| 1 | Auth | 5 | You can log in, log out, re-continue, and get locked out |
| 2 | Add a song & queue view | 6 (ordering), 10, 12 | Paste a link → it validates and appears in round-robin order |
| 3 | Timeline engine | 6 | `/api/state` advances songs correctly on its own; tests green |
| 4 | Client player | 7 (playback, errors) | Click Listen → audio plays, joins mid-song, survives a bad video |
| 5 | Sync & local controls | 7 (sync, controls) | On-time transitions, drift correction, local mute/volume |
| 6 | Ownership actions | 8 | Remove own pending, skip own current — silently |
| 7 | Reveal tickets | 9 | 3 private reveals per day, deduped, day-scoped |
| 8 | Hardening & deploy | 14, 16 | Live on Vercel, §16 checklist signed off item by item |

Phases 6 and 7 are the smallest; merge them into one session only if 6 finishes with
room to spare. Never merge anything into or out of Phase 3.

---

## Why this order differs slightly from spec §14

The spec's build order is sound; two adjustments make it more robust under
one-session-per-phase:

1. **The timeline engine gets its own phase, server-only, before any browser player.**
   It is the highest-risk, most edge-case-dense part of the system, and it is the only
   part that can be verified deterministically without a browser. Debugging accumulating
   transitions and a 30-second overshoot rule *through* an iframe player is how subtle
   timeline bugs survive to production. Phase 3 proves the engine against injected clocks;
   Phase 4 then consumes a known-good API.

2. **Round-robin ordering lands in Phase 2, with the queue view.** The same ordering
   drives both the "up next" display and `pickNext()`. Building it once, where it is
   immediately visible on screen, avoids two implementations disagreeing.

Anonymity is **not** deferred to Phase 7. The serializer omits `added_by` from Phase 2
onward, so the leaky version is never written at all. Phase 7 adds only reveal tickets.

---

## Contracts

Fixed now so no session invents its own version. Shapes are stable from Phase 2; later
phases fill in fields, they do not rename or restructure.

### `GET /api/state`

```ts
type StateResponse = {
  serverTime: string;              // ISO 8601 — client computes its offset from this
  me: { id: string; name: string; isOwner: boolean; revealsRemaining: number };
  playing: NowPlaying | null;      // null = silence
  upNext: QueueRow[];              // round-robin ordered, today only
  playedToday: QueueRow[];         // played | skipped | failed, newest first
};

type NowPlaying = {
  queueItemId: string;
  videoId: string;
  title: string;
  durationSec: number;
  startedAt: string;               // ISO 8601
  addedByName: string | null;      // null = anonymous and not revealed by this viewer
  canSkip: boolean;                // true only if this viewer is the adder
};

type QueueRow = {
  id: string;
  videoId: string;
  title: string;
  durationSec: number;
  status: 'pending' | 'played' | 'skipped' | 'failed';
  addedByName: string | null;      // same rule as above
  isMine: boolean;                 // safe: only ever true for the viewer's own songs
  canRemove: boolean;              // isMine && status === 'pending'
  revealed: boolean;               // this viewer has spent a ticket on this row
};
```

`addedByName` is non-null only when `show_name = true`, or the viewer has revealed it, or
the viewer is the adder. **There is no other field carrying identity.** No `addedById`, no
`addedByHash`, nothing derivable.

### Errors

```ts
{ error: { code: string; message: string } }
```

`message` is safe to show a user verbatim. Status codes: 400 bad input, 401 no session /
bad credential, 403 not yours, 404 unknown id, 409 conflict, 422 validation rejection, 429
rate-limited (the PIN lockout), 502 upstream (YouTube) failure.

### File layout

```
app/
  layout.tsx  page.tsx
  api/
    health/route.ts            auth/{claim,set-pin,logout}/route.ts
    state/route.ts             queue/route.ts  queue/[id]/route.ts  queue/[id]/skip/route.ts
    reveal/[id]/route.ts       owner/reset-pin/route.ts
components/       AuthGate  NowPlaying  ListenControls  AddSongForm  UpNext  PlayedToday  YouTubePlayer
lib/
  env.ts        validated, server-only
  db.ts         Supabase service-role client
  session.ts    iron-session config, getSession(), requireUser()
  time.ts       Asia/Ulaanbaatar day helpers
  youtube.ts    URL parsing, ISO-8601 duration, Data API
  queue.ts      round-robin ordering, pickNext()
  timeline.ts   resolveState() and its repository interface
  serialize.ts  the added_by omission rule — single choke point
  types.ts      the contracts above
lib/client/     useStation.ts (poll + offset + scheduling), player.ts (IFrame wrapper)
supabase/migrations/   supabase/seed.sql
docs/           BUILD-PLAN.md  PROGRESS.md
tests/
```

### Testing posture

Narrow and deliberate, not blanket coverage:

- **Vitest unit tests** for pure logic: URL parsing, ISO-8601 duration parsing, and
  `resolveState()` — which takes an injected clock and a repository interface precisely so
  it can be tested without a database or a browser. This is the reason Phase 3 is isolated.
- **One scripted integration check** against the real database for round-robin ordering
  (SQL-side, so unit tests cannot reach it): seed rows under a sentinel `day`, assert the
  order, clean up.
- No UI tests. Manual verification against the phase exit criteria is sufficient at this scale.

---

## Phase 0 — Foundation & schema

**Goal:** an empty but correctly wired app that can talk to Postgres and knows what day it is.

Re-read spec §2 (stack hard rules), §4 (data model), §13 (env).

- Next.js App Router + TypeScript scaffold; `npm`; strict mode; `@/` path alias.
- `lib/env.ts` — validate required vars at startup, fail loudly. Server-only import guard.
- `lib/db.ts` — Supabase client with the service role key. Never imported from a client component.
- `lib/time.ts` — `todayInUB()`, `dayOf(ts)`. All day logic goes through here.
- `supabase/migrations/0001_init.sql` — the four tables exactly as spec §4, plus indexes,
  plus the enforced single `player_state` row.
  **Include `failed_attempts int not null default 0` and `locked_until timestamptz` on
  `users` now** (spec §5 permits this shape) so Phase 1 needs no migration.
- `supabase/seed.sql` — 6 placeholder users, `User 1`…`User 6`, one with `is_owner = true`.
- `GET /api/health` — returns `{ db: 'ok', today: '<UB date>', serverTime }`.

**Exit:** `npm run dev` boots clean; `/api/health` returns `db: ok` and the correct
Asia/Ulaanbaatar date; the six users are visible in the Supabase table editor.

**Prerequisites:** Supabase project created; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SESSION_SECRET` in `.env.local`. `YOUTUBE_API_KEY` is not needed until Phase 2.

---

## Phase 1 — Auth

**Goal:** you can log in. Nothing else in the app changes.

Re-read spec §5 in full — the two-cookie rationale is subtle and easy to "simplify" wrongly.

- `lib/session.ts` — iron-session config; `device` cookie (10 years, `userId`) and
  `session` cookie (30 days, `userId`). `requireUser()` is the **only** way any route
  learns who the caller is.
- `POST /api/auth/claim` — `{ userId, pin? }`. Sets **both** cookies on success.
- `POST /api/auth/set-pin` — first claim, 4 digits, bcrypt.
- `POST /api/auth/logout` — clears `session`, **keeps `device`**.
- `POST /api/owner/reset-pin` — `is_owner` only; nulls another user's `pin_hash`.
  (Spec §14 omits this; it is auth-domain and ~20 lines, so it belongs here.)
- Rate limiting: 5 failed attempts → 15 minute lockout, via the `users` columns from Phase 0.
- `components/AuthGate` — the three-branch flow from spec §5: valid session → through;
  device cookie → "You're {name} — Continue" + small "Not you?"; neither → name picker,
  then PIN entry or first-claim PIN setup.

**Exit:** log in as a fresh user (sets a PIN); log out and get the Continue card with no
PIN; "Not you?" reaches the picker; a claimed user requires their PIN; 5 wrong PINs locks
for 15 minutes. No plaintext PIN anywhere.

**Landmines covered:** `userId` from session only · bcrypt + lockout.

---

## Phase 2 — Add a song & queue view

**Goal:** paste a YouTube link, watch it validate and land in the correctly ordered list.

Re-read spec §10 (validation pipeline), §6 `pickNext()` (ordering), §9 (anonymity), §12 (UI).

- `lib/youtube.ts` — parse all five URL forms; strip extra params; `&list=` takes the
  single video and discards the playlist; ISO-8601 duration → seconds.
- Validation via `videos.list` (`part=snippet,contentDetails,status`): must exist, must be
  `embeddable`, must be ≤ 10 minutes, `liveBroadcastContent` must be `'none'`. Each
  rejection gets its own clear user-facing message. **Duplicates are allowed.**
- `POST /api/queue` — `{ url, showName }`; `added_by` from the session; `day` from `lib/time`.
- `lib/queue.ts` — the round-robin ordering query from spec §6, serving both the full
  "up next" list and (in Phase 3) `pickNext()`. No pending cap, ever.
- `lib/serialize.ts` — the `added_by` omission rule, written correctly the first time.
- `GET /api/state` — created here with the **full contract shape**, but `playing` is
  hard-coded `null` and `revealsRemaining` is a real count against an empty table. Phase 3
  fills in `playing`; no shape changes.
- UI: add box (mobile-first — large paste field, large tap targets, one-handed),
  "Show my name" checkbox, "Up next", "Played today". Poll `/api/state` every 3s.

**Exit:** paste each of the five URL forms and a `&list=` URL — all resolve to the right
video; a >10min video, a live stream, and a non-embeddable video are each rejected with a
distinct message; two users' songs interleave in the list; a lone user's songs stay FIFO;
an anonymous song's payload contains no identity field (check the network tab, not the UI).

**Landmines covered:** live/>10min rejected at add time · `added_by` never sent for
anonymous rows.

---

## Phase 3 — Timeline engine

**Goal:** the station runs correctly with nobody watching. No player, no UI work.

Re-read spec §6 **in full**, twice. This phase is the reason the plan exists.

- `lib/timeline.ts` — `resolveState(repo, now)`: dependency-injected clock and repository
  so it is unit-testable. Cases A (cold start), B (still playing), C (finished) exactly as
  specified.
- Rule 1: normal transition sets `started_at + duration_sec` — never `now()`.
- Rule 2: overshoot > 30s cold-starts at `now()` instead of chaining the backlog.
- Rule 3: one advance per call, no loops.
- Concurrency: `UPDATE player_state SET … WHERE id = 1 AND current_item = $expected`.
  Zero rows → re-read and return, never retry.
- `pickNext()` — `LIMIT 1` over the Phase 2 ordering, filtered to `status = 'pending'` and today.
- Current item resolved **by id**, with no day filter, so a song crossing midnight finishes.
- Wire `playing` and `serverTime` into `/api/state`.

**Tests (vitest, injected clock):** cold start from silence · exact back-to-back transition
· overshoot < 30s chains · overshoot > 30s cold-starts and burns only one song · empty
queue goes silent · concurrent advance loses the race gracefully · a song started before
midnight finishes after it. Plus the scripted ordering check against the real DB.

**Exit:** all tests green. With three songs queued and no browser open, polling
`/api/state` by hand shows it advance on schedule; leaving it alone for an hour and
returning cold-starts rather than having consumed the whole queue.

**Landmines covered:** `started_at + duration` · 30s cold start · conditional update ·
day filter not applied to current-item lookup · `serverTime` present.

---

## Phase 4 — Client player

**Goal:** click Listen and hear the station, correctly positioned.

Re-read spec §7 (position/seeking, player element, autoplay, error handling).

- `lib/client/player.ts` — IFrame API wrapper; one instance, created once.
- `components/YouTubePlayer` — **mounted and visible** always (small and tucked away is
  fine; `display: none` is not). Never unmounted between songs — `loadVideoById` on the
  existing instance.
- Clock offset: computed once on first load from `serverTime`; all position math uses it.
  (Scheduling and drift correction come in Phase 5 — this phase just seeks correctly.)
- 🔊 Listen button as the required user gesture; page opens **not listening**.
- Join mid-song: `loadVideoById({ videoId, startSeconds: position })`.
- Change detection by `current_item` **id**, not position.
- `onError` → mark the item `failed` and advance immediately; no retry. Needs a small
  server route or a reuse of the skip path — decide and record it in PROGRESS.md.

**Exit:** open the page mid-song, click Listen, and the audio starts at the right point;
a second browser lands within about a second; queue a known non-embeddable video and watch
the station move past it instead of stalling; the iframe is never unmounted across a transition.

**Landmines covered:** offset-corrected time · id-based change detection · `onError`
recovery · iframe mounted and visible · audio only after Listen.

---

## Phase 5 — Sync & local controls

**Goal:** transitions land on time and local audio behaves like a radio.

Re-read spec §7 (transition scheduling, drift correction, local controls).

- `setTimeout` for `duration - position`, fetching `/api/state` at that exact moment.
  The 3s poll then only catches *unpredictable* changes: skips, removals, cold starts.
- Drift correction every 30s: off by **> 2s** → `seekTo()`; **≤ 2s** → do nothing.
- Local mute and volume — client-side only, never sent to the server.
- Pause-then-resume **re-syncs to the live position**; it does not continue from the pause.
- Consolidate all of this in `lib/client/useStation.ts`; clean up timers on unmount.

**Exit:** a transition is audible within a fraction of a second of the song ending, not up
to 3s late; forcing a 5s drift triggers exactly one correction; a 1s drift triggers none;
pausing for 30s and resuming jumps forward to live.

**Landmines covered:** scheduled transitions · drift thresholds.

---

## Phase 6 — Ownership actions

**Goal:** you can manage your own songs and nobody else's.

Re-read spec §8 — especially why skipping must be silent.

- `DELETE /api/queue/:id` — adder only, `status = 'pending'` only.
- `POST /api/queue/:id/skip` — adder of the **currently playing** song only. Sets
  `started_at = now()` for the next song (a skip is a cold start, not an accumulating transition).
- UI: remove button on your own pending rows only; skip control only when you added the
  current song.
- **No "skipped by X" anywhere** — not in the UI, not in a toast, not in a log the client
  can see. The queue just moves on.

**Exit:** you can remove your own pending song but not someone else's (verify by calling
the endpoint directly, not just by hiding the button); you cannot remove a song that has
already played; skipping advances the station for everyone with no attribution visible in
the UI or in any API payload.

**Landmines covered:** silent skips · ownership enforced server-side.

---

## Phase 7 — Reveal tickets

**Goal:** three private reveals per person per day.

Re-read spec §9.

- `POST /api/reveal/:id` — spends a ticket, returns the name.
- 3 per user per day, resetting at 00:00 UB; count from `reveals` where `day = today`.
- Re-revealing the same song costs nothing — the `(user_id, queue_item_id)` primary key
  handles it; make the insert idempotent rather than counting a duplicate.
- A reveal is **private to the spender** and is never announced to the room.
- UI: small reveal button on anonymous rows showing remaining tickets (`2 left`); disabled
  at zero.
- `revealsRemaining` and `revealed` in `/api/state` become live.

**Exit:** three reveals work, the fourth is refused; re-revealing the same song does not
consume a ticket; another user's ticket count and reveals are unaffected; reveals reset
with the day.

**Landmines covered:** identity released only in exchange for a ticket.

---

## Phase 8 — Hardening & deploy

**Goal:** live on Vercel, with spec §16 verified item by item rather than assumed.

- Walk the **entire §16 landmine checklist** as a fresh audit — do not trust the per-phase
  claims in this document, re-verify each of the fifteen items against the actual code.
- Confirm no secret reaches the client bundle: grep the build output for the service role
  key and the YouTube key; confirm no `NEXT_PUBLIC_` on any secret.
- Real names replace the placeholders via the Supabase table editor (spec §5).
- Deploy to Vercel; set env vars; run the migration against the production database.
- A short README: env setup, how to run migrations, how to reset a PIN.

**Exit:** the room can use it. Every §16 box ticked with the evidence noted in PROGRESS.md.

---

## Standing rules for every session

- Build only the current phase. If you spot work that belongs to a later phase, write it
  in PROGRESS.md under "Notes for later" — do not implement it.
- If the spec is genuinely ambiguous, take the simplest reading and leave a `TODO:`
  comment. Do not invent features.
- If a phase's exit criteria cannot be met, say so plainly in PROGRESS.md and leave the
  phase open rather than marking it done.
- Recommended: one commit per completed phase, so any phase can be rolled back cleanly.

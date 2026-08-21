# Office Radio — System Documentation

A description of the system **as it exists today**. Not a plan, not a roadmap — a reference
for anyone reading this codebase cold.

Companion documents: [office-radio-spec.md](../office-radio-spec.md) is the original design
authority, [BUILD-PLAN.md](BUILD-PLAN.md) records how it was sequenced, and
[PROGRESS.md](PROGRESS.md) is the running log of decisions and deviations.

---

## 1. What it is

A private web app for one office room of about six people sharing one speaker.

Members paste YouTube links into a shared daily queue. The app behaves like a **radio
station**: there is one continuous broadcast, the server decides what is playing and where
the playhead is, and every browser tunes itself to that position. One machine stays unmuted
so the room hears it.

It is single-tenant. One room, one queue, one playhead.

### The mental model

**It is a radio, not a music player.**

- No admin, no owner-of-playback, no controller, no host, no roles.
- You cannot pause it. You can only mute your own speaker.
- The broadcast exists independently of who is listening.
- Tuning in mid-song is normal.

An earlier design had an admin role that owned playback. It had to be both
always-claimable (or music stops when someone goes home) and hard-to-claim (because it
exposed who queued what). That is unsolvable; deleting the role deleted both problems.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.1, App Router, Turbopack |
| Language | TypeScript, strict, `@/*` path alias |
| UI | React 19.2.8, plain CSS Modules — no Tailwind, no UI library |
| Hosting | Vercel (functions pinned to `icn1`/Seoul via `vercel.json`) |
| Database | Supabase Postgres 17, used as **plain Postgres** |
| DB access | Server-side only, service role key |
| Sessions | `iron-session` 8 (encrypted cookies) |
| PIN hashing | `bcryptjs` 3, cost 12 |
| Playback | YouTube IFrame Player API |
| Metadata | YouTube Data API v3 (`videos.list`) |
| Weather | Open-Meteo (no API key required) |
| Sync | HTTP polling every 3s + client-side `setTimeout` scheduling |
| Tests | Vitest (unit) + bash scripts (integration) |

### Hard rules the code enforces

- **All database access is server-side.** `lib/db.ts` imports `server-only`, so an
  accidental client import is a build error rather than a leaked key.
- **No Supabase Auth.** Identity is custom PIN + signed cookies.
- **RLS is enabled with zero policies** — a deny-all. `service_role` bypasses RLS, so no
  application code depends on it. Do not add policies; a permissions error means the wrong
  key is in use, not that a policy is missing.
- **No Supabase Realtime.** Polling only.
- **No filesystem, SQLite, or module-level state.** Vercel is ephemeral.
- **No `NEXT_PUBLIC_` prefix on any secret.**

---

## 3. Data model

Four tables. All timestamps are `timestamptz`. All day-boundary logic uses
**Asia/Ulaanbaatar**.

```sql
users (
  id uuid pk, name text unique, pin_hash text null,
  is_owner boolean, failed_attempts int, locked_until timestamptz,
  created_at timestamptz
)

queue (
  id uuid pk, video_id text(11), title text, duration_sec int,
  added_by uuid → users(id), show_name boolean,
  status text,          -- pending | playing | played | skipped | failed
  day date, created_at timestamptz
)

player_state (
  id int pk = 1,        -- exactly one row, enforced by CHECK
  current_item uuid → queue(id) null,
  started_at timestamptz null
)

reveals (
  user_id uuid, queue_item_id uuid, day date, created_at timestamptz,
  primary key (user_id, queue_item_id)
)
```

Indexes: `queue(day, status)`, `queue(day, added_by, created_at)`, `reveals(user_id, day)`.

### Things about the schema worth knowing

- **`added_by` is stored for every song**, anonymous ones included. It drives round-robin
  ordering, adder-only skip/remove, and reveals. Anonymity is a *display* concern.
- **`duration_sec` is mandatory.** The whole timeline is arithmetic over durations. This is
  why live streams are rejected — one would freeze the station permanently.
- **`day` is written by the server at insert time**, never computed in a query.
- **`status = 'playing'` exists in the vocabulary but is never used by the timeline.** Which
  song is current is owned by `player_state`, not by the status column. The playing song
  keeps `status = 'pending'` and is filtered out of `upNext` by id.
- **The `reveals` primary key has no day in it.** Spending is an upsert, so a song revealed
  yesterday and again today re-stamps the day instead of colliding.

---

## 4. The timeline engine

`lib/timeline.ts`. This is the heart of the system and the most edge-case-dense part.

It is **pure** — no database import, no `server-only`. It takes its clock and its storage as
parameters, which is what makes every case testable without a database or a browser. The
Supabase implementation lives separately in `lib/timeline-repo.ts`.

### `resolveState(repo, now, day)`

Called on every `/api/state` request.

```
state = player_state row

A. current_item is null       → pickNext(); if none, silence; else COLD START at now()
B. elapsed < duration          → return as-is
C. elapsed >= duration         → mark played; pickNext()
     no next                   → go silent
     overshoot < 30s           → next starts at started_at + duration   (accumulate)
     overshoot >= 30s          → next starts at now()                   (cold start)
```

### The three rules that make it correct

1. **Normal transitions accumulate.** `started_at + duration`, never `now()`. Using `now()`
   adds the poll delay to every transition and the error compounds — after twenty songs the
   station is a minute adrift.
2. **Overshoot > 30s cold-starts.** Without it, the office returns from a one-hour lunch and
   the server computes that fifteen songs "played" to an empty room, silently burning the
   queue. Thirty seconds distinguishes "a poll arrived late" from "nobody was here". At most
   one song is lost to a gap.
3. **At most one advance per call.** No loops. Successive 3s polls handle successive songs.

### Concurrency

Every write is an optimistic conditional update:

```sql
UPDATE player_state SET current_item = $next, started_at = $ts
WHERE id = 1 AND current_item = $expected
```

Zero rows affected means someone else advanced first — the loser **re-reads and returns
that state, never retries**. Retrying is how a thundering herd of pollers burns a queue.

Note: expecting `null` uses `.is('current_item', null)`, because SQL equality never matches
null and `.eq(…, null)` would silently never match — which would have broken cold start
specifically, and only cold start.

### Two guards beyond the spec

A `current_item` pointing at a row that no longer exists, and a `current_item` with a null
`started_at`. Neither should happen; both clear the broadcast conditionally and let the next
poll cold-start rather than inventing a playhead.

### `advancePast(repo, expected, now, day)`

The shared "move on now" primitive, used by skip and by failed-video recovery. Starts the
next song at `now()` — a cold start, because the song did not run its length, so
`started_at + duration` would place the next one in the past.

### The daily reset

Implemented as a **date filter, not a deletion**. No cron job, no 3am failure, history
preserved. Songs still pending at midnight are simply never selected again.

**The day filter applies to the queue list and to `pickNext()` — never to resolving
`player_state.current_item`,** which is always looked up by id, so a song crossing midnight
finishes.

---

## 5. Round-robin ordering

`lib/queue.ts`, `orderRoundRobin()`.

Everyone's 1st pending song plays, then everyone's 2nd, and so on. Ties broken by paste
time, then id, so the order is deterministic and never reshuffles under a reader.

- One person adding → one partition → plain FIFO. Someone alone at 8am is never throttled.
- Two people → alternates.
- Bat pastes 15, Sara pastes 1 → Sara's plays **second**.

**There is no cap on pending songs.** A cap is context-blind — it would block Bat's 6th song
at 8am when there is nobody to be fair to. Round-robin only constrains someone when another
person actually wants a turn.

Implemented in TypeScript rather than the SQL window function from the spec: it is pure, so
song selection is unit-testable with an injected repository, and `supabase-js` cannot
express `ROW_NUMBER() OVER (PARTITION BY …)` without an RPC. The reference SQL is preserved
verbatim as a comment above the function; output order is identical.

*Known limitation, accepted:* this balances the pending backlog, not the whole day. Someone
arriving at 9am accumulates more airtime than someone arriving at noon.

---

## 6. Authentication

No email, no signup, no OAuth. Six known people, seeded by name.

### Two cookies

| Cookie | Lifetime | Contents | Purpose |
|---|---|---|---|
| `office_radio_device` | 10 years | `userId` | Remembers who last used this machine |
| `office_radio_session` | 30 days | `userId` | **The only thing that authorizes an action** |

Two cookies exist so re-identifying as *yourself* is frictionless while claiming *someone
else's* name costs a PIN. With one cookie, every expiry would dump the room back to a name
picker.

**Both are encrypted iron-sessions**, not just `session`. The spec calls `device` "not proof
of identity", which is true of authorizing actions — but `device` is what lets a session be
minted with no PIN, and the name picker necessarily ships every user's id to the browser. A
plaintext `device` cookie would be a one-line impersonation of anyone in the office.

### Flow

```
valid session?          → authenticated
no session, device set  → "You're {name} — Continue"  (no PIN) + "Not you?"
neither                 → name picker
                            has pin_hash  → require PIN
                            no pin_hash   → first claim, user sets a 4-digit PIN
```

### Rules the code enforces

- PINs are 4 digits, bcrypt cost 12. Never stored or logged in plaintext.
- **5 failed attempts → 15 minute lockout.** A correct PIN during a lockout is still refused.
- **`userId` always comes from the session cookie**, server-side. `currentUser()` in
  `lib/auth.ts` is the single identity choke point. Exactly three routes read a `userId`
  from a body: `auth/claim` and `auth/set-pin` (the login step, worthless without the PIN)
  and `owner/reset-pin` (the *target*; the caller still comes from the session).
- **`is_owner` grants exactly one power**: nulling another user's `pin_hash` so they set a
  new one. It is not an admin role and has no other surface.
- First-claim PIN setting is unauthenticated by necessity — there is no prior credential to
  check. It is conditional on `pin_hash IS NULL`, so it can never overwrite an existing PIN.
  The recovery path for a mis-claim is the owner reset, which is why that exists.

---

## 7. Anonymity and reveals

Songs are **anonymous by default**. The add form has an opt-in "Show my name" checkbox,
which is unticked after every add.

### The serializer is the single choke point

`lib/serialize.ts`. Two properties it must never lose:

1. **Objects are built field by field**, never spread from a database row — so a column
   added to `queue` later cannot leak by accident. A hidden field in a JSON payload is not
   hidden; the browser receives the whole payload.
2. **`addedByName` is the only field that can carry identity.** `isMine`, `canRemove` and
   `revealed` describe the viewer's own relationship to a row and are false for everyone
   else's songs, so they disclose nothing. There is no `addedById`, no hash, nothing
   derivable.

A viewer sees a name only if the adder opted in, it is their own song, or they paid a
ticket.

### Reveal tickets

- **Three per person per day**, resetting at 00:00 Asia/Ulaanbaatar.
- A reveal is **private to the spender**. Nothing is announced to the room.
- **The free cases are answered before the budget is consulted** — your own song, an
  opted-in name, and a song you already revealed today all return the name without spending.
  Checking the budget first would make a repeat look like a fourth reveal and refuse it once
  the three are gone.
- Removing a song deletes any reveal tickets spent on it (`reveals.queue_item_id` is a
  foreign key), so whoever paid gets their ticket back.

*Accepted race:* two simultaneous reveals of *different* songs could both pass the budget
check and spend a fourth ticket. Serialising it needs a transaction or an RPC. At six people
this will not happen, and the primary key already makes the common case exact.

### Skips are silent

Only the adder can skip their own song. Therefore **nothing anywhere names who skipped** —
not the UI, not a toast, not any API payload. "Skipped by Bat" would reveal that Bat queued
the anonymous track for free, bypassing the entire ticket system.

---

## 8. Adding a song

`POST /api/queue { url, showName }` → `lib/youtube.ts`.

**1. Parse the video id.** Accepts `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, and
`m.youtube.com`. Extra query params are stripped. A `&list=` playlist link takes the single
video and discards the playlist — for free, since only `v` is ever read.

**2. Validate via `videos.list` (`part=snippet,contentDetails,status`):**

| Check | Rule | Rejection |
|---|---|---|
| Exists | response has items | 404-ish, 422 |
| `status.embeddable` | must be true | 422 `not_embeddable` |
| `contentDetails.duration` | ISO 8601, **≤ 10 minutes** | 422 `too_long` |
| `snippet.liveBroadcastContent` | must be `'none'` | 422 `live_stream` |

Each rejection has its own code and its own user-facing message.

**3. Insert** with `added_by` from the session and `day` from `lib/time`.

**Duplicates are allowed.** They are not deduplicated.

---

## 9. API surface

All routes are `force-dynamic`. Errors are `{ error: { code, message } }` with a real HTTP
status: 400 bad input, 401 no session, 403 not yours, 404 unknown, 409 conflict, 422
validation, 429 rate-limited, 502 upstream.

| Endpoint | Notes |
|---|---|
| `GET /api/state` | The hot path. Runs `resolveState()`, then reads the queue |
| `GET /api/health` | `{ db, today, serverTime, timeZone, users, env }` |
| `GET /api/weather` | The sky over Ulaanbaatar. No session required |
| `POST /api/auth/claim` | `{ userId, pin }` → sets both cookies. **Always requires a PIN** |
| `POST /api/auth/continue` | **Takes no body at all.** Reads the device cookie only |
| `POST /api/auth/set-pin` | First claim. Conditional on `pin_hash IS NULL` |
| `POST /api/auth/logout` | Clears `session`, **keeps `device`** |
| `POST /api/queue` | `{ url, showName }` → the validation pipeline above |
| `DELETE /api/queue/:id` | Adder only, pending only. 409 `on_air` for the current song |
| `POST /api/queue/:id/skip` | Adder of the **currently playing** song only |
| `POST /api/queue/:id/failed` | `{ videoId }` → marks failed and advances |
| `POST /api/reveal/:id` | Spends a ticket, returns `{ name, revealsRemaining }` |
| `POST /api/owner/reset-pin` | `{ userId }`, `is_owner` only |

### `/api/state` contract

Stable since Phase 2. Fields fill in over time; shapes do not change.

```ts
type StateResponse = {
  serverTime: string;              // ISO 8601
  me: { id, name, isOwner, revealsRemaining };
  playing: NowPlaying | null;      // null = silence
  upNext: QueueRow[];              // round-robin ordered, today only, excludes current
  playedToday: QueueRow[];         // played | skipped | failed, newest first
};

type NowPlaying = {
  queueItemId, videoId, title, durationSec,
  startedAt: string,               // ISO 8601
  addedByName: string | null,      // null = anonymous, unrevealed by this viewer
  canSkip: boolean,                // true only if this viewer is the adder
};

type QueueRow = {
  id, videoId, title, durationSec,
  status: 'pending' | 'playing' | 'played' | 'skipped' | 'failed',
  addedByName: string | null,
  isMine, canRemove, revealed: boolean,
};
```

Cost: about five queries per poll (player_state, current item, the day's queue, users,
reveals), plus one for `pickNext` on a transition.

### `/api/auth/continue` is not in the spec

It was split out of `claim` because it is the *only* endpoint that grants a session without
a PIN, so it must be incapable of being aimed at someone else. It **accepts no body**, which
makes impersonation structurally impossible rather than dependent on a branch inside a
three-way handler. `claim` consequently always requires a PIN.

---

## 10. Client architecture

### Clock offset

Clients **never** use raw `Date.now()` for playhead math — laptop clocks drift, and one
machine 40 seconds off produces an inexplicable bug.

1. `/api/state` returns `serverTime`.
2. The offset is seeded from the server-rendered payload, then replaced once by the first
   live fetch (where the error is only half a round trip). **Frozen after that.**
3. All playhead math uses `clientNow + offset`.

`Date.now()` appears at exactly three sites in `lib/client/useStation.ts` — seed, refine,
and `serverNow()` — and **nowhere in any component**. A fourth would mean a playhead
bypassing the offset.

### Polling and transition scheduling

- `/api/state` every 3s, seeded server-side so the first paint already has the queue.
- A local `setTimeout` fires **250 ms after** the song's scheduled end and fetches state
  then. Landing exactly on the boundary risks a rounding error leaving `elapsed` a hair
  under `duration`, which would make the server decline to advance.
- The 3s poll therefore only catches *unpredictable* changes: skips, removals, and songs
  added after silence.
- **Change detection compares the `current_item` id, never the position.** A skip breaks the
  timeline arithmetic, so the id is the only reliable signal.

### Drift correction

Every 30 seconds, compare actual against expected position. Off by **> 2s** → `seekTo()`.
**≤ 2s** → do nothing; seeking is audibly jarring.

Both the drift interval and the transition timer key on `playing.queueItemId`, **never on
the `playing` object** — that object is a fresh value on every poll, so an effect depending
on it would restart the interval before it ever fired, and drift correction would silently
never run. There is a static check asserting both dependency arrays.

### The player

`components/YouTubePlayer.tsx` + `lib/client/player.ts`.

- **The iframe stays mounted and visible for the life of the page.** `display: none` causes
  some browsers to pause playback. Songs change via `loadVideoById` on the existing
  instance; the player is created exactly once, with an empty-dependency effect.
- `playing` and `onFailed` are kept in refs updated by effects, so the creation effect never
  re-runs — re-running would tear down and rebuild the iframe.
- **There is no `listening` state. `muted` is the single truth.** Two pieces of state
  describing one thing drift, and then the button claims sound while the room hears silence.
- **The page opens muted.** Muted autoplay is the one kind browsers permit without a gesture,
  so the station runs from page load; unmuting *is* the gesture.
- Player vars: `controls: 0`, `rel: 0`, `disablekb: 1`, `iv_load_policy: 3`, `fs: 0`,
  `playsinline: 1`, `autoplay: 1`, `mute: 1`, `suggestedQuality: 'small'`.
- `pointer-events: none` on the frame. It removes YouTube's hover chrome and means a stray
  click cannot pause the station. You cannot pause a radio, so the surface that would let
  you is inert.
- **The player heals itself.** Anything that pauses it — a throttled background tab, a
  suspended iframe, a blocked autoplay landing in `CUED` — is treated as a fault, not an
  instruction: it resumes and re-seeks to live. A `visibilitychange` handler does the same on
  returning to the tab. `ENDED` is deliberately excluded; replaying the song that just
  finished is the one thing that must not happen.
- **`onError` → `POST /api/queue/:id/failed` → mark failed, advance immediately, never
  retry.** Non-embeddable uploads are common; without this the station dies mid-morning
  looking like a queue bug.

The failed-video route is open to **any** signed-in listener, because any listener's player
is where the error surfaces and a broken video is a fact about the video, not an ownership
action. Three guards keep it narrow: the item must be `player_state.current_item`, the
reported `videoId` must match that row, and the status update is conditional on `pending`. A
stale report returns `{advanced: false}` with HTTP 200 — with several people watching, being
second is normal, not an error.

*Accepted trade-off, recorded deliberately:* a determined user could call this to force a
skip they are not entitled to. It is bounded to one song per call. Error recovery is
mandatory, and the trust model is six known colleagues in one room.

---

## 11. UI structure

One page at `/`. There is no admin page, because there is no admin.

```
AuthGate            three-branch login (session → device → picker)
SignedIn            the signed-in page
├── header
│   ├── brand ("Title")
│   ├── WeatherReadout      icon · temp · WMO label · wind · city
│   ├── ThemePicker         Regular / Unusual groups
│   └── AccountMenu         avatar, name, sign out, owner's Reset a PIN
├── station column
│   ├── NowPlaying          full-width 16:9 screen, details centred beneath
│   │   ├── YouTubePlayer   the iframe + dead-air cover
│   │   └── SpeakerToggle   Unmute / Mute + volume
│   └── Queue               the whole day, one scrolling list
└── AddSongForm             right column: URL, "Show my name", Add
```

`Sky` renders behind everything as a fixed layer.

### Three boxes

The player, the queue, and the add form are three separate panels — three different things
to look at. The first two stack in the left column; the add form stands alone on the right
and is ordered **first on narrow screens**, since pasting a link is what people open the app
on a phone to do.

### The queue list

`components/Queue.tsx` — one list holding the whole day, read downward: past, current,
future.

- **The current position is always a row, even in silence.** When nothing is on air it is an
  empty dashed card, and the ▶ cursor still points at it. This is what keeps the list
  anchored to *now* rather than sliding down to the last thing that played. The station has
  a position whether or not it has a song.
- **Rest position**: one past song at the top edge, the current position directly below,
  future underneath. Everything older is parked above the fold.
- Scroll freely; when the pointer leaves, it settles back after 400 ms. The settle callback
  first confirms `:hover` is genuinely gone — removing an element from under the cursor (a
  reveal button being spent) fires a spurious leave that would otherwise scroll the list.
- It never re-settles while the pointer is inside it.
- `overflow-anchor: none`, or the browser's own scroll anchoring fights the settle logic.
- A `.tail` spacer follows the last card, or the last row can never reach the top edge and
  the rest position is unreachable.
- The scrollbar is hidden. A faded "↑ Scroll to see past" overlays the top and fades out
  once you reach it.
- The **current song is reassembled client-side** from `playing` via `playingAsRow()`, since
  `/api/state` deliberately excludes it from `upNext`. It invents no identity: `isMine`
  comes from `canSkip`, `canRemove` is false.
- Name and reveal button share **one slot at the top right of each card**, so spending a
  ticket swaps one for the other in place rather than reflowing the card.
- The reveal name is taken from the POST response, not the refresh that follows — one round
  trip instead of two. The local override can only *add* a name the server already agreed to
  hand over.

### Dead air

When the queue is empty, YouTube's idle screen (a black rectangle with a play button) is
covered by analog snow, a slow rolling band, and a dark **OFF AIR** tally. It is a **sibling
laid over the player**, never a change to it, so the never-hide rule holds. Purely visual —
nothing makes a sound.

**Nothing covers the player between songs.** YouTube's poster and end screen show there and
cannot be suppressed by any player option — `controls: 0` does not reach the pre-playback or
end states, `rel: 0` now only means "suggestions from this channel", and `modestbranding` was
retired by YouTube. Covering was tried and rejected: it read as more broken than the chrome.

### Design language

- **Structure is square, actions are round.** Panels, cards, dialogs, fields and banners
  carry no radius; only things you press do. `--radius` is a *control* token.
- Panels are opaque glass (`--panel-glass`, alpha 0.82) with `backdrop-filter`, floating
  over the background. Deliberately opaque: text contrast must never depend on the weather.
- `--ink-on-background` / `--ink-shadow` cover the little text that sits on the background
  rather than on a panel — currently just the title.

---

## 12. Themes

`components/ThemePicker.tsx`. **Placeholder — only `weather` is built.**

Selecting one writes `data-theme` on `<html>`. That is the hook every future theme hangs
off: a stylesheet keyed on `:root[data-theme='cyberpunk']` needs no component changes. Until
those stylesheets exist, the attribute changes and nothing else does.

| Group | Themes |
|---|---|
| Regular | Light, Dark, Cozy |
| Unusual | Weather, Iridescent, Heaven, Fantasy, Cyberpunk, Responsive |

Not persisted; a reload returns to Weather.

---

## 13. The weather background

`components/Sky.tsx` + `lib/weather.ts`.

The room shares one speaker, one queue and one playhead — and one window. So the background
is the actual weather over Ulaanbaatar.

- **Open-Meteo**, chosen because it needs no API key and no account: no sixth env var, no
  secret that could reach a client bundle, nothing to rotate.
- Coordinates hardcoded to Sükhbaatar Square (47.9188, 106.9176). Multi-room is out of
  scope, so a configurable location would be inventing a requirement.
- **`/api/weather` is deliberately separate from `/api/state`.** State is polled every 3s per
  listener; weather moves on the order of an hour. Cached 900s via Next's Data Cache, which
  on Vercel is shared across invocations — that is what keeps it legal under the
  no-module-level-state rule.
- **`loadSky()` never throws.** An unreachable forecast returns a neutral overcast sky with
  `live: false`. The radio does not depend on the weather.
- Palettes **compose rather than multiply**: four sun phases (night/dawn/day/dusk) set the
  sky, seven conditions tint the film and decide what falls. Writing all 28 combinations
  would be unmaintainable and most would be near-identical.
- `sunProgress` (0 at sunrise, 1 at sunset, null once down) is computed server-side, so the
  client places the sun without a clock of its own — the same reasoning as `serverTime`.
- `label` is a **separate field from `condition`**: the art needs seven states, the readout
  is worth being precise in. "Light drizzle" tells you something "rain" does not.
- Everything animated is a transform or opacity on a large layer. Precipitation is two
  translating sheets, not particles. `prefers-reduced-motion` stops all of it.

---

## 14. Environment

Five variables, none with a `NEXT_PUBLIC_` prefix.

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
YOUTUBE_API_KEY=
SESSION_SECRET=            # 32+ chars
TZ_OFFSET=Asia/Ulaanbaatar # an IANA zone name, despite the name
```

**Read lazily through getters**, not validated at import. A missing key fails loudly at the
point of use with a message naming the variable, while still letting the app boot,
`next build` run, and `/api/health` report *which* variable is missing. `envStatus()`
provides the non-throwing report.

`TZ_OFFSET` holds a zone name rather than a numeric offset. Kept under the spec's name so
deployment config matches the document; the mismatch is commented in `lib/env.ts`.

---

## 15. Testing

Narrow and deliberate, not blanket coverage.

**Unit (`npm test`, Vitest)** — 54 tests over pure logic: URL parsing, ISO-8601 duration,
round-robin ordering, `resolveState()` against a fake repo with an injected clock, position
and drift math. `server-only` is aliased to a stub in `tests/stubs/`.

**Integration (`npm run verify`)** — 252 assertions across eight bash suites run against the
running app and a real database:

| Suite | Assertions |
|---|---|
| `auth-test` | 34 |
| `queue-test` | 32 |
| `timeline-test` | 32 |
| `player-test` | 23 |
| `ownership-test` | 30 |
| `reveal-test` | 31 |
| `sync-static` | 16 |
| `audit` | 54 |

`audit.sh` walks the spec's landmine checklist against the actual code — including greps of
`.next/static` proving no secret reaches a client bundle.

### Two things to know before running `npm run verify`

1. **It resets the database.** Every suite that writes refuses to start unless
   `VERIFY_WIPE_OK=1` is set. There is no default that deletes anything.
2. **A browser tab open on the dev server breaks it.** The tab polls `/api/state` and
   cold-starts the station the instant a reset clears it, which then makes `DELETE FROM
   queue` fail on the `player_state.current_item` foreign key. `run-all.sh` retries the reset
   five times and aborts with an explanation if it keeps losing.

There are no UI tests. Manual verification against the phase exit criteria is the documented
posture at this scale.

---

## 16. Deliberately not built

Considered and rejected, with the reasons recorded:

| Not built | Why |
|---|---|
| Admin / controller / host role | Unsolvable: must be both always-claimable and hard-to-claim |
| Per-person pending cap | Context-blind; round-robin replaces it |
| Vote-skip | Deferred |
| Play-count-based fairness | Deferred; the upgrade path for round-robin |
| Supabase Realtime | Polling is sufficient at six people |
| Spotify / SoundCloud | YouTube only |
| Email signup, OAuth, password reset | PIN only |
| WiFi / IP restriction | Broken by NAT |
| Fallback playlist for an empty queue | Silence is correct |
| Crossfade / gapless | Not achievable through the IFrame API |
| Global pause / play / seek | It's a radio |
| Multi-room, multi-tenant | Single-tenant by design |

---

## 17. Known limitations

- **Sync is simulated, not true.** Each browser runs an independent YouTube player against a
  shared clock. Expect everyone within about a second, limited by `seekTo()` keyframe
  granularity, buffering and jitter. This is fine because only one machine is unmuted.
- **Every open tab streams**, not just the speaker machine. That is the bandwidth cost of
  the always-live model, traded away knowingly and offset by requesting the smallest stream.
- **Round-robin balances the pending backlog, not the day.** Early arrivals get more airtime.
- **The reveal budget has a race** on two simultaneous reveals of different songs.
- **Creator end screens cannot be removed.** They are part of the video, not the chrome.
- **Six browser behaviours have never been verified** by any script — audio starting at the
  live position, two browsers landing within ~1s, the iframe surviving a transition,
  transition latency, drift correction firing, and pause-resume jumping to live. They need a
  human with the app open.
- **The design work from 2026-08-17 onward has not been seen in a browser** by the agent that
  wrote it. Build, lint, typecheck and tests are clean, but appearance is unverified.

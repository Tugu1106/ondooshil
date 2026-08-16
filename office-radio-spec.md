# Office Radio — Build Specification (MVP)

> **For the implementing agent:** This document is the complete spec. Every decision here
> was deliberated and settled; the rationale is included so you don't "improve" something
> back into a problem it was designed to avoid. Where a section says **WHY**, that
> constraint is load-bearing. If something is genuinely ambiguous, prefer the simplest
> reading and leave a `TODO:` comment rather than inventing a feature.

---

## 1. What this is

A private web app for a single office room of 5–6 people who share one speaker.

Members paste YouTube links into a shared queue. The app behaves like a **radio
station**: there is one continuous broadcast, the server decides what is playing and
where the playhead is, and every member's browser tunes into that same position.
One person leaves their audio unmuted so the room hears it through the speaker;
everyone else mutes locally.

It is not public, not multi-tenant, and will never have more than about ten users.

### The mental model that drives every decision

**It is a radio, not a music player.**

- A radio has no admin. There is no owner, no controller, no dashboard, no roles.
- You cannot pause a radio. You can only mute your own speaker.
- The broadcast exists independently of who is listening.
- Tuning in mid-song is normal and expected.

**WHY this matters:** An earlier version of this design had an admin role that owned
playback. It created an unsolvable problem — the role had to be always-claimable
(or music stops when someone goes home) *and* hard to claim (because it exposed who
queued which song). Deleting the role deleted both problems. Do not reintroduce
an admin, a controller, a "host", or a permissions hierarchy.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript |
| Hosting | Vercel (free tier) |
| Database | Supabase Postgres |
| DB access | Server-side only, via service role key |
| Sessions | `iron-session` (signed, encrypted cookies) |
| PIN hashing | `bcrypt` |
| Playback | YouTube IFrame Player API |
| Metadata | YouTube Data API v3 (`videos.list`) |
| Sync | HTTP polling (3s) + client-side `setTimeout` scheduling |
| UI language | English |

### Hard rules about the stack

- **All database access is server-side**, in route handlers or server components, using
  the Supabase service role key. Never use the Supabase client from the browser.
- **Do not use Supabase Auth, and do not enable RLS.** Auth here is custom cookie
  sessions with PINs. RLS expects Supabase Auth JWTs; marrying the two is wasted effort.
  Supabase is being used as *plain Postgres with a good dashboard*, nothing more.
- **Do not use Supabase Realtime in the MVP.** Polling every 3 seconds with six users is
  roughly two requests per second — negligible — and it avoids an entire class of
  subscription lifecycle bugs. The schema is designed so Realtime can be added later
  without migration.
- **No local/file/in-memory persistence.** Vercel is serverless with a read-only
  filesystem and ephemeral containers. SQLite, JSON files, and module-level state will
  all appear to work in dev and fail in production.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Client (browser, one tab per person)                    │
│                                                          │
│  • YouTube IFrame player, hidden-but-mounted             │
│  • Local mute / volume (never touches the server)        │
│  • Computes its own playhead from server clock           │
│  • Polls /api/state every 3s                             │
│  • setTimeout scheduled for the next song transition     │
└───────────────────────┬──────────────────────────────────┘
                        │  HTTP only
┌───────────────────────▼──────────────────────────────────┐
│  Next.js route handlers on Vercel                        │
│                                                          │
│  • resolveState()  ← the heart of the system             │
│  • Round-robin selection of the next song                │
│  • YouTube Data API validation on add                    │
│  • Session + PIN auth                                    │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│  Supabase Postgres                                       │
│  users · queue · player_state · reveals                  │
└──────────────────────────────────────────────────────────┘
```

**The server owns the playhead.** `player_state` stores which song is current and the
timestamp it started. Clients do not decide what plays; they read that state and seek
themselves into position. This is what makes "no admin" possible — the schedule is
deterministic, so nobody needs authority over it.

### On sync accuracy

True frame-accurate sync is not achievable and is not required. A real livestream syncs
because everyone pulls identical CDN segments; here each browser runs an independent
YouTube player, so this is *simulated* sync via a shared clock. Expect everyone to land
within about a second of each other, limited by `seekTo()` keyframe granularity,
buffering, and network jitter.

That is fine, because **only one machine in the room is unmuted.** Sync only needs to be
close enough that the "now playing" display is correct and that handing the speaker to
another person feels continuous. Do not spend effort chasing millisecond accuracy.

---

## 4. Data model

All timestamps are `timestamptz`. The office is in **Asia/Ulaanbaatar (UTC+8)**; all
day-boundary logic uses that timezone.

```sql
create table users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  pin_hash   text,                      -- null until first claim
  is_owner   boolean not null default false,
  created_at timestamptz not null default now()
);

create table queue (
  id           uuid primary key default gen_random_uuid(),
  video_id     text not null,           -- 11-char YouTube id
  title        text not null,
  duration_sec integer not null,        -- required by the timeline
  added_by     uuid not null references users(id),
  show_name    boolean not null default false,
  status       text not null default 'pending',
    -- pending | playing | played | skipped | failed
  day          date not null,           -- computed server-side in Asia/Ulaanbaatar
  created_at   timestamptz not null default now()
);

create index on queue (day, status);
create index on queue (day, added_by, created_at);

create table player_state (
  id           integer primary key default 1,   -- single row, always id = 1
  current_item uuid references queue(id),
  started_at   timestamptz,
  constraint single_row check (id = 1)
);

insert into player_state (id) values (1);

create table reveals (
  user_id       uuid not null references users(id),
  queue_item_id uuid not null references queue(id),
  day           date not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, queue_item_id)
);

create index on reveals (user_id, day);
```

### Notes on the schema

- **`added_by` is always stored**, even for anonymous songs. It is needed for round-robin
  ordering, for adder-only skip/remove, and for the reveal feature. Anonymity is a
  *display* concern, enforced in the API response — never omit the column.
- **`day` is written at insert time** by the server, not computed in queries. This keeps
  the daily-reset filter simple and indexable.
- **`duration_sec` is mandatory.** The timeline is arithmetic over durations; a null
  duration would freeze the station permanently. This is why live streams are rejected.
- **`player_state` is a single enforced row.** Never insert a second one.

---

## 5. Authentication

There is no email, no signup, no password. Six known people, seeded by name.

### Cookies — there are two, and they do different jobs

| Cookie | Lifetime | Contents | Purpose |
|---|---|---|---|
| `device` | 10 years | `userId` | Remembers who last used this machine. **Not proof of identity.** |
| `session` | 30 days | `userId` | Signed session. **This is the only thing that authorizes actions.** |

**WHY two cookies:** the design goal is that re-identifying as *yourself* is frictionless
while claiming *someone else's* name requires their PIN. That is only possible if the
device remembers your previous identity after the session expires. With one cookie, every
expiry would dump everyone back to a full name picker.

### Flow

```
Request arrives
├─ valid `session`? ────────────────────► authenticated, done
│
├─ no session, `device` cookie present:
│    Show: "You're {name} — Continue"  + small "Not you?" link
│    ├─ Continue  ──► new session, NO PIN REQUIRED
│    └─ Not you?  ──► full name picker (below)
│
└─ no session, no device cookie:
     Full name picker
     ├─ chosen user has pin_hash  ──► require PIN
     └─ chosen user has no pin_hash ─► first claim: user SETS their 4-digit PIN
```

On successful auth, set **both** cookies.

### Rules

- PINs are 4 digits, hashed with bcrypt. **Never store a PIN in plaintext.**
- Rate limit: **5 failed attempts per user → 15 minute lockout.** A 4-digit PIN is 10,000
  combinations; without a limit it is decorative. A simple `failed_attempts` +
  `locked_until` pair on `users`, or an in-DB attempts table, is fine.
- The authenticated `userId` **always comes from the session cookie**, server-side.
  Never accept a `userId` from a request body. This is the single most important
  security rule in the app; violating it lets anyone act as anyone.
- Any user with `is_owner = true` can reset another user's `pin_hash` to null (so they
  set a new one on next login). Needed because someone will forget their PIN, and because
  a mis-tapped name on day one otherwise locks a PIN onto the wrong person.
- **Seed with placeholder names** (`User 1` … `User 6`). The real names get edited
  directly in the Supabase table editor.

---

## 6. The timeline — the core of the system

This is the part with real edge cases. Read it fully before implementing.

### State

`player_state.current_item` + `player_state.started_at` define the broadcast. Everything
else is derived.

### `resolveState()` — called on every `/api/state` request

```
resolveState():
  state = SELECT * FROM player_state WHERE id = 1

  # Case A: nothing playing — try a cold start
  if state.current_item is null:
      next = pickNext()
      if next is null:
          return { playing: null, queue: [...] }      # silence
      setCurrent(next, startedAt = now())             # COLD START
      return current state

  item = SELECT * FROM queue WHERE id = state.current_item
  elapsed = now() - state.started_at

  # Case B: still playing
  if elapsed < item.duration_sec:
      return current state

  # Case C: current song has finished
  mark item as 'played'
  overshoot = elapsed - item.duration_sec
  next = pickNext()

  if next is null:
      setCurrent(null, startedAt = null)              # go silent
      return { playing: null, queue: [...] }

  if overshoot < 30 seconds:
      # normal back-to-back transition — keep the timeline exact
      setCurrent(next, startedAt = state.started_at + item.duration_sec)
  else:
      # a gap happened (lunch, everyone closed their tabs)
      setCurrent(next, startedAt = now())             # COLD START

  return current state
```

### The three rules that make this correct

**1. Normal transitions accumulate; they do not use `now()`.**
`started_at + duration` is exact. Using `now()` adds the poll delay to every single
transition, and that error compounds — after twenty songs the station is a minute
adrift from where the arithmetic says it should be.

**2. Large overshoots cold-start instead of chaining.**
Without the 30-second rule, the office comes back from a one-hour lunch and the server
computes that fifteen songs "played" while nobody was listening, silently burning the
entire queue. The 30-second threshold distinguishes "a poll arrived slightly late"
from "nobody was here." At most one song is lost to a gap.

**3. Advance at most one song per call.**
Do not loop. Successive 3-second polls handle successive songs naturally, and a bounded
single step makes rule 2 easy to reason about.

### Concurrency

Several clients poll at once and may all try to advance the same song. Use an optimistic
conditional update:

```sql
UPDATE player_state
SET current_item = $new, started_at = $ts
WHERE id = 1 AND current_item = $expected_old;
```

If zero rows are affected, another request already advanced. Re-read `player_state` and
return that instead of retrying the advance. Never advance unconditionally.

### `pickNext()` — round-robin ordering

```sql
SELECT * FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY added_by ORDER BY created_at
  ) AS turn
  FROM queue
  WHERE status = 'pending' AND day = $today
) t
ORDER BY turn, created_at
LIMIT 1;
```

Everyone's 1st pending song plays, then everyone's 2nd, and so on. Ties broken by who
pasted first — deterministic, so the "up next" list is stable and never reshuffles
under the user.

**Behaviour worth understanding:**
- One person adding → one partition → collapses to plain FIFO. Someone alone in the
  office at 8am is never throttled.
- Two people adding → alternates between them.
- If Bat pastes 15 songs and Sara pastes 1, Sara's plays **second**.

**WHY round-robin and not a per-person cap:** a cap ("max 5 pending") is context-blind —
it blocks Bat's 6th song at 8am when he is alone and there is nobody to be fair to.
Round-robin only constrains someone when another person actually wants a turn.
**Do not implement a pending cap. There is no limit on how many songs a person may queue.**

*Known limitation, accepted:* this balances the pending backlog, not the whole day.
Someone who arrives at 9am accumulates more total airtime than someone arriving at noon.
The upgrade (ordering by songs-already-played-today first) is deferred.

### The daily reset

The queue is a **daily** thing. It resets at **00:00 Asia/Ulaanbaatar**.

- **Implement as a date filter, not a deletion.** Every queue query includes
  `WHERE day = <today in UTC+8>`. No cron job, no scheduled function, no 3am failures,
  and history is preserved for debugging.
- Songs still pending at midnight are simply never selected again. This is intended:
  a fresh station every morning.
- **A song playing across midnight must finish.** The date filter applies to the *queue
  list* and to `pickNext()`, **not** to the lookup of `player_state.current_item`.
  Always resolve the current item by id.

### Empty queue

Silence. `current_item = null`. No fallback playlist, no looping, no filler. When
someone adds a song, the next `resolveState()` cold-starts it.

---

## 7. Client playback

### Clock skew — do not skip this

Clients must **never** use their own `Date.now()` for playhead math. Laptop clocks drift,
and one machine being 40 seconds off produces a bug that looks completely inexplicable.

1. `/api/state` returns `serverTime` in every response.
2. On first load the client computes `offset = serverTime - clientTime`, once.
3. All playhead math uses `clientNow + offset`.

### Position and seeking

```
position = (clientNow + offset) - started_at
player.loadVideoById({ videoId, startSeconds: position })
```

New listeners **join mid-song**, exactly like tuning into a live stream. Do not wait for
the next track — silence on open makes the app look broken.

### Transition scheduling

Do not rely on the 3-second poll to notice a song change; that makes transitions up to
3 seconds late. The client already knows the current song's start time and duration, so
it knows exactly when the next transition happens:

- Set a local `setTimeout` for `duration - position`, and fetch `/api/state` at that moment.
- The 3-second poll then exists only to catch *unpredictable* changes: skips, removals,
  and songs added after a period of silence.
- Detect changes by comparing **`current_item` id**, not by watching position. A skip
  breaks the pure timeline arithmetic, so id comparison is the only reliable signal.

### Drift correction

Every 30 seconds, compare the player's actual position against the expected position.

- Off by **more than 2 seconds** → `seekTo()` the correct position.
- Off by **2 seconds or less** → do nothing. Seeking is audibly jarring and not worth it.

### Player element

The YouTube iframe must stay **mounted and visible** — it may be small and tucked away,
but `display: none` causes some browsers to pause playback. Never unmount it between
songs; call `loadVideoById` on the existing instance.

### Autoplay policy

Browsers block audio without a user gesture. The page opens **not listening**, with a
**🔊 Listen** button. Clicking it is the required gesture and starts playback.

This also serves a second purpose: six browsers streaming YouTube is six times the
bandwidth for audio only one speaker outputs, which is noticeable on shared office
internet. Defaulting to *watching the queue, not streaming it* means in practice only
one or two people ever turn audio on.

### Local controls

Mute and volume are **entirely client-side**. They never touch the server and never
affect anyone else. There is no global pause, no global play, no global seek.

If a user pauses locally and resumes, **resume means re-sync to the live position** —
not continue from where they paused. It is a radio.

### Error handling

On IFrame API `onError` (codes 101 / 150 — embedding disabled, and others):

1. Mark the queue item `failed`.
2. Advance immediately to the next song.
3. Do not retry.

**WHY this is mandatory:** non-embeddable videos are common (a lot of official music
uploads). Without this the station silently dies mid-morning and looks like a queue bug.

---

## 8. User actions and permissions

There are no roles. Permissions are ownership-based only.

| Action | Who |
|---|---|
| Add a song | Any authenticated user |
| Remove a song | Only the adder, and only while `status = 'pending'` |
| Skip a song | Only the adder of the currently playing song |
| Mute / volume | Anyone, locally, always |
| Reveal an adder | Anyone, 3 times per day |
| Reset a PIN | `is_owner` only |

### Skipping must be silent

Only the adder can skip their own song. Therefore **the UI must never announce who
skipped.** Showing "skipped by Bat" reveals that Bat added the anonymous song, for free,
completely bypassing the reveal-ticket system. The queue just moves on.

A skip sets `started_at = now()` for the new song (it is not a normal accumulating
transition).

---

## 9. Anonymity and reveal tickets

### Default

Songs are **anonymous by default**. The add form has a **"Show my name"** checkbox
(`show_name`). If ticked, the adder's name is displayed to everyone.

`added_by` is always stored in the database. The API is responsible for omitting the
name from responses when `show_name = false` and the requester has not revealed it.
**Do not send `added_by` to the client for songs it isn't entitled to see** — a hidden
field in a JSON payload is not hidden.

### Reveal tickets

- Each user gets **3 reveals per day**, resetting at 00:00 Asia/Ulaanbaatar.
- A reveal is **private to the person who spent it.** It is not announced to the room.
- Revealing the same song twice does not cost a second ticket — the primary key on
  `(user_id, queue_item_id)` makes this automatic.
- Reveals expire with the day, like the queue.

The purpose is social accountability for deliberately unlistenable songs, at a cost, so
it only happens when someone actually cares.

---

## 10. Adding a song — validation pipeline

```
POST /api/queue  { url, showName }
```

**1. Parse the video id.** Accept all of:

```
https://www.youtube.com/watch?v=VIDEOID
https://youtu.be/VIDEOID
https://www.youtube.com/shorts/VIDEOID
https://www.youtube.com/embed/VIDEOID
https://m.youtube.com/watch?v=VIDEOID
```

Strip extra query params. If the URL contains `&list=`, **take the single video and
discard the playlist.** Reject anything unparseable with a clear message.

**2. Call the YouTube Data API** (`videos.list`, `part=snippet,contentDetails,status`):

| Check | Rule |
|---|---|
| Video exists | Reject if the response has no items |
| `status.embeddable` | Must be `true`, else reject: "This video can't be embedded" |
| `contentDetails.duration` | Parse ISO 8601. Reject if **> 10 minutes** |
| `snippet.liveBroadcastContent` | Must be `'none'`. Reject live and upcoming streams |

**WHY reject live streams:** they have no duration, and the entire timeline is arithmetic
over durations. One live stream would freeze the station forever.

**3. Insert** with `duration_sec`, `title` (from `snippet.title`), `added_by` from the
session, `show_name`, `day` = today in UTC+8, `status = 'pending'`.

**Duplicates are allowed.** Do not deduplicate.

Quota note: the Data API free tier is 10,000 units/day and `videos.list` costs 1 unit.
Not a practical concern at this scale.

---

## 11. Routes and endpoints

### Pages

| Route | Purpose |
|---|---|
| `/` | Everything. Auth gate → add box + queue + Listen button |

A single page is sufficient. There is no admin page, because there is no admin.

### API

| Endpoint | Notes |
|---|---|
| `GET /api/state` | Calls `resolveState()`. Returns now-playing, `started_at`, `serverTime`, ordered queue, viewer's remaining reveals |
| `POST /api/auth/claim` | `{ userId, pin? }` → sets both cookies |
| `POST /api/auth/set-pin` | First-claim PIN setup |
| `POST /api/auth/logout` | Clears `session` (keep `device`) |
| `POST /api/queue` | `{ url, showName }` → validation pipeline above |
| `DELETE /api/queue/:id` | Adder only, pending only |
| `POST /api/queue/:id/skip` | Adder only, current song only |
| `POST /api/reveal/:id` | Spends a ticket, returns the name |
| `POST /api/owner/reset-pin` | `is_owner` only |

`GET /api/state` is the hot path — every client hits it every 3 seconds. Keep it to a
small number of queries.

---

## 12. UI notes

English. The **add flow must work well on mobile** (people sometimes paste from their
phones): large paste field, large tap targets, one-handed operation. The listening view
can assume desktop.

Rough shape of `/`:

- **Now playing** — title, progress bar, adder's name only if `show_name` or revealed
- **🔊 Listen / Mute** toggle + volume slider (local only)
- **Add box** — URL field, "Show my name" checkbox, Add button
- **Up next** — round-robin ordered, each row with a remove button *only on your own
  pending songs*
- **Played today** — history for the current day, so people who were away can see what
  they missed
- **Reveal** — a small button on anonymous rows, showing remaining tickets (`2 left`)

---

## 13. Environment variables

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
YOUTUBE_API_KEY=
SESSION_SECRET=            # 32+ chars, for iron-session
TZ_OFFSET=Asia/Ulaanbaatar
```

Never expose the service role key or the YouTube key to the client. No `NEXT_PUBLIC_`
prefixes on any of these.

---

## 14. Build order

Each step should leave the app in a working state.

1. **Schema + seed** — tables, `player_state` row, 6 placeholder users
2. **Auth** — name picker, PIN set/verify, both cookies, rate limiting. *You can log in.*
3. **Add a song** — URL parsing, Data API validation, insert
4. **Queue view** — round-robin ordering, 3s polling
5. **Player** — IFrame API, `resolveState()`, cold start, accumulating transitions, `onError`
6. **Sync polish** — clock offset, `setTimeout` transitions, drift correction
7. **Ownership actions** — remove own pending, skip own current
8. **Anonymity + reveals** — checkbox, ticket accounting, server-side name omission
9. **Deploy** to Vercel

Steps 1–5 are a working radio station. Realistically two evenings.

---

## 15. Explicitly out of scope

Do not build these. They were considered and deliberately deferred or rejected.

| Not building | Status |
|---|---|
| Admin / controller / host role | **Rejected by design.** Do not reintroduce. |
| Per-person pending cap | **Rejected** — round-robin replaces it |
| Vote-skip | Deferred to v2 |
| Play-count-based fairness | Deferred — upgrade path for round-robin |
| Supabase Realtime | Deferred — polling is sufficient |
| Spotify / SoundCloud | Rejected — YouTube only |
| Email signup, OAuth, password reset | Rejected — PIN only |
| WiFi / IP restriction | Rejected — broken by NAT |
| Fallback playlist when queue is empty | Rejected — silence is correct |
| Crossfade / gapless | Rejected — not achievable |
| Global pause/play/seek | Rejected — it's a radio |
| Multi-room, multi-tenant | Never |

---

## 16. Landmine checklist

Verify each of these before calling the MVP done. Every one caused a specific,
hard-to-diagnose bug during design.

- [ ] `/api/state` returns `serverTime`; clients use offset-corrected time everywhere
- [ ] Normal transitions use `started_at + duration`, **never** `now()`
- [ ] Overshoot > 30s cold-starts instead of chaining through the backlog
- [ ] `player_state` updates are conditional on the expected `current_item`
- [ ] Clients detect changes by comparing `current_item` id, not position
- [ ] `onError` marks `failed` and advances — station never stalls on a bad video
- [ ] Live streams and videos over 10 minutes rejected at add time
- [ ] Skips are silent — no "skipped by X" anywhere in the UI
- [ ] `added_by` never sent to clients for un-revealed anonymous songs
- [ ] Day filter applies to the queue list, **not** to the current-item lookup
- [ ] `userId` read from the session cookie only, never from a request body
- [ ] PINs bcrypt-hashed, 5-attempt lockout in place
- [ ] YouTube iframe stays mounted and visible; never `display: none`
- [ ] Audio starts only after the user clicks Listen
- [ ] All Supabase access is server-side; no service role key in client bundles

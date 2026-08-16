# Office Radio — agent context

Private web app for one office room (~6 people, one shared speaker). Members paste
YouTube links into a shared daily queue. The **server owns the playhead**; every browser
tunes itself to that position. One machine stays unmuted for the room.

**Full spec: [office-radio-spec.md](office-radio-spec.md) — it is the authority. This file is a digest, not a replacement.**

## Session protocol

This project is built **one phase per session**. At the start of a session:

1. Read [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) — find the first phase not marked done.
2. Read [docs/PROGRESS.md](docs/PROGRESS.md) — decisions, deviations, and open TODOs from prior sessions.
3. Re-read the spec sections that phase names. Do not work from this digest alone.
4. Build **only that phase**. Do not pull work forward from later phases.

At the end of a session: verify the phase's exit criteria, update `docs/PROGRESS.md`
(status, decisions, deviations, notes for the next phase), and stop.

## The mental model

**It is a radio, not a music player.** No admin, no owner-of-playback, no controller, no
host, no roles, no permissions hierarchy. You cannot pause a radio — you can only mute
your own speaker. The broadcast exists independently of who is listening, and tuning in
mid-song is normal.

An earlier design had an admin role; it had to be both always-claimable and hard-to-claim,
which is unsolvable. Deleting the role deleted the problem. **Do not reintroduce it.**

## Non-negotiables

Every one of these caused a specific hard-to-diagnose bug during design.

**Timeline**
- Normal transitions set `started_at + duration_sec`. **Never `now()`** — poll latency compounds.
- Overshoot > 30s → cold-start at `now()`, so a lunch break doesn't silently burn the queue.
- Advance **at most one song per call**. Never loop.
- `player_state` updates are conditional: `WHERE id = 1 AND current_item = $expected`.
  Zero rows affected → someone else advanced; re-read and return, never retry the advance.
- Day filter applies to the queue list and `pickNext()`, **never** to resolving
  `current_item` — a song crossing midnight must finish.

**Security**
- `userId` comes from the session cookie, server-side, **always**. Never from a request body.
- `added_by` is never serialized for anonymous songs the requester hasn't revealed.
  A hidden field in a JSON payload is not hidden.
- Skips are silent. No "skipped by X" anywhere — only the adder can skip, so naming the
  skipper leaks authorship for free and defeats the reveal system.
- All Supabase access is server-side via the service role key. No key in a client bundle.
  No `NEXT_PUBLIC_` prefix on any secret.

**Client**
- Never use raw `Date.now()` for playhead math — use `serverTime` offset, computed once.
- Detect song changes by comparing `current_item` **id**, not position (a skip breaks the arithmetic).
- The YouTube iframe stays mounted and visible. `display: none` pauses playback in some browsers.
- Audio starts only after the user clicks **🔊 Listen** (autoplay policy + office bandwidth).
- `onError` → mark item `failed` and advance immediately. Never retry, never stall.

**Stack**
- No Supabase Auth. No RLS. No Realtime. Supabase is plain Postgres here.
- No filesystem, SQLite, JSON-file, or module-level state — Vercel is ephemeral.
- Reject live streams and videos > 10 minutes at add time (null/absent duration freezes
  the timeline permanently).

## Rejected by design — do not build

Admin/host role · per-person pending cap (round-robin replaces it) · vote-skip ·
Supabase Realtime · Spotify/SoundCloud · email/OAuth signup · WiFi/IP restriction ·
fallback playlist for an empty queue (silence is correct) · crossfade ·
global pause/play/seek · multi-room.

## Conventions

- Timezone for all day-boundary logic: **Asia/Ulaanbaatar (UTC+8)**. Use `lib/time.ts`.
- `day` is written server-side at insert time, never computed in queries.
- Shared API types live in `lib/types.ts`. The `/api/state` contract is defined in
  BUILD-PLAN.md §Contracts and is stable from Phase 2 onward — fields fill in over time,
  shapes do not change.
- Errors: `{ error: { code, message } }` with a real HTTP status.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

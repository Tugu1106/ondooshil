# Office Radio

A private web app for one office room. Members paste YouTube links into a shared daily
queue; the server owns the playhead and every browser tunes itself to that position. One
machine stays unmuted so the room hears it.

**It is a radio, not a music player.** There is no admin, no host, no controller, and no
global pause — you cannot pause a radio, you can only mute your own speaker. Tuning in
mid-song is normal.

- [office-radio-spec.md](office-radio-spec.md) — the specification, and the authority
- [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) — the nine phases and the `/api/state` contract
- [docs/PROGRESS.md](docs/PROGRESS.md) — what was built, every decision and deviation
- [docs/SETUP.md](docs/SETUP.md) — the out-of-repo setup, step by step

## Running it locally

```bash
npm install
cp .env.example .env.local     # then fill it in — see docs/SETUP.md
npm run dev
```

Open <http://localhost:3000/api/health>. You want HTTP 200 with `db: "ok"` and `users: 6`.

| Command | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests — timeline, ordering, parsing, sync maths |
| `npm run verify` | End-to-end suites against a running dev server (**resets the database**) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

`npm run typecheck` needs `.next/types`, which only exist after a build — on a fresh clone,
build first.

## Environment

Five variables, all server-side. **None may ever carry a `NEXT_PUBLIC_` prefix** — that
prefix is exactly what puts a value into the browser bundle.

| | |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The **secret** key, not `anon`/publishable |
| `YOUTUBE_API_KEY` | YouTube Data API v3, restricted to that API |
| `SESSION_SECRET` | 32+ chars. Generate a **separate one for production** |
| `TZ_OFFSET` | IANA zone name — `Asia/Ulaanbaatar`. Named for the spec; it is a zone, not an offset |

## Database

Supabase is used as plain Postgres: no Supabase Auth, no Realtime. Every query runs
server-side under the service role key.

Run these once, in order, in the Supabase SQL editor:

1. `supabase/migrations/0001_init.sql` — the four tables
2. `supabase/migrations/0002_enable_rls.sql` — deny-all RLS, zero policies
3. `supabase/seed.sql` — six placeholder users

All three are safe to re-run.

The advisor will report `rls_enabled_no_policy` at INFO level for all four tables. **That
is the intended end state.** RLS is on so the public `anon` key cannot reach the tables
through PostgREST; `service_role` bypasses RLS, which is why the app needs no policies. Do
not add policies to silence it.

## Deploying

See [docs/SETUP.md](docs/SETUP.md) Group C. In short: push to GitHub, import to Vercel, set
all five variables for Production, Preview and Development, deploy, then check
`/api/health` on the live URL.

`vercel.json` pins functions to `icn1` (Seoul) to match the database region. Vercel's
default is Washington DC, which would put a trans-Pacific round trip in front of every
query — and `/api/state` runs about five of them, every three seconds, per listener.

## Running the room

**Replace the placeholder names first.** In Supabase → Table Editor → `users`, edit each
`name`. Do it *before* anyone claims a name, or somebody sets a PIN on the wrong row.

Each person then picks their name once and sets a 4-digit PIN. After that the machine
remembers them: logging out still offers "You're *name* — Continue" with no PIN, while
claiming somebody *else's* name always costs theirs.

**Forgotten PIN?** The `is_owner` user has a "Reset a PIN" panel. That is the only power
the flag grants — it is not an admin role. Failing that, null the row's `pin_hash` in the
table editor and they will set a new one on next sign-in.

**Nothing is playing?** That is correct when the queue is empty. Silence is the intended
state; there is no fallback playlist. Add a song and the next poll starts it.

**A song that will not play** is marked `failed` and the station moves on by itself.
Non-embeddable uploads are common, which is why this is automatic.

**The queue resets at midnight**, Asia/Ulaanbaatar. It is a date filter, not a deletion, so
nothing is lost and a song playing across midnight still finishes.

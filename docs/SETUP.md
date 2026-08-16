# Office Radio — setup checklist

Everything that has to happen **outside the repo**. The code cannot do these for you, and
a cold agent session cannot see whether they are done — so record the outcome in
[PROGRESS.md](PROGRESS.md) as you go.

Three groups, needed at different times:

| Group | Needed before | Time |
|---|---|---|
| A — Supabase + local env | Phase 1 (auth) | ~5 min |
| B — YouTube Data API key | Phase 2 (add a song) | ~5 min |
| C — Vercel deploy | Phase 8 | ~10 min |

---

## Group A — Supabase and local environment

> **Status: A1–A3 are already done.** The project `office-radio`
> (`https://ohmdbowbbtzwyowcdotk.supabase.co`, ap-northeast-2 / Seoul) exists, both
> migrations are applied, and the six users are seeded — all via the Supabase connector on
> 2026-08-16. Steps A1–A3 are kept below for reference and for rebuilding from scratch.
> **Start at A4.**

### A1. Create the Supabase project

1. Go to <https://supabase.com> and sign in (GitHub sign-in is fastest).
2. **New project**. Free tier, no credit card.
   - **Name**: anything, e.g. `office-radio`
   - **Database password**: generate one and save it in your password manager. You will
     not need it for this app — it is for direct Postgres connections — but it cannot be
     retrieved later, only reset.
   - **Region**: pick the one closest to the office. This is the single biggest lever on
     `/api/state` latency, and every client hits that endpoint every 3 seconds.
3. Wait for provisioning (1–2 minutes).

### A2. Create the tables

1. Left sidebar → **SQL Editor** → new query.
2. Open [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql), copy
   the **whole file**, paste, and **Run**.
3. Expect `Success. No rows returned`.
4. Verify: **Table Editor** should now list `users`, `queue`, `player_state`, `reveals`.
5. Click `player_state` — it must contain **exactly one row**, `id = 1`, with
   `current_item` and `started_at` both null. That row is the broadcast; the app never
   inserts a second one.
6. New query → run [`supabase/migrations/0002_enable_rls.sql`](../supabase/migrations/0002_enable_rls.sql)
   the same way. This is deny-all RLS with zero policies. Afterwards the security advisor
   reports `rls_enabled_no_policy` at **INFO** level for all four tables — that is the
   intended end state, not a problem to fix. Do not add policies to silence it.

### A3. Seed the six users

1. SQL Editor → new query.
2. Copy the whole of [`supabase/seed.sql`](../supabase/seed.sql), paste, **Run**.
3. Verify: **Table Editor → `users`** shows six rows, `User 1` … `User 6`.
   - `User 1` has `is_owner = true`, the rest `false`.
   - **Every `pin_hash` is null.** That is correct — each person sets their own PIN the
     first time they claim their name.

Both files are safe to re-run if a step half-fails.

### A4. Copy the API credentials

1. Left sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** (looks like `https://abcdefghijkl.supabase.co`).
3. Copy the **service role key**. Depending on how new your project is, this appears
   either as `service_role` (a long JWT starting `eyJ…`) or as a **secret key**
   (`sb_secret_…`). Either works.

> **Take the secret one, not the public one.** The key labelled `anon` / `publishable` is
> the browser-safe key and this app never uses it — every query runs server-side under the
> service role. If you paste the wrong one, `/api/health` will report an error rather than
> silently misbehaving.
>
> The service role key bypasses all database permissions. It goes in `.env.local` (which
> is git-ignored) and in Vercel's environment variables. Never in the repo, never in a
> `NEXT_PUBLIC_` variable, never in a screenshot.

### A5. Generate a session secret

Run in the project directory:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-character output. This signs and encrypts the session cookies; changing it
later logs everyone out, which is harmless.

### A6. Create `.env.local`

```powershell
Copy-Item .env.example .env.local
```

Open `.env.local` and fill in:

```
SUPABASE_URL=https://ohmdbowbbtzwyowcdotk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the service role / secret key from A4>
YOUTUBE_API_KEY=
SESSION_SECRET=<the 64 characters from A5>
TZ_OFFSET=Asia/Ulaanbaatar
```

Leave `YOUTUBE_API_KEY` blank for now — nothing reads it until Phase 2.

Rules: no quotes around values, no spaces around `=`, no trailing whitespace, and
`SUPABASE_URL` must start with `https://` and have **no trailing slash**.

### A7. Verify

```powershell
npm run dev
```

Then open <http://localhost:3000/api/health>. You are looking for **HTTP 200** and:

```json
{
  "db": "ok",
  "today": "2026-08-16",
  "serverTime": "2026-08-15T16:01:59.107Z",
  "timeZone": "Asia/Ulaanbaatar",
  "users": 6,
  "env": {
    "SUPABASE_URL": "ok",
    "SUPABASE_SERVICE_ROLE_KEY": "ok",
    "YOUTUBE_API_KEY": "missing",
    "SESSION_SECRET": "ok",
    "TZ_OFFSET": "default"
  }
}
```

Check all four:

- `db` is `"ok"` — the database is reachable
- `users` is `6` — the seed ran
- `today` matches the **actual date in Ulaanbaatar**, which may be tomorrow relative to
  `serverTime` — that is the point, not a bug
- `YOUTUBE_API_KEY: "missing"` and `TZ_OFFSET: "default"` are both expected right now

**Restart `npm run dev` after any edit to `.env.local`.** Next.js reads environment
variables at boot; editing the file while the server runs changes nothing.

### A8. Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `db: "unconfigured"` | URL or key missing/invalid — check the `env` block in the same response | Fill the blank one in `.env.local`, restart |
| `SUPABASE_URL: "invalid"` | Doesn't start with `https://` | Paste the Project URL, not the host name |
| `SESSION_SECRET: "invalid"` | Under 32 characters | Re-run A5, paste the whole output |
| `db: "error"`, message mentions `relation "users" does not exist` | The migration didn't run | Redo A2 |
| `db: "ok"` but `users: 0` | The migration ran, the seed didn't | Redo A3 |
| `db: "error"`, message mentions an invalid API key | You pasted the `anon`/publishable key | Redo A4 with the service role / secret key |
| `today` is a day behind | `TZ_OFFSET` was overwritten with something wrong | Set it back to `Asia/Ulaanbaatar`, restart |
| Everything `ok` but still 503 | Read `timeZoneError` in the response | Usually a typo'd zone name |

### A9. Record it

In [PROGRESS.md](PROGRESS.md) → **Environment state**, flip these to yes: Supabase project
created, migration applied, seed users created, `.env.local` populated. **Phase 1 is
unblocked once `/api/health` returns 200.**

---

## Group B — YouTube Data API key (before Phase 2)

Used server-side to validate a pasted link: does the video exist, is it embeddable, how
long is it, is it a live stream.

1. <https://console.cloud.google.com> → sign in.
2. Create a project (top bar project picker → **New project**), name it anything.
3. **APIs & Services** → **Library** → search **YouTube Data API v3** → **Enable**.
4. **APIs & Services** → **Credentials** → **Create credentials** → **API key**.
5. Copy the key into `YOUTUBE_API_KEY` in `.env.local`. Restart the dev server.
6. Optional but recommended: **Edit API key** → **API restrictions** → restrict to
   *YouTube Data API v3*. Leave **Application restrictions** as *None* — the calls come
   from a server whose IP you don't control, so an HTTP-referrer restriction would break it.

Quota: 10,000 units/day, and `videos.list` costs 1 unit per add. At six people this is
irrelevant; you would need ~10,000 songs in a day to notice.

No billing account is required for this API.

---

## Group C — Vercel deploy (Phase 8)

1. Push the repo to GitHub (private).
2. <https://vercel.com> → **Add New** → **Project** → import the repo. Framework is
   detected as Next.js; leave the build settings alone.
3. **Environment Variables** — add all five from `.env.local`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `SESSION_SECRET`,
   `TZ_OFFSET`. Apply to Production, Preview, and Development.
   - Same Supabase project as local, unless you want a separate production database.
   - **No `NEXT_PUBLIC_` prefixes.** That prefix is what puts a value in the browser bundle.
4. Deploy, then open `/api/health` on the deployed URL and confirm 200 / `db: "ok"` /
   `users: 6`.
5. Replace the placeholder names: Supabase **Table Editor → `users`** → edit the `name`
   cell of each row to a real person's name. Do this *before* anyone claims a name, so
   nobody sets a PIN on the wrong row.
6. Share the URL with the room. First visit for each person: pick your name, set a 4-digit
   PIN.

If someone forgets their PIN, the `is_owner` user resets it (an endpoint built in Phase 1),
or you null that row's `pin_hash` in the Table Editor. Either way they set a fresh PIN on
next login.

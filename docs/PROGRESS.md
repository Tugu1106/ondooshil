# Office Radio — Progress log

Mutable handoff between sessions. [BUILD-PLAN.md](BUILD-PLAN.md) is static; this file is
where each session records what actually happened.

**Update this at the end of every session**, before stopping.

## Status

| Phase | Status | Session date | Commit |
|---|---|---|---|
| 0 — Foundation & schema | done | 2026-08-16 | `e6c2508` |
| 1 — Auth | not started | | |
| 2 — Add a song & queue view | not started | | |
| 3 — Timeline engine | not started | | |
| 4 — Client player | not started | | |
| 5 — Sync & local controls | not started | | |
| 6 — Ownership actions | not started | | |
| 7 — Reveal tickets | not started | | |
| 8 — Hardening & deploy | not started | | |

Status values: `not started` · `in progress` · `done` · `done (with caveats — see below)`

## Environment state

Track what exists outside the repo, since a cold session cannot see it.

- Supabase project: **`office-radio`**, ref `ohmdbowbbtzwyowcdotk`, region **ap-northeast-2 (Seoul)**
  - URL: `https://ohmdbowbbtzwyowcdotk.supabase.co`
  - Postgres 17.6
- Migration applied to Supabase: **yes** — `0001_init` and `0002_enable_rls`, verified
- Seed users created: **yes** — 6 users, 1 owner, all `pin_hash` null
- YouTube Data API key obtained: **no** (not needed until Phase 2)
- `.env.local` populated: **yes**
- Vercel project: **not yet created**

An earlier project (`ondooshil`, ref `qjwgzfgiwpyvglabbrdt`, ap-southeast-2 / Sydney) was
set up first and then abandoned: Sydney is ~9,500 km from Ulaanbaatar against ~2,000 km
for Seoul. **It should be deleted** — if it still exists, it is not the project this app
uses. Do not point anything at `qjwgzfgiwpyvglabbrdt`.

### Phase 0 exit verification (2026-08-16)

`/api/health` returns **HTTP 200**:

```json
{"db":"ok","today":"2026-08-16","serverTime":"2026-08-16T07:31:19.702Z",
 "timeZone":"Asia/Ulaanbaatar","users":6,
 "env":{"SUPABASE_URL":"ok","SUPABASE_SERVICE_ROLE_KEY":"ok",
        "YOUTUBE_API_KEY":"missing","SESSION_SECRET":"ok","TZ_OFFSET":"ok"}}
```

All exit criteria met: app boots clean, database reachable, six users seeded, and the
station date is correct for Asia/Ulaanbaatar. `YOUTUBE_API_KEY: "missing"` is expected —
nothing reads it until Phase 2.

This response also confirms the RLS decision is safe in practice: RLS is on for all four
tables with zero policies, and the app still read `users` successfully, so `service_role`
does bypass RLS as intended. `npm run build`, `npm run typecheck`, and `npm run lint` all
pass clean.

## Decisions made during the build

Decisions the spec and plan did not settle. Append, never rewrite — a later session needs
to know what was already considered.

**Phase 0 (2026-08-16)**

- **Scaffold**: `create-next-app` refuses to write into a directory containing files, so
  it was run in a temp directory and the output copied in. Its generated `CLAUDE.md`,
  `AGENTS.md`, and `README.md` were deliberately **not** copied — ours is hand-written.
  Versions: Next 16.3.1 (Turbopack), React 19.2.8, TypeScript strict, `@/*` alias.
- **No Tailwind.** Plain CSS with a small token set in `app/globals.css`, plus
  `*.module.css` per component from Phase 2. One page, six components — a utility
  framework earns nothing here.
- **No `next/font/google`.** System font stack instead, so the build has no network
  dependency.
- **Env is read lazily through getters** (`lib/env.ts`) rather than validated once at
  import. See Deviations.
- **`server-only` package** guards `lib/env.ts`, `lib/db.ts`, and `lib/time.ts`. An
  accidental client import becomes a build error instead of a leaked service role key —
  this is the mechanical enforcement of the last §16 landmine.
- **`TZ_OFFSET` holds an IANA zone name**, not a numeric offset, despite the name. Kept
  under the spec's name so deployment config matches spec §13; the mismatch is commented
  in `lib/env.ts` and `.env.example`.
- **Day conversion goes through `Intl.formatToParts`**, not a hardcoded UTC+8, so it stays
  correct if Mongolia reintroduces DST (it last observed it in 2016). Assembled from parts
  rather than a locale string so the output is `YYYY-MM-DD` regardless of locale.
- **Extra CHECK constraints** in the migration beyond spec §4: the `status` vocabulary,
  `char_length(video_id) = 11`, and `duration_sec > 0`. These guard invariants the spec
  already states in prose; no behaviour change.
- **`User 1` is seeded as `is_owner`.** Commented in `seed.sql` that this grants exactly
  one power — resetting a forgotten PIN — and must never grow into an admin role.
- **Migrations are re-runnable** (`if not exists`, `on conflict do nothing`), so a partial
  setup can be repeated safely.
- **`next dev` appends a `<!-- BEGIN:nextjs-agent-rules -->` block to `CLAUDE.md`.** It is
  regenerated on every dev run; commit it rather than fighting it. It points at
  `node_modules/next/dist/docs/` — worth reading before writing Next-specific code, since
  Next 16 differs from older conventions.

## Deviations from the spec or plan

Anything built differently from what the documents say, **with the reason**. Empty is the
expected state; a deviation here is a flag, not a footnote.

- **RLS is enabled, contrary to spec §2 ("do not enable RLS") — with zero policies.**
  Decided by the user on 2026-08-16 after the Supabase security advisor returned four
  ERROR-level `rls_disabled_in_public` lints. The spec's reasoning is correct about
  *policies*: there is no `auth.uid()` to write one against, since identity lives in an
  iron-session cookie. It does not cover the deny-all case. With RLS off, every table is
  readable and writable through PostgREST by anyone holding the anon/publishable key — a
  key that is public by design. Enabling RLS with no policies denies anon and
  authenticated everything, while `service_role` (the only key this app uses) bypasses RLS
  entirely, so no application code changes. See `supabase/migrations/0002_enable_rls.sql`.
  Post-change advisors: the four ERRORs became four INFO `rls_enabled_no_policy` notices,
  which is the intended end state. **Do not "fix" those INFOs by adding policies.**

- **BUILD-PLAN Phase 0 says env vars are validated "at startup, fail loudly". They are
  validated at point of use instead.** Reason: the user is supplying keys after the build,
  and startup validation would mean the app cannot boot, `next build` cannot run, and
  `/api/health` cannot report *which* variable is missing. Loudness is preserved — reading
  a missing var throws `MissingEnvError` naming the variable and pointing at
  `.env.example`. `envStatus()` provides the non-throwing report for `/api/health`. This
  also suits Vercel, where build-time secret availability is not guaranteed.

## Open TODOs

`TODO:` comments left in the code for genuine ambiguities, and anything deferred.

_(none yet — no `TODO:` comments in the codebase)_

## Notes for later phases

Work spotted mid-session that belongs to a later phase. Recorded here instead of being
built early.

- **Phase 1 needs no migration.** `failed_attempts` and `locked_until` already exist on
  `users` from `0001_init.sql`.
- **Phase 1 dependency choice:** `iron-session` and a bcrypt implementation are not yet
  installed. Spec §5 says "bcrypt"; prefer **`bcryptjs`** — pure JS, no native module to
  compile, which matters on Vercel's build image. Same algorithm, so the spec's intent is
  met. Record the choice here when it is made.
- **Phase 2 needs `YOUTUBE_API_KEY`** in `.env.local`.
- **Phase 3 needs vitest installed** (not yet added — the plan defers it to that phase).
- `lib/types.ts` does not exist yet; Phase 2 creates it from BUILD-PLAN §Contracts.
- `npm run typecheck` depends on `.next/types`, which only exist after a `next build` or
  `next dev` run. On a clean clone, build before typechecking.

## §16 landmine audit (filled in at Phase 8)

| Item | Verified | Evidence |
|---|---|---|
| `/api/state` returns `serverTime`; clients use offset-corrected time | ☐ | |
| Normal transitions use `started_at + duration`, never `now()` | ☐ | |
| Overshoot > 30s cold-starts instead of chaining | ☐ | |
| `player_state` updates conditional on expected `current_item` | ☐ | |
| Clients detect changes by `current_item` id, not position | ☐ | |
| `onError` marks `failed` and advances | ☐ | |
| Live streams and >10min videos rejected at add time | ☐ | |
| Skips are silent — no "skipped by X" anywhere | ☐ | |
| `added_by` never sent for un-revealed anonymous songs | ☐ | |
| Day filter applies to queue list, not current-item lookup | ☐ | |
| `userId` read from session cookie only | ☐ | |
| PINs bcrypt-hashed, 5-attempt lockout in place | ☐ | |
| Iframe stays mounted and visible | ☐ | |
| Audio starts only after Listen is clicked | ☐ | |
| All Supabase access server-side; no service role key in client bundles | ☐ | |

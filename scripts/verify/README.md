# Verification suites

One script per build phase, asserting that phase's exit criteria against a **running dev
server and the real database**. Together with `npm test` (the pure-logic unit tests) these
are the evidence behind the phase records in [../../docs/PROGRESS.md](../../docs/PROGRESS.md).

```bash
npm run dev                          # in another terminal
VERIFY_WIPE_OK=1 npm run verify
```

The opt-in is not ceremony. Run against a database the office is using and the queue
empties mid-song, everyone's name comes back unclaimed, and test songs appear from
nowhere — which looks exactly like being hacked. Every suite that writes refuses to start
without it. (`sync-static.sh` only reads source files and is unguarded.)

> **These scripts reset the database** — the queue, all reveals, and everybody's PIN. They
> are development tooling. Never point them at the instance the office is using.

> **Close any browser tab open on the dev server first.** A live tab polls `/api/state`
> every three seconds, and cold-starting from silence is exactly what it is supposed to do —
> so it will restart the station in the middle of a reset and produce foreign-key errors
> and wandering counts that look like real failures. `run-all.sh` retries the reset and
> aborts with a clear message if it keeps losing that race, but the individual scripts do
> not.

| Script | Covers |
|---|---|
| `auth-test.sh` | Both cookies, first claim, the PIN-free Continue path, the 5-attempt lockout, owner reset |
| `queue-test.sh` | All five URL forms, each validation rejection, round-robin order, anonymity in the payload |
| `timeline-test.sh` | Cold start, exact accumulation over a real 19s wait, the lunch-break rule, concurrency, silence |
| `player-test.sh` | `onError` recovery and its guards, plus the player's static invariants |
| `ownership-test.sh` | Adder-only remove and skip, tested by calling the endpoints directly, and skip silence |
| `reveal-test.sh` | Three a day, free repeats, budget exhaustion, privacy between viewers |
| `sync-static.sh` | Timer cleanup, drift-loop dependencies, local controls making no network calls |
| `audit.sh` | The full spec §16 landmine checklist |

## Things to know before trusting a run

- **Each suite assumes a clean database.** `run-all.sh` resets between them. Running one
  directly after another without a reset will fail on setup, because the users already
  have PINs.
- **User ids are hardcoded** to the seeded rows of the current Supabase project. If the
  database is ever rebuilt from `supabase/seed.sql`, the uuids change and these need
  updating — `select id, name from users order by name`.
- **`timeline-test.sh` really waits 19 seconds** for a song to end. That is the point: it
  is the only way to prove transitions accumulate rather than using `now()`.
- **They spend YouTube API quota** — roughly 20 units per full run, out of 10,000 a day.
- Checks that scan source code strip comments first. Several files *document* a rule they
  must not break (`display: none`, `Date.now()`, "skipped by"), and prose describing a rule
  must never be mistaken for a violation of it.

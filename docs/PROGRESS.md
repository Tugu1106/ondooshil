# Office Radio — Progress log

Mutable handoff between sessions. [BUILD-PLAN.md](BUILD-PLAN.md) is static; this file is
where each session records what actually happened.

**Update this at the end of every session**, before stopping.

## Status

| Phase | Status | Session date | Commit |
|---|---|---|---|
| 0 — Foundation & schema | done | 2026-08-16 | `6969456` |
| 1 — Auth | done | 2026-08-16 | `5cf9b18` |
| 2 — Add a song & queue view | done | 2026-08-16 | `951f6d8` |
| 3 — Timeline engine | done | 2026-08-16 | `6f8c759` |
| 4 — Client player | done (with caveats — see below) | 2026-08-16 | `a8500c8` |
| 5 — Sync & local controls | done (with caveats — see below) | 2026-08-16 | `203873f` |
| 6 — Ownership actions | done | 2026-08-16 | `4896e21` |
| 7 — Reveal tickets | done | 2026-08-16 | `8449216` |
| 8 — Hardening & deploy | code done; deploy is the user's step | 2026-08-16 | `5c058e4` |

Status values: `not started` · `in progress` · `done` · `done (with caveats — see below)`

## Environment state

Track what exists outside the repo, since a cold session cannot see it.

- Supabase project: **`office-radio`**, ref `ohmdbowbbtzwyowcdotk`, region **ap-northeast-2 (Seoul)**
  - URL: `https://ohmdbowbbtzwyowcdotk.supabase.co`
  - Postgres 17.6
- Migration applied to Supabase: **yes** — `0001_init` and `0002_enable_rls`, verified
- Seed users created: **yes** — 6 users, 1 owner, all `pin_hash` null
- YouTube Data API key obtained: **yes** — restricted to *YouTube Data API v3*, application
  restrictions deliberately **None** (server-side calls have no referrer, and Vercel's
  outbound IP is not fixed). Verified 2026-08-16 with a live `videos.list` call returning
  title, `PT3M34S`, `embeddable: true`, `liveBroadcastContent: none`.
- `.env.local` populated: **yes** — all five variables set
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

**Phase 1 (2026-08-16)**

- **Both cookies are encrypted iron-sessions, not just `session`.** Spec §5 describes
  `device` as "not proof of identity", which is true of authorizing *actions* — but
  `device` is what allows a session to be minted with no PIN, and the name picker
  necessarily ships every user's id to the browser. A plain-text `device` cookie would
  therefore be a one-line impersonation of anyone in the office: set the cookie, click
  Continue. Signing it costs nothing and closes that hole. `device` is still not accepted
  as authorization for any action.
- **Dependency: `bcryptjs` 3.0.3**, not native `bcrypt`. Same algorithm, pure JS, no
  native module to compile on Vercel's build image. Cost factor **12** — the online
  lockout is the real defence for a 4-digit PIN, but cost 12 makes an offline grind of all
  10,000 combinations per user take hours rather than minutes if the table ever leaked.
- **`iron-session` 8.0.4**: `getIronSession(await cookies(), options)`, `ttl` in seconds.
  Cookie names `office_radio_session` (30d) and `office_radio_device` (10y). `secure` is
  on only in production, because dev runs over plain http and would silently drop the
  cookie otherwise.
- **First-claim PIN setting is unauthenticated, by necessity.** On first claim there is no
  prior credential to check. Inherent to spec §5's design and acceptable for six known
  people in a private room; the recovery path for a mis-claim is the owner's reset, which
  is precisely why that exists. `set-pin` is conditional on `pin_hash IS NULL`, so it can
  never overwrite an existing PIN, and a race between two people claiming the same name
  leaves the loser with a clear error rather than a silently clobbered PIN.
- **A confirm-PIN field was added to the first-claim form.** Not in the spec, but a typo
  on first claim is exactly the "PIN locked onto the wrong value" problem that the owner
  reset exists to clean up. Cheaper to prevent.
- **Lockout uses HTTP 429**, not the 409 that BUILD-PLAN §Contracts originally listed.
  429 is the correct status for rate limiting; BUILD-PLAN has been corrected to match.
- **`is_owner` UI is a single "Reset a PIN" panel** on the signed-in view, listing other
  users with a Reset button. That is the only power the flag grants and the only surface
  it may ever have.

**Phase 2 (2026-08-16)**

- **`lib/state.ts` builds the `/api/state` payload, shared by the route handler and the
  page's server render.** The page seeds `SignedIn` with `initialState`, so the first paint
  already has the queue instead of flashing empty and fetching on mount. It also means one
  implementation of the anonymity rules rather than two that could drift.
- **`useStation` takes `initialState` and only polls.** React 19's
  `react-hooks/set-state-in-effect` rule correctly flagged the original fetch-on-mount;
  server-seeding removed the effect entirely rather than working around the lint.
- **Ordering happens in TypeScript, not SQL.** See Deviations.
- **The 'Show my name' checkbox resets after each add.** A single decision should not
  silently carry over to the next song.
- **Reveal *reads* are implemented (`lib/reveals.ts`), spending is not.** BUILD-PLAN calls
  for `revealsRemaining` to be a real count from Phase 2; the `POST /api/reveal/:id`
  endpoint stays in Phase 7.
- **`components/Station.module.css` is shared by AddSongForm, UpNext and PlayedToday** —
  they are three parts of one visual block, not independent widgets.
- **Test video ids** (useful for later phases, all verified 2026-08-16):
  `dQw4w9WgXcQ` 214s · `jNQXAC9IVRw` 19s · `fJ9rUzIMcZQ` 360s · `Gp7XG8Oys3I` 9979s (too
  long) · `X4VbdwhkE10` (live) · `_F8jLFfQ9C0` (embeddable = false). The non-embeddable one
  took scanning 200 videos to find — they have become rare, so keep that id.

**Phase 3 (2026-08-16)**

- **`lib/timeline.ts` is pure — no `server-only`, no database import.** It takes its clock
  and its storage as parameters. The Supabase implementation lives separately in
  `lib/timeline-repo.ts`. This is what makes every edge case testable without a database,
  a browser, or waiting three minutes for a song to end.
- **`markPlayed` is conditional on `status = 'pending'`** so a concurrent skip is never
  overwritten with `played`. Phase 6 sets `skipped`; without this the two would race.
- **The playing song keeps `status = 'pending'`** and is filtered out of `upNext` in
  `lib/state.ts` by id. Which song is current is owned by `player_state`, not by the status
  column — consistent with the note in `0001_init.sql`. The alternative, writing
  `status = 'playing'` on every transition, adds a write and a new inconsistent state if
  it fails after `setCurrent` succeeds.
- **`setCurrent` uses `.is('current_item', null)` when expecting null**, because SQL
  equality never matches null and `.eq(…, null)` would silently never match — which would
  have broken cold start specifically, and only cold start.
- **Two extra guards beyond the spec's pseudocode**, both clearing the broadcast
  conditionally and letting the next poll cold-start: a `current_item` pointing at a row
  that no longer exists, and a `current_item` with a null `started_at`. Neither should
  happen; inventing a playhead for them would be worse than a moment of silence.
- **vitest config is `vitest.config.mts`**, not `.ts` — Vite's native config loader treats
  a `.ts` config as CommonJS in this project and warns.
- **`server-only` is aliased to a stub in tests** (`tests/stubs/server-only.ts`). The real
  package throws unless the bundler sets React's `react-server` condition, which Next.js
  does and vitest does not. It is a build-time guard with no runtime behaviour worth
  keeping in a unit test.
- **`buildState` runs `resolveState()` before reading the queue**, or the payload would
  describe a song that has already ended.

**Phase 4 (2026-08-16)**

- **`POST /api/queue/:id/failed` is the `onError` endpoint.** BUILD-PLAN left the choice
  open. It is its own route rather than a reuse of the (not yet built) skip route because
  the permission model differs: **any** signed-in listener may report a failure, since any
  listener's player is where the error surfaces and a broken video is a fact about the
  video, not an ownership action. Skips in Phase 6 stay adder-only.
- **Three guards keep that narrow** (`lib/playback.ts`): the item must actually be
  `player_state.current_item`; the reported `videoId` must match that row, so a replayed
  or racing request cannot kill a different song; and the status update is conditional on
  `pending`. A stale report returns `{advanced: false}` and HTTP 200 — with several people
  watching, being second is the normal case, not an error.
- **Accepted trade-off, recorded deliberately:** a determined user could call this on the
  current song to force a skip they are not entitled to. It is bounded to one song per
  call and the guards stop it hitting anything else. Spec §7 makes error recovery
  mandatory — without it the station dies on the first bad video — and the trust model is
  six known colleagues in one room. Not worth a vote or a role, both of which are rejected
  by design.
- **`advancePast()` in `lib/timeline.ts`** is the shared "move on now" primitive: picks
  next, starts it at `now()` (a cold start, not an accumulating transition, because the
  song did not run its length), conditional on the expected id. **Phase 6's skip should
  use this same function.**
- **The clock offset is written in effects, never during render.** React 19's
  `react-hooks/purity` and `react-hooks/refs` rules correctly reject `Date.now()` and ref
  writes during render. Consequence: `serverNow()` falls back to the raw client clock
  until the mount effect runs, which affects only the first painted frame of the progress
  bar — nothing loads a video before the Listen click.
- **The offset is seeded from the server-rendered payload, then replaced once by the first
  live fetch**, where the error is only half a round trip. Frozen after that.
- **`YouTubePlayer` keeps `playing` and `onFailed` in refs updated by effects**, so the
  player-creation effect has empty dependencies. Re-running it would tear down and rebuild
  the iframe, which is precisely what must never happen.
- **No `@types/youtube` dependency** — the handful of IFrame API methods the app uses are
  declared in `lib/client/player.ts`.
- **The player is 160×90 in the corner of the Now Playing card**, visible at all times.
  Never `display: none`.

**Phase 5 (2026-08-16)**

- **The drift interval keys on `playing.queueItemId`, never the `playing` object.** That
  object is a fresh value on every 3-second poll, so an effect depending on it would
  restart the 30-second interval before it ever fired — drift correction would silently
  never run. Same reasoning for the scheduled-transition timer. There is a static check
  asserting both dependency arrays, because this failure mode is invisible: nothing errors,
  the correction just never happens.
- **Drift correction lives inside `YouTubePlayer`**, which owns the player instance, rather
  than exposing a handle upward as the Phase 4 note suggested. Encapsulation was the
  cheaper option and no other component needs the player.
- **Resume-after-pause reuses `shouldSeek`** with the same 2-second tolerance, so the drift
  check that fires immediately after `loadVideoById` is a harmless no-op rather than a
  double seek.
- **The transition timer fires 250 ms *after* the song's scheduled end.** Landing exactly
  on the boundary risks a rounding error leaving `elapsed` a hair under `duration`, so the
  server would decline to advance and the transition would fall back to the 3s poll.
- **Volume defaults to 70, unmuted, not listening.** Local-only state in `SignedIn`; it is
  never persisted and never sent anywhere.

**Phase 6 (2026-08-16)**

- **The song on air cannot be removed — it returns 409 `on_air`, pointing at skip.** Its
  status is still `pending` (which song is current is owned by `player_state`), so the
  ownership and status checks alone would have let it through, and the delete would then
  have failed at the foreign key `player_state.current_item → queue.id` as a 500. Caught
  and turned into a real answer.
- **Removing a song deletes any reveal tickets spent on it**, because
  `reveals.queue_item_id` is a foreign key. The side effect is that whoever paid to unmask
  it gets their ticket back. That seems the fairer way round given the song will now never
  play, and the alternative — a soft delete — would leave removed songs visible in a
  history they never earned.
- **Remove is a hard delete, not a status change.** A removed song never played, so there
  is no history worth keeping, and the test asserts it does *not* appear in `playedToday`.
- **Skip reuses `advancePast()`**, the same primitive as the failed-video path: the next
  song starts at `now()`, since the skipped one did not run its length.
- **`skipCurrent` and `removePending` live in `lib/playback.ts`** alongside
  `markFailedAndAdvance`, so the three "move the station along" paths sit together and
  share the same guard style.

**Phase 7 (2026-08-16)**

- **The free cases are answered before the budget is consulted.** Your own song, an
  opted-in name, and a song you already revealed today all return the name without
  spending. Checking the budget first would make a repeat look like a fourth reveal and
  refuse it once the three are gone — which is precisely what the spec's "revealing the
  same song twice does not cost a second ticket" forbids.
- **The insert is an `upsert` on `(user_id, queue_item_id)`, not an insert.** The primary
  key has no day in it, so a song revealed yesterday and revealed again today would
  otherwise collide and throw. A new day is a new budget, so the upsert correctly costs a
  ticket and re-stamps `day` to today. **Verified explicitly** — see below.
- **The song is looked up by id with no day filter**, so the one on air can be revealed
  even if it started before midnight.
- **Reveal is offered on the playing song, the queue, and today's history** — anywhere the
  adder is hidden from this viewer. Revealing after hearing something is the main case the
  feature exists for.
- **The button carries the remaining count and disables at zero** rather than failing after
  the click.
- **Accepted race, not worth fixing here:** two simultaneous reveals of *different* songs
  could both pass the budget check and spend a fourth ticket. Serialising it needs a
  transaction or an RPC and another migration. At six people this will not happen, and the
  primary key already makes the common case — the same song twice — exact.

**Phase 8 (2026-08-16)**

- **The verification suites are now committed** under `scripts/verify/`, run by
  `npm run verify`. They only existed in a session scratchpad, which would have thrown away
  252 assertions of evidence. **They reset the database**, so they are development-only —
  the README says so twice.
- **`vercel.json` pins functions to `icn1` (Seoul)** to match the database region. Vercel
  Hobby defaults to Washington DC, which would put a trans-Pacific round trip in front of
  each of the ~5 queries `/api/state` makes every 3 seconds per listener.
- **No `.gitattributes` was added**, despite the note suggesting one. The CRLF warnings on
  every commit are cosmetic: they say "LF *will be replaced by* CRLF in the working copy",
  which means the repository already stores LF. Vercel's Linux build gets LF either way, so
  a `text=auto eol=lf` file would only silence a local message while forcing a
  whole-tree renormalisation diff. Not worth it.
- **The deploy itself is the user's step** — it needs their GitHub and Vercel accounts.
  Everything the deploy depends on is prepared and committed.

**Post-Phase 8 polish (2026-08-16)** — requested after the build, not part of any phase.

- **The "Signed in as / Log out" header is gone**, replaced by a conventional account menu
  at the top right: avatar initial, name, dropdown.
- **The always-visible owner panel is gone.** "Reset a PIN…" now lives in that dropdown and
  opens a dialog. It appears **only for `is_owner`**; everyone else sees just "Sign out".
  Read deliberately as the owner power being relocated — there is no self-service PIN
  change in the spec, and adding one would need a new endpoint that verifies the old PIN.
- **One station container, read top to bottom as time runs**: Earlier today → On air →
  Up next. History is capped at ~190px and scrolls internally so a busy afternoon cannot
  push the song on air off the screen, and it is ordered **oldest first** so it flows down
  into the present.
- **Adding a song is a separate panel** — a sidebar on desktop, and ordered *first* on
  narrow screens, since pasting a link is what people open the app on a phone to do.
- **The on-air block renders whether or not anything is playing.** The iframe lives inside
  it, so making that block conditional would unmount the player — landmine 13. `Off air` is
  the empty state, not an absent section.
- **Two verification assertions were updated**, both keyed to UI text this change removed
  or renamed: the signed-in check now looks for the account menu rather than "Signed in
  as", and the player check accepts "On air"/"Off air" rather than "Now playing".

**The verification suites are now opt-in (2026-08-16)**

The user watched their queue fill with unfamiliar songs, "Me at the zoo" repeat endlessly,
their claimed name come back as unclaimed, and another name appear taken. It read as an
intrusion. It was **the verification suite**, run against the same database they had open
in a browser: the suite sets PINs for User 2 and User 3, nulls every `pin_hash` on reset,
and queues its own test videos.

No defect, no breach — but the process was wrong, so every suite that writes now refuses
to start unless `VERIFY_WIPE_OK=1` is set. There is no default that deletes anything.
`sync-static.sh` is unguarded and says why: it only reads source files.

**The proper fix is a second Supabase project** for development, so verification can never
reach the instance the office uses. Until that exists, treat this database as live.

**Player sizing and chrome (2026-08-16)**

- **The video is now `flex: 1 1 300px` up to 480px wide at 16:9**, instead of a fixed
  160×90. It grows into whatever space the on-air block gives it and wraps below the track
  details on narrow screens.
- **`pointer-events: none` on the frame.** YouTube's centre play/pause overlay and corner
  buttons only appear on pointer interaction, so making the surface inert removes them —
  and it means a stray click cannot pause the station. You cannot pause a radio, so the
  surface that would let you is simply not interactive. Also added `iv_load_policy: 3`
  (no annotation cards) and `fs: 0` (no fullscreen button).

**Verification harness: two environment bugs, no app defect (2026-08-16)**

Both cost real debugging time and are worth knowing before extending the suite.

- **A browser tab open on the dev server breaks the suite.** It polls `/api/state` every
  three seconds and cold-starts the station the instant a reset clears it — which then
  makes `DELETE FROM queue` fail on the `player_state.current_item` foreign key, leaving
  rows behind and producing failures that look like real defects. Confirmed by clearing
  `player_state` and watching it re-arm within two seconds with nothing of mine running.
  `run-all.sh` now retries the reset up to five times and aborts with a plain explanation
  if it keeps losing; the README warns about it.
- **`pwd` in Git Bash returns `/d/…`, which the Windows `node` binary cannot resolve.** The
  copied scripts built their temp paths that way and failed everywhere `node` read a file.
  They now use `pwd -W` with a fallback. This is the same class of problem as the earlier
  `mktemp` failures — anything handing a path from Git Bash to node needs a Windows path.

**Speaker rework (2026-08-16)** — after the user reported the Listen button desyncing from
the audio, and asked for the radio model instead of an opt-in.

- **There is no `listening` state any more. `muted` is the single truth.** The bug was two
  pieces of state describing one thing: React's `listening` and whether the iframe was
  actually producing sound. They drift, and then the button claims sound while the room
  hears silence. One flag cannot disagree with itself. An audit check now asserts the word
  `listening` appears nowhere in `components/` or `lib/`.
- **The page opens muted.** Browsers refuse to autoplay audio without a user gesture — this
  is what the Listen button really existed for. Unmuting *is* the gesture, so spec §7's
  requirement is still met with one control instead of two.
- **The iframe runs from page load onward, muted, and never stops for the toggle.**
  Superseded a first attempt that only loaded while unmuted; the user wanted the stream
  always live, which is the truer radio model and makes unmuting instant rather than a
  fresh buffer. `muted` is now consulted in exactly one effect — the one that calls
  `mute()` / `unMute()` — and an audit check asserts the loading effect never mentions it.
- **Accepted cost, deliberately:** every open tab now streams, not just the speaker
  machine. That is the bandwidth argument in spec §7 (six browsers for one speaker), and it
  is being traded away knowingly. Offset by requesting `suggestedQuality: 'small'` — the
  frame is 160×90, so the smallest stream is visually identical and much cheaper.
- **Blocked autoplay is recovered from too.** `CUED` joins `PAUSED` as a state the player
  plays out of, since a refused autoplay lands there rather than erroring.
- **The player heals itself.** Anything that pauses it — a throttled background tab, a
  suspended iframe — is treated as a fault, not an instruction: it resumes and re-seeks to
  the live position. A `visibilitychange` handler does the same on returning to the tab,
  whose timers were throttled while it was hidden.
- **YouTube's own controls are hidden (`controls: 0`).** You cannot pause a radio, so there
  must not be a pause button — and since the player auto-resumes anything that pauses it,
  leaving one visible would look broken.
- `ListenControls.tsx` became `SpeakerToggle.tsx`. BUILD-PLAN's file list still names the
  old one.
- **The original button-flip was never reproduced** — no browser automation here. The
  redesign removes the state that could desync rather than diagnosing it, and the
  self-healing covers the silent-player half. Worth re-checking in use.

**One queue instead of two lists (2026-08-17)** — the start of a design pass; not part of
any phase.

- **`PlayedToday` and `UpNext` are gone, replaced by `components/Queue.tsx`.** They were two
  renderings of one thing — a day of the station — and keeping them apart meant two headings,
  two empty states and two sets of nearly identical row markup. The panel is now the song on
  air, and under it a single scrolling list: past songs, the next one, then the rest.
- **The list rests with the next song against the top edge**, past songs parked above it out
  of view. You can scroll anywhere; when the pointer leaves it settles back after 400 ms. The
  delay exists so a wandering cursor — or a finger lifting between swipes on a phone, where
  `pointerleave` also fires — does not fight the reader.
- **It re-settles when the anchor changes** (the station advanced, a song was added or
  removed) **but never while the pointer is inside it.** Re-anchoring under someone who is
  reading their history is worse than being briefly out of position.
- **Two mechanics the layout does not work without.** `overflow-anchor: none` on the
  container, or the browser's own scroll anchoring fights the settle; and a `.tail` spacer
  after the last card, or the last song can never reach the top edge and the rest position is
  unreachable whenever the list is shorter than its container.
- **Section headings, position numbers and the raised on-air background are all gone.** Past
  cards are dimmed to 50% and the next one carries a `Next` pill; the list explains itself.
  The cards now own `--surface-raised`, so they are what stands out in the panel.
- **The muted speaker hint was removed** at the user's request ("The station is already
  running. Turn this on for the room."). The unmuted line stays — it reports something you
  cannot otherwise see, that this machine is the one the room hears.
- `formatDuration` moved from `UpNext.tsx` to `Queue.tsx`; `NowPlaying` imports it from there.
- **Not verified**: the scroll and settle behaviour needs a browser. `npm run verify` was not
  run either — it wipes the live database. Both UI strings its suites depend on (`Speaker
  off`, `On air`/`Off air`) are untouched. `build`, `lint`, `typecheck` and 54 unit tests clean.

**Structure is square, actions are round (2026-08-17)** — design pass, continued.

- **Every container lost its radius**: both panels, queue cards, the video stage, the
  progress bar, the login card, the account dropdown, the reset-PIN dialog, and every error
  / notice / message banner. Only things you press keep one.
- **Inputs went square too** — the paste field and the PIN field. Read as structure rather
  than as actions: you fill a field, you do not press it. A judgment call, flagged to the
  user rather than assumed.
- **Two round things survive that are not buttons**: the avatar circle in the account menu
  and the `Next` pill on the queue card. Both are identity or status markers, not boxes.
- **`--radius` is now documented in `globals.css` as a *control* token**, explicitly not for
  containers. Without that note the rule erodes the first time someone reaches for the
  nearest radius variable while styling a new panel.

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

- **Round-robin ordering is implemented in TypeScript (`orderRoundRobin`), not as the SQL
  window function in spec §6.** The spec's query is preserved verbatim as a comment above
  the function and the output order is identical. Reasons: it is pure, so Phase 3 can unit
  test song selection end to end with an injected repository instead of needing a live
  database — which is the whole point of isolating the timeline engine — and `supabase-js`
  cannot express `ROW_NUMBER() OVER (PARTITION BY …)` without an RPC and another migration.
  Row counts are one day of a six-person office, so in-memory sorting costs nothing.
  BUILD-PLAN's testing-posture note has been updated to match. **Verified against the live
  API**: with User 2 holding six pending songs and User 3 two, the order came back
  U2₁, U3₁, U2₂, U3₂, then U2's remainder.

- **`POST /api/auth/continue` was added; it is not in spec §11's endpoint list.** The spec
  folds the PIN-free path into `/api/auth/claim` as an optional `pin`. It is split out
  because this is the *only* endpoint that grants a session without a PIN, so it must be
  incapable of being aimed at someone else. It accepts **no body at all** and reads the
  identity purely from the encrypted device cookie, making impersonation structurally
  impossible rather than dependent on getting a branch right inside a three-way handler.
  `/api/auth/claim` consequently always requires a PIN. Verified: posting
  `{"userId": "<another user>"}` to `/api/auth/continue` is ignored and returns the device
  cookie's user.

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

### Phase 1 exit verification (2026-08-16)

A 34-assertion script exercised every flow against the live database. **34 passed, 0
failed.** Covered: first claim sets a PIN and signs in · the signed-in page renders ·
logout keeps the device cookie and the gate then offers "Continue" / names the user /
offers "Not you?" · Continue works with no PIN · **posting another user's id to
`/api/auth/continue` is ignored and still returns the device cookie's user** · Continue
with no device cookie is 401 · `set-pin` on a claimed name is 409 · the correct PIN signs
in · four wrong PINs count down 4→1 remaining · the fifth returns 429 `locked_out` · **the
correct PIN during a lockout is still 429** · reset-pin is 401 unauthenticated, 403 for a
non-owner, 200 for the owner · reset clears both the PIN and the lockout · short,
non-numeric, and unknown-user inputs are rejected.

Verified separately, since a test script cannot see either:

- **PINs are hashed.** All stored values are 60-char `$2b$12$…` bcrypt hashes; a regex for
  any 4-digit run inside a hash matched nothing.
- **No secret reaches the browser.** Grepping `.next/static` for the session secret, the
  service role key, the Supabase host, `pin_hash`, and any bcrypt hash prefix returned
  zero hits across all client bundles.

`npm run build`, `typecheck`, and `lint` all pass clean.

**Test state was cleaned up afterwards** — all six users are back to `pin_hash = null`,
`failed_attempts = 0`, `locked_until = null`, so the room starts fresh.

### Phase 2 exit verification (2026-08-16)

A 32-assertion script against the running app and the live database. **32 passed, 0
failed.**

- **All five URL forms** plus a `&list=` playlist link were accepted and all six resolved
  to the same video id — the playlist is discarded for free, because only `v` is ever read.
  A `playlist?list=` link with no video is rejected. Six identical songs queued: duplicates
  are allowed, as specified.
- **Each rejection has its own code and its own message**, verified distinct, against real
  videos: `Gp7XG8Oys3I` (166 min → 422 `too_long`), `X4VbdwhkE10` (live → 422
  `live_stream`), `_F8jLFfQ9C0` (embeddable false → 422 `not_embeddable`), junk link (400
  `invalid_url`). The queue was unchanged by all four.
- **Round-robin verified live**: U2₁, U3₁, U2₂, U3₂, then U2's remainder. A lone adder
  stays FIFO.
- **Anonymity verified on the payload, not the UI**: viewing as User 3, the JSON contains
  no occurrence of `User 2`, none of User 2's uuid, and no `addedById`, `added_by` or
  `show_name` field anywhere. Anonymous rows carry `addedByName: null`. A row has exactly
  the nine contract fields. With `showName: true` the name appears — and only on that one
  row, while the same person's other songs stay anonymous.
- `/api/state` and `POST /api/queue` both 401 without a session.

`npm run build`, `typecheck` and `lint` all pass clean. **Test data was cleaned up** —
queue and reveals emptied, all six users back to unclaimed, `player_state` still idle.

### Phase 3 exit verification (2026-08-16)

**39 unit tests** (`npm test`) against a fake repository with an injected clock, plus **32
live assertions** against the running app and the real database. **71 passed, 0 failed.**

The results that matter most:

- **Accumulation, measured in real time**: three 19-second songs queued, cold start, then
  a genuine 19-second wait. The next song's `startedAt` was **exactly** the previous
  `startedAt + 19s` — not `now()`, despite the poll arriving late. This is the rule whose
  error would otherwise compound into a minute of drift over twenty songs.
- **The lunch break**: `started_at` moved back one hour with fifteen songs queued. Exactly
  **one** song was consumed and the other fifteen survived. Without the 30s rule the whole
  queue would have burned silently.
- **Concurrency**: six simultaneous polls against an overdue song advanced it **once**.
  The loser re-reads and reports the winner's state; it never retries.
- **Midnight**: a song started at 23:58 with `day = yesterday` keeps playing after
  midnight, because the current item is resolved by id with no day filter. When it ends,
  yesterday's leftovers are *not* selected — a fresh station every morning.
- **Anonymity holds on the playing song too**: viewed by someone else, `addedByName` is
  null, `canSkip` is false, and the adder's name and uuid appear nowhere in the payload.
- Silence on an empty queue, and a cold start when a song is added after silence.

`npm run build`, `typecheck` and `lint` all pass clean. Test data cleaned up: queue and
reveals empty, users unclaimed, `player_state` idle.

Two failures during the run were the test harness, not the app, and are worth remembering:
deleting `queue` rows fails while `player_state.current_item` still references one, so the
broadcast must be cleared first; and "songs queued but nothing playing" cannot be observed
through `/api/state`, because polling that endpoint is itself what cold-starts the station.

### Phase 4 exit verification (2026-08-16)

**46 unit tests** and **23 live assertions**. **69 passed, 0 failed.** `build`, `typecheck`
and `lint` all clean.

- **`onError` recovery, end to end**: a video that passes validation and later becomes
  unplayable (inserted directly, since the add pipeline correctly refuses non-embeddable
  videos up front) is marked **`failed`** — not `played` — and the station moves to the
  next song, started at `now()` rather than chained from the dead song.
- **The report is guarded**: replaying an old report is a no-op; a mismatched `videoId`
  cannot kill the current song; unauthenticated is 401; a missing `videoId` is 400. Four
  simultaneous reports skipped **exactly one** song.
- **Clock skew**: a unit test drives a client clock 40 seconds fast and shows the offset
  cancels it exactly — position 60s instead of the 100s the raw clock would give.
- **Static invariants**: the served page contains the Listen button and opens *not*
  listening; the player mount is not conditionally rendered; songs change through
  `loadVideoById`; change detection compares the queue item id; no `display: none`
  declaration in the player CSS; no raw `Date.now()` in the playhead components.

### Phase 4 caveat — three criteria need a human at a browser

I have no browser automation here, so these remain **unverified by me**. They need about
two minutes with the app open:

1. **Click Listen mid-song** — audio should begin at the live position, not at 0:00.
2. **Open a second browser** and confirm both land within roughly a second of each other.
3. **Watch a transition** — audio should change songs with the iframe never disappearing
   or reloading (the DOM node should keep the same identity in devtools).

Everything reachable without a browser is verified above; the code paths behind these
three are the ones the static invariant checks cover, but seeing and hearing them is not
something a script did.

### Phase 5 exit verification (2026-08-16)

**54 unit tests**, **16 static invariant checks**, and the **Phase 3 timeline suite re-run
as a regression (32 assertions)**. **102 passed, 0 failed.** `build`, `typecheck` and
`lint` clean.

- **Drift decisions** are unit tested at the boundary: 1s apart does nothing, exactly 2s
  does nothing, 5s corrects — in both directions.
- **Transition timing**: a listener 30s into a 200s song waits ~170s, not the up-to-3s-late
  the poll alone would give; a song already past its end fires almost immediately; a
  negative remainder never schedules into the past.
- **Every `setInterval`/`setTimeout` has a matching clear** — asserted by counting both in
  each file, not by eyeballing.
- **Local controls stay local**: no network call in `ListenControls` or `YouTubePlayer`,
  no `volume`/`muted` anywhere under `app/api/`, and no global player endpoint exists.
- **`Date.now()` is confined to the three offset sites** in `useStation` (seed, refine from
  first fetch, and `serverNow`). A fourth would mean a playhead bypassing the offset.

### Phase 5 caveat — the audible criteria still need a browser

BUILD-PLAN's testing posture says "No UI tests. Manual verification against the phase exit
criteria is sufficient at this scale", so this is the documented plan rather than a gap
discovered late. But it means Phases 4 and 5 have now accumulated **six** unverified
browser behaviours. **Phase 8's audit must walk all of them**, not just the §16 list.

Outstanding from Phase 4: audio starts at the live position; two browsers land within ~1s;
the iframe survives a transition.

Outstanding from Phase 5:

1. **A transition is audible within a fraction of a second** of the song ending, not up to
   three seconds late. Easiest with a short song — `jNQXAC9IVRw` is 19 seconds.
2. **Forcing a 5-second drift triggers exactly one correction; a 1-second drift triggers
   none.** In devtools: `document.querySelector('iframe')` is the player; drag its
   position, then wait up to 30 seconds.
3. **Pausing 30 seconds and resuming jumps forward to live**, rather than continuing from
   the pause.

### Phase 6 exit verification (2026-08-16)

**30 live assertions**, plus the 54 unit tests re-run as a regression. **84 passed, 0
failed.** `build`, `typecheck` and `lint` clean.

- **Ownership is enforced on the server, tested by calling the endpoints directly** rather
  than trusting a hidden button: removing someone else's song is 403 and the song survives;
  removing your own is 200 and it does not appear in the history; unauthenticated is 401.
- **The song on air**: 409 `on_air` with a message pointing at skip — not a foreign-key
  crash.
- **A played song**: 409 `not_pending`.
- **Skip is adder-only**: another person skipping is 403 and the song stays on air;
  skipping something that is not on air is 409. The adder's skip advances the station, the
  row is marked **`skipped`** (not `played`), and the next song starts at `now()`.
- **The skip is silent**, checked from the other person's session: the skipped row shows no
  name, the skipper's name and uuid appear nowhere in the payload, there is no `skippedBy`
  field, the row still carries exactly the nine contract fields, and neither the rendered
  page nor any shipped code or string literal contains "skipped by".

### Phase 7 exit verification (2026-08-16)

**31 live assertions plus a scripted day-rollover check.** **0 failed.** `build`,
`typecheck` and `lint` clean.

- **Spending**: the first reveal returns the name and leaves two; the row then shows the
  name and `revealed: true` while every other row stays anonymous.
- **Repeats are free**: revealing the same song again leaves the budget at two — and,
  critically, **is still free after all three are spent** (200, not 429), which is the
  check-order rule above.
- **The budget runs out at three**: the fourth reveal is 429 and that song stays anonymous.
- **Free cases cost nothing**: your own song and an opted-in name both return 200 with the
  budget untouched at three.
- **Privacy**: User 2, who spent nothing, sees `revealed: false` on every row regardless of
  how many tickets User 3 burned; no field names a revealer; User 3's uuid appears nowhere;
  and User 3's *name* appears exactly once — on the song they opted in to show — so one
  person's `showName` does not unmask their other songs.
- **Day rollover, verified directly**: a reveal dated yesterday does not count against
  today's budget (3 remaining), the name is hidden again, and revealing today succeeds,
  costs a ticket (2 remaining), and re-stamps the stored `day` to today rather than
  colliding on the primary key.
- Unauthenticated is 401; an unknown song is 404.

## Notes for later phases

Work spotted mid-session that belongs to a later phase. Recorded here instead of being
built early.

**Phase 8 is the last one. It is an audit, not a feature phase.** Three parts:

1. **Walk the whole §16 landmine checklist** as a fresh audit against the actual code. Do
   not trust the per-phase claims in this file — re-verify each of the fifteen items. The
   table at the bottom of this file is where the evidence goes.
2. **Clear the six deferred browser checks** from the Phase 4 and Phase 5 caveats above.
   These need a human with the app open; they are the only exit criteria in the whole build
   that no script has covered.
3. **Deploy** (SETUP.md Group C): push to GitHub, import to Vercel, set all five env vars
   for all three environments with **no `NEXT_PUBLIC_` prefixes**, generate a *separate*
   `SESSION_SECRET` for production, deploy, then check `/api/health` on the live URL.

Also in Phase 8:

- **Replace the placeholder names** in Supabase → Table Editor → `users`, *before* anyone
  claims a name, so nobody sets a PIN on the wrong row.
- **Consider `regions` in `vercel.json`** — the database is in Seoul (`icn1`), and Vercel
  Hobby defaults to Washington DC. Matching them removes a trans-Pacific round trip from
  every one of the ~5 queries `/api/state` makes every 3 seconds.
- **Grep the built client bundle** for the service role key, the session secret and the
  YouTube key, as Phase 1 did. `.next/static` must contain none of them.
- **A README**: env setup, running migrations, resetting a PIN.
- Optional: a `.gitattributes` with `* text=auto eol=lf` to stop the CRLF warnings that
  every commit in this build has produced.
- **Phase 8 must include the six deferred browser checks** from Phases 4 and 5, listed in
  the caveat sections above, alongside the §16 landmine list.
- **Query count on the hot path is now about five** per poll (player_state, current item,
  the day's queue, users, reveals), plus one for `pickNext` on a transition. Fine at six
  people, but it is the first thing to look at if Phase 8 finds `/api/state` slow.
- `currentUser()` in `lib/auth.ts` is the single identity choke point — every route added
  from Phase 2 onward must get its user from there, never from a request body.
- `currentUser()` costs one `users` lookup per call. `/api/state` is polled every 3s by
  every client, so if Phase 3 finds that endpoint doing too many queries, folding the user
  lookup into its main query is the first thing to try.
- The signed-in view (`components/SignedIn.tsx`) is a deliberate placeholder. Phase 2
  replaces its middle card with the add box and queue lists; keep the header row and the
  owner panel.
- `npm run typecheck` depends on `.next/types`, which only exist after a `next build` or
  `next dev` run. On a clean clone, build before typechecking.

## §16 landmine audit — Phase 8, 2026-08-16

Audited fresh against the code, not carried over from the per-phase claims above. The
script is `scripts/verify/audit.sh`; **54 checks, 0 failures**.

| Item | | Evidence |
|---|---|---|
| `/api/state` returns `serverTime`; clients use offset-corrected time | ☑ | `serverTime` parses; `Date.now()` appears at exactly the 3 offset sites in `lib/client` and **nowhere** in any component. Unit test cancels a 40s client-clock skew exactly. |
| Normal transitions use `started_at + duration`, never `now()` | ☑ | The accumulating branch is `startedAt + duration_sec * 1000`. Proven live over a real 19s wait: the next start was **exactly** previous + 19s despite a late poll. |
| Overshoot > 30s cold-starts instead of chaining | ☑ | `OVERSHOOT_COLD_START_SEC = 30`, compared as `overshoot < threshold`. Live: `started_at` moved back an hour with 15 songs queued burned **one**, leaving 15. |
| `player_state` updates conditional on expected `current_item` | ☑ | `setCurrent(expected, …)`; null expectation uses `.is('current_item', null)` since SQL equality never matches null. A lost race re-reads, never retries. No unconditional update exists. |
| Clients detect changes by `current_item` id, not position | ☑ | `loadedItemRef.current === playing.queueItemId`. Both the transition timer and the drift loop key on `playingId`, never the `playing` object. |
| `onError` marks `failed` and advances | ☑ | `POST /api/queue/:id/failed` → `status: 'failed'` then `advancePast`. No retry anywhere in the player. Four simultaneous reports skipped exactly one song. |
| Live streams and >10min videos rejected at add time | ☑ | Limit 600s. Live 422, 166-minute 422, non-embeddable 422 — against real videos, each with a distinct message. |
| Skips are silent — no "skipped by X" anywhere | ☑ | Zero matches in shipped code or string literals (comments stripped), zero in the rendered page, zero in the payload. Skip response is `{skipped: true}`. |
| `added_by` never sent for un-revealed anonymous songs | ☑ | Payload has no `added_by`, `addedById` or `show_name`; adder's name and uuid absent; rows carry exactly the nine contract fields; `serialize.ts` builds field-by-field with no spread. |
| Day filter applies to queue list, not current-item lookup | ☑ | `loadQueueItem` filters by id only — asserted by parsing the function body. `pickNext` does filter by day. Midnight-crossing song is unit tested. |
| `userId` read from session cookie only | ☑ | Exactly three routes read a body `userId`: `auth/claim` and `auth/set-pin` (the login step, worthless without the PIN) and `owner/reset-pin` (the *target*; caller comes from the session). `auth/continue` takes no body and ignores an injected one. |
| PINs bcrypt-hashed, 5-attempt lockout in place | ☑ | Cost 12, 5 attempts, 15 minutes. All stored hashes match `$2[aby]$12$`. No plaintext PIN stored or logged. A correct PIN during lockout is still refused. |
| Iframe stays mounted and visible | ☑ | No `display: none` declaration in the player CSS (comments stripped — the file explains the rule). Mount is not conditionally rendered. Songs change via `loadVideoById`. |
| Audio starts only after Listen is clicked | ☑ | `listening` defaults false; the load effect is gated on it; the served page offers Listen, not Stop. |
| All Supabase access server-side; no key in client bundles | ☑ | `db.ts` is `server-only`; no `NEXT_PUBLIC_` in shipped code or the env template; no supabase import in any component; all three secrets **and** the Supabase host absent from `.next/static`. |

### Full regression, Phase 8

`npm run verify` — every phase suite against a clean database:

```
auth-test        passed  34   queue-test       passed  32
timeline-test    passed  32   player-test      passed  23
ownership-test   passed  30   reveal-test      passed  31
sync-static      passed  16   audit            passed  54
TOTAL            passed 252   failed 0
```

Plus `npm test` — 54 unit tests. `build`, `typecheck` and `lint` clean.

Two harness bugs were found and fixed during this audit, both worth remembering:

- The source-scanning helper crashed on file arguments and returned empty output, so three
  "expect zero matches" checks **passed because they had crashed**. It now exits non-zero
  when it reads nothing.
- A Phase 2 assertion counted titles across the whole payload, which was correct when
  `playing` was always null and silently wrong afterwards. It now reads `upNext` only.

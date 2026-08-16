-- Office Radio — initial schema (spec §4)
--
-- Plain Postgres. No Supabase Auth, no RLS: authentication is custom PIN + signed cookie
-- sessions, and every query runs server-side under the service role key.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Six known people, seeded by name. `pin_hash` stays null until the person claims their
-- name and sets a PIN. `failed_attempts` / `locked_until` back the 5-attempt, 15-minute
-- lockout from spec §5 — a 4-digit PIN is only 10,000 combinations, so without a limit
-- it is decorative.

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  pin_hash        text,
  is_owner        boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- queue
-- ---------------------------------------------------------------------------
-- `added_by` is stored for every song, including anonymous ones: it drives round-robin
-- ordering, adder-only skip/remove, and reveals. Anonymity is a *display* concern
-- enforced in the API response — the column is never omitted.
--
-- `duration_sec` is mandatory because the whole timeline is arithmetic over durations.
-- This is why live streams are rejected at add time; one would freeze the station.
--
-- `day` is written by the server at insert time in the station's time zone, not computed
-- in queries, which keeps the daily-reset filter simple and indexable.
--
-- `status` note: which song is *currently* playing is owned by player_state, not by this
-- column. 'playing' exists in the vocabulary but the timeline never depends on it.

create table if not exists queue (
  id           uuid primary key default gen_random_uuid(),
  video_id     text not null,
  title        text not null,
  duration_sec integer not null,
  added_by     uuid not null references users(id),
  show_name    boolean not null default false,
  status       text not null default 'pending',
  day          date not null,
  created_at   timestamptz not null default now(),
  constraint queue_status_valid
    check (status in ('pending', 'playing', 'played', 'skipped', 'failed')),
  constraint queue_video_id_shape check (char_length(video_id) = 11),
  constraint queue_duration_positive check (duration_sec > 0)
);

create index if not exists queue_day_status_idx on queue (day, status);
create index if not exists queue_day_added_by_created_at_idx on queue (day, added_by, created_at);

-- ---------------------------------------------------------------------------
-- player_state
-- ---------------------------------------------------------------------------
-- The broadcast itself: which song is current and when it started. Everything else in
-- the system is derived from these two fields. Exactly one row, forever.

create table if not exists player_state (
  id           integer primary key default 1,
  current_item uuid references queue(id),
  started_at   timestamptz,
  constraint single_row check (id = 1)
);

insert into player_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- reveals
-- ---------------------------------------------------------------------------
-- Three per user per day, private to the person who spent one. The composite primary key
-- makes re-revealing the same song free, with no extra bookkeeping.

create table if not exists reveals (
  user_id       uuid not null references users(id),
  queue_item_id uuid not null references queue(id),
  day           date not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, queue_item_id)
);

create index if not exists reveals_user_id_day_idx on reveals (user_id, day);

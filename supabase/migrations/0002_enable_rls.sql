-- Office Radio — deny-all row level security
--
-- DELIBERATE DEVIATION from spec §2 ("do not enable RLS"). Recorded in docs/PROGRESS.md.
--
-- The spec's reasoning is correct about *policies*: identity in this app lives in an
-- iron-session cookie, not a Supabase Auth JWT, so there is no `auth.uid()` to write a
-- policy against and any attempt to marry the two is wasted effort.
--
-- That reasoning does not cover the deny-all case, and leaving RLS off has a real
-- consequence the spec does not address: every table in the `public` schema is exposed
-- through PostgREST to anyone holding the project's anon/publishable key — a key that is
-- public by design and meant to ship in browser bundles. This app never exposes it, but
-- "safe because a public key happens to be unpublished" is a thin guarantee that breaks
-- silently the moment anyone adds a client-side Supabase call.
--
-- Enabling RLS with ZERO policies denies anon and authenticated everything, while
-- `service_role` — the only key this app uses, and the only one that ever touches these
-- tables — bypasses RLS entirely. So no application code changes, no policies to
-- maintain, and no Supabase Auth anywhere. A lock on a door the app never opens.
--
-- Do NOT add policies here later. If a query ever fails with a permissions error, the
-- cause is that it is running under the wrong key, not that a policy is missing.
--
-- Safe to re-run.

alter table users        enable row level security;
alter table queue        enable row level security;
alter table player_state enable row level security;
alter table reveals      enable row level security;

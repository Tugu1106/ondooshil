-- Office Radio — seed data (spec §5)
--
-- Placeholder names on purpose. The real names get edited directly in the Supabase table
-- editor once everyone has picked their row, which avoids a mis-tapped name on day one
-- locking a PIN onto the wrong person.
--
-- `pin_hash` stays null: each person sets their own PIN on first claim.
--
-- User 1 is the owner. `is_owner` grants exactly one power — resetting somebody else's
-- PIN when they forget it. It is NOT an admin role and must never grow into one; nobody
-- owns playback (spec §1).
--
-- Safe to re-run.

insert into users (name, is_owner) values
  ('User 1', true),
  ('User 2', false),
  ('User 3', false),
  ('User 4', false),
  ('User 5', false),
  ('User 6', false)
on conflict (name) do nothing;

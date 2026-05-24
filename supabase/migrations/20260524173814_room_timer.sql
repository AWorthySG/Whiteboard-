-- Lesson timer state, synced to every participant via the existing
-- room_metadata realtime channel (same mechanism as leader_mode).
--
-- Model:
--   timer_duration_ms  the configured total (null = no timer set / cleared)
--   timer_running      true while counting down
--   timer_ends_at      absolute end instant; authoritative WHILE RUNNING
--                      (clients compute remaining = ends_at - now)
--   timer_remaining_ms frozen remaining; authoritative WHILE PAUSED
alter table public.room_metadata
  add column if not exists timer_running boolean not null default false,
  add column if not exists timer_ends_at timestamptz,
  add column if not exists timer_remaining_ms integer,
  add column if not exists timer_duration_ms integer;

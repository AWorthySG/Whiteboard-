-- Add an optional thumbnail (a small WebP/PNG data URL captured at save
-- time) so the templates library is visually scannable. Nullable — older
-- rows and any template whose thumbnail capture failed simply render a
-- placeholder.

alter table public.room_templates
  add column if not exists thumbnail text;

# Supabase migrations

This folder is the canonical record of schema migrations. Convention:

1. Write the migration SQL to `supabase/migrations/<timestamp>_<name>.sql`
   first (use `date -u +%Y%m%d%H%M%S` for the timestamp prefix).
2. Apply it to the production project via the Supabase MCP
   `apply_migration` tool with the same `name`.
3. Commit the file with the change.

`supabase/setup.sql` is the consolidated snapshot — re-run it on a
fresh project to bootstrap everything in one shot. Update it whenever
you add a migration so the snapshot stays current.

The historical migrations applied directly via MCP (before this folder
existed) are listed in the production `supabase_migrations.schema_migrations`
table and are summarised in CLAUDE.md.

-- Plan D4 — stop exposing the global resolution_cache to clients.
--
-- The cache had `for select to authenticated using (true)`, letting any signed-
-- in user (i.e. anyone who installs) enumerate the ENTIRE normalized-phrase
-- corpus and its hit_count popularity distribution. That is the product's
-- proprietary resolution corpus, exfiltratable wholesale.
--
-- The client never reads this table: it keeps its own local SQLite mirror
-- (src/db/cacheStore.ts), populated by the client's own resolves. The global
-- table is written service-role-only via resolver_cache_write. So the read
-- policy grants nothing the app needs. Drop it; service role still bypasses RLS
-- for the writes.

drop policy if exists "reference read" on resolution_cache;

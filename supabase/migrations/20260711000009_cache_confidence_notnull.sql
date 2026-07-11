-- Plan D3 — align resolution_cache.confidence nullability with the mirror.
--
-- Postgres had confidence as a nullable numeric; the SQLite mirror declares it
-- REAL NOT NULL. resolver_cache_write already rejects any write with
-- confidence < 0.6, so a null never legitimately lands — but if a cache pull is
-- added later, a null server row would violate the local NOT NULL and crash the
-- merge. Make the server column match the mirror's contract now.
--
-- Any legacy null rows (there should be none, given the write guard) are
-- backfilled to the confidence floor before the constraint is set.

update resolution_cache set confidence = 0.6 where confidence is null;
alter table resolution_cache alter column confidence set not null;

-- Schema-drift note (no code change): dishes.aliases / dishes.region and
-- ingredients.name_hi are intentionally NOT mirrored to SQLite. Alias and
-- Hinglish resolution happen server-side in resolver-classify (which reads
-- these columns directly); the device resolver validates against ids only.
-- The GIN index on dishes.aliases serves the server, not the client mirror.

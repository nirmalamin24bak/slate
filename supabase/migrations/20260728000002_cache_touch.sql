-- resolver_cache_touch — record that a cached row was served.
--
-- The global cache was write-only. resolver-classify wrote rows and never read
-- them, and migration ...0010 revoked client select, so nothing consumed the
-- table: every user paid a model call for "2 roti" no matter how many times it
-- had already been classified. spec/05 expects the opposite ("hit rate should
-- exceed 90% within weeks"), and MASTER calls caching the resolution rather
-- than the nutrition "the architecture".
--
-- Serving a row now happens in the Edge Function, which needs to mark the hit:
-- migration ...0011 evicts rows by last_hit_at, so a row that is served but
-- never touched would be reaped at 90 days precisely because it is popular
-- enough to be served from cache instead of rewritten.
--
-- SECURITY DEFINER with a pinned search_path, and EXECUTE revoked from the
-- client roles — same posture as every other resolver function. Only the
-- service role (the Edge Function) may call it.

create or replace function public.resolver_cache_touch(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update resolution_cache
     set hit_count = hit_count + 1,
         last_hit_at = now()
   where normalized_text = p_key;
end;
$$;

revoke all on function public.resolver_cache_touch(text) from public;
revoke execute on function public.resolver_cache_touch(text) from anon, authenticated;

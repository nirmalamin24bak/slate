-- Audit M14 — reap abandoned anonymous accounts.
--
-- Anonymous sign-in mints a permanent auth.users row at install
-- (src/lib/supabase.ts), and ensureUserRows eagerly creates its profiles and
-- kitchen rows. Nothing ever removes them. Every uninstall, every reinstall,
-- every device that opened the app once and never came back is a row forever.
-- That is Supabase MAU billing, three tables growing without bound, and — since
-- the C2 quorum now counts account AGE — a slowly-ripening stock of accounts an
-- attacker gets for free by waiting.
--
-- What is safe to delete is narrow, and the conditions are ANDed deliberately:
--
--   * email IS NULL. This is the anonymity test that works. auth.users in older
--     images has no is_anonymous column, and more importantly a user who has
--     taken the Settings sign-in offer (spec: an offer, never a gate) HAS an
--     email — and must never be reaped whatever else is true of them.
--   * no entries and no weights. Zero journal content. A user with one line
--     typed is a person who used the product; they keep their row.
--   * created and last seen long ago. Both, because created_at alone would reap
--     someone mid-onboarding on a slow first session.
--
-- profiles/kitchen rows are NOT part of the test: ensureUserRows creates them
-- before anything is logged, so their presence means nothing. They go with the
-- user via ON DELETE CASCADE (migration ...0001), as do entitlements.
--
-- Deliberately NOT reaped: any user with an entitlements row, even a lapsed one.
-- Someone who ever paid keeps their account until they ask otherwise.
--
-- FLAG(nirmal): 90 days is the retention line this implies, and DPDP asks us to
-- state retention in the privacy notice (docs/privacy-policy-draft.md has no
-- retention section yet). The number and the notice should be decided together.

create or replace function public.reap_anonymous_accounts(p_max integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_idle constant interval := interval '90 days';
  v_deleted integer;
begin
  with candidates as (
    select u.id
    from auth.users u
    where u.email is null
      and u.created_at < now() - c_idle
      and coalesce(u.last_sign_in_at, u.created_at) < now() - c_idle
      and not exists (select 1 from entries e where e.user_id = u.id)
      and not exists (select 1 from weights w where w.user_id = u.id)
      and not exists (select 1 from entitlements t where t.user_id = u.id)
    -- Bounded per run so one nightly job cannot turn into an hours-long delete
    -- holding locks across auth.users and every cascading table.
    limit p_max
  ), deleted as (
    delete from auth.users where id in (select id from candidates) returning 1
  )
  select count(*) into v_deleted from deleted;

  -- The erasure is real and irreversible, so it leaves the same evidence a
  -- user-requested deletion does (migration ...0012). One row per run, not per
  -- user: this is routine retention, not a rights request, and writing a million
  -- audit rows would defeat the point of reaping.
  if v_deleted > 0 then
    insert into account_deletions (user_id, source)
    values ('00000000-0000-0000-0000-000000000000', 'reaper:' || v_deleted);
  end if;

  return v_deleted;
end;
$$;

revoke all on function public.reap_anonymous_accounts(integer) from public, anon, authenticated;

-- Daily at 03:45 UTC (09:15 IST), just after reap_resolver_state at 03:30.
select cron.schedule(
  'reap-anonymous-accounts',
  '45 3 * * *',
  $$select public.reap_anonymous_accounts()$$
);

-- The candidate scan filters on email/created_at and then probes three tables by
-- user_id. entries and weights are already indexed on (user_id, ...); this covers
-- the auth.users side so the scan does not read every row every night.
create index if not exists users_anon_reap_idx
  on auth.users (created_at)
  where email is null;

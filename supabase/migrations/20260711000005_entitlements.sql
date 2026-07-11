-- Plan B2 — server-authoritative Plus entitlement (spec/07).
--
-- Plus was enforced only on the client (react-native-purchases CustomerInfo),
-- which a patched build can spoof. This table is the server's truth. It is
-- written ONLY by the revenuecat-webhook / entitlement-refresh Edge Functions
-- (service role); users may read their own row to reconcile the optimistic SDK
-- value, never write it.
--
-- Keyed on auth.uid() because Purchases.logIn() aliases the RevenueCat
-- app_user_id to the Supabase uid — entitlement and data share one identity,
-- and buying Plus still requires no login. Cascades on auth.users delete, so
-- delete-account erases it with everything else.
--
-- The authoritative check every reader uses is:
--   active AND (expires_at IS NULL OR expires_at > now())
-- so a missed EXPIRATION webhook still stops granting Plus once the row lapses.

create table entitlements (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  product      text,                      -- 'plus' (RC entitlement id)
  active       boolean not null default false,
  expires_at   timestamptz,               -- from RC expiration_at_ms; null = none/lifetime
  environment  text,                      -- 'PRODUCTION' | 'SANDBOX'
  last_event   text,                      -- last RC event type applied (audit)
  event_id     text,                      -- RC event.id of the last applied event
  updated_at   timestamptz not null default now()
);

alter table entitlements enable row level security;

-- Read own row only. No insert/update/delete policy → clients cannot write;
-- the webhook uses the service role, which bypasses RLS.
create policy "own row read" on entitlements
  for select to authenticated
  using (auth.uid() = user_id);

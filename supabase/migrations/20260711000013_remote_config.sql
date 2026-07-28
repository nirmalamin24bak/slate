-- Plan F7 — minimal remote config / feature flags.
--
-- The breach playbook (docs/breach-playbook.md) assumes an in-app banner it can
-- switch on remotely; nothing backed it. This single-row config table does, and
-- also carries a client-visible resolver flag that mirrors the server kill
-- switch so the app can degrade to local-rules-only without waiting on a 503.
--
-- Readable by any authenticated user (these are non-sensitive operational
-- flags, not user data); writable only by the service role (dashboard / an ops
-- script). One row, id = 1.

create table app_config (
  id             smallint primary key default 1 check (id = 1),
  breach_banner  text,                      -- null = no banner; text = show it
  resolver_enabled boolean not null default true,
  updated_at     timestamptz not null default now()
);

insert into app_config (id) values (1) on conflict do nothing;

alter table app_config enable row level security;
create policy "config read" on app_config
  for select to authenticated
  using (true);
-- No write policy: service role only.

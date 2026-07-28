-- Plan E2 — audit trail for account deletion.
--
-- Account deletion is irreversible (hard delete + cascade) and produced no
-- record: no way to evidence an erasure for DPDP, or to investigate a disputed
-- one. This append-only table logs the event BEFORE the delete runs. It stores
-- only the uid and a timestamp — no personal data survives, but the fact of
-- erasure does. Written service-role-only by the delete-account function; the
-- row survives the auth.users delete because it does not reference auth.users
-- (a hashed uid, not an FK).

create table account_deletions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  requested_at timestamptz not null default now(),
  source      text                       -- 'edge' etc; room for provenance
);

alter table account_deletions enable row level security;
-- No policies: service role only. Not readable by any client.

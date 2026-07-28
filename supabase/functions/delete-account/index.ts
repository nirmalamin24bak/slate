// delete-account — the DPDP right to erasure (spec/08 §2), server side.
//
// The client cannot delete from auth.users (it's in the auth schema, not
// reachable through RLS). This function does, with the service role, after
// proving the caller owns the account:
//   * JWT required: getUser() resolves the caller; no user → 401. A caller can
//     only ever delete their OWN uid — the id is taken from the verified token,
//     never from the request body, so there is no id to tamper with.
//   * the delete is HARD (not a soft tombstone) — the one place Slate does a
//     real delete — and CASCADES: every user table references auth.users(id)
//     ON DELETE CASCADE (migrations 0001/0002), so profiles, kitchen, entries,
//     weights, custom_dishes, and their children all go with it.
//   * resolution_cache is untouched: it holds no user_id by design, so there
//     is nothing personal to erase there.
//   * the RevenueCat entitlement is NOT deleted — it lives with the Apple ID,
//     which we don't own. The confirm screen says so.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { log } from '../_shared/log.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // Audit C8. An erasure is irreversible and has no recovery path, so both
  // outcomes need a record: a completed one so the operation is evidenced
  // outside the database it just cascaded through, and a failed one so a user
  // who was told "delete failed" can be believed.
  const startedAt = Date.now();
  const done = (status: number, body: unknown, fields: { outcome: string; user?: string }) => {
    log('delete-account', status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
      ...fields,
      status,
      ms: Date.now() - startedAt,
    });
    return json(status, body);
  };

  if (req.method !== 'POST') {
    return done(405, { error: 'method not allowed' }, { outcome: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return done(401, { error: 'unauthorized' }, { outcome: 'unauthorized' });
  }

  // Require an explicit confirmation flag in the body. A bare POST with just a
  // (possibly stolen) token and no body will not wipe an account by accident.
  // Note: this is not step-up auth — a true re-auth arrives with the optional
  // sign-in feature (spec: sign-in is a Settings offer, not built yet).
  let confirmed = false;
  try {
    const body = await req.json();
    confirmed = body?.confirm === true;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    return done(
      400,
      { error: 'confirmation required' },
      {
        outcome: 'unconfirmed',
        user: userData.user.id,
      },
    );
  }

  // Audit BEFORE the delete: the append-only row must exist even if the delete
  // then fails, and it survives the cascade (no FK to auth.users).
  //
  // Audit M15: the insert's error used to be discarded and the hard delete ran
  // regardless, so a failed audit produced an irreversible erasure with no
  // evidence — exactly what migration ...0012 exists to prevent. Refuse instead.
  // The user can retry; an unlogged delete cannot be undone or evidenced.
  const { error: auditError } = await service
    .from('account_deletions')
    .insert({ user_id: userData.user.id, source: 'edge' });
  if (auditError) {
    return done(
      500,
      { error: 'delete failed' },
      { outcome: 'audit_failed', user: userData.user.id },
    );
  }

  // The uid comes from the verified token, never the body — a caller can only
  // delete themselves.
  const { error } = await service.auth.admin.deleteUser(userData.user.id);
  if (error) {
    return done(
      500,
      { error: 'delete failed' },
      { outcome: 'delete_failed', user: userData.user.id },
    );
  }

  return done(200, { deleted: true }, { outcome: 'deleted', user: userData.user.id });
});

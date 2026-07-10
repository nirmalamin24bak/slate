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
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });

  // The uid comes from the verified token, never the body — a caller can only
  // delete themselves.
  const { error } = await service.auth.admin.deleteUser(userData.user.id);
  if (error) return json(500, { error: 'delete failed' });

  return json(200, { deleted: true });
});

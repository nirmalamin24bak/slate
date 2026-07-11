// The client half of server-authoritative entitlement (plan B2). Reads the
// caller's own entitlements row (RLS scopes to auth.uid()) and feeds it to the
// revenuecat store as the authoritative value. Same active-and-not-expired
// rule as the server, so a stale-but-lapsed row reads as free here too.

import { setServerEntitlement } from './revenuecat';
import type { SupabaseClient } from '@supabase/supabase-js';

interface EntitlementRow {
  active: boolean;
  expires_at: string | null;
}

export async function refreshServerEntitlement(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from('entitlements')
    .select('active, expires_at')
    .maybeSingle<EntitlementRow>();
  if (error) return; // best-effort; the SDK value stands until this succeeds
  const plus =
    !!data?.active && (data.expires_at === null || new Date(data.expires_at) > new Date());
  setServerEntitlement(plus);
}

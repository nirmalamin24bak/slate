// Remote config / feature flags (plan F7). One row, fetched on boot and
// foreground. Backs the breach banner (docs/breach-playbook.md) and a
// client-visible resolver flag that lets the app degrade to local-rules-only
// without waiting on a 503 from every classify call.
//
// Flags are non-sensitive operational state, readable by any authenticated
// user. Absent/unreachable config is not a failure — it falls back to safe
// defaults (no banner, resolver on).

import { useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RemoteConfig {
  breachBanner: string | null;
  resolverEnabled: boolean;
  /**
   * Bumped server-side when the reference seed is applied (audit M4). A device
   * mirrors the reference tables only when this differs from what it stored, so
   * an unchanged catalogue costs one small row read instead of a multi-MB pull.
   * 0 means "not known yet" — never equal to a real version, so an unreachable
   * config errs towards refreshing rather than towards a stale mirror.
   */
  referenceVersion: number;
}

const DEFAULTS: RemoteConfig = { breachBanner: null, resolverEnabled: true, referenceVersion: 0 };

let current: RemoteConfig = DEFAULTS;
const listeners = new Set<() => void>();

export function getRemoteConfig(): RemoteConfig {
  return current;
}

export function subscribeRemoteConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the live config (breach banner, resolver flag). */
export function useRemoteConfig(): RemoteConfig {
  return useSyncExternalStore(subscribeRemoteConfig, getRemoteConfig);
}

interface ConfigRow {
  breach_banner: string | null;
  resolver_enabled: boolean;
  reference_version: number | null;
}

export async function refreshRemoteConfig(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from('app_config')
    .select('breach_banner, resolver_enabled, reference_version')
    .eq('id', 1)
    .maybeSingle<ConfigRow>();
  if (error || !data) return; // keep the last-known/default config
  const next: RemoteConfig = {
    breachBanner: data.breach_banner,
    resolverEnabled: data.resolver_enabled,
    referenceVersion: data.reference_version ?? 0,
  };
  if (
    next.breachBanner === current.breachBanner &&
    next.resolverEnabled === current.resolverEnabled &&
    next.referenceVersion === current.referenceVersion
  )
    return;
  current = next;
  for (const fn of listeners) fn();
}

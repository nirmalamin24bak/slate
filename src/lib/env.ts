// Typed access to client-side env. Fails loud and early on misconfiguration
// rather than letting a half-configured app limp into runtime errors.
//
// Only EXPO_PUBLIC_* variables exist here. The service-role key is server-side
// (Edge Function secrets / scripts) and must never appear in this file.

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing env: ${name}. Copy .env.example to .env and fill it in, then restart the bundler.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  },
  // RevenueCat and PostHog are optional at runtime — their absence means "free
  // tier" / "no analytics", not a crash. Returned as `null` when unset so the
  // service module can no-op cleanly (see revenuecat.ts, analytics wiring).
  get revenueCatIosKey(): string | null {
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || null;
  },
  /**
   * PostHog is the ONE config that must fail loud, not silent: a key present
   * with no host would send events to PostHog Cloud (US) instead of our
   * region, leaking raw analytics off-shore (docs/analytics-handoff.md). Both
   * or neither. Returns null when analytics is intentionally off.
   */
  get postHog(): { key: string; host: string } | null {
    const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
    const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;
    if (!key && !host) return null;
    if (!key || !host) {
      throw new Error(
        'PostHog is half-configured: set BOTH EXPO_PUBLIC_POSTHOG_API_KEY and ' +
          'EXPO_PUBLIC_POSTHOG_HOST, or neither. A key without a host would send ' +
          'events to the wrong region.',
      );
    }
    return { key, host };
  },
} as const;

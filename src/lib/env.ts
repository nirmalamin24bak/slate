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
} as const;

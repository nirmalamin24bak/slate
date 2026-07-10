// RevenueCat wrapper — Phase 0 stub.
//
// The real SDK (react-native-purchases) is a native module that does not run
// in Expo Go, so it is not imported until the paywall lands in Phase 5 with a
// dev build. This file freezes the interface the app codes against.
//
// Monetization contract (spec/07):
// - Apple IAP only. Products: slate_monthly_199, slate_yearly_1499.
// - Purchases.logIn(supabaseUserId) aliases the RevenueCat anonymous ID to
//   auth.uid() at first launch, so entitlement and data share an identity.
// - A user can buy Plus without ever signing in.

export interface Entitlements {
  plus: boolean;
}

export async function configurePurchases(_supabaseUserId: string): Promise<void> {
  // Phase 5: Purchases.configure({ apiKey }) then Purchases.logIn(supabaseUserId).
}

export async function getEntitlements(): Promise<Entitlements> {
  // Phase 5: read customerInfo.entitlements.active.
  return { plus: false };
}

export async function restorePurchases(): Promise<Entitlements> {
  // Phase 5: Purchases.restorePurchases().
  return { plus: false };
}

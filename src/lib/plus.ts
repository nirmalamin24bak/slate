// The one hook screens use to gate Plus surfaces (spec/07 free/Plus matrix).
// Reads the RevenueCat-backed entitlement store; re-renders on change.

import { useSyncExternalStore } from 'react';

import { getEntitlements, subscribeEntitlements } from './revenuecat';

export function usePlus(): boolean {
  return useSyncExternalStore(subscribeEntitlements, () => getEntitlements().plus);
}

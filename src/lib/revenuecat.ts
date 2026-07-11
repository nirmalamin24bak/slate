// RevenueCat boundary — the only file that touches react-native-purchases.
//
// Monetization contract (spec/07):
// - Apple IAP only. Products: slate_monthly_199, slate_yearly_1499.
// - Purchases.logIn(supabaseUserId) aliases the RevenueCat anonymous ID to
//   auth.uid() at first launch, so entitlement and data share an identity.
// - A user can buy Plus without ever signing in.
//
// The SDK is a native module and does not exist in Expo Go, on web, or in
// vitest. It is loaded guardedly; everywhere it is absent the app behaves as
// free tier. The rest of the app reads Plus through getEntitlements /
// subscribeEntitlements and never imports the SDK.

import { env } from './env';

export interface Entitlements {
  plus: boolean;
}

export interface PlusPrices {
  /** localized, e.g. '₹199' */
  monthly: string | null;
  /** localized, e.g. '₹1,499' */
  yearly: string | null;
}

export type PlusPlan = 'monthly' | 'yearly';

const ENTITLEMENT_ID = 'plus';

// --- minimal typed surface of react-native-purchases (v9) -------------------

interface RcCustomerInfo {
  entitlements: { active: Record<string, unknown> };
}

interface RcPackage {
  identifier: string;
  packageType: string; // 'MONTHLY' | 'ANNUAL' | ...
  product: { priceString: string };
}

interface RcOfferings {
  current: { availablePackages: RcPackage[] } | null;
}

interface RcSdk {
  configure(options: { apiKey: string; appUserID?: string }): void;
  logIn(appUserID: string): Promise<{ customerInfo: RcCustomerInfo }>;
  getCustomerInfo(): Promise<RcCustomerInfo>;
  getOfferings(): Promise<RcOfferings>;
  purchasePackage(pkg: RcPackage): Promise<{ customerInfo: RcCustomerInfo }>;
  restorePurchases(): Promise<RcCustomerInfo>;
  addCustomerInfoUpdateListener(listener: (info: RcCustomerInfo) => void): void;
}

function loadSdk(): RcSdk | null {
  try {
    // Native module — absent in Expo Go / web / node. Guarded on purpose.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as { default?: RcSdk };
    return mod.default ?? null;
  } catch {
    return null;
  }
}

// --- entitlement store -------------------------------------------------------

let sdk: RcSdk | null = null;
let configured = false;
// The RC SDK value. After server-authoritative gating (below) it is only an
// optimistic accelerator for the seconds between a purchase and the webhook.
let current: Entitlements = { plus: false };
// The authoritative value, from the entitlements table (setServerEntitlement).
// null until the first read lands (cold start / offline) — then it wins.
let serverEntitlement: Entitlements | null = null;
// After a purchase/restore, trust the SDK's `true` for a short window so the
// UI doesn't read free while the webhook is in flight.
let optimisticUntil = 0;
const OPTIMISTIC_WINDOW_MS = 60_000;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function setEntitlements(next: Entitlements): void {
  if (next.plus === current.plus) return;
  current = next;
  notify();
}

/** Test-only: seed the SDK-derived value without the native module. */
export function __setCurrentForTest(next: Entitlements): void {
  current = next;
  notify();
}

/** The server row is truth. Call after reading the entitlements table. */
export function setServerEntitlement(plus: boolean): void {
  if (serverEntitlement?.plus === plus) return;
  serverEntitlement = { plus };
  notify();
}

export function getServerEntitlement(): Entitlements | null {
  return serverEntitlement;
}

/** Open the optimistic window: call right after a successful purchase/restore. */
export function markOptimistic(): void {
  optimisticUntil = Date.now() + OPTIMISTIC_WINDOW_MS;
  notify();
}

function fromCustomerInfo(info: RcCustomerInfo): Entitlements {
  return { plus: ENTITLEMENT_ID in info.entitlements.active };
}

/** Dev-only escape hatch so the free/Plus matrix is testable without IAP. */
function devOverride(): Entitlements | null {
  if (!__DEV__) return null;
  const flag = process.env.EXPO_PUBLIC_DEV_FORCE_PLUS;
  return flag === '1' ? { plus: true } : null;
}

/**
 * Effective Plus. Server-authoritative: once the server row is known it wins.
 * The SDK can only ADD Plus, and only inside the optimistic window after a
 * purchase — a spoofed SDK value grants nothing on the server-enforced paths
 * (resolver-classify) and nothing here beyond that window. Before the server
 * row loads (cold start / offline) fall back to the SDK value so the UI isn't
 * stuck free.
 */
export function getEntitlements(): Entitlements {
  const dev = devOverride();
  if (dev) return dev;
  if (serverEntitlement === null) return current; // not loaded yet
  if (serverEntitlement.plus) return { plus: true };
  if (current.plus && Date.now() < optimisticUntil) return { plus: true };
  return { plus: false };
}

export function subscribeEntitlements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Boot-time wiring: configure the SDK and alias the RevenueCat anonymous ID to
 * the Supabase user id. Safe to call when the native module is absent (no-op,
 * free tier) or repeatedly (configures once).
 */
export async function configurePurchases(supabaseUserId: string): Promise<void> {
  if (configured) return;
  sdk = loadSdk();
  const apiKey = env.revenueCatIosKey;
  if (!sdk || !apiKey) return; // Expo Go / web / missing key: free tier
  configured = true;
  sdk.configure({ apiKey });
  sdk.addCustomerInfoUpdateListener((info) => setEntitlements(fromCustomerInfo(info)));
  try {
    const { customerInfo } = await sdk.logIn(supabaseUserId);
    setEntitlements(fromCustomerInfo(customerInfo));
  } catch {
    // Offline at boot: the listener updates us when StoreKit responds.
  }
}

/** Localized prices for the paywall. Nulls when the store is unreachable. */
export async function getPlusPrices(): Promise<PlusPrices> {
  if (!sdk) return { monthly: null, yearly: null };
  try {
    const offerings = await sdk.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const monthly = packages.find((p) => p.packageType === 'MONTHLY');
    const yearly = packages.find((p) => p.packageType === 'ANNUAL');
    return {
      monthly: monthly?.product.priceString ?? null,
      yearly: yearly?.product.priceString ?? null,
    };
  } catch {
    return { monthly: null, yearly: null };
  }
}

/** Runs the Apple purchase sheet. Resolves to the resulting entitlements. */
export async function purchasePlus(plan: PlusPlan): Promise<Entitlements> {
  if (!sdk) return getEntitlements();
  const offerings = await sdk.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  const wanted = plan === 'monthly' ? 'MONTHLY' : 'ANNUAL';
  const pkg = packages.find((p) => p.packageType === wanted);
  if (!pkg) throw new Error('plan unavailable');
  const { customerInfo } = await sdk.purchasePackage(pkg);
  setEntitlements(fromCustomerInfo(customerInfo));
  markOptimistic(); // trust SDK Plus until the webhook lands on the server row
  return getEntitlements();
}

export async function restorePurchases(): Promise<Entitlements> {
  if (!sdk) return getEntitlements();
  const info = await sdk.restorePurchases();
  setEntitlements(fromCustomerInfo(info));
  markOptimistic();
  return getEntitlements();
}

// Onboarding state, device side (spec/09): everything collected before Start
// is held locally and flushed to profiles + kitchen in one transaction the
// moment a session exists. If the anonymous sign-in failed (offline install),
// rows land under PENDING_USER_ID and are adopted when the session appears.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { flushOnboarding } from '../db/profileRepo';
import { DEFAULT_DRAFT, toKitchenPatch, toProfilePatch, type OnboardingDraft } from '../onboarding';
import { services } from './services';

const DRAFT_KEY = 'slate.onboarding.draft.v1';
const DONE_KEY = 'slate.onboarding.done.v1';

export async function loadDraft(): Promise<OnboardingDraft> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return DEFAULT_DRAFT;
    return { ...DEFAULT_DRAFT, ...(JSON.parse(raw) as Partial<OnboardingDraft>) };
  } catch {
    return DEFAULT_DRAFT;
  }
}

export async function saveDraft(draft: OnboardingDraft): Promise<void> {
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export async function isOnboardingDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(DONE_KEY)) === '1';
}

/** Start pressed: flush the draft, mark done, clear the local copy. */
export async function completeOnboarding(draft: OnboardingDraft): Promise<void> {
  const svc = await services();
  const now = new Date();
  await flushOnboarding(
    svc.adapter,
    svc.userId,
    toProfilePatch(draft, now),
    toKitchenPatch(draft),
    now.toISOString(),
  );
  await AsyncStorage.setItem(DONE_KEY, '1');
  await AsyncStorage.removeItem(DRAFT_KEY);
  void svc.syncTick();
}

export type OnboardingGate = 'loading' | 'pending' | 'done';

/** Route guard: the journal renders only after onboarding has run once. */
export function useOnboardingGate(): OnboardingGate {
  const [gate, setGate] = useState<OnboardingGate>('loading');
  useEffect(() => {
    let mounted = true;
    isOnboardingDone().then((done) => {
      if (mounted) setGate(done ? 'done' : 'pending');
    });
    return () => {
      mounted = false;
    };
  }, []);
  return gate;
}

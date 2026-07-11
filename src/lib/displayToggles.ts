// The display toggle columns of `profiles` (spec/02 §F Customize display,
// §G What-you-can-write). Both screens read and write the same booleans; this
// hook is the single writer so they never drift. Sleep is Plus — a free user
// tapping it gets the paywall, handled by the caller.

import { useCallback, useEffect, useState } from 'react';

import { getProfile, patchProfile } from '../db/profileRepo';
import type { ProfileRow } from '../db/rows';
import { services } from './services';

// Every boolean the two screens touch. hide_calories is inverted at the UI
// (the switch reads "show calorie counts") but stored as written.
export type DisplayKey =
  | 'hide_calories'
  | 'show_macros'
  | 'show_fiber_sugar'
  | 'show_exercise'
  | 'show_weight'
  | 'show_water'
  | 'show_steps'
  | 'show_sleep';

export type DisplayState = Record<DisplayKey, boolean>;

const KEYS: readonly DisplayKey[] = [
  'hide_calories',
  'show_macros',
  'show_fiber_sugar',
  'show_exercise',
  'show_weight',
  'show_water',
  'show_steps',
  'show_sleep',
];

function fromRow(row: ProfileRow | null): DisplayState {
  const state = {} as DisplayState;
  for (const key of KEYS) {
    // schema defaults: show_macros defaults on, everything else off
    const fallback = key === 'show_macros' ? 1 : 0;
    state[key] = ((row?.[key] as number | undefined) ?? fallback) === 1;
  }
  return state;
}

export interface DisplayTogglesApi {
  state: DisplayState | null;
  setToggle(key: DisplayKey, value: boolean): void;
}

export function useDisplayToggles(): DisplayTogglesApi {
  const [state, setState] = useState<DisplayState | null>(null);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const row = await getProfile(svc.adapter, svc.userId);
      if (mounted) setState(fromRow(row));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setToggle = useCallback((key: DisplayKey, value: boolean) => {
    setState((prev) => (prev ? { ...prev, [key]: value } : prev));
    void services().then(async (svc) => {
      await patchProfile(
        svc.adapter,
        svc.userId,
        { [key]: value ? 1 : 0 },
        new Date().toISOString(),
      );
      void svc.syncTick();
    });
  }, []);

  return { state, setToggle };
}

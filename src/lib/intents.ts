// The six teach-sheet definitions (spec/02 §G), copy verbatim from the spec.
// Each maps to the display toggle it controls; food is always on.

import type { TeachContent } from '../components/TeachSheet';
import type { DisplayKey } from './displayToggles';

export interface IntentCard extends TeachContent {
  /** the profiles column this card's toggle writes; null for food */
  toggleKey: DisplayKey | null;
}

export const INTENT_CARDS: readonly IntentCard[] = [
  {
    icon: '🥣',
    title: 'Food',
    body: 'Write a food and get the calories and macros. Add detail to make it more precise.',
    examples: ['2 rotis', '1 katori dal, less oil', 'Masala dosa'],
    alwaysOn: true,
    toggleKey: null,
  },
  {
    icon: '🏃',
    title: 'Exercise',
    body: 'Write exercises. Add time or intensity for a closer estimate.',
    examples: ['30 min jog', '45 minutes of weights', '1 hr yoga'],
    toggleKey: 'show_exercise',
  },
  {
    icon: '〰',
    title: 'Weight',
    body: 'Write your current weight. It shows up in Stats.',
    examples: ['weight 72', "I'm at 72 kg", 'Weekly weigh-in 71.5'],
    toggleKey: 'show_weight',
  },
  {
    icon: '💧',
    title: 'Water',
    body: 'Write how much water you drink.',
    examples: ['1 glass of water', '1 litre of water', '2 glasses'],
    toggleKey: 'show_water',
  },
  {
    icon: '👣',
    title: 'Steps',
    body: 'Write any steps you take. Slate counts steps above 3,000 — the rest is already in your baseline.',
    examples: ['8000 steps', '8k steps', '12k steps'],
    toggleKey: 'show_steps',
  },
  {
    icon: '🌙',
    title: 'Sleep',
    body: "Write how you slept. Chat uses it for context. It doesn't affect your calories.",
    examples: ['7.5 hours of sleep', 'Woke up twice', 'Slept badly'],
    plus: true,
    toggleKey: 'show_sleep',
  },
];

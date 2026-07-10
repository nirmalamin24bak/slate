// Public surface of the journal core (spec/02 §B, spec/09). Pure day math +
// the orchestrating store. No React Native imports — the UI subscribes.

export { composeDay, DEFAULT_MIN_PER_KM, recomputeDay } from './compose';
export type { DayContext, DayLine, DayLookups, DayTotals, LineDisplay } from './compose';
export { addDays, dayKey, daysBetween, FREE_HISTORY_DAYS, isWithinFreeWindow } from './dates';
export { JournalStore } from './store';
export type { DayView, JournalDeps, JournalEvent } from './store';

// The journal store — orchestrates spec/09's offline contract:
//
//   1. the line is in SQLite with a client UUID before anything else happens
//   2. resolver failure marks it unresolved + retryable, never blocks typing
//   3. connectivity back → queue drains oldest-first with backoff
//   4. numbers backfill; totals recompute from what's actually resolved
//
// Everything injectable (clock, ids, resolver), so the airplane-mode gate is
// a deterministic test, not a hope.

import { GLASS_ML, LITRE_ML } from '../engine/constants';
import type { ResolvedSegment } from '../resolver';
import { RetryQueue } from '../resolver';
import type { Resolution } from '../resolver/types';
import type { SqlAdapter } from '../db/adapter';
import {
  getEntry,
  insertEntry,
  listDay,
  listRetryable,
  nextPosition,
  patchEntry,
  type EntryPatch,
} from '../db/entriesRepo';
import { getKitchen, getProfile, patchProfile, upsertWeight } from '../db/profileRepo';
import { reportEvent } from '../lib/report';
import { getExercise, getPackagedFood, loadDish } from '../db/referenceRepo';
import type { EntryRow, ExerciseRow } from '../db/rows';
import { toKitchen } from '../db/rows';
import { composeDay, recomputeDay, type DayLine, type DayTotals } from './compose';

const WEIGHT_CONFIRM_DELTA_KG = 5;

export interface JournalDeps {
  adapter: SqlAdapter;
  userId: string;
  resolveText(text: string): Promise<ResolvedSegment[]>;
  now(): Date;
  newId(): string;
}

export type JournalEvent =
  | { type: 'change' }
  | { type: 'weightConfirm'; entryId: string; newKg: number; prevKg: number }
  | { type: 'needsWeight' };

export interface DayView {
  lines: DayLine[];
  totals: DayTotals;
}

export class JournalStore {
  private readonly queue = new RetryQueue<string>();
  private readonly listeners = new Set<(event: JournalEvent) => void>();
  private weightPromptShown = false;

  constructor(private readonly deps: JournalDeps) {}

  /**
   * Offline install (spec/09): rows are written under a placeholder id until
   * the anonymous session arrives, then adopted. The services layer rewrites
   * the rows' user_id and calls this so subsequent writes use the real uid.
   */
  reassignUser(userId: string): void {
    this.deps.userId = userId;
  }

  on(listener: (event: JournalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Nudge subscribers to re-read (e.g. after a down-sync changed rows). */
  emitChange(): void {
    this.emit({ type: 'change' });
  }

  private emit(event: JournalEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Rebuild the retry queue after a cold start (force-quit survives in SQLite). */
  async restore(): Promise<void> {
    const rows = await listRetryable(this.deps.adapter, this.deps.userId);
    const now = this.deps.now().getTime();
    for (const row of rows) this.queue.push(row.id, now);
  }

  async day(logDate: string): Promise<DayView> {
    const rows = await listDay(this.deps.adapter, this.deps.userId, logDate);
    return composeDay(rows);
  }

  /** Type a line, hit return. The row exists before the resolver is asked. */
  async addLine(text: string, logDate: string): Promise<string> {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('empty line');
    const { adapter, userId } = this.deps;
    const nowIso = this.deps.now().toISOString();
    const id = this.deps.newId();
    const position = await nextPosition(adapter, userId, logDate);

    await insertEntry(adapter, {
      id,
      user_id: userId,
      log_date: logDate,
      position,
      raw_text: trimmed,
      nickname: null,
      intent: 'unresolved',
      status: 'resolving',
      resolved_ref: null,
      qty: null,
      unit: null,
      context: null,
      kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
      sugar_g: null,
      water_ml: null,
      step_count: null,
      sleep_minutes: null,
      is_included: 0,
      calc_version: 'pending',
      was_calibrated: 0,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      retryable: 0,
      dirty: 1,
    });
    this.emit({ type: 'change' });

    await this.resolveRow(id);
    return id;
  }

  /** Tap an unresolved line: retry now, ignoring backoff (spec/09). */
  async retryLine(entryId: string): Promise<void> {
    await this.resolveRow(entryId);
  }

  /** Drain due queue entries, oldest first. Call on connectivity/tick. */
  async drainDue(): Promise<void> {
    const due = this.queue.due(this.deps.now().getTime());
    for (const item of due) {
      const row = await getEntry(this.deps.adapter, item.item);
      if (!row || row.deleted_at !== null || row.status !== 'unresolved' || row.retryable !== 1) {
        continue; // resolved meanwhile, deleted, or manually handled
      }
      // drain requeues with the attempt count intact — resolveRow must not
      // also push, or the row would sit in the queue twice.
      const stillQueued = await this.resolveRow(row.id, false);
      if (stillQueued) {
        const requeued = this.queue.requeue(item, this.deps.now().getTime());
        if (!requeued) {
          // Hit the attempt cap. Stop auto-retrying: clear the retryable flag
          // so the drain guard skips it. The line stays unresolved with its
          // manual ↻ (spec/09); it just no longer wakes the app on a timer.
          await patchEntry(
            this.deps.adapter,
            row.id,
            { retryable: 0 },
            this.deps.now().toISOString(),
          );
          reportEvent('resolver_retry_exhausted', { entryId: row.id });
        }
      }
    }
  }

  get queuedCount(): number {
    return this.queue.size;
  }

  /** The >5kg inline confirm answer (spec/09 Weight edge cases). */
  async confirmWeight(entryId: string, accepted: boolean): Promise<void> {
    const row = await getEntry(this.deps.adapter, entryId);
    if (!row || row.intent !== 'weight' || row.qty === null) return;
    if (accepted) {
      await this.writeBodyWeight(row.qty, row.log_date);
      await this.recompute(row.log_date);
    }
    this.emit({ type: 'change' });
  }

  /** Answer to the one-time inline weight prompt at first exercise/steps log. */
  async provideBodyWeight(weightKg: number, logDate: string): Promise<void> {
    await this.writeBodyWeight(weightKg, logDate);
    await this.recompute(logDate);
    this.emit({ type: 'change' });
  }

  /**
   * Re-run write-time nutrition for a day after a kitchen or personalization
   * change (spec/06: nutrition is denormalised, so past days keep their
   * calc_version and are NOT rewritten — only the day the user is looking at
   * refreshes). Emits change so the journal re-reads.
   */
  async recomputeToday(logDate: string): Promise<void> {
    await this.recompute(logDate);
    this.emit({ type: 'change' });
  }

  /** Nickname a line → it becomes a saved food. Saving is renaming. */
  async setNickname(entryId: string, nickname: string | null): Promise<void> {
    await patchEntry(this.deps.adapter, entryId, { nickname }, this.deps.now().toISOString());
    this.emit({ type: 'change' });
  }

  /** Edit the text of a line: back to resolving, resolve again. */
  async editLine(entryId: string, newText: string): Promise<void> {
    const trimmed = newText.trim();
    if (trimmed.length === 0) return;
    await patchEntry(
      this.deps.adapter,
      entryId,
      {
        raw_text: trimmed,
        status: 'resolving',
        intent: 'unresolved',
        resolved_ref: null,
        qty: null,
        unit: null,
        context: null,
        kcal: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        water_ml: null,
        step_count: null,
        sleep_minutes: null,
        is_included: 0,
        retryable: 0,
      },
      this.deps.now().toISOString(),
    );
    this.emit({ type: 'change' });
    await this.resolveRow(entryId);
  }

  async deleteLine(entryId: string): Promise<void> {
    const row = await getEntry(this.deps.adapter, entryId);
    if (!row) return;
    await patchEntry(
      this.deps.adapter,
      entryId,
      { deleted_at: this.deps.now().toISOString() },
      this.deps.now().toISOString(),
    );
    await this.recompute(row.log_date);
    this.emit({ type: 'change' });
  }

  // -------------------------------------------------------------------------

  /** Resolve one row. Returns true when the row should stay in the queue. */
  private async resolveRow(entryId: string, queueOnFailure = true): Promise<boolean> {
    const { adapter } = this.deps;
    const row = await getEntry(adapter, entryId);
    if (!row || row.deleted_at !== null) return false;

    if (row.status !== 'resolving') {
      await patchEntry(adapter, entryId, { status: 'resolving' }, this.deps.now().toISOString());
      this.emit({ type: 'change' });
    }

    const segments = await this.deps.resolveText(row.raw_text);
    const first = segments[0];
    if (!first) return false;

    // Multi-entry split: the first segment stays on this row; the rest become
    // their own rows directly below it ("2 roti aur ek katori dal" → 2 lines).
    // The position bump, the inserts, and the original's raw_text patch are one
    // transaction — a crash mid-split otherwise leaves positions bumped with no
    // extras inserted (a gap and a duplicate-position hazard). Capture the new
    // ids so the apply loop targets rows directly, never by position arithmetic
    // (which breaks if another line was added concurrently).
    const extras = segments.slice(1);
    const extraIds: string[] = [];
    await adapter.transaction(async () => {
      if (extras.length > 0) {
        await adapter.run(
          'UPDATE entries SET position = position + ? WHERE user_id = ? AND log_date = ? AND position > ?',
          [extras.length, row.user_id, row.log_date, row.position],
        );
        for (const [i, segment] of extras.entries()) {
          const nowIso = this.deps.now().toISOString();
          const id = this.deps.newId();
          extraIds.push(id);
          await insertEntry(adapter, {
            ...row,
            id,
            position: row.position + 1 + i,
            raw_text: segment.raw,
            // A fresh unresolved skeleton, not the parent's resolved state.
            intent: 'unresolved',
            status: 'resolving',
            resolved_ref: null,
            qty: null,
            unit: null,
            kcal: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            water_ml: null,
            step_count: null,
            sleep_minutes: null,
            is_included: 0,
            nickname: null,
            created_at: nowIso,
            updated_at: nowIso,
            retryable: 0,
            dirty: 1,
          });
        }
      }
      await patchEntry(adapter, entryId, { raw_text: first.raw }, this.deps.now().toISOString());
    });

    // Apply each segment to its row: the original for i===0, else the extra we
    // just inserted (matched by captured id, not by recomputed position).
    let anyRetryable = false;
    for (const [i, segment] of segments.entries()) {
      const target = i === 0 ? row : await getEntry(adapter, extraIds[i - 1] ?? '');
      if (!target) continue;
      const queued = await this.applyResolution(target, segment);
      if (i === 0) anyRetryable = queued;
      else if (queued) this.queue.push(target.id, this.deps.now().getTime());
    }
    if (anyRetryable && queueOnFailure) this.queue.push(entryId, this.deps.now().getTime());

    await this.recompute(row.log_date);
    this.emit({ type: 'change' });
    return anyRetryable;
  }

  /** Map a Resolution onto a row. Returns true when retryable-unresolved. */
  private async applyResolution(row: EntryRow, segment: ResolvedSegment): Promise<boolean> {
    const { adapter } = this.deps;
    const nowIso = this.deps.now().toISOString();
    const r: Resolution = segment.resolution;

    if (r.intent === 'unresolved') {
      await patchEntry(
        adapter,
        row.id,
        { status: 'unresolved', intent: 'unresolved', retryable: segment.retryable ? 1 : 0 },
        nowIso,
      );
      return segment.retryable;
    }

    const base: EntryPatch = {
      status: 'resolved',
      intent: r.intent,
      resolved_ref: r.ref,
      qty: r.qty,
      unit: r.unit,
      context: r.context,
      retryable: 0,
    };

    switch (r.intent) {
      case 'water': {
        const ml =
          r.unit === 'glass'
            ? (r.qty ?? 1) * GLASS_ML
            : r.unit === 'l'
              ? (r.qty ?? 0) * LITRE_ML
              : (r.qty ?? 0);
        await patchEntry(adapter, row.id, { ...base, water_ml: ml }, nowIso);
        return false;
      }
      case 'sleep': {
        const minutes = r.unit === 'hours' && r.qty !== null ? Math.round(r.qty * 60) : null;
        await patchEntry(adapter, row.id, { ...base, sleep_minutes: minutes }, nowIso);
        return false;
      }
      case 'steps': {
        await patchEntry(adapter, row.id, { ...base, step_count: r.qty }, nowIso);
        await this.maybePromptForWeight();
        return false;
      }
      case 'weight': {
        await patchEntry(adapter, row.id, base, nowIso);
        if (r.qty === null) return false;
        const profile = await getProfile(adapter, this.deps.userId);
        const prev = profile?.weight_kg ?? null;
        const assumed = (profile?.weight_is_assumed ?? 1) === 1;
        if (prev !== null && !assumed && Math.abs(r.qty - prev) > WEIGHT_CONFIRM_DELTA_KG) {
          // Never silently overwrite body weight (spec/05). UI confirms inline.
          this.emit({ type: 'weightConfirm', entryId: row.id, newKg: r.qty, prevKg: prev });
          return false;
        }
        await this.writeBodyWeight(r.qty, row.log_date);
        return false;
      }
      case 'exercise': {
        await patchEntry(adapter, row.id, base, nowIso);
        await this.maybePromptForWeight();
        return false;
      }
      default: {
        // food
        await patchEntry(adapter, row.id, base, nowIso);
        return false;
      }
    }
  }

  /** spec/09: first exercise/steps log while weight is assumed → one inline prompt. */
  private async maybePromptForWeight(): Promise<void> {
    if (this.weightPromptShown) return;
    const profile = await getProfile(this.deps.adapter, this.deps.userId);
    if ((profile?.weight_is_assumed ?? 1) === 1) {
      this.weightPromptShown = true;
      this.emit({ type: 'needsWeight' });
    }
  }

  private async writeBodyWeight(weightKg: number, logDate: string): Promise<void> {
    const nowIso = this.deps.now().toISOString();
    await upsertWeight(this.deps.adapter, {
      id: this.deps.newId(),
      user_id: this.deps.userId,
      log_date: logDate,
      weight_kg: weightKg,
      source: 'journal',
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      dirty: 1,
    });
    await patchProfile(
      this.deps.adapter,
      this.deps.userId,
      { weight_kg: weightKg, weight_is_assumed: 0 },
      nowIso,
    );
  }

  /** Re-derive every number on the day and persist only what changed. */
  private async recompute(logDate: string): Promise<void> {
    const { adapter, userId } = this.deps;
    const rows = await listDay(adapter, userId, logDate);

    const dishes = new Map<string, NonNullable<Awaited<ReturnType<typeof loadDish>>>>();
    const exercises = new Map<string, Pick<ExerciseRow, 'met' | 'unit' | 'is_ambulatory'>>();
    const packagedFoods = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof getPackagedFood>>>
    >();

    for (const row of rows) {
      const ref = row.resolved_ref;
      if (!ref || row.status !== 'resolved') continue;
      if (row.intent === 'food' && !dishes.has(ref) && !packagedFoods.has(ref)) {
        const dish = await loadDish(adapter, ref);
        if (dish) dishes.set(ref, dish);
        else {
          const packaged = await getPackagedFood(adapter, ref);
          if (packaged) packagedFoods.set(ref, packaged);
        }
      } else if (row.intent === 'exercise' && !exercises.has(ref)) {
        const exercise = await getExercise(adapter, ref);
        if (exercise) exercises.set(ref, exercise);
      }
    }

    const profile = await getProfile(adapter, userId);
    const kitchenRow = await getKitchen(adapter, userId);
    if (!kitchenRow) return; // no user rows yet — nothing to compute against

    const patches = recomputeDay(
      rows,
      { dishes, exercises, packagedFoods },
      {
        kitchen: toKitchen(kitchenRow),
        kitchenIsAssumed: kitchenRow.is_assumed === 1,
        weightKg: (profile?.weight_is_assumed ?? 1) === 1 ? null : (profile?.weight_kg ?? null),
        personalization: profile?.personalization ?? null,
      },
    );

    const nowIso = this.deps.now().toISOString();
    for (const [id, patch] of patches) {
      await patchEntry(adapter, id, patch, nowIso);
      // A food ref that fell out of the catalogue re-queues honestly.
      if (patch.status === 'unresolved' && patch.retryable === 1) {
        this.queue.push(id, this.deps.now().getTime());
      }
    }
  }
}

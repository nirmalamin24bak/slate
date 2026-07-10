import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';

import type { CachedResolution, CacheStore, Catalogue, ClassifyTransport } from '../src/resolver';
import { resolve as resolveLine } from '../src/resolver';
import { buildSystemPrompt } from '../supabase/functions/resolver-classify/prompt';

// Phase-2 gate (plan): >=90% intent accuracy and unresolved_rate < 5% on the
// 500-line Hinglish set, with ZERO wrong-ref-at-high-confidence. Runs the real
// pipeline — normalize → rules → cache → live model → validate — against the
// draft catalogue seeds. Opt-in like the RLS gate: it needs a network, a
// model key, and several minutes.
//
//   RESOLVER_EVAL=1 RESOLVER_PROVIDER_API_KEY=... npm test -- test/resolver-eval.test.ts
//
// The eval set and both seed files are model-drafted and FLAG(nirmal) — the
// gate result only counts after his correction pass (test/eval/README.md).

function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(resolvePath(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env yet — handled below
  }
  return out;
}

const dotenv = loadDotEnv();
const apiKey = process.env['RESOLVER_PROVIDER_API_KEY'] ?? dotenv['RESOLVER_PROVIDER_API_KEY'];
const model = process.env['RESOLVER_MODEL'] ?? dotenv['RESOLVER_MODEL'] ?? 'claude-haiku-4-5';
const enabled = process.env['RESOLVER_EVAL'] === '1';

interface Expectation {
  intent: string;
  ref: string | null;
  qty?: number;
  unit?: string;
  context?: string;
}

interface EvalCase {
  text: string;
  expect: Expectation[];
}

interface SeedDish {
  id: string;
  name: string;
  aliases: string[] | null;
  default_unit: string;
  default_qty: number;
}

interface SeedExercise {
  id: string;
  name: string;
  aliases: string[] | null;
  unit: string;
}

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolvePath(__dirname, '..', relative), 'utf8')) as T;
}

function memoryCache(): CacheStore {
  const rows = new Map<string, CachedResolution>();
  return {
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    put: (key, value) => {
      rows.set(key, value);
      return Promise.resolve();
    },
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

describe.runIf(enabled)('gate: resolver eval (500-line Hinglish set)', () => {
  test('intent accuracy >= 90%, unresolved rate < 5%, zero wrong refs at high confidence', async () => {
    if (!apiKey) {
      throw new Error('RESOLVER_EVAL=1 but RESOLVER_PROVIDER_API_KEY is not set (env or .env).');
    }

    const dishes = readJson<SeedDish[]>('supabase/seed/dishes.draft.json');
    const exercises = readJson<SeedExercise[]>('supabase/seed/exercises.draft.json');
    const cases = readFileSync(resolvePath(__dirname, 'eval', 'hinglish-500.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvalCase);

    const catalogue: Catalogue = {
      dishes: new Set(dishes.map((d) => d.id)),
      exercises: new Set(exercises.map((e) => e.id)),
      packagedFoods: new Set<string>(),
      customDishes: new Set<string>(),
    };

    // The exact prompt the Edge Function serves, built from the same seeds.
    const system = buildSystemPrompt({
      dishes,
      exercises,
      packagedFoods: [],
    });

    const client = new Anthropic({ apiKey });
    const transport: ClassifyTransport = {
      async classify(line) {
        const response = await client.messages.create({
          model,
          max_tokens: 500,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: line }],
        });
        const block = response.content.find((b) => b.type === 'text');
        return block && block.type === 'text' ? block.text : '';
      },
    };

    const cache = memoryCache();
    let expectations = 0;
    let intentCorrect = 0;
    let shouldResolve = 0;
    let cameBackUnresolved = 0;
    let wrongRefHighConfidence = 0;
    const misses: string[] = [];

    await pool(cases, 4, async (c) => {
      const got = await resolveLine(c.text, { cache, transport, catalogue, timeoutMs: 30000 });
      c.expect.forEach((exp, i) => {
        expectations += 1;
        const seg = got[i];
        const intent = seg?.resolution.intent ?? 'missing';
        if (intent === exp.intent) intentCorrect += 1;
        else misses.push(`"${c.text}" [${i}] expected ${exp.intent}, got ${intent}`);
        if (exp.intent !== 'unresolved') {
          shouldResolve += 1;
          if (intent === 'unresolved') cameBackUnresolved += 1;
        }
        if (
          seg &&
          exp.ref !== null &&
          seg.resolution.ref !== null &&
          seg.resolution.ref !== exp.ref
        ) {
          wrongRefHighConfidence += 1;
          misses.push(`"${c.text}" [${i}] WRONG REF ${seg.resolution.ref} != ${exp.ref}`);
        }
      });
    });

    const accuracy = intentCorrect / expectations;
    const unresolvedRate = cameBackUnresolved / shouldResolve;
    console.log(
      [
        `resolver eval — model ${model}`,
        `cases: ${cases.length}, expectations: ${expectations}`,
        `intent accuracy: ${(accuracy * 100).toFixed(1)}%`,
        `unresolved rate: ${(unresolvedRate * 100).toFixed(1)}%`,
        `wrong ref at high confidence: ${wrongRefHighConfidence}`,
        ...(misses.length > 0 ? ['misses:', ...misses.slice(0, 50)] : []),
      ].join('\n'),
    );

    expect(wrongRefHighConfidence).toBe(0);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
    expect(unresolvedRate).toBeLessThan(0.05);
  }, 900_000);
});

// Brand-voice guardrail (brand/BRAND-VOICE.md "Words we don't", rule 8, rule 10).
// Greps UI copy — string literals and JSX text in the screens and components —
// for banned words. A hit fails CI. This is the "grep for banned brand-voice
// words" gate from the build plan (spec/10 week 8).
//
// Scope: app/**/*.tsx, src/components/**/*.tsx, src/onboarding/draft.ts.
// Code (style objects, identifiers, imports) is excluded by extracting only
// string-literal contents and JSX text nodes, so `transform: [{...}]` in a
// style is not a hit but "transform your body" in copy is.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');

// \b-wrapped, case-insensitive. "earn" does not match "Learn"; "just" does
// not match "adjust" — word boundaries handle both.
const BANNED = [
  'wellness',
  'journey',
  'transform',
  'fuel',
  'nourish',
  'mindful',
  'guilt-free',
  'cheat meal',
  'earn',
  'burn off',
  'smash',
  'crush',
  'healthy',
  'just',
  "we've got you",
  "let's do this",
  'powered by AI',
] as const;

// Rule 8: em-dashes are for essays; UI copy gets full stops.
const EM_DASH = '—';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function copyFiles(): string[] {
  const files = [
    ...walk(path.join(ROOT, 'app')).filter((f) => f.endsWith('.tsx')),
    ...walk(path.join(ROOT, 'src', 'components')).filter((f) => f.endsWith('.tsx')),
    path.join(ROOT, 'src', 'onboarding', 'draft.ts'),
  ];
  return files.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** String-literal contents plus JSX text nodes — the surfaces users read. */
function extractCopy(src: string): string[] {
  const stripped = stripComments(src);
  const out: string[] = [];
  const literal = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of stripped.matchAll(literal)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  const jsxText = />([^<>{}]+)</g;
  for (const m of stripped.matchAll(jsxText)) {
    const text = (m[1] ?? '').trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

describe('brand voice (brand/BRAND-VOICE.md)', () => {
  const files = copyFiles();

  it('scans a sane number of copy files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(BANNED)('UI copy never contains "%s"', (word) => {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const hits: string[] = [];
    for (const file of files) {
      for (const copy of extractCopy(readFileSync(file, 'utf8'))) {
        if (pattern.test(copy)) {
          hits.push(`${path.relative(ROOT, file)}: "${copy}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('UI copy contains no em-dashes (rule 8)', () => {
    const hits: string[] = [];
    for (const file of files) {
      for (const copy of extractCopy(readFileSync(file, 'utf8'))) {
        // A bare '—' is the null / empty-state glyph (e.g. an unset weight
        // or a no-data stat), not essay punctuation joining two clauses.
        // Only flag em-dashes that sit inside real prose.
        if (copy.includes(EM_DASH) && copy.trim() !== EM_DASH) {
          hits.push(`${path.relative(ROOT, file)}: "${copy}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('em-dash guard: ignores the bare null-glyph but still catches prose', () => {
    const isViolation = (copy: string) => copy.includes(EM_DASH) && copy.trim() !== EM_DASH;
    expect(isViolation('—')).toBe(false);
    expect(isViolation('  —  ')).toBe(false);
    expect(isViolation('foo — bar')).toBe(true);
  });
});

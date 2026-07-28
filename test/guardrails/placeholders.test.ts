// Audit M10 — a placeholder must never become a shipped URL by nobody noticing.
//
// app/settings/index.tsx links Settings to https://slate.app/privacy, a domain
// Sonal Systems does not own. App Store review follows privacy links: at best
// that is a rejection, at worst it hands users to a page an unrelated party
// controls. eas.json's submit block carries REPLACE_WITH_* for the Apple ID and
// team id in the same way.
//
// This test does NOT simply fail on those, because they are known launch-gate
// items (phase-7 punch list 4) and a red suite would block every other piece of
// work rather than getting them fixed any sooner. It does the useful half:
//
//   * the known placeholders are enumerated below, so they exist in code rather
//     than only in a doc, and
//   * a NEW one — a different fake domain, another REPLACE_WITH — fails
//     immediately.
//
// When Nirmal supplies a real URL, delete its line from KNOWN. The test then
// starts guarding that file properly, and the deletion is the record that the
// gate closed.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');

/**
 * Patterns that must never reach a build. `slate.app` is here because we do not
 * own it; example.com and the EAS placeholder because they are the shapes a
 * half-configured value takes.
 */
const PLACEHOLDER =
  /REPLACE_WITH|https?:\/\/(?:www\.)?(?:slate\.app|example\.(?:com|org))|u\.expo\.dev\/(?:PROJECT|<)/;

/**
 * Every placeholder known to be outstanding, with the gate that closes it.
 * Adding a line here is a deliberate act; removing one is what "fixed" looks
 * like.
 */
const KNOWN: Record<string, string> = {
  'app/settings/index.tsx': 'privacy policy URL — phase-7 punch list 7 (unpublished policy)',
  'eas.json': 'Apple ID / ASC app id / team id — phase-7 punch list 4 (eas init never run)',
  // Found by this test on the first run: the audit named two placeholders and
  // there were three. The share sheet puts this one in front of a user's
  // friends, not just App Store review.
  'src/components/Drawer.tsx': 'share-sheet App Store link — needs the listing to exist',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(full);
  }
  return out;
}

/** The tree that can reach a user's phone, plus the config that submits it. */
function shippableFiles(): string[] {
  return [
    ...walk(join(ROOT, 'app')),
    ...walk(join(ROOT, 'src')),
    join(ROOT, 'eas.json'),
    join(ROOT, 'app.json'),
  ];
}

describe('placeholder URLs and ids', () => {
  it('has no placeholder outside the known, tracked set', () => {
    const found: string[] = [];
    for (const file of shippableFiles()) {
      // The test's own patterns would match itself.
      if (file.endsWith('placeholders.test.ts')) continue;
      if (PLACEHOLDER.test(readFileSync(file, 'utf8'))) {
        found.push(relative(ROOT, file).replace(/\\/g, '/'));
      }
    }

    const unexpected = found.filter((f) => !(f in KNOWN));
    expect(unexpected, `New placeholder(s) in shippable code: ${unexpected.join(', ')}`).toEqual(
      [],
    );
  });

  it('still has every known placeholder — remove the entry when one is fixed', () => {
    // The other direction, and the reason KNOWN is not just a comment: once a
    // real URL lands, this fails and the stale entry gets deleted, so the list
    // cannot quietly outlive the problem it describes.
    const stillPresent = Object.keys(KNOWN).filter((f) =>
      PLACEHOLDER.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(stillPresent.sort()).toEqual(Object.keys(KNOWN).sort());
  });
});

/**
 * @file Keeps each status the same colour on every screen: it finds every
 * `Badge` in `src/` whose label is plain text (a badge without `tone` is
 * `neutral`) and fails when one label has more than one tone, naming the
 * files behind each. So "Deactivated" can't be red on one page and amber on
 * the next.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

/** The repository root, so paths in messages read like `src/app/...`. */
const ROOT = path.resolve(import.meta.dirname, '../../..');

/** A badge with a plain-text label, also across lines: its tone and its label. */
const BADGE = /<Badge(?:\s+tone="(\w+)")?\s*>([^<{}]+)<\/Badge>/g;

/**
 * Lists the TypeScript React files in a folder and its subfolders, leaving
 * out tests.
 *
 * @param dir - The folder.
 * @returns Their full paths.
 */
function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return componentFiles(full);
    }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : [];
  });
}

/** For each badge label, the files that use it under each tone. */
const tonesByLabel = new Map<string, Map<string, Set<string>>>();

componentFiles(path.join(ROOT, 'src')).forEach((file) => {
  const relative = path.relative(ROOT, file);
  [...readFileSync(file, 'utf8').matchAll(BADGE)].forEach(([, tone = 'neutral', text]) => {
    const label = defined(text, 'the badge label').replace(/\s+/g, ' ').trim();
    const tones = tonesByLabel.get(label) ?? new Map<string, Set<string>>();
    tones.set(tone, (tones.get(tone) ?? new Set<string>()).add(relative));
    tonesByLabel.set(label, tones);
  });
});

describe('badge tones', () => {
  it('finds the badges (the same status on several screens)', () => {
    const deactivated = [...(tonesByLabel.get('Deactivated')?.values() ?? [])].flatMap((files) => [
      ...files,
    ]);
    expect(deactivated.length).toBeGreaterThanOrEqual(5);
  });

  it('gives each status one tone everywhere', () => {
    const mixed = [...tonesByLabel]
      .filter(([, tones]) => tones.size > 1)
      .map(
        ([label, tones]) =>
          `"${label}": ${[...tones]
            .map(([tone, files]) => `${tone} in ${[...files].join(', ')}`)
            .join('; ')}`,
      );
    expect(mixed).toEqual([]);
  });
});

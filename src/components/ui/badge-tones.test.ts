/**
 * @file Keeps each status the same colour on every screen: it finds every
 * `Badge` in `src/` whose label is one message without arguments
 * (`{t('key')}`, read as its English (US) text through the file's
 * `useTranslations` or `getTranslations`; a badge without `tone` is
 * `neutral`) and fails when one label has more than one tone, naming the
 * files behind each. So "Deactivated" can't be red on one page and amber on
 * the next. Plain-text labels can't occur (ESLint refuses text in JSX), and a
 * badge whose tone or label is a variable (`tone={STATUS_TONES[status]}`)
 * isn't read: its tones come from one table, so they agree by construction.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { messagesFor } from '@/lib/i18n/messages';

import sourceFiles from '../../../tests/source-files';

/** The repository root, so paths in messages read like `src/app/...`. */
const ROOT = path.resolve(import.meta.dirname, '../../..');

/** A badge whose label is one message without arguments: its tone, the translator and the key. */
const TRANSLATED_BADGE = /<Badge(?:\s+tone="(\w+)")?\s*>\s*\{(t\w*)\('([\w.]+)'\)\}\s*<\/Badge>/g;

/** Where a file gets a translator, e.g. `const t = useTranslations('people')`: its name and namespace. */
const TRANSLATOR = /const (t\w*) = (?:await )?(?:useTranslations|getTranslations)\('([\w.]+)'\)/g;

/**
 * Finds a message's English (US) text.
 *
 * @param key - Its full key, e.g. `people.invitations.expired`.
 * @returns The text, or `undefined` when there's no such message.
 */
function englishMessage(key: string): string | undefined {
  const found = key
    .split('.')
    .reduce<unknown>(
      (group, part) =>
        typeof group === 'object' && group !== null && Object.hasOwn(group, part)
          ? (group as Record<string, unknown>)[part]
          : undefined,
      messagesFor('en-US'),
    );
  return typeof found === 'string' ? found : undefined;
}

/**
 * Lists a file's badges with their tone and label: the label is the
 * message's English text (tried with each namespace the file gives a
 * translator of that name).
 *
 * @param source - The file's source.
 * @returns Each badge's tone and label.
 */
function badgesIn(source: string): { tone: string; label: string }[] {
  const namespaces = new Map<string, string[]>();
  [...source.matchAll(TRANSLATOR)].forEach(([, name = '', namespace = '']) => {
    namespaces.set(name, [...(namespaces.get(name) ?? []), namespace]);
  });
  return [...source.matchAll(TRANSLATED_BADGE)].flatMap(
    ([, tone = 'neutral', name = '', key = '']) => {
      const label = (namespaces.get(name) ?? [])
        .map((namespace) => englishMessage(`${namespace}.${key}`))
        .find((text) => text !== undefined);
      return label === undefined ? [] : [{ tone, label }];
    },
  );
}

/** For each badge label, the files that use it under each tone. */
const tonesByLabel = new Map<string, Map<string, Set<string>>>();

sourceFiles(path.join(ROOT, 'src'), /\.tsx$/).forEach((file) => {
  const relative = path.relative(ROOT, file);
  badgesIn(readFileSync(file, 'utf8')).forEach(({ tone, label: text }) => {
    const label = text.replace(/\s+/g, ' ').trim();
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

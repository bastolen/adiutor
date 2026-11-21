/**
 * @file Tests for the list of languages and the light match for a browser's
 * languages.
 */
import { describe, expect, it } from 'vitest';

import { isLocale, localeForLanguages, LOCALES, offeredLocale } from './locales';

describe('isLocale', () => {
  it.each(LOCALES)('accepts %s', (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it.each([undefined, null, '', 'nl', 'fr-FR', 42])('refuses %s', (value) => {
    expect(isLocale(value)).toBe(false);
  });
});

describe('localeForLanguages', () => {
  it.each([
    [['nl-BE', 'en'], 'nl-NL'],
    [['en-GB'], 'en-US'],
    [['fr-FR', 'ES'], 'es-ES'],
  ] as const)('matches %j to %s by the language', (languages, locale) => {
    expect(localeForLanguages(languages)).toBe(locale);
  });

  it('finds nothing for languages we don’t speak', () => {
    expect(localeForLanguages(['fr-FR', 'de'])).toBeNull();
    expect(localeForLanguages([])).toBeNull();
  });
});

describe('offeredLocale', () => {
  it('gives a language only while it’s offered', () => {
    expect(offeredLocale('nl-NL', LOCALES)).toBe('nl-NL');
    expect(offeredLocale('nl-NL', ['en-US', 'es-ES'])).toBeNull();
    expect(offeredLocale('fr-FR', LOCALES)).toBeNull();
    expect(offeredLocale(null, LOCALES)).toBeNull();
  });
});

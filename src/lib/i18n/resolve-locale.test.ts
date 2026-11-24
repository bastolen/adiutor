/**
 * @file Tests for working out a request's language from the language cookie,
 * Adiutor's default language and `Accept-Language`.
 */
import { describe, expect, it } from 'vitest';

import { localeFromAcceptLanguage, localeCookieFromHeaders, resolveLocale } from './resolve-locale';

describe('localeFromAcceptLanguage', () => {
  it.each([
    ['nl-BE,nl;q=0.9,en;q=0.8', 'nl-NL'],
    ['nl', 'nl-NL'],
    ['es-MX', 'es-ES'],
    ['en-GB', 'en-US'],
    ['fr-FR,es;q=0.5', 'es-ES'],
    ['pt-BR,en-US;q=0.2', 'en-US'],
  ] as const)('matches %s to %s', (header, locale) => {
    expect(localeFromAcceptLanguage(header)).toBe(locale);
  });

  it.each([undefined, null, '', '*', 'fr-FR,fr;q=0.9', 'de', 'not a language, ;;'])(
    'finds nothing for %s',
    (header) => {
      expect(localeFromAcceptLanguage(header)).toBeNull();
    },
  );
});

describe('resolveLocale', () => {
  it("prefers the browser's choice to Adiutor's default and what the browser asks for", () => {
    expect(resolveLocale({ cookie: 'es-ES', configured: 'nl-NL', acceptLanguage: 'nl-NL' })).toBe(
      'es-ES',
    );
  });

  it("takes Adiutor's default over what the browser asks for", () => {
    expect(resolveLocale({ configured: 'es-ES', acceptLanguage: 'nl-NL' })).toBe('es-ES');
    expect(resolveLocale({ cookie: 'fr-FR', configured: 'nl-NL', acceptLanguage: 'es-ES' })).toBe(
      'nl-NL',
    );
  });

  it('falls back on Accept-Language before setup, then English (US)', () => {
    expect(resolveLocale({ cookie: 'fr-FR', configured: null, acceptLanguage: 'nl-NL' })).toBe(
      'nl-NL',
    );
    expect(resolveLocale({ acceptLanguage: 'de-DE' })).toBe('en-US');
    expect(resolveLocale({})).toBe('en-US');
  });

  it('counts the browser’s choice only while that language is offered', () => {
    const offered = ['en-US', 'es-ES'] as const;
    expect(resolveLocale({ cookie: 'nl-NL', configured: 'es-ES', offered })).toBe('es-ES');
    expect(resolveLocale({ cookie: 'en-US', configured: 'es-ES', offered })).toBe('en-US');
  });
});

describe('localeCookieFromHeaders', () => {
  it('reads the language cookie among the others', () => {
    const headers = new Headers({ cookie: 'a=1; adiutor.locale=nl-NL; b=2' });
    expect(localeCookieFromHeaders(headers)).toBe('nl-NL');
  });

  it('finds nothing without the cookie', () => {
    expect(localeCookieFromHeaders(new Headers({ cookie: 'a=1' }))).toBeNull();
    expect(localeCookieFromHeaders(new Headers())).toBeNull();
    expect(localeCookieFromHeaders(null)).toBeNull();
  });
});

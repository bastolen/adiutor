/**
 * @file Tests for the users list's table caption and empty-state messages,
 * which put a filter and the search text into one sentence: each language
 * words and orders them itself.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

describe('users list messages', () => {
  it.each([
    ['en-US', 'Users: Not staff matching "ada"'],
    ['nl-NL', 'Gebruikers: geen medewerkers die overeenkomen met “ada”'],
    ['es-ES', 'Usuarios: sin personal que coinciden con “ada”'],
  ] as const)('words the caption with a filter and a search in %s', (locale, caption) => {
    const t = translator(locale, 'admin.users');

    expect(t('caption', { filter: 'not_staff', matching: 'yes', search: 'ada' })).toBe(caption);
  });

  it.each([
    ['en-US', 'All users'],
    ['nl-NL', 'Alle gebruikers'],
    ['es-ES', 'Todos los usuarios'],
  ] as const)('words the caption without a filter or a search in %s', (locale, caption) => {
    const t = translator(locale, 'admin.users');

    expect(t('caption', { filter: 'all', matching: 'no', search: '' })).toBe(caption);
  });

  it.each([
    ['en-US', 'Nothing matches "ada". Try another name or email address.'],
    ['nl-NL', 'Niets komt overeen met “ada”. Probeer een andere naam of een ander e-mailadres.'],
    ['es-ES', 'Nada coincide con “ada”. Prueba con otro nombre o correo electrónico.'],
  ] as const)('words the empty search result in %s', (locale, description) => {
    expect(translator(locale, 'admin.users')('empty.search.description', { search: 'ada' })).toBe(
      description,
    );
  });
});

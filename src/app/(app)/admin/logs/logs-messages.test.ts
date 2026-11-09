/**
 * @file The audit log's captions and day range problems in Dutch and
 * Spanish, checked as whole sentences.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

describe('audit log caption', () => {
  it('words the group and the search in each language', () => {
    const args = { kind: 'groupSearch', group: 'Inloggen', search: 'bas' };
    expect(translator('nl-NL', 'admin.logs')('caption', args)).toBe(
      'Auditlog: Inloggen, met "bas"',
    );
    expect(
      translator('es-ES', 'admin.logs')('caption', { ...args, group: 'Inicios de sesión' }),
    ).toBe('Registro de auditoría: Inicios de sesión, con "bas"');
  });

  it('words the empty search result with the group', () => {
    expect(
      translator('nl-NL', 'admin.logs')('empty.noMatchDescription', {
        kind: 'withGroup',
        search: 'bas',
        group: 'Mensen',
      }),
    ).toBe(
      'Geen gebeurtenissen van of over iemand die overeenkomen met “bas” in Mensen. Probeer een deel van een naam, een e-mailadres of een bedrijf.',
    );
  });
});

describe('day range problems', () => {
  it('is worded in each language', () => {
    expect(translator('nl-NL', 'admin.dateRange')('invalidDay')).toBe(
      'Vul de datums in als bestaande dagen, bijvoorbeeld 2026-11-03.',
    );
    expect(translator('es-ES', 'admin.dateRange')('fromAfterTo')).toBe(
      'Elige una fecha “desde” anterior o igual a la fecha “hasta”.',
    );
  });
});

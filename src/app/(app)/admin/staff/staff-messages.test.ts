/**
 * @file Word order and plurals of the staff page's messages in Dutch and
 * Spanish, checked as whole sentences.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

describe('staff count', () => {
  it('agrees the verb with one person and with several', () => {
    const nl = translator('nl-NL', 'admin.staff');
    expect(nl('people.description', { count: 1 })).toBe('1 persoon heeft toegang als medewerker.');
    expect(nl('people.description', { count: 3 })).toBe('3 mensen hebben toegang als medewerker.');
    const es = translator('es-ES', 'admin.staff');
    expect(es('people.description', { count: 1 })).toBe('1 persona tiene acceso como personal.');
    expect(es('people.description', { count: 3 })).toBe('3 personas tienen acceso como personal.');
  });

  it('puts the days in the invitation sentence', () => {
    expect(translator('nl-NL', 'admin.staff')('invite.description', { days: 1 })).toContain(
      'verloopt na 1 dag.',
    );
    expect(translator('es-ES', 'admin.staff')('invite.description', { days: 7 })).toContain(
      'caduca en 7 días.',
    );
  });
});

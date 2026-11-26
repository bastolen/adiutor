/**
 * @file Tests for the word order of the company pages' messages in Dutch and
 * Spanish: the title template (the company, then the staff), the members
 * caption and the sentences that name a person and a company.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

describe('companies messages', () => {
  it('orders the title template and the members caption per language', () => {
    expect(
      translator('nl-NL', 'companies')('titleTemplate', {
        company: 'Adiutor Tests Client',
        staff: 'Adiutor Tests',
      }),
    ).toBe('%s · Adiutor Tests Client · Adiutor Tests');
    expect(translator('nl-NL', 'companies.members')('caption', { company: 'Adiutor Tests' })).toBe(
      'Leden van Adiutor Tests',
    );
    expect(translator('es-ES', 'companies.members')('caption', { company: 'Adiutor Tests' })).toBe(
      'Miembros de Adiutor Tests',
    );
  });

  it('words the removal of a member as one sentence', () => {
    const values = { user: 'Jane Doe', company: 'Adiutor Tests' };

    expect(translator('en-US', 'companies.members')('remove.done', values)).toBe(
      'Jane Doe was removed from Adiutor Tests.',
    );
    expect(translator('nl-NL', 'companies.members')('remove.done', values)).toBe(
      'Jane Doe is verwijderd uit Adiutor Tests.',
    );
    expect(translator('es-ES', 'companies.members')('remove.done', values)).toBe(
      'Se ha quitado a Jane Doe de Adiutor Tests.',
    );
  });

  it('puts the role and the days in the plural sentences', () => {
    expect(
      translator('nl-NL', 'companies.members')('changeOwnRole.title', { role: 'Manager' }),
    ).toBe('Je eigen rol wijzigen naar Manager?');
    expect(translator('es-ES', 'companies.members')('invite.description', { days: 1 })).toContain(
      'caduca en 1 día.',
    );
  });
});

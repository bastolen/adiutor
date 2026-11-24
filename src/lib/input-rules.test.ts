/**
 * @file Tests for the input rules client components share with the schemas.
 */
import { describe, expect, it } from 'vitest';

import {
  latinWords,
  MAX_BULK_INVITES,
  MIN_PASSWORD_LENGTH,
  NAME_MAX_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  REQUEST_PREFIX_MAX_LENGTH,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  slugify,
} from './input-rules';

describe('input limits', () => {
  it('are the ones the schemas and forms agree on', () => {
    expect({
      MIN_PASSWORD_LENGTH,
      PASSKEY_NAME_MAX_LENGTH,
      MAX_BULK_INVITES,
      NAME_MAX_LENGTH,
      SLUG_MAX_LENGTH,
      REQUEST_TITLE_MAX_LENGTH,
      REQUEST_TEXT_MAX_LENGTH,
      REQUEST_PREFIX_MAX_LENGTH,
    }).toEqual({
      MIN_PASSWORD_LENGTH: 12,
      PASSKEY_NAME_MAX_LENGTH: 64,
      MAX_BULK_INVITES: 20,
      NAME_MAX_LENGTH: 100,
      SLUG_MAX_LENGTH: 60,
      REQUEST_TITLE_MAX_LENGTH: 150,
      REQUEST_TEXT_MAX_LENGTH: 10_000,
      REQUEST_PREFIX_MAX_LENGTH: 5,
    });
  });
});

describe('latinWords', () => {
  it('keeps the Latin letters and digits, without accents and in lower case', () => {
    expect(latinWords('  Adiutor   Tésts & Co ', '-')).toBe('adiutor-tests-co');
    expect(latinWords('Zoë’s Printers 2', '_')).toBe('zoe_s_printers_2');
  });

  it('leaves nothing of a name without them', () => {
    expect(latinWords('علی ✨', '-')).toBe('');
  });
});

describe('slugify', () => {
  it('suggests clean slugs from names', () => {
    expect(slugify('Adiutor Tests.')).toBe('adiutor-tests');
    expect(slugify('  Adiutor   Tésts & Co ')).toBe('adiutor-tests-co');
  });

  it('cuts a suggestion at the longest URL name', () => {
    expect(slugify('Adiutor '.repeat(20))).toHaveLength(SLUG_MAX_LENGTH);
  });
});

/**
 * @file Tests for the text helpers client components share with the schemas.
 */
import { describe, expect, it } from 'vitest';

import { latinWords, SLUG_MAX_LENGTH, slugify } from './input-rules';

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

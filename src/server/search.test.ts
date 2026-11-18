/**
 * @file Tests for the search pattern: the term matches literally, anywhere,
 * and nothing Postgres refuses in a query gets into it.
 */
import { describe, expect, it } from 'vitest';

import containsPattern from './search';

describe('containsPattern', () => {
  it('matches the term anywhere', () => {
    expect(containsPattern('adiutor')).toBe('%adiutor%');
    expect(containsPattern('Zoë علی')).toBe('%Zoë علی%');
  });

  it('escapes what LIKE gives a meaning, so it matches literally', () => {
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('drops control characters, such as the NUL character Postgres refuses', () => {
    expect(containsPattern('\u0000')).toBe('%%');
    expect(containsPattern('adi\u0000utor\r\n')).toBe('%adiutor%');
    expect(containsPattern('a\u0000%')).not.toContain('\u0000');
  });
});

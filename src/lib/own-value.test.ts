/**
 * @file Tests for looking a key from outside up in a fixed table: its own
 * entries are found, and keys it doesn't have (inherited ones included) give
 * `undefined`.
 */
import { describe, expect, it } from 'vitest';

import ownValue from './own-value';

/** A table of messages by code. */
const MESSAGES: Record<string, string> = { expired: 'That link has expired.' };

describe('ownValue', () => {
  it('returns the table’s own value', () => {
    expect(ownValue(MESSAGES, 'expired')).toBe('That link has expired.');
  });

  it.each(['unknown', 'constructor', 'toString', '__proto__'])(
    'returns undefined for %s, which the table doesn’t have itself',
    (key) => {
      expect(ownValue(MESSAGES, key)).toBeUndefined();
    },
  );
});

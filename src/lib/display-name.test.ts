/**
 * @file Tests for the name shown for a user.
 */
import { describe, expect, it } from 'vitest';

import displayName from './display-name';

describe('displayName', () => {
  it('shows the display name, trimmed', () => {
    expect(displayName({ name: '  Alex Admin ', email: 'admin@adiutor.test' })).toBe('Alex Admin');
  });

  it.each(['', '   ', null, undefined])('falls back to the email address for %j', (name) => {
    expect(displayName({ name, email: 'admin@adiutor.test' })).toBe('admin@adiutor.test');
  });
});

/**
 * @file Tests for reading text fields from submitted forms.
 */
import { describe, expect, it } from 'vitest';

import field from './form-data';

describe('field', () => {
  it('returns a text value unchanged, without trimming', () => {
    const formData = new FormData();
    formData.set('name', '  Jane Doe ');
    expect(field(formData, 'name')).toBe('  Jane Doe ');
  });

  it('returns an empty string for a missing field', () => {
    expect(field(new FormData(), 'name')).toBe('');
  });

  it('returns an empty string for a file', () => {
    const formData = new FormData();
    formData.set('avatar', new File(['content'], 'avatar.txt', { type: 'text/plain' }));
    expect(field(formData, 'avatar')).toBe('');
  });
});

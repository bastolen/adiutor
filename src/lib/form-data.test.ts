/**
 * @file Tests for reading text fields from submitted forms.
 */
import { describe, expect, it } from 'vitest';

import field, { fieldValues, localeField } from './form-data';

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

describe('fieldValues', () => {
  it('returns every text value of a field, in order, leaving files out', () => {
    const formData = new FormData();
    formData.append('assignee', 'first');
    formData.append('assignee', new File(['x'], 'x.txt'));
    formData.append('assignee', 'second');

    expect(fieldValues(formData, 'assignee')).toEqual(['first', 'second']);
  });

  it('returns nothing for a missing field', () => {
    expect(fieldValues(new FormData(), 'assignee')).toEqual([]);
  });
});

describe('localeField', () => {
  it('reads one of the languages', () => {
    const formData = new FormData();
    formData.set('locale', 'es-ES');
    expect(localeField(formData)).toBe('es-ES');
  });

  it('ignores anything else, or nothing', () => {
    const formData = new FormData();
    formData.set('locale', 'fr-FR');
    expect(localeField(formData)).toBeUndefined();
    expect(localeField(new FormData())).toBeUndefined();
  });
});

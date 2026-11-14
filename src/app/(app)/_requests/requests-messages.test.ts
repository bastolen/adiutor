/**
 * @file Tests for the messages of the request list that choose their text
 * from several values: the table's caption and the status filters.
 */
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { REQUEST_STATUS_FILTERS, REQUEST_TYPES } from '@/lib/requests';

describe('the request list’s caption', () => {
  it.each([
    ['active', 'no', 'Active requests'],
    ['waiting', 'no', 'Requests that wait for the company'],
    ['closed', 'no', 'Closed requests'],
    ['all', 'no', 'All requests'],
    ['active', 'yes', 'Active requests matching “printer”'],
    ['all', 'yes', 'All requests matching “printer”'],
  ])('says what the %s list shows (searching: %s)', (status, matching, caption) => {
    const t = translator('en-US', 'requests.list');
    expect(t('caption', { status, matching, search: 'printer' })).toBe(caption);
  });

  it.each(LOCALES)('names the search only when there is one, in %s', (locale) => {
    const t = translator(locale, 'requests.list');
    REQUEST_STATUS_FILTERS.forEach((status) => {
      const plain = t('caption', { status, matching: 'no', search: 'printer' });
      const searched = t('caption', { status, matching: 'yes', search: 'printer' });
      expect(plain).not.toContain('printer');
      expect(searched).toContain('printer');
      expect(searched.startsWith(plain)).toBe(true);
    });
  });
});

describe('the request list’s filters', () => {
  it.each(LOCALES)('name every status filter differently in %s', (locale) => {
    const t = translator(locale, 'requests.list');
    const names = REQUEST_STATUS_FILTERS.map((status) => t('statusOption', { status }));
    expect(new Set(names).size).toBe(REQUEST_STATUS_FILTERS.length);
  });
});

describe('the request types', () => {
  it.each(LOCALES)('each say what they are for in %s', (locale) => {
    const t = translator(locale, 'requests');
    const unknown = t('typeDescription', { type: 'nonsense' });
    const explanations = REQUEST_TYPES.map((type) => t('typeDescription', { type }));
    expect(new Set(explanations).size).toBe(REQUEST_TYPES.length);
    explanations.forEach((explanation) => expect(explanation).not.toBe(unknown));
  });
});

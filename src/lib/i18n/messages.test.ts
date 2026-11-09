/**
 * @file Tests for merging the catalogues and picking what a page passes to
 * the browser.
 */
import { describe, expect, it } from 'vitest';

import { LOCALES } from './locales';
import { mergeMessages, messagesFor, pickMessages } from './messages';

describe('mergeMessages', () => {
  it('lays messages over others, merging nested groups', () => {
    const base = { a: { b: 'B', c: 'C' }, d: 'D' };
    const merged = mergeMessages(base, { a: { b: 'b' } });
    expect(merged).toEqual({ a: { b: 'b', c: 'C' }, d: 'D' });
    expect(base).toEqual({ a: { b: 'B', c: 'C' }, d: 'D' });
  });
});

describe('messagesFor', () => {
  it.each(LOCALES)('gives every message in %s', (locale) => {
    expect(Object.keys(messagesFor(locale))).toEqual(Object.keys(messagesFor('en-US')));
  });

  it('speaks each language', () => {
    expect(messagesFor('en-US').common.loading).toBe('Loading…');
    expect(messagesFor('nl-NL').common.loading).toBe('Laden…');
    expect(messagesFor('es-ES').common.loading).toBe('Cargando…');
  });
});

describe('pickMessages', () => {
  it('keeps just the namespaces asked for', () => {
    const picked = pickMessages(messagesFor('nl-NL'), ['common']);
    expect(Object.keys(picked)).toEqual(['common']);
    expect(picked.common?.loading).toBe('Laden…');
  });

  it('keeps just a group inside a namespace, in its place', () => {
    const picked = pickMessages(messagesFor('nl-NL'), ['common', 'admin.staff.name']);
    expect(Object.keys(picked)).toEqual(['common', 'admin']);
    expect(Object.keys(picked.admin ?? {})).toEqual(['staff']);
    expect(Object.keys(picked.admin?.staff ?? {})).toEqual(['name']);
    expect(picked.admin?.staff.name.save).toBe('Naam opslaan');
  });

  it('merges groups of the same namespace', () => {
    const picked = pickMessages(messagesFor('en-US'), ['people.roleSelect', 'people.inviteForm']);
    expect(Object.keys(picked.people ?? {})).toEqual(['roleSelect', 'inviteForm']);
  });
});

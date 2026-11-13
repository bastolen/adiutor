/**
 * @file Tests for loading a page of the app afresh: it replaces the address
 * and reloads, also when only the section differs; with `everyTab` it tells
 * the browser's other tabs first, and only then. Also the current page's
 * address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loadFresh, { currentPage } from './load-fresh';

/** Mocked message to the browser's other tabs. */
const { tellOtherTabs } = vi.hoisted(() => ({ tellOtherTabs: vi.fn() }));

vi.mock('./acting-as-channel', () => ({ tellOtherTabs }));

/** Stands in for `window.location.reload`, which jsdom can't do. */
const reload = vi.fn();

/** Stands in for `window.location.assign`, to show it isn't used. */
const assign = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  assign.mockClear();
  tellOtherTabs.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('loadFresh', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { ...window.location, assign, reload });
  });

  it('replaces the address, keeping the history state, and reloads', () => {
    window.history.replaceState({ kept: true }, '', '/admin/users/u1');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    loadFresh('/dashboard');

    expect(replaceState).toHaveBeenCalledWith({ kept: true }, '', '/dashboard');
    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
    // A change of language is this tab's alone.
    expect(tellOtherTabs).not.toHaveBeenCalled();
  });

  it('reloads also when only the section differs from the current address', () => {
    window.history.replaceState(null, '', '/admin/users/u1');

    loadFresh('/admin/users/u1#sign-in-as');

    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('tells the other tabs first with everyTab, then reloads', () => {
    loadFresh('/auth', { everyTab: true });

    expect(tellOtherTabs).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(tellOtherTabs.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe('currentPage', () => {
  it('is the current address with its search and section', () => {
    window.history.replaceState(null, '', '/companies/adiutor-tests/members?page=2#members');

    expect(currentPage()).toBe('/companies/adiutor-tests/members?page=2#members');
  });
});

/**
 * @file Tests for loading a page of the app afresh: another page loads with
 * `location.replace`, so the address changes when it arrives; the same page
 * (only the section differs, or the same address) replaces the address and
 * reloads; with `everyTab` it tells the browser's other tabs first, and only
 * then. Also the current page's address.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import loadFresh, { currentPage } from './load-fresh';

/** Mocked message to the browser's other tabs. */
const { tellOtherTabs } = vi.hoisted(() => ({ tellOtherTabs: vi.fn() }));

vi.mock('./acting-as-channel', () => ({ tellOtherTabs }));

/** Stands in for `window.location.reload`, which jsdom can't do. */
const reload = vi.fn();

/** Stands in for `window.location.replace`, which jsdom can't do either. */
const replace = vi.fn();

/**
 * Puts the tab on a page of the app, with a `location` whose reload and
 * replace are recorded.
 *
 * @param path - The page's address, e.g. `/admin/users/u1?tab=1`.
 * @param state - The router's history state to keep.
 */
function onPage(path: string, state: unknown = null) {
  window.history.replaceState(state, '', path);
  const { href, pathname, search, hash } = new URL(path, 'http://localhost');
  vi.stubGlobal('location', { href, pathname, search, hash, reload, replace });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  replace.mockClear();
  tellOtherTabs.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('loadFresh', () => {
  it('loads another page with location.replace, so the address changes when it arrives', () => {
    onPage('/admin/users/u1');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    loadFresh('/dashboard');

    expect(replace).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(replaceState).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    // A change of language is this tab's alone.
    expect(tellOtherTabs).not.toHaveBeenCalled();
  });

  it('counts another search as another page', () => {
    onPage('/requests');

    loadFresh('/requests?status=all');

    expect(replace).toHaveBeenCalledExactlyOnceWith('/requests?status=all');
    expect(reload).not.toHaveBeenCalled();
  });

  it('replaces the address and reloads when only the section differs, keeping the history state', () => {
    onPage('/admin/users/u1', { kept: true });
    const replaceState = vi.spyOn(window.history, 'replaceState');

    loadFresh('/admin/users/u1#sign-in-as');

    expect(replaceState).toHaveBeenCalledWith({ kept: true }, '', '/admin/users/u1#sign-in-as');
    expect(reload).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('reloads the same page in place, as for a change of language', () => {
    onPage('/account?tab=profile#language');

    loadFresh('/account?tab=profile#language');

    expect(reload).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('tells the other tabs first with everyTab, then loads', () => {
    onPage('/dashboard');

    loadFresh('/auth', { everyTab: true });

    expect(tellOtherTabs).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
    expect(tellOtherTabs.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe('currentPage', () => {
  it('is the current address with its search and section', () => {
    window.history.replaceState(null, '', '/companies/adiutor-tests/members?page=2#members');

    expect(currentPage()).toBe('/companies/adiutor-tests/members?page=2#members');
  });
});

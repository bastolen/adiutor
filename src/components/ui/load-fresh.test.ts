/**
 * @file Tests for loading a page of the app afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loadFresh from './load-fresh';

/** Stands in for `window.location.reload`, which jsdom can't do. */
const reload = vi.fn();

/** Stands in for `window.location.assign`, to show it isn't used. */
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  assign.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('loadFresh', () => {
  it('replaces the address, keeping the history state, and reloads', () => {
    window.history.replaceState({ kept: true }, '', '/admin/users/u1');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    loadFresh('/dashboard');

    expect(replaceState).toHaveBeenCalledWith({ kept: true }, '', '/dashboard');
    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('reloads also when only the section differs from the current address', () => {
    window.history.replaceState(null, '', '/admin/users/u1');

    loadFresh('/admin/users/u1#sign-in-as');

    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });
});

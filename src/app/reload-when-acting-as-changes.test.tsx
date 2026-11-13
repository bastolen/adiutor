/**
 * @file Tests for loading the page afresh when another tab says the browser
 * acts as someone else now: nothing happens until then, then the current
 * page loads afresh once, without telling the other tabs in turn, and
 * nothing happens once it's gone.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReloadWhenActingAsChanges from './reload-when-acting-as-changes';

/** Mocked full page load, the channel's listener and its unsubscribe. */
const { loadFresh, channel } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  channel: {
    listener: undefined as (() => void) | undefined,
    unsubscribe: vi.fn(),
  },
}));

vi.mock('@/components/ui/load-fresh', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/load-fresh')>()),
  default: loadFresh,
}));

vi.mock('@/components/ui/acting-as-channel', () => ({
  /**
   * Keeps the listener, as the channel would.
   *
   * @param listener - Called for each message from another tab.
   * @returns The mocked unsubscribe.
   */
  onOtherTabChange: (listener: () => void) => {
    channel.listener = listener;
    return channel.unsubscribe;
  },
}));

/** The page the tab is on. */
const CURRENT_PAGE = '/companies/adiutor-tests/members?page=2#members';

/** Another tab says the browser acts as someone else now. */
function otherTabChanges(): void {
  channel.listener?.();
}

beforeEach(() => {
  window.history.replaceState(null, '', CURRENT_PAGE);
});

afterEach(() => {
  loadFresh.mockClear();
  channel.unsubscribe.mockClear();
  channel.listener = undefined;
  window.history.replaceState(null, '', '/');
});

describe('ReloadWhenActingAsChanges', () => {
  it('does nothing until another tab says so', () => {
    render(<ReloadWhenActingAsChanges />);

    expect(channel.listener).toBeDefined();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('loads the current page afresh, without telling the other tabs in turn', () => {
    render(<ReloadWhenActingAsChanges />);

    otherTabChanges();

    // No `everyTab`: the tab that made the change has told every tab already.
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith(CURRENT_PAGE);
  });

  it('loads only once', () => {
    render(<ReloadWhenActingAsChanges />);

    otherTabChanges();
    otherTabChanges();

    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('stops listening once it is gone', () => {
    const { unmount } = render(<ReloadWhenActingAsChanges />);

    unmount();

    expect(channel.unsubscribe).toHaveBeenCalledOnce();
  });
});

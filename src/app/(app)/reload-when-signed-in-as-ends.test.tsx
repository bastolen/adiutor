/**
 * @file Tests for loading the page afresh once a sign-in as a user has ended
 * by itself: the current page loads, with a toast, once its time and the
 * margin are up, only while the tab is visible (a hidden tab loads as it
 * comes back, also when the browser held its timer up), and only once.
 */
import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReloadWhenSignedInAsEnds, { END_MARGIN_MS } from './reload-when-signed-in-as-ends';

/** Mocked full page load and toast for the next page. */
const { loadFresh, showToastAfterLoad } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  showToastAfterLoad: vi.fn(),
}));

vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));

vi.mock('@/components/ui/toast', () => ({ showToastAfterLoad }));

/** The toast for the page after the load. */
const ENDED = 'Signing in as the user has ended.';

/** The page the tab is on. */
const CURRENT_PAGE = '/companies/adiutor-tests/members?page=2#members';

/** Whether the tab is visible, as `document.visibilityState` reports it. */
let visibility: DocumentVisibilityState = 'visible';

/**
 * Hides or shows the tab, as the browser does when the user switches tabs.
 *
 * @param state - The new state.
 */
function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * Lets time pass, running the timers due meanwhile.
 *
 * @param ms - How long, in milliseconds.
 */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  window.history.replaceState(null, '', CURRENT_PAGE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  loadFresh.mockClear();
  showToastAfterLoad.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('ReloadWhenSignedInAsEnds', () => {
  it('loads the current page afresh, with a toast, once the time and the margin are up', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={60_000} endedMessage={ENDED} />);

    wait(60_000 + END_MARGIN_MS - 1);
    expect(loadFresh).not.toHaveBeenCalled();

    wait(1);
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith(CURRENT_PAGE);
    // The toast is left before the page goes.
    expect(showToastAfterLoad).toHaveBeenCalledExactlyOnceWith(ENDED);
    expect(showToastAfterLoad.mock.invocationCallOrder[0]).toBeLessThan(
      loadFresh.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('waits only for the margin when the time is up already', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={-500} endedMessage={ENDED} />);

    wait(END_MARGIN_MS - 1);
    expect(loadFresh).not.toHaveBeenCalled();
    wait(1);
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('waits while the tab is hidden, and loads as it comes back into view', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={60_000} endedMessage={ENDED} />);
    setVisibility('hidden');

    wait(60_000 + END_MARGIN_MS);
    expect(loadFresh).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith(CURRENT_PAGE);
  });

  it('loads as the tab comes back into view when the browser held its timer up', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={60_000} endedMessage={ENDED} />);
    setVisibility('hidden');

    // The clock moves on, but the timer hasn't run (browsers slow them down in hidden tabs).
    vi.setSystemTime(Date.now() + 60_000 + END_MARGIN_MS);
    setVisibility('visible');
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('does not load when the tab comes back into view before the time is up', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={60_000} endedMessage={ENDED} />);
    setVisibility('hidden');
    wait(30_000);
    setVisibility('visible');
    expect(loadFresh).not.toHaveBeenCalled();

    // The deadline stays where it was.
    wait(30_000 + END_MARGIN_MS);
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('loads only once', () => {
    render(<ReloadWhenSignedInAsEnds endsInMs={1000} endedMessage={ENDED} />);
    wait(1000 + END_MARGIN_MS);

    setVisibility('hidden');
    setVisibility('visible');
    wait(60_000);
    expect(loadFresh).toHaveBeenCalledOnce();
    expect(showToastAfterLoad).toHaveBeenCalledOnce();
  });

  it('does nothing once it is gone', () => {
    const { unmount } = render(<ReloadWhenSignedInAsEnds endsInMs={1000} endedMessage={ENDED} />);
    unmount();

    wait(1000 + END_MARGIN_MS);
    setVisibility('visible');
    expect(loadFresh).not.toHaveBeenCalled();
  });
});

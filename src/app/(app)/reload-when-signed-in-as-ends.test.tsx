/**
 * @file Tests for loading the page afresh once a sign-in as a user has ended
 * by itself. Its time: the current page loads, with a toast, once its time
 * and the margin are up, only while the tab is visible (a hidden tab loads as
 * it comes back, also when the browser held its timer up), and only once.
 * The rules: after a navigation within the app, or as the tab comes back
 * into view, it asks the server, and loads when the sign-in is over or
 * another took its place; never at first, one question at a time, and a
 * failed one changes nothing.
 */
import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReloadWhenSignedInAsEnds, { END_MARGIN_MS } from './reload-when-signed-in-as-ends';

/** Mocked full page load, toast for the next page, server action and current path. */
const { loadFresh, showToastAfterLoad, signedInAsEndsAtAction, navigation } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  showToastAfterLoad: vi.fn(),
  signedInAsEndsAtAction: vi.fn<() => Promise<string | null>>(),
  navigation: { pathname: '/' },
}));

vi.mock('@/components/ui/load-fresh', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/load-fresh')>()),
  default: loadFresh,
}));

vi.mock('@/components/ui/toast', () => ({ showToastAfterLoad }));

vi.mock('./impersonation-actions', () => ({ signedInAsEndsAtAction }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked current path.
   *
   * @returns The path the test navigated to.
   */
  usePathname: () => navigation.pathname,
}));

/** When the sign-in ends, as the server says. */
const ENDS_AT = '2026-11-13T10:30:00.000Z';

/** The toast for the page after the load. */
const ENDED = 'Signing in as the user has ended.';

/** The page the tab is on at first. */
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

/** Lets the server action's answer arrive. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Renders it as the banner does, for a sign-in that ends in `endsInMs`.
 *
 * @param endsInMs - How long until it ends, in milliseconds.
 * @returns `navigate`, which goes to another page within the app, and `unmount`.
 */
function renderIt(endsInMs = 60_000) {
  /**
   * The element, as the banner renders it.
   *
   * @returns The element.
   */
  const element = () => (
    <ReloadWhenSignedInAsEnds endsAt={ENDS_AT} endsInMs={endsInMs} endedMessage={ENDED} />
  );
  const { rerender, unmount } = render(element());
  return {
    unmount,
    /**
     * Goes to another page within the app, which renders the layout again
     * without fetching it.
     *
     * @param path - The page, e.g. `/account`.
     */
    navigate: async (path: string) => {
      navigation.pathname = path;
      window.history.pushState(null, '', path);
      rerender(element());
      await settle();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  window.history.replaceState(null, '', CURRENT_PAGE);
  navigation.pathname = '/companies/adiutor-tests/members';
  signedInAsEndsAtAction.mockReset().mockResolvedValue(ENDS_AT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  loadFresh.mockClear();
  showToastAfterLoad.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('ReloadWhenSignedInAsEnds, when its time is up', () => {
  it('loads the current page afresh, with a toast, once the time and the margin are up', () => {
    renderIt(60_000);

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
    renderIt(-500);

    wait(END_MARGIN_MS - 1);
    expect(loadFresh).not.toHaveBeenCalled();
    wait(1);
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('waits while the tab is hidden, and loads as it comes back into view', () => {
    renderIt(60_000);
    setVisibility('hidden');

    wait(60_000 + END_MARGIN_MS);
    expect(loadFresh).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith(CURRENT_PAGE);
  });

  it('loads as the tab comes back into view when the browser held its timer up', () => {
    renderIt(60_000);
    setVisibility('hidden');

    // The clock moves on, but the timer hasn't run (browsers slow them down in hidden tabs).
    vi.setSystemTime(Date.now() + 60_000 + END_MARGIN_MS);
    setVisibility('visible');
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('keeps its time when the tab comes back into view before then', async () => {
    renderIt(60_000);
    setVisibility('hidden');
    wait(30_000);
    setVisibility('visible');
    await settle();
    expect(loadFresh).not.toHaveBeenCalled();

    wait(30_000 + END_MARGIN_MS);
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('loads only once', () => {
    renderIt(1000);
    wait(1000 + END_MARGIN_MS);

    setVisibility('hidden');
    setVisibility('visible');
    wait(60_000);
    expect(loadFresh).toHaveBeenCalledOnce();
    expect(showToastAfterLoad).toHaveBeenCalledOnce();
  });

  it('does nothing once it is gone', () => {
    const { unmount } = renderIt(1000);
    unmount();

    wait(1000 + END_MARGIN_MS);
    setVisibility('visible');
    expect(loadFresh).not.toHaveBeenCalled();
  });
});

describe('ReloadWhenSignedInAsEnds, when the rules end it', () => {
  it('does not ask the server for the page it was rendered with', async () => {
    renderIt();
    await settle();

    expect(signedInAsEndsAtAction).not.toHaveBeenCalled();
  });

  it('asks after a navigation, and stays while it is the same sign-in', async () => {
    const { navigate } = renderIt();

    await navigate('/account');
    expect(signedInAsEndsAtAction).toHaveBeenCalledOnce();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('loads the page it went to afresh, with a toast, when the sign-in is over', async () => {
    signedInAsEndsAtAction.mockResolvedValue(null);
    const { navigate } = renderIt();

    await navigate('/account');
    expect(showToastAfterLoad).toHaveBeenCalledExactlyOnceWith(ENDED);
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith('/account');

    // Its time doesn't load it a second time.
    wait(60_000 + END_MARGIN_MS);
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('loads afresh when another sign-in took its place', async () => {
    signedInAsEndsAtAction.mockResolvedValue('2026-11-13T10:45:00.000Z');
    const { navigate } = renderIt();

    await navigate('/dashboard');
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith('/dashboard');
  });

  it('asks as the tab comes back into view before its time is up', async () => {
    signedInAsEndsAtAction.mockResolvedValue(null);
    renderIt();
    setVisibility('hidden');
    expect(signedInAsEndsAtAction).not.toHaveBeenCalled();

    setVisibility('visible');
    await settle();
    expect(signedInAsEndsAtAction).toHaveBeenCalledOnce();
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith(CURRENT_PAGE);
  });

  it('changes nothing when the question fails, and asks again at the next navigation', async () => {
    signedInAsEndsAtAction.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { navigate } = renderIt();

    await navigate('/account');
    expect(loadFresh).not.toHaveBeenCalled();

    signedInAsEndsAtAction.mockResolvedValue(null);
    await navigate('/account/security');
    expect(signedInAsEndsAtAction).toHaveBeenCalledTimes(2);
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith('/account/security');
  });

  it('asks one question at a time', async () => {
    const { promise, resolve: answer } = Promise.withResolvers<string | null>();
    signedInAsEndsAtAction.mockReturnValue(promise);
    const { navigate } = renderIt();

    await navigate('/account');
    await navigate('/dashboard');
    expect(signedInAsEndsAtAction).toHaveBeenCalledOnce();

    answer(null);
    await settle();
    expect(loadFresh).toHaveBeenCalledExactlyOnceWith('/dashboard');
  });
});

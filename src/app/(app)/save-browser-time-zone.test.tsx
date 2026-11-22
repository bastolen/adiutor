/**
 * @file Tests for the first visit's save of the browser's time zone: the page
 * loads afresh only when the account's zone differs from the one it shows,
 * and a page that has started to load afresh, also in an effect of the same
 * commit, leaves the save to the page that replaces it.
 * How the page loads afresh is `loadFresh`'s own concern
 * (`load-fresh.test.ts`), and which zone is saved the service's
 * (`own-time-zone.int.test.ts`), so both are mocked here.
 */
import { render, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBrowserTimeZoneAction } from './account/actions';
import SaveBrowserTimeZone from './save-browser-time-zone';

/** The full page load, whether one has started, and the browser's zone, mocked. */
const { loadFresh, freshLoadStarted, browserTimeZone } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  freshLoadStarted: vi.fn<() => boolean>(() => false),
  browserTimeZone: vi.fn<() => string | null>(),
}));

vi.mock('./account/actions', () => ({ saveBrowserTimeZoneAction: vi.fn() }));
vi.mock('@/components/ui/load-fresh', () => ({
  default: loadFresh,
  /**
   * The page the test is on.
   *
   * @returns Its address.
   */
  currentPage: () => '/dashboard',
  freshLoadStarted,
}));
vi.mock('@/lib/i18n/time-zones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/i18n/time-zones')>()),
  browserTimeZone,
}));

afterEach(() => {
  loadFresh.mockClear();
  freshLoadStarted.mockReturnValue(false);
  browserTimeZone.mockReset();
  vi.mocked(saveBrowserTimeZoneAction).mockReset();
});

/**
 * Waits until the timers started so far have run, the save's wait for the
 * commit's effects among them.
 *
 * @returns A promise that settles once they have.
 */
const afterEffects = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * A layout that starts a fresh load in its own effect, as the root layout's
 * `ReloadWhenActingAsChanges` does on the first page after signing up: a
 * parent's effects run after its children's, in the same commit.
 *
 * @param props - Component props.
 * @param props.children - The page within it.
 * @returns The page.
 */
function LoadingAfresh({ children }: { children: ReactNode }) {
  useEffect(() => {
    freshLoadStarted.mockReturnValue(true);
  }, []);
  return children;
}

describe('SaveBrowserTimeZone', () => {
  it("saves the browser's zone and loads the page afresh in it", async () => {
    browserTimeZone.mockReturnValue('Europe/Amsterdam');
    vi.mocked(saveBrowserTimeZoneAction).mockResolvedValue({ ok: true, data: 'Europe/Amsterdam' });

    render(<SaveBrowserTimeZone />);

    await waitFor(() => {
      expect(loadFresh).toHaveBeenCalledWith('/dashboard');
    });
    expect(saveBrowserTimeZoneAction).toHaveBeenCalledWith('Europe/Amsterdam');
  });

  it('leaves the page as it is when the account’s zone is the one it shows', async () => {
    // The tests show UTC.
    browserTimeZone.mockReturnValue('UTC');
    vi.mocked(saveBrowserTimeZoneAction).mockResolvedValue({ ok: true, data: 'UTC' });

    render(<SaveBrowserTimeZone />);

    await waitFor(() => {
      expect(saveBrowserTimeZoneAction).toHaveBeenCalledWith('UTC');
    });
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('leaves the save to the page that replaces it once a fresh load has started', async () => {
    browserTimeZone.mockReturnValue('Europe/Amsterdam');
    freshLoadStarted.mockReturnValue(true);

    render(<SaveBrowserTimeZone />);
    await afterEffects();

    expect(saveBrowserTimeZoneAction).not.toHaveBeenCalled();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('waits for the effects of its commit, so a fresh load one of them starts counts', async () => {
    browserTimeZone.mockReturnValue('Europe/Amsterdam');
    vi.mocked(saveBrowserTimeZoneAction).mockResolvedValue({ ok: true, data: 'Europe/Amsterdam' });

    render(
      <LoadingAfresh>
        <SaveBrowserTimeZone />
      </LoadingAfresh>,
    );
    await afterEffects();

    expect(saveBrowserTimeZoneAction).not.toHaveBeenCalled();
  });

  it('saves nothing when the page goes before its effects have run', async () => {
    browserTimeZone.mockReturnValue('Europe/Amsterdam');

    render(<SaveBrowserTimeZone />).unmount();
    await afterEffects();

    expect(saveBrowserTimeZoneAction).not.toHaveBeenCalled();
  });

  it('changes nothing when the save fails, or the browser has no zone Adiutor accepts', async () => {
    browserTimeZone.mockReturnValue('Europe/Amsterdam');
    vi.mocked(saveBrowserTimeZoneAction).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<SaveBrowserTimeZone />);
    await waitFor(() => {
      expect(saveBrowserTimeZoneAction).toHaveBeenCalledOnce();
    });
    unmount();

    browserTimeZone.mockReturnValue(null);
    render(<SaveBrowserTimeZone />);

    expect(saveBrowserTimeZoneAction).toHaveBeenCalledOnce();
    expect(loadFresh).not.toHaveBeenCalled();
  });
});

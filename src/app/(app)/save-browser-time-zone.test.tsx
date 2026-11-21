/**
 * @file Tests for the first visit's save of the browser's time zone: the page
 * loads afresh only when the account's zone differs from the one it shows.
 * How the page loads afresh is `loadFresh`'s own concern
 * (`load-fresh.test.ts`), and which zone is saved the service's
 * (`own-time-zone.int.test.ts`), so both are mocked here.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBrowserTimeZoneAction } from './account/actions';
import SaveBrowserTimeZone from './save-browser-time-zone';

/** The full page load and the browser's zone, mocked. */
const { loadFresh, browserTimeZone } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
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
}));
vi.mock('@/lib/i18n/time-zones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/i18n/time-zones')>()),
  browserTimeZone,
}));

afterEach(() => {
  loadFresh.mockClear();
  browserTimeZone.mockReset();
  vi.mocked(saveBrowserTimeZoneAction).mockReset();
});

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

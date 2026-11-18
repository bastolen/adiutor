/**
 * @file Tests for `usePageRestored`: it resets only for a page restored from
 * the browser's cache, listens once however often the component renders, and
 * stops listening when the component unmounts.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePageRestored } from './use-page-restored';

/**
 * A component that only uses the hook.
 *
 * @param props - Component props.
 * @param props.reset - What to call when the page is restored.
 * @returns Nothing.
 */
function Probe({ reset }: { reset: () => void }) {
  usePageRestored(reset);
  return null;
}

/**
 * Dispatches a `pageshow` event on the window.
 *
 * @param persisted - Whether the page came from the back/forward cache.
 */
function showPage(persisted: boolean) {
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));
}

describe('usePageRestored', () => {
  it('resets when the page is restored from the cache, not on a normal load', () => {
    const reset = vi.fn();
    render(<Probe reset={reset} />);

    showPage(false);
    expect(reset).not.toHaveBeenCalled();

    showPage(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('listens once, and runs the reset of the latest render', () => {
    const listen = vi.spyOn(window, 'addEventListener');
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Probe reset={first} />);
    rerender(<Probe reset={latest} />);

    showPage(true);

    expect(listen.mock.calls.filter(([type]) => type === 'pageshow')).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    listen.mockRestore();
  });

  it('stops listening once the component is gone', () => {
    const reset = vi.fn();
    const { unmount } = render(<Probe reset={reset} />);
    unmount();

    showPage(true);

    expect(reset).not.toHaveBeenCalled();
  });
});

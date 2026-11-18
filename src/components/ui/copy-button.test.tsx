/**
 * @file Tests for the copy button: it copies its value and says so, says
 * when the browser refuses (inline, and as a toast where there are toasts),
 * and takes its message away again.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CopyButton from './copy-button';
import { Toaster } from './toast';

/**
 * Makes the browser refuse to copy, as without clipboard permission.
 */
function refuseClipboard(): void {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new DOMException('Write permission denied.', 'NotAllowedError'),
  );
}

describe('CopyButton', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies its value and says so in its live region', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="https://adiutor.test/join/abc" label="Copy link" />);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await navigator.clipboard.readText()).toBe('https://adiutor.test/join/abc');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Copied')).toHaveAttribute('aria-live', 'polite');
  });

  it('says so when the browser refuses to copy, without an unhandled rejection', async () => {
    const user = userEvent.setup();
    refuseClipboard();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    render(<CopyButton value="https://adiutor.test/join/abc" label="Copy link" />);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toHaveFocus();
    expect(screen.getByText("Couldn't copy")).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('says so where the browser has no clipboard at all', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(
      undefined as unknown as Navigator['clipboard'],
    );
    render(<CopyButton value="7KQ2-M9XD" label="Copy reference" />);

    await user.click(screen.getByRole('button', { name: 'Copy reference' }));

    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toBeInTheDocument();
  });

  it('also shows a refusal as an error toast where the page has toasts', async () => {
    const user = userEvent.setup();
    refuseClipboard();
    render(
      <>
        <CopyButton value="1234-5678" label="Copy codes" />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));

    const region = screen.getByRole('region', { name: /^Notifications/ });
    await waitFor(() => expect(region).toHaveTextContent("Couldn't copy"));
    expect(region.querySelector('[data-tone="error"]')).toHaveTextContent("Couldn't copy");
    // The button says it too, and that's what screen readers hear.
    expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeInTheDocument();
  });

  it('shows no toast for a copy that worked', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CopyButton value="1234-5678" label="Copy codes" />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /^Notifications/ }).querySelector('[data-tone]'),
    ).toBeNull();
  });

  it('goes back to its label after a moment, later for a refusal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyButton value="1234-5678" label="Copy codes" />);

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy codes' })).toBeInTheDocument();

    refuseClipboard();
    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('button', { name: 'Copy codes' })).toBeInTheDocument();
  });

  it('stops its timer when it goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<CopyButton value="1234-5678" label="Copy codes" />);

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const pending = vi.getTimerCount();
    unmount();

    expect(vi.getTimerCount()).toBe(pending - 1);
  });

  it('has forgotten its message when its page is shown again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Activity mode="visible">
        <CopyButton value="1234-5678" label="Copy codes" />
      </Activity>,
    );

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    rerender(
      <Activity mode="hidden">
        <CopyButton value="1234-5678" label="Copy codes" />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <CopyButton value="1234-5678" label="Copy codes" />
      </Activity>,
    );

    expect(screen.getByRole('button', { name: 'Copy codes' })).toBeInTheDocument();
  });
});

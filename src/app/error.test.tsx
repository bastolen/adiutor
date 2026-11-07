/**
 * @file Tests for the error page outside the signed-in app: what it says,
 * the ways out (with "Go back"), focus on the heading, and the reference:
 * worked out from the digest for errors from the server, reported for
 * errors in the browser, and left out when that report fails.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { referenceFromDigest } from '@/lib/error-reference';

import RootError from './error';
import reportErrorAction from './report-error-action';

/** Mocked router. */
const { back } = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `back` is recorded.
   */
  useRouter: () => ({ back }),
}));

vi.mock('./report-error-action', () => ({ default: vi.fn(async () => null) }));

beforeEach(() => {
  // The layout's theme button follows the system setting.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.mocked(reportErrorAction).mockReset();
  back.mockReset();
  vi.unstubAllGlobals();
});

describe('RootError', () => {
  it("says the page couldn't load, with its heading focused", () => {
    render(<RootError error={new Error('x')} retry={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toHaveFocus();
    expect(
      screen.getByText("This page couldn't load. Try again, or go to your dashboard."),
    ).toBeInTheDocument();
  });

  it('tries again, goes to the dashboard, or goes back', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigation', { canGoBack: true });
    const retry = vi.fn();
    render(<RootError error={new Error('x')} retry={retry} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(screen.getByRole('button', { name: 'Go back' }));

    expect(retry).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to your dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('shows the reference of an error from the server without reporting it', async () => {
    const error = Object.assign(new Error('Server Components render'), { digest: '3496291841' });
    render(<RootError error={error} retry={vi.fn()} />);

    expect(await screen.findByText(referenceFromDigest('3496291841'))).toBeInTheDocument();
    expect(reportErrorAction).not.toHaveBeenCalled();
  });

  it('reports an error from the browser and shows the reference it gets back', async () => {
    vi.mocked(reportErrorAction).mockResolvedValue({
      reference: '7KQ2-M9XD',
      at: new Date('2026-10-28T18:40:00Z'),
    });
    render(<RootError error={new RangeError('Invalid time value')} retry={vi.fn()} />);

    expect(await screen.findByText('7KQ2-M9XD')).toBeInTheDocument();
    expect(screen.getByText('28 Oct 2026, 18:40 UTC')).toBeInTheDocument();
    expect(reportErrorAction).toHaveBeenCalledWith({
      name: 'RangeError',
      message: 'Invalid time value',
      path: '/',
    });
  });

  it('shows no reference when the report fails', async () => {
    vi.mocked(reportErrorAction).mockRejectedValue(new Error('offline'));
    render(<RootError error={new Error('x')} retry={vi.fn()} />);

    await vi.waitFor(() => expect(reportErrorAction).toHaveBeenCalledOnce());

    expect(screen.queryByText(/send this reference/)).not.toBeInTheDocument();
  });
});

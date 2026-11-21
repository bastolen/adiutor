/**
 * @file Tests for the error page inside the signed-in app: what it says, the
 * ways out, focus on the heading, and the reference: worked out from the
 * digest for errors from the server, reported for errors in the browser,
 * and left out when that report fails.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { referenceFromDigest } from '@/lib/error-reference';

import reportErrorAction from '../report-error-action';
import AppError from './error';

vi.mock('../report-error-action', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(reportErrorAction).mockReset();
  window.history.replaceState(null, '', '/');
});

/** When the test's browser error was recorded. */
const AT = new Date('2026-10-28T18:40:00Z');

/**
 * An error as it comes from the server: with a digest.
 *
 * @param digest - The digest.
 * @returns The error.
 */
function serverError(digest: string) {
  return Object.assign(new Error('An error occurred in the Server Components render.'), { digest });
}

describe('AppError', () => {
  it("says the page couldn't load, with its heading focused", () => {
    render(<AppError error={serverError('2828711936')} retry={vi.fn()} />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(
      screen.getByText("This page couldn't load. Try again, or go to your dashboard."),
    ).toBeInTheDocument();
  });

  it('tries again, or goes to the dashboard', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<AppError error={serverError('2828711936')} retry={retry} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to your dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('shows the reference of an error from the server without reporting it', async () => {
    render(<AppError error={serverError('2828711936')} retry={vi.fn()} />);

    expect(await screen.findByText(referenceFromDigest('2828711936'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument();
    expect(reportErrorAction).not.toHaveBeenCalled();
  });

  it('reports an error from the browser once, and shows the reference it gets back', async () => {
    vi.mocked(reportErrorAction).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT });
    window.history.replaceState(null, '', '/companies?q=adiutor');
    const error = new TypeError('Cannot read properties of undefined');

    const { rerender } = render(<AppError error={error} retry={vi.fn()} />);
    expect(await screen.findByText('7KQ2-M9XD')).toBeInTheDocument();
    rerender(<AppError error={error} retry={vi.fn()} />);

    expect(screen.getByText('Oct 28, 2026, 6:40 PM')).toBeInTheDocument();
    expect(reportErrorAction).toHaveBeenCalledOnce();
    expect(reportErrorAction).toHaveBeenCalledWith({
      name: 'TypeError',
      message: 'Cannot read properties of undefined',
      path: '/companies',
    });
  });

  it('shows no reference when the report fails or is turned down', async () => {
    vi.mocked(reportErrorAction).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(reportErrorAction).mockResolvedValueOnce(null);

    render(<AppError error={new Error('first')} retry={vi.fn()} />);
    render(<AppError error="thrown text" retry={vi.fn()} />);
    await vi.waitFor(() => expect(reportErrorAction).toHaveBeenCalledTimes(2));
    // Let both reports settle.
    await act(async () => {});

    expect(reportErrorAction).toHaveBeenLastCalledWith({
      name: null,
      message: 'thrown text',
      path: '/',
    });
    expect(screen.queryByText(/send this reference/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2);
  });
});

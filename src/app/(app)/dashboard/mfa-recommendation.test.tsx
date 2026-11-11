/**
 * @file Tests for the dashboard's MFA recommendation: it links to the Security
 * page, Dismiss hides it at once and saves that with the account, and a
 * dismissal that can't be saved brings it back with the reason.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/toast';

import dismissMfaRecommendationAction from './actions';
import MfaRecommendation from './mfa-recommendation';

vi.mock('./actions', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(dismissMfaRecommendationAction).mockReset();
});

/**
 * Renders the banner with the toasts it may raise.
 */
function renderBanner() {
  render(
    <>
      <MfaRecommendation />
      <Toaster />
    </>,
  );
}

describe('MfaRecommendation', () => {
  it('recommends MFA with a link to the Security page', () => {
    renderBanner();

    expect(screen.getByRole('region', { name: 'Account security' })).toHaveTextContent(
      'Protect your account',
    );
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/account/security',
    );
  });

  it('hides at once on Dismiss and saves the dismissal with the account', async () => {
    vi.mocked(dismissMfaRecommendationAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('region', { name: 'Account security' })).not.toBeInTheDocument();
    expect(dismissMfaRecommendationAction).toHaveBeenCalledOnce();
  });

  it('comes back with the reason when the dismissal is refused', async () => {
    vi.mocked(dismissMfaRecommendationAction).mockResolvedValue({
      ok: false,
      message: 'Too many attempts.',
    });
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('region', { name: 'Account security' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Too many attempts.').length).toBeGreaterThan(0);
    });
  });

  it('comes back with a message when the dismissal can’t be saved at all', async () => {
    vi.mocked(dismissMfaRecommendationAction).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('region', { name: 'Account security' })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getAllByText("The recommendation couldn't be hidden. Try again in a moment.").length,
      ).toBeGreaterThan(0);
    });
  });
});

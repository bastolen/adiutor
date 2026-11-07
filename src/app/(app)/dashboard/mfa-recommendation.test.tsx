/**
 * @file Tests for the dashboard's MFA recommendation: it links to the Security
 * page, and a dismissal is remembered per user, so someone else signing in on
 * the browser still sees it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MfaRecommendation, { mfaRecommendationKey } from './mfa-recommendation';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('MfaRecommendation', () => {
  it('recommends MFA with a link to the Security page', () => {
    render(<MfaRecommendation userId="jane-id" />);

    expect(screen.getByRole('region', { name: 'Account security' })).toHaveTextContent(
      'Protect your account',
    );
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/account/security',
    );
  });

  it('stays dismissed for the user who dismissed it, and only for them', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MfaRecommendation userId="jane-id" />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Account security' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(mfaRecommendationKey('jane-id'))).toBe('1');
    unmount();

    render(<MfaRecommendation userId="jane-id" />);
    expect(screen.queryByRole('region', { name: 'Account security' })).not.toBeInTheDocument();
  });

  it('still shows for someone else signing in on the browser', () => {
    window.localStorage.setItem(mfaRecommendationKey('jane-id'), '1');

    render(<MfaRecommendation userId="john-id" />);

    expect(screen.getByRole('region', { name: 'Account security' })).toBeInTheDocument();
  });

  it('shows when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<MfaRecommendation userId="jane-id" />);

    expect(screen.getByRole('region', { name: 'Account security' })).toBeInTheDocument();
  });
});

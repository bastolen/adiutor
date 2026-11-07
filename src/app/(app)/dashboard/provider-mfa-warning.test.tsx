/**
 * @file Tests for the dashboard banner about users who lost their provider
 * MFA: it says how many, which provider, and links to the users without MFA.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ProviderMfaWarning from './provider-mfa-warning';

describe('ProviderMfaWarning', () => {
  it('names the provider, how many users, and links to them', () => {
    render(<ProviderMfaWarning warning={{ count: 3, providers: ['github'] }} />);

    expect(screen.getByRole('region', { name: 'Users without MFA' })).toBeInTheDocument();
    expect(screen.getByText("GitHub sign-in isn't configured on this server")).toBeInTheDocument();
    expect(
      screen.getByText(/^3 users whose role requires MFA have no MFA now/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See users without MFA' })).toHaveAttribute(
      'href',
      '/admin/users?filter=without_mfa',
    );
  });

  it('speaks of one user', () => {
    render(<ProviderMfaWarning warning={{ count: 1, providers: ['github'] }} />);

    expect(screen.getByText(/^1 user whose role requires MFA has no MFA now/)).toBeInTheDocument();
  });
});

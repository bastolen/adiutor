/**
 * @file Tests for the explanation shown on invite and join pages instead of
 * the Accept or Join button when the user's role requires MFA they haven't
 * set up yet.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SetUpMfaFirst from './set-up-mfa-first';

describe('SetUpMfaFirst', () => {
  it('says MFA comes first and that the link still works afterwards', () => {
    render(<SetUpMfaFirst />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your role requires MFA before you can continue. Add a passkey or set up an authenticator app, then open this link again: it still works.',
    );
  });

  it('links to the Security page to set it up', () => {
    render(<SetUpMfaFirst />);

    expect(screen.getByRole('link', { name: 'Set up MFA' })).toHaveAttribute(
      'href',
      '/account/security',
    );
    // It replaces the Accept or Join button rather than sitting next to one.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

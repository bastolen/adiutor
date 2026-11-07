/**
 * @file Tests for the explanation shown on invite and join pages instead of
 * the Join or Accept button when a Finance or Support staff member opens an
 * invite link, or an invitation that came from one.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INVITE_LINKS_NOT_ALLOWED } from '@/lib/authz/permissions';

import InviteLinksNotAllowed from './invite-links-not-allowed';

describe('InviteLinksNotAllowed', () => {
  it('says Finance and Support can’t use invite links, and what to do instead', () => {
    render(<InviteLinksNotAllowed />);

    expect(screen.getByRole('status')).toHaveTextContent(INVITE_LINKS_NOT_ALLOWED);
  });

  it('offers a way back to the dashboard instead of joining', () => {
    render(<InviteLinksNotAllowed />);

    expect(screen.getByRole('link', { name: 'Go to your dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByRole('button', { name: /join|accept/i })).not.toBeInTheDocument();
  });
});

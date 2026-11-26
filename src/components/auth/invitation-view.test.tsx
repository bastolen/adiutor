/**
 * @file Tests for what the invitation and invite link pages show: the form,
 * or the explanation for Finance and Support, or the one for a role that must
 * set up MFA first.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PlatformRole } from '@/lib/authz/roles';

import InvitationView from './invitation-view';

/** What the link offers. */
const PREVIEW = { companyName: 'Adiutor Tests', target: 'company', role: 'client' } as const;

/**
 * A signed-in user for the view.
 *
 * @param platformRole - The staff role, or `null` for a company user.
 * @param mfaMissing - Whether the user's role requires MFA they haven't set up.
 * @returns The actor.
 */
function actorWith(platformRole: PlatformRole | null, mfaMissing = false) {
  return {
    platformRole,
    mfaRequired: mfaMissing,
    mfaEnabled: false,
    canConfirmSessions: false,
  };
}

/** The form the page passes. */
const FORM = <button type="button">Accept the invitation</button>;

describe('InvitationView', () => {
  it('shows the heading and the form to a visitor and to a user who may use it', () => {
    const { rerender } = render(
      <InvitationView preview={PREVIEW} staffName="Adiutor" actor={null} linkBased>
        {FORM}
      </InvitationView>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Join Adiutor Tests' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept the invitation' })).toBeVisible();

    rerender(
      <InvitationView preview={PREVIEW} staffName="Adiutor" actor={actorWith('manager')} linkBased>
        {FORM}
      </InvitationView>,
    );
    expect(screen.getByRole('button', { name: 'Accept the invitation' })).toBeVisible();
  });

  it('explains to Finance and Support why an invite link is no use, instead of the form', () => {
    render(
      <InvitationView preview={PREVIEW} staffName="Adiutor" actor={actorWith('finance')} linkBased>
        {FORM}
      </InvitationView>,
    );

    expect(screen.getByRole('status')).toHaveTextContent("Finance and Support can't use");
    expect(screen.queryByRole('button', { name: 'Accept the invitation' })).not.toBeInTheDocument();
  });

  it('lets Finance and Support accept an invitation that did not come from a link', () => {
    render(
      <InvitationView
        preview={PREVIEW}
        staffName="Adiutor"
        actor={actorWith('support')}
        linkBased={false}
      >
        {FORM}
      </InvitationView>,
    );

    expect(screen.getByRole('button', { name: 'Accept the invitation' })).toBeVisible();
  });

  it('sends a role that requires MFA to set it up first, instead of the form', () => {
    render(
      <InvitationView
        preview={PREVIEW}
        staffName="Adiutor"
        actor={actorWith('manager', true)}
        linkBased={false}
      >
        {FORM}
      </InvitationView>,
    );

    expect(screen.getByRole('link', { name: 'Set up MFA' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept the invitation' })).not.toBeInTheDocument();
  });
});

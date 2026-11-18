/**
 * @file Tests for the "Open invitations" card: a row per invitation, the
 * note on invitations that came from an invite link, and the empty state.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import translator from '@/lib/i18n/translator';
import { createPageUrl } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
import { INVITATIONS_TABLE } from '@/lib/tables/tables';
import type { PendingInvitation } from '@/server/people/invitations';

import renderInLocale from '../../../../tests/i18n/render';
import InvitationsCard from './invitations-card';

/** Mocked server actions. */
const { resendInvitationAction, revokeInvitationAction } = vi.hoisted(() => ({
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

vi.mock('./invitation-actions', () => ({ resendInvitationAction, revokeInvitationAction }));

/**
 * Builds an open invitation.
 *
 * @param overrides - Fields to change.
 * @returns The invitation.
 */
function pending(overrides: Partial<PendingInvitation>): PendingInvitation {
  return {
    id: 'invitation-1',
    email: 'invited@adiutor.test',
    role: 'client',
    expiresAt: new Date('2026-01-09T10:00:00Z'),
    expired: false,
    createdAt: new Date('2026-01-02T10:00:00Z'),
    fromInviteLink: false,
    ...overrides,
  };
}

/** The table's links in its default state. */
const TABLE = createPageUrl(
  '/companies/company-1/members',
  {},
  translator('en-US', 'tables'),
).table(INVITATIONS_TABLE, {
  sort: 'sent',
  dir: 'desc',
  page: 1,
  size: 25,
});

describe('InvitationsCard', () => {
  it('says which invitations came from an invite link', () => {
    render(
      <InvitationsCard
        invitations={{
          items: [
            pending({ id: 'invitation-1', email: 'invited@adiutor.test' }),
            pending({ id: 'invitation-2', email: 'linked@adiutor.test', fromInviteLink: true }),
          ],
          total: 2,
          page: 1,
          size: 25,
        }}
        table={TABLE}
        canManage
        companyId="company-1"
      />,
    );

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const invited = defined(rows[0], 'the emailed invitation row');
    const linked = defined(rows[1], 'the invite link invitation row');
    expect(invited).toHaveTextContent('invited@adiutor.test');
    expect(invited).not.toHaveTextContent('From an invite link');
    expect(linked).toHaveTextContent('linked@adiutor.test');
    expect(linked).toHaveTextContent('From an invite link');
    expect(
      within(linked).getByRole('button', { name: 'Resend invitation to linked@adiutor.test' }),
    ).toBeEnabled();
  });

  it('names the role and the address in whole sentences in Dutch and Spanish', () => {
    const invitations: Paged<PendingInvitation> = {
      items: [pending({ email: 'invited@adiutor.test', role: 'watcher' })],
      total: 1,
      page: 1,
      size: 25,
    };
    const { unmount } = renderInLocale(
      'nl-NL',
      <InvitationsCard invitations={invitations} table={TABLE} canManage companyId="company-1" />,
    );
    expect(screen.getByRole('table', { name: /^Openstaande uitnodigingen/ })).toBeInTheDocument();
    expect(screen.getAllByText('Meekijker').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Uitnodiging voor invited@adiutor.test intrekken' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Verloopt op 9 jan 2026')).toBeInTheDocument();
    unmount();

    renderInLocale(
      'es-ES',
      <InvitationsCard invitations={invitations} table={TABLE} canManage companyId="company-1" />,
    );
    expect(
      screen.getByRole('button', { name: 'Reenviar la invitación a invited@adiutor.test' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Observador').length).toBeGreaterThan(0);
  });

  it('shows an empty state without invitations', () => {
    render(
      <InvitationsCard
        invitations={{ items: [], total: 0, page: 1, size: 25 }}
        table={TABLE}
        canManage={false}
        companyId={null}
      />,
    );
    expect(screen.getByText('No open invitations')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

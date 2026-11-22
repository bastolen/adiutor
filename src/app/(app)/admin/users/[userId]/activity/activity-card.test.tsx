/**
 * @file Tests for the "Recent activity" card on the Activity tab of a user's page: the
 * empty state, naming who acted only when it was someone else, and the
 * company or staff change an event was about.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '@/server/audit';

import ActivityCard from './activity-card';

/** The user whose page it is. */
const ADA = { id: 'user-1', name: 'Ada Tester', email: 'ada@adiutor.test' };

/** A staff Admin who acted on Ada's account. */
const SAM = { id: 'user-2', name: 'Sam Admin', email: 'sam@adiutor.test' };

/**
 * Builds an event.
 *
 * @param overrides - Fields to change.
 * @returns The event.
 */
function event(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'event-1',
    at: new Date('2026-10-20T09:00:00Z'),
    action: 'password_changed',
    actor: ADA,
    target: ADA,
    company: null,
    ip: null,
    userAgent: null,
    details: {},
    ...overrides,
  };
}

describe('ActivityCard', () => {
  it('says when nothing is recorded, without a list', () => {
    render(<ActivityCard userId={ADA.id} userName={ADA.name} activity={[]} />);

    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('names who acted only when it was someone else, and what the event was about', () => {
    render(
      <ActivityCard
        userId={ADA.id}
        userName={ADA.name}
        activity={[
          event({ id: 'own' }),
          event({
            id: 'membership',
            action: 'role_changed',
            actor: SAM,
            company: { id: 'company-1', name: 'Adiutor Tests' },
          }),
          event({ id: 'staff', action: 'role_changed', actor: SAM, details: { staff: true } }),
        ]}
      />,
    );

    const [own, membership, staff] = within(
      screen.getByRole('list', { name: 'Recent activity of Ada Tester' }),
    ).getAllByRole('listitem');
    expect(own).toHaveTextContent('Changed the password');
    expect(own).not.toHaveTextContent(' by ');
    expect(membership).toHaveTextContent('Changed a role by Sam Admin · Adiutor Tests');
    expect(staff).toHaveTextContent('Changed a role by Sam Admin · Staff');
  });
});

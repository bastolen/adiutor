/**
 * @file Tests for the signed-in devices table: its columns, the badges, and
 * the actions column that appears only when the page gives an action.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createPageUrl } from '@/lib/tables/table-state';
import { DEVICES_TABLE } from '@/lib/tables/tables';
import type { UserSession } from '@/server/people/user-admin';

import DevicesTable from './devices-table';

/** A desktop Chrome user agent. */
const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Builds a device.
 *
 * @param overrides - Fields to change.
 * @returns The device.
 */
function device(overrides: Partial<UserSession>): UserSession {
  return {
    id: 'session-1',
    userAgent: CHROME_ON_MAC,
    ipAddress: '203.0.113.7',
    createdAt: new Date('2026-01-02T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
    expiresAt: new Date('2026-02-02T10:00:00Z'),
    mfaVerified: false,
    ...overrides,
  };
}

/** Two devices: the viewer's own (MFA verified) and another one. */
const DEVICES = {
  items: [
    device({ id: 'session-1', mfaVerified: true }),
    device({ id: 'session-2', userAgent: null, ipAddress: null }),
  ],
  total: 2,
  page: 1,
  size: 25 as const,
};

/** The table's links in its default state. */
const TABLE = createPageUrl('/account/security').table(DEVICES_TABLE, {
  sort: 'signed-in',
  dir: 'desc',
  page: 1,
  size: 25,
});

describe('DevicesTable', () => {
  it('shows a row per device with its label, IP address and badges', () => {
    render(
      <DevicesTable
        devices={DEVICES}
        table={TABLE}
        caption="Your signed-in devices"
        currentSessionId="session-1"
      />,
    );

    const table = screen.getByRole('table', { name: /^Your signed-in devices/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Device', 'IP address', 'Signed in']);
    const [own, other] = within(table).getAllByRole('row').slice(1);
    expect(own).toHaveTextContent('Chrome on macOS');
    expect(own).toHaveTextContent('This device');
    expect(own).toHaveTextContent('MFA Verified');
    expect(own).toHaveTextContent('203.0.113.7');
    expect(other).not.toHaveTextContent('This device');
    expect(other).not.toHaveTextContent('MFA Verified');
  });

  it('marks the sorted column', () => {
    render(<DevicesTable devices={DEVICES} table={TABLE} caption="Devices of Ada" />);
    expect(screen.getByRole('columnheader', { name: 'Signed in' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('has no actions column or "This device" mark without an action or a current session', () => {
    render(<DevicesTable devices={DEVICES} table={TABLE} caption="Devices of Ada" />);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('This device')).not.toBeInTheDocument();
  });

  it('renders the action for every device but the current one', () => {
    render(
      <DevicesTable
        devices={DEVICES}
        table={TABLE}
        caption="Your signed-in devices"
        currentSessionId="session-1"
        renderAction={(row, label) => (
          <button type="button">{`Sign out ${label} ${row.id}`}</button>
        )}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Sign out Unknown browser on unknown system session-2' }),
    ).toBeInTheDocument();
  });
});

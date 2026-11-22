/**
 * @file Tests for the header of a user's page: their name, address and
 * badges, a link back to the users, and only the tabs the viewer gets, the
 * open one marked as current.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UserHeader from './user-header';

/** The mocked segment below the user's layout. */
const { useSelectedLayoutSegment } = vi.hoisted(() => ({
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment }));

/** The user on the page. */
const USER = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  name: 'Jane Doe',
  email: 'jane@adiutor.test',
  picture: null,
  staffRole: 'manager',
  deactivatedAt: new Date('2026-11-01T10:00:00Z'),
  emailVerified: true,
} as const;

/** Where the user's page is. */
const BASE = `/admin/users/${USER.id}`;

/**
 * The tabs' names and addresses, in order.
 *
 * @returns Each tab's name and address.
 */
function tabLinks() {
  const tabs = within(screen.getByRole('navigation', { name: 'User sections' }));
  return tabs.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);
}

describe('UserHeader', () => {
  beforeEach(() => {
    useSelectedLayoutSegment.mockReset();
  });

  it('names the user, with their address, badges and a way back to the users', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<UserHeader user={USER} tabs={['overview', 'companies']} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    expect(screen.getByText('Staff · Manager')).toBeInTheDocument();
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
  });

  it('shows every tab the viewer gets, in order, Overview at the page itself', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<UserHeader user={USER} tabs={['overview', 'companies', 'activity', 'manage']} />);

    expect(tabLinks()).toEqual([
      ['Overview', BASE],
      ['Companies', `${BASE}/companies`],
      ['Activity', `${BASE}/activity`],
      ['Manage', `${BASE}/manage`],
    ]);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves out the tabs the viewer doesn’t get, and marks the open one', () => {
    useSelectedLayoutSegment.mockReturnValue('companies');
    render(<UserHeader user={USER} tabs={['overview', 'companies']} />);

    expect(tabLinks()).toEqual([
      ['Overview', BASE],
      ['Companies', `${BASE}/companies`],
    ]);
    expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});

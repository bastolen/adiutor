/**
 * @file Tests for the staff shortcuts on the dashboard: every staff member
 * gets the Users and Companies tiles, only those who may manage the staff
 * get the Staff tile, and only those who may see the audit log the Logs tile.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import StaffShortcuts from './staff-shortcuts';

describe('StaffShortcuts', () => {
  it('shows Users, Companies, Staff and Logs to Admins', () => {
    render(<StaffShortcuts canManageStaff canViewLogs />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/companies',
      '/admin/staff',
      '/admin/logs',
    ]);
    // Each tile is named by its title, followed by its description.
    expect(screen.getByRole('link', { name: /^Users/ })).toHaveTextContent(
      'Staff and the people of each company.',
    );
    expect(screen.getByRole('link', { name: /^Companies/ })).toHaveTextContent(
      'View and manage every company.',
    );
    expect(screen.getByRole('link', { name: /^Staff/ })).toHaveTextContent(
      'Invite staff and manage their roles.',
    );
    expect(screen.getByRole('link', { name: /^Logs/ })).toHaveTextContent(
      'The audit log, and the errors people ran into.',
    );
  });

  it('shows Logs, not Staff, to Managers', () => {
    render(<StaffShortcuts canManageStaff={false} canViewLogs />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/companies',
      '/admin/logs',
    ]);
  });

  it.each([
    ['four tiles', true],
    ['three tiles', false],
  ])('never uses more than two columns, with %s', (_tiles, canManageStaff) => {
    render(<StaffShortcuts canManageStaff={canManageStaff} canViewLogs />);

    const list = screen.getByRole('list');
    expect(list).toHaveClass('sm:grid-cols-2');
    expect(list.className).not.toMatch(/grid-cols-([3-9]|\d{2})/);
  });

  it('leaves out Staff and Logs for everyone else', () => {
    render(<StaffShortcuts canManageStaff={false} canViewLogs={false} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/companies',
    ]);
    expect(screen.queryByRole('link', { name: /^Staff/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Logs/ })).not.toBeInTheDocument();
  });
});

/**
 * @file Tests for the staff shortcuts on the dashboard: a tile for each of
 * the user's staff sections, named by its title and followed by its
 * description (which sections each role gets is tested in
 * `staff-sections.test.ts`).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import StaffShortcuts from './staff-shortcuts';

describe('StaffShortcuts', () => {
  it('shows a tile for each section', () => {
    render(<StaffShortcuts sections={['users', 'companies', 'staff', 'logs']} />);

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
      'The audit log, the errors people ran into and the background jobs.',
    );
  });

  it('leaves out the sections the user may not see', () => {
    render(<StaffShortcuts sections={['users', 'companies', 'logs']} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/companies',
      '/admin/logs',
    ]);
  });

  it('never uses more than two columns', () => {
    render(<StaffShortcuts sections={['users', 'companies', 'staff', 'logs']} />);

    const list = screen.getByRole('list');
    expect(list).toHaveClass('sm:grid-cols-2');
    expect(list.className).not.toMatch(/grid-cols-([3-9]|\d{2})/);
  });
});

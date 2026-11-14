/**
 * @file Tests for the shortcuts on the dashboard: a tile for Requests, then
 * one for each of the user's staff sections, named by its title and followed
 * by its description (which sections each role gets is tested in
 * `staff-sections.test.ts`).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Shortcuts from './shortcuts';

describe('Shortcuts', () => {
  it('shows a tile for the requests, then one for each section', () => {
    render(<Shortcuts sections={['users', 'companies', 'staff', 'logs']} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/requests',
      '/admin/users',
      '/admin/companies',
      '/admin/staff',
      '/admin/logs',
    ]);
    // Each tile is named by its title, followed by its description.
    expect(screen.getByRole('link', { name: /^Requests/ })).toHaveTextContent(
      'What was asked, and where it stands.',
    );
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
    render(<Shortcuts sections={['users', 'companies', 'logs']} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/requests',
      '/admin/users',
      '/admin/companies',
      '/admin/logs',
    ]);
  });

  it('shows company users, who have no staff sections, the requests only', () => {
    render(<Shortcuts sections={[]} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/requests',
    ]);
  });

  it('words the requests tile so that no staff section is mistaken for it', () => {
    render(<Shortcuts sections={[]} />);

    // Other tests find the staff sections' links by these words.
    expect(screen.getByRole('link')).not.toHaveTextContent(/users|companies|staff|logs/i);
  });

  it('never uses more than two columns', () => {
    render(<Shortcuts sections={['users', 'companies', 'staff', 'logs']} />);

    const list = screen.getByRole('list');
    expect(list).toHaveClass('sm:grid-cols-2');
    expect(list.className).not.toMatch(/grid-cols-([3-9]|\d{2})/);
  });
});

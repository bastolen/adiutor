/**
 * @file Tests for the staff navigation links: Dashboard, then the user's
 * staff sections (which sections each role gets is tested in
 * `staff-sections.test.ts`); Logs stays current on its Errors tab.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavLinks from './nav-links';

/** The mocked current path. */
const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => '/dashboard') }));

vi.mock('next/navigation', () => ({ usePathname }));

describe('NavLinks', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/dashboard');
  });

  it('links to the dashboard, then each section', () => {
    render(<NavLinks sections={['users', 'companies', 'staff', 'logs']} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/admin/users',
      '/admin/companies',
      '/admin/staff',
      '/admin/logs',
    ]);
  });

  it('leaves out the sections the user may not see', () => {
    render(<NavLinks sections={['users', 'companies', 'logs']} />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/admin/logs');
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it('marks Logs as current on its Errors tab too', () => {
    usePathname.mockReturnValue('/admin/logs/errors');
    render(<NavLinks sections={['users', 'companies', 'staff', 'logs']} />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
  });
});

/**
 * @file Tests for the staff navigation links: every staff member gets
 * Dashboard, Users and Companies; Admins also Staff; those who may see the
 * audit log (Admins and Managers) also Logs, which stays current on its
 * Errors tab.
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

  it('shows Staff and Logs to Admins', () => {
    render(<NavLinks canManageStaff canViewLogs />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/admin/users',
      '/admin/companies',
      '/admin/staff',
      '/admin/logs',
    ]);
  });

  it('shows Logs, not Staff, to Managers', () => {
    render(<NavLinks canManageStaff={false} canViewLogs />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/admin/logs');
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it('leaves Logs out for staff who may not see the audit log', () => {
    render(<NavLinks canManageStaff={false} canViewLogs={false} />);

    expect(screen.queryByRole('link', { name: 'Logs' })).not.toBeInTheDocument();
  });

  it('marks Logs as current on its Errors tab too', () => {
    usePathname.mockReturnValue('/admin/logs/errors');
    render(<NavLinks canManageStaff canViewLogs />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
  });
});

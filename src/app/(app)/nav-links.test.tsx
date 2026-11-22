/**
 * @file Tests for the navigation links: Dashboard and Requests for everyone,
 * then the user's staff sections (which sections each role gets is tested in
 * `staff-sections.test.ts`); Requests stays current on a request's page, and
 * Logs on its Errors tab.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALES } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';

import NavLinks from './nav-links';

/** The mocked current path. */
const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => '/dashboard') }));

vi.mock('next/navigation', () => ({ usePathname }));

describe('NavLinks', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/dashboard');
  });

  it('links to the dashboard and the requests, then each section', () => {
    render(<NavLinks sections={['users', 'companies', 'settings', 'logs']} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/requests',
      '/admin/users',
      '/admin/companies',
      '/admin/settings',
      '/admin/logs',
    ]);
  });

  it('leaves out the sections the user may not see', () => {
    render(<NavLinks sections={['users', 'companies', 'logs']} />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/admin/logs');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('gives company users, who have no staff sections, the dashboard and the requests', () => {
    render(<NavLinks sections={[]} />);

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dashboard',
      'Requests',
    ]);
  });

  it('marks Requests as current on a request and on the form for a new one', () => {
    usePathname.mockReturnValue('/requests/142');
    const { rerender } = render(<NavLinks sections={[]} />);
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');

    usePathname.mockReturnValue('/requests/new');
    rerender(<NavLinks sections={[]} />);
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Logs as current on its Errors tab too', () => {
    usePathname.mockReturnValue('/admin/logs/errors');
    render(<NavLinks sections={['users', 'companies', 'settings', 'logs']} />);

    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
  });

  it.each(LOCALES)('names the Logs section as its page is headed, in %s', (locale) => {
    expect(translator(locale, 'navigation')('items.logs')).toBe(
      translator(locale, 'admin.logs')('header.title'),
    );
  });
});

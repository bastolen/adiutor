/**
 * @file Tests for the segmented navigation: a named landmark of links, the
 * current one marked, and a busy spinner in the followed link's label while
 * its page loads.
 */
import { render, screen } from '@testing-library/react';
import { useLinkStatus } from 'next/link';
import { describe, expect, it, vi } from 'vitest';

import SegmentedNav from './segmented-nav';

vi.mock('next/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/link')>()),
  useLinkStatus: vi.fn(() => ({ pending: false })),
}));

/** The filters of the Users page. */
const items = [
  { href: '/admin/users', label: 'All', current: false },
  { href: '/admin/users?filter=staff', label: 'Staff', current: true },
  { href: '/admin/users?filter=not_staff', label: 'Not staff', current: false },
];

describe('SegmentedNav', () => {
  it('is a named navigation landmark with the current link marked', () => {
    render(<SegmentedNav label="Filter users" items={items} />);

    const nav = screen.getByRole('navigation', { name: 'Filter users' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Not staff' })).toHaveAttribute(
      'href',
      '/admin/users?filter=not_staff',
    );
  });

  it('shows a busy spinner in place of the label while a link’s page loads', () => {
    vi.mocked(useLinkStatus).mockReturnValue({ pending: true });
    const { container } = render(<SegmentedNav label="Filter users" items={items.slice(0, 1)} />);

    const link = screen.getByRole('link', { name: 'All' });
    expect(link.querySelector('[aria-busy="true"]')).not.toBeNull();
    // The label keeps its space (hidden, still in the link's name) while the spinner shows.
    expect(container.querySelector('.invisible')).toHaveTextContent('All');
  });
});

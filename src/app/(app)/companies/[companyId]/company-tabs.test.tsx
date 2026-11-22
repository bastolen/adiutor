/**
 * @file Tests for the company's tabs: Requests is the open section on the
 * company's list and on its board, and the other tabs on their own pages.
 */
import { render, screen } from '@testing-library/react';
import { useSelectedLayoutSegment } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';

import CompanyTabs from './company-tabs';

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment: vi.fn() }));

/** The tabs as the company's header gives them. */
const TABS = [
  { href: '/companies/adiutor-tests', label: 'Requests', segment: null },
  { href: '/companies/adiutor-tests/members', label: 'Members', segment: 'members' },
];

/**
 * Shows the tabs below a segment of the company's layout.
 *
 * @param segment - The segment, or `null` on the company's first page.
 */
function renderTabs(segment: string | null) {
  vi.mocked(useSelectedLayoutSegment).mockReturnValue(segment);
  render(<CompanyTabs label="Company sections" items={TABS} />);
}

describe('CompanyTabs', () => {
  it.each([
    ['the company’s list', null],
    ['the company’s board', 'board'],
  ])('marks Requests as the open section on %s', (_where, segment) => {
    renderTabs(segment);

    const requests = screen.getByRole('link', { name: 'Requests' });
    expect(requests).toHaveAttribute('aria-current', 'page');
    // It still opens the company's list.
    expect(requests).toHaveAttribute('href', '/companies/adiutor-tests');
    expect(screen.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  it('marks another tab on its own page', () => {
    renderTabs('members');

    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Requests' })).not.toHaveAttribute('aria-current');
  });
});

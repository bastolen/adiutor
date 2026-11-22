/**
 * @file Tests for section tabs in a layout: the tab for the route segment
 * below the layout is the current one, and `null` stands for the layout's own
 * page.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SegmentTabNav from './segment-tab-nav';

/** The mocked segment below the layout. */
const { useSelectedLayoutSegment } = vi.hoisted(() => ({
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment }));

/** A company's tabs. */
const TABS = [
  { href: '/companies/adiutor-tests', label: 'Overview', segment: null },
  { href: '/companies/adiutor-tests/members', label: 'Members', segment: 'members' },
  { href: '/companies/adiutor-tests/settings', label: 'Settings', segment: 'settings' },
] as const;

describe('SegmentTabNav', () => {
  beforeEach(() => {
    useSelectedLayoutSegment.mockReset();
  });

  it('marks the tab for the segment below the layout as current', () => {
    useSelectedLayoutSegment.mockReturnValue('members');
    render(<SegmentTabNav label="Company sections" items={TABS} />);

    const nav = screen.getByRole('navigation', { name: 'Company sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('marks the layout’s own page when there is no segment below it', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<SegmentTabNav label="Company sections" items={TABS} />);

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  it('lets tabs that don’t fit wrap onto another row, rather than widen the page', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<SegmentTabNav label="Company sections" items={TABS} />);

    expect(screen.getByRole('list')).toHaveClass('flex-wrap');
  });
});

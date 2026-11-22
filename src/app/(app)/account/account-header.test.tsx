/**
 * @file Tests for the header of the account pages: the "Account" heading and
 * the tabs Profile, Preferences, Security and Activity, in that order, the
 * open one marked as current.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountHeader from './account-header';

/** The mocked segment below the account layout. */
const { useSelectedLayoutSegment } = vi.hoisted(() => ({
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment }));

describe('AccountHeader', () => {
  beforeEach(() => {
    useSelectedLayoutSegment.mockReset();
  });

  it('shows a tab for each account page, in order', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<AccountHeader name="Jane Doe" email="jane@adiutor.test" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Account sections' }));
    expect(
      tabs.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Profile', '/account'],
      ['Preferences', '/account/preferences'],
      ['Security', '/account/security'],
      ['Activity', '/account/activity'],
    ]);
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['preferences', 'Preferences'],
    ['activity', 'Activity'],
  ])('marks the %s tab as current on its page', (segment, name) => {
    useSelectedLayoutSegment.mockReturnValue(segment);
    render(<AccountHeader name="Jane Doe" email="jane@adiutor.test" />);

    expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
  });
});

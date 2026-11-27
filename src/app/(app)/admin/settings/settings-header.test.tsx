/**
 * @file Tests for the heading and tabs of the Settings pages: General, Staff,
 * Requests and Connections, in that order, the open one marked as current,
 * with Connections current on a webhook's page too.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsHeader from './settings-header';

/** The mocked segment below the Settings layout. */
const { useSelectedLayoutSegment } = vi.hoisted(() => ({
  useSelectedLayoutSegment: vi.fn<() => string | null>(),
}));

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment }));

describe('SettingsHeader', () => {
  beforeEach(() => {
    useSelectedLayoutSegment.mockReset();
  });

  it('shows the heading and a tab for each Settings page, in order', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<SettingsHeader />);

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Settings sections' }));
    expect(
      tabs.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['General', '/admin/settings'],
      ['Staff', '/admin/settings/staff'],
      ['Requests', '/admin/settings/requests'],
      ['Connections', '/admin/settings/connections'],
    ]);
  });

  it('marks General as current on the layout’s own page', () => {
    useSelectedLayoutSegment.mockReturnValue(null);
    render(<SettingsHeader />);

    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Staff' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['staff', 'Staff'],
    ['requests', 'Requests'],
    ['connections', 'Connections'],
  ])('marks the tab of the %s page as current', (segment, name) => {
    useSelectedLayoutSegment.mockReturnValue(segment);
    render(<SettingsHeader />);

    expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });

  it('marks Connections as the current section on a webhook’s page', () => {
    useSelectedLayoutSegment.mockReturnValue('webhooks');
    render(<SettingsHeader />);

    expect(screen.getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });
});

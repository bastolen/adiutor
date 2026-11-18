/**
 * @file Tests for the activity list.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import ActivityList from './activity-list';

describe('ActivityList', () => {
  it('shows what happened with when, the device and the IP address', () => {
    render(
      <ActivityList
        label="Your recent activity"
        items={[
          {
            id: '1',
            description: 'Signed in with a passkey',
            at: new Date(Date.now() - 5 * 60_000),
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
            ip: '203.0.113.7',
          },
          { id: '2', description: 'Added a passkey', at: new Date(Date.now() - 60 * 60_000) },
        ]}
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Your recent activity' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Signed in with a passkey');
    expect(items[0]).toHaveTextContent('5 minutes ago');
    expect(items[0]).toHaveTextContent('Chrome on macOS');
    expect(items[0]).toHaveTextContent('203.0.113.7');
    expect(items[1]).not.toHaveTextContent('·');
  });

  it('words this computer and an unknown address in the reader’s language', () => {
    renderInLocale(
      'nl-NL',
      <ActivityList
        label="Je recente activiteit"
        items={[
          { id: '1', description: 'Ingelogd', at: new Date(Date.now() - 5 * 60_000), ip: '::1' },
        ]}
      />,
    );

    expect(screen.getByRole('listitem')).toHaveTextContent('· Lokaal');
    expect(screen.queryByText(/Local/)).toBeNull();
  });
});

/**
 * @file Tests for a webhook's page: the details card (where it sends and
 * what, why it's off, the controls it offers on and off) and the
 * deliveries table (how each went, and Send again only for a delivery
 * that's over, of a webhook that's on, never a test).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import translator from '@/lib/i18n/translator';
import { createPageUrl } from '@/lib/tables/page-url';
import { WEBHOOK_DELIVERIES_TABLE } from '@/lib/tables/tables';
import type { DeliveryView, WebhookView } from '@/server/webhooks';

import DeliveriesCard from './deliveries-card';
import WebhookDetailsCard from './webhook-details-card';

vi.mock('../actions', () => ({
  removeWebhookAction: vi.fn(),
  renewWebhookSecretAction: vi.fn(),
  resendDeliveryAction: vi.fn(),
  sendTestEventAction: vi.fn(),
  setWebhookOnAction: vi.fn(),
  updateWebhookAction: vi.fn(),
}));

/** The request types the page passes. */
const types = [
  { key: 'hotfix', name: 'Hotfix', archived: false },
  { key: 'bug', name: 'Bug', archived: false },
];

/**
 * A webhook as the page gets it.
 *
 * @param overrides - What to change.
 * @returns The webhook.
 */
function webhookWith(overrides: Partial<WebhookView> = {}): WebhookView {
  return {
    id: '019abcde-0000-7000-8000-000000000001',
    name: 'Procurement',
    host: 'hooks.adiutor.dev',
    format: 'json',
    events: ['raised', 'reply'],
    allTypes: false,
    types: ['hotfix', 'bug'],
    on: true,
    offReason: null,
    turnedOffAt: null,
    failingSince: null,
    secretRenewedAt: null,
    createdAt: new Date('2026-11-20T10:00:00Z'),
    ...overrides,
  };
}

/**
 * A delivery as the table gets it.
 *
 * @param overrides - What to change.
 * @returns The delivery.
 */
function deliveryWith(overrides: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: '019abcde-0000-7000-8000-0000000000aa',
    test: false,
    events: ['reply', 'status'],
    request: { number: 142, reference: 'AD-142' },
    status: 'delivered',
    attempts: 1,
    lastAttemptAt: new Date('2026-11-25T10:00:00Z'),
    lastStatus: 200,
    lastError: null,
    lastDurationMs: 120,
    nextAttemptAt: null,
    createdAt: new Date('2026-11-25T10:00:00Z'),
    ...overrides,
  };
}

/** The table's links in its default state. */
const TABLE = createPageUrl(
  '/admin/settings/webhooks/019abcde-0000-7000-8000-000000000001',
  {},
  translator('en-US', 'tables'),
).table(WEBHOOK_DELIVERIES_TABLE, { sort: 'time', dir: 'desc', page: 1, size: 25 });

describe('WebhookDetailsCard', () => {
  it('says where a webhook sends and what, with the controls of one that’s on', () => {
    render(<WebhookDetailsCard webhook={webhookWith()} types={types} />);

    const card = screen.getByRole('region', { name: 'Procurement' });
    expect(card).toHaveTextContent('hooks.adiutor.dev');
    expect(card).toHaveTextContent('Hotfix and Bug');
    expect(card).toHaveTextContent('Requests raised and Replies');
    expect(card).toHaveTextContent('On');
    for (const name of ['Edit', 'Send a test', 'Turn off', 'Renew secret', 'Remove']) {
      expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(card).queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });

  it('says why a webhook was turned off by itself, and offers to turn it on', () => {
    render(
      <WebhookDetailsCard
        webhook={webhookWith({
          on: false,
          offReason: 'failing',
          failingSince: new Date('2026-11-21T10:00:00Z'),
        })}
        types={types}
      />,
    );

    const card = screen.getByRole('region', { name: 'Procurement' });
    expect(card).toHaveTextContent('Off: kept failing');
    expect(within(card).getByRole('status')).toHaveTextContent(
      'It was turned off automatically because every delivery failed for 3 days.',
    );
    expect(card).toHaveTextContent('Failing since');
    expect(within(card).getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});

describe('DeliveriesCard', () => {
  it('shows how each delivery went, and Send again only for one that’s over and isn’t a test', () => {
    render(
      <DeliveriesCard
        webhookId="019abcde-0000-7000-8000-000000000001"
        on
        timeZone="UTC"
        table={TABLE}
        deliveries={{
          items: [
            deliveryWith({
              id: 'd1',
              status: 'pending',
              attempts: 2,
              lastStatus: 503,
              lastError: 'http',
              nextAttemptAt: new Date('2026-11-25T10:35:00Z'),
            }),
            deliveryWith({
              id: 'd2',
              status: 'failed',
              attempts: 6,
              lastError: 'timeout',
              lastStatus: null,
            }),
            deliveryWith({ id: 'd3', test: true, events: [], request: null }),
          ],
          total: 3,
          page: 1,
          size: 25,
        }}
      />,
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Replies and Status changes');
    expect(rows[0]).toHaveTextContent('AD-142');
    expect(rows[0]).toHaveTextContent('Sending');
    expect(rows[0]).toHaveTextContent('It answered 503.');
    expect(rows[0]).toHaveTextContent('Next attempt:');
    expect(within(rows[0] ?? document.body).queryByRole('button')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Failed');
    expect(rows[1]).toHaveTextContent('No answer within 10 seconds.');
    expect(rows[1]).toHaveTextContent('6 attempts');
    expect(
      within(rows[1] ?? document.body).getByRole('button', { name: /^Send the delivery of/ }),
    ).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Test');
    expect(rows[2]).toHaveTextContent('Answered 200.');
    expect(within(rows[2] ?? document.body).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no Send again while the webhook is off, and says when there are no deliveries', () => {
    const { rerender } = render(
      <DeliveriesCard
        webhookId="019abcde-0000-7000-8000-000000000001"
        on={false}
        timeZone="UTC"
        table={TABLE}
        deliveries={{ items: [deliveryWith({ status: 'failed' })], total: 1, page: 1, size: 25 }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Send the delivery of/ })).not.toBeInTheDocument();

    rerender(
      <DeliveriesCard
        webhookId="019abcde-0000-7000-8000-000000000001"
        on
        timeZone="UTC"
        table={TABLE}
        deliveries={{ items: [], total: 0, page: 1, size: 25 }}
      />,
    );
    expect(screen.getByText('No deliveries yet')).toBeInTheDocument();
  });
});

/**
 * @file End-to-end tests for webhooks on Settings › Integrations: a staff Admin
 * adds one, sees its signing secret once and finds it listed with its host
 * (never its address); an address inside the server's own network is refused in the
 * dialog; and a webhook to a receiver on 127.0.0.1 (which the test server
 * allows) gets a signed test and a signed delivery of a request's news,
 * which its page lists, before it's turned off and on and removed. The
 * webhooks a test adds are removed afterwards, so later specs' request
 * changes queue nothing for them.
 */
import { createHmac } from 'node:crypto';

import { startWebhookReceiver, type ReceivedRequest } from '../tests/http/webhook-receiver';
import { removeWebhooks, storeOwnRequest } from './support/db';
import { PLATFORM_ADMIN } from './support/fixtures';
import { signIn, toasts } from './support/helpers';
import { runJobs } from './support/outbox';
import { expect, test } from './support/test';

/** The names of the webhooks these tests add, removed after them. */
const NAMES = ['E2E Procurement', 'E2E Internal', 'E2E Receiver'];

/**
 * Checks a request's Standard Webhooks signature with the webhook's secret.
 *
 * @param request - What the receiver got.
 * @param secret - The webhook's secret, as Settings showed it.
 * @returns Whether the signature is the one the secret makes.
 */
function signedWith(request: ReceivedRequest | undefined, secret: string): boolean {
  const id = String(request?.headers['webhook-id']);
  const timestamp = String(request?.headers['webhook-timestamp']);
  const mac = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(`${id}.${timestamp}.${request?.body ?? ''}`)
    .digest('base64');
  return request?.headers['webhook-signature'] === `v1,${mac}`;
}

test.afterAll(async () => {
  await removeWebhooks(NAMES);
});

test('a staff Admin adds a webhook, sees its secret once, and finds it listed by its host', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/settings/integrations');
  const card = page.getByRole('region', { name: 'Webhooks' });
  await card.getByRole('button', { name: 'Add webhook' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a webhook' });

  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E Procurement');
  await dialog
    .getByRole('textbox', { name: 'Address' })
    .fill('https://hooks.adiutor.test/in?token=e2e-secret-token');
  await dialog.getByRole('radio', { name: 'Chosen types' }).check();
  await dialog.getByRole('checkbox', { name: 'Bug' }).check();
  await dialog.getByRole('checkbox', { name: 'Internal notes' }).check();
  await dialog.getByRole('button', { name: 'Add webhook' }).click();

  const secret = dialog.getByRole('textbox', { name: 'Signing secret' });
  await expect(secret).toHaveValue(/^whsec_[A-Za-z0-9+/]{43}=$/);
  await expect(dialog.getByRole('status')).toContainText('Webhook added.');
  // No toast while the dialog is open: it would take the dialog's Escape.
  await expect(toasts(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toasts(page)).toContainText('Webhook added.');

  const item = card.getByRole('listitem').filter({ hasText: 'E2E Procurement' });
  await expect(item).toContainText('On');
  await expect(item).toContainText('Signed JSON');
  await expect(item).toContainText('To hooks.adiutor.test · Bug');
  await expect(item).toContainText('Requests raised, Replies, Internal notes, and Status changes');
  // The address is never shown again, nor is the secret.
  await expect(page.getByRole('main')).not.toContainText('e2e-secret-token');
  await page.reload();
  await expect(page.getByRole('main')).not.toContainText('whsec_');
});

test('an address inside the server’s own network is refused in the dialog, with what was typed', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/settings/integrations');
  await page
    .getByRole('region', { name: 'Webhooks' })
    .getByRole('button', { name: 'Add webhook' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add a webhook' });

  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E Internal');
  await dialog.getByRole('textbox', { name: 'Address' }).fill('https://169.254.169.254/latest');
  await dialog.getByRole('button', { name: 'Add webhook' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'This address is inside this server’s own network, which webhooks never reach.',
  );
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('E2E Internal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Webhooks' })).not.toContainText('E2E Internal');
});

test('a webhook gets a signed test and a signed delivery of a request’s news, which its page lists', async ({
  page,
}) => {
  const receiver = await startWebhookReceiver();
  try {
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings/integrations');
    const card = page.getByRole('region', { name: 'Webhooks' });
    await card.getByRole('button', { name: 'Add webhook' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a webhook' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E Receiver');
    await dialog.getByRole('textbox', { name: 'Address' }).fill(receiver.url);
    await dialog.getByRole('button', { name: 'Add webhook' }).click();
    const secret = await dialog.getByRole('textbox', { name: 'Signing secret' }).inputValue();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Its page, under the Integrations tab: a test is sent while the Admin waits.
    await card.getByRole('link', { name: 'E2E Receiver' }).click();
    await expect(page.getByRole('region', { name: 'E2E Receiver' })).toContainText('127.0.0.1');
    await expect(
      page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Integrations' }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('link', { name: 'All webhooks' })).toHaveAttribute(
      'href',
      '/admin/settings/integrations#webhooks',
    );
    await page.getByRole('button', { name: 'Send a test' }).click();
    await expect(toasts(page)).toContainText('Test delivered: the receiver answered 200.');
    expect(JSON.parse(receiver.received[0]?.body ?? '{}')).toMatchObject({
      type: 'webhook.test',
      data: { webhook: { name: 'E2E Receiver' } },
    });
    expect(signedWith(receiver.received[0], secret)).toBe(true);
    const webhookPage = page.url();

    // A change to a request goes out at the next tick, signed, without anyone's address.
    const number = await storeOwnRequest({ title: 'E2E The webhook’s printer' });
    await page.goto(`/requests/${number}`);
    const status = page.getByRole('combobox', { name: 'Status' });
    await status.click();
    await page.getByRole('option', { name: 'To do' }).click();
    await expect(toasts(page)).toContainText('Status saved.');
    await expect
      .poll(async () => {
        await runJobs();
        return receiver.received.length;
      })
      .toBe(2);
    const delivery = receiver.received[1];
    expect(JSON.parse(delivery?.body ?? '{}')).toMatchObject({
      type: 'request.updated',
      data: {
        request: { number, title: 'E2E The webhook’s printer', status: 'todo' },
        events: [{ type: 'status', from: 'open', to: 'todo', by: { name: PLATFORM_ADMIN.name } }],
      },
    });
    expect(delivery?.body).not.toContain('@adiutor.test');
    expect(signedWith(delivery, secret)).toBe(true);

    // Its page lists both, newest first.
    await page.goto(webhookPage);
    const rows = page.getByRole('table', { name: /^Deliveries/ }).getByRole('row');
    await expect(rows.nth(1)).toContainText('Status changes');
    await expect(rows.nth(1)).toContainText('Delivered');
    await expect(rows.nth(2)).toContainText('Test');

    // Off and on again, then removed, back on the list.
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(toasts(page)).toContainText('Webhook turned off.');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(toasts(page)).toContainText('Webhook turned on.');
    await page.getByRole('button', { name: 'Remove' }).click();
    await page
      .getByRole('alertdialog', { name: 'Remove E2E Receiver?' })
      .getByRole('button', { name: 'Remove webhook' })
      .click();
    await expect(page).toHaveURL('/admin/settings/integrations#webhooks');
    await expect(toasts(page)).toContainText('Webhook removed.');
    await expect(page.getByRole('region', { name: 'Webhooks' })).not.toContainText('E2E Receiver');
  } finally {
    await receiver.close();
  }
});

/**
 * @file End-to-end tests for webhooks on Settings › Webhooks: a staff Admin
 * adds one, sees its signing secret once and finds it listed with its host
 * (never its address); an address inside Adiutor's network is refused in the
 * dialog. The webhooks a test adds are removed afterwards, so later specs'
 * request changes queue nothing for them.
 */
import { removeWebhooks } from './support/db';
import { PLATFORM_ADMIN } from './support/fixtures';
import { signIn, toasts } from './support/helpers';
import { expect, test } from './support/test';

/** The names of the webhooks these tests add, removed after them. */
const NAMES = ['E2E Procurement', 'E2E Internal'];

test.afterAll(async () => {
  await removeWebhooks(NAMES);
});

test('a staff Admin adds a webhook, sees its secret once, and finds it listed by its host', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/settings/webhooks');
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

test('an address inside Adiutor’s network is refused in the dialog, with what was typed', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/settings/webhooks');
  await page
    .getByRole('region', { name: 'Webhooks' })
    .getByRole('button', { name: 'Add webhook' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add a webhook' });

  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E Internal');
  await dialog.getByRole('textbox', { name: 'Address' }).fill('https://169.254.169.254/latest');
  await dialog.getByRole('button', { name: 'Add webhook' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'This address is inside Adiutor’s own network, which webhooks never reach.',
  );
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('E2E Internal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Webhooks' })).not.toContainText('E2E Internal');
});

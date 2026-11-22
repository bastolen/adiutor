/**
 * @file End-to-end tests for time zones: a new account takes its browser's
 * zone on its first visit, pages and copied code show times and days in it,
 * without naming the zone on the page, and the Preferences tab's Time zone card
 * changes it, found by typing its city.
 */
import { findCompanyId, savedTimeZoneOf, storeInvitation, storeRequest } from './support/db';
import { COMPANY_SLUG } from './support/fixtures';
import { freshAddress, searchSelect, toasts } from './support/helpers';
import { expect, test } from './support/test';

/**
 * A browser in Adelaide: half an hour off the hour, so a time in another zone
 * can't pass for it, and named the same in every runtime (unlike India's
 * `Asia/Kolkata`, which some report as `Asia/Calcutta`).
 */
test.use({ timezoneId: 'Australia/Adelaide' });

test("a new account takes its browser's zone, and pages show times in it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const email = freshAddress('adelaide');
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  // Every full page load from here: the one after the account is made, and the first visit's.
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  await page.getByLabel('Your name').fill('Adelaide Tester');
  await page.getByLabel('Password', { exact: true }).fill('e2e-adelaide-password');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);

  // The first page saves the browser's zone and loads again in it (the tests' default is UTC).
  await expect.poll(() => savedTimeZoneOf(email)).toBe('Australia/Adelaide');
  await expect.poll(() => loads).toBe(2);
  // The cookie holds it encoded, as cookies are written ("Australia%2FAdelaide").
  const cookie = (await context.cookies()).find(({ name }) => name === 'adiutor.time-zone');
  expect(decodeURIComponent(cookie?.value ?? '')).toBe('Australia/Adelaide');

  // 23:30 in UTC is 10:00 the next morning in Adelaide (summer time there, UTC+10:30).
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: email,
    title: 'Times in my zone',
    description: 'Run this:\n\n```bash\nnpm test\n```',
    at: new Date('2026-11-18T23:30:00Z'),
  });
  await page.goto(`/requests/${number}`);
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('Nov 19, 2026, 10:00 AM');
  await expect(details).not.toContainText('UTC');

  // The note above copied code holds the day it was in Adelaide.
  await page.getByRole('button', { name: 'Copy code' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Written by Adelaide Tester on Nov 19, 2026');
});

test('the Time zone card changes the zone every page shows, and offers the browser’s', async ({
  page,
}) => {
  const email = freshAddress('tokyo');
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  await page.getByLabel('Your name').fill('Tokyo Tester');
  await page.getByLabel('Password', { exact: true }).fill('e2e-tokyo-password');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  await expect.poll(() => savedTimeZoneOf(email)).toBe('Australia/Adelaide');

  await page.goto('/account/preferences');
  const card = page.getByRole('region', { name: 'Time zone' });
  const select = card.getByRole('combobox', { name: 'Time zone' });
  // Zones are named by their place, and the browser's by its full name.
  await expect(select).toContainText('Adelaide');
  await expect(card).toContainText('This browser is set to Australia/Adelaide.');
  // Typing on the field searches the zones by city; Enter picks the match.
  const panel = await searchSelect(select, 'tokyo');
  await expect(panel.getByRole('option')).toHaveText([/^Tokyo \(UTC\+09:00\)/]);
  await expect(panel.getByRole('group', { name: 'Asia' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(select).toBeFocused();
  await expect(select).toContainText('Tokyo');
  await card.getByRole('button', { name: 'Save time zone' }).click();
  // The page loads afresh in the new zone, and says so.
  await expect(toasts(page)).toContainText('Time zone saved.');
  await expect(page.getByRole('combobox', { name: 'Time zone' })).toContainText('Tokyo');
  expect(await savedTimeZoneOf(email)).toBe('Asia/Tokyo');

  // 23:30 in UTC is 8:30 the next morning in Tokyo.
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: email,
    title: 'Times in my chosen zone',
    at: new Date('2026-11-18T23:30:00Z'),
  });
  await page.goto(`/requests/${number}`);
  await expect(page.getByRole('region', { name: 'Details' })).toContainText(
    'Nov 19, 2026, 8:30 AM',
  );

  // Back to the browser's own zone in one press.
  await page.goto('/account/preferences');
  const useBrowser = page.getByRole('button', { name: 'Use this browser’s zone' });
  await useBrowser.click();
  await expect(useBrowser).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('combobox', { name: 'Time zone' })).toContainText('Adelaide');
  await page.getByRole('button', { name: 'Save time zone' }).click();
  await expect(toasts(page)).toContainText('Time zone saved.');
  await expect.poll(() => savedTimeZoneOf(email)).toBe('Australia/Adelaide');
});

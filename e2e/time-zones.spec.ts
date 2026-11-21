/**
 * @file End-to-end tests for time zones: a new account takes its browser's
 * zone on its first visit, and pages and copied code show times and days in
 * it, without naming the zone on the page.
 */
import { findCompanyId, savedTimeZoneOf, storeInvitation, storeRequest } from './support/db';
import { COMPANY_SLUG } from './support/fixtures';
import { freshAddress } from './support/helpers';
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

/**
 * @file End-to-end tests for the security hardening: response headers, closed
 * Better Auth endpoints, MFA at sign-in and for sign-in changes, limits on
 * guessing, sign-in redirects and links. Runs in order, without retries: the
 * accounts carry state from test to test.
 */
import { type Locator, type Page } from '@playwright/test';

import { defined } from '../src/lib/defined';
import {
  EMAIL_CODES_NOT_ALLOWED,
  MFA_REQUIRED_FOR_ROLE,
  MFA_VERIFICATION_REQUIRED,
  PASSWORD_SIGN_IN_PAUSED,
  TOO_MANY_ATTEMPTS,
} from '../src/lib/sign-in/sign-in-refusals';
import {
  backdateMfaConfirmation,
  sessionOfCookieExists,
  storeSignInLink,
  useUpSignInLink,
} from './support/db';
import {
  CLIENT_WATCHER,
  E2E_BASE_URL,
  PAUSED_CLIENT,
  RECENT_MFA_CLIENT,
  STAFF_NAME,
  STEP_UP_MANAGER,
  STEP_UP_CLIENT,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  confirmWithAuthenticator,
  fillAndSubmitSignIn,
  freshAddress,
  openSignInLink,
  randomClientIp,
  signIn,
  submitPassword,
} from './support/helpers';
import { countEmails, linkIn, waitForNewEmail } from './support/outbox';
import { inOrder, repeatInOrder } from './support/sequence';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';

// The tests use up state (step-up attempts, a password, a lockout), so a retry of the file could
// only fail at an earlier test: no retries, and a trace of the first failure instead. The file
// still runs top to bottom on one worker, but a failure doesn't hide the tests after it.
test.describe.configure({ retries: 0 });
test.use({ trace: 'retain-on-failure' });

/**
 * Headers for direct API calls: the site's own origin (Better Auth checks
 * it), and a fresh client IP each time so Better Auth's per-IP limits don't
 * interfere with the app's own per-account limits being tested.
 *
 * @returns The headers.
 */
function apiHeaders(): Record<string, string> {
  return {
    Origin: E2E_BASE_URL,
    'X-Forwarded-For': randomClientIp(),
  };
}

/**
 * Signs in with an email link, as someone who controls the inbox would.
 *
 * @param page - The browser page.
 * @param email - The account's address.
 */
async function signInWithEmailLink(page: Page, email: string): Promise<void> {
  const before = await countEmails(email);
  const response = await page.request.post('/api/auth/sign-in/magic-link', {
    headers: apiHeaders(),
    data: { email, callbackURL: '/dashboard' },
  });
  expect(response.ok()).toBe(true);
  await openSignInLink(page, linkIn(await waitForNewEmail(email, before)));
}

/**
 * Calls a Better Auth endpoint with the page's session.
 *
 * @param page - The browser page.
 * @param method - `GET` or `POST`.
 * @param path - The endpoint below `/api/auth`.
 * @param data - JSON body for `POST`.
 * @returns The status and error code, if any.
 */
async function callAuth(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  data: Record<string, unknown> = {},
): Promise<{ status: number; code: string | null }> {
  const response =
    method === 'GET'
      ? await page.request.get(`/api/auth${path}`, { headers: apiHeaders() })
      : await page.request.post(`/api/auth${path}`, { headers: apiHeaders(), data });
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return { status: response.status(), code: body?.code ?? null };
}

test('every response has the security headers, and none names the framework', async ({
  request,
}) => {
  const responses = await Promise.all(
    ['/auth', '/api/auth/error'].map((path) => request.get(path)),
  );
  responses.forEach((response) => {
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

test('page addresses ending like a file still get the policy, and static files a strict one', async ({
  request,
}) => {
  // Not skipped by their extension: these still go through the app (here, to sign in).
  const pages = await Promise.all(
    ['/companies/x.png', '/nope.png', '/invite/abc.xml', '/companies/favicon.ico'].map((path) =>
      request.get(path, { maxRedirects: 0 }),
    ),
  );
  pages.forEach((response) => {
    expect(response.headers()['content-security-policy']).toContain("'strict-dynamic'");
  });
  // The logos and icons: nothing in them may run, even opened directly.
  const strict = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  const logo = await request.get('/brand/logo.svg');
  expect(logo.headers()['content-security-policy']).toBe(strict);
  // The icon a browser or a tool asks for without reading the page: an icon also for someone
  // who isn't signed in, never the way to the sign-in page. Until a staff Admin uploads a logo
  // or an icon, that's Adiutor's own .ico.
  const toFavicon = await request.get('/favicon.ico', { maxRedirects: 0 });
  expect(toFavicon.status()).toBe(307);
  expect(toFavicon.headers().location).toBe('/brand/favicon.ico');
  const favicon = await request.get('/favicon.ico');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toBe('image/x-icon');
  expect(favicon.headers()['content-security-policy']).toBe(strict);
  // An .ico file starts with these four bytes, and says how many pictures it holds: three sizes.
  expect([...(await favicon.body()).subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
});

test('the brand’s images answer anyone with a file that runs nothing, or "not found"', async ({
  request,
}) => {
  // Nothing is uploaded in the shared database; the logo spec uploads and removes its own.
  for (const path of ['/branding/logo', '/branding/icon']) {
    // eslint-disable-next-line no-await-in-loop -- Two addresses, one after the other.
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers()['content-security-policy'], path).toBe("default-src 'none'; sandbox");
  }
});

test("only scripts with the request's nonce run", async ({ request, page, cspViolations }) => {
  // The production policy: a fresh nonce per response, no inline scripts or eval otherwise.
  const [first, second] = await Promise.all([request.get('/auth'), request.get('/auth')]);
  const policies = [first, second].map((response) =>
    defined(response.headers()['content-security-policy'], 'the Content-Security-Policy header'),
  );
  const nonces = policies.map((policy) => /'nonce-([^']+)'/.exec(policy)?.[1]);
  policies.forEach((policy, index) => {
    expect(policy).toContain(`script-src 'self' 'nonce-${nonces[index]}' 'strict-dynamic';`);
    expect(policy).toContain("script-src-attr 'none'");
  });
  expect(nonces[0]).not.toBe(nonces[1]);

  // Every script in the page carries it, so none is blocked.
  const html = await first.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  scripts.forEach((script) => expect(script).toContain(`nonce="${nonces[0]}"`));

  // An injected event-handler attribute (the usual injection payload) doesn't run.
  await page.goto('/auth');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img src="/no-such-image.png" onerror="document.title = \'injected\'">',
    );
  });
  await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
  expect(await page.title()).not.toBe('injected');
  expect(cspViolations.every((violation) => violation.includes('script-src-attr'))).toBe(true);
  // Expected here; the check after the test would fail on it otherwise.
  cspViolations.splice(0);
});

test("Better Auth endpoints the browser doesn't use are closed", async ({ page }) => {
  expect((await callAuth(page, 'POST', '/update-user', { name: 'x'.repeat(5000) })).status).toBe(
    404,
  );
  expect((await callAuth(page, 'GET', '/get-session')).status).toBe(404);
  expect((await callAuth(page, 'POST', '/two-factor/get-totp-uri')).status).toBe(404);
  expect((await callAuth(page, 'POST', '/get-access-token', { providerId: 'github' })).status).toBe(
    404,
  );
  expect((await callAuth(page, 'GET', '/list-sessions')).status).toBe(404);
  expect(
    (await callAuth(page, 'POST', '/send-verification-email', { email: 'x@adiutor.test' })).status,
  ).toBe(404);
});

test("a sign-in redirect can't lead to another site", async ({ page }) => {
  expect(
    await submitPassword(page, CLIENT_WATCHER, '/auth?callbackURL=/%09/evil.adiutor.test'),
  ).toBe('signed-in');
  await expect(page).toHaveURL(`${E2E_BASE_URL}/dashboard`);
});

test('with an authenticator app, email codes are refused at sign-in', async ({ page }) => {
  expect(await submitPassword(page, STEP_UP_CLIENT)).toBe('code-step');
  await expect(page.getByRole('button', { name: 'Email code' })).toHaveCount(0);
  expect(await callAuth(page, 'POST', '/two-factor/send-otp')).toEqual({
    status: 403,
    code: EMAIL_CODES_NOT_ALLOWED.code,
  });
});

test('a company user with MFA confirms it after an email link', async ({ page }) => {
  await signInWithEmailLink(page, STEP_UP_CLIENT.email);
  await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Fdashboard/);
  await expect(page.getByText('You turned on MFA')).toBeVisible();
  await confirmWithAuthenticator(page, STEP_UP_CLIENT.totpSecret);
  await expect(page).toHaveURL('/dashboard');
});

test('an email-link session gets only a few guesses at the authenticator code', async ({
  page,
}) => {
  await signInWithEmailLink(page, STEP_UP_CLIENT.email);
  await expect(page).toHaveURL(/\/auth\/verify/);
  const right = codeForSecret(STEP_UP_CLIENT.totpSecret);
  const wrong = right === '000000' ? '111111' : '000000';
  await repeatInOrder(5, async () => {
    expect((await callAuth(page, 'POST', '/two-factor/verify-totp', { code: wrong })).status).toBe(
      401,
    );
  });
  // Even the right code is refused now, for a while.
  expect(await callAuth(page, 'POST', '/two-factor/verify-totp', { code: right })).toEqual({
    status: 429,
    code: TOO_MANY_ATTEMPTS.code,
  });
});

test("a Manager's email-link session can't add a way in until it's confirmed", async ({ page }) => {
  await signInWithEmailLink(page, STEP_UP_MANAGER.email);
  await expect(page).toHaveURL(/\/auth\/verify/);
  // Only the authenticator app is offered, not email codes.
  await expect(page.getByText('Your role requires MFA')).toBeVisible();
  await expect(page.getByRole('button', { name: /email/i })).toHaveCount(0);

  expect(await callAuth(page, 'POST', '/two-factor/send-otp')).toEqual({
    status: 403,
    code: EMAIL_CODES_NOT_ALLOWED.code,
  });
  expect(await callAuth(page, 'GET', '/passkey/generate-register-options')).toEqual({
    status: 403,
    code: MFA_VERIFICATION_REQUIRED.code,
  });
  expect(await callAuth(page, 'POST', '/two-factor/generate-backup-codes', {})).toEqual({
    status: 403,
    code: MFA_VERIFICATION_REQUIRED.code,
  });
  expect(
    await callAuth(page, 'POST', '/link-social', { provider: 'github', callbackURL: '/account' }),
  ).toMatchObject({ status: 403 });

  // Confirmed with the authenticator app, adding a passkey is allowed.
  await confirmWithAuthenticator(page, STEP_UP_MANAGER.totpSecret);
  await expect(page).toHaveURL('/dashboard');
  expect((await callAuth(page, 'GET', '/passkey/generate-register-options')).status).toBe(200);
});

/**
 * Where the Security page sends the user to confirm before a change to how
 * they sign in from the Two-step verification card, which it comes back to.
 */
const CONFIRM_SIGN_IN_CHANGE_URL =
  '/auth/verify?callbackURL=%2Faccount%2Fsecurity%23two-step&for=change';

/**
 * Clicks a button until the page reacts. Right after a full page load the
 * click can come before React has hydrated the page, and right after a
 * client-side navigation the page can briefly still show its earlier
 * render. The button is only clicked while it's showing (not behind an open
 * dialog or on another page), so a click that worked isn't repeated.
 *
 * @param button - The button.
 * @param reacted - Passes once the page has reacted; fails until then.
 */
async function clickUntil(button: Locator, reacted: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (await button.isVisible()) {
      await button.click({ timeout: 2_000 });
    }
    await reacted();
  }).toPass({ timeout: 20_000 });
}

test('changing how you sign in needs a confirmation from the last 15 minutes', async ({ page }) => {
  await signIn(page, RECENT_MFA_CLIENT);
  await page.goto('/account/security');
  const newBackupCodes = page.getByRole('button', { name: 'New backup codes' });
  await expect(newBackupCodes).toBeVisible();

  // Signed in with the authenticator app 20 minutes ago: too long to change how they sign in.
  await backdateMfaConfirmation(RECENT_MFA_CLIENT.email, 20);
  expect(await callAuth(page, 'POST', '/two-factor/generate-backup-codes', {})).toEqual({
    status: 403,
    code: MFA_VERIFICATION_REQUIRED.code,
  });

  // Starting a change sends them to confirm first, instead of opening a dialog the server refuses.
  await page.reload();
  await clickUntil(newBackupCodes, () =>
    expect(page).toHaveURL(CONFIRM_SIGN_IN_CHANGE_URL, { timeout: 2_000 }),
  );
  await expect(page.getByText('This needs a confirmation from the last 15 minutes.')).toBeVisible();

  await confirmWithAuthenticator(page, RECENT_MFA_CLIENT.totpSecret);
  // Checking the code and rendering the Security page again can take a while in a busy suite.
  // Back on the card where they started, with focus on its heading.
  await expect(page).toHaveURL('/account/security#two-step', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeFocused();

  // Confirmed just now, the change goes ahead.
  const dialog = page.getByRole('dialog', { name: 'Get new backup codes?' });
  await clickUntil(newBackupCodes, () => expect(dialog).toBeVisible({ timeout: 2_000 }));
  await dialog.getByLabel('Current password').fill(RECENT_MFA_CLIENT.password);
  await dialog.getByRole('button', { name: 'Get new codes' }).click();
  await expect(page.getByRole('dialog', { name: 'Your new backup codes' })).toBeVisible();
});

test("a mail scanner opening a sign-in link doesn't sign in or use it up", async ({
  page,
  request,
}) => {
  const before = await countEmails(CLIENT_WATCHER.email);
  const response = await page.request.post('/api/auth/sign-in/magic-link', {
    headers: apiHeaders(),
    // As the sign-in form asks for it, so a used link comes back to the sign-in page.
    data: {
      email: CLIENT_WATCHER.email,
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth?callbackURL=%2Fdashboard',
    },
  });
  expect(response.ok()).toBe(true);
  const link = linkIn(await waitForNewEmail(CLIENT_WATCHER.email, before));
  expect(new URL(link).pathname).toBe('/auth/email-link');

  // A mail gateway checking the link: a plain GET, outside the user's browser. It gets the page,
  // not a redirect that signs in.
  const scan = await request.get(link, { maxRedirects: 0 });
  expect(scan.status()).toBe(200);
  expect(scan.headers()['set-cookie'] ?? '').not.toContain('session_token');
  // The page it gets has no form that would use the link: the token only goes in in a browser.
  expect(await scan.text()).not.toContain('name="token"');

  // Better Auth's own link, opened directly in a browser (from an old email, or crafted by someone
  // else), goes to the same page first instead of signing in.
  const direct = new URL(link);
  direct.pathname = '/api/auth/magic-link/verify';
  await page.goto(direct.toString());
  await expect(page).toHaveURL(/\/auth\/email-link\?token=/);
  await expect(page.getByRole('heading', { name: 'Continue signing in' })).toBeVisible();
  // It names the account the link signs in to (looked up without using it).
  await expect(page.getByText(CLIENT_WATCHER.name, { exact: true })).toBeVisible();
  await expect(page.getByText(CLIENT_WATCHER.email, { exact: true })).toBeVisible();

  // The user's click still works.
  await page.getByRole('button', { name: 'Continue signing in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Once used, the page says so straight away instead of offering to continue.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: "This link can't be used" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue signing in' })).toHaveCount(0);
});

/**
 * Reads the browser's session cookie.
 *
 * @param page - The browser page.
 * @returns Its value, as the browser keeps it.
 */
async function sessionCookieOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find(({ name }) =>
    name.endsWith('.session_token'),
  );
  if (!cookie) {
    throw new Error('The browser has no session cookie.');
  }
  return cookie.value;
}

test('a sign-in link says when it switches this browser from another account', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  const supportSession = await sessionCookieOf(page);

  // A link someone else sent for their own account: the page says whose it is and what continuing does.
  await page.goto(await storeSignInLink(CLIENT_WATCHER.email));
  await expect(page.getByRole('status')).toHaveText(
    `You're signed in as ${SUPPORT_STAFF.name} (${SUPPORT_STAFF.email}) in this browser. Continuing switches this browser to ${CLIENT_WATCHER.name} (${CLIENT_WATCHER.email}).`,
  );
  await page.getByRole('button', { name: 'Continue signing in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/account');
  await expect(page.locator('#main').getByText(CLIENT_WATCHER.email).first()).toBeVisible();
  // The other account's session in this browser ended, as if they had signed out.
  expect(await sessionOfCookieExists(supportSession)).toBe(false);

  // A link for the account that's signed in goes on without using it.
  const again = await storeSignInLink(CLIENT_WATCHER.email);
  await page.goto(again);
  await expect(page.getByRole('heading', { name: "You're already signed in" })).toBeVisible();
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(again);
  await expect(page.getByRole('heading', { name: "You're already signed in" })).toBeVisible();
});

test('a sign-in link that stopped working while another account is signed in says so on its own page', async ({
  page,
}) => {
  await signIn(page, SUPPORT_STAFF);
  const link = await storeSignInLink(CLIENT_WATCHER.email);
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Continue signing in' })).toBeVisible();

  // It expires, or is used in another browser, before the click.
  await useUpSignInLink(link);
  await page.getByRole('button', { name: 'Continue signing in' }).click();

  // Not the sign-in page, which would send the browser on to the account still signed in.
  await expect(page).toHaveURL(/\/auth\/email-link\?.*error=INVALID_TOKEN/);
  await expect(page.getByRole('heading', { name: "This link can't be used" })).toBeVisible();
  await page.goto('/account');
  await expect(page.locator('#main').getByText(SUPPORT_STAFF.email).first()).toBeVisible();
});

test("a sign-in link can't go on to another account's link", async ({ page }) => {
  // Someone's own link, and a genuine link for another user whose return addresses go on to it.
  const attackerLink = new URL(await storeSignInLink(CLIENT_WATCHER.email), E2E_BASE_URL);
  const chained = `/api/auth/magic-link/verify?${new URLSearchParams({
    token: attackerLink.searchParams.get('token') ?? '',
    callbackURL: '/dashboard',
  })}`;
  const victimLink = new URL(await storeSignInLink(SUPPORT_STAFF.email), E2E_BASE_URL);
  victimLink.searchParams.set('callbackURL', chained);
  victimLink.searchParams.set('errorCallbackURL', chained);

  // The page names the user's own account, so nothing looks wrong.
  await page.goto(`${victimLink.pathname}${victimLink.search}`);
  await expect(page.getByText(SUPPORT_STAFF.email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue signing in' }).click();

  // The page passes only pages of the app on, so the click signs the user in as themselves.
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/account');
  await expect(page.locator('#main').getByText(SUPPORT_STAFF.email).first()).toBeVisible();
  await expect(page.locator('#main').getByText(CLIENT_WATCHER.email)).toHaveCount(0);

  // The other link was never opened: it can still be used.
  await page.goto(`${attackerLink.pathname}${attackerLink.search}`);
  await expect(page.getByRole('button', { name: 'Continue signing in' })).toBeVisible();
});

test("sign-in, reset and magic-link don't reveal whether an email has an account", async ({
  page,
}) => {
  const absent = freshAddress('ghost');
  const probes: [string, Record<string, unknown>][] = [
    ['/sign-in/email', { password: 'definitely-wrong-password' }],
    ['/request-password-reset', { redirectTo: '/dashboard' }],
    ['/sign-in/magic-link', { callbackURL: '/dashboard' }],
  ];
  await inOrder(probes, async ([path, data]) => {
    const real = await callAuth(page, 'POST', path, { ...data, email: CLIENT_WATCHER.email });
    const fake = await callAuth(page, 'POST', path, { ...data, email: absent });
    expect(real, path).toEqual(fake);
  });
});

test("a role that requires MFA can't turn off its only method", async ({ page }) => {
  // The Manager's only method is the authenticator app (their earlier test asked for passkey
  // options but added none), and signing in with it confirms the session just now.
  await signIn(page, STEP_UP_MANAGER);
  await page.goto('/account/security');
  const twoStep = page.getByRole('region', { name: 'Two-step verification', exact: true });
  const turnOff = twoStep.getByRole('button', { name: 'Turn off', exact: true });
  await expect(twoStep.getByText('On', { exact: true })).toBeVisible();
  await expect(turnOff).toBeDisabled();
  await expect(
    twoStep.getByText(
      'Your role requires MFA, so your authenticator app stays on. To move it to a new phone, add a passkey first, then turn this off and set it up again.',
    ),
  ).toBeVisible();

  // The server refuses it too, even with the password (a page from before another change could
  // still offer it). The session was confirmed just now, so it's the role that stops it.
  expect(
    await callAuth(page, 'POST', '/two-factor/disable', { password: STEP_UP_MANAGER.password }),
  ).toEqual({ status: 403, code: MFA_REQUIRED_FOR_ROLE.code });

  await page.reload();
  await expect(twoStep.getByText('On', { exact: true })).toBeVisible();
  await expect(turnOff).toBeDisabled();
});

test('wrong passwords pause password sign-in for an address, and a password reset lifts it', async ({
  page,
}) => {
  const { email } = PAUSED_CLIENT;
  /**
   * Sends ten wrong passwords for an address, then tries once more.
   *
   * @param address - The address.
   * @param password - The password of the last try.
   * @returns How the last try was answered.
   */
  const pauseAndTry = async (address: string, password: string) => {
    await repeatInOrder(10, async () => {
      expect(
        (await callAuth(page, 'POST', '/sign-in/email', { email: address, password: 'wrong-1234' }))
          .status,
      ).toBe(401);
    });
    return callAuth(page, 'POST', '/sign-in/email', { email: address, password });
  };
  const emailsBefore = await countEmails(email);

  // Even the right password is refused now, the same way as for an address without an account.
  const paused = { status: 429, code: PASSWORD_SIGN_IN_PAUSED.code };
  expect(await pauseAndTry(email, PAUSED_CLIENT.password)).toEqual(paused);
  expect(await pauseAndTry('nobody.paused@adiutor.test', 'wrong-1234')).toEqual(paused);

  // The owner is told, without the browser or IP address of whoever typed them.
  const notice = await waitForNewEmail(email, emailsBefore);
  expect(notice.subject).toBe(`Password sign-in to your account on ${STAFF_NAME} is paused`);
  expect(notice.text).not.toContain('From:');

  // The sign-in page says what still works.
  await page.goto('/auth');
  await fillAndSubmitSignIn(page, { email, password: PAUSED_CLIENT.password });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Password sign-in for this address is paused' }),
  ).toContainText('Sign in with an email link or a passkey, or reset your password');

  // A completed password reset lifts the pause.
  const beforeReset = await countEmails(email);
  await page.goto('/auth/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.goto(linkIn(await waitForNewEmail(email, beforeReset)));
  const newPassword = 'e2e-paused-new-password';
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  await signIn(page, { email, password: newPassword });
});

// Must stay last: it locks this account's second factor for a while.
test('authenticator-code guessing at sign-in locks the account, across fresh attempts', async ({
  page,
}) => {
  const right = codeForSecret(STEP_UP_CLIENT.totpSecret);
  const wrong = right === '000000' ? '111111' : '000000';
  const emailsBefore = await countEmails(STEP_UP_CLIENT.email);
  let lockedAt: number | null = null;
  await repeatInOrder(11, async (index) => {
    // Each pass starts a fresh password sign-in, so a new two-factor cookie can't reset the count.
    await page.request.post('/api/auth/sign-in/email', {
      headers: apiHeaders(),
      data: { email: STEP_UP_CLIENT.email, password: STEP_UP_CLIENT.password },
    });
    const r = await callAuth(page, 'POST', '/two-factor/verify-totp', { code: wrong });
    if (r.status !== 401 && lockedAt === null) {
      lockedAt = index + 1;
    }
  });
  expect(lockedAt).not.toBeNull();
  // The owner is told, without the device or IP address that typed the codes (someone else's).
  const notice = await waitForNewEmail(STEP_UP_CLIENT.email, emailsBefore);
  expect(notice.subject).toBe(`Signing in to your account on ${STAFF_NAME} with a code is paused`);
  expect(notice.text).not.toContain('From:');
  // Even the correct code on a brand-new sign-in stays refused while locked.
  await page.request.post('/api/auth/sign-in/email', {
    headers: apiHeaders(),
    data: { email: STEP_UP_CLIENT.email, password: STEP_UP_CLIENT.password },
  });
  expect(await callAuth(page, 'POST', '/two-factor/verify-totp', { code: right })).toEqual({
    status: 429,
    code: 'ACCOUNT_TEMPORARILY_LOCKED',
  });
  // That the refusals while it lasts send no more notices is checked by the integration tests
  // (`auth-events/refused-attempts.int.test.ts`, `password-sign-in.int.test.ts`), which wait for the work done
  // after the response instead of a timer.
});

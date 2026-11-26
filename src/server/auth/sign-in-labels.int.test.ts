/**
 * @file Runs Better Auth's real authenticator setup (`auth.handler`, with the
 * app's hooks) against the test database: the new entry is labelled with
 * the staff's name and Adiutor's (decision 0050), and checking the current
 * password there still settles its attempt like every other current-password
 * check (a right one gives it back, a wrong one counts once), which needs the
 * hook to set the label on the request's own context.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  addPassword,
  createUser,
  rateLimitHits,
  saveSettings,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { wrongCurrentPasswordsKey } from './current-password';
import { newBrowser } from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
// Outside Next, `after` would throw; the work it gets isn't what these tests check.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  /** Drops Better Auth's background work. */
  after: () => {},
}));
vi.mock('../background', () => ({
  /** Drops the app's background work. */
  default: () => {},
}));

const { db } = setupTestContext();

/** The password the test user signs in with. */
const PASSWORD = 'adiutor-tests-password';

/**
 * Signs a new user with a password in, through Better Auth.
 *
 * @param email - Their address.
 * @returns Their ID and the browser holding their session.
 */
async function signedIn(email: string) {
  const id = await createUser(db, email);
  await addPassword(db, id, PASSWORD);
  const browser = newBrowser();
  const response = await browser.post('sign-in/email', { email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { id, browser };
}

describe('setting up an authenticator app through Better Auth', () => {
  it('labels the new entry with the staff’s name and Adiutor’s, and gives a right password’s attempt back', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests Support' });
    const { id, browser } = await signedIn('jane@adiutor.test');

    const response = await browser.post('two-factor/enable', { password: PASSWORD });

    expect(response.status).toBe(200);
    const { totpURI } = (await response.json()) as { totpURI: string };
    expect(new URL(totpURI).searchParams.get('issuer')).toBe('Adiutor Tests Support (Adiutor)');
    expect((await rateLimitHits(db, wrongCurrentPasswordsKey(id))) ?? 0).toBe(0);
  });

  it('counts a wrong current password once', async () => {
    const { id, browser } = await signedIn('jane@adiutor.test');

    const response = await browser.post('two-factor/enable', {
      password: 'adiutor-tests-wrong-password',
    });

    expect(response.ok).toBe(false);
    expect(await rateLimitHits(db, wrongCurrentPasswordsKey(id))).toBe(1);
  });
});

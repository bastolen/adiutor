/**
 * @file Integration tests for forgetting trusted devices.
 */
import { APIError, getOAuthState } from 'better-auth/api';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { sendEmail } from '@/lib/email';

import { afterAuthRequest } from './after-request';
import {
  db,
  trustDevice,
  githubCallback,
  withTrustedDevice,
  signedInHeaders,
  devicesLeft,
  TRUST_DEVICE_COOKIE,
  requestWithSession,
  events,
  subjects,
} from './test-helpers';
import { createSession, createUser } from '../../../../tests/integration/helpers';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../../tests/integration/app-modules')).default(await importOriginal()),
);

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

// The checks before a request read its session from Better Auth, and the reactions read the OAuth
// state (only there during a request); the tests hand both over.
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
  // No OAuth sign-in marked as a re-verify, unless a test marks one (`markReverify`).
  vi.mocked(getOAuthState).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  // Puts back the real `fetch` after tests that stand in for GitHub's API.
  vi.restoreAllMocks();
});

describe('forgetting trusted devices', () => {
  it('forgets the trusted device of a browser that signs out, and only that one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const thisBrowser = await trustDevice(jane, 'this-browser');
    const otherBrowser = await trustDevice(jane, 'other-browser');
    const samsDevice = await trustDevice(sam);
    const { ctx, setCookie } = githubCallback(
      withTrustedDevice(await signedInHeaders(await createSession(db, jane)), thisBrowser),
    );

    await afterAuthRequest({ ...ctx, path: '/sign-out' });

    // A copy of its cookie no longer skips the code step; Jane's other browser stays trusted.
    expect(await devicesLeft([thisBrowser, otherBrowser, samsDevice])).toEqual(
      [otherBrowser, samsDevice].sort(),
    );
    expect(setCookie).toHaveBeenCalledWith(
      TRUST_DEVICE_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  it('forgets nothing at sign-out for a trusted-device cookie whose signature doesn’t check out', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const device = await trustDevice(jane);
    const { ctx } = githubCallback(withTrustedDevice(new Headers(), device, 'not-the-secret'));

    await afterAuthRequest({ ...ctx, path: '/sign-out' });

    expect(await devicesLeft([device])).toEqual([device]);
  });

  it('forgets every device the user trusted after a password change, and no one else’s', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const janes = [await trustDevice(jane, 'laptop'), await trustDevice(jane, 'phone')];
    const samsDevice = await trustDevice(sam);
    const sessionId = await createSession(db, jane);

    await afterAuthRequest(
      await requestWithSession('/change-password', { sessionId, userId: jane }, { token: 'new' }),
    );

    expect(await devicesLeft([...janes, samsDevice])).toEqual([samsDevice]);
    expect((await events()).map(({ action }) => action)).toEqual(['password_changed']);
  });

  it('forgets nothing when the password change is refused', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const device = await trustDevice(jane);
    const sessionId = await createSession(db, jane);

    await afterAuthRequest(
      await requestWithSession(
        '/change-password',
        { sessionId, userId: jane },
        new APIError('BAD_REQUEST', { message: 'Invalid password', code: 'INVALID_PASSWORD' }),
      ),
    );

    expect(await devicesLeft([device])).toEqual([device]);
    expect(await events()).toEqual([]);
  });

  describe.each([
    {
      path: '/two-factor/disable',
      action: 'two_factor_disabled',
      subject: 'Two-step verification was turned off on your Adiutor account',
      // An earlier "Trust this device" mustn't skip the code step once it's turned back on.
      forgetsDevices: true,
    },
    {
      path: '/two-factor/generate-backup-codes',
      action: 'backup_codes_regenerated',
      subject: 'New backup codes for your Adiutor account',
      forgetsDevices: false,
    },
    {
      path: '/passkey/delete-passkey',
      action: 'passkey_removed',
      subject: 'A passkey was removed from your Adiutor account',
      forgetsDevices: false,
    },
  ])('after $path', ({ path, action, subject, forgetsDevices }) => {
    it(`records ${action} and sends the notice${forgetsDevices ? ', forgetting the user’s trusted devices' : ''}`, async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const sam = await createUser(db, 'sam@adiutor.test');
      const janesDevice = await trustDevice(jane);
      const samsDevice = await trustDevice(sam);
      const sessionId = await createSession(db, jane);

      await afterAuthRequest(await requestWithSession(path, { sessionId, userId: jane }));

      expect(await devicesLeft([janesDevice, samsDevice])).toEqual(
        forgetsDevices ? [samsDevice] : [janesDevice, samsDevice].sort(),
      );
      expect(await events()).toEqual([
        { action, actorUserId: jane, targetUserId: jane, details: {} },
      ]);
      expect(subjects()).toEqual([subject]);
    });

    it('does nothing when the request was refused', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const device = await trustDevice(jane);
      const sessionId = await createSession(db, jane);

      await afterAuthRequest(
        await requestWithSession(
          path,
          { sessionId, userId: jane },
          new APIError('BAD_REQUEST', { message: 'Refused', code: 'REFUSED' }),
        ),
      );

      expect(await devicesLeft([device])).toEqual([device]);
      expect(await events()).toEqual([]);
      expect(subjects()).toEqual([]);
    });
  });
});

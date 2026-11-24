/**
 * @file Integration tests for the checks on signed-in requests: the order of the
 * MFA checks, the recent sign-in needed without a second step, changes
 * that would take away the MFA a role requires, and turning two-step
 * verification and backup codes on or off.
 */
import { getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { account } from '@/db/schema';

import {
  addPasskey,
  addPassword,
  connectGitHub,
  connectProvider,
  createCompany,
  createUser,
  enableTwoFactor,
  inSequence,
  memberActor,
  staffActor,
  startAuthenticatorSetup,
  turnOffGitHubSignIn,
  minutesAgo,
} from '../../../../tests/integration/helpers';
import { beforeAuthRequest } from './before-request';
import {
  outcomeOf,
  db,
  signedIn,
  request,
  refusedWith,
  hits,
  sendCodesOverTime,
} from './test-helpers';

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

/**
 * Sends several requests with the current session, one after another.
 *
 * @param paths - The endpoint paths.
 * @returns How the checks answered each (see {@link outcomeOf}), in order.
 */
async function outcomesOf(paths: readonly string[]): Promise<string[]> {
  return inSequence(paths, outcomeOf);
}

describe('changing sign-in methods', () => {
  it('needs a session confirmed with MFA once the account has MFA', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const newcomer = await createUser(db, 'newcomer@adiutor.test');

    await signedIn(support.id);
    await expect(beforeAuthRequest(request('/passkey/generate-register-options'))).rejects.toEqual(
      refusedWith('MFA_VERIFICATION_REQUIRED'),
    );

    await signedIn(support.id, { verifiedWith: 'authenticator' });
    await expect(
      beforeAuthRequest(request('/passkey/generate-register-options')),
    ).resolves.toBeUndefined();

    await signedIn(newcomer);
    await expect(
      beforeAuthRequest(request('/passkey/generate-register-options')),
    ).resolves.toBeUndefined();
  });

  it('asks for a confirmed session before refusing email codes as a new method', async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);

    await signedIn(manager.id);
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('MFA_VERIFICATION_REQUIRED'),
    );

    await signedIn(manager.id, { verifiedWith: 'passkey' });
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
    // Setting up isn't counted towards the email code limit.
    expect(await hits(`email-code:user:${manager.id}`)).toBeNull();
  });

  it('lets a company user without MFA set up email codes without counting, once per wait', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await signedIn(newcomer);
    const sendCode = request('/two-factor/send-otp');

    await beforeAuthRequest(sendCode);
    await expect(beforeAuthRequest(sendCode)).rejects.toEqual(
      refusedWith('EMAIL_CODE_SENT_RECENTLY'),
    );
    await sendCodesOverTime(6, sendCode);
    expect(await hits(`email-code:user:${newcomer}`)).toBeNull();
  });
});

describe('a recent confirmation', () => {
  /** Requests that change sign-in methods, other than renaming a passkey. */
  const CHANGES = [
    '/passkey/generate-register-options',
    '/passkey/verify-registration',
    '/passkey/delete-passkey',
    '/link-social',
    '/unlink-account',
    '/two-factor/enable',
    '/two-factor/disable',
    '/two-factor/generate-backup-codes',
  ];

  it('lets a session change sign-in methods for 15 minutes after its confirmation', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await signedIn(support.id, { verifiedWith: 'authenticator', verifiedAt: minutesAgo(14) });
    expect(await outcomesOf(CHANGES)).toEqual(CHANGES.map(() => 'allowed'));

    await signedIn(support.id, { verifiedWith: 'authenticator', verifiedAt: minutesAgo(16) });
    expect(await outcomesOf(CHANGES)).toEqual(CHANGES.map(() => 'MFA_VERIFICATION_REQUIRED'));
  });

  it('is needed for the code steps that turn on two-step verification next to a passkey', async () => {
    const support = await staffActor(db, 'support');
    await addPasskey(db, support.id);
    const setUp = ['/two-factor/send-otp', '/two-factor/verify-otp', '/two-factor/verify-totp'];

    await signedIn(support.id, { verifiedWith: 'passkey', verifiedAt: minutesAgo(16) });
    expect(await outcomesOf(setUp)).toEqual(setUp.map(() => 'MFA_VERIFICATION_REQUIRED'));

    await signedIn(support.id, { verifiedWith: 'passkey' });
    expect(await outcomesOf(setUp)).toEqual(setUp.map(() => 'allowed'));
  });

  it("isn't given by a trusted device, which proved nothing at its sign-in", async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    // Even with a time stored for it (`markSessionVerified` stores none).
    await signedIn(support.id, { verifiedWith: 'trusted_device', verifiedAt: new Date() });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('is not needed to rename a passkey, but a confirmed session is', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await addPasskey(db, support.id);

    await signedIn(support.id, { verifiedWith: 'authenticator', verifiedAt: minutesAgo(8 * 60) });
    expect(await outcomesOf(['/passkey/update-passkey', '/passkey/delete-passkey'])).toEqual([
      'allowed',
      'MFA_VERIFICATION_REQUIRED',
    ]);

    await signedIn(support.id);
    expect(await outcomeOf('/passkey/update-passkey')).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('is not needed to add a first second step, even for a role that requires MFA', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await addPassword(db, newcomer);
    const testCompany = await createCompany(db);
    const owner = await memberActor(db, testCompany.id, 'admin');
    const firstSteps = [
      '/passkey/generate-register-options',
      '/passkey/verify-registration',
      '/link-social',
      '/two-factor/enable',
      '/two-factor/verify-totp',
    ];

    await signedIn(newcomer);
    expect(await outcomesOf([...firstSteps, '/two-factor/send-otp'])).toEqual([
      ...firstSteps.map(() => 'allowed'),
      'allowed',
    ]);

    await signedIn(owner.id);
    expect(await outcomesOf([...firstSteps, '/two-factor/send-otp'])).toEqual([
      ...firstSteps.map(() => 'allowed'),
      // Email codes don't count for company Admins.
      'EMAIL_CODES_NOT_ALLOWED',
    ]);
  });
});

describe("a second step that doesn't count as MFA", () => {
  it('still has to confirm an Admin before adding a method, after a reset set a password', async () => {
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);
    // What a password reset does to an account without a password.
    await addPassword(db, admin.id);

    await signedIn(admin.id);
    await expect(beforeAuthRequest(request('/passkey/generate-register-options'))).rejects.toEqual(
      refusedWith('MFA_VERIFICATION_REQUIRED'),
    );
    await expect(beforeAuthRequest(request('/two-factor/enable'))).rejects.toEqual(
      refusedWith('MFA_VERIFICATION_REQUIRED'),
    );

    await signedIn(admin.id, { verifiedWith: 'github' });
    await expect(
      beforeAuthRequest(request('/passkey/generate-register-options')),
    ).resolves.toBeUndefined();
  });

  it("can't be disconnected from a session that wasn't confirmed with it", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHub(db, jane);
    await addPassword(db, jane);
    await signedIn(jane);
    await expect(beforeAuthRequest(request('/unlink-account'))).rejects.toEqual(
      refusedWith('MFA_VERIFICATION_REQUIRED'),
    );

    // Without any second step, nothing changes.
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await connectGitHub(db, newcomer, false);
    await signedIn(newcomer);
    await expect(beforeAuthRequest(request('/unlink-account'))).resolves.toBeUndefined();
  });
});

describe('a confirmation with GitHub', () => {
  /** Sign-in changes that need a recent confirmation. */
  const CHANGES = [
    '/passkey/generate-register-options',
    '/passkey/delete-passkey',
    '/link-social',
    '/two-factor/enable',
    '/two-factor/generate-backup-codes',
  ];

  it('allows no sign-in change next to a passkey or an authenticator app, though the session counts', async () => {
    const withPasskey = await staffActor(db, 'platform_admin');
    await connectGitHub(db, withPasskey.id);
    await addPasskey(db, withPasskey.id);

    // E.g. GitHub on a browser signed in there, which didn't ask for its 2FA again.
    await signedIn(withPasskey.id, { verifiedWith: 'github' });
    expect(await outcomesOf(CHANGES)).toEqual(CHANGES.map(() => 'MFA_VERIFICATION_REQUIRED'));
    // Renaming only needs a confirmed session, which it is.
    expect(await outcomeOf('/passkey/update-passkey')).toBe('allowed');

    // The passkey opens the window.
    await signedIn(withPasskey.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('allowed');

    const withApp = await staffActor(db, 'support');
    await connectGitHub(db, withApp.id);
    await enableTwoFactor(db, withApp.id);
    await signedIn(withApp.id, { verifiedWith: 'github' });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('allows sign-in changes for 15 minutes when GitHub is the only strong step', async () => {
    const testCompany = await createCompany(db);
    const owner = await memberActor(db, testCompany.id, 'admin');
    await connectGitHub(db, owner.id);
    // Email codes next to it aren't stronger (and don't count for a company Admin anyway).
    const client = await memberActor(db, testCompany.id, 'client');
    await connectGitHub(db, client.id);
    await enableTwoFactor(db, client.id, 'email');

    await signedIn(owner.id, { verifiedWith: 'github' });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('allowed');
    await signedIn(client.id, { verifiedWith: 'github' });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('allowed');

    await signedIn(owner.id, { verifiedWith: 'github', verifiedAt: minutesAgo(16) });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('MFA_VERIFICATION_REQUIRED');
  });
});

describe('keeping the MFA a role requires', () => {
  /**
   * Expected answers to {@link providerChanges}: all the same.
   *
   * @param outcome - `allowed`, or the refusal's error code.
   * @returns That answer for each of the two changes.
   */
  const all = (outcome: string) => [outcome, outcome];

  /**
   * Sends the changes that can take provider MFA away (GitHub with 2FA and no
   * password) through the checks: disconnecting a GitHub account and
   * connecting Google. (A first password is checked by `setFirstPassword`.)
   *
   * @param githubId - The GitHub account's row ID.
   * @returns How the checks answered each, in that order.
   */
  const providerChanges = async (githubId: string) =>
    inSequence(
      [
        ['/unlink-account', { accountId: githubId }],
        ['/link-social', { provider: 'google' }],
      ] as const,
      ([path, body]) => outcomeOf(path, body),
    );

  it("refuses removing a Manager's only passkey when nothing else counts", async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_REQUIRED_FOR_ROLE');

    // Email codes don't count for a Manager, so they don't help.
    await enableTwoFactor(db, manager.id, 'email');
    await signedIn(manager.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_REQUIRED_FOR_ROLE');

    // A second passkey does.
    await addPasskey(db, manager.id);
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
  });

  it('lets a Manager remove their only passkey next to an authenticator app', async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);
    await enableTwoFactor(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');
  });

  it('refuses turning off two-step verification when the authenticator app is all that counts', async () => {
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'authenticator' });
    expect(await outcomeOf('/two-factor/disable')).toBe('MFA_REQUIRED_FOR_ROLE');

    await addPasskey(db, manager.id);
    expect(await outcomeOf('/two-factor/disable')).toBe('allowed');
  });

  it('refuses changes that stop GitHub with 2FA counting for a company Admin', async () => {
    const testCompany = await createCompany(db);
    const owner = await memberActor(db, testCompany.id, 'admin');
    const github = await connectGitHub(db, owner.id);
    await signedIn(owner.id, { verifiedWith: 'github' });
    expect(await providerChanges(github)).toEqual(all('MFA_REQUIRED_FOR_ROLE'));

    // With a passkey, the passkey confirms changes (GitHub no longer opens the window).
    await addPasskey(db, owner.id);
    await signedIn(owner.id, { verifiedWith: 'passkey' });
    expect(await providerChanges(github)).toEqual(all('allowed'));
  });

  it("lets a company Admin with only GitHub change things while GitHub sign-in is off: it isn't MFA then", async () => {
    turnOffGitHubSignIn();
    const testCompany = await createCompany(db);
    const owner = await memberActor(db, testCompany.id, 'admin');
    const github = await connectGitHub(db, owner.id);
    // E.g. signed in with an email link just now: GitHub can't confirm the session, and its 2FA
    // isn't MFA to keep, so the Admin can add a first method.
    await signedIn(owner.id);
    expect(await providerChanges(github)).toEqual(all('allowed'));
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('allowed');
  });

  it('lets a Manager disconnect one of two GitHub accounts with 2FA, but not the last', async () => {
    const manager = await staffActor(db, 'manager');
    const work = await connectGitHub(db, manager.id);
    const personal = await connectGitHub(db, manager.id);
    await signedIn(manager.id, { verifiedWith: 'github' });
    expect(await outcomeOf('/unlink-account', { accountId: personal })).toBe('allowed');

    await db.delete(account).where(eq(account.id, personal));
    expect(await outcomeOf('/unlink-account', { accountId: work })).toBe('MFA_REQUIRED_FOR_ROLE');
  });

  it("lets a Manager disconnect a provider account that doesn't count yet", async () => {
    const manager = await staffActor(db, 'manager');
    const github = await connectGitHub(db, manager.id);
    // Connected at sign-in and not confirmed: it isn't part of the account's MFA either way.
    const google = await connectProvider(db, manager.id, {
      providerId: 'google',
      mfaVerified: false,
      confirmed: false,
    });
    await signedIn(manager.id, { verifiedWith: 'github' });

    expect(await outcomeOf('/unlink-account', { accountId: google })).toBe('allowed');
    expect(await outcomeOf('/unlink-account', { accountId: github })).toBe('MFA_REQUIRED_FOR_ROLE');
  });

  it("lets roles that don't require MFA remove their only method", async () => {
    const withPasskey = await staffActor(db, 'support');
    await addPasskey(db, withPasskey.id);
    await signedIn(withPasskey.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('allowed');

    const withApp = await staffActor(db, 'support');
    await enableTwoFactor(db, withApp.id);
    await signedIn(withApp.id, { verifiedWith: 'authenticator' });
    expect(await outcomeOf('/two-factor/disable')).toBe('allowed');

    const testCompany = await createCompany(db);
    const client = await memberActor(db, testCompany.id, 'client');
    const github = await connectGitHub(db, client.id);
    await signedIn(client.id, { verifiedWith: 'github' });
    expect(await providerChanges(github)).toEqual(all('allowed'));
  });

  it('lets a Manager without MFA yet change things: there is nothing to keep', async () => {
    // Email codes don't count as a Manager's MFA, so turning them off takes nothing away.
    const withEmailCodes = await staffActor(db, 'manager');
    await enableTwoFactor(db, withEmailCodes.id, 'email');
    await signedIn(withEmailCodes.id);
    expect(await outcomeOf('/two-factor/disable')).toBe('allowed');

    // Nor does GitHub without 2FA.
    const withGitHub = await staffActor(db, 'manager');
    const github = await connectGitHub(db, withGitHub.id, false);
    await signedIn(withGitHub.id);
    expect(await providerChanges(github)).toEqual(all('allowed'));
  });

  it('asks a session to confirm first, before telling it the change is refused', async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);

    await signedIn(manager.id);
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_VERIFICATION_REQUIRED');
    await signedIn(manager.id, { verifiedWith: 'passkey', verifiedAt: minutesAgo(16) });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_VERIFICATION_REQUIRED');

    await signedIn(manager.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/passkey/delete-passkey')).toBe('MFA_REQUIRED_FOR_ROLE');
  });
});

describe('turning on two-step verification', () => {
  it('takes only an authenticator app through `/two-factor/enable`; email codes need their code', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await signedIn(newcomer);
    /**
     * Asks to turn it on with a method.
     *
     * @param body - The request body.
     * @returns The request.
     */
    const enable = (body: Record<string, unknown>) => ({ ...request('/two-factor/enable'), body });

    await expect(beforeAuthRequest(enable({ method: 'otp' }))).rejects.toEqual(
      refusedWith('TWO_FACTOR_METHOD_NOT_ALLOWED'),
    );
    await expect(beforeAuthRequest(enable({ method: 'totp' }))).resolves.toBeUndefined();
    await expect(beforeAuthRequest(enable({}))).resolves.toBeUndefined();
  });
});

describe('turning off two-step verification', () => {
  it("is refused while it's off already, giving the lock back, and allowed once it's on", async () => {
    // Better Auth would still replace (and so renew) the session, and send a false notice.
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await signedIn(newcomer);

    // Twice: the first refusal gave the user's lock back.
    expect(await outcomesOf(['/two-factor/disable', '/two-factor/disable'])).toEqual([
      'TWO_FACTOR_ALREADY_OFF',
      'TWO_FACTOR_ALREADY_OFF',
    ]);

    await enableTwoFactor(db, newcomer, 'email');
    await signedIn(newcomer, { verifiedWith: 'email_code' });
    expect(await outcomeOf('/two-factor/disable')).toBe('allowed');
  });

  it('asks a session to confirm first, before telling it that it is off', async () => {
    const support = await staffActor(db, 'support');
    await addPasskey(db, support.id);

    await signedIn(support.id);
    expect(await outcomeOf('/two-factor/disable')).toBe('MFA_VERIFICATION_REQUIRED');

    await signedIn(support.id, { verifiedWith: 'passkey' });
    expect(await outcomeOf('/two-factor/disable')).toBe('TWO_FACTOR_ALREADY_OFF');
  });

  it('asks an old session without a second step to sign in again first', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');

    await signedIn(newcomer, { signedInAt: minutesAgo(61) });
    expect(await outcomeOf('/two-factor/disable')).toBe('SESSION_NOT_FRESH');
  });
});

describe('a sign-in from the last hour', () => {
  /** Sign-in changes on an account without a second step (two-step verification off). */
  const FRESH = [
    '/passkey/generate-register-options',
    '/passkey/verify-registration',
    '/unlink-account',
    '/link-social',
    '/two-factor/enable',
    '/two-factor/send-otp',
    '/two-factor/verify-totp',
    '/two-factor/verify-otp',
  ];

  it('is needed for any sign-in change without a second step', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await connectGitHub(db, newcomer, false);

    await signedIn(newcomer, { signedInAt: minutesAgo(61) });
    expect(await outcomesOf(FRESH)).toEqual(FRESH.map(() => 'SESSION_NOT_FRESH'));

    await signedIn(newcomer, { signedInAt: minutesAgo(59) });
    expect(await outcomesOf(FRESH)).toEqual(FRESH.map(() => 'allowed'));
  });

  it('is not needed with a recent confirmation, however long ago the sign-in was', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await signedIn(support.id, { verifiedWith: 'authenticator', signedInAt: minutesAgo(3 * 60) });
    // Email codes aren't accepted next to an authenticator app at all (tested elsewhere).
    const changes = FRESH.filter((path) => !path.endsWith('-otp'));
    expect(await outcomesOf(changes)).toEqual(changes.map(() => 'allowed'));
  });
});

describe('a session the link in an email about a request started', () => {
  it('asks for a confirmation straight away, though it signed in just now', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await addPasskey(db, support.id);

    await signedIn(support.id, { fromRequestLink: true });
    expect(
      await outcomesOf([
        '/passkey/generate-register-options',
        '/passkey/update-passkey',
        '/two-factor/disable',
        '/two-factor/generate-backup-codes',
      ]),
    ).toEqual([
      'MFA_VERIFICATION_REQUIRED',
      'MFA_VERIFICATION_REQUIRED',
      'MFA_VERIFICATION_REQUIRED',
      'MFA_VERIFICATION_REQUIRED',
    ]);
  });

  it('asks for the same from a role that requires MFA', async () => {
    const manager = await staffActor(db, 'manager');
    await addPasskey(db, manager.id);

    await signedIn(manager.id, { fromRequestLink: true });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('MFA_VERIFICATION_REQUIRED');
  });

  it('never counts as a fresh sign-in on an account without a second step', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await connectGitHub(db, newcomer, false);

    await signedIn(newcomer, { fromRequestLink: true });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('SESSION_NOT_FRESH');
    expect(await outcomeOf('/two-factor/enable')).toBe('SESSION_NOT_FRESH');
  });

  it('allows the change once it was confirmed with a second step', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await signedIn(support.id, { fromRequestLink: true, verifiedWith: 'authenticator' });
    expect(await outcomeOf('/passkey/generate-register-options')).toBe('allowed');
  });
});

describe('finishing an authenticator app setup next to email codes', () => {
  it('needs a recent confirmation, like adding any other sign-in method', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    await startAuthenticatorSetup(db, support.id);

    await signedIn(support.id);
    expect(await outcomeOf('/two-factor/verify-totp')).toBe('MFA_VERIFICATION_REQUIRED');
    await signedIn(support.id, { verifiedWith: 'email_code', verifiedAt: minutesAgo(16) });
    expect(await outcomeOf('/two-factor/verify-totp')).toBe('MFA_VERIFICATION_REQUIRED');

    await signedIn(support.id, { verifiedWith: 'email_code' });
    expect(await outcomeOf('/two-factor/verify-totp')).toBe('allowed');
  });

  it('is not what an authenticator code does once the app is set up: that confirms the session', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await signedIn(support.id);
    expect(await outcomeOf('/two-factor/verify-totp')).toBe('allowed');
  });
});

describe('backup codes', () => {
  it("are refused while the authenticator app they belong to isn't set up", async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    await startAuthenticatorSetup(db, support.id);

    // Even from a session confirmed just now.
    await signedIn(support.id, { verifiedWith: 'email_code' });
    expect(await outcomeOf('/two-factor/verify-backup-code')).toBe('INVALID_BACKUP_CODE');

    // And to finish a password sign-in.
    vi.mocked(getSessionFromCtx).mockResolvedValue(null);
    await expect(
      beforeAuthRequest(request('/two-factor/verify-backup-code', { pendingUserId: support.id })),
    ).rejects.toEqual(refusedWith('INVALID_BACKUP_CODE'));
  });

  it('are left to Better Auth once the authenticator app is set up', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await signedIn(support.id);
    expect(await outcomeOf('/two-factor/verify-backup-code')).toBe('allowed');

    vi.mocked(getSessionFromCtx).mockResolvedValue(null);
    await expect(
      beforeAuthRequest(request('/two-factor/verify-backup-code', { pendingUserId: support.id })),
    ).resolves.toBeUndefined();
  });
});

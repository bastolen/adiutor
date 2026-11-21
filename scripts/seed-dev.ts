/**
 * @file Empties the local development database and fills it with test data
 * covering every role, company state and sign-in setup, for trying out
 * sign-in, MFA, permissions and invitations by hand.
 *
 * Usage: `pnpm db:seed --yes [--admin-mail <your address>]` (asks for `--yes`
 * because it deletes all data). `--admin-mail` adds a staff Admin with your
 * own address and no password, so you can sign in with an email link or with
 * a GitHub or Google account that has that address verified.
 * It reads the same configuration as the app (`.env`, validated by
 * `src/lib/env.ts`, so a missing or invalid variable stops it before anything
 * is written) and refuses to run (`src/lib/dev-seed-guard.ts`) with
 * `NODE_ENV=production`, with a `BETTER_AUTH_URL` that isn't on this computer
 * (`localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name: a server's `.env`
 * often has no `NODE_ENV`, but never a local app address), against a
 * database on another computer or against a `_test` database. Sign in at
 * `/auth`; emails arrive in Mailpit (http://localhost:8025).
 *
 * Accounts (all test values for local development only):
 *
 * | Email | Name | Where and role | Sign-in | MFA |
 * | --- | --- | --- | --- | --- |
 * | your `--admin-mail` address (optional) | from the address, e.g. "Bas" for `bas@…` | Staff: Admin | email link, GitHub/Google (verified email) | none yet, so the Security page asks for it |
 * | `admin@adiutor.test` | Alex Admin | Staff: Admin | password | authenticator app (setup key and backup codes printed) |
 * | `manager@adiutor.test` | Morgan Manager | Staff: Manager | password | authenticator app (setup key printed) |
 * | `manager.email@adiutor.test` | Mel Manager | Staff: Manager | password | email codes only, which don't count for Managers, so the Security page asks for more |
 * | `manager.nomfa@adiutor.test` | Max Manager | Staff: Manager | password | none, so the Security page asks for it |
 * | `finance@adiutor.test` | Frankie Finance | Staff: Finance | password | none (recommended) |
 * | `support@adiutor.test` | Sam Support | Staff: Support, and Client in Alpha | password | none |
 * | `alpha.admin@adiutor.test` | Avery Alpha | Alpha: Admin | password | authenticator app (setup key printed), as company Admins need MFA |
 * | `alpha.client@adiutor.test` | Casey Client | Alpha: Client | password | email codes |
 * | `alpha.watcher@adiutor.test` | Wren Watcher | Alpha: Watcher | password | none |
 * | `multi@adiutor.test` | Mika Multi | Alpha: Watcher, Beta: Admin | password | none, so as Beta's Admin the Security page asks for it |
 * | `beta.admin@adiutor.test` | Blake Beta | Beta: Admin | email link only (no password) | none, so the Security page asks for it |
 * | `beta.client@adiutor.test` | Unverified Uma | Beta: Client | password, email not verified | none |
 * | `gamma.admin@adiutor.test` | Gale Gamma | Gamma (deactivated): Admin | password | none (not required: the company is deactivated) |
 * | `gamma.client@adiutor.test` | Gus Gamma | Gamma (deactivated): Client | password | none |
 * | `drifter@adiutor.test` | Dana Drifter | no company | password | none |
 * | `github.admin@adiutor.test` | Gita GitHub | Staff: Admin | GitHub only (no password; username `gita-github`), GitHub 2FA on | provider MFA while GitHub sign-in is configured (`GITHUB_CLIENT_ID`/`SECRET`), otherwise "Needs MFA" and a dashboard warning for staff Admins (can't really sign in without that GitHub account) |
 * | `former@adiutor.test` | Fran Former | Alpha: Client | password, account deactivated | none |
 *
 * Every password is {@link PASSWORD}. Staff is named "Adiutor Tests"
 * (staff have a platform role on their account), with an open staff
 * invitation and a staff invite link. Companies: "Adiutor Tests Alpha", "Adiutor Tests Beta", "Adiutor Tests Gamma"
 * (deactivated) and "Adiutor Tests Delta" (just added: no members yet, only an
 * open invitation for its Admin). Alpha also has open, expired and revoked
 * invitations (one due for its expiry reminder, see `pnpm jobs:run`), and
 * active, used, expired and revoked invite links. The open invitations are
 * emailed for real (to Mailpit with the default `SMTP_URL`), and the links
 * that can still be used are printed at the end. Users have varied "last
 * active" times, the audit log has some sample events, and Logs → Errors
 * has sample errors from the last few days (`scripts/sample-errors.ts`).
 * Alpha, Beta and Gamma have sample requests in every status, with replies
 * and changes from both sides (`scripts/sample-requests.ts`).
 */
import { parseArgs } from 'node:util';

import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { type InvitationEmailProps, invitationEmail } from '../src/emails/invitation';
import type { CompanyRole, PlatformRole, Role } from '../src/lib/authz/roles';
import { firstRow } from '../src/lib/defined';
import devSeedRefusal from '../src/lib/dev-seed-guard';
import { sendEmail } from '../src/lib/email';
import { appUrl, env } from '../src/lib/env';
import { DEFAULT_LOCALE } from '../src/lib/i18n/locales';
import { INVITATION_VALID_DAYS } from '../src/lib/invitation-lifetimes';
import { installLogRedaction } from '../src/lib/log-redaction';
import { encryptionKey, parseAuthSecrets } from '../src/lib/sign-in/auth-secrets';
import { generateToken, hashToken } from '../src/lib/sign-in/tokens';
import { emailSchema } from '../src/lib/validation';
import emptyDatabase from '../tests/database/empty-database';
import storeRequests from '../tests/database/store-requests';
import { sampleErrors } from './sample-errors';
import sampleRequests from './sample-requests';

/** Password of every seeded account that has one (local test value). */
const PASSWORD = 'adiutor-test-password';

/** Raw authenticator secret of `admin@adiutor.test` (stored encrypted, as Better Auth does). */
const ADMIN_TOTP_SECRET = 'adiutor-dev-admin-totp-secret-01';

/** Raw authenticator secret of `manager@adiutor.test`. */
const MANAGER_TOTP_SECRET = 'adiutor-dev-manager-totp-secret1';

/** Raw authenticator secret of `alpha.admin@adiutor.test` (company Admins need MFA too). */
const ALPHA_ADMIN_TOTP_SECRET = 'adiutor-dev-alpha-admin-totp-123';

/** Backup codes of `admin@adiutor.test`; each works once. */
const ADMIN_BACKUP_CODES = ['ADIUT-00001', 'ADIUT-00002', 'ADIUT-00003', 'ADIUT-00004'];

/** Characters of RFC 4648 base32, for the authenticator setup key. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** One day in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

/** The staff name in the seeded data. */
const STAFF_NAME = 'Adiutor Tests';

/**
 * Adiutor's default time zone in the dev data, and the zone of every seeded
 * account except the developer's own Admin, whose browser saves theirs on
 * their first visit, as it would for anyone new.
 */
const DEV_TIME_ZONE = 'Europe/Amsterdam';

/** The domain of the seeded test accounts, which `--admin-mail` can't use. */
const TEST_DOMAIN = '@adiutor.test';

/**
 * Makes a display name from an email address: its local part, capitalised.
 *
 * @param email - The address, e.g. `bas@adiutor.dev`.
 * @returns The name, e.g. "Bas".
 */
function nameFromEmail(email: string): string {
  const local = email.slice(0, email.indexOf('@'));
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Encodes text as base32 without padding, the setup key format
 * authenticator apps accept.
 *
 * @param text - The raw secret.
 * @returns The setup key, grouped in fours.
 */
function toSetupKey(text: string): string {
  const bits = [...Buffer.from(text, 'utf8')]
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join('');
  const chars = (bits.match(/.{1,5}/g) ?? []).map(
    (chunk) => BASE32_ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)],
  );
  return chars
    .join('')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/**
 * A date relative to now.
 *
 * @param days - Days from now (negative for the past).
 * @returns The date.
 */
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/**
 * Seeds the database.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      yes: { type: 'boolean', default: false },
      'admin-mail': { type: 'string' },
    },
  });
  const databaseUrl = new URL(env.DATABASE_URL);

  // Every check runs before anything is written.
  const refusal = devSeedRefusal({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    authUrl: env.BETTER_AUTH_URL,
  });
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  let adminMail: string | null = null;
  if (values['admin-mail'] !== undefined) {
    const parsed = emailSchema.safeParse(values['admin-mail']);
    if (!parsed.success) {
      console.error('--admin-mail needs a valid email address, e.g. --admin-mail you@adiutor.dev.');
      return 1;
    }
    if (parsed.data.endsWith(TEST_DOMAIN)) {
      console.error(
        `--admin-mail is for your own address; ${TEST_DOMAIN} addresses belong to the seeded accounts.`,
      );
      return 1;
    }
    adminMail = parsed.data;
  }
  if (!values.yes) {
    console.error(
      `This deletes ALL data in ${databaseUrl.pathname.slice(1)}. Run again with --yes.`,
    );
    return 1;
  }
  // Encrypt the way the app will decrypt, including rotated secrets.
  const encryptionSecret = encryptionKey(
    env.BETTER_AUTH_SECRET,
    parseAuthSecrets(env.BETTER_AUTH_SECRETS),
  );

  const passwordHash = await hashPassword(PASSWORD);
  const openLinks: string[] = [];
  /** Open invitations to email once the data is saved. */
  const invitationEmails: (Omit<InvitationEmailProps, 'appUrl' | 'validDays' | 'locale'> & {
    to: string;
  })[] = [];

  try {
    await db.transaction(async (tx) => {
      await emptyDatabase(tx);

      /**
       * Creates a company.
       *
       * @param name - Company name.
       * @param slug - URL name.
       * @param deactivated - Whether it's deactivated.
       * @returns Its ID.
       */
      const addCompany = async (name: string, slug: string, deactivated = false) => {
        const created = firstRow(
          await tx
            .insert(schema.company)
            .values({ name, slug, deactivatedAt: deactivated ? daysFromNow(-3) : null })
            .returning({ id: schema.company.id }),
          'the new company',
        );
        return created.id;
      };

      /**
       * Creates a user, optionally with a password.
       *
       * @param email - Email address.
       * @param name - Display name.
       * @param options - Extras.
       * @param options.password - Give them the shared test password.
       * @param options.verified - Whether their email counts as verified.
       * @param options.twoFactor - Whether two-step verification is on.
       * @param options.lastActiveMinutesAgo - When they were last active, or `null` for never.
       * @param options.deactivated - Whether the account is deactivated.
       * @param options.timeZone - Their saved time zone, or `null` for none yet.
       * @returns Their ID.
       */
      const addUser = async (
        email: string,
        name: string,
        {
          password = true,
          verified = true,
          twoFactor = false,
          lastActiveMinutesAgo = 60,
          deactivated = false,
          timeZone = DEV_TIME_ZONE,
        }: {
          password?: boolean;
          verified?: boolean;
          twoFactor?: boolean;
          lastActiveMinutesAgo?: number | null;
          deactivated?: boolean;
          timeZone?: string | null;
        } = {},
      ) => {
        const created = firstRow(
          await tx
            .insert(schema.user)
            .values({
              email,
              name,
              emailVerified: verified,
              twoFactorEnabled: twoFactor,
              createdAt: daysFromNow(-30),
              lastActiveAt:
                lastActiveMinutesAgo === null
                  ? null
                  : new Date(Date.now() - lastActiveMinutesAgo * 60_000),
              deactivatedAt: deactivated ? daysFromNow(-5) : null,
              timeZone,
            })
            .returning({ id: schema.user.id }),
          'the new user',
        );
        if (password) {
          await tx.insert(schema.account).values({
            userId: created.id,
            accountId: created.id,
            providerId: 'credential',
            password: passwordHash,
          });
        }
        return created.id;
      };

      /**
       * Sets up an authenticator app for a user, storing its secret and backup
       * codes encrypted, as Better Auth does.
       *
       * @param userId - The user.
       * @param rawSecret - The authenticator's setup key.
       * @param backupCodes - The backup codes they hold.
       */
      const addAuthenticator = async (
        userId: string,
        rawSecret: string,
        backupCodes: string[] = [],
      ) => {
        await tx.insert(schema.twoFactor).values({
          userId,
          secret: await symmetricEncrypt({ key: encryptionSecret, data: rawSecret }),
          backupCodes: await symmetricEncrypt({
            key: encryptionSecret,
            data: JSON.stringify(backupCodes),
          }),
          verified: true,
        });
      };

      /**
       * Puts a user on the staff with a platform role.
       *
       * @param userId - The user.
       * @param role - Their role on the staff.
       */
      const addToStaff = async (userId: string, role: PlatformRole) => {
        await tx.update(schema.user).set({ platformRole: role }).where(eq(schema.user.id, userId));
      };

      /**
       * Gives a user a role in a company.
       *
       * @param companyId - The company.
       * @param userId - The user.
       * @param role - Their role there.
       */
      const addMember = async (companyId: string, userId: string, role: CompanyRole) => {
        await tx
          .insert(schema.membership)
          .values({ companyId, userId, role, createdAt: daysFromNow(-25) });
      };

      // The staff name, and the companies.
      await tx
        .insert(schema.staffSettings)
        .values({ name: STAFF_NAME, defaultTimeZone: DEV_TIME_ZONE });
      const alpha = await addCompany('Adiutor Tests Alpha', 'adiutor-tests-alpha');
      const beta = await addCompany('Adiutor Tests Beta', 'adiutor-tests-beta');
      const gamma = await addCompany('Adiutor Tests Gamma', 'adiutor-tests-gamma', true);
      const delta = await addCompany('Adiutor Tests Delta', 'adiutor-tests-delta');

      // Staff. First, the developer's own Admin (`--admin-mail`), for signing in with an email
      // link or a GitHub or Google account that has that address verified.
      if (adminMail) {
        const ownAdmin = await addUser(adminMail, nameFromEmail(adminMail), {
          password: false,
          lastActiveMinutesAgo: null,
          // Their browser saves theirs the first time they sign in.
          timeZone: null,
        });
        await addToStaff(ownAdmin, 'platform_admin');
      }

      const admin = await addUser('admin@adiutor.test', 'Alex Admin', {
        twoFactor: true,
        lastActiveMinutesAgo: 3,
      });
      await addToStaff(admin, 'platform_admin');
      await addAuthenticator(admin, ADMIN_TOTP_SECRET, ADMIN_BACKUP_CODES);

      const manager = await addUser('manager@adiutor.test', 'Morgan Manager', { twoFactor: true });
      await addToStaff(manager, 'manager');
      await addAuthenticator(manager, MANAGER_TOTP_SECRET);
      await addToStaff(
        await addUser('manager.email@adiutor.test', 'Mel Manager', { twoFactor: true }),
        'manager',
      );
      await addToStaff(await addUser('manager.nomfa@adiutor.test', 'Max Manager'), 'manager');
      await addToStaff(
        await addUser('finance@adiutor.test', 'Frankie Finance', {
          lastActiveMinutesAgo: 3 * 24 * 60,
        }),
        'finance',
      );

      // An Admin who only signs in with GitHub, whose GitHub account has 2FA: protected without
      // setting anything up in Adiutor, while GitHub sign-in is configured (otherwise their GitHub
      // MFA doesn't count: they show as "Needs MFA", and staff Admins see a dashboard warning).
      const githubAdmin = await addUser('github.admin@adiutor.test', 'Gita GitHub', {
        password: false,
        lastActiveMinutesAgo: 26 * 60,
      });
      await addToStaff(githubAdmin, 'platform_admin');
      await tx.insert(schema.account).values({
        userId: githubAdmin,
        accountId: '1000001',
        providerId: 'github',
        mfaVerified: true,
        // Its GitHub username, shown next to the account (`accountName`).
        accountName: 'gita-github',
      });
      const support = await addUser('support@adiutor.test', 'Sam Support');
      await addToStaff(support, 'support');

      // Alpha: every company role, a staff member who's also a company member, and someone in two companies.
      const alphaAdmin = await addUser('alpha.admin@adiutor.test', 'Avery Alpha', {
        twoFactor: true,
      });
      await addAuthenticator(alphaAdmin, ALPHA_ADMIN_TOTP_SECRET);
      await addMember(alpha, alphaAdmin, 'admin');
      const alphaClient = await addUser('alpha.client@adiutor.test', 'Casey Client', {
        twoFactor: true,
      });
      await addMember(alpha, alphaClient, 'client');
      await addMember(
        alpha,
        await addUser('alpha.watcher@adiutor.test', 'Wren Watcher'),
        'watcher',
      );
      await addMember(alpha, support, 'client');
      const multi = await addUser('multi@adiutor.test', 'Mika Multi');
      await addMember(alpha, multi, 'watcher');

      // Beta: an email-link-only Admin, an unverified Client, and the multi-company user as Admin.
      await addMember(
        beta,
        await addUser('beta.admin@adiutor.test', 'Blake Beta', { password: false }),
        'admin',
      );
      await addMember(
        beta,
        await addUser('beta.client@adiutor.test', 'Unverified Uma', { verified: false }),
        'client',
      );
      await addMember(beta, multi, 'admin');

      // Gamma: deactivated, so its members can't open it (staff still can).
      const gammaAdmin = await addUser('gamma.admin@adiutor.test', 'Gale Gamma');
      await addMember(gamma, gammaAdmin, 'admin');
      await addMember(gamma, await addUser('gamma.client@adiutor.test', 'Gus Gamma'), 'client');

      // Someone without a company (e.g. removed from one).
      await addUser('drifter@adiutor.test', 'Dana Drifter', { lastActiveMinutesAgo: null });

      // A deactivated account: it can't sign in until an Admin reactivates it.
      const former = await addUser('former@adiutor.test', 'Fran Former', {
        deactivated: true,
        lastActiveMinutesAgo: 9 * 24 * 60,
      });
      await addMember(alpha, former, 'client');

      // Sample audit log entries, so the user detail page has a history.
      await tx.insert(schema.auditEvent).values([
        {
          action: 'sign_in_failed',
          targetUserId: admin,
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/144.0',
          details: { method: 'password', email: 'admin@adiutor.test' },
          at: daysFromNow(-2),
        },
        {
          action: 'sign_in',
          actorUserId: admin,
          targetUserId: admin,
          ip: '198.51.100.24',
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0 Safari/537.36',
          details: { method: 'password_and_authenticator' },
          at: daysFromNow(-1),
        },
        {
          action: 'role_changed',
          actorUserId: alphaAdmin,
          targetUserId: multi,
          companyId: alpha,
          details: { from: 'client', to: 'watcher' },
          at: daysFromNow(-4),
        },
        {
          action: 'account_deactivated',
          actorUserId: former,
          targetUserId: former,
          details: { self: true },
          at: daysFromNow(-5),
        },
      ]);

      // Sample errors, so Logs → Errors has references to look up.
      const errors = sampleErrors({ admin, manager, support, alphaAdmin, multi });
      await tx.insert(schema.appError).values(errors.appErrors);
      await tx.insert(schema.signInError).values(errors.signInErrors);

      // Sample requests, so the request pages have every status, type and kind of history.
      await storeRequests(
        tx,
        sampleRequests({
          alpha,
          beta,
          gamma,
          alphaAdmin,
          alphaClient,
          multi,
          gammaAdmin,
          support,
          manager,
        }),
      );

      /**
       * Creates an invitation and returns its accept link. Open ones are
       * also queued to be emailed.
       *
       * @param company - The company.
       * @param company.id - Its ID.
       * @param company.name - Its name, for the email.
       * @param email - Who's invited.
       * @param role - The role they'll get.
       * @param inviter - Who sent it.
       * @param inviter.id - Their user ID.
       * @param inviter.name - Their name, for the email.
       * @param state - Open, open but expiring within a day (due for its reminder), expired or revoked.
       * @returns The accept link.
       */
      const addInvitation = async (
        company: { id: string | null; name: string },
        email: string,
        role: Role,
        inviter: { id: string; name: string },
        state: 'open' | 'due' | 'expired' | 'revoked' = 'open',
      ) => {
        const companyId = company.id;
        const invitedBy = inviter.id;
        const token = generateToken();
        await tx.insert(schema.invitation).values({
          companyId,
          email,
          role,
          invitedBy,
          tokenHash: hashToken(token),
          expiresAt: daysFromNow(
            { open: INVITATION_VALID_DAYS, due: 1, expired: -1, revoked: INVITATION_VALID_DAYS }[
              state
            ],
          ),
          revokedAt: state === 'revoked' ? daysFromNow(-1) : null,
          // Due ones were sent so long ago that one day of their lifetime is left.
          createdAt: daysFromNow(state === 'due' ? 1 - INVITATION_VALID_DAYS : 0),
        });
        const url = `${appUrl}/invite/${token}`;
        if (state === 'open' || state === 'due') {
          invitationEmails.push({
            to: email,
            companyName: company.name,
            inviterName: inviter.name,
            role,
            url,
          });
        }
        return url;
      };

      const alphaCompany = { id: alpha, name: 'Adiutor Tests Alpha' };
      const alphaInviter = { id: alphaAdmin, name: 'Avery Alpha' };
      openLinks.push(
        `Invitation to Alpha as Client for newcomer@adiutor.test: ${await addInvitation(alphaCompany, 'newcomer@adiutor.test', 'client', alphaInviter)}`,
        `Invitation to Delta as Admin for delta.admin@adiutor.test: ${await addInvitation({ id: delta, name: 'Adiutor Tests Delta' }, 'delta.admin@adiutor.test', 'admin', { id: manager, name: 'Morgan Manager' })}`,
        `Invitation to Alpha as Client for drifter@adiutor.test (existing account): ${await addInvitation(alphaCompany, 'drifter@adiutor.test', 'client', alphaInviter)}`,
      );
      openLinks.push(
        `Invitation to Alpha as Watcher for soon@adiutor.test (expires tomorrow; \`pnpm jobs:run\` reminds): ${await addInvitation(alphaCompany, 'soon@adiutor.test', 'watcher', alphaInviter, 'due')}`,
      );
      await addInvitation(alphaCompany, 'late@adiutor.test', 'watcher', alphaInviter, 'expired');
      await addInvitation(alphaCompany, 'revoked@adiutor.test', 'client', alphaInviter, 'revoked');
      openLinks.push(
        `Staff invitation as Support for newstaff@adiutor.test: ${await addInvitation({ id: null, name: STAFF_NAME }, 'newstaff@adiutor.test', 'support', { id: admin, name: 'Alex Admin' })}`,
      );

      /**
       * Creates an invite link and returns it.
       *
       * @param role - The role it gives.
       * @param state - Active, used, expired or revoked.
       * @param companyId - The company (Alpha by default), or `null` for staff.
       * @returns The link.
       */
      const addInviteLink = async (
        role: Role,
        state: 'active' | 'used' | 'expired' | 'revoked',
        companyId: string | null = alpha,
      ) => {
        const token = generateToken();
        await tx.insert(schema.inviteLink).values({
          companyId,
          role,
          createdBy: companyId === null ? admin : alphaAdmin,
          tokenHash: hashToken(token),
          expiresAt: daysFromNow(state === 'expired' ? -1 : 7),
          usedAt: state === 'used' ? daysFromNow(-1) : null,
          usedByEmail: state === 'used' ? 'linked@adiutor.test' : null,
          revokedAt: state === 'revoked' ? daysFromNow(-1) : null,
        });
        return `${appUrl}/join/${token}`;
      };

      openLinks.push(
        `Invite link to Alpha as Watcher: ${await addInviteLink('watcher', 'active')}`,
        `Staff invite link as Finance: ${await addInviteLink('finance', 'active', null)}`,
      );
      await addInviteLink('client', 'used');
      await addInviteLink('client', 'expired');
      await addInviteLink('watcher', 'revoked');
    });
  } finally {
    await db.$client.end();
  }

  // Email the open invitations like the app would. A failing mail server doesn't undo the seeding.
  try {
    await Promise.all(
      invitationEmails.map(async ({ to, ...props }) =>
        sendEmail(
          // In English (US), the language seeded invitations have (`invitation.locale`'s default).
          await invitationEmail(to, {
            ...props,
            appUrl,
            locale: DEFAULT_LOCALE,
            validDays: INVITATION_VALID_DAYS,
          }),
        ),
      ),
    );
    console.info(`Emailed ${invitationEmails.length} open invitations (see Mailpit).`);
  } catch (error) {
    console.warn('Seeded, but emailing the invitations failed. Is Mailpit running?', error);
  }

  console.info(`Seeded the database. Sign in at ${appUrl}/auth; emails arrive in Mailpit.`);
  if (adminMail) {
    console.info(
      `Your staff Admin ${adminMail} has no password: sign in with an email link, or with GitHub or Google using that verified address.`,
    );
  }
  console.info(`Password of the accounts that have one: see PASSWORD in scripts/seed-dev.ts.`);
  console.info(
    `\nAuthenticator setup key for admin@adiutor.test: ${toSetupKey(ADMIN_TOTP_SECRET)}`,
  );
  console.info(`Backup codes for admin@adiutor.test: ${ADMIN_BACKUP_CODES.join(', ')}`);
  console.info(
    `Authenticator setup key for manager@adiutor.test: ${toSetupKey(MANAGER_TOTP_SECRET)}`,
  );
  console.info(
    `Authenticator setup key for alpha.admin@adiutor.test: ${toSetupKey(ALPHA_ADMIN_TOTP_SECRET)}`,
  );
  console.info(`\nLinks that still work:\n${openLinks.map((line) => `- ${line}`).join('\n')}`);
  return 0;
}

// Database errors are logged without the values they were sent.
installLogRedaction();

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

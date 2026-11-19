/**
 * @file Resets the end-to-end test database and adds the seeded accounts and
 * companies from `fixtures.ts`, through the short connection of
 * `withTestDatabase`. Looking at or changing the database during a test is
 * `db.ts`.
 */
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import * as schema from '../../src/db/schema';
import type { CompanyRole, PlatformRole } from '../../src/lib/authz/roles';
import { firstRow } from '../../src/lib/defined';
import { generateToken, hashToken } from '../../src/lib/sign-in/tokens';
import { storeAuthenticator } from '../../tests/auth/authenticator';
import emptyDatabase from '../../tests/database/empty-database';
import {
  FORMATTED_CLIENT_REPLY,
  FORMATTED_DESCRIPTION,
  FORMATTED_STAFF_REPLY,
} from '../../tests/database/formatted-request';
import storeRequests from '../../tests/database/store-requests';
import { withTestDatabase } from './db';
import {
  CLIENT_WATCHER,
  CLOSED_COMPANY_ADMIN,
  CLOSED_COMPANY_NAME,
  CLOSED_COMPANY_SLUG,
  COMPANY_NAME,
  COMPANY_SLUG,
  COMPANY_OWNER,
  STAFF_NAME,
  DEACTIVATE_CLIENT,
  DELETE_CLIENT,
  E2E_AUTH_SECRET,
  FINANCE_STAFF,
  GITHUB_ONLY_MANAGER,
  MFA_CLIENT,
  NAMELESS_SUPPORT,
  OWNED_COMPANY_NAME,
  OWNED_COMPANY_SLUG,
  PAGED_LINK_COUNT,
  PAGED_MEMBER_COUNT,
  PAGED_REQUEST_COUNT,
  pagedMemberEmail,
  pagedMemberName,
  pagedRequestTitle,
  PAGING_COMPANY_NAME,
  PAGING_COMPANY_SLUG,
  PASSKEY_CLIENT,
  PLATFORM_ADMIN,
  PLATFORM_MANAGER,
  LINK_JOINER,
  PAUSED_CLIENT,
  RECENT_MFA_CLIENT,
  REQUESTS_CLIENT,
  RESET_CLIENT,
  SEEDED_REQUESTS,
  STEP_UP_MANAGER,
  STEP_UP_CLIENT,
  SUPPORT_STAFF,
  SESSIONS_CLIENT,
  UNVERIFIED_USER,
} from './fixtures';

/**
 * Empties the test database, as on a fresh install: every user, company, the
 * staff settings, verification tokens and rate limits.
 */
export async function emptyTestDatabase(): Promise<void> {
  await withTestDatabase((db) => emptyDatabase(db));
}

/**
 * Empties the database and creates the staff (its name, Admin and Manager),
 * plus a company with the users the tests use. Both are named "Adiutor Tests".
 */
export default async function seedTestDatabase(): Promise<void> {
  await emptyTestDatabase();
  await withTestDatabase(async (db) => {
    /**
     * Creates a user with a password: on the staff (with a platform role) or
     * in a company.
     *
     * @param person - Name, email and password.
     * @param person.name - Display name.
     * @param person.email - Email address.
     * @param person.password - Password.
     * @param where - A platform role for staff, or a company and a company role.
     * @param emailVerified - Whether their email counts as verified.
     * @returns The user's ID.
     */
    const addPerson = async (
      person: { name: string; email: string; password: string },
      where: { platformRole: PlatformRole } | { companyId: string; role: CompanyRole },
      emailVerified = true,
    ) => {
      const created = firstRow(
        await db
          .insert(schema.user)
          .values({
            name: person.name,
            email: person.email,
            emailVerified,
            platformRole: 'platformRole' in where ? where.platformRole : null,
          })
          .returning({ id: schema.user.id }),
        'the new user',
      );
      await db.insert(schema.account).values({
        userId: created.id,
        accountId: created.id,
        providerId: 'credential',
        password: await hashPassword(person.password),
      });
      if ('companyId' in where) {
        await db
          .insert(schema.membership)
          .values({ companyId: where.companyId, userId: created.id, role: where.role });
      }
      return created.id;
    };

    /**
     * Gives a seeded user an authenticator app.
     *
     * @param person - The user, with the raw authenticator secret.
     * @param person.email - Their email address.
     * @param person.totpSecret - The raw secret.
     */
    const addAuthenticator = async (person: { email: string; totpSecret: string }) => {
      const found = firstRow(
        await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, person.email)),
        'the user',
      );
      await storeAuthenticator(db, found.id, person.totpSecret, E2E_AUTH_SECRET);
    };

    await db.insert(schema.staffSettings).values({ name: STAFF_NAME });
    // A tick just ran, so pages don't warn that background jobs aren't running.
    await db.insert(schema.jobTick).values({ lastStartedAt: new Date() });
    await addPerson(PLATFORM_ADMIN, { platformRole: 'platform_admin' });
    await addPerson(PLATFORM_MANAGER, { platformRole: 'manager' });
    const support = await addPerson(SUPPORT_STAFF, { platformRole: 'support' });
    await addPerson(FINANCE_STAFF, { platformRole: 'finance' });
    await addPerson(NAMELESS_SUPPORT, { platformRole: 'support' });

    // The Admin has an authenticator app set up, as their role requires MFA.
    await addAuthenticator(PLATFORM_ADMIN);

    const clientCompany = firstRow(
      await db
        .insert(schema.company)
        .values({ name: COMPANY_NAME, slug: COMPANY_SLUG })
        .returning({ id: schema.company.id }),
      'the seeded company',
    );
    await addPerson(CLIENT_WATCHER, { companyId: clientCompany.id, role: 'watcher' });
    await addPerson(UNVERIFIED_USER, { companyId: clientCompany.id, role: 'client' }, false);
    await addPerson(MFA_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(PASSKEY_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(DEACTIVATE_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(DELETE_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(SESSIONS_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(RESET_CLIENT, { companyId: clientCompany.id, role: 'client' });

    await addPerson(STEP_UP_MANAGER, { platformRole: 'manager' });
    await addPerson(STEP_UP_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(RECENT_MFA_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(PAUSED_CLIENT, { companyId: clientCompany.id, role: 'client' });
    await addPerson(LINK_JOINER, { companyId: clientCompany.id, role: 'client' });
    const requestsClient = await addPerson(REQUESTS_CLIENT, {
      companyId: clientCompany.id,
      role: 'client',
    });

    // Signs in only with GitHub (2FA on, no password), which doesn't count while GitHub is off.
    const githubManager = firstRow(
      await db
        .insert(schema.user)
        .values({
          name: GITHUB_ONLY_MANAGER.name,
          email: GITHUB_ONLY_MANAGER.email,
          emailVerified: true,
          platformRole: 'manager',
        })
        .returning({ id: schema.user.id }),
      'the GitHub manager',
    );
    await db.insert(schema.account).values({
      userId: githubManager.id,
      accountId: 'adiutor-tests-github-manager',
      providerId: 'github',
      mfaVerified: true,
      accountName: GITHUB_ONLY_MANAGER.githubLogin,
    });

    // This user has an authenticator app, which the Admin resets.
    await addAuthenticator(RESET_CLIENT);
    await addAuthenticator(STEP_UP_MANAGER);
    await addAuthenticator(STEP_UP_CLIENT);
    await addAuthenticator(RECENT_MFA_CLIENT);
    // Trusts a browser at the code step, which signing out other devices forgets.
    await addAuthenticator(SESSIONS_CLIENT);

    // Company Admins without MFA, in their own companies so the test company's (`COMPANY_NAME`)
    // members stay as they are: one active (MFA is required), one deactivated (it isn't).
    const ownedCompany = firstRow(
      await db
        .insert(schema.company)
        .values({ name: OWNED_COMPANY_NAME, slug: OWNED_COMPANY_SLUG })
        .returning({ id: schema.company.id }),
      'the owned company',
    );
    await addPerson(COMPANY_OWNER, { companyId: ownedCompany.id, role: 'admin' });
    const closedCompany = firstRow(
      await db
        .insert(schema.company)
        .values({
          name: CLOSED_COMPANY_NAME,
          slug: CLOSED_COMPANY_SLUG,
          deactivatedAt: new Date(),
        })
        .returning({ id: schema.company.id }),
      'the closed company',
    );
    const closedCompanyAdmin = await addPerson(CLOSED_COMPANY_ADMIN, {
      companyId: closedCompany.id,
      role: 'admin',
    });

    // A company with more members than fit on a page, and more invite links than the 10 a table
    // shows without pagination, for the pagination tests only. The members never sign in, so
    // they get no password (no hashing to wait for); they joined a minute apart, in order.
    const pagingCompany = firstRow(
      await db
        .insert(schema.company)
        .values({ name: PAGING_COMPANY_NAME, slug: PAGING_COMPANY_SLUG })
        .returning({ id: schema.company.id }),
      'the paging company',
    );
    const joinedFrom = Date.now() - PAGED_MEMBER_COUNT * 60_000;
    const pagedMembers = await db
      .insert(schema.user)
      .values(
        Array.from({ length: PAGED_MEMBER_COUNT }, (_, index) => ({
          name: pagedMemberName(index + 1),
          email: pagedMemberEmail(index + 1),
          emailVerified: true,
        })),
      )
      .returning({ id: schema.user.id, email: schema.user.email });
    await db.insert(schema.membership).values(
      pagedMembers.map(({ id, email }) => ({
        companyId: pagingCompany.id,
        userId: id,
        role: 'client' as const,
        createdAt: new Date(joinedFrom + Number(email.slice(6, 8)) * 60_000),
      })),
    );
    await db.insert(schema.inviteLink).values(
      Array.from({ length: PAGED_LINK_COUNT }, (_, index) => ({
        companyId: pagingCompany.id,
        role: 'client' as const,
        tokenHash: hashToken(generateToken()),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        createdAt: new Date(joinedFrom + index * 60_000),
      })),
    );

    // Requests no test changes (see `SEEDED_REQUESTS`): four in the test company, one in the
    // deactivated company, and more than a page of them in the paging company, raised a minute
    // apart by its first member.
    const HOUR = 60 * 60_000;
    /**
     * A time before now.
     *
     * @param hours - How many hours before.
     * @returns The time.
     */
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);
    const byClient = { id: requestsClient, side: 'company' } as const;
    const byStaff = { id: support, side: 'staff' } as const;
    const firstPagedMember = firstRow(pagedMembers, 'the first paged member');
    await storeRequests(db, [
      {
        companyId: clientCompany.id,
        title: SEEDED_REQUESTS.waiting.title,
        description: 'Our opening hours change next month. Can you update them on the website?',
        // Written before Markdown: the one seeded text that's still shown as plain text.
        format: 'plain',
        type: 'support',
        priority: 'high',
        status: 'waiting',
        raisedBy: byClient,
        at: hoursAgo(72),
        entries: [
          { by: byClient, at: hoursAgo(70), reply: 'It’s for the summer schedule, from 1 July.' },
          { by: byStaff, at: hoursAgo(48), change: 'status', from: 'open', to: 'in_progress' },
          { by: byStaff, at: hoursAgo(47), change: 'priority', from: 'normal', to: 'high' },
          {
            by: byStaff,
            at: hoursAgo(2),
            reply: 'Done on the test site: https://adiutor.test/preview\nWhich days change?',
          },
          { by: byStaff, at: hoursAgo(2), change: 'status', from: 'in_progress', to: 'waiting' },
        ],
      },
      {
        companyId: clientCompany.id,
        title: SEEDED_REQUESTS.open.title,
        description: 'It started after the last toner change.\nThe one on floor 1 works.',
        type: 'bug',
        priority: 'normal',
        raisedBy: byClient,
        at: hoursAgo(5),
      },
      {
        companyId: clientCompany.id,
        title: SEEDED_REQUESTS.done.title,
        description: 'Raised after a phone call: Robin starts on Monday.',
        type: 'support',
        priority: 'normal',
        status: 'done',
        raisedBy: byStaff,
        at: hoursAgo(240),
        entries: [
          { by: byStaff, at: hoursAgo(230), reply: 'Robin has access now.' },
          { by: byStaff, at: hoursAgo(230), change: 'status', from: 'open', to: 'done' },
        ],
      },
      {
        companyId: clientCompany.id,
        title: SEEDED_REQUESTS.reopened.title,
        description: 'Invoices still show our old address.',
        type: 'hotfix',
        priority: 'high',
        status: 'in_progress',
        reopened: true,
        raisedBy: byClient,
        at: hoursAgo(200),
        entries: [
          { by: byStaff, at: hoursAgo(190), change: 'status', from: 'open', to: 'done' },
          { by: byClient, at: hoursAgo(30), reply: 'The email still has the old address.' },
          { by: byClient, at: hoursAgo(30), change: 'status', from: 'done', to: 'open' },
          { by: byStaff, at: hoursAgo(24), change: 'status', from: 'open', to: 'in_progress' },
        ],
      },
      {
        companyId: closedCompany.id,
        title: SEEDED_REQUESTS.closedCompany.title,
        description: 'The certificate of our shop expires at the end of the month.',
        type: 'support',
        priority: 'normal',
        status: 'in_progress',
        raisedBy: { id: closedCompanyAdmin, side: 'company' },
        at: hoursAgo(400),
        entries: [
          { by: byStaff, at: hoursAgo(390), change: 'status', from: 'open', to: 'in_progress' },
        ],
      },
      {
        companyId: clientCompany.id,
        title: SEEDED_REQUESTS.formatted.title,
        description: FORMATTED_DESCRIPTION,
        type: 'new_feature',
        priority: 'low',
        status: 'done',
        raisedBy: byClient,
        at: hoursAgo(500),
        entries: [
          { by: byStaff, at: hoursAgo(480), change: 'status', from: 'open', to: 'in_progress' },
          { by: byStaff, at: hoursAgo(470), reply: FORMATTED_STAFF_REPLY },
          { by: byClient, at: hoursAgo(460), reply: FORMATTED_CLIENT_REPLY },
          { by: byStaff, at: hoursAgo(450), change: 'status', from: 'in_progress', to: 'done' },
        ],
      },
      ...Array.from({ length: PAGED_REQUEST_COUNT }, (_, index) => ({
        companyId: pagingCompany.id,
        title: pagedRequestTitle(index + 1),
        description: 'One of the requests that fill more than a page.',
        type: 'bug' as const,
        priority: 'normal' as const,
        raisedBy: { id: firstPagedMember.id, side: 'company' as const },
        at: new Date(joinedFrom + index * 60_000),
      })),
    ]);
  });
}

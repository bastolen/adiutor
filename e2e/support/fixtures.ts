/**
 * @file Shared settings and seeded test accounts for the end-to-end tests.
 * The passwords are test values for the throwaway test database only.
 */
import { resolve } from 'node:path';

/** Port of the app server started for the tests (separate from `pnpm dev`). */
export const E2E_PORT = 3100;

/** Base URL of that server. */
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Folder the test server writes emails to instead of sending them. */
export const OUTBOX_DIR = resolve('e2e/.outbox');

/**
 * Better Auth secret of the test server. The seed needs it too, to encrypt
 * the Admin's authenticator secret the way Better Auth stores it. It's fixed
 * (never read from `.env` or the environment), so the seed and the server
 * always agree.
 */
export const E2E_AUTH_SECRET = 'e2e-only-secret-not-used-anywhere-else-0123456789';

/**
 * The test server's `CRON_SECRET`, with which the email helpers start the
 * background jobs' tick (`/api/jobs`), so queued emails go out.
 */
export const E2E_CRON_SECRET = 'e2e-only-cron-secret-not-used-anywhere-else-0123';

/**
 * An Admin on the staff, created by the global setup. Admins must have MFA,
 * so they have an authenticator app set up with this (raw) secret; the
 * `signIn` helper computes the codes.
 */
export const PLATFORM_ADMIN = {
  name: 'E2E Admin',
  email: 'admin@adiutor.test',
  password: 'e2e-admin-password',
  totpSecret: 'e2e-admin-totp-secret-0123456789',
} as const;

/** A Manager on the staff without MFA yet, so the setup requirement applies. */
export const PLATFORM_MANAGER = {
  name: 'E2E Manager',
  email: 'manager@adiutor.test',
  password: 'e2e-manager-password',
} as const;

/**
 * A Support member of the staff: can look at companies but can't use invite
 * links, and works on every company's requests.
 */
export const SUPPORT_STAFF = {
  name: 'E2E Support',
  email: 'support@adiutor.test',
  password: 'e2e-support-password',
} as const;

/**
 * The picture of {@link SUPPORT_STAFF}'s Google account, which the seed
 * connects: what their avatars show until they choose otherwise. Tests answer
 * `/avatars/*` in the browser, so nothing ever fetches it.
 */
export const SUPPORT_STAFF_PICTURE = 'https://lh3.googleusercontent.com/a/e2e-support=s96-c';

/** A Finance member of the staff: reads every company's requests, and changes none. */
export const FINANCE_STAFF = {
  name: 'E2E Finance',
  email: 'finance@adiutor.test',
  password: 'e2e-finance-password',
} as const;

/**
 * A Support member of the staff with no name and a long address, which the
 * tables show as the name (and the users table in its Email column too): the
 * widest row they have to fit without scrolling sideways.
 */
export const NAMELESS_SUPPORT = {
  name: '',
  email: 'support.without.a.name.on.file@adiutor.test',
  password: 'e2e-nameless-support-password',
} as const;

/** A Client in the seeded company, for turning on email codes. */
export const MFA_CLIENT = {
  name: 'E2E Codes',
  email: 'codes@adiutor.test',
  password: 'e2e-codes-password',
} as const;

/** A Client in the seeded company, for adding a passkey. */
export const PASSKEY_CLIENT = {
  name: 'E2E Passkey',
  email: 'passkey@adiutor.test',
  password: 'e2e-passkey-password',
} as const;

/** A Watcher in the seeded company, created by the global setup. */
export const CLIENT_WATCHER = {
  name: 'E2E Watcher',
  email: 'watcher@adiutor.test',
  password: 'e2e-watcher-password',
} as const;

/** A user with a password whose email isn't verified yet, in the seeded company. */
export const UNVERIFIED_USER = {
  name: 'E2E Unverified',
  email: 'unverified@adiutor.test',
  password: 'e2e-unverified-password',
} as const;

/** Name of the test company. */
export const COMPANY_NAME = 'Adiutor Tests Client';

/** URL name of {@link COMPANY_NAME}. */
export const COMPANY_SLUG = 'adiutor-tests-client';

/** Name shown to users for the test staff. */
export const STAFF_NAME = 'Adiutor Tests';

/** A Client who deactivates their own account (and is reactivated by the Admin). */
export const DEACTIVATE_CLIENT = {
  name: 'E2E Leaver',
  email: 'leaver@adiutor.test',
  password: 'e2e-leaver-password',
} as const;

/** A Client the Admin deletes. */
export const DELETE_CLIENT = {
  name: 'E2E Deleted',
  email: 'deleted@adiutor.test',
  password: 'e2e-deleted-password',
} as const;

/**
 * A Client with an authenticator app who signs in on two devices, trusting
 * one at the code step, and signs the other one out.
 */
export const SESSIONS_CLIENT = {
  name: 'E2E Devices',
  email: 'devices@adiutor.test',
  password: 'e2e-devices-password',
  totpSecret: 'e2e-devices-totp-secret-0123456',
} as const;

/** A Client with an authenticator app whose two-step verification the Admin resets. */
export const RESET_CLIENT = {
  name: 'E2E Lost Phone',
  email: 'lostphone@adiutor.test',
  password: 'e2e-lostphone-password',
  totpSecret: 'e2e-lostphone-totp-secret-01234',
} as const;

/**
 * A staff Manager (a role that requires MFA) with an authenticator app, for
 * the security tests: they use up rate limits, so they have their own
 * account, and it isn't an Admin, so the staff's last-Admin rule still
 * applies to the main Admin.
 */
export const STEP_UP_MANAGER = {
  name: 'E2E Step-up Manager',
  email: 'stepup.manager@adiutor.test',
  password: 'e2e-stepup-manager-password',
  totpSecret: 'e2e-stepup-manager-totp-secret1',
} as const;

/** A Client with an authenticator app, for the security tests. */
export const STEP_UP_CLIENT = {
  name: 'E2E Step-up Client',
  email: 'stepup.client@adiutor.test',
  password: 'e2e-stepup-client-password',
  totpSecret: 'e2e-stepup-client-totp-secret-1',
} as const;

/**
 * A Client with an authenticator app whose confirmation the security tests
 * backdate, to check that changing how they sign in needs one from the last
 * 15 minutes. Their own account, so they share no rate limits or code
 * windows with the other tests.
 */
export const RECENT_MFA_CLIENT = {
  name: 'E2E Recent MFA Client',
  email: 'recent.mfa@adiutor.test',
  password: 'e2e-recent-mfa-client-password',
  totpSecret: 'e2e-recent-mfa-totp-secret-0123',
} as const;

/**
 * A Client whose password sign-in the security tests pause with wrong
 * passwords, then lift with a password reset. Their own account, so the
 * pause and the new password don't reach other tests.
 */
export const PAUSED_CLIENT = {
  name: 'E2E Paused Password',
  email: 'paused@adiutor.test',
  password: 'e2e-paused-password',
} as const;

/**
 * A staff Manager who signs in only with GitHub, with 2FA on (no password).
 * GitHub sign-in is off in the e2e tests, so that MFA doesn't count: staff
 * Admins see the dashboard warning about it (`getProviderMfaWarning`), and
 * only they see the GitHub username on the user's page.
 */
export const GITHUB_ONLY_MANAGER = {
  name: 'E2E GitHub Manager',
  email: 'github.manager@adiutor.test',
  /** The GitHub account's username (its stored `accountName`). */
  githubLogin: 'adiutor-tests-manager',
} as const;

/**
 * A Client without MFA who joins another company as its Admin with an invite
 * link, which ends their session (the new role requires MFA). Their own
 * account, so the new role doesn't reach other tests.
 */
export const LINK_JOINER = {
  name: 'E2E Link Joiner',
  email: 'link.joiner@adiutor.test',
  password: 'e2e-link-joiner-password',
} as const;

/**
 * The Admin of an active company, without MFA: their role requires it, so
 * they're sent to set it up.
 */
export const COMPANY_OWNER = {
  name: 'E2E Company Owner',
  email: 'company.owner@adiutor.test',
  password: 'e2e-company-owner-password',
} as const;

/** The company {@link COMPANY_OWNER} is the Admin of. */
export const OWNED_COMPANY_NAME = 'Adiutor Tests Owned';

/** URL name of {@link OWNED_COMPANY_NAME}. */
export const OWNED_COMPANY_SLUG = 'adiutor-tests-owned';

/**
 * The Admin of a deactivated company, without MFA: it isn't required while
 * the company is deactivated.
 */
export const CLOSED_COMPANY_ADMIN = {
  name: 'E2E Closed Company Admin',
  email: 'closed.company@adiutor.test',
  password: 'e2e-closed-admin-password',
} as const;

/** The deactivated company {@link CLOSED_COMPANY_ADMIN} is the Admin of. */
export const CLOSED_COMPANY_NAME = 'Adiutor Tests Closed';

/** URL name of {@link CLOSED_COMPANY_NAME}. */
export const CLOSED_COMPANY_SLUG = 'adiutor-tests-closed';

/**
 * A company with more members, invite links and requests than fit on a page,
 * for the pagination tests (`e2e/tables.spec.ts`) and the accessibility and
 * keyboard checks of paginated tables (`a11y.spec.ts`, `keyboard.spec.ts`);
 * no test changes its data.
 */
export const PAGING_COMPANY_NAME = 'Adiutor Tests Paging';

/** URL name of {@link PAGING_COMPANY_NAME}. */
export const PAGING_COMPANY_SLUG = 'adiutor-tests-paging';

/** How many members the paging company has: more than one page of 25. */
export const PAGED_MEMBER_COUNT = 30;

/** How many invite links the paging company has: more than the 10 shown without pagination. */
export const PAGED_LINK_COUNT = 12;

/**
 * The name of a member of the paging company. They sort after every "E2E …"
 * user, so the users list's first page stays as the other tests expect.
 *
 * @param number - Which member, from 1.
 * @returns E.g. "Paged Member 07".
 */
export function pagedMemberName(number: number): string {
  return `Paged Member ${String(number).padStart(2, '0')}`;
}

/**
 * The email address of a member of the paging company (they joined in this
 * order, a minute apart).
 *
 * @param number - Which member, from 1.
 * @returns E.g. `paged.07@adiutor.test`.
 */
export function pagedMemberEmail(number: number): string {
  return `paged.${String(number).padStart(2, '0')}@adiutor.test`;
}

/**
 * A Client of the test company ({@link COMPANY_NAME}) for the request tests:
 * they raise requests, reply to them, close and reopen them. An account of
 * their own, so the tests that change the other Clients don't touch it.
 */
export const REQUESTS_CLIENT = {
  name: 'E2E Requests Client',
  email: 'requests.client@adiutor.test',
  password: 'e2e-requests-client-password',
} as const;

/**
 * The seeded requests, by what they're for. No test changes them: a test
 * that changes a request raises its own. All but the fifth are the test
 * company's ({@link COMPANY_NAME}). The first one's description is plain
 * text, as every text was before Markdown; every other text is Markdown.
 */
export const SEEDED_REQUESTS = {
  /**
   * Waiting for the company's reply, with a conversation: a reply from each
   * side, status changes and a change of priority (which only staff see).
   * Raised by {@link REQUESTS_CLIENT}; the staff's part is {@link SUPPORT_STAFF}'s.
   */
  waiting: { number: 1, title: 'Update the opening hours on the website' },
  /** Open, without replies. */
  open: { number: 2, title: 'The printer on floor 2 prints blank pages' },
  /** Done; raised by the staff for the company. */
  done: { number: 3, title: 'A new colleague needs access' },
  /** In progress after it was reopened. */
  reopened: { number: 4, title: 'Invoices show the wrong address' },
  /** In the deactivated company ({@link CLOSED_COMPANY_NAME}): the staff can read it, nobody can change it. */
  closedCompany: { number: 5, title: 'Renew the SSL certificate' },
  /**
   * Done, and written in Markdown with every kind of formatting
   * (`tests/database/formatted-request.ts`): headings, lists, a table, code,
   * a quotation, links, an image and a footnote.
   */
  formatted: { number: 6, title: 'Move the intranet to the new server' },
} as const;

/** How many requests the paging company has: more than one page of 25, all open. */
export const PAGED_REQUEST_COUNT = 30;

/** The number of the paging company's first request; the others follow it. */
export const FIRST_PAGED_REQUEST_NUMBER = Object.keys(SEEDED_REQUESTS).length + 1;

/**
 * The title of a request of the paging company (they were raised in this
 * order, a minute apart).
 *
 * @param number - Which request, from 1.
 * @returns E.g. "Paged request 07".
 */
export function pagedRequestTitle(number: number): string {
  return `Paged request ${String(number).padStart(2, '0')}`;
}

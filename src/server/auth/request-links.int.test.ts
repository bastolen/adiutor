/**
 * @file Runs the link in an email about a request (decision 0036) through
 * Better Auth's real endpoint (`auth.handler`, with the app's guards and
 * reactions), to check what only a whole request shows:
 * - a person's click signs the recipient in, as often as they click it, and
 *   opens the request; the session skips the step-up page but has no second
 *   step, so changes that need a confirmation ask for one straight away;
 * - anything else (no person's click, someone else signed in, a link that
 *   can't be used) goes to the confirmation page without a session, and the
 *   page's own Continue (a same-origin POST) signs in, also where the browser
 *   never says a person clicked (Safari, decision 0038), and is the only way
 *   to switch accounts, never a link marked as one; a POST that comes back to
 *   the page marks it to wait for a click;
 * - a link ends with the user's trusted devices, and is capped per hour.
 */
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  auditEvent,
  membership,
  rateLimitBucket,
  requestSignInLink,
  session,
  user,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { mustStepUp, needsFreshSignIn, needsRecentConfirmation } from '@/lib/authz/mfa';
import { defined } from '@/lib/defined';
import { env } from '@/lib/env';
import { requestLinkPath } from '@/lib/sign-in/request-link';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  addMember,
  addPassword,
  createCompany,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  fillRateLimitBucket,
  setupTestContext,
  staffActor,
  storeAssignedRequest,
} from '../../../tests/integration/helpers';
import { getOptionalActor } from '../authz';
import { RATE_LIMITS } from '../rate-limit';
import { createRequestLink, getRequestLinkView } from './request-links';
import { revokeOtherOwnSessions, endSessionsOf } from './sessions';

/** The request a page renders for; tests set its headers (e.g. the browser's cookies). */
const pageRequest = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
// What pages read the signed-in user with (`src/server/authz.ts`), outside Next.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => pageRequest.headers) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
// Pages record activity in the background; it isn't what these tests are about.
vi.mock('../background', () => ({ default: vi.fn() }));

const { ctx, db } = setupTestContext();

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(async () => {
  await createStaffSettings(db);
});

/** A click on the link in an email in a webmail tab: a navigation a person made from another site. */
const CLICK_IN_EMAIL = {
  'sec-fetch-site': 'cross-site',
  'sec-fetch-user': '?1',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

/**
 * A click on a page of the site: the confirmation page's Continue, or a link
 * in a reply. Only the Continue is a POST.
 */
const CLICK_ON_PAGE = { ...CLICK_IN_EMAIL, 'sec-fetch-site': 'same-origin' };

/** The site's origin, which a POST from its pages names (`Origin`). */
const SITE_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

/**
 * The confirmation page's Continue in Safari, or sent by the page itself: a
 * same-origin page load without `Sec-Fetch-User`, which WebKit never sends.
 */
const CONTINUE_WITHOUT_CLICK = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  origin: SITE_ORIGIN,
};

/** A mail scanner that opens the link to check it: no browser, so no `Sec-Fetch-*` headers. */
const SCANNER = {};

/**
 * A browser talking to Better Auth: it keeps the cookies responses set and
 * drops the ones they expire, and sends them with every request but another
 * site's POST, as the app's `SameSite=Lax` cookies are sent.
 *
 * @returns The browser.
 */
function newBrowser() {
  const cookies = new Map<string, string>();

  /**
   * The cookies it sends.
   *
   * @returns A `Cookie` header.
   */
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  return {
    cookie,

    /**
     * Sends a request link, keeping the cookies the response sets.
     *
     * @param token - The link's token.
     * @param headers - The `Sec-Fetch-*` headers (and `Origin`) of how it was sent.
     * @param options - Options.
     * @param options.posted - Whether it's posted, as the confirmation page's Continue is.
     * @param options.auto - Whether the page posted it by itself (`auto=1`).
     * @param options.entry - The entry the link names, if any.
     * @param options.query - Anything else written into the link's query.
     * @returns The response.
     */
    async send(
      token: string,
      headers: Record<string, string>,
      {
        posted = false,
        auto = false,
        entry = null,
        query = '',
      }: { posted?: boolean; auto?: boolean; entry?: string | null; query?: string } = {},
    ): Promise<Response> {
      const form = new URLSearchParams({ token });
      if (entry) {
        form.set('entry', entry);
      }
      if (auto) {
        form.set('auto', '1');
      }
      // `SameSite=Lax`: another site's POST carries none of the site's cookies.
      const sent: Record<string, string> =
        posted && headers['sec-fetch-site'] === 'cross-site' ? {} : { cookie: cookie() };
      const response = await auth.handler(
        posted
          ? new Request(`${env.BETTER_AUTH_URL}/api/auth/request-link/sign-in`, {
              method: 'POST',
              headers: {
                ...headers,
                'content-type': 'application/x-www-form-urlencoded',
                ...sent,
              },
              body: form,
            })
          : new Request(`${env.BETTER_AUTH_URL}${requestLinkPath(token, { entry })}${query}`, {
              headers: { ...headers, cookie: cookie() },
            }),
      );
      response.headers.getSetCookie().forEach((set) => {
        const pair = defined(set.split(';')[0], 'the cookie name and value');
        const name = pair.slice(0, pair.indexOf('='));
        const value = pair.slice(pair.indexOf('=') + 1);
        if (value === '' || /max-age=0/i.test(set)) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      });
      return response;
    },

    /**
     * Opens a request link (or posts it, as the page's Continue), keeping the
     * cookies the response sets: a link is redirected with a 302, a POST with
     * a 303.
     *
     * @param token - The link's token.
     * @param headers - The `Sec-Fetch-*` headers (and `Origin`) of how it was sent.
     * @param options - As for `send`.
     * @param options.posted - Whether it's posted, as the confirmation page's Continue is.
     * @param options.auto - Whether the page posted it by itself (`auto=1`).
     * @param options.entry - The entry the link names, if any.
     * @param options.query - Anything else written into the link's query.
     * @returns Where the response sends the browser, as a path and query.
     */
    async open(
      token: string,
      headers: Record<string, string>,
      options: { posted?: boolean; auto?: boolean; entry?: string | null; query?: string } = {},
    ): Promise<string> {
      const response = await this.send(token, headers, options);
      expect(response.status).toBe(options.posted ? 303 : 302);
      const location = new URL(defined(response.headers.get('location'), 'the redirect'));
      return `${location.pathname}${location.search}`;
    },
  };
}

/**
 * Reads who a browser is signed in as, as a page does.
 *
 * @param browser - The browser.
 * @returns The actor, or `null` when signed out.
 */
async function actorIn(browser: ReturnType<typeof newBrowser>) {
  pageRequest.headers = new Headers({ cookie: browser.cookie() });
  // `getOptionalActor` is cached per request with React's `cache`, which is a no-op here.
  return getOptionalActor();
}

/**
 * A company with a request, and a Client there who gets emails about it.
 *
 * @returns The Client's ID, the request's ID and number, and the company's ID.
 */
async function clientWithRequest() {
  const company = await createCompany(db);
  const client = await createUser(db, 'casey@adiutor.test');
  await addMember(db, company.id, client, 'client');
  const requestId = await storeAssignedRequest(db, company.id, []);
  return { client, requestId, companyId: company.id };
}

/**
 * The sessions of a user.
 *
 * @param userId - The user.
 * @returns Their sessions' IDs and facts.
 */
function sessionsOf(userId: string) {
  return db
    .select({
      id: session.id,
      fromRequestLink: session.fromRequestLink,
      mfaVerified: session.mfaVerified,
    })
    .from(session)
    .where(eq(session.userId, userId));
}

/** Where every link of these tests opens: the first request's page. */
const REQUEST_PAGE = '/requests/1';

describe('the link in an email about a request', () => {
  it('stores only the hash of its token', async () => {
    const { client, requestId } = await clientWithRequest();

    const token = await createRequestLink(db, { userId: client, requestId });

    const [stored] = await db.select().from(requestSignInLink);
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60_000);
  });

  it("signs a person's click in and opens the request, past the second step", async () => {
    const { client, requestId } = await clientWithRequest();
    await enableTwoFactor(db, client);
    const token = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);

    expect(await sessionsOf(client)).toEqual([
      { id: expect.any(String), fromRequestLink: true, mfaVerified: false },
    ]);
    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.id).toBe(client);
    expect(actor.fromRequestLink).toBe(true);
    // Not sent to the step-up page, but every change that needs a confirmation asks for one.
    expect(mustStepUp(actor)).toBe(false);
    expect(actor.mfaConfirmedUntil).toBeNull();
    expect(needsRecentConfirmation(actor)).toBe(true);
    expect(actor.strongMfaConfirmedUntil).toBeNull();
    // Recorded as a sign-in with the link.
    const events = await db
      .select({ action: auditEvent.action, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, client));
    expect(events).toEqual([{ action: 'sign_in', details: { method: 'request_link' } }]);
    const [link] = await db.select().from(requestSignInLink);
    expect(link?.lastUsedAt).not.toBeNull();
  });

  it('lets a role that requires MFA in without the second step, but asks for it to change anything', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id);
    const requestId = await storeAssignedRequest(db, company.id, [manager.id]);
    const token = await createRequestLink(db, { userId: manager.id, requestId });
    const browser = newBrowser();

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);

    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.mfaRequired).toBe(true);
    expect(mustStepUp(actor)).toBe(false);
    expect(needsRecentConfirmation(actor)).toBe(true);
  });

  it('never counts as a fresh sign-in for an account without a second step', async () => {
    const { client, requestId } = await clientWithRequest();
    await addPassword(db, client);
    const token = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();

    await browser.open(token, CLICK_IN_EMAIL);

    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.signedInAt).toBeNull();
    expect(needsFreshSignIn(actor)).toBe(true);
  });

  it('signs in with every click on another browser, and starts nothing new where it signed in', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const first = newBrowser();
    const second = newBrowser();

    await first.open(token, CLICK_IN_EMAIL);
    expect(await first.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(1);

    expect(await second.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(2);
  });

  it("sends anything but a person's click to the confirmation page, without a session", async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    expect(await newBrowser().open(token, SCANNER)).toBe(`/auth/request-link?token=${token}`);
    expect(
      await newBrowser().open(token, { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }),
    ).toBe(`/auth/request-link?token=${token}`);

    expect(await sessionsOf(client)).toEqual([]);
  });

  it('asks before switching from someone else, and only the page itself may switch', async () => {
    const { client, requestId, companyId } = await clientWithRequest();
    const colleague = await createUser(db, 'colin@adiutor.test');
    await addMember(db, companyId, colleague, 'client');
    const browser = newBrowser();
    await browser.open(
      await createRequestLink(db, { userId: colleague, requestId }),
      CLICK_IN_EMAIL,
    );
    const token = await createRequestLink(db, { userId: client, requestId });
    const page = `/auth/request-link?token=${token}`;

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(page);
    // A link on a page of the site (written in a reply) is no Continue, whatever its query says.
    expect(await browser.open(token, CLICK_ON_PAGE, { query: '&confirmed=1' })).toBe(page);
    // Another site's form, clicked here: it says a person clicked, and comes without the
    // browser's cookies, so nobody looks signed in. A POST is never a click, though: it's sent back
    // to the page, which then waits for a click, and the browser stays the colleague's (outside
    // tests Better Auth's form check, `formCsrfMiddleware`, refuses it first).
    expect(
      await browser.open(
        token,
        { ...CLICK_IN_EMAIL, origin: 'https://mail.adiutor.test' },
        { posted: true },
      ),
    ).toBe(`${page}&retry=1`);
    expect(await sessionsOf(client)).toEqual([]);
    expect(await sessionsOf(colleague)).toHaveLength(1);
    expect((await actorIn(browser))?.id).toBe(colleague);

    // The page's own Continue, a same-origin POST, switches.
    expect(
      await browser.open(token, { ...CLICK_ON_PAGE, origin: SITE_ORIGIN }, { posted: true }),
    ).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(1);
    // The colleague's session in this browser ended, as signing out would.
    expect(await sessionsOf(colleague)).toEqual([]);
    expect((await actorIn(browser))?.id).toBe(client);
  });

  it("signs in with the page's own Continue where the browser never says a person clicked", async () => {
    const { client, requestId, companyId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    // Nobody signed in: Safari's first visit gets the page, whose Continue (sent by itself) signs in.
    const browser = newBrowser();
    expect(await browser.open(token, CONTINUE_WITHOUT_CLICK)).toBe(
      `/auth/request-link?token=${token}`,
    );
    // A link marked as the Continue is still only a link.
    expect(await browser.open(token, CONTINUE_WITHOUT_CLICK, { query: '&confirmed=1' })).toBe(
      `/auth/request-link?token=${token}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
    expect(await browser.open(token, CONTINUE_WITHOUT_CLICK, { posted: true, auto: true })).toBe(
      REQUEST_PAGE,
    );
    expect(await sessionsOf(client)).toEqual([
      expect.objectContaining({ fromRequestLink: true, mfaVerified: false }),
    ]);
    expect((await actorIn(browser))?.id).toBe(client);

    // Someone else signed in: the Continue the page sends by itself (rendered before they signed
    // in in another tab) never switches; pressed in Safari, it does.
    const colleague = await createUser(db, 'colin@adiutor.test');
    await addMember(db, companyId, colleague, 'client');
    const theirs = newBrowser();
    await theirs.open(
      await createRequestLink(db, { userId: colleague, requestId }),
      CLICK_IN_EMAIL,
    );
    expect(await theirs.open(token, CONTINUE_WITHOUT_CLICK, { posted: true, auto: true })).toBe(
      `/auth/request-link?token=${token}&retry=1`,
    );
    expect((await actorIn(theirs))?.id).toBe(colleague);
    expect(await sessionsOf(client)).toHaveLength(1);
    expect(await theirs.open(token, CONTINUE_WITHOUT_CLICK, { posted: true })).toBe(REQUEST_PAGE);
    expect(await sessionsOf(colleague)).toEqual([]);
    expect((await actorIn(theirs))?.id).toBe(client);
  });

  it.each([
    ['from another site', { ...CONTINUE_WITHOUT_CLICK, 'sec-fetch-site': 'cross-site' }],
    ['typed in', { ...CONTINUE_WITHOUT_CLICK, 'sec-fetch-site': 'none' }],
    [
      "from the site's own script, not a page load",
      { ...CONTINUE_WITHOUT_CLICK, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    ],
    ['in a frame', { ...CONTINUE_WITHOUT_CLICK, 'sec-fetch-dest': 'iframe' }],
    ["by a browser that doesn't say where it came from", SCANNER],
  ])(
    "sends a Continue that isn't the page's back to it without a session, marked to wait for a click (%s)",
    async (_case, headers) => {
      const { client, requestId } = await clientWithRequest();
      const token = await createRequestLink(db, { userId: client, requestId });

      expect(await newBrowser().open(token, headers, { posted: true })).toBe(
        `/auth/request-link?token=${token}&retry=1`,
      );
      expect(await sessionsOf(client)).toEqual([]);
    },
  );

  it.each([
    [
      'expired',
      async (link: { id: string }) => {
        await db
          .update(requestSignInLink)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(requestSignInLink.id, link.id));
      },
    ],
    [
      'for a deactivated account',
      async (link: { userId: string }) => {
        await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, link.userId));
      },
    ],
    [
      'for someone no longer at the company',
      async (link: { userId: string }) => {
        await db.delete(membership).where(eq(membership.userId, link.userId));
      },
    ],
  ])('refuses a link %s, without a session', async (_case, makeUnusable) => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const [link] = await db.select().from(requestSignInLink);
    await makeUnusable(defined(link, 'the link'));

    expect(await newBrowser().open(token, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${token}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });

  it("never takes another site's form for a click, also with nobody signed in", async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    expect(
      await newBrowser().open(
        token,
        { ...CLICK_IN_EMAIL, origin: 'https://mail.adiutor.test' },
        { posted: true },
      ),
    ).toBe(`/auth/request-link?token=${token}&retry=1`);
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('takes the page’s Continue with the entry the link points at, and a POST without one', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const entry = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

    // Nobody signed in: the page's Continue signs in and opens the request at the entry.
    expect(
      await newBrowser().open(
        token,
        { ...CLICK_ON_PAGE, origin: SITE_ORIGIN },
        { posted: true, entry },
      ),
    ).toBe(`${REQUEST_PAGE}?entry=${entry}`);
    expect(await sessionsOf(client)).toEqual([
      expect.objectContaining({ fromRequestLink: true, mfaVerified: false }),
    ]);
    // A POST that isn't a form (a script's JSON) isn't taken.
    const json = await auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/request-link/sign-in`, {
        method: 'POST',
        headers: { ...CLICK_ON_PAGE, origin: SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    );
    expect(json.status).toBe(415);
    expect(await sessionsOf(client)).toHaveLength(1);
  });

  it('passes the entry it points at on to the request, the confirmation page and the sign-in page', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const entry = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

    // A scanner's visit keeps it on the way to the confirmation page.
    expect(await newBrowser().open(token, SCANNER, { entry })).toBe(
      `/auth/request-link?token=${token}&entry=${entry}`,
    );
    // A click opens the request at it.
    const browser = newBrowser();
    expect(await browser.open(token, CLICK_IN_EMAIL, { entry })).toBe(
      `${REQUEST_PAGE}?entry=${entry}`,
    );
    // Clicked again where it signed in, it still names it.
    expect(await browser.open(token, CLICK_IN_EMAIL, { entry })).toBe(
      `${REQUEST_PAGE}?entry=${entry}`,
    );
    // Past its sign-ins for the hour (a link of its own, so no click counted yet), the sign-in page
    // returns to it.
    const limited = await createRequestLink(db, { userId: client, requestId });
    const [link] = await db
      .select({ id: requestSignInLink.id })
      .from(requestSignInLink)
      .where(eq(requestSignInLink.tokenHash, hashToken(limited)));
    await fillRateLimitBucket(
      db,
      `request-link-sign-in:link:${defined(link, 'the link').id}`,
      RATE_LIMITS.requestLinkSignInsPerLink.limit,
    );
    expect(await newBrowser().open(limited, CLICK_IN_EMAIL, { entry })).toBe(
      `/auth?${new URLSearchParams({ callbackURL: `${REQUEST_PAGE}?entry=${entry}` })}`,
    );
  });

  it('leaves out an entry that isn’t an entry’s ID', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const response = await auth.handler(
      new Request(
        `${env.BETTER_AUTH_URL}/api/auth/request-link/sign-in?token=${token}&entry=%2F%2Fadiutor.dev`,
        { headers: CLICK_IN_EMAIL },
      ),
    );

    const location = new URL(defined(response.headers.get('location'), 'the redirect'));
    expect(`${location.pathname}${location.search}`).toBe(REQUEST_PAGE);
  });

  it('counts tokens that are no link against the IP address', async () => {
    const { client } = await clientWithRequest();

    expect(await newBrowser().open('not-a-link', CLICK_IN_EMAIL)).toBe(
      '/auth/request-link?token=not-a-link',
    );

    expect(
      await db
        .select({ key: rateLimitBucket.key, count: rateLimitBucket.count })
        .from(rateLimitBucket)
        .where(like(rateLimitBucket.key, 'request-link-miss:ip:%')),
    ).toEqual([{ key: expect.any(String), count: 1 }]);
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('sends the browser to the sign-in page once the link signed in too often this hour', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const [link] = await db.select({ id: requestSignInLink.id }).from(requestSignInLink);
    await fillRateLimitBucket(
      db,
      `request-link-sign-in:link:${defined(link, 'the link').id}`,
      RATE_LIMITS.requestLinkSignInsPerLink.limit,
    );

    expect(await newBrowser().open(token, CLICK_IN_EMAIL)).toBe(
      `/auth?${new URLSearchParams({ callbackURL: REQUEST_PAGE })}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('ends when the user is signed out everywhere, or signs out their other devices', async () => {
    const { client, requestId } = await clientWithRequest();
    const first = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();
    await browser.open(first, CLICK_IN_EMAIL);

    await revokeOtherOwnSessions(ctx, defined(await actorIn(browser), 'the signed-in user'));
    expect(await newBrowser().open(first, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${first}`,
    );

    const second = await createRequestLink(db, { userId: client, requestId });
    await endSessionsOf(db, client);
    expect(await newBrowser().open(second, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${second}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });
});

describe('looking a request link up for its page', () => {
  it('names the account and the request of a link that can be used', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    expect(await getRequestLinkView(ctx, token)).toEqual({
      state: 'usable',
      linkId: expect.any(String),
      number: 1,
      reference: 'AD-1',
      account: { userId: client, name: 'casey', email: 'casey@adiutor.test' },
    });
  });

  it('names only the request of a link that ended or that its person can no longer use', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    await db
      .delete(membership)
      .where(and(eq(membership.userId, client), eq(membership.role, 'client')));
    expect(await getRequestLinkView(ctx, token)).toEqual({ state: 'unavailable', number: 1 });

    await endSessionsOf(db, client);
    expect(await getRequestLinkView(ctx, token)).toEqual({ state: 'ended', number: 1 });
    expect(await getRequestLinkView(ctx, 'not-a-link')).toEqual({ state: 'unknown' });
  });
});

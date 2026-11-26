/**
 * @file Integration tests for people's pictures: which one shows, the
 * account page's choices, saving a choice, and serving a picture at
 * `/avatars/<account>`: to whom (the picture shown to everyone, the other
 * choices to their owner alone), fetched from its provider within its
 * limits. Which roles may choose is in the authorization matrix.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { account, user } from '@/db/schema';
import type { Permission } from '@/lib/authz/permissions';

import {
  connectProvider,
  createUser,
  minutesAgo,
  setupTestContext,
  actorFor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import {
  loadPicture,
  loadPictures,
  MAX_PICTURE_BYTES,
  ownPictureChoices,
  setOwnPicture,
} from './pictures';

const { ctx, db } = setupTestContext();

/** A GitHub picture's address. */
const GITHUB_PICTURE = 'https://avatars.githubusercontent.com/u/1?v=4';

/** A Google picture's address. */
const GOOGLE_PICTURE = 'https://lh3.googleusercontent.com/a/adiutor=s96-c';

/**
 * The unkeyed 32-bit FNV-1a of {@link GITHUB_PICTURE}, which picture addresses
 * once held: anyone could work it out for every GitHub account number.
 */
const UNKEYED_FINGERPRINT = '907fda90';

/**
 * The address a picture of an account is served from, whatever its version.
 *
 * @param accountId - The account.
 * @returns A pattern that matches the address.
 */
const servedFrom = (accountId: string) => new RegExp(`^/avatars/${accountId}\\?v=[0-9a-f]{16}$`);

/**
 * The version in a picture's address (`?v=`).
 *
 * @param address - The address, e.g. `/avatars/0198…?v=…`.
 * @returns The version, or `null` without one.
 */
const versionOf = (address: string | null | undefined) =>
  address ? new URL(address, 'https://adiutor.test').searchParams.get('v') : null;

/**
 * A user with a GitHub account connected first and a Google account second,
 * both with a picture.
 *
 * @returns The user and their accounts' IDs.
 */
async function personWithTwoPictures() {
  const userId = await createUser(db, `person-${randomUUID().slice(0, 8)}@adiutor.test`);
  const github = await connectProvider(db, userId, {
    providerId: 'github',
    accountName: 'adiutor-tests',
    accountImage: GITHUB_PICTURE,
    createdAt: minutesAgo(10),
  });
  const google = await connectProvider(db, userId, {
    providerId: 'google',
    accountName: 'person@adiutor.test',
    accountImage: GOOGLE_PICTURE,
    createdAt: minutesAgo(5),
  });
  return { userId, github, google };
}

/**
 * A user as the actor while a staff member with these global permissions is
 * signed in as them.
 *
 * @param own - The user, as their own actor.
 * @param staffPermissions - The staff member's own global permissions.
 * @returns The actor.
 */
const signedInAsBy = (own: Actor, staffPermissions: Permission[]): Actor => ({
  ...own,
  signedInAs: {
    staffId: '01900000-0000-7000-8000-000000000001',
    staffName: 'Sam Support',
    endsAt: new Date(Date.now() + 30 * 60_000),
    returnTo: '/dashboard',
    staffPermissions,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadPictures', () => {
  it('shows the account connected first until someone chooses, and initials without any', async () => {
    const { userId, github } = await personWithTwoPictures();
    const nobody = await createUser(db, 'nobody@adiutor.test');

    const pictures = await loadPictures(db, [userId, nobody, null, userId]);

    expect(pictures.get(userId)).toMatch(servedFrom(github));
    expect(pictures.get(nobody)).toBeNull();
    expect(pictures.size).toBe(2);
  });

  it('shows the chosen provider, or initials when chosen', async () => {
    const { userId, google } = await personWithTwoPictures();

    await db.update(user).set({ avatarSource: 'google' }).where(eq(user.id, userId));
    expect((await loadPictures(db, [userId])).get(userId)).toMatch(servedFrom(google));

    await db.update(user).set({ avatarSource: 'initials' }).where(eq(user.id, userId));
    expect((await loadPictures(db, [userId])).get(userId)).toBeNull();
  });

  it('falls back to the default once the chosen account is disconnected', async () => {
    const { userId, github, google } = await personWithTwoPictures();
    await db.update(user).set({ avatarSource: 'google' }).where(eq(user.id, userId));

    await db.delete(account).where(eq(account.id, google));

    expect((await loadPictures(db, [userId])).get(userId)).toMatch(servedFrom(github));
  });

  it('never shows an account the user hasn’t confirmed', async () => {
    const userId = await createUser(db, 'unconfirmed@adiutor.test');
    await connectProvider(db, userId, { accountImage: GITHUB_PICTURE, confirmed: false });

    expect((await loadPictures(db, [userId])).get(userId)).toBeNull();
  });

  it('changes the address when the provider’s picture changes', async () => {
    const { userId, github } = await personWithTwoPictures();
    const before = (await loadPictures(db, [userId])).get(userId);

    await db
      .update(account)
      .set({ accountImage: 'https://avatars.githubusercontent.com/u/1?v=5' })
      .where(eq(account.id, github));

    const after = (await loadPictures(db, [userId])).get(userId);
    expect(after).toMatch(servedFrom(github));
    expect(after).not.toBe(before);
  });

  it('keeps the address while the provider’s picture stays the same', async () => {
    const { userId } = await personWithTwoPictures();
    const first = (await loadPictures(db, [userId])).get(userId);

    expect((await loadPictures(db, [userId])).get(userId)).toBe(first);
    const { choices } = await ownPictureChoices(ctx, await actorFor(db, userId));
    expect(choices[0]?.picture).toBe(first);
  });

  it('versions the address with the app’s secret, so nobody can work it out from a guess', async () => {
    const { userId } = await personWithTwoPictures();
    const version = versionOf((await loadPictures(db, [userId])).get(userId));
    expect(version).not.toBeNull();
    expect(version).not.toContain(UNKEYED_FINGERPRINT);

    // The same picture, in an app started with another secret.
    vi.resetModules();
    vi.stubEnv('BETTER_AUTH_SECRET', 'adiutor-tests-another-secret-0123456789');
    const elsewhere = await import('./pictures');
    const otherVersion = versionOf((await elsewhere.loadPictures(db, [userId])).get(userId));

    expect(otherVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(otherVersion).not.toBe(version);
  });

  it('versions the address anew once the secret is rotated, so the old one is no use', async () => {
    const { userId } = await personWithTwoPictures();
    const version = versionOf((await loadPictures(db, [userId])).get(userId));

    // The same picture, in the app after a rotation: the old secret stays, a new one comes first.
    vi.resetModules();
    vi.stubEnv('BETTER_AUTH_SECRETS', '1:adiutor-tests-rotated-secret-0123456789');
    const rotated = await import('./pictures');
    const rotatedVersion = versionOf((await rotated.loadPictures(db, [userId])).get(userId));

    expect(rotatedVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(rotatedVersion).not.toBe(version);
  });
});

describe('choosing a picture', () => {
  it('offers each provider’s picture, and says which shows until someone chooses', async () => {
    const { userId, github, google } = await personWithTwoPictures();

    const { choices, source, shown } = await ownPictureChoices(ctx, await actorFor(db, userId));

    expect(source).toBeNull();
    expect(shown).toBe('github');
    expect(choices).toEqual([
      {
        providerId: 'github',
        accountName: 'adiutor-tests',
        hasPicture: true,
        picture: expect.stringMatching(servedFrom(github)),
      },
      {
        providerId: 'google',
        accountName: 'person@adiutor.test',
        hasPicture: true,
        picture: expect.stringMatching(servedFrom(google)),
      },
    ]);
  });

  it('gives a staff member signed in as the user the address of the picture in use only', async () => {
    const { userId, google } = await personWithTwoPictures();
    await db.update(user).set({ avatarSource: 'google' }).where(eq(user.id, userId));
    // Even a staff Admin, who sees the accounts' names: the route wouldn't serve them the other.
    const staff = signedInAsBy(await actorFor(db, userId), ['users:manage', 'audit:view']);

    const { choices, shown } = await ownPictureChoices(ctx, staff);

    expect(shown).toBe('google');
    expect(
      choices.map(({ providerId, hasPicture, picture }) => [providerId, hasPicture, picture]),
    ).toEqual([
      ['github', true, null],
      ['google', true, expect.stringMatching(servedFrom(google))],
    ]);
    // With initials shown, no address at all.
    await db.update(user).set({ avatarSource: 'initials' }).where(eq(user.id, userId));
    const initials = await ownPictureChoices(ctx, staff);
    expect(initials.choices.map(({ picture }) => picture)).toEqual([null, null]);
  });

  it('offers an account without a picture yet, which can’t be chosen', async () => {
    const userId = await createUser(db, 'later@adiutor.test');
    await connectProvider(db, userId, { accountName: 'adiutor-tests' });
    const actor = await actorFor(db, userId);

    expect((await ownPictureChoices(ctx, actor)).choices).toEqual([
      { providerId: 'github', accountName: 'adiutor-tests', hasPicture: false, picture: null },
    ]);
    await expect(setOwnPicture(ctx, actor, 'github')).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.account.pictureUnavailable',
    });
  });

  it('saves a provider or initials, and refuses anything else', async () => {
    const { userId } = await personWithTwoPictures();
    const actor = await actorFor(db, userId);

    expect(await setOwnPicture(ctx, actor, 'google')).toBe('google');
    expect((await ownPictureChoices(ctx, actor)).shown).toBe('google');
    expect(await setOwnPicture(ctx, actor, 'initials')).toBe('initials');
    const afterInitials = await ownPictureChoices(ctx, actor);
    expect(afterInitials.shown).toBe('initials');
    // They still see each picture they can choose.
    expect(afterInitials.choices.map(({ picture }) => picture)).toEqual([
      expect.stringMatching(/^\/avatars\//),
      expect.stringMatching(/^\/avatars\//),
    ]);

    await expect(setOwnPicture(ctx, actor, 'gitlab')).rejects.toMatchObject({ code: 'invalid' });
    const nobody = await actorFor(db, await createUser(db, 'nothing@adiutor.test'));
    await expect(setOwnPicture(ctx, nobody, 'google')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('loadPicture', () => {
  /** A tiny PNG's first bytes: enough to tell it from anything else. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  /** The picture served when the provider answers with {@link PNG}. */
  const SERVED = { body: PNG, contentType: 'image/png' };

  /**
   * Makes the provider answer every fetch with this response.
   *
   * @param response - What it answers.
   * @returns The stubbed fetch, to see what was asked.
   */
  const providerAnswers = (response: () => Response | Promise<Response>) => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  /**
   * Makes the provider answer every fetch with a picture.
   *
   * @returns The stubbed fetch, to see what was asked.
   */
  const providerServesPictures = () =>
    providerAnswers(() => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));

  /**
   * Someone signed in who isn't the pictures' owner.
   *
   * @returns Their actor.
   */
  const someoneElse = async () =>
    actorFor(db, await createUser(db, `viewer-${randomUUID().slice(0, 8)}@adiutor.test`));

  it('serves the picture someone shows, fetched from its provider without following redirects', async () => {
    const { github } = await personWithTwoPictures();
    const fetchMock = providerServesPictures();

    const picture = await loadPicture(ctx, await someoneElse(), github);

    expect(picture).toEqual(SERVED);
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_PICTURE,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('serves others nothing for an account that isn’t the picture its owner shows', async () => {
    const { userId, github, google } = await personWithTwoPictures();
    const fetchMock = providerServesPictures();
    const viewer = await someoneElse();

    // Google isn't shown (GitHub was connected first), and nothing is after choosing initials.
    expect(await loadPicture(ctx, viewer, google)).toBeNull();
    await db.update(user).set({ avatarSource: 'initials' }).where(eq(user.id, userId));
    expect(await loadPicture(ctx, viewer, github)).toBeNull();
    expect(await loadPicture(ctx, viewer, randomUUID())).toBeNull();
    expect(await loadPicture(ctx, viewer, 'not-an-id')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['until they choose', null],
    ['after choosing Google', 'google'],
    ['after choosing initials', 'initials'],
  ] as const)('serves its owner every picture they can choose, %s', async (_when, choice) => {
    // What the account page asks for once the browser's own copies have expired: the server
    // keeps none, so each is fetched from its provider again, the one in use or not.
    const { userId, github, google } = await personWithTwoPictures();
    await db.update(user).set({ avatarSource: choice }).where(eq(user.id, userId));
    const fetchMock = providerServesPictures();
    const owner = await actorFor(db, userId);

    expect(await loadPicture(ctx, owner, github)).toEqual(SERVED);
    expect(await loadPicture(ctx, owner, google)).toEqual(SERVED);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, GITHUB_PICTURE, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, GOOGLE_PICTURE, expect.anything());
  });

  it('serves a staff member signed in as the owner only the picture they show', async () => {
    const { userId, github, google } = await personWithTwoPictures();
    const fetchMock = providerServesPictures();
    // Even a staff Admin, who sees the accounts' names.
    const staff = signedInAsBy(await actorFor(db, userId), ['users:manage', 'audit:view']);

    expect(await loadPicture(ctx, staff, github)).toEqual(SERVED);
    expect(await loadPicture(ctx, staff, google)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never serves its owner an account they can’t choose', async () => {
    const userId = await createUser(db, `owner-${randomUUID().slice(0, 8)}@adiutor.test`);
    await connectProvider(db, userId, { accountImage: GITHUB_PICTURE, createdAt: minutesAgo(10) });
    // A second GitHub account (the first one is GitHub's choice), and one not confirmed yet.
    const secondGithub = await connectProvider(db, userId, {
      accountImage: 'https://avatars.githubusercontent.com/u/2?v=4',
      createdAt: minutesAgo(5),
    });
    const unconfirmed = await connectProvider(db, userId, {
      providerId: 'google',
      accountImage: GOOGLE_PICTURE,
      confirmed: false,
    });
    const fetchMock = providerServesPictures();
    const owner = await actorFor(db, userId);

    expect(await loadPicture(ctx, owner, secondGithub)).toBeNull();
    expect(await loadPicture(ctx, owner, unconfirmed)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an image type that isn’t served',
      () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    ],
    [
      'a failed answer',
      () => new Response(PNG, { status: 404, headers: { 'Content-Type': 'image/png' } }),
    ],
    [
      'a picture that says it’s too large',
      () =>
        new Response(PNG, {
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_PICTURE_BYTES + 1) },
        }),
    ],
    [
      'a picture that turns out too large',
      () =>
        new Response(new Uint8Array(MAX_PICTURE_BYTES + 1), {
          headers: { 'Content-Type': 'image/png' },
        }),
    ],
    [
      'a redirect, a time-out or the provider being down',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('serves nothing for %s', async (_what, response) => {
    const { github } = await personWithTwoPictures();
    providerAnswers(response);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await loadPicture(ctx, await someoneElse(), github)).toBeNull();
    // Never the address in the logs.
    expect(JSON.stringify(errors.mock.calls)).not.toContain('githubusercontent');
    errors.mockRestore();
  });

  it('never fetches an address that isn’t on the provider’s picture hosts', async () => {
    const userId = await createUser(db, 'stored@adiutor.test');
    const github = await connectProvider(db, userId, {
      accountImage: 'https://pictures.adiutor.test/me.png',
    });
    const fetchMock = providerServesPictures();

    expect(await loadPicture(ctx, await actorFor(db, userId), github)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * @file Integration tests for people's pictures: which one shows, the
 * account page's choices, saving a choice, and fetching a picture from its
 * provider for `/avatars/<account>`, within its limits. Which roles may
 * choose is in the authorization matrix.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { account, user } from '@/db/schema';

import {
  connectProvider,
  createUser,
  minutesAgo,
  setupTestContext,
  actorFor,
} from '../../../tests/integration/helpers';
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
        picture: expect.stringMatching(servedFrom(github)),
      },
      {
        providerId: 'google',
        accountName: 'person@adiutor.test',
        picture: expect.stringMatching(servedFrom(google)),
      },
    ]);
  });

  it('offers an account without a picture yet, which can’t be chosen', async () => {
    const userId = await createUser(db, 'later@adiutor.test');
    await connectProvider(db, userId, { accountName: 'adiutor-tests' });
    const actor = await actorFor(db, userId);

    expect((await ownPictureChoices(ctx, actor)).choices).toEqual([
      { providerId: 'github', accountName: 'adiutor-tests', picture: null },
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
    expect((await ownPictureChoices(ctx, actor)).shown).toBe('initials');

    await expect(setOwnPicture(ctx, actor, 'gitlab')).rejects.toMatchObject({ code: 'invalid' });
    const nobody = await actorFor(db, await createUser(db, 'nothing@adiutor.test'));
    await expect(setOwnPicture(ctx, nobody, 'google')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('loadPicture', () => {
  /** A tiny PNG's first bytes: enough to tell it from anything else. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

  it('serves the picture someone shows, fetched from its provider without following redirects', async () => {
    const { github } = await personWithTwoPictures();
    const fetchMock = providerAnswers(
      () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    );

    const picture = await loadPicture(ctx, github);

    expect(picture).toEqual({ body: PNG, contentType: 'image/png' });
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_PICTURE,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('serves nothing for an account that isn’t the picture its owner shows', async () => {
    const { userId, github, google } = await personWithTwoPictures();
    const fetchMock = providerAnswers(
      () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    );

    // Google isn't shown (GitHub was connected first), and nothing is after choosing initials.
    expect(await loadPicture(ctx, google)).toBeNull();
    await db.update(user).set({ avatarSource: 'initials' }).where(eq(user.id, userId));
    expect(await loadPicture(ctx, github)).toBeNull();
    expect(await loadPicture(ctx, randomUUID())).toBeNull();
    expect(await loadPicture(ctx, 'not-an-id')).toBeNull();
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

    expect(await loadPicture(ctx, github)).toBeNull();
    // Never the address in the logs.
    expect(JSON.stringify(errors.mock.calls)).not.toContain('githubusercontent');
    errors.mockRestore();
  });

  it('never fetches an address that isn’t on the provider’s picture hosts', async () => {
    const userId = await createUser(db, 'stored@adiutor.test');
    const github = await connectProvider(db, userId, {
      accountImage: 'https://example.org/me.png',
    });
    const fetchMock = providerAnswers(
      () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    );

    expect(await loadPicture(ctx, github)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

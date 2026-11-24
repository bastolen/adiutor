/**
 * @file People's pictures: the picture of one of their connected GitHub or
 * Google accounts, served from Adiutor's own address, or their initials.
 *
 * Which picture someone shows follows one rule (`pictureAccount` in
 * `src/lib/sign-in/pictures.ts`). The services that return people add its
 * address (`loadPictures`), for the readers who get the person's name. The
 * address is `/avatars/<account ID>?v=<version>`: it says nothing about who
 * the person is, and the provider's own address never reaches a browser, not
 * even as a fingerprint anyone could check a guess against. The route
 * there (`src/app/avatars/[account]/route.ts`) fetches the image from the
 * provider each time a browser asks for it (`loadPicture`), within limits,
 * and stores nothing. See decision 0022.
 */
import { createHmac } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { account, user } from '@/db/schema';
import {
  isOAuthProvider,
  isProviderImageUrl,
  type OAuthProvider,
} from '@/lib/sign-in/oauth-providers';
import {
  type AvatarSource,
  isAvatarSource,
  type PictureAccount,
  pictureAccount,
  pictureProviders,
} from '@/lib/sign-in/pictures';
import { idSchema } from '@/lib/validation';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import derivedSecret from '../derived-secret';
import { ServiceError } from '../errors';

/** How long fetching a picture from its provider may take. */
const FETCH_TIMEOUT_MS = 5_000;

/** The largest picture served: far more than a provider's account picture. */
export const MAX_PICTURE_BYTES = 1024 * 1024;

/** The image types served. Never SVG, which can hold scripts. */
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** A connected account, with what its picture's address is made of. */
interface AccountRow extends PictureAccount {
  /** Its user. */
  userId: string;
}

/**
 * The purpose the versions' secret is worked out for (`derivedSecret`): their
 * own, so a version is never a signature of anything else.
 */
const VERSION_PURPOSE = 'adiutor picture versions';

/** How many hexadecimal digits of its MAC a picture's version keeps: 64 bits. */
const VERSION_LENGTH = 16;

/**
 * A picture's version in Adiutor: a keyed MAC (HMAC-SHA-256, cut short) of
 * the provider's address, so the address in Adiutor changes when the
 * provider's does, and browsers fetch the new picture instead of the one
 * they kept, and stays the same otherwise. It's made with a secret, because
 * the provider's address can be guessed: a GitHub picture's address holds its
 * account's number (`https://avatars.githubusercontent.com/u/<number>?v=4`),
 * and with an unkeyed hash of it anyone who sees the version could try every
 * number until one matched. Without the app's secret, a version can't be
 * checked against any guess.
 *
 * @param address - The provider's address.
 * @returns Sixteen hexadecimal digits.
 */
function pictureVersion(address: string): string {
  return createHmac('sha256', derivedSecret(VERSION_PURPOSE))
    .update(address)
    .digest('hex')
    .slice(0, VERSION_LENGTH);
}

/**
 * The address a picture is served from in Adiutor. Only the account's ID
 * says what's served: the version (`?v=`) is for browsers' caches, and the
 * route doesn't read it.
 *
 * @param picture - The account whose picture it is.
 * @param picture.id - Its ID.
 * @param picture.image - The picture's address at the provider.
 * @returns E.g. `/avatars/0198…?v=1a2b3c4d5e6f7a8b`.
 */
function picturePath({ id, image }: { id: string; image: string }): string {
  return `/avatars/${id}?v=${pictureVersion(image)}`;
}

/**
 * The connected accounts of some users, the first connected first, with
 * each user's choice.
 *
 * @param db - Database client.
 * @param userIds - The users.
 * @returns Their accounts and choices.
 */
async function accountsOf(
  db: DatabaseOrTransaction,
  userIds: readonly string[],
): Promise<{
  rows: (AccountRow & { accountName: string | null })[];
  sources: Map<string, AvatarSource | null>;
}> {
  if (userIds.length === 0) {
    return { rows: [], sources: new Map() };
  }
  const [rows, users] = await Promise.all([
    db
      .select({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        image: account.accountImage,
        confirmed: account.confirmed,
        accountName: account.accountName,
      })
      .from(account)
      .where(inArray(account.userId, [...userIds]))
      .orderBy(asc(account.createdAt), asc(account.id)),
    db
      .select({ id: user.id, avatarSource: user.avatarSource })
      .from(user)
      .where(inArray(user.id, [...userIds])),
  ]);
  return {
    rows: rows
      .filter(({ providerId }) => isOAuthProvider(providerId))
      .map((row) => ({ ...row, confirmed: row.confirmed ?? true })),
    sources: new Map(users.map(({ id, avatarSource }) => [id, avatarSource ?? null])),
  };
}

/**
 * Loads the picture each of some users shows: the address of the picture
 * of the account the rule picks (`pictureAccount`), or `null` for their
 * initials. Two queries, however many users, for a page of people.
 *
 * Give it only to readers who get the person's name: the picture shows them
 * as much as the name does.
 *
 * @param db - Database client.
 * @param userIds - The users (repeats and accounts that are gone are fine).
 * @returns Each user's picture address, or `null`.
 */
export async function loadPictures(
  db: DatabaseOrTransaction,
  userIds: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  const { rows, sources } = await accountsOf(db, ids);
  return new Map(
    ids.map((id) => {
      const shown = pictureAccount(
        sources.get(id) ?? null,
        rows.filter(({ userId }) => userId === id),
      );
      return [id, shown?.image ? picturePath({ id: shown.id, image: shown.image }) : null];
    }),
  );
}

/** One of the pictures someone can choose on the account page. */
export interface PictureChoice {
  /** The provider whose account's picture it is. */
  providerId: OAuthProvider;
  /** The account's name at the provider (a GitHub username), when it's known. */
  accountName: string | null;
  /** The picture's address in Adiutor, or `null` while the account has none yet. */
  picture: string | null;
}

/**
 * The pictures someone can choose from, for the account page's Picture
 * card: each provider's first connected confirmed account, with its picture
 * (or none yet), what they chose, and what they show by that.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Their choices, their choice (`null` until they choose) and what's shown.
 */
export async function ownPictureChoices(
  ctx: ServiceContext,
  actor: Actor,
): Promise<{
  choices: PictureChoice[];
  source: AvatarSource | null;
  shown: AvatarSource;
}> {
  const { rows, sources } = await accountsOf(ctx.db, [actor.id]);
  const source = sources.get(actor.id) ?? null;
  const choices = pictureProviders(rows).flatMap((providerId) => {
    const first = rows.find((row) => row.providerId === providerId && row.confirmed);
    return first
      ? [
          {
            providerId,
            accountName: first.accountName,
            picture: first.image ? picturePath({ id: first.id, image: first.image }) : null,
          },
        ]
      : [];
  });
  const shownAccount = pictureAccount(source, rows);
  const shownProvider = shownAccount?.providerId;
  return {
    choices,
    source,
    shown: shownProvider && isOAuthProvider(shownProvider) ? shownProvider : 'initials',
  };
}

/**
 * Saves which picture the actor shows: their initials, or the picture of
 * their account with a provider, which must be connected, confirmed and
 * have a picture. Not a change of sign-in, role or account, so no audit
 * event: like the language, it only changes how they're shown.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param choice - `initials` or a provider ID, unchecked.
 * @returns What they show now.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as the actor,
 *   `invalid` for anything that isn't a choice, or a provider whose picture they can't use
 *   (`errors.account.pictureUnavailable`).
 */
export async function setOwnPicture(
  ctx: ServiceContext,
  actor: Actor,
  choice: unknown,
): Promise<AvatarSource> {
  assertNotSignedInAs(actor);
  if (!isAvatarSource(choice)) {
    throw new ServiceError('invalid', 'errors.account.pictureUnavailable');
  }
  if (choice !== 'initials') {
    const { choices } = await ownPictureChoices(ctx, actor);
    if (!choices.some(({ providerId, picture }) => providerId === choice && picture !== null)) {
      throw new ServiceError('invalid', 'errors.account.pictureUnavailable');
    }
  }
  await ctx.db.update(user).set({ avatarSource: choice }).where(eq(user.id, actor.id));
  return choice;
}

/** A picture to serve. */
export interface ServedPicture {
  /** The image itself. */
  body: Uint8Array<ArrayBuffer>;
  /** Its type, one of the types served. */
  contentType: (typeof PICTURE_TYPES)[number];
}

/**
 * Reads a response's body, refusing it as soon as it's larger than a
 * picture may be.
 *
 * @param response - The provider's response.
 * @returns The body, or `null` when it's too large.
 */
async function limitedBody(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- A stream is read one chunk after another.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_PICTURE_BYTES) {
      // eslint-disable-next-line no-await-in-loop -- It ends the loop: the rest isn't read.
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return body;
}

/**
 * Fetches a picture from its provider: within {@link FETCH_TIMEOUT_MS},
 * without following redirects, only from the provider's picture hosts, only
 * the image types served, and at most {@link MAX_PICTURE_BYTES}. Logs only
 * that it failed, never the address.
 *
 * @param provider - The provider.
 * @param address - The picture's address at the provider.
 * @returns The picture, or `null` when it can't be served.
 */
async function fetchPicture(
  provider: OAuthProvider,
  address: string,
): Promise<ServedPicture | null> {
  if (!isProviderImageUrl(provider, address)) {
    return null;
  }
  try {
    const response = await fetch(address, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: PICTURE_TYPES.join(', ') },
    });
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const type = PICTURE_TYPES.find((allowed) => allowed === contentType);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok || !type || declared > MAX_PICTURE_BYTES) {
      await response.body?.cancel();
      return null;
    }
    const body = await limitedBody(response);
    return body ? { body, contentType: type } : null;
  } catch {
    // eslint-disable-next-line no-console -- Never the address: only that it failed.
    console.error('Fetching a picture from its provider failed');
    return null;
  }
}

/**
 * Loads the picture served at `/avatars/<account>`: the picture of that
 * account, but only while it's the picture its owner shows. After they
 * choose another one or their initials, or disconnect it, the address no
 * longer serves anything.
 *
 * @param ctx - Service context.
 * @param accountId - The account's ID from the address (unchecked).
 * @returns The picture, or `null` when there's none to serve.
 */
export async function loadPicture(
  ctx: ServiceContext,
  accountId: string,
): Promise<ServedPicture | null> {
  const id = idSchema.safeParse(accountId);
  if (!id.success) {
    return null;
  }
  const [owner] = await ctx.db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.id, id.data)));
  if (!owner) {
    return null;
  }
  const { rows, sources } = await accountsOf(ctx.db, [owner.userId]);
  const shown = pictureAccount(sources.get(owner.userId) ?? null, rows);
  if (!shown || shown.id !== id.data || !shown.image || !isOAuthProvider(shown.providerId)) {
    return null;
  }
  return fetchPicture(shown.providerId, shown.image);
}

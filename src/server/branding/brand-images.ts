/**
 * @file The brand's images (decision 0052): the logo and the own browser tab
 * icon a staff Admin uploads on the General tab of Settings, stored in the
 * database as the PNG Adiutor drew from the upload. Uploading and removing
 * them is for staff Admins (`staff:manage`); pages, emails and the public
 * routes that serve them read them with {@link loadBrandImages} and
 * {@link loadBrandImage}, which check no permission. Imports no server-only
 * code, so the emails Better Auth sends can load it too.
 */
import { eq, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { brandImage } from '@/db/schema';
import {
  type BrandImageKind,
  type BrandImageProblem,
  brandImageProblem,
  imageFacts,
  LOGO_RATIO,
  STORED_BOX,
} from '@/lib/branding';
import { firstRow } from '@/lib/defined';
import {
  BRAND_ICON_MIN_SIDE,
  BRAND_IMAGE_MAX_MB,
  BRAND_IMAGE_MAX_SIDE,
  BRAND_LOGO_MIN_HEIGHT,
} from '@/lib/input-rules';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { type ErrorMessageValues, ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { redrawImage } from './draw-image';

/** What pages and emails need of a brand image: its ID, which is its version, and its size. */
export interface BrandImageFacts {
  /** The row's ID; new with every upload. */
  id: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** The brand's images that were uploaded, by kind. */
export type BrandImages = Partial<Record<BrandImageKind, BrandImageFacts>>;

/** The audit action uploading each kind records. */
const CHANGED_ACTIONS = { logo: 'brand_logo_changed', icon: 'brand_icon_changed' } as const;

/** The audit action removing each kind records. */
const REMOVED_ACTIONS = { logo: 'brand_logo_removed', icon: 'brand_icon_removed' } as const;

/** The values each problem's message names. */
const PROBLEM_VALUES: Readonly<Record<BrandImageProblem, ErrorMessageValues>> = {
  tooManyPixels: { maximum: BRAND_IMAGE_MAX_SIDE },
  logoTooSmall: { minimum: BRAND_LOGO_MIN_HEIGHT },
  logoShape: { widest: LOGO_RATIO.widest, tallest: LOGO_RATIO.tallest },
  iconTooSmall: { minimum: BRAND_ICON_MIN_SIDE },
  iconShape: {},
};

/**
 * Loads which brand images were uploaded, without their bytes.
 *
 * @param db - Database client or transaction.
 * @returns Each uploaded image's ID and size, by kind.
 */
export async function loadBrandImages(db: DatabaseOrTransaction): Promise<BrandImages> {
  const rows = await db
    .select({
      kind: brandImage.kind,
      id: brandImage.id,
      width: brandImage.width,
      height: brandImage.height,
    })
    .from(brandImage);
  const images: BrandImages = {};
  for (const { kind, ...facts } of rows) {
    images[kind] = facts;
  }
  return images;
}

/** A brand image with its bytes. */
export type LoadedBrandImage = BrandImageFacts & { content: Uint8Array };

/**
 * The bytes read last of each kind, by the image's ID: an ID is never
 * reused, so they stay right for as long as it's the current one. At most
 * one image of each kind, so a few hundred kilobytes per process.
 */
const loadedImages = new Map<BrandImageKind, LoadedBrandImage>();

/**
 * Loads one brand image with its bytes, to serve it. Only its ID is read
 * when its bytes are already kept, so the public routes that serve it don't
 * read them from the database for every request.
 *
 * @param db - Database client or transaction.
 * @param kind - Which image.
 * @returns The image, or `null` when none was uploaded.
 */
export async function loadBrandImage(
  db: DatabaseOrTransaction,
  kind: BrandImageKind,
): Promise<LoadedBrandImage | null> {
  const [current] = await db
    .select({ id: brandImage.id })
    .from(brandImage)
    .where(eq(brandImage.kind, kind));
  if (!current) {
    return null;
  }
  const kept = loadedImages.get(kind);
  if (kept?.id === current.id) {
    return kept;
  }
  const [row] = await db
    .select({
      id: brandImage.id,
      width: brandImage.width,
      height: brandImage.height,
      content: brandImage.content,
    })
    .from(brandImage)
    .where(eq(brandImage.id, current.id));
  if (row) {
    loadedImages.set(kind, row);
  }
  // Replaced or removed in between: the next request reads the current one.
  return row ?? null;
}

/**
 * Uploads the logo or an own browser tab icon, replacing the one before.
 * The file is checked by its header first (a PNG or JPEG, of a size and
 * shape that fits), then drawn again as a PNG that fits its stored box,
 * which is what's kept and served. Everyone sees the change, so it's
 * recorded in the audit log.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param kind - Which image.
 * @param bytes - The uploaded file.
 * @returns The stored image's ID and size.
 * @throws {ServiceError} `invalid` for an empty, too large or unreadable
 *   file, another kind of file, or one whose size or shape doesn't fit.
 */
export async function setBrandImage(
  ctx: ServiceContext,
  actor: Actor,
  kind: BrandImageKind,
  bytes: Uint8Array,
): Promise<BrandImageFacts> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  if (bytes.byteLength === 0) {
    throw new ServiceError('invalid', 'errors.branding.empty');
  }
  if (bytes.byteLength > BRAND_IMAGE_MAX_MB * 1024 * 1024) {
    throw new ServiceError('invalid', 'errors.branding.tooLarge', { maximum: BRAND_IMAGE_MAX_MB });
  }
  const facts = imageFacts(bytes);
  if (!facts) {
    throw new ServiceError('invalid', 'errors.branding.typeNotAllowed');
  }
  const problem = brandImageProblem(kind, facts);
  if (problem) {
    throw new ServiceError(
      'invalid',
      `errors.branding.${problem}` as const,
      PROBLEM_VALUES[problem],
    );
  }
  await assertRateLimit(ctx, `brand-image:user:${actor.id}`, RATE_LIMITS.brandImagesPerUser);
  const drawn = await redrawImage(bytes, facts, STORED_BOX[kind]);
  if (!drawn) {
    throw new ServiceError('invalid', 'errors.branding.unreadable');
  }
  const { content, width, height } = drawn;
  return ctx.db.transaction(async (tx) => {
    // A new ID with every upload, also when two arrive at once: the version in its address.
    const row = firstRow(
      await tx
        .insert(brandImage)
        .values({ kind, content, width, height, uploadedBy: actor.id })
        .onConflictDoUpdate({
          target: brandImage.kind,
          set: {
            id: sql`uuidv7()`,
            content,
            width,
            height,
            uploadedBy: actor.id,
            createdAt: sql`now()`,
          },
        })
        .returning({ id: brandImage.id }),
      'the brand image',
    );
    await recordEvent(
      ctx,
      {
        action: CHANGED_ACTIONS[kind],
        actorUserId: actor.id,
        details: { staff: true, width, height },
      },
      tx,
    );
    return { id: row.id, width, height };
  });
}

/**
 * Removes the logo, or the own browser tab icon, so Adiutor's logo or the
 * icon made from the logo shows again. Recorded in the audit log when there
 * was one.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param kind - Which image.
 * @returns Whether there was one to remove.
 */
export async function removeBrandImage(
  ctx: ServiceContext,
  actor: Actor,
  kind: BrandImageKind,
): Promise<boolean> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  return ctx.db.transaction(async (tx) => {
    const removed = await tx
      .delete(brandImage)
      .where(eq(brandImage.kind, kind))
      .returning({ id: brandImage.id });
    if (removed.length === 0) {
      return false;
    }
    await recordEvent(
      ctx,
      { action: REMOVED_ACTIONS[kind], actorUserId: actor.id, details: { staff: true } },
      tx,
    );
    return true;
  });
}

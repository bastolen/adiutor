/**
 * @file Drizzle schema for the brand's images (decision 0051): the logo and
 * the own browser tab icon a staff Admin uploaded, as the PNG Adiutor drew
 * from the upload. They're kept in the database, so every install has them
 * whatever storage it has for attachments, and backups hold them. Only
 * `src/server/branding/` reads or writes this table.
 */
import { customType, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { BRAND_IMAGE_KINDS } from '../../lib/branding';
import { user } from './auth';
import { createdAt, id, oneOf } from './columns';

/** A Postgres `bytea` column, read and written as bytes (Drizzle has none of its own). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  /**
   * The column's type in Postgres.
   *
   * @returns `bytea`.
   */
  dataType() {
    return 'bytea';
  },
  /**
   * Hands the bytes to `pg`, which writes a Buffer as `bytea`.
   *
   * @param value - The bytes.
   * @returns The same bytes as a Buffer.
   */
  toDriver(value) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
  /**
   * Reads the Buffer `pg` gives for a `bytea`.
   *
   * @param value - The Buffer.
   * @returns Its bytes.
   */
  fromDriver(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * The brand's images, one row per kind at most. Uploading another replaces
 * the row, so its ID is new: the version the image's address carries.
 */
export const brandImage = pgTable(
  'brand_image',
  {
    id: id(),
    /** Which image it is (`BRAND_IMAGE_KINDS`). */
    kind: text('kind', { enum: BRAND_IMAGE_KINDS }).notNull(),
    /** The PNG Adiutor drew from the upload; never the uploaded file itself. */
    content: bytea('content').notNull(),
    /** The PNG's width in pixels. */
    width: integer('width').notNull(),
    /** The PNG's height in pixels. */
    height: integer('height').notNull(),
    /** The staff Admin who uploaded it, while their account exists. */
    uploadedBy: uuid('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    /** One image of each kind. */
    uniqueIndex('brand_image_kind_idx').on(table.kind),
    index('brand_image_uploaded_by_idx').on(table.uploadedBy),
    oneOf('brand_image_kind_valid', table.kind, BRAND_IMAGE_KINDS),
  ],
);

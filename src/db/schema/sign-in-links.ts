/**
 * @file Drizzle schema for the links in emails about requests that sign
 * their recipient in (decision 0036, `src/server/auth/request-links.ts`).
 */
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, id, timestampTz } from './columns';
import { request } from './requests';

/**
 * A link in an email about a request: it signs the person the email went to
 * in and opens the request, as often as it's used, until it expires. Each
 * email gets its own. Only the token's SHA-256 hash is stored (`hashToken`);
 * the token is in the email and nowhere else. A link is ended by setting its
 * end to now, whenever the user's trusted devices are forgotten (signing
 * out everywhere, a password change, ...), and the hourly
 * `expired-sign-in-data` job deletes it once it has ended.
 */
export const requestSignInLink = pgTable(
  'request_sign_in_link',
  {
    id: id(),
    /** Who it signs in: the person the email went to. */
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The request it opens; it signs in only while its person can read it. */
    requestId: uuid('request_id')
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    /** The token's SHA-256 hash, in hex. */
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    /** When it stops working: 14 days after the email, or when it was ended early. */
    expiresAt: timestampTz('expires_at').notNull(),
    /** When it last signed someone in, if it has. */
    lastUsedAt: timestampTz('last_used_at'),
  },
  (table) => [
    uniqueIndex('request_sign_in_link_token_hash_idx').on(table.tokenHash),
    index('request_sign_in_link_user_idx').on(table.userId),
    index('request_sign_in_link_request_idx').on(table.requestId),
    index('request_sign_in_link_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * @file Storing webhooks directly, for tests that are about something else
 * (the authorization matrix, deliveries), and reading back what a webhook
 * keeps. Its address and secret are sealed as the service seals them, with
 * the server's own key.
 */
import { eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { webhook, webhookRequestType } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { openSecret, sealSecret } from '@/server/sealed-secrets';

/** What a stored webhook may be given; everything else gets a default. */
export interface StoredWebhookValues {
  /** Its name; "Adiutor Tests hook" unless set. */
  name?: string;
  /** Its address; `https://hooks.adiutor.test/in` unless set. */
  url?: string;
  /** Its signing secret; a fixed test secret unless set. */
  secret?: string;
  /** Its format; JSON unless set. */
  format?: 'json' | 'chat';
  /** What it's told about; everything unless set. */
  events?: (typeof webhook.$inferInsert)['events'];
  /** The types it covers; all of them unless set. */
  types?: string[];
  /** When it was turned off, and why; on unless set. */
  off?: { at: Date; reason: 'manual' | 'failing' | 'gone' | 'unreadable' };
  /** Since when it has been failing. */
  failingSince?: Date;
}

/** The secret a stored webhook has unless a test gives one: `whsec_` and 32 bytes. */
export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

/**
 * Stores a webhook without going through the service.
 *
 * @param db - Test database.
 * @param values - What to store instead of the defaults.
 * @returns The stored webhook's ID.
 */
export async function storeWebhook(
  db: Database,
  values: StoredWebhookValues = {},
): Promise<string> {
  const url = values.url ?? 'https://hooks.adiutor.test/in';
  const stored = firstRow(
    await db
      .insert(webhook)
      .values({
        name: values.name ?? 'Adiutor Tests hook',
        urlSealed: await sealSecret(url),
        urlHost: new URL(url).host,
        format: values.format ?? 'json',
        events: values.events ?? ['raised', 'reply', 'note', 'status', 'assignee', 'details'],
        allTypes: values.types === undefined,
        secretSealed: await sealSecret(values.secret ?? TEST_WEBHOOK_SECRET),
        turnedOffAt: values.off?.at ?? null,
        turnedOffReason: values.off?.reason ?? null,
        failingSince: values.failingSince ?? null,
      })
      .returning({ id: webhook.id }),
    'the stored webhook',
  );
  if (values.types && values.types.length > 0) {
    await db
      .insert(webhookRequestType)
      .values(values.types.map((requestTypeKey) => ({ webhookId: stored.id, requestTypeKey })));
  }
  return stored.id;
}

/**
 * Reads a webhook back as stored, with its address and secret opened.
 *
 * @param db - Test database.
 * @param id - The webhook's ID.
 * @returns The row, with `url` and `secret`, or `undefined` when it's gone.
 */
export async function readWebhook(db: Database, id: string) {
  const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    url: await openSecret(row.urlSealed),
    secret: await openSecret(row.secretSealed),
  };
}

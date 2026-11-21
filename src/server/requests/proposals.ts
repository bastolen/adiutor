/**
 * @file Which proposal a request waits on (decision 0033): the email that
 * tells of a solution and the links that answer it both answer only the
 * latest one.
 */
import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { requestEntry } from '@/db/schema';

/**
 * The status entry that made a request wait for the answer it waits on now:
 * the latest change to `proposed`. Links answer only that proposal.
 *
 * @param db - Database client or transaction.
 * @param requestId - The request.
 * @returns The entry's ID, or `null` when the request was never proposed a solution.
 */
export default async function currentProposalEntryId(
  db: DatabaseOrTransaction,
  requestId: string,
): Promise<string | null> {
  const [found] = await db
    .select({ id: requestEntry.id })
    .from(requestEntry)
    .where(
      and(
        eq(requestEntry.requestId, requestId),
        eq(requestEntry.kind, 'status'),
        eq(requestEntry.toValue, 'proposed'),
      ),
    )
    .orderBy(desc(requestEntry.id))
    .limit(1);
  return found?.id ?? null;
}

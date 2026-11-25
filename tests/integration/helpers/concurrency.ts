/**
 * @file Running steps in order, and replaying two requests at the same
 * moment.
 */
import { sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import type { Database, DatabaseTransaction } from '@/db';
import { firstRow } from '@/lib/defined';

/**
 * Runs async steps one after another (not in parallel) and collects results.
 *
 * @param items - Inputs, in order.
 * @param run - The step to run for each input.
 * @returns The results, in input order.
 */
export async function inSequence<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    async (previous, item) => [...(await previous), await run(item)],
    Promise.resolve([]),
  );
}

/**
 * Replays two requests for one address at the same moment, in the order that
 * used to fail. `first` runs in a transaction that's held open once it's
 * done, `second` starts meanwhile, and the held transaction commits only once
 * `second` is waiting for it (for its lock, or for its uncommitted
 * invitation). Whatever happens, both have ended before this returns, so no
 * transaction or connection is left open.
 *
 * With `onceWaiting`, the held transaction does more work once `second`
 * waits for it, right before it commits: what `second` started before, and
 * finds done when it goes on.
 *
 * @param db - The test database client (from {@link setupTestContext}).
 * @param first - The first request's work in its transaction.
 * @param second - The second request.
 * @param onceWaiting - More work for the first request's transaction, once `second` waits for it.
 * @returns What `first` returned, and how `second` ended.
 */
export async function atTheSameMoment<F, S>(
  db: Database,
  first: (tx: DatabaseTransaction) => Promise<F>,
  second: () => Promise<S>,
  onceWaiting?: (tx: DatabaseTransaction) => Promise<void>,
): Promise<{ first: F; second: PromiseSettledResult<S> }> {
  const { promise: released, resolve: release } = Promise.withResolvers<boolean>();
  const { promise: held, resolve: holding } = Promise.withResolvers<number>();
  const firstDone = db.transaction(async (tx) => {
    const result = await first(tx);
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    holding(firstRow(rows, 'the backend process ID').pid);
    // Released early (`false`) when `second` never came to wait: nothing more to replay then.
    if (await released) {
      await onceWaiting?.(tx);
    }
    return result;
  });
  let secondDone: Promise<PromiseSettledResult<S>[]> = Promise.resolve([]);
  try {
    // `firstDone` can only end first by failing.
    const pid = await Promise.race([held, firstDone.then(() => -1)]);
    secondDone = Promise.allSettled([second()]);
    await vi.waitFor(
      async () => {
        // A second request that failed without waiting reports its own error, not a timeout.
        const [ended] = await Promise.race([secondDone, Promise.resolve([])]);
        if (ended?.status === 'rejected') {
          throw ended.reason;
        }
        const { rows } = await db.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
        );
        expect(firstRow(rows, 'the waiting count').waiting).toBe(1);
      },
      { timeout: 5_000 },
    );
    release(true);
  } finally {
    release(false);
    await Promise.allSettled([firstDone, secondDone]);
  }
  const settled = firstRow(await secondDone, "the second request's result");
  return { first: await firstDone, second: settled };
}

/**
 * @file The board's server action: moving a card to another lane, which
 * changes its request's status (`changeRequestStatus`). The service checks
 * who may make the move; this reads what the browser sent, refreshes the
 * board and words the confirmation in the reader's language
 * (`requests.board`). A move is request work, so it's allowed while a staff
 * member is signed in as a user (decision 0028).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { formatRequestNumber } from '@/lib/requests';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { notFoundError, ServiceError } from '@/server/errors';
import { changeRequestStatus, getRequestSettings } from '@/server/requests';

/** What the board sends to move a card: which request, to which lane, and from which. */
export interface MoveRequest {
  /** The request's number. */
  request: number;
  /** The status of the lane it moves to. */
  status: string;
  /** The status of the lane the board showed it in. */
  from: string;
}

/**
 * Reads a move from what the browser sent, which may be anything.
 *
 * @param input - What the browser sent.
 * @returns The move, or `null` when it isn't one (the service checks the statuses).
 */
function moveOf(input: unknown): MoveRequest | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const { request, status, from } = input as Record<string, unknown>;
  if (
    typeof request !== 'number' ||
    !Number.isSafeInteger(request) ||
    request < 1 ||
    typeof status !== 'string' ||
    typeof from !== 'string'
  ) {
    return null;
  }
  return { request, status, from };
}

/**
 * Moves a card to another lane: gives its request the lane's status, from
 * the status the board showed (`from`), so a move from a board that's out of
 * date is refused rather than overwriting a colleague's change. Either way
 * the board is refreshed: after a refusal because the request changed
 * meanwhile, it then shows the card where it is now.
 *
 * @param input - The move ({@link MoveRequest}); anything else is a request that isn't found.
 * @returns A confirmation that names the request and its new lane
 *   ("AD-142 moved to In progress."), or why it was refused.
 */
export async function moveRequestAction(input: MoveRequest): Promise<ActionResult> {
  return runAction(async () => {
    const move = moveOf(input);
    if (move === null) {
      throw notFoundError();
    }
    const actor = await getActor();
    const { status } = await changeRequestStatus(appContext, actor, {
      request: String(move.request),
      status: move.status,
      from: move.from,
    }).catch((error: unknown) => {
      if (error instanceof ServiceError && error.code === 'conflict') {
        refresh();
      }
      throw error;
    });
    refresh();
    const [t, { prefix }] = await Promise.all([
      getTranslations('requests.board'),
      getRequestSettings(appContext),
    ]);
    return {
      ok: true,
      message: t('moved', { reference: formatRequestNumber(prefix, move.request), status }),
    };
  });
}

/**
 * @file Lets the server actions that change a request from what the page
 * showed (its status, its details, a text) refresh the page when the service
 * refuses because someone changed it meanwhile (`conflict`), so the page
 * then shows the request as it is, instead of running into the same refusal
 * again.
 */
import { refresh } from 'next/cache';

import { ServiceError } from '@/server/errors';

/**
 * Runs an action's change; when the service refuses it because the request
 * changed meanwhile, refreshes the page, then refuses all the same (the
 * action's result says why).
 *
 * @param change - The service call that makes the change.
 * @returns What the change returned.
 */
export default async function refreshOnConflict<T>(change: Promise<T>): Promise<T> {
  try {
    return await change;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'conflict') {
      refresh();
    }
    throw error;
  }
}

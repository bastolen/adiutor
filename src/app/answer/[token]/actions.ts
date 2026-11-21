/**
 * @file Server action of an answer link's page: the button that answers
 * when the link was opened without a person's click. Its messages are in
 * the request's language.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import { answerLinkPath, SOLUTION_ANSWERS } from '@/lib/requests';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { answerByLink } from '@/server/requests';

/**
 * Answers the solution through the link, as the person it was made for
 * (`answerByLink`), then shows the link's page again, which says what
 * happened: answered, or why the link can't answer any more. It refreshes
 * before it redirects, so pages Next kept alive in this browser (the
 * request's own page, for someone signed in) don't show the request as it
 * was.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `token`, and `answer` from the pressed button.
 * @returns Why it failed (too many tries); otherwise redirects instead.
 */
export async function answerLinkAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const token = field(formData, 'token');
    const answer = SOLUTION_ANSWERS.find((value) => value === field(formData, 'answer'));
    if (answer) {
      await answerByLink(appContext, token, answer);
    }
    refresh();
    redirect(answerLinkPath(token));
  });
}

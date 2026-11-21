/**
 * @file The addresses of the links in an email that answer a solution the
 * staff sent (decision 0033): `/answer/<token>/approve` and `/deny`, which
 * a person's click opens and answers through, and `/answer/<token>`, the
 * page that says what the link did or asks for a button press first.
 */
import type { SolutionAnswer } from './rules';

/** Where the answer links live; a public path, since they answer without signing in. */
export const ANSWER_LINK_PATH = '/answer';

/**
 * The address of an answer link, or of its page.
 *
 * @param token - The link's token.
 * @param answer - `approve` or `deny` for the link a button in the email opens; left out for
 *   the page that shows what the link is.
 * @returns The path.
 */
export function answerLinkPath(token: string, answer?: SolutionAnswer): string {
  const page = `${ANSWER_LINK_PATH}/${encodeURIComponent(token)}`;
  return answer ? `${page}/${answer}` : page;
}

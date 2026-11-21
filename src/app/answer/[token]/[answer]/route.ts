/**
 * @file The Approve and Deny links of an email about a proposed solution,
 * served at `/answer/<token>/approve` and `/answer/<token>/deny` (public,
 * decision 0033). A person's click answers straight away, as the person the
 * link was made for (`answerByLink`); any other visit, such as a mail
 * scanner checking the link, changes nothing and goes to the link's page,
 * which asks for a button press first. Either way the browser ends on the
 * link's page (`/answer/<token>`), which says what happened.
 */
import type { NextRequest } from 'next/server';

import isPersonsClick from '@/lib/request/persons-click';
import { answerLinkPath, SOLUTION_ANSWERS } from '@/lib/requests';
import appContext from '@/server/app-context';
import { ServiceError } from '@/server/errors';
import { answerByLink } from '@/server/requests';

/**
 * Sends the browser to the link's page. The address holds the link's token,
 * so it's never cached or sent along as a referrer.
 *
 * @param path - The page's path.
 * @returns The redirect.
 */
function toPage(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, appContext.baseUrl).toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * Answers on a person's click, then shows the link's page; otherwise shows
 * the page with a button for the answer the link stands for. A link that
 * can't answer any more changes nothing: its page says why. When answering
 * is refused for too many tries, the page shows the button again.
 *
 * @param request - The request.
 * @param context - The route's parameters: the token and the answer.
 * @returns A redirect to the link's page.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/answer/[token]/[answer]'>,
): Promise<Response> {
  const { token, answer } = await context.params;
  const chosen = SOLUTION_ANSWERS.find((value) => value === answer);
  const page = answerLinkPath(token);
  if (!chosen) {
    return toPage(page);
  }
  const asked = `${page}?answer=${chosen}`;
  if (request.method !== 'GET' || !isPersonsClick(request.headers)) {
    return toPage(asked);
  }
  try {
    await answerByLink(appContext, token, chosen);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return toPage(asked);
    }
    throw error;
  }
  return toPage(page);
}

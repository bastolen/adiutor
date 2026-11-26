/**
 * @file The people a request's text can mention, for the list at "@" in the
 * reply form and the form for a new request (in a company, or internal). A read, asked for by the
 * editor the first time someone types "@": it changes nothing, so it's
 * allowed while a staff member is signed in as a user.
 */
'use server';

import type { MentionChoice } from '@/components/ui/markdown/mentions';
import { INTERNAL_CHOICE } from '@/lib/requests';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import getStaffName from '@/server/people/staff-name';
import { listMentionable } from '@/server/requests';

/**
 * Reads where a text is written from what the browser sent: a request, a
 * company, or a new internal request (the company `INTERNAL_CHOICE`).
 *
 * @param where - What the browser sent.
 * @returns The request, the company or the internal requests, or `null` for anything else.
 */
function textPlace(
  where: unknown,
): { request: string } | { company: string } | { internal: true } | null {
  if (typeof where !== 'object' || where === null) {
    return null;
  }
  if ('request' in where && typeof where.request === 'string') {
    return { request: where.request };
  }
  if ('company' in where && typeof where.company === 'string') {
    return where.company === INTERNAL_CHOICE ? { internal: true } : { company: where.company };
  }
  return null;
}

/**
 * Lists who the viewer can mention in a text (`listMentionable`): a key and
 * a name each, and the staff's name as the label of a staff member. Never an
 * ID or an address.
 *
 * @param where - The request the text is a reply to (its number), or the
 *   company a new request is raised for (its URL name, or `INTERNAL_CHOICE`).
 * @returns The people; nobody for a request or a company the viewer may not
 *   write in, like for one that doesn't exist.
 */
export async function mentionChoicesAction(where: unknown): Promise<MentionChoice[]> {
  const place = textPlace(where);
  if (place === null) {
    return [];
  }
  const actor = await getActor();
  try {
    const [people, staffName] = await Promise.all([
      listMentionable(appContext, actor, place),
      getStaffName(appContext.db),
    ]);
    return people.map(({ key, name, staff }) => ({ key, name, label: staff ? staffName : null }));
  } catch (error) {
    // Whatever the viewer may not see or write in has nobody to mention.
    if (error instanceof ServiceError) {
      return [];
    }
    throw error;
  }
}

/**
 * @file Who reads a request's page, and what they may know of the work in it
 * that a staff member did while signed in as someone (decision 0028). Every
 * part of the page reads it: the request itself (`detail.ts`), its texts
 * (`detail-texts.ts`) and its conversation (`detail-thread.ts`).
 */
import { alias } from 'drizzle-orm/pg-core';

import { user } from '@/db/schema';
import { maySeeSignedInAsWork } from '@/lib/authz/impersonation';
import type { Permission } from '@/lib/authz/permissions';
import { visibleName } from '@/lib/display-name';

import type { Actor } from '../actor';

/** The staff member who did a piece of work while signed in as its author, joined for their name. */
export const signedInAsStaff = alias(user, 'signed_in_as_staff');

/**
 * That a staff member did a piece of request work while signed in as the
 * person it shows as theirs (decision 0028). Only the readers who may know
 * get it (`maySeeSignedInAsWork`): that person, and the staff who see the
 * audit log.
 */
export interface SignedInAsMark {
  /** The staff member's name, or `null` once their account is gone (or has no visible name). */
  staffName: string | null;
}

/** Who reads a request's page, and what that lets them see there. */
export interface PageReader {
  /** The reader. */
  actor: Actor;
  /** Their permissions in the request's company. */
  permissions: Set<Permission>;
  /** Their permissions outside a company: whether they open users' pages, see the audit log. */
  globalPermissions: Set<Permission>;
  /** Whether they see what only the staff see (`requests:view-internal`). */
  internal: boolean;
}

/**
 * The mark of a piece of work done while signed in as its author, for a
 * reader who may know (`maySeeSignedInAsWork`); nothing for anyone else.
 *
 * @param reader - Who reads it.
 * @param work - The work's row: whether it was done that way, and the staff member's name.
 * @param work.signedInAs - Whether a staff member did it while signed in as its author.
 * @param work.staff - The staff member, while their account exists.
 * @param authorId - Who it shows as theirs, while their account exists.
 * @returns The mark to spread into what the reader gets.
 */
export function signedInAsMark(
  reader: PageReader,
  work: { signedInAs: boolean; staff: { name: string | null } | null },
  authorId: string | null | undefined,
): SignedInAsMark | undefined {
  return work.signedInAs &&
    maySeeSignedInAsWork({
      isAuthor: Boolean(authorId) && authorId === reader.actor.id,
      globalPermissions: reader.globalPermissions,
    })
    ? { staffName: visibleName(work.staff?.name) }
    : undefined;
}

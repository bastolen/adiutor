/**
 * @file Work while a staff member is signed in as the actor ("Sign in as",
 * see docs/decisions/0017-staff-sign-in-as-users.md and
 * 0028-request-work-while-signed-in-as-a-user.md): the refusal of changes,
 * and what the one kind of work that's allowed, requests, records. Its own
 * small module, without the database, so server actions and their unit
 * tests can use it as it is; services reach the refusal through `./access`.
 */
import type { Actor } from './actor';
import { ServiceError } from './errors';

/**
 * Refuses a change while a staff member is signed in as the actor: they see
 * what the user sees, but change nothing in the user's name. Every service
 * that changes something calls it first, before any other check, so the
 * refusal is the same whatever the user's rights. The only changes allowed
 * are the user's own work: hiding the MFA tip (`dismissMfaRecommendation`)
 * and their request work, which records the staff member
 * ({@link signedInAsWork}); managing request types is staff settings, and
 * refused.
 *
 * @param actor - The acting user (or the signed-in user an invitation is accepted for).
 * @param actor.signedInAs - The staff member signed in as them, if any.
 * @throws {ServiceError} `signed_in_as` with `errors.impersonation.changesOff`.
 */
export default function assertNotSignedInAs(actor: { signedInAs?: Actor['signedInAs'] }): void {
  if (actor.signedInAs) {
    throw new ServiceError('signed_in_as', 'errors.impersonation.changesOff');
  }
}

/**
 * What a row of request work records about a staff member signed in as the
 * actor: whether one was, and who (decision 0028). Each request change
 * stores it with the row that says who did it (the request, an entry, a
 * text version), so the request can tell the user and the staff who see the
 * audit log.
 *
 * @param actor - The acting user.
 * @param actor.signedInAs - The staff member signed in as them, if any.
 * @returns The flag and the staff member's ID (`null` when nobody is signed in as them).
 */
export function signedInAsWork(actor: { signedInAs: Actor['signedInAs'] }): {
  signedInAs: boolean;
  signedInAsStaffId: string | null;
} {
  return actor.signedInAs
    ? { signedInAs: true, signedInAsStaffId: actor.signedInAs.staffId }
    : { signedInAs: false, signedInAsStaffId: null };
}

/**
 * Who is really acting: the staff member while they're signed in as the
 * actor, else the actor. Rate limits on request work key on it, so work a
 * staff member does as a user counts against them and never uses up the
 * user's allowance.
 *
 * @param actor - The acting user.
 * @param actor.id - Their ID.
 * @param actor.signedInAs - The staff member signed in as them, if any.
 * @returns The ID of whoever is acting.
 */
export function actingUserId(actor: { id: string; signedInAs: Actor['signedInAs'] }): string {
  return actor.signedInAs?.staffId ?? actor.id;
}

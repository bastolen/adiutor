/**
 * @file The refusal of changes while a staff member is signed in as the
 * actor ("Sign in as", see docs/decisions/0017-staff-sign-in-as-users.md).
 * Its own small module, without the database, so server actions and their
 * unit tests can use it as it is; services reach it through `./access`.
 */
import type { Actor } from './actor';
import { ServiceError } from './errors';

/**
 * Refuses a change while a staff member is signed in as the actor: they see
 * what the user sees, but change nothing in the user's name. Every service
 * that changes something calls it first, before any other check, so the
 * refusal is the same whatever the user's rights; the only changes allowed
 * are the user's own work (`dismissMfaRecommendation`, and the request
 * features once they're built, which then record the staff member).
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

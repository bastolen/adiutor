/**
 * @file Who may manage webhooks: the staff who manage request types
 * (`staff:manage`, staff Admins), never while a staff member is signed in as
 * someone else (decision 0028: managing webhooks is staff settings, not
 * anyone's own request work).
 */
import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';

/**
 * Checks that the actor may manage webhooks: the staff who manage request
 * types, not signed in as someone else.
 *
 * @param actor - The acting user.
 * @throws {ServiceError} `signed_in_as`, or `forbidden` without `staff:manage`.
 */
export default function assertManagesWebhooks(actor: Actor): void {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
}

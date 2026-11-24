/**
 * @file User administration: the user page's loaders (the user, their
 * companies and their devices, and whether they
 * exist, for its titles), the signed-in devices of a user (and the signed-in
 * user's own, as far as a staff member signed in as them may see them), the last-Admin
 * rule, what Admins can do to an account (reset two-step verification, which
 * also disconnects GitHub and Google accounts, sign out everywhere,
 * deactivate, reactivate, delete), and deactivating your own account.
 *
 * Every change is recorded in the audit log, emails the user, and refuses
 * anything that would leave a company or the staff without an Admin who can
 * sign in, also when two such changes come at the same moment
 * (`soleAdminOf` locks before it counts).
 *
 * This is the module's public API: the code lives in the files next to it
 * (`detail`, `sessions`, `sole-admin`, `kept-roles`, `admin-actions`, `own-account`), and
 * nothing outside this folder imports them directly.
 */
export { getUserDetail, listUserCompanies, listUserDevices, userExists } from './detail';
export type { UserCompany, UserDetail } from './detail';
export { listOwnSessions, listUserSessions } from './sessions';
export type { UserSession } from './sessions';
export { soleAdminError, soleAdminOf } from './sole-admin';
export type { SoleAdminOf, SoleAdminSubject } from './sole-admin';
export {
  deactivateUser,
  deleteUser,
  reactivateUser,
  resetUserMfa,
  signOutUserEverywhere,
} from './admin-actions';
export { deactivateOwnAccount } from './own-account';

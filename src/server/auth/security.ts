/**
 * @file The signed-in user's sign-in security: two-step verification and
 * passkeys, for the Security page, and the ways they can confirm a session
 * on the step-up page.
 */
import { asc, eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { passkey } from '@/db/schema';
import {
  type MfaRole,
  type MfaState,
  NO_STEP_UP_METHODS,
  type StepUpMethods,
  stepUpMethods,
  windowOpeningMethods,
} from '@/lib/authz/mfa';
import { availableProviders } from '@/lib/sign-in/providers';

import type { Actor } from '../actor';
import { loadMfaStates } from './mfa-state';

/** A passkey as shown on the Security page. */
export interface PasskeySummary {
  /** Passkey ID. */
  id: string;
  /** The name the user gave it. */
  name: string | null;
  /** `singleDevice` (e.g. a security key) or `multiDevice` (synced, e.g. iCloud Keychain). */
  deviceType: string;
  /** Whether it's backed up or synced by the provider. */
  backedUp: boolean;
  /** When it was added. */
  createdAt: Date | null;
}

/** Everything the Security page shows. */
export interface SecurityOverview {
  /** Whether two-step verification is on (with email codes, or an authenticator app). */
  twoFactorEnabled: boolean;
  /** Whether an authenticator app is set up (and so backup codes exist). */
  authenticatorSetUp: boolean;
  /** Whether the user has a password (needed to confirm some changes). */
  hasPassword: boolean;
  /** Their passkeys, oldest first. */
  passkeys: PasskeySummary[];
  /** Their setup as the MFA rules see it (e.g. for `mfaDowngradeBlocks`). */
  mfaState: MfaState;
}

/**
 * Loads the signed-in user's sign-in security settings. Their setup comes
 * from the actor, which loaded it in this request (`loadActor`), so only
 * their passkeys are queried here.
 *
 * @param db - Database client.
 * @param actor - The signed-in user.
 * @param actor.id - Their ID.
 * @param actor.mfaState - Their sign-in setup, as loaded with them.
 * @returns Their two-step verification and passkey settings.
 */
export async function getSecurityOverview(
  db: Database,
  actor: Pick<Actor, 'id' | 'mfaState'>,
): Promise<SecurityOverview> {
  const passkeys = await db
    .select({
      id: passkey.id,
      name: passkey.name,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
    })
    .from(passkey)
    .where(eq(passkey.userId, actor.id))
    .orderBy(asc(passkey.createdAt));
  const state = actor.mfaState ?? {
    twoFactorEnabled: false,
    authenticator: false,
    passkeyCount: 0,
    hasPassword: false,
    providerAccounts: [],
  };
  return {
    twoFactorEnabled: state.twoFactorEnabled,
    authenticatorSetUp: state.authenticator,
    hasPassword: state.hasPassword,
    passkeys,
    mfaState: state,
  };
}

/**
 * Loads the ways a user can confirm a session that didn't have a second
 * step (see `stepUpMethods`). Only for the user themselves. To confirm a
 * change to how they sign in, only the methods that open the window for it
 * are offered (`windowOpeningMethods`): not GitHub next to a passkey or an
 * authenticator app, where it would confirm the session but allow no change.
 *
 * @param db - Database client.
 * @param userId - The signed-in user's ID.
 * @param mfaRole - Which MFA rules apply to them (see `mfaRoleOf`), or `null`.
 * @param options - Options.
 * @param options.forChange - Whether the confirmation is for a change to how they sign in.
 * @returns The available methods.
 */
export async function getStepUpMethods(
  db: Database,
  userId: string,
  mfaRole: MfaRole | null,
  { forChange = false }: { forChange?: boolean } = {},
): Promise<StepUpMethods> {
  const state = (await loadMfaStates(db, [userId])).get(userId);
  if (!state) {
    return NO_STEP_UP_METHODS;
  }
  const methods = stepUpMethods(state, mfaRole, availableProviders);
  return forChange ? windowOpeningMethods(methods) : methods;
}

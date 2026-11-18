/**
 * @file The signed-in user's sign-in security: two-step verification and
 * passkeys, for the Security page, and the ways they can confirm a session
 * on the step-up page.
 */
import { asc, eq } from 'drizzle-orm';

import { passkey } from '@/db/schema';
import {
  type MfaState,
  NO_STEP_UP_METHODS,
  type StepUpMethods,
  stepUpMethods,
  strongStepUpMethods,
  windowOpeningMethods,
} from '@/lib/authz/mfa';
import { availableProviders } from '@/lib/sign-in/providers';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/** A passkey as shown on the Security page. */
export interface PasskeySummary {
  /** Passkey ID. */
  id: string;
  /** The name the user gave it. */
  name: string | null;
  /** Whether it's backed up or synced by the provider. */
  backedUp: boolean;
  /** When it was added. */
  createdAt: Date | null;
}

/** The sign-in security the Security page shows. */
export interface SecurityOverview {
  /** Their passkeys, oldest first. */
  passkeys: PasskeySummary[];
  /**
   * Their setup as the MFA rules see it: whether two-step verification is on
   * (`twoFactorEnabled`), an authenticator app is set up (`authenticator`, and
   * so backup codes exist), they have a password (`hasPassword`), and more.
   */
  mfaState: MfaState;
}

/**
 * Loads the signed-in user's sign-in security settings. Their setup comes
 * from the actor, which loaded it in this request (`loadActor`), so only
 * their passkeys are queried here.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param actor.id - Their ID.
 * @param actor.mfaState - Their sign-in setup, as loaded with them.
 * @returns Their passkeys and sign-in setup.
 */
export async function getSecurityOverview(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Pick<Actor, 'id' | 'mfaState'>,
): Promise<SecurityOverview> {
  const passkeys = await ctx.db
    .select({
      id: passkey.id,
      name: passkey.name,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
    })
    .from(passkey)
    .where(eq(passkey.userId, actor.id))
    .orderBy(asc(passkey.createdAt));
  const mfaState = actor.mfaState ?? {
    twoFactorEnabled: false,
    authenticator: false,
    passkeyCount: 0,
    hasPassword: false,
    providerAccounts: [],
  };
  return { passkeys, mfaState };
}

/**
 * Works out the ways a user can confirm a session that didn't have a second
 * step (see `stepUpMethods`). Only for the user themselves. Their setup comes
 * from the actor, which loaded it in this request (`loadActor`), so nothing
 * is queried here. To confirm a change to how they sign in, only the methods
 * that open the window for it are offered (`windowOpeningMethods`): not
 * GitHub next to a passkey or an authenticator app, where it would confirm
 * the session but allow no change. To confirm with a strong second step
 * whatever the role (before signing in as someone), only those that open
 * that window are (`strongStepUpMethods`): never email codes.
 *
 * @param actor - The signed-in user.
 * @param actor.mfaState - Their sign-in setup, as loaded with them, or `null`
 *   if they disappeared meanwhile.
 * @param actor.mfaRole - Which MFA rules apply to them (see `mfaRoleOf`), or `null`.
 * @param options - Options.
 * @param options.forChange - Whether the confirmation is for a change to how they sign in.
 * @param options.strong - Whether it must be a strong second step whatever the role.
 * @returns The available methods: none for a user without a setup.
 */
export function getStepUpMethods(
  actor: Pick<Actor, 'mfaState' | 'mfaRole'>,
  { forChange = false, strong = false }: { forChange?: boolean; strong?: boolean } = {},
): StepUpMethods {
  const state = actor.mfaState;
  if (!state) {
    return NO_STEP_UP_METHODS;
  }
  if (strong) {
    return strongStepUpMethods(state, availableProviders);
  }
  const methods = stepUpMethods(state, actor.mfaRole, availableProviders);
  return forChange ? windowOpeningMethods(methods) : methods;
}

/**
 * @file The signed-in user's sign-in security: two-step verification,
 * passkeys and connected provider accounts, for the Security page, and the
 * ways they can confirm a session on the step-up page.
 */
import { asc, eq } from 'drizzle-orm';

import { passkey } from '@/db/schema';
import { personalDataShown } from '@/lib/authz/impersonation';
import {
  type MfaState,
  type StepUpMethods,
  stepUpMethods,
  strongStepUpMethods,
  windowOpeningMethods,
} from '@/lib/authz/mfa';
import { availableProviders } from '@/lib/sign-in/providers';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { type ConnectedProviderDetails, listConnectedProviders } from './accounts';

/** A passkey as shown on the Security page. */
export interface PasskeySummary {
  /** Passkey ID. */
  id: string;
  /**
   * The name the user gave it; `null` without one, and for a staff member
   * signed in as the user who doesn't see it (`personalDataShown`).
   */
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
   * Their connected provider accounts, oldest first, with what the MFA rules
   * need on the server (give the browser only the `ConnectedProvider` part).
   * An account's name is `null` for a staff member signed in as the user who
   * doesn't see it (`personalDataShown`).
   */
  connected: ConnectedProviderDetails[];
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
 * their passkeys and connected provider accounts are queried here. A staff
 * member signed in as the user gets only the names the user's page shows
 * them (`personalDataShown`): the passkeys' names and the provider accounts'
 * names for staff Admins (`users:manage`), none for anyone else.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user, or a staff member signed in as them.
 * @param actor.id - Their ID.
 * @param actor.mfaState - Their sign-in setup, as loaded with them.
 * @param actor.signedInAs - The staff member signed in as them, if any.
 * @returns Their passkeys, connected accounts and sign-in setup.
 */
export async function getSecurityOverview(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Pick<Actor, 'id' | 'mfaState' | 'signedInAs'>,
): Promise<SecurityOverview> {
  const shown = personalDataShown(actor);
  const [passkeys, connected] = await Promise.all([
    ctx.db
      .select({
        id: passkey.id,
        name: passkey.name,
        backedUp: passkey.backedUp,
        createdAt: passkey.createdAt,
      })
      .from(passkey)
      .where(eq(passkey.userId, actor.id))
      .orderBy(asc(passkey.createdAt)),
    listConnectedProviders(ctx, actor.id),
  ]);
  return {
    passkeys: shown.devices ? passkeys : passkeys.map((found) => ({ ...found, name: null })),
    connected: shown.accountNames
      ? connected
      : connected.map((link) => ({ ...link, accountName: null })),
    mfaState: actor.mfaState,
  };
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
 * @param actor.mfaState - Their sign-in setup, as loaded with them.
 * @param actor.mfaRole - Which MFA rules apply to them (see `mfaRoleOf`), or `null`.
 * @param options - Options.
 * @param options.forChange - Whether the confirmation is for a change to how they sign in.
 * @param options.strong - Whether it must be a strong second step whatever the role.
 * @returns The available methods.
 */
export function getStepUpMethods(
  actor: Pick<Actor, 'mfaState' | 'mfaRole'>,
  { forChange = false, strong = false }: { forChange?: boolean; strong?: boolean } = {},
): StepUpMethods {
  if (strong) {
    return strongStepUpMethods(actor.mfaState, availableProviders);
  }
  const methods = stepUpMethods(actor.mfaState, actor.mfaRole, availableProviders);
  return forChange ? windowOpeningMethods(methods) : methods;
}

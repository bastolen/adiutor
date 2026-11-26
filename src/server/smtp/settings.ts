/**
 * @file The Email tab of Settings (decision 0045): the mail server emails go
 * out through and their sender, which staff Admins choose unless the
 * server's environment does (`SMTP_URL`, `EMAIL_FROM`). A mail server is
 * tried before it's saved (a test email to the staff Admin saving it), its
 * password is encrypted (`sealSecret`) and never shown again, a saved
 * password only goes back to the server it was saved for, and every staff
 * Admin is told of every change (`./notice.ts`).
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import { smtpTestEmail } from '@/emails/smtp-test';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import { sendThrough } from '@/lib/email';
import { env } from '@/lib/env';
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_SENDER,
  type Sender,
  senderText,
  type SmtpConfig,
  smtpFailureOf,
  smtpProblems,
  smtpUrlView,
  type SmtpView,
  smtpView,
} from '@/lib/smtp';
import { smtpFormSchema, type SmtpFormInput } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import { loadEmailBrand } from '../branding';
import checkBeforeSaving from '../check-before-save';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import recipientLocale from '../recipient-locale';
import { openSecret, sealSecret, secretToSave } from '../sealed-secrets';
import { readSettings, writeSettings } from '../settings';
import { serverName, tellStaffAdminsOfMailServerChange } from './notice';

/** The server's environment, as these settings read it; the tests give their own. */
export interface SmtpEnvironment {
  /** The mail server, when the environment chooses it. */
  SMTP_URL?: string;
  /** The sender, when the environment chooses it. */
  EMAIL_FROM?: string;
  /** `production` on a production server. */
  NODE_ENV?: string;
}

/** Sends one email through a given mail server (`sendThrough`); the tests give their own. */
export type SendThrough = typeof sendThrough;

/** What the Email tab shows. */
export interface SmtpSettings {
  /**
   * The mail server: chosen by the server's environment (`SMTP_URL`, its view
   * `null` when the URL can't be read), which the tab only shows, or by
   * Settings (`null` until one is saved). Never a password.
   */
  server:
    | { source: 'environment'; view: Omit<SmtpView, 'from'> | null }
    | { source: 'settings'; view: SmtpView | null };
  /** The sender `EMAIL_FROM` chooses, which locks the sender's fields, or `null`. */
  environmentSender: string | null;
  /** The sender emails go out from now, as one line. */
  senderInUse: string;
  /** Whether Adiutor runs in production, where a connection must be secured. */
  production: boolean;
}

/**
 * A mail server as Settings keeps it, with its password decrypted.
 *
 * @param stored - The setting.
 * @returns The mail server, ready to send through.
 */
export async function openSmtp(stored: SmtpConfig): Promise<SmtpConfig> {
  return { ...stored, password: stored.password ? await openSecret(stored.password) : null };
}

/**
 * Reads the Email tab's settings.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param environment - The server's environment.
 * @returns What the tab shows.
 */
export async function getSmtpSettings(
  ctx: ServiceContext,
  actor: Actor,
  environment: SmtpEnvironment = env,
): Promise<SmtpSettings> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const { 'email.smtp': stored } = await readSettings(ctx.db, ['email.smtp']);
  const environmentSender = environment.EMAIL_FROM ?? null;
  const production = environment.NODE_ENV === 'production';
  if (environment.SMTP_URL) {
    return {
      server: { source: 'environment', view: smtpUrlView(environment.SMTP_URL) },
      environmentSender,
      senderInUse: environmentSender ?? DEFAULT_EMAIL_FROM,
      production,
    };
  }
  // Seen without its password, so it isn't decrypted.
  const view = stored ? smtpView(stored) : null;
  return {
    server: { source: 'settings', view },
    environmentSender,
    senderInUse: environmentSender ?? (view ? senderText(view.from) : DEFAULT_EMAIL_FROM),
    production,
  };
}

/**
 * The mail server to try and save from the form: the password typed, or the
 * saved one while the server, its port, its security and the user stay the
 * same (a changed place must be given it again, so it can't receive a saved
 * password, nor have it sent without the encryption it was saved for), and
 * the sender from the form unless `EMAIL_FROM` chooses it.
 *
 * @param form - The form, its empty password `undefined`.
 * @param saved - The saved mail server, its password decrypted.
 * @param environment - The server's environment.
 * @returns The mail server.
 * @throws {ServiceError} `invalid` when a password or the sender's address is needed.
 */
function configFrom(
  form: SmtpFormInput,
  saved: SmtpConfig | null,
  environment: SmtpEnvironment,
): SmtpConfig {
  let password: string | null = null;
  if (form.username) {
    password =
      secretToSave({
        typed: form.password,
        saved: saved?.password ?? undefined,
        samePlace:
          saved?.host === form.host &&
          saved.port === form.port &&
          saved.security === form.security &&
          saved.username === form.username,
      }) ?? null;
    if (password === null) {
      throw new ServiceError('invalid', 'errors.email.passwordNeeded');
    }
  }
  let from: Sender;
  if (environment.EMAIL_FROM) {
    // The environment's sender is used; the saved one is kept for when it's gone.
    from = saved?.from ?? DEFAULT_SENDER;
  } else if (form.fromAddress) {
    from = { name: form.fromName, address: form.fromAddress };
  } else {
    throw new ServiceError('invalid', 'errors.email.senderNeeded');
  }
  return {
    host: form.host,
    port: form.port,
    security: form.security,
    username: form.username,
    password,
    from,
  };
}

/**
 * Saves the mail server emails go out through, once it has been tried: a
 * test email goes through it to the staff Admin saving it. Staff Admins
 * only, with their second step from the last 15 minutes (whoever controls the
 * mail server can read every sign-in link and code Adiutor sends), while the
 * environment doesn't choose one. Recorded in the audit log, without the
 * password, and told to every staff Admin, the one saving it too: straight
 * away through the mail server it replaces, else queued
 * (`tellStaffAdminsOfMailServerChange`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The form, as sent.
 * @param environment - The server's environment.
 * @param send - Sends one email through a mail server (`sendThrough`).
 * @throws {ServiceError} `conflict` when the environment chooses the mail
 *   server, `confirmation_required` without a recent confirmation,
 *   `rate_limited`, or `invalid` for settings that don't hold or a mail server
 *   that fails its test.
 * @throws {ZodError} When the form doesn't pass its schema.
 */
export async function saveSmtpSettings(
  ctx: ServiceContext,
  actor: Actor,
  input: unknown,
  environment: SmtpEnvironment = env,
  send: SendThrough = sendThrough,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  if (environment.SMTP_URL) {
    throw new ServiceError('conflict', 'errors.email.serverFromEnvironment');
  }
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('confirmation_required', 'errors.email.confirmationRequired');
  }
  const form = smtpFormSchema.parse(input);
  await assertRateLimit(ctx, `smtp-test:user:${actor.id}`, RATE_LIMITS.smtpTestsPerUser);
  const { 'email.smtp': stored } = await readSettings(ctx.db, ['email.smtp']);
  const previous = stored ? await openSmtp(stored) : null;
  const config = configFrom(form, previous, environment);
  const [problem] = smtpProblems(config, { production: environment.NODE_ENV === 'production' });
  if (problem) {
    throw new ServiceError('invalid', `errors.email.problem.${problem}`);
  }

  const [own] = await ctx.db
    .select({ email: user.email, locale: user.locale })
    .from(user)
    .where(eq(user.id, actor.id));
  const test = await smtpTestEmail(own?.email ?? actor.email, {
    appUrl: ctx.baseUrl,
    locale: await recipientLocale(ctx, own?.locale),
    server: serverName(config),
    url: `${ctx.baseUrl}/admin/settings/email`,
    brand: await loadEmailBrand(ctx.db),
  });
  await checkBeforeSaving(
    'A mail server',
    () => send(config, test),
    smtpFailureOf,
    (failure) => `errors.email.check.${failure}`,
  );

  const sealed: SmtpConfig = {
    ...config,
    password: config.password ? await sealSecret(config.password) : null,
  };
  // The mail server this save replaced, as the write locked it: another save at the same moment
  // can't make the staff Admins be told through a server that wasn't the one in use.
  const replaced = await ctx.db.transaction(async (tx) => {
    const before = await writeSettings(tx, { 'email.smtp': sealed });
    await recordEvent(
      ctx,
      {
        action: 'smtp_settings_changed',
        actorUserId: actor.id,
        details: { staff: true, server: serverName(config) },
      },
      tx,
    );
    return before['email.smtp'];
  });
  await tellStaffAdminsOfMailServerChange(ctx, {
    byUserId: actor.id,
    server: serverName(config),
    previous: replaced ? await openSmtp(replaced) : null,
    send,
  });
}

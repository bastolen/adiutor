/**
 * @file What happened to an invitation request, and the message shown after
 * sending one. The invitations service returns these statuses; the server
 * actions that invite people show the message, in the reader's language
 * (`people.inviteResults` in the catalogues). Server only in practice: it
 * loads the catalogues, so client components take just the type.
 */
import type { Locale } from './i18n/locales';
import translator from './i18n/translator';

/**
 * What happened to an invitation request. Only staff see the detailed
 * status; everyone else always sees `sent` (`visibleStatus` in
 * `src/server/people/invitations/`).
 */
export type InviteStatus = 'sent' | 'sent_existing_user' | 'already_member';

/**
 * Where the confirmation is shown: after inviting people (`invited`), or
 * after adding a company, which invites its first Admin (`companyAdded`,
 * starting with "Company added.").
 */
export type InviteStatusContext = 'invited' | 'companyAdded';

/**
 * The confirmation shown after inviting someone. Company users only
 * ever receive the `sent` status, so their message is the same for every
 * address; staff see the detail.
 *
 * @param email - The invited address.
 * @param status - The status the user may see.
 * @param locale - The reader's language.
 * @param context - Where it's shown; `invited` unless a company was just added.
 * @returns The message, e.g. "Invitation sent to jane@adiutor.dev.".
 */
export default function inviteStatusMessage(
  email: string,
  status: InviteStatus,
  locale: Locale,
  context: InviteStatusContext = 'invited',
): string {
  const t = translator(locale, 'people.inviteResults');
  // i18n-check t('people.inviteResults.companyAdded')
  // i18n-check t('people.inviteResults.status')
  return t(context === 'companyAdded' ? 'companyAdded' : 'status', { email, status });
}

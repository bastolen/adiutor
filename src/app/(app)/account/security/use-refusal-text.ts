/**
 * @file The hook the Security page's cards use when the server or Better
 * Auth refuses a change to the user's sign-in methods: either the user is
 * sent to confirm first (and comes back to the card), or the refusal is
 * worded in their language.
 */
import { useTranslations } from 'next-intl';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import { type AuthClientError, authErrorText } from '@/lib/sign-in/auth-error-messages';

/**
 * Handles a refusal of a sign-in change. When it was for lack of a recent
 * confirmation, the user is sent to the step-up page (`askToConfirmOnRefusal`)
 * and there is no text; otherwise the text says why, in their language
 * (`authErrorText`). Callers write `if (text !== null) { setError(text); }`,
 * so an error is only set when the user was not sent away.
 *
 * @param section - The anchor of the card the calling component renders, if it renders it
 *   itself (see `useRecentConfirmation`).
 * @returns A function that takes the error and returns its text, or `null` when the user was
 *   sent to confirm first.
 */
export default function useRefusalText(section?: string) {
  const tAuth = useTranslations('auth');
  const { askToConfirmOnRefusal } = useRecentConfirmation(section);

  return (error: AuthClientError): string | null => {
    if (askToConfirmOnRefusal(error.code)) {
      return null;
    }
    return authErrorText(tAuth, error);
  };
}

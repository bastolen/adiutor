/**
 * @file Button that connects a GitHub or Google account to the signed-in
 * user, coming back to the card it's in (the Connected accounts card).
 */
'use client';

import { useTranslations } from 'next-intl';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import { useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientState } from '@/components/ui/use-transient-state';
import { SECURITY_PAGE } from '@/lib/redirect';
import { authErrorText } from '@/lib/sign-in/auth-error-messages';
import loadAuthClient from '@/lib/sign-in/load-auth-client';
import type { OAuthProvider } from '@/lib/sign-in/oauth-providers';

/**
 * Props for {@link ConnectProviderButton}.
 */
interface ConnectProviderButtonProps {
  /** The provider to connect. */
  provider: OAuthProvider;
  /** Its display name. */
  label: string;
  /** Disables the button, e.g. when connecting would take away the MFA the user's role requires. */
  disabled: boolean;
  /** ID of the text that explains the button, e.g. why it's disabled. */
  describedBy?: string;
}

/**
 * Where the provider sends the user back to: the page and card the button is
 * in (`useRecentConfirmation().returnTo`, the Security page's devices table
 * included), with `connected=<provider>` added to its query, before its
 * anchor.
 *
 * @param returnTo - The page and card.
 * @param provider - The provider being connected.
 */
function connectedUrl(returnTo: string, provider: OAuthProvider): string {
  const url = new URL(returnTo, window.location.origin);
  url.searchParams.set('connected', provider);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Sends the user to the provider to approve, then back to the card the
 * button is in on the Security page (with `connected=<provider>`, or
 * Better Auth's `error=<code>` when it fails, which it puts before the
 * anchor). Without a recent confirmation with their second step, it sends
 * them to confirm first.
 *
 * A refusal says why in the reader's language (`authErrorText`), as the other
 * cards on the page do: "sign out and in again" for a sign-in that's too old
 * (which trying again never fixes), the rule for a role that requires MFA,
 * another change still running, too many requests. Only a failure without a
 * message of its own says "Connecting failed. Please try again."
 */
export default function ConnectProviderButton({
  provider,
  label,
  disabled,
  describedBy = undefined,
}: ConnectProviderButtonProps) {
  const t = useTranslations('account');
  // Nothing changes while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const tAuth = useTranslations('auth');
  const { askToConfirm, askToConfirmOnRefusal, returnTo } = useRecentConfirmation();
  // Gone when the user leaves the page and comes back, like every status message.
  const [pending, setPending] = useTransientState(false);
  const [failure, setFailure] = useTransientState<string | null>(null);

  /** Starts connecting; the browser leaves for the provider on success. */
  const connect = async () => {
    if (askToConfirm()) {
      return;
    }
    setPending(true);
    setFailure(null);
    const authClient = await loadAuthClient();
    const back = returnTo ?? SECURITY_PAGE;
    const result = await authClient.linkSocial({
      provider,
      callbackURL: connectedUrl(back, provider),
      errorCallbackURL: back,
    });
    if (result.error) {
      setPending(false);
      if (askToConfirmOnRefusal(result.error.code)) {
        return;
      }
      setFailure(authErrorText(tAuth, result.error, t('security.connected.connectFailed')));
    }
  };

  return (
    <div className="flex items-center gap-2">
      {failure && (
        <span role="alert" className="text-xs font-medium text-danger">
          {failure}
        </span>
      )}
      <Button
        variant="secondary"
        loading={pending}
        disabled={disabled || changesOff}
        aria-describedby={describedBy}
        onClick={connect}
        aria-label={t('security.connected.connectNamed', { provider: label })}
      >
        {t('security.connected.connect')}
      </Button>
    </div>
  );
}

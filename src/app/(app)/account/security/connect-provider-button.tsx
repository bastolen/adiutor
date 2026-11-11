/**
 * @file Button that connects a GitHub or Google account to the signed-in
 * user, coming back to the card it's in (the Connected accounts card).
 */
'use client';

import { useTranslations } from 'next-intl';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import { useTransientState } from '@/components/ui/use-transient-state';
import { SECURITY_PAGE } from '@/lib/redirect';
import { signInChangeRefusalText } from '@/lib/sign-in/auth-error-messages';
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
 * @returns The address.
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
 * @param props - Button props.
 * @param props.provider - The provider.
 * @param props.label - Its display name.
 * @param props.disabled - Disable the button.
 * @param props.describedBy - ID of the text that explains the button.
 * @returns The button.
 */
export default function ConnectProviderButton({
  provider,
  label,
  disabled,
  describedBy = undefined,
}: ConnectProviderButtonProps) {
  const t = useTranslations('account');
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
      setFailure(
        signInChangeRefusalText(tAuth, result.error.code) ?? t('security.connected.connectFailed'),
      );
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
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={connect}
        aria-label={t('security.connected.connectNamed', { provider: label })}
      >
        {t('security.connected.connect')}
      </Button>
    </div>
  );
}

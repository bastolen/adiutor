/**
 * @file Sign-in form: email and password (with the second step when it's
 * on), passkey, magic link, and the OAuth providers configured on the server.
 * Every way of signing in goes on to the page asked for, and to the card its
 * anchor names.
 */
'use client';

import { KeyRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useId, useSyncExternalStore } from 'react';

import PROVIDER_ICONS from '@/components/brand/provider-icons';
import Alert from '@/components/ui/alert';
import AuthDivider from '@/components/ui/auth-divider';
import AuthHeading from '@/components/ui/auth-heading';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import TextField from '@/components/ui/text-field';
import TextLink from '@/components/ui/text-link';
import { useTransientState } from '@/components/ui/use-transient-state';
import { getSafeRedirectPath, sectionFromHash, withSection } from '@/lib/redirect';
import authClient from '@/lib/sign-in/auth-client';
import getAuthErrorMessage, {
  authErrorMessage,
  getSignInNotice,
} from '@/lib/sign-in/auth-error-messages';
import { type OAuthProvider, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';

import { twoFactorPath } from './two-factor/two-factor-path';

/**
 * Props for {@link SignInForm}.
 */
interface SignInFormProps {
  /** The OAuth providers configured on the server, in the order to offer them. */
  providers: readonly OAuthProvider[];
}

/** Sign in with a password, or get a link by email. */
type Method = 'password' | 'magic-link';

/** How Better Auth's last-used cookie names the email form's methods. */
const lastUsedName: Record<Method, string> = { password: 'email', 'magic-link': 'magic-link' };

/**
 * Nothing to subscribe to: the cookie only changes when signing in, which
 * leaves the page.
 *
 * @returns A no-op unsubscribe function.
 */
const noSubscription = () => () => {};

/**
 * Reads the method of the last sign-in in this browser from Better Auth's
 * cookie, after hydration (the server never knows it).
 *
 * @returns `email` (password), `magic-link`, `passkey`, a provider ID (e.g. `github`), or `null`.
 */
function useLastUsedMethod(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => authClient.getLastUsedLoginMethod(),
    () => null,
  );
}

/**
 * The "Last used" badge shown inside the button of the sign-in option used
 * last time. It's hidden from the button's name (which stays e.g. "Continue
 * with GitHub"); the button points to a hidden "Last used" text with
 * `aria-describedby` instead.
 *
 * @param props - Component props.
 * @param props.show - Whether this option was used last.
 * @param props.onPrimary - Whether the button is a primary (filled) one.
 * @returns The badge, or nothing.
 */
function LastUsedBadge({ show, onPrimary = false }: { show: boolean; onPrimary?: boolean }) {
  if (!show) {
    return null;
  }
  return (
    <span aria-hidden="true" className="ml-1 inline-flex">
      <Badge tone={onPrimary ? 'neutral' : 'brand'}>Last used</Badge>
    </span>
  );
}

/**
 * Sign-in form. After signing in, the user goes to the page in the
 * `callbackURL` query parameter, or the dashboard. A password sign-in with
 * two-step verification on continues on the code step first.
 *
 * The browser keeps the anchor of the address the user first opened when the
 * proxy sends them here (`/admin/staff#invitations` becomes
 * `/auth?callbackURL=%2Fadmin%2Fstaff#invitations`); the server never sees
 * it. When `callbackURL` has no anchor of its own, that one is added, if it
 * names a section, so they land on that card.
 *
 * Saved passkeys are also offered in the browser's suggestions for the email
 * field (WebAuthn conditional UI), where the browser supports it. The method
 * used last time in this browser is marked "Last used".
 *
 * The form starts over whenever the page is hidden: Next keeps the page alive
 * (React's `<Activity>`) and shows it again after signing out, and the next
 * person on the browser mustn't find the last user's address and password,
 * or a button still busy from that sign-in. A page the browser restores from
 * its back/forward cache (e.g. Back from GitHub) is made usable again too.
 *
 * @param props - Which OAuth providers to offer.
 * @param props.providers - A "Continue with …" button for each.
 * @returns The sign-in form.
 */
export default function SignInForm({ providers }: SignInFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = getSafeRedirectPath(searchParams.get('callbackURL'));

  /**
   * Where to go after signing in: `callbackURL`, with the section in this
   * page's own anchor when it has none. Read when signing in, not while
   * rendering (the server has no anchor).
   *
   * @returns The page, e.g. `/admin/staff#invitations`.
   */
  const destination = () =>
    callbackURL.includes('#')
      ? callbackURL
      : withSection(callbackURL, sectionFromHash(window.location.hash));

  /**
   * Where OAuth or a magic link comes back to with `?error=` when it fails:
   * this page, still going on to the same place.
   *
   * @param target - Where to go after signing in.
   * @returns The sign-in page's address.
   */
  const errorPageFor = (target: string) => `/auth?callbackURL=${encodeURIComponent(target)}`;

  const [method, setMethod] = useTransientState<Method>('password');
  const [email, setEmail] = useTransientState('');
  const [password, setPassword] = useTransientState('');
  const [pending, setPending] = useTransientState(false);
  const [error, setError] = useTransientState(getAuthErrorMessage(searchParams.get('error')));
  /** A note another page sent the user here with (`?notice=`), then the result of sending a link. */
  const [success, setSuccess] = useTransientState(getSignInNotice(searchParams.get('notice')));
  const lastUsed = useLastUsedMethod();
  const lastUsedId = useId();
  /**
   * The description to give an option's button.
   *
   * @param option - The option's method, as Better Auth names it.
   * @returns The badge's ID when it was used last.
   */
  const describedBy = (option: string) => (lastUsed === option ? lastUsedId : undefined);

  /** Goes to the page the user came for. */
  const finish = () => {
    router.replace(destination());
    router.refresh();
  };

  useEffect(() => {
    let active = true;
    /**
     * Offers saved passkeys in the email field's suggestions. Picking one
     * signs in; anything else (no passkey, dismissed) is ignored silently.
     */
    const offerPasskeys = async () => {
      if (!(await window.PublicKeyCredential?.isConditionalMediationAvailable?.())) {
        return;
      }
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (active && !result?.error) {
        finish();
      }
    };
    // A passkey offer that fails is just not shown, like one that's dismissed.
    offerPasskeys().catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on mount; `finish` only reads values that don't change while signing in.
  }, []);

  useEffect(() => {
    /**
     * Makes the buttons usable again when the browser shows the page from its
     * back/forward cache (e.g. Back from GitHub or Google).
     *
     * @param event - The page being shown.
     */
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setPending(false);
      }
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, [setPending]);

  /**
   * Signs in with the chosen method.
   *
   * @param event - The form submit event.
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);

    if (method === 'password') {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(
          result.error.status === 401
            ? 'That email and password combination is incorrect.'
            : (result.error.message ?? 'Signing in failed. Please try again.'),
        );
        setPending(false);
        return;
      }
      // With two-step verification on, the password is right but the code step comes first.
      const outcome = result.data as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
      if (outcome.twoFactorRedirect) {
        router.push(twoFactorPath(destination(), outcome.twoFactorMethods ?? []));
        return;
      }
      finish();
      return;
    }

    const target = destination();
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: target,
      errorCallbackURL: errorPageFor(target),
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'Sending the link failed. Please try again.');
      return;
    }
    setSuccess(`If ${email} has an account, a sign-in link is on its way. Check your inbox.`);
  };

  /** Signs in with a passkey, letting the browser ask which one. */
  const signInWithPasskey = async () => {
    setPending(true);
    setError(null);
    setSuccess(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(authErrorMessage(result.error));
      setPending(false);
      return;
    }
    finish();
  };

  /**
   * Starts signing in with an OAuth provider, which redirects to it.
   *
   * @param provider - The OAuth provider.
   */
  const signInWith = async (provider: OAuthProvider) => {
    setPending(true);
    setError(null);
    const target = destination();
    const result = await authClient.signIn.social({
      provider,
      callbackURL: target,
      errorCallbackURL: errorPageFor(target),
    });
    if (result.error) {
      setError(result.error.message ?? 'Signing in failed. Please try again.');
      setPending(false);
    }
  };

  const otherMethod: Method = method === 'password' ? 'magic-link' : 'password';

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Sign in to Adiutor"
        description="Welcome back. Choose how you want to sign in."
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>
      {/* Description of the button of the option used last time. */}
      <span id={lastUsedId} hidden>
        Last used
      </span>
      <Alert tone="success">{success}</Alert>

      <div className="flex flex-col gap-3">
        <Button
          variant="secondary"
          fullWidth
          disabled={pending}
          onClick={signInWithPasskey}
          aria-describedby={describedBy('passkey')}
        >
          <KeyRound aria-hidden="true" />
          Sign in with a passkey
          <LastUsedBadge show={lastUsed === 'passkey'} />
        </Button>
        {providers.map((provider) => {
          const Icon = PROVIDER_ICONS[provider];
          return (
            <Button
              key={provider}
              variant="secondary"
              fullWidth
              disabled={pending}
              onClick={() => signInWith(provider)}
              aria-describedby={describedBy(provider)}
            >
              <Icon />
              Continue with {PROVIDER_LABELS[provider]}
              <LastUsedBadge show={lastUsed === provider} />
            </Button>
          );
        })}
        <AuthDivider>or continue with email</AuthDivider>
      </div>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          name="email"
          // `webauthn` lets the browser suggest saved passkeys here.
          autoComplete="username webauthn"
          placeholder="you@adiutor.dev"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {method === 'password' && (
          <div className="flex flex-col gap-2">
            <TextField
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextLink href="/auth/forgot-password" className="self-end text-sm">
              Forgot password?
            </TextLink>
          </div>
        )}
        <Button
          type="submit"
          fullWidth
          loading={pending}
          aria-describedby={describedBy(lastUsedName[method])}
        >
          {method === 'password' ? 'Sign in' : 'Email me a sign-in link'}
          <LastUsedBadge show={lastUsed === lastUsedName[method]} onPrimary />
        </Button>
      </form>
      <Button
        variant="ghost"
        fullWidth
        onClick={() => {
          setMethod(otherMethod);
          setError(null);
          setSuccess(null);
        }}
        aria-describedby={describedBy(lastUsedName[otherMethod])}
      >
        {method === 'password'
          ? 'Sign in with an email link instead'
          : 'Sign in with a password instead'}
        <LastUsedBadge show={lastUsed === lastUsedName[otherMethod]} />
      </Button>
    </div>
  );
}

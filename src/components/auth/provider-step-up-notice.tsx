/**
 * @file Says why "Confirm with GitHub" on the step-up page didn't confirm the
 * session: two-factor authentication is off for the GitHub account, or
 * GitHub couldn't be checked. (Another GitHub account than the user's own
 * confirmed one is refused before signing in, and the step-up page says so
 * itself.) Shown wherever the user lands afterwards (back on the
 * step-up page, the Security page's MFA setup, or the page they came for)
 * until dismissed or the session is confirmed, from a short-lived cookie set
 * by `recordProviderSession` in `src/server/auth/auth-events/session-hooks.ts` (read with
 * `useNextPageCookie`). Used by the step-up form and the app layout, so its
 * text is in `common` (`common.providerStepUp`).
 */
'use client';

import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import {
  parseProviderStepUpCookie,
  PROVIDER_LABELS,
  PROVIDER_STEP_UP_COOKIE,
} from '@/lib/sign-in/oauth-providers';

import { clearNextPageCookie, useNextPageCookie } from './use-next-page-cookie';

/**
 * Removes the cookie, which hides the notice: when the user dismisses it, and
 * when they confirmed the session another way (`StepUpForm`), so it doesn't
 * follow them to the next page.
 */
export function clearProviderStepUpNotice(): void {
  clearNextPageCookie(PROVIDER_STEP_UP_COOKIE);
}

/**
 * The notice: an error `Alert` (announced when it appears, without moving
 * focus, so a code field or another message on the page keeps it) with a
 * dismiss button, in a region named after the provider. It says why the
 * provider didn't confirm the session and what the user can do, worded to
 * fit wherever they land. The session keeps any earlier confirmation it had
 * (Better Auth replaces the session, which keeps it: `beforeSessionCreate`),
 * so it never says one ended.
 *
 * @returns The notice, or nothing.
 */
export default function ProviderStepUpNotice() {
  const t = useTranslations('common');
  const stepUp = parseProviderStepUpCookie(useNextPageCookie(PROVIDER_STEP_UP_COOKIE));
  if (!stepUp) {
    return null;
  }
  const { provider, outcome } = stepUp;
  const label = PROVIDER_LABELS[provider];

  return (
    <section aria-label={t('providerStepUp.region', { provider: label })}>
      <Alert
        tone="error"
        onDismiss={clearProviderStepUpNotice}
        dismissLabel={t('providerStepUp.dismiss', { provider: label })}
      >
        <p>
          {outcome === 'mfa-off'
            ? t('providerStepUp.mfaOff', { provider: label })
            : t('providerStepUp.unchecked', { provider: label })}
        </p>
      </Alert>
    </section>
  );
}

/**
 * @file Says that a GitHub or Google account was just connected to the user's
 * Adiutor account because they signed in with it (Better Auth matched its
 * verified email), naming the account when its name is known. Shown on the
 * pages after that sign-in until dismissed, from a short-lived cookie set by
 * `afterAccountCreate` (read with `useNextPageCookie`). The app layout shows
 * it outside any `<Suspense>`, so its text is in `common.providerLinked`.
 */
'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { clearNextPageCookie, useNextPageCookie } from '@/components/auth/use-next-page-cookie';
import Alert from '@/components/ui/alert';
import TextLink from '@/components/ui/text-link';
import {
  parseProviderLinkedCookie,
  PROVIDER_LABELS,
  PROVIDER_LINKED_COOKIE,
} from '@/lib/sign-in/oauth-providers';

/**
 * Shows the connected account's name in the sentence (its `<name>` tag).
 *
 * @param chunks - The name, where the sentence places it.
 * @returns The name, emphasised.
 */
function nameTag(chunks: ReactNode) {
  return <span className="font-medium wrap-anywhere">{chunks}</span>;
}

/**
 * Links to the Security page in the sentence (its `<link>` tag).
 *
 * @param chunks - The link's text.
 * @returns The link.
 */
function securityLink(chunks: ReactNode) {
  return <TextLink href="/account/security">{chunks}</TextLink>;
}

/**
 * The notice: an info `Alert` with a link to the Security page and a dismiss
 * button, in a region named after the provider.
 *
 * @returns The notice, or nothing.
 */
export default function ProviderLinkedNotice() {
  const t = useTranslations('common');
  const linked = parseProviderLinkedCookie(useNextPageCookie(PROVIDER_LINKED_COOKIE));
  if (!linked) {
    return null;
  }
  const { provider, accountName } = linked;
  const label = PROVIDER_LABELS[provider];

  /** Hides the notice by removing the cookie. */
  const dismiss = () => {
    clearNextPageCookie(PROVIDER_LINKED_COOKIE);
  };

  return (
    <section aria-label={t('providerLinked.region', { provider: label })}>
      <Alert
        tone="info"
        onDismiss={dismiss}
        dismissLabel={t('providerLinked.dismiss', { provider: label })}
      >
        <p>
          {accountName
            ? t.rich('providerLinked.named', {
                provider: label,
                account: accountName,
                name: nameTag,
                link: securityLink,
              })
            : t.rich('providerLinked.unnamed', { provider: label, link: securityLink })}
        </p>
      </Alert>
    </section>
  );
}

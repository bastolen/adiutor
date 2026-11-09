/**
 * @file Dashboard banner for staff Admins: users whose role requires MFA lost
 * it because a provider that gave it (e.g. GitHub with two-factor
 * authentication) isn't configured on this server (`getProviderMfaWarning`).
 */
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import Banner from '@/components/ui/banner';
import Button from '@/components/ui/button';
import { providerList } from '@/lib/sign-in/oauth-providers';
import type { ProviderMfaWarning as Warning } from '@/server/people/users';

/** Props for {@link ProviderMfaWarning}. */
interface ProviderMfaWarningProps {
  /** How many users, and which providers. */
  warning: Warning;
}

/**
 * Says how many users lost their provider MFA, what that means, and links to
 * the users without MFA. It isn't dismissible: it stays until the provider is
 * configured again or they've set up other MFA. Its text comes from the
 * `dashboard` namespace.
 *
 * @param props - Component props.
 * @param props.warning - How many users, and which providers.
 * @returns The banner.
 */
export default function ProviderMfaWarning({ warning }: ProviderMfaWarningProps) {
  const t = useTranslations('dashboard.providerMfaWarning');
  const locale = useLocale();
  const providers = providerList(warning.providers, locale);
  return (
    <Banner
      label={t('label')}
      icon={ShieldAlert}
      tone="danger"
      title={t('title', { providers })}
      description={t('description', { count: warning.count, providers })}
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/users?filter=without_mfa">{t('action')}</Link>
        </Button>
      }
    />
  );
}

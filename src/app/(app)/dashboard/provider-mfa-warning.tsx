/**
 * @file Dashboard banner for staff Admins: users whose role requires MFA lost
 * it because a provider that gave it (e.g. GitHub with two-factor
 * authentication) isn't configured on this server (`getProviderMfaWarning`).
 */
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import Banner from '@/components/ui/banner';
import Button from '@/components/ui/button';
import { providerNames } from '@/lib/sign-in/oauth-providers';
import type { ProviderMfaWarning as Warning } from '@/server/people/users';

/** Props for {@link ProviderMfaWarning}. */
interface ProviderMfaWarningProps {
  /** How many users, and which providers. */
  warning: Warning;
}

/**
 * Says how many users lost their provider MFA, what that means, and links to
 * the users without MFA. It isn't dismissible: it stays until the provider is
 * configured again or they've set up other MFA.
 *
 * @param props - Component props.
 * @param props.warning - How many users, and which providers.
 * @returns The banner.
 */
export default function ProviderMfaWarning({ warning }: ProviderMfaWarningProps) {
  const names = providerNames(warning.providers);
  const who =
    warning.count === 1
      ? '1 user whose role requires MFA has'
      : `${warning.count} users whose role requires MFA have`;
  return (
    <Banner
      label="Users without MFA"
      icon={ShieldAlert}
      tone="danger"
      title={<>{names} sign-in isn&apos;t configured on this server</>}
      description={
        <>
          {who} no MFA now: theirs came from {names} with two-factor authentication, which only
          counts while {names} sign-in is set up here. Until then they&apos;re asked to add a
          passkey or an authenticator app, and so is anyone with access to their inbox. Set it up
          again, or have them add a passkey or an authenticator app.
        </>
      }
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/users?filter=without_mfa">See users without MFA</Link>
        </Button>
      }
    />
  );
}

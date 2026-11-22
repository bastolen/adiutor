/**
 * @file The "Sign-in security" card on the Overview tab of a user's page: the user's MFA
 * status, two-step verification, passkeys, password and connected provider
 * accounts. Which account it is at a provider is shown only when the viewer
 * may see it (staff Admins). Text from `admin.user.security`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { DescriptionList, DescriptionRow } from '@/components/ui/description-list';
import { isMfaProvider, providerLabel } from '@/lib/sign-in/oauth-providers';
import type { UserDetail } from '@/server/people/user-admin';

import { MfaBadge } from '../user-badges';

/**
 * The account's sign-in security.
 *
 * @param props - Component props.
 * @param props.mfa - The user's MFA details.
 * @param props.accountNames - Their provider accounts' names at the providers, by account ID, or
 *   `null` when the viewer may not see them (only staff Admins may).
 * @returns The card.
 */
export default function SecurityCard({
  mfa,
  accountNames,
}: {
  mfa: UserDetail['mfa'];
  accountNames: UserDetail['accountNames'];
}) {
  const t = useTranslations('admin.user.security');
  let twoFactor = 'off';
  if (mfa.twoFactorEnabled) {
    twoFactor = mfa.authenticator ? 'authenticator' : 'emailCodes';
  }
  return (
    <Card
      title={t('title')}
      description={mfa.required ? t('descriptionRequired') : t('descriptionRecommended')}
    >
      <DescriptionList>
        <DescriptionRow term={t('status')}>
          <MfaBadge status={mfa.status} />
        </DescriptionRow>
        <DescriptionRow term={t('twoFactor')}>
          {t('twoFactorValue', { state: twoFactor })}
        </DescriptionRow>
        <DescriptionRow term={t('passkeys')}>
          {t('passkeyCount', { count: mfa.passkeyCount })}
        </DescriptionRow>
        <DescriptionRow term={t('password')}>
          {t('passwordState', { set: mfa.hasPassword ? 'yes' : 'no' })}
        </DescriptionRow>
        {mfa.providerAccounts.map((provider) => (
          <DescriptionRow
            key={provider.id ?? provider.providerId}
            term={providerLabel(provider.providerId)}
          >
            {/* Which account it is (its name at the provider): for staff Admins, when known. */}
            {provider.id && accountNames?.[provider.id] ? (
              <span className="min-w-0 break-all">{accountNames[provider.id]}</span>
            ) : (
              t('connected')
            )}
            {/* Only providers that can prove MFA say whether the account has it. */}
            {isMfaProvider(provider.providerId) && (
              <Badge tone={provider.mfaVerified ? 'success' : 'neutral'}>
                {provider.mfaVerified
                  ? t('twoFactorOn', { provider: providerLabel(provider.providerId) })
                  : t('twoFactorOff', { provider: providerLabel(provider.providerId) })}
              </Badge>
            )}
          </DescriptionRow>
        ))}
      </DescriptionList>
    </Card>
  );
}

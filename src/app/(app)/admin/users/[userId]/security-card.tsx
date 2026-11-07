/**
 * @file The "Sign-in security" card on the user detail page: the user's MFA
 * status, two-step verification, passkeys, password and connected provider
 * accounts. Which account it is at a provider is shown only when the viewer
 * may see it (staff Admins).
 */
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { isMfaProvider, providerLabel } from '@/lib/sign-in/oauth-providers';
import type { UserDetail } from '@/server/people/user-admin';

import { MfaBadge } from '../user-badges';
import DetailRow from './detail-row';

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
  let twoFactor = 'Off';
  if (mfa.twoFactorEnabled) {
    twoFactor = mfa.authenticator ? 'On: authenticator app and email codes' : 'On: email codes';
  }
  return (
    <Card
      title="Sign-in security"
      description={
        mfa.required
          ? 'Their role requires a second sign-in step.'
          : 'A second sign-in step is recommended for their role.'
      }
    >
      <dl className="divide-y divide-border">
        <DetailRow term="Status">
          <MfaBadge status={mfa.status} />
        </DetailRow>
        <DetailRow term="Two-step verification">{twoFactor}</DetailRow>
        <DetailRow term="Passkeys">{mfa.passkeyCount === 0 ? 'None' : mfa.passkeyCount}</DetailRow>
        <DetailRow term="Password">{mfa.hasPassword ? 'Set' : 'Not set'}</DetailRow>
        {mfa.providerAccounts.map((provider) => (
          <DetailRow
            key={provider.id ?? provider.providerId}
            term={providerLabel(provider.providerId)}
          >
            {/* Which account it is (its name at the provider): for staff Admins, when known. */}
            {provider.id && accountNames?.[provider.id] ? (
              <span className="min-w-0 break-all">{accountNames[provider.id]}</span>
            ) : (
              'Connected'
            )}
            {/* Only providers that can prove MFA say whether the account has it. */}
            {isMfaProvider(provider.providerId) && (
              <Badge tone={provider.mfaVerified ? 'success' : 'neutral'}>
                {provider.mfaVerified
                  ? `2FA on at ${providerLabel(provider.providerId)}`
                  : `No 2FA at ${providerLabel(provider.providerId)}`}
              </Badge>
            )}
          </DetailRow>
        ))}
      </dl>
    </Card>
  );
}

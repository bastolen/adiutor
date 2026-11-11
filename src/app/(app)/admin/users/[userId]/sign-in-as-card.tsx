/**
 * @file The "Sign in as user" card on the user detail page, for staff who may
 * sign in as someone (staff Admins, Managers and Support) on someone else's
 * page: what it does, and a dialog that starts it, with an optional reason.
 * When the rules don't allow it for this user (`mayImpersonate`), the card
 * says why and the button stays disabled. Starting needs a recent
 * confirmation with a strong second step, so the card sits in a confirmation
 * provider of its own in strong mode, which sends the staff member to the
 * step-up page first and back to this card. Text from `admin.user.signInAs`.
 * See docs/decisions/0017-staff-sign-in-as-users.md.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import TextField from '@/components/ui/text-field';
import TextLink from '@/components/ui/text-link';
import { IMPERSONATION_MINUTES, type ImpersonationVerdict } from '@/lib/authz/impersonation';
import { IMPERSONATION_REASON_MAX_LENGTH } from '@/lib/input-rules';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';

import { signInAsAction } from './actions';

/**
 * Props for {@link SignInAsCard}.
 */
interface SignInAsCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Whether the staff member may sign in as this user, and if not why (never `role` or `self`). */
  verdict: Exclude<ImpersonationVerdict, 'role' | 'self'>;
  /** Whether the staff member's account has strong MFA (`Actor.strongMfa`). */
  strongMfa: boolean;
  /** Until when their session counts as strongly confirmed (`Actor.strongMfaConfirmedUntil`). */
  strongMfaConfirmedUntil: Date | null;
  /** The page to come back to, with its tables' state (`PageUrl.current()`). */
  returnTo: string;
}

/**
 * The link to the staff member's own Security page, inside the note that
 * they need strong MFA first.
 *
 * @param chunks - The link's text.
 * @returns The link.
 */
function securityLink(chunks: ReactNode) {
  return <TextLink href="/account/security#passkeys">{chunks}</TextLink>;
}

/**
 * Offers signing in as the user, or says why it isn't possible.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.verdict - Whether it's allowed, and if not why.
 * @param props.strongMfa - Whether the staff member has strong MFA.
 * @param props.strongMfaConfirmedUntil - Until when their session is strongly confirmed.
 * @param props.returnTo - The page to come back to.
 * @returns The card.
 */
export default function SignInAsCard({
  userId,
  userName,
  verdict,
  strongMfa,
  strongMfaConfirmedUntil,
  returnTo,
}: SignInAsCardProps) {
  const t = useTranslations('admin.user.signInAs');
  const values = { name: userName, minutes: IMPERSONATION_MINUTES };
  /** Why it isn't possible, for the refusals. */
  const refusals: Record<Exclude<SignInAsCardProps['verdict'], 'allowed'>, ReactNode> = {
    staff_admin: t('refused.staffAdmin'),
    staff: t('refused.staff'),
    company_admin: t('refused.companyAdmin'),
    deactivated: t('refused.deactivated'),
    opted_out: t('refused.optedOut'),
    needs_mfa: t.rich('refused.needsMfa', { link: securityLink }),
  };
  return (
    <RecentConfirmationProvider
      required={strongMfa}
      returnTo={returnTo}
      mode="strong"
      {...confirmationWindow(strongMfaConfirmedUntil)}
    >
      <Card id="sign-in-as" title={t('title')} description={t('description', values)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="text-sm text-muted-foreground">
            {verdict === 'allowed' ? t('allowed', values) : refusals[verdict]}
          </p>
          <div className="shrink-0 self-start sm:self-auto">
            <ActionDialog
              disabled={verdict !== 'allowed'}
              confirmFirst
              action={signInAsAction}
              fields={{ userId }}
              triggerLabel={t('label')}
              triggerVariant="primary"
              title={t('dialogTitle', values)}
              description={t('dialogDescription', values)}
              confirmLabel={t('confirmLabel', values)}
              tone="primary"
            >
              <TextField
                name="reason"
                label={t('reasonLabel')}
                description={t('reasonHint')}
                maxLength={IMPERSONATION_REASON_MAX_LENGTH}
                autoComplete="off"
              />
            </ActionDialog>
          </div>
        </div>
      </Card>
    </RecentConfirmationProvider>
  );
}

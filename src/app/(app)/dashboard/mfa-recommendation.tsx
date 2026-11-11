/**
 * @file Dismissible dashboard banner recommending a passkey or two-step
 * verification. The dashboard renders it only while the user hasn't dismissed
 * it (saved with the account, `isMfaRecommendationDismissed`), so it's there
 * from the first paint and stays dismissed on every device.
 */
'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import Alert from '@/components/ui/alert';
import Banner from '@/components/ui/banner';
import Button from '@/components/ui/button';
import { useTransientState } from '@/components/ui/use-transient-state';

import dismissMfaRecommendationAction from './actions';

/**
 * A calm banner with a link to the Security page and a dismiss button. Dismiss
 * hides it at once and saves that with the account
 * (`dismissMfaRecommendationAction`, which refreshes the dashboard); if that
 * fails, the banner comes back with the reason, inline and as a toast. Its
 * text comes from the `dashboard` namespace.
 *
 * @returns The banner, or nothing once dismissed.
 */
export default function MfaRecommendation() {
  const t = useTranslations('dashboard.mfaRecommendation');
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useTransientState<string | null>(null);
  const [, startTransition] = useTransition();
  if (dismissed) {
    return null;
  }

  /** Hides the banner, and brings it back with the reason if saving fails. */
  const dismiss = () => {
    setDismissed(true);
    setError(null);
    startTransition(async () => {
      let failure: string | null = null;
      try {
        const result = await dismissMfaRecommendationAction();
        if (!result.ok) {
          failure = result.message;
        }
      } catch {
        failure = t('dismissFailed');
      }
      if (failure) {
        setDismissed(false);
        setError(failure);
      }
    });
  };

  return (
    <>
      <Banner
        label={t('label')}
        icon={ShieldCheck}
        tone="success"
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild size="sm">
            <Link href="/account/security">{t('setUp')}</Link>
          </Button>
        }
        onDismiss={dismiss}
      />
      {error && (
        <Alert tone="error" alsoToast>
          {error}
        </Alert>
      )}
    </>
  );
}

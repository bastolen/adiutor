/**
 * @file A webhook's signing secret, shown once: after the webhook is added,
 * and after its secret is renewed. Its text comes from
 * `admin.settings.webhooks.secret`.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import CopyButton from '@/components/ui/copy-button';
import { fieldControl } from '@/components/ui/styles';
import cn from '@/lib/cn';

/** Props for {@link WebhookSecret}. */
interface WebhookSecretProps {
  /** What was done, announced when the secret appears, e.g. "Webhook added." */
  done: string;
  /** The secret. */
  secret: string;
  /** Closes it: the secret is never shown again. */
  onClose: () => void;
}

/**
 * Says what was done and that the secret won't be shown again, with the
 * secret in a read-only field (selected on focus) and a button that copies
 * it, and a button to close.
 */
export default function WebhookSecret({ done, secret, onClose }: WebhookSecretProps) {
  const t = useTranslations('admin.settings.webhooks.secret');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success-soft p-4">
        <p role="status" className="text-sm font-medium text-success">
          {done} {t('title')}
        </p>
        <p className="text-sm text-foreground">{t('description')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t('label')}
            readOnly
            value={secret}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(fieldControl, 'h-10 min-w-0 flex-1 font-mono')}
          />
          <CopyButton value={secret} label={t('copy')} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}

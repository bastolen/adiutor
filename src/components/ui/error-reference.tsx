/**
 * @file The reference box of the error pages: a short reference such as
 * `7KQ2-M9XD` and when it happened, for users to send to an administrator,
 * with a button that copies both. The sign-in error page and the app's
 * error pages use it, so references look the same everywhere.
 */
import { useLocale, useTranslations } from 'next-intl';

import { formatDateTime } from '@/lib/format';

import CopyButton from './copy-button';

/**
 * Props for {@link ErrorReference}.
 */
interface ErrorReferenceProps {
  /** The reference, e.g. `7KQ2-M9XD`. */
  reference: string;
  /** When the error happened. */
  at: Date;
}

/**
 * A quiet box with the reference, its time and "Copy reference", which
 * copies e.g. "Reference 7KQ2-M9XD (Oct 28, 2026, 6:40 PM UTC)", in the reader's language.
 *
 * @param props - Component props.
 * @param props.reference - The reference.
 * @param props.at - When the error happened.
 * @returns The box.
 */
export default function ErrorReference({ reference, at }: ErrorReferenceProps) {
  const t = useTranslations('common.errorReference');
  const locale = useLocale();
  const when = formatDateTime(at, locale);
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-muted p-4 text-center">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <p className="flex flex-col items-center gap-1">
        <span className="font-mono text-lg font-semibold tracking-widest text-foreground">
          {reference}
        </span>
        <time dateTime={at.toISOString()} className="text-xs text-muted-foreground">
          {when}
        </time>
      </p>
      <CopyButton value={t('copyText', { reference, when })} label={t('copy')} />
    </div>
  );
}

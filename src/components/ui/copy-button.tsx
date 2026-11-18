/**
 * @file Button that copies text to the clipboard, and says whether it did.
 */
'use client';

import { Check, CircleAlert, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import Button from './button';
import { useToast } from './toast';
import { useTransientState } from './use-transient-state';

/** What the last press did: nothing to say (yet, or any more), copied, or refused. */
type CopyOutcome = 'idle' | 'copied' | 'failed';

/**
 * How long the button says what happened, in milliseconds. A failure stays
 * longer: on the signed-out pages, which have no toasts, it's the only place
 * that says so.
 */
const FEEDBACK_DURATIONS: Record<Exclude<CopyOutcome, 'idle'>, number> = {
  copied: 2000,
  failed: 5000,
};

/** The button's icon per outcome. */
const ICONS = { idle: Copy, copied: Check, failed: CircleAlert } as const;

/**
 * Props for {@link CopyButton}.
 */
interface CopyButtonProps {
  /** The text to copy. */
  value: string;
  /** Button text. */
  label: string;
}

/**
 * Copies a value and briefly shows "Copied", announced to screen readers.
 * When the browser refuses (no clipboard permission, a page that isn't
 * served securely), it shows "Couldn't copy" instead, announced the same
 * way, and as an error toast where the page has toasts (the signed-in app):
 * the value stays on screen next to the button, to select and copy by hand.
 * What it shows is forgotten when the page is hidden or the button goes.
 *
 * @param props - Button props.
 * @param props.value - The text to copy.
 * @param props.label - Button text.
 * @returns The button.
 */
export default function CopyButton({ value, label }: CopyButtonProps) {
  const t = useTranslations('common.actions');
  const showToast = useToast();
  const [outcome, setOutcome] = useTransientState<CopyOutcome>('idle');
  // The timer that takes the outcome away again.
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /**
   * Shows what the press did, for a moment.
   *
   * @param next - Copied or refused.
   */
  const show = (next: Exclude<CopyOutcome, 'idle'>) => {
    window.clearTimeout(timer.current);
    setOutcome(next);
    timer.current = window.setTimeout(() => setOutcome('idle'), FEEDBACK_DURATIONS[next]);
  };

  /** Copies the value and shows whether it worked. */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Refused, or there's no clipboard here (`navigator.clipboard` is missing on insecure pages).
      show('failed');
      showToast?.(t('copyFailed'), { tone: 'error' });
      return;
    }
    show('copied');
  };

  const Icon = ICONS[outcome];
  const texts = { idle: label, copied: t('copied'), failed: t('copyFailed') };

  return (
    <Button variant="secondary" onClick={copy}>
      <Icon aria-hidden="true" />
      <span aria-live="polite">{texts[outcome]}</span>
    </Button>
  );
}

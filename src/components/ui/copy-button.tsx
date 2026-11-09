/**
 * @file Button that copies text to the clipboard.
 */
'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import Button from './button';

/**
 * Props for {@link CopyButton}.
 */
interface CopyButtonProps {
  /** The text to copy. */
  value: string;
  /** Button text. Defaults to "Copy" in the reader's language. */
  label?: string;
}

/**
 * Copies a value and briefly shows "Copied", announced to screen readers.
 *
 * @param props - Button props.
 * @param props.value - The text to copy.
 * @param props.label - Button text.
 * @returns The button.
 */
export default function CopyButton({ value, label = undefined }: CopyButtonProps) {
  const t = useTranslations('common.actions');
  const [copied, setCopied] = useState(false);

  /** Copies the value and shows the confirmation for two seconds. */
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="secondary" onClick={copy}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? t('copied') : (label ?? t('copy'))}</span>
    </Button>
  );
}

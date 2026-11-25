/**
 * @file The field for a code: an authenticator app code, an emailed code or a
 * backup code. Every form that asks for one uses it (the sign-in code step,
 * the step-up page and the Security page's setups), so its label and the
 * attributes browsers and password managers rely on are the same everywhere.
 * Its text is in `common` (`common.codeField`), since the Security page uses
 * it too.
 */
import { useTranslations } from 'next-intl';
import type { ChangeEventHandler } from 'react';

import TextField from '@/components/ui/text-field';
import type { CodeKind } from '@/lib/sign-in/verify-code';

/** Props for {@link CodeField}. */
interface CodeFieldProps {
  /** What the code is. */
  kind: CodeKind;
  /** The code as typed. */
  value: string;
  /** Called as the user types. */
  onChange: ChangeEventHandler<HTMLInputElement>;
  /** Whether it takes focus when it appears. */
  autoFocus?: boolean;
  /**
   * Whether an authenticator app code gets its help text, "The 6-digit code
   * shown in your authenticator app." Defaults to true; a form that says it
   * already turns it off. Other codes have none.
   */
  hint?: boolean;
}

/**
 * A required code field: "Backup code" for a backup code (any characters,
 * nothing to fill in), otherwise "Code" with the numeric keyboard and the
 * browser's one-time code suggestion.
 */
export default function CodeField({
  kind,
  value,
  onChange,
  autoFocus = false,
  hint = true,
}: CodeFieldProps) {
  const t = useTranslations('common');
  const backup = kind === 'backup';
  const help = hint && kind === 'totp' ? t('codeField.authenticatorHint') : '';
  return (
    <TextField
      label={backup ? t('codeField.backupCode') : t('codeField.code')}
      name="code"
      required
      autoFocus={autoFocus}
      autoComplete={backup ? 'off' : 'one-time-code'}
      inputMode={backup ? 'text' : 'numeric'}
      spellCheck={false}
      description={help}
      value={value}
      onChange={onChange}
      className="font-mono tracking-widest"
    />
  );
}

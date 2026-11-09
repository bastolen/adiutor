/**
 * @file Tests for the code field: its label, the attributes browsers rely on
 * for each kind of code, and its help text.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CodeField from './code-field';

/** Ignores typing: these tests only look at the field. */
const ignore = () => {};

describe('CodeField', () => {
  it.each([
    [
      'totp',
      'Code',
      'one-time-code',
      'numeric',
      'The 6-digit code shown in your authenticator app.',
    ],
    ['otp', 'Code', 'one-time-code', 'numeric', ''],
    ['backup', 'Backup code', 'off', 'text', ''],
  ] as const)(
    'labels a %s code %j, with its keyboard, suggestion and help text',
    (kind, label, autoComplete, inputMode, description) => {
      render(<CodeField kind={kind} value="" onChange={ignore} />);

      const input = screen.getByRole('textbox', { name: label });
      expect(input).toBeRequired();
      expect(input).toHaveAttribute('name', 'code');
      expect(input).toHaveAttribute('autocomplete', autoComplete);
      expect(input).toHaveAttribute('inputmode', inputMode);
      expect(input).toHaveAttribute('spellcheck', 'false');
      expect(input).toHaveAccessibleDescription(description);
    },
  );

  it('leaves the help text out when the form says it already', () => {
    render(<CodeField kind="totp" value="" onChange={ignore} description="" />);

    expect(screen.getByRole('textbox', { name: 'Code' })).not.toHaveAttribute('aria-describedby');
  });

  it('takes focus only when asked to', () => {
    const { unmount } = render(<CodeField kind="otp" value="" onChange={ignore} />);
    expect(screen.getByRole('textbox', { name: 'Code' })).not.toHaveFocus();
    unmount();

    render(<CodeField kind="otp" value="" onChange={ignore} autoFocus />);
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveFocus();
  });
});

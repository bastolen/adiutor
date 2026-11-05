/**
 * @file Tests for the multi-line text field: its label, its default size, and
 * its description read out with it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TextAreaField from './textarea-field';

describe('TextAreaField', () => {
  it('is labelled, three lines tall and has no description by default', () => {
    render(<TextAreaField label="Message" name="message" />);

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '3');
    expect(textarea).not.toHaveAttribute('aria-describedby');
  });

  it('reads out the description with the field', () => {
    render(
      <TextAreaField
        label="Email addresses"
        name="emails"
        description="One per line, e.g. user@adiutor.test."
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Email addresses' })).toHaveAccessibleDescription(
      'One per line, e.g. user@adiutor.test.',
    );
  });
});

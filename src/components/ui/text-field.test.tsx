/**
 * @file Tests for the text field: its label, and its description read out
 * with it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TextField from './text-field';

describe('TextField', () => {
  it('is labelled, valid and has no description by default', () => {
    render(<TextField label="Email" name="email" />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('reads out the description with the field', () => {
    render(
      <TextField
        label="URL name"
        name="slug"
        description="Lowercase letters, numbers and dashes."
      />,
    );

    expect(screen.getByRole('textbox', { name: 'URL name' })).toHaveAccessibleDescription(
      'Lowercase letters, numbers and dashes.',
    );
  });

  it('uses the ID it is given, for the label and the description', () => {
    render(<TextField id="company-name" label="Name" description="As your users know it." />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('id', 'company-name');
    expect(input).toHaveAttribute('aria-describedby', 'company-name-description');
  });
});

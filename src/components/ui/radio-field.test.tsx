/**
 * @file Tests for the labelled radio button.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import RadioField from './radio-field';

describe('RadioField', () => {
  it('is named by its label and described by its help text', () => {
    render(<RadioField name="picture" value="github" label="GitHub" description="Your avatar" />);

    const radio = screen.getByRole('radio', { name: 'GitHub' });
    expect(radio).toHaveAccessibleDescription('Your avatar');
  });

  it('is chosen by clicking its label, one at a time in its group', async () => {
    render(
      <>
        <RadioField name="picture" value="github" label="GitHub" defaultChecked />
        <RadioField name="picture" value="initials" label="Initials" leading={<span>AA</span>} />
      </>,
    );

    await userEvent.click(screen.getByText('Initials'));

    expect(screen.getByRole('radio', { name: 'Initials' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'GitHub' })).not.toBeChecked();
    expect(screen.getByText('AA')).toBeInTheDocument();
  });

  it('can’t be chosen while disabled', async () => {
    render(<RadioField name="picture" value="google" label="Google" disabled />);

    await userEvent.click(screen.getByText('Google'));

    expect(screen.getByRole('radio', { name: 'Google' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Google' })).not.toBeChecked();
  });
});

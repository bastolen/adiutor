/**
 * @file Tests for the colour field: its label and swatch, the swatch
 * following what's typed (or the fallback), and picking a colour.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ColourField from './colour-field';

/**
 * A colour field that keeps what's typed, as a form does.
 *
 * @param props - Test props.
 * @param props.initial - The text to start with.
 * @param props.onChange - Told of every change.
 */
function Field({
  initial = '',
  onChange = () => {},
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColourField
      label="Accent"
      pickLabel="Pick the accent"
      description="Buttons, links and focus rings."
      name="accent"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      fallback="#0e5655"
    />
  );
}

describe('ColourField', () => {
  it('labels the text field, describes it, and names the swatch', () => {
    render(<Field initial="#c2185b" />);

    const text = screen.getByRole('textbox', { name: 'Accent' });
    expect(text).toHaveValue('#c2185b');
    expect(text).toHaveAccessibleDescription('Buttons, links and focus rings.');
    expect(text).toHaveAttribute('name', 'accent');
    expect(screen.getByLabelText('Pick the accent')).toHaveValue('#c2185b');
  });

  it('shows the fallback in the swatch until what’s typed is a colour', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const swatch = screen.getByLabelText('Pick the accent');
    expect(swatch).toHaveValue('#0e5655');
    expect(screen.getByRole('textbox', { name: 'Accent' })).toHaveAttribute(
      'placeholder',
      '#0e5655',
    );

    await user.type(screen.getByRole('textbox', { name: 'Accent' }), 'C2185');
    expect(swatch).toHaveValue('#0e5655');
    await user.type(screen.getByRole('textbox', { name: 'Accent' }), 'B');
    expect(swatch).toHaveValue('#c2185b');
  });

  it('puts a picked colour in the text field', () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Pick the accent'), { target: { value: '#2e7d32' } });

    expect(onChange).toHaveBeenLastCalledWith('#2e7d32');
    expect(screen.getByRole('textbox', { name: 'Accent' })).toHaveValue('#2e7d32');
  });

  it('can’t be changed when it’s turned off', () => {
    render(
      <ColourField
        label="Tint"
        pickLabel="Pick the tint"
        name="tint"
        value=""
        onChange={() => {}}
        fallback="#0e0e2d"
        disabled
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Tint' })).toBeDisabled();
    expect(screen.getByLabelText('Pick the tint')).toBeDisabled();
  });
});

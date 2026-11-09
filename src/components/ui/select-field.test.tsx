/**
 * @file Tests for the select field, including its busy state.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SelectField from './select-field';

/** Role options, one with a description. */
const options = [
  {
    value: 'client',
    label: 'Client',
    description: 'Raises requests, comments on them and approves work.',
  },
  { value: 'watcher', label: 'Watcher' },
];

describe('SelectField', () => {
  it('is labelled by its visible label and shows only the chosen label', () => {
    render(<SelectField label="Role" options={options} defaultValue="client" />);

    const select = screen.getByRole('combobox', { name: 'Role' });
    expect(select).toHaveTextContent('Client');
    expect(select).not.toHaveTextContent('Raises requests');
  });

  it('reads out option descriptions after the label, as part of the option name', async () => {
    const user = userEvent.setup();
    render(<SelectField label="Role" options={options} defaultValue="watcher" />);

    await user.click(screen.getByRole('combobox', { name: 'Role' }));

    expect(
      screen.getByRole('option', {
        name: 'Client Raises requests, comments on them and approves work.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Watcher' })).toBeInTheDocument();
  });

  it("shows an option's icon in the list and when chosen, keeping the label as its name", async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        label="Language"
        options={[
          {
            value: 'nl-NL',
            label: 'Nederlands',
            icon: <svg aria-hidden="true" data-testid="nl" />,
          },
          { value: 'es-ES', label: 'Español', icon: <svg aria-hidden="true" data-testid="es" /> },
        ]}
        defaultValue="nl-NL"
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveTextContent('Nederlands');
    expect(select.querySelector('[data-testid="nl"]')).not.toBeNull();

    await user.click(select);
    const option = screen.getByRole('option', { name: 'Español' });
    expect(option.querySelector('[data-testid="es"]')).not.toBeNull();
  });

  it('reports the chosen value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="Role"
        options={options}
        defaultValue="watcher"
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    await user.click(screen.getByRole('option', { name: /^Client/ }));

    expect(onValueChange).toHaveBeenCalledWith('client');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Client');
  });

  it('stays focusable but closed while busy, and opens again once it is not', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SelectField label="Role" options={options} defaultValue="watcher" busy />,
    );

    const select = screen.getByRole('combobox', { name: 'Role' });
    expect(select).toHaveAttribute('aria-busy', 'true');
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toBeEnabled();
    select.focus();
    expect(select).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    rerender(<SelectField label="Role" options={options} defaultValue="watcher" />);
    expect(select).not.toHaveAttribute('aria-busy');
    await user.click(select);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});

describe('SelectField with a description', () => {
  it('links its help text to the field', () => {
    render(
      <SelectField
        label="Email language"
        options={[{ value: 'en-US', label: 'English (US)' }]}
        defaultValue="en-US"
        description="The invitation and its reminder are sent in this language."
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Email language' })).toHaveAccessibleDescription(
      'The invitation and its reminder are sent in this language.',
    );
  });
});

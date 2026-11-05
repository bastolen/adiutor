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

/**
 * @file Tests for the short select field (up to its search threshold),
 * including its groups and its busy state. The searchable one has its own
 * tests (`searchable-select.test.tsx`).
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

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

  it('marks a label in another language with its language, in the list and when chosen', async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        label="Language"
        options={[
          { value: 'default', label: 'Default' },
          { value: 'nl-NL', label: 'Nederlands', lang: 'nl-NL' },
          { value: 'es-ES', label: 'Español', lang: 'es-ES', icon: <svg aria-hidden="true" /> },
        ]}
        defaultValue="nl-NL"
      />,
    );

    // The closed select: a screen reader says the chosen language's name in that language.
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(within(select).getByText('Nederlands')).toHaveAttribute('lang', 'nl-NL');

    await user.click(select);
    const spanish = screen.getByRole('option', { name: 'Español' });
    expect(within(spanish).getByText('Español')).toHaveAttribute('lang', 'es-ES');
    // A label in the page's own language carries none.
    expect(screen.getByRole('option', { name: 'Default' }).querySelector('[lang]')).toBeNull();
  });

  it('lists options with a group under its heading', async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        label="Time zone"
        options={[
          { value: 'UTC', label: 'UTC' },
          { value: 'Europe/Amsterdam', label: 'Amsterdam', group: 'Europe' },
          { value: 'Europe/Paris', label: 'Paris', group: 'Europe' },
          { value: 'Asia/Tokyo', label: 'Tokyo', group: 'Asia' },
        ]}
        defaultValue="UTC"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Time zone' }));

    const europe = screen.getByRole('group', { name: 'Europe' });
    expect(
      within(europe)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Amsterdam', 'Paris']);
    expect(
      within(screen.getByRole('group', { name: 'Asia' })).getByRole('option'),
    ).toHaveTextContent('Tokyo');
    // Short: no search field.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('outlines the option the keyboard is on, as well as filling it', async () => {
    const user = userEvent.setup();
    render(<SelectField label="Role" options={options} defaultValue="watcher" />);

    await user.click(screen.getByRole('combobox', { name: 'Role' }));

    screen.getAllByRole('option').forEach((option) => {
      expect(option).toHaveClass(
        'data-highlighted:bg-raised-muted',
        'data-highlighted:outline-2',
        'data-highlighted:-outline-offset-2',
        'data-highlighted:outline-ring',
      );
      // Either class turns Tailwind's outline style off, so `outline-2` would draw nothing.
      expect(option).not.toHaveClass('outline-none');
      expect(option).not.toHaveClass('outline-hidden');
    });
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

  it('goes back to the value it started with when its form is reset', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <SelectField label="Role" name="role" options={options} defaultValue="watcher" />
      </form>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    await user.click(screen.getByRole('option', { name: /^Client/ }));
    act(() => defined(container.querySelector('form'), 'the form').reset());

    // Forms that edit a saved setting therefore aren't cleared after a save (`resetOnSuccess`).
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Watcher');
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

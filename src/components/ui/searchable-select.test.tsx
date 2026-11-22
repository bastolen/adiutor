/**
 * @file Tests for the searchable select: a `SelectField` with more options
 * than its threshold, which opens a search field above its list.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../tests/i18n/render';
import SelectField, { SEARCH_THRESHOLD, type SelectOption } from './select-field';

/** Twelve cities, more than the threshold, in three regions. */
const cities: SelectOption[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Africa/Accra', label: 'Accra (UTC)', group: 'Africa' },
  { value: 'Africa/Cairo', label: 'Cairo (UTC+02:00)', group: 'Africa' },
  { value: 'America/Bogota', label: 'Bogota (UTC−05:00)', group: 'Americas' },
  { value: 'America/New_York', label: 'New York (UTC−05:00)', group: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (UTC−03:00)', group: 'Americas' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (UTC+01:00)', group: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin (UTC+01:00)', group: 'Europe' },
  { value: 'Europe/Lisbon', label: 'Lisbon (UTC)', group: 'Europe' },
  { value: 'Europe/London', label: 'London (UTC)', group: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+01:00)', group: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris (UTC+01:00)', group: 'Europe' },
];

/**
 * The search field of the open select.
 *
 * @returns The search field.
 */
function searchField(): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('combobox');
}

/**
 * The option the search field points at: the one Enter picks.
 *
 * @returns The active option's element.
 */
function activeOption(): HTMLElement {
  const id = defined(searchField().getAttribute('aria-activedescendant'), 'an active option');
  return defined(document.getElementById(id), 'the active option');
}

describe('SelectField with many options', () => {
  it('becomes searchable with more options than the threshold, and stays short otherwise', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <SelectField label="City" options={cities.slice(0, SEARCH_THRESHOLD)} defaultValue="UTC" />,
    );
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    render(<SelectField label="City" options={cities} defaultValue="UTC" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByRole('dialog', { name: 'City' })).toBeInTheDocument();
    expect(searchField()).toHaveAccessibleName('City');
    expect(searchField()).toHaveAttribute('placeholder', 'Type to search');
  });

  it('takes its own threshold', async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        label="Role"
        options={[
          { value: 'client', label: 'Client' },
          { value: 'watcher', label: 'Watcher' },
        ]}
        defaultValue="client"
        searchThreshold={1}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    expect(screen.getByRole('dialog', { name: 'Role' })).toBeInTheDocument();
  });

  it('is a combobox named by its label that shows the chosen option and its help text', () => {
    render(
      <SelectField
        label="City"
        options={cities}
        defaultValue="Europe/Amsterdam"
        description="Times are shown in this zone."
      />,
    );

    const field = screen.getByRole('combobox', { name: 'City' });
    expect(field).toHaveTextContent('Amsterdam (UTC+01:00)');
    expect(field).toHaveAttribute('aria-expanded', 'false');
    expect(field).toHaveAttribute('aria-haspopup', 'dialog');
    expect(field).toHaveAccessibleDescription('Times are shown in this zone.');
  });

  it('shows the placeholder while nothing is chosen', () => {
    render(<SelectField label="City" options={cities} defaultValue="" placeholder="Pick a city" />);

    const field = screen.getByRole('combobox', { name: 'City' });
    expect(field).toHaveTextContent('Pick a city');
    expect(field).toHaveAttribute('data-placeholder');
  });

  it('opens with the search focused and the chosen option active, its regions as groups', async () => {
    const user = userEvent.setup();
    render(<SelectField label="City" options={cities} defaultValue="Europe/Berlin" />);

    await user.click(screen.getByRole('combobox', { name: 'City' }));

    expect(searchField()).toHaveFocus();
    expect(searchField()).toHaveValue('');
    expect(activeOption()).toHaveAccessibleName('Berlin (UTC+01:00)');
    expect(activeOption()).toHaveAttribute('aria-selected', 'true');
    expect(activeOption()).toHaveAttribute('data-highlighted');
    expect(screen.getAllByRole('option')).toHaveLength(cities.length);
    expect(screen.getByRole('group', { name: 'Europe' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Americas' })).getAllByRole('option'),
    ).toHaveLength(3);
  });

  it('opens with Enter and the arrow keys, and with a typed letter in the search', async () => {
    const user = userEvent.setup();
    render(<SelectField label="City" options={cities} defaultValue="UTC" />);
    const field = screen.getByRole('combobox', { name: 'City' });

    for (const key of ['{Enter}', '{ArrowDown}', '{ArrowUp}']) {
      field.focus();
      // One at a time: each opens the list, and Escape closes it again.
      // eslint-disable-next-line no-await-in-loop -- The keys are pressed one after the other.
      await user.keyboard(key);
      expect(searchField()).toHaveFocus();
      // eslint-disable-next-line no-await-in-loop -- As above.
      await user.keyboard('{Escape}');
      expect(field).toHaveFocus();
    }

    await user.keyboard('p');
    expect(searchField()).toHaveFocus();
    expect(searchField()).toHaveValue('p');
    await user.keyboard('ar');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Paris (UTC+01:00)',
    ]);
  });

  it('filters the options by label and region as you type, and makes the first match active', async () => {
    const user = userEvent.setup();
    render(<SelectField label="City" options={cities} defaultValue="UTC" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));

    await user.keyboard('new y');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(activeOption()).toHaveAccessibleName('New York (UTC−05:00)');

    await user.clear(searchField());
    await user.keyboard('-05');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Bogota (UTC−05:00)',
      'New York (UTC−05:00)',
    ]);

    await user.clear(searchField());
    await user.keyboard('africa');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Africa' })).toBeInTheDocument();

    await user.clear(searchField());
    await user.keyboard('atlantis');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(searchField()).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByText('No options match your search.')).toBeInTheDocument();
  });

  it('says how many options match once typing pauses', async () => {
    const user = userEvent.setup();
    render(<SelectField label="City" options={cities} defaultValue="UTC" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    await user.keyboard('+01');
    // Not at each key: only once typing pauses.
    expect(status).toBeEmptyDOMElement();
    await waitFor(() => expect(status).toHaveTextContent('4 options match'));

    await user.keyboard('x');
    await waitFor(() => expect(status).toHaveTextContent('No options match'));
  });

  it('moves the active option with the arrow, Page, Home and End keys, stopping at the ends', async () => {
    const user = userEvent.setup();
    render(<SelectField label="City" options={cities} defaultValue="UTC" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    /**
     * The text of the option Enter would pick.
     *
     * @returns Its text.
     */
    const names = () => activeOption().textContent;

    expect(names()).toBe('UTC');
    await user.keyboard('{ArrowUp}');
    expect(names()).toBe('UTC');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(names()).toBe('Cairo (UTC+02:00)');
    await user.keyboard('{PageDown}');
    expect(names()).toBe('Paris (UTC+01:00)');
    await user.keyboard('{ArrowDown}');
    expect(names()).toBe('Paris (UTC+01:00)');
    await user.keyboard('{PageUp}');
    expect(names()).toBe('Accra (UTC)');
    await user.keyboard('{End}');
    expect(names()).toBe('Paris (UTC+01:00)');
    await user.keyboard('{Home}');
    expect(names()).toBe('UTC');
    // Only one option is active (and outlined) at a time.
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
    expect(document.querySelectorAll('[role="option"][data-highlighted]')).toHaveLength(1);
  });

  it('picks the active option with Enter, putting focus back on the field', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="City"
        options={cities}
        defaultValue="UTC"
        onValueChange={onValueChange}
      />,
    );
    const field = screen.getByRole('combobox', { name: 'City' });

    await user.click(field);
    await user.keyboard('lis{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('Europe/Lisbon');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(field).toHaveTextContent('Lisbon (UTC)');

    // Picking the chosen option again changes nothing.
    await user.keyboard('{Enter}{Enter}');
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('picks an option with a click', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="City"
        options={cities}
        defaultValue="UTC"
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.click(screen.getByRole('option', { name: 'Madrid (UTC+01:00)' }));

    expect(onValueChange).toHaveBeenCalledWith('Europe/Madrid');
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('Madrid');
  });

  it('closes without a change on Escape and on Tab, with focus back on the field', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="City"
        options={cities}
        defaultValue="UTC"
        onValueChange={onValueChange}
      />,
    );
    const field = screen.getByRole('combobox', { name: 'City' });

    await user.click(field);
    await user.keyboard('paris{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveFocus();

    await user.keyboard('{Enter}');
    // The search starts empty again.
    expect(searchField()).toHaveValue('');
    await user.keyboard('berl{Tab}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveFocus();

    expect(onValueChange).not.toHaveBeenCalled();
    expect(field).toHaveTextContent('UTC');
  });

  it('follows a controlled value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <SelectField
        label="City"
        options={cities}
        value="Europe/Paris"
        onValueChange={onValueChange}
      />,
    );
    const field = screen.getByRole('combobox', { name: 'City' });

    await user.click(field);
    await user.keyboard('cairo{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('Africa/Cairo');
    // Until its owner changes it, it shows the value it's given.
    expect(field).toHaveTextContent('Paris');

    rerender(
      <SelectField
        label="City"
        options={cities}
        value="Africa/Cairo"
        onValueChange={onValueChange}
      />,
    );
    expect(field).toHaveTextContent('Cairo');
  });

  it('submits the chosen value under its name, and goes back to its first one when its form is reset', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <SelectField label="City" name="timeZone" options={cities} defaultValue="UTC" />
      </form>,
    );
    const form = defined(container.querySelector('form'), 'the form');

    expect(new FormData(form).get('timeZone')).toBe('UTC');
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.keyboard('amst{Enter}');
    expect(new FormData(form).get('timeZone')).toBe('Europe/Amsterdam');

    act(() => form.reset());
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('UTC');
    expect(new FormData(form).get('timeZone')).toBe('UTC');
  });

  it('submits nothing and does not open while disabled', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <SelectField label="City" name="timeZone" options={cities} defaultValue="UTC" disabled />
      </form>,
    );

    const field = screen.getByRole('combobox', { name: 'City' });
    expect(field).toBeDisabled();
    await user.click(field);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(new FormData(defined(container.querySelector('form'), 'the form')).has('timeZone')).toBe(
      false,
    );
  });

  it('stays focusable but closed while busy, and opens again once it is not', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SelectField label="City" options={cities} defaultValue="UTC" busy />,
    );

    const field = screen.getByRole('combobox', { name: 'City' });
    expect(field).toHaveAttribute('aria-busy', 'true');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(field).toBeEnabled();
    field.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('a');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveFocus();

    rerender(<SelectField label="City" options={cities} defaultValue="UTC" />);
    expect(field).not.toHaveAttribute('aria-busy');
    await user.click(field);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows descriptions, icons and languages like the short select', async () => {
    const user = userEvent.setup();
    const options: SelectOption[] = [
      ...cities.slice(1),
      {
        value: 'nl-NL',
        label: 'Nederlands',
        lang: 'nl-NL',
        description: 'Written in Dutch.',
        icon: <svg aria-hidden="true" data-testid="flag" />,
      },
    ];
    render(<SelectField label="City" options={options} defaultValue="nl-NL" />);

    const field = screen.getByRole('combobox', { name: 'City' });
    expect(within(field).getByText('Nederlands')).toHaveAttribute('lang', 'nl-NL');
    expect(field).not.toHaveTextContent('Written in Dutch.');
    await user.click(field);
    const option = screen.getByRole('option', { name: 'Nederlands Written in Dutch.' });
    expect(option.querySelector('[data-testid="flag"]')).not.toBeNull();
  });

  it('speaks the reader’s language', async () => {
    const user = userEvent.setup();
    renderInLocale('nl-NL', <SelectField label="Stad" options={cities} defaultValue="UTC" />);

    await user.click(screen.getByRole('combobox', { name: 'Stad' }));
    expect(searchField()).toHaveAttribute('placeholder', 'Typ om te zoeken');
    await user.keyboard('atlantis');
    expect(screen.getByText('Geen opties gevonden voor je zoekopdracht.')).toBeInTheDocument();
  });
});

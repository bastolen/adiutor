/**
 * @file Tests for the filter menu: its button, the choices as links with the
 * current one checked, and the keyboard behaviour that Radix brings.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import FilterMenu, { type FilterOption } from './filter-menu';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router; choosing a filter pushes its link.
   *
   * @returns The router.
   */
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The types of requests to filter by.
 *
 * @param current - The value of the current choice (`''` for all).
 * @returns The choices.
 */
function typeOptions(current = ''): FilterOption[] {
  return [
    { value: '', label: 'All', href: '/requests' },
    { value: 'hotfix', label: 'Hotfix', href: '/requests?type=hotfix' },
    { value: 'bug', label: 'Bug', href: '/requests?type=bug' },
  ].map((option) => ({ ...option, current: option.value === current }));
}

describe('FilterMenu', () => {
  it('names what it filters by while everything shows', () => {
    render(<FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions()} />);

    const trigger = screen.getByRole('button', { name: 'Type' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('says what is chosen once the list is filtered', () => {
    render(<FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions('bug')} />);

    expect(screen.getByRole('button', { name: 'Type: Bug' })).toBeInTheDocument();
  });

  it('lists every choice as a menu radio item that links to its page, the current one checked', async () => {
    const user = userEvent.setup();
    render(<FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions('hotfix')} />);

    await user.click(screen.getByRole('button', { name: 'Type: Hotfix' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Filter by type')).toBeInTheDocument();
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
      ['All', '/requests'],
      ['Hotfix', '/requests?type=hotfix'],
      ['Bug', '/requests?type=bug'],
    ]);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('closes as soon as a choice is made', async () => {
    const user = userEvent.setup();
    render(<FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions()} />);

    await user.click(screen.getByRole('button', { name: 'Type' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Bug' }));

    // Following the link is the browser's and Next's work; the menu is gone meanwhile.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens with the keyboard, moves with the arrow keys and closes with Escape, back on its button', async () => {
    const user = userEvent.setup();
    render(<FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions()} />);

    const trigger = screen.getByRole('button', { name: 'Type' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Hotfix' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each(['nl-NL', 'es-ES'] as const)('joins the filter and its choice in %s too', (locale) => {
    renderInLocale(
      locale,
      <FilterMenu label="Type" menuLabel="Filter by type" options={typeOptions('bug')} />,
    );

    expect(screen.getByRole('button', { name: 'Type: Bug' })).toBeInTheDocument();
  });
});

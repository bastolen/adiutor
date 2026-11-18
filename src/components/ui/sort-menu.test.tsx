/**
 * @file Tests for the Sort menu: its button, the sorting choices as links
 * with the current one checked, and the keyboard behaviour that Radix brings.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { SortOption } from '@/lib/tables/table-state';

import SortMenu from './sort-menu';

/** Three ways to sort the members, sorted by name from A to Z. */
const OPTIONS: readonly SortOption[] = [
  { value: 'name-asc', label: 'Name, A to Z', href: '/members?sort=name&dir=asc', current: true },
  {
    value: 'name-desc',
    label: 'Name, Z to A',
    href: '/members?sort=name&dir=desc',
    current: false,
  },
  {
    value: 'joined-desc',
    label: 'Joined, newest first',
    href: '/members?sort=joined&dir=desc',
    current: false,
  },
];

/**
 * The name of the menu's button as jsdom computes it: "Sort members: Name, A
 * to Z" without some spaces, as jsdom drops the space around the
 * screen-reader-only text (browsers keep it, see the text content check).
 */
const TRIGGER_NAME = /^Sort\s*members:\s*Name, A to Z$/;

/**
 * Opens the menu with a click.
 *
 * @param user - The simulated user.
 * @returns The menu's button.
 */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: /^Sort\s*members/ });
  await user.click(trigger);
  return trigger;
}

describe('SortMenu', () => {
  describe('button', () => {
    it('says how the table is sorted, and for screen readers what it sorts', () => {
      render(<SortMenu label="members" options={OPTIONS} />);

      const trigger = screen.getByRole('button', { name: TRIGGER_NAME });
      // "Sort" is only seen on phones; from 640px (`sm`) the current sort is. Both are part of
      // the name, which screen readers hear whole.
      expect(within(trigger).getByText('Sort')).toHaveClass('sm:hidden');
      expect(within(trigger).getByText('Sort')).toHaveAttribute('aria-hidden', 'true');
      expect(within(trigger).getByText('Name, A to Z')).toHaveClass('max-sm:hidden');
      expect(within(trigger).getByText('Sort members: Name, A to Z')).toHaveClass('sr-only');
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('is named after other rows too', () => {
      render(<SortMenu label="invitations" options={OPTIONS} />);

      expect(
        screen.getByRole('button', { name: /^Sort\s*invitations:\s*Name, A to Z$/ }),
      ).toBeInTheDocument();
    });

    it('says Sort everywhere when no choice is current', () => {
      render(
        <SortMenu
          label="members"
          options={OPTIONS.map((option) => ({ ...option, current: false }))}
        />,
      );

      const trigger = screen.getByRole('button', { name: /^Sort\s*members$/ });
      expect(within(trigger).getByText('Sort')).not.toHaveClass('sm:hidden');
    });

    it('hides its icon from assistive technology', () => {
      render(<SortMenu label="members" options={OPTIONS} />);

      expect(screen.getByRole('button').querySelector('svg')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

    it('opens no menu until it is used', () => {
      render(<SortMenu label="members" options={OPTIONS} />);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('menu', () => {
    it('opens with a "Sort by" label, named after the button', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      const trigger = await openMenu(user);

      const menu = screen.getByRole('menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(within(menu).getByText('Sort by')).toBeInTheDocument();
      expect(menu).toHaveAccessibleName(TRIGGER_NAME);
    });

    it('lists every way to sort as a menu radio item that links to its page', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      await openMenu(user);

      const items = screen.getAllByRole('menuitemradio');
      expect(items).toHaveLength(3);
      expect(items.map((item) => item.tagName)).toEqual(['A', 'A', 'A']);
      expect(screen.getByRole('menuitemradio', { name: 'Name, A to Z' })).toHaveAttribute(
        'href',
        '/members?sort=name&dir=asc',
      );
      expect(screen.getByRole('menuitemradio', { name: 'Name, Z to A' })).toHaveAttribute(
        'href',
        '/members?sort=name&dir=desc',
      );
      expect(screen.getByRole('menuitemradio', { name: 'Joined, newest first' })).toHaveAttribute(
        'href',
        '/members?sort=joined&dir=desc',
      );
    });

    it('checks the current way to sort and no other', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      await openMenu(user);

      expect(screen.getByRole('menuitemradio', { name: 'Name, A to Z' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('menuitemradio', { name: 'Name, Z to A' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.getByRole('menuitemradio', { name: 'Joined, newest first' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('follows the table when it is sorted another way', async () => {
      const user = userEvent.setup();
      const options = OPTIONS.map((option) => ({
        ...option,
        current: option.value === 'joined-desc',
      }));
      render(<SortMenu label="members" options={options} />);

      const trigger = await openMenu(user);

      expect(trigger).toHaveTextContent('Sort members: Joined, newest first');
      expect(screen.getByRole('menuitemradio', { name: 'Joined, newest first' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('menuitemradio', { name: 'Name, A to Z' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('checks nothing when no way to sort is current', async () => {
      const user = userEvent.setup();
      render(
        <SortMenu
          label="members"
          options={OPTIONS.map((option) => ({ ...option, current: false }))}
        />,
      );

      await openMenu(user);

      screen
        .getAllByRole('menuitemradio')
        .forEach((item) => expect(item).toHaveAttribute('aria-checked', 'false'));
    });

    it('marks the checked item with a decorative check', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      await openMenu(user);

      const checked = screen.getByRole('menuitemradio', { name: 'Name, A to Z' });
      expect(checked.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(
        screen.getByRole('menuitemradio', { name: 'Name, Z to A' }).querySelector('svg'),
      ).not.toBeInTheDocument();
    });
  });

  describe('keyboard', () => {
    it('opens with Enter and moves through the choices with the arrow keys', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      screen.getByRole('button', { name: TRIGGER_NAME }).focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'Name, A to Z' })).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitemradio', { name: 'Name, Z to A' })).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitemradio', { name: 'Joined, newest first' })).toHaveFocus();
    });

    it('closes with Escape and returns focus to the button', async () => {
      const user = userEvent.setup();
      render(<SortMenu label="members" options={OPTIONS} />);

      const trigger = await openMenu(user);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('layout', () => {
    it('renders only its button, with no wrapper around it', () => {
      const { container } = render(<SortMenu label="members" options={OPTIONS} />);

      expect(container.childElementCount).toBe(1);
      expect(container.firstElementChild).toBe(screen.getByRole('button', { name: TRIGGER_NAME }));
    });
  });
});

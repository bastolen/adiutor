/**
 * @file Tests for the menu parts: the row of icon choices (its names,
 * choosing an item, and moving through it with the arrow keys) and the radio
 * items that are links.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Leaf, Pencil, Shell, Sprout } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MenuContent,
  MenuIconRadioItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioLinkItem,
  MenuRadioRow,
  MenuRoot,
  MenuTrigger,
} from './dropdown-menu';

/**
 * A menu with an item, a row of three icon choices, and another item.
 *
 * @param props - Test props.
 * @param props.onChoose - Called with each chosen value.
 * @returns The menu.
 */
function RowMenu({ onChoose }: { onChoose: (value: string) => void }) {
  const [value, setValue] = useState('green');
  return (
    <MenuRoot>
      <MenuTrigger>Open</MenuTrigger>
      <MenuContent>
        <MenuItem>Before</MenuItem>
        <MenuRadioRow
          label="Colour"
          icon={Pencil}
          value={value}
          onValueChange={(next) => {
            setValue(next);
            onChoose(next);
          }}
        >
          <MenuIconRadioItem value="green" label="Green" icon={Leaf} />
          <MenuIconRadioItem value="teal" label="Teal" icon={Shell} />
          <MenuIconRadioItem value="lime" label="Lime" icon={Sprout} />
        </MenuRadioRow>
        <MenuItem>After</MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

describe('MenuRadioRow', () => {
  it('names the group by its label and each icon by its own', async () => {
    const user = userEvent.setup();
    render(<RowMenu onChoose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const group = screen.getByRole('group', { name: 'Colour' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Teal' })).not.toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Lime' })).not.toBeChecked();
  });

  it('chooses an item and keeps the menu open', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<RowMenu onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Teal' }));

    expect(onChoose).toHaveBeenCalledWith('teal');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Teal' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).not.toBeChecked();
  });

  it('moves with the arrow keys, sideways within the row, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<RowMenu onChoose={onChoose} />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Before' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).toHaveFocus();

    // Left and right stay within the row and stop at its ends.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('menuitemradio', { name: 'Lime' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitemradio', { name: 'Lime' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menuitemradio', { name: 'Teal' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledWith('teal');
    expect(screen.getByRole('menuitemradio', { name: 'Teal' })).toHaveFocus();

    // Down goes on through the rest of the row to the next item.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'After' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

/**
 * A menu with a plain radio item and two radio items that are links, the
 * second one checked.
 *
 * @returns The menu.
 */
function LinkMenu() {
  return (
    <MenuRoot>
      <MenuTrigger>Open</MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value="newest">
          <MenuRadioItem value="plain">Plain</MenuRadioItem>
          <MenuRadioLinkItem value="oldest" href="/companies?sort=created&dir=asc" scroll={false}>
            Oldest first
          </MenuRadioLinkItem>
          <MenuRadioLinkItem
            value="newest"
            href="/companies?sort=created&dir=desc"
            className="font-medium"
          >
            Newest first
          </MenuRadioLinkItem>
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}

describe('MenuRadioLinkItem', () => {
  it('is a link with the radio item role, checked when it is the value', async () => {
    const user = userEvent.setup();
    render(<LinkMenu />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const oldest = screen.getByRole('menuitemradio', { name: 'Oldest first' });
    const newest = screen.getByRole('menuitemradio', { name: 'Newest first' });
    expect(oldest.tagName).toBe('A');
    expect(oldest).toHaveAttribute('href', '/companies?sort=created&dir=asc');
    expect(oldest).toHaveAttribute('aria-checked', 'false');
    expect(newest).toHaveAttribute('aria-checked', 'true');
  });

  it('looks like a plain radio item, with the decorative check inside the link', async () => {
    const user = userEvent.setup();
    render(<LinkMenu />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const plain = screen.getByRole('menuitemradio', { name: 'Plain' });
    const newest = screen.getByRole('menuitemradio', { name: 'Newest first' });
    expect(newest.className).toBe(`${plain.className} font-medium`);
    expect(newest.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Oldest first' }).querySelector('svg'),
    ).not.toBeInTheDocument();
  });

  it('moves with the arrow keys like the other items', async () => {
    const user = userEvent.setup();
    render(<LinkMenu />);

    screen.getByRole('button', { name: 'Open' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitemradio', { name: 'Plain' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Oldest first' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Newest first' })).toHaveFocus();
  });
});

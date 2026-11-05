/**
 * @file Tests for the side sheet: its trigger, its name and description, the
 * focus kept inside, and closing with Escape or the close button with focus
 * back on the trigger.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import Button from './button';
import Sheet from './sheet';

/**
 * A sheet behind an "Open menu" button, with two buttons inside (jsdom doesn't
 * count links as tabbable); the first one closes it, as a link would.
 *
 * @returns The sheet and its trigger.
 */
function MenuSheet() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      trigger={<Button aria-label="Open menu">Menu</Button>}
      title="Menu"
      description="Navigation and account options."
      closeLabel="Close menu"
    >
      <Button onClick={() => setOpen(false)}>Companies</Button>
      <Button>Users</Button>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('stays closed until its trigger is used', () => {
    render(<MenuSheet />);

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a dialog named by its title, described for screen readers', async () => {
    const user = userEvent.setup();
    render(<MenuSheet />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(sheet).toHaveAccessibleDescription('Navigation and account options.');
    expect(screen.getByText('Menu', { selector: 'h2' })).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Companies' })).toHaveFocus();
  });

  it('keeps focus inside, with the close button after the content', async () => {
    const user = userEvent.setup();
    render(<MenuSheet />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Users' })).toHaveFocus();
    await user.tab();
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(close).toHaveFocus();
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Companies' })).toHaveFocus();
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<MenuSheet />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes with the close button, and from its content', async () => {
    const user = userEvent.setup();
    render(<MenuSheet />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Companies' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

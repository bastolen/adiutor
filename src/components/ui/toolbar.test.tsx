/**
 * @file Tests for the toolbar: its name, its buttons, and the keyboard
 * behaviour Radix brings (one stop for Tab, the arrow keys between buttons).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bold, Italic, Link } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Toolbar, ToolbarButton, ToolbarSeparator } from './toolbar';

/**
 * Renders a toolbar with three buttons between two fields.
 *
 * @param onBold - Called when Bold is pressed.
 * @returns The rendered element.
 */
function renderToolbar(onBold = vi.fn()) {
  return render(
    <>
      <input aria-label="Before" />
      <Toolbar label="Formatting">
        <ToolbarButton label="Bold" icon={Bold} pressed onClick={onBold} />
        <ToolbarButton label="Italic" icon={Italic} pressed={false} />
        <ToolbarSeparator />
        <ToolbarButton label="Link" icon={Link} />
      </Toolbar>
      <input aria-label="After" />
    </>,
  );
}

describe('Toolbar', () => {
  it('is a toolbar that says what its buttons are for', () => {
    renderToolbar();

    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('names each button by its label, with the icon hidden from screen readers', () => {
    renderToolbar();

    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('type', 'button');
    expect(bold).toHaveAttribute('title', 'Bold');
    expect(bold.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says whether a button that switches something is on, and nothing for one that doesn’t', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Link' })).not.toHaveAttribute('aria-pressed');
  });

  it('is one stop for Tab, and the arrow keys move between its buttons', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('textbox', { name: 'Before' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Link' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();

    // Tab leaves the toolbar instead of going to its next button.
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'After' })).toHaveFocus();

    // Coming back, focus returns to the button it was on.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();
  });

  it('presses a button with the keyboard and with a click', async () => {
    const user = userEvent.setup();
    const onBold = vi.fn();
    renderToolbar(onBold);

    await user.click(screen.getByRole('button', { name: 'Bold' }));
    await user.keyboard('{Enter}');

    expect(onBold).toHaveBeenCalledTimes(2);
  });

  it('skips a disabled button', async () => {
    const user = userEvent.setup();
    render(
      <Toolbar label="Formatting">
        <ToolbarButton label="Bold" icon={Bold} />
        <ToolbarButton label="Italic" icon={Italic} disabled />
        <ToolbarButton label="Link" icon={Link} />
      </Toolbar>,
    );

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('button', { name: 'Link' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeDisabled();
  });
});

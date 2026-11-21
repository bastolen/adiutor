/**
 * @file Tests for tabs inside a page: the open tab, the keyboard, and panels
 * that keep what was typed in them.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import Tabs from './tabs';

/** Renders two tabs, each with a field. */
function renderTabs() {
  render(
    <Tabs
      label="Write"
      items={[
        { value: 'reply', label: 'Reply', content: <input aria-label="Reply text" /> },
        { value: 'note', label: 'Internal note', content: <input aria-label="Note text" /> },
      ]}
    />,
  );
}

/**
 * The panel a tab shows, also while it's hidden.
 *
 * @param name - The tab's name.
 * @returns The panel.
 */
const panelOf = (name: string) =>
  document.getElementById(screen.getByRole('tab', { name }).getAttribute('aria-controls') ?? '');

describe('Tabs', () => {
  it('opens the first tab, named in a row of tabs with its own name', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Write' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(panelOf('Reply')).toBeVisible();
    // Still there, with whatever was typed in it, but out of sight and of the tab order.
    expect(panelOf('Internal note')).not.toBeVisible();
  });

  it('moves between the tabs with the arrow keys, and Tab goes on into the open panel', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const note = screen.getByRole('tab', { name: 'Internal note' });
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute('aria-selected', 'true');
    expect(panelOf('Internal note')).toBeVisible();
    expect(panelOf('Reply')).not.toBeVisible();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('keeps what was typed in a tab while another one is open', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.type(screen.getByRole('textbox', { name: 'Reply text' }), 'Half a reply');
    await user.click(screen.getByRole('tab', { name: 'Internal note' }));
    await user.click(screen.getByRole('tab', { name: 'Reply' }));

    expect(screen.getByRole('textbox', { name: 'Reply text' })).toHaveValue('Half a reply');
  });
});

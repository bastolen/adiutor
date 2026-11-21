/**
 * @file Tests for the popover: a button that opens a small panel to read.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import Popover from './popover';

/**
 * Renders a popover with two names behind a button.
 *
 * @returns Testing Library's render result.
 */
function renderPopover() {
  return render(
    <Popover
      trigger={<span aria-hidden="true">CC</span>}
      triggerLabel="Show the 2 people"
      label="People"
    >
      <ul>
        <li>Casey Client</li>
        <li>Sam Support</li>
      </ul>
    </Popover>,
  );
}

describe('Popover', () => {
  it('is closed at first, behind a button that says what it opens', () => {
    renderPopover();

    const button = screen.getByRole('button', { name: 'Show the 2 people' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByText('Casey Client')).not.toBeInTheDocument();
  });

  it('opens a named panel with its content, and says so on its button', async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: 'Show the 2 people' }));

    const panel = screen.getByRole('dialog', { name: 'People' });
    expect(panel).toHaveTextContent('Casey Client');
    expect(panel).toHaveTextContent('Sam Support');
    expect(screen.getByRole('button', { name: 'Show the 2 people' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes on Escape, with focus back on its button', async () => {
    const user = userEvent.setup();
    renderPopover();
    const button = screen.getByRole('button', { name: 'Show the 2 people' });

    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'People' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when its button is pressed again', async () => {
    const user = userEvent.setup();
    renderPopover();
    const button = screen.getByRole('button', { name: 'Show the 2 people' });

    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

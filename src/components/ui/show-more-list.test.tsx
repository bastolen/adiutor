/**
 * @file Tests for the list that shows more: its first items and a button for
 * the rest, which expands it in place, goes away and hands focus to the first
 * item it added; no button when there's nothing more to show.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ShowMoreList from './show-more-list';

/**
 * Items with a button each.
 *
 * @param count - How many.
 * @returns The items.
 */
function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: String(index + 1),
    content: <button type="button">{`File ${index + 1}`}</button>,
  }));
}

describe('ShowMoreList', () => {
  it('shows the first items, then the rest in place, with focus on the first one added', async () => {
    const user = userEvent.setup();
    render(<ShowMoreList label="Files" shown={5} moreLabel="Show all 7 files" items={items(7)} />);
    const list = screen.getByRole('list', { name: 'Files' });
    expect(list.children).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: 'Show all 7 files' }));

    expect(list.children).toHaveLength(7);
    expect(screen.queryByRole('button', { name: 'Show all 7 files' })).toBeNull();
    expect(screen.getByRole('button', { name: 'File 6' })).toHaveFocus();
  });

  it('has no button when it shows everything already', () => {
    render(<ShowMoreList label="Files" shown={5} moreLabel="Show all 5 files" items={items(5)} />);

    expect(screen.getByRole('list', { name: 'Files' }).children).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });
});

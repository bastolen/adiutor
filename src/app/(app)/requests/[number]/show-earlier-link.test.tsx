/**
 * @file Tests for the link that shows earlier entries of a conversation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import restoreFocusIfLost from '@/components/ui/focus-fallback';

import ShowEarlierLink from './show-earlier-link';

vi.mock('@/components/ui/focus-fallback', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(restoreFocusIfLost).mockReset();
});

describe('ShowEarlierLink', () => {
  it('links to the page with more of the conversation', () => {
    render(<ShowEarlierLink href="/requests/142?earlier=1">Show earlier activity</ShowEarlierLink>);

    expect(screen.getByRole('link', { name: 'Show earlier activity' })).toHaveAttribute(
      'href',
      '/requests/142?earlier=1',
    );
  });

  it('gives focus somewhere to go when following it took the link away', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ShowEarlierLink href="/requests/142?earlier=1">Show earlier activity</ShowEarlierLink>,
    );
    const link = screen.getByRole('link', { name: 'Show earlier activity' });
    // Following a link in jsdom goes nowhere; the click is what counts.
    link.addEventListener('click', (event) => event.preventDefault());

    await user.click(link);
    unmount();

    expect(restoreFocusIfLost).toHaveBeenCalledWith(link);
  });

  it('leaves focus alone when the link goes without having been followed', () => {
    const { unmount } = render(
      <ShowEarlierLink href="/requests/142?earlier=1">Show earlier activity</ShowEarlierLink>,
    );

    unmount();

    expect(restoreFocusIfLost).not.toHaveBeenCalled();
  });
});

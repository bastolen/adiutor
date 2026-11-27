/**
 * @file Tests for the link from a file to the text it was sent with: a text
 * on the page is brought into view and focused without a navigation, one
 * that isn't opens the page at it (focus staying on the link when the page
 * still can't show it), a click with a modifier key is left to the browser,
 * and the id it looks for is compared as text.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import stubLayout from '../../../../../tests/ui/layout';
import TextSourceLink from './text-source-link';

/** The entry's anchor and the page at it. */
const ANCHOR = 'entry-019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const HREF = `/requests/142?entry=019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b#${ANCHOR}`;

beforeEach(() => {
  stubLayout();
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(useRouter().push).mockClear();
});

describe('TextSourceLink', () => {
  it('brings a text on the page into view and focuses it, without a navigation', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TextSourceLink href={HREF} anchor={ANCHOR}>
          Your reply
        </TextSourceLink>
        <ol>
          <li id={ANCHOR} tabIndex={-1}>
            The log is attached.
          </li>
        </ol>
      </>,
    );

    await user.click(screen.getByRole('link', { name: 'Your reply' }));

    expect(screen.getByText('The log is attached.')).toHaveFocus();
    expect(useRouter().push).not.toHaveBeenCalled();
  });

  it('opens the page at a text that isn’t on it', async () => {
    const user = userEvent.setup();
    render(
      <TextSourceLink href={HREF} anchor={ANCHOR}>
        Your reply
      </TextSourceLink>,
    );

    // The page that opens doesn't show it either, and focus went nowhere meanwhile.
    vi.mocked(useRouter().push).mockImplementationOnce(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const link = screen.getByRole('link', { name: 'Your reply' });
    await user.click(link);

    expect(useRouter().push).toHaveBeenCalledWith(HREF);
    await waitFor(() => expect(link).toHaveFocus());
  });

  it('finds its text by an id compared as text, never as a selector', async () => {
    const user = userEvent.setup();
    const odd = 'entry-"] , li[id';
    render(
      <>
        <TextSourceLink href={HREF} anchor={odd}>
          Your reply
        </TextSourceLink>
        <ol>
          <li id="entry-1" tabIndex={-1}>
            Another reply
          </li>
          <li id={odd} tabIndex={-1}>
            The log is attached.
          </li>
        </ol>
      </>,
    );

    await user.click(screen.getByRole('link', { name: 'Your reply' }));

    expect(screen.getByText('The log is attached.')).toHaveFocus();
  });

  it('leaves a click with a modifier key to the browser', async () => {
    const user = userEvent.setup();
    const clicked = vi.fn((event: MouseEvent) => event.preventDefault());
    document.addEventListener('click', clicked);
    render(
      <TextSourceLink href={HREF} anchor={ANCHOR}>
        Your reply
      </TextSourceLink>,
    );

    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('link', { name: 'Your reply' }));
    await user.keyboard('{/Meta}');
    document.removeEventListener('click', clicked);

    expect(useRouter().push).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalled();
  });
});

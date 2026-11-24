/**
 * @file Tests for arriving at an entry of a request's activity by its
 * anchor, as an email's link does: the entry comes into view with focus on
 * it, focus that's in use is left alone, and an address that names no entry
 * on the page changes nothing.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import nextFrames from '../../../../../tests/ui/next-frames';
import EntryOnArrival from './entry-on-arrival';

/** An entry's ID, as the database gives it. */
const ENTRY_ID = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

/**
 * An activity with a button above it and two entries.
 *
 * @returns The page.
 */
function Page() {
  return (
    <main>
      <button type="button">Above</button>
      <ol>
        <EntryOnArrival />
        <li id="entry-019a1b2c-0000-7000-8000-000000000000" tabIndex={-1}>
          An earlier reply
        </li>
        <li id={`entry-${ENTRY_ID}`} tabIndex={-1}>
          The new reply
        </li>
      </ol>
    </main>
  );
}

let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  // jsdom has no layout: give every element a box.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => [{}] as unknown as DOMRectList,
  );
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(
    this: Element,
  ) {
    scrolled.push(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('EntryOnArrival', () => {
  it('brings the entry the address names into view and focuses it', async () => {
    window.history.replaceState(null, '', `/requests/142#entry-${ENTRY_ID}`);
    render(<Page />);

    await nextFrames();

    const entry = screen.getByText('The new reply');
    expect(scrolled).toEqual([entry]);
    expect(entry).toHaveFocus();
  });

  it('leaves focus that’s in use where it is', async () => {
    window.history.replaceState(null, '', `/requests/142#entry-${ENTRY_ID}`);
    render(<Page />);
    screen.getByRole('button', { name: 'Above' }).focus();

    await nextFrames();

    expect(scrolled).toEqual([]);
    expect(screen.getByRole('button', { name: 'Above' })).toHaveFocus();
  });

  it('does nothing for an anchor that isn’t an entry, or an entry that isn’t on the page', async () => {
    window.history.replaceState(null, '', '/requests/142#request-description');
    const { unmount } = render(<Page />);
    await nextFrames();
    unmount();

    window.history.replaceState(
      null,
      '',
      '/requests/142#entry-019a1b2c-ffff-7fff-8fff-ffffffffffff',
    );
    render(<Page />);
    await nextFrames();

    expect(scrolled).toEqual([]);
    expect(document.body).toHaveFocus();
  });
});

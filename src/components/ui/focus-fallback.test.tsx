/**
 * @file Tests for keeping focus when a control goes away: it moves to the
 * card's heading, or to the main content outside a card, and only when focus
 * fell to `<body>`. The main content is focusable only while it has focus
 * from script (`focusMainContent`).
 */
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Card from './card';
import restoreFocusIfLost, { focusMainContent } from './focus-fallback';

/** Elements jsdom should treat as hidden, e.g. a page `<Activity>` keeps in the background. */
const hidden = new Set<Element>();

beforeEach(() => {
  // jsdom has no layout: give every element a box, except the ones a test hides.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function getClientRects(
    this: Element,
  ) {
    return (hidden.has(this) ? [] : [{}]) as unknown as DOMRectList;
  });
});

afterEach(() => {
  hidden.clear();
  vi.restoreAllMocks();
});

/**
 * Runs the frames `restoreFocusIfLost` waits for.
 */
async function nextFrames() {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}

/**
 * A card with a button that removes itself, as a row action's row does.
 *
 * @returns The page.
 */
function RemovingRow() {
  const [shown, setShown] = useState(true);
  return (
    <main id="main">
      <Card title="Invite links">
        {shown && (
          <button
            type="button"
            onClick={(event) => {
              restoreFocusIfLost(event.currentTarget);
              setShown(false);
            }}
          >
            Revoke
          </button>
        )}
        <button type="button">Create invite link</button>
      </Card>
    </main>
  );
}

describe('restoreFocusIfLost', () => {
  it('moves focus to the card’s heading when the focused control goes away', async () => {
    render(<RemovingRow />);
    const revoke = screen.getByRole('button', { name: 'Revoke' });
    revoke.focus();

    act(() => revoke.click());
    await nextFrames();

    expect(screen.getByRole('heading', { name: 'Invite links' })).toHaveFocus();
  });

  it('moves focus to the main content outside a card', async () => {
    /**
     * A notice outside any card that goes away when dismissed.
     *
     * @returns The page.
     */
    function Notice() {
      const [shown, setShown] = useState(true);
      return (
        <main id="main">
          {shown && (
            <button
              type="button"
              onClick={(event) => {
                restoreFocusIfLost(event.currentTarget);
                setShown(false);
              }}
            >
              Dismiss
            </button>
          )}
        </main>
      );
    }
    render(<Notice />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    dismiss.focus();

    act(() => dismiss.click());
    await nextFrames();

    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    // Focusable only while it has focus, so a click in the content doesn't hand it focus later.
    act(() => main.blur());
    expect(main).not.toHaveAttribute('tabindex');
  });

  it('leaves focus alone when the control stays, or focus went elsewhere', async () => {
    render(
      <main id="main">
        <Card title="Invitations">
          <button type="button">Resend</button>
          <button type="button">Revoke</button>
        </Card>
      </main>,
    );
    const resend = screen.getByRole('button', { name: 'Resend' });
    resend.focus();
    restoreFocusIfLost(resend);
    await nextFrames();
    expect(resend).toHaveFocus();

    restoreFocusIfLost(resend);
    screen.getByRole('button', { name: 'Revoke' }).focus();
    await nextFrames();
    expect(screen.getByRole('button', { name: 'Revoke' })).toHaveFocus();
  });

  it('counts focus on an element that is no longer shown as lost', async () => {
    render(
      <main id="main">
        <Card title="Invitations">
          <button type="button">Resend</button>
        </Card>
      </main>,
    );
    const resend = screen.getByRole('button', { name: 'Resend' });
    resend.focus();
    hidden.add(resend);
    restoreFocusIfLost(resend);
    await nextFrames();
    expect(screen.getByRole('heading', { name: 'Invitations' })).toHaveFocus();
  });
});

describe('focusMainContent', () => {
  it('focuses the main content, focusable only until focus leaves it', () => {
    render(
      <main id="main">
        <p>Content</p>
        <button type="button">Next</button>
      </main>,
    );
    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('tabindex');

    focusMainContent();
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute('tabindex', '-1');

    screen.getByRole('button', { name: 'Next' }).focus();
    expect(main).not.toHaveAttribute('tabindex');
  });

  it('keeps a tabindex the main content already has', () => {
    render(
      <main id="main" tabIndex={-1}>
        <button type="button">Next</button>
      </main>,
    );
    const main = screen.getByRole('main');

    focusMainContent();
    expect(main).toHaveFocus();
    screen.getByRole('button', { name: 'Next' }).focus();
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('does nothing on a page without main content', () => {
    render(<button type="button">Next</button>);

    expect(() => focusMainContent()).not.toThrow();
    expect(document.body).toHaveFocus();
  });
});

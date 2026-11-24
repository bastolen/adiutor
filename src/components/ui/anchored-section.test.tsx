/**
 * @file Tests for cards with an anchor: they tell the controls inside which
 * section they're in, and when the URL names them on arrival they come into
 * view with focus on their heading, without taking focus from a control
 * that has it.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import stubLayout from '../../../tests/ui/layout';
import nextFrames from '../../../tests/ui/next-frames';
import { useSectionId } from './anchored-section';
import Card from './card';

/**
 * Shows the section a control is in.
 *
 * @returns The section ID, or "none".
 */
function SectionName() {
  return <span>Section: {useSectionId() ?? 'none'}</span>;
}

/**
 * A page with a button above two cards, the second with a control inside.
 *
 * @returns The page.
 */
function Page() {
  return (
    <main>
      <button type="button">Above</button>
      <Card id="invite" title="Invite by email">
        <SectionName />
      </Card>
      <Card id="invitations" title="Open invitations">
        <button type="button">Resend</button>
        <SectionName />
      </Card>
      <Card title="Name shown to users">
        <SectionName />
      </Card>
    </main>
  );
}

/** Elements jsdom should treat as hidden, e.g. a page `<Activity>` keeps in the background. */
const hidden = new Set<Element>();

let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  stubLayout((element) => hidden.has(element));
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(
    this: Element,
  ) {
    scrolled.push(this);
  });
});

afterEach(() => {
  hidden.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

/**
 * The section of a card, found by its heading.
 *
 * @param name - The card's title.
 * @returns The section.
 */
function sectionOf(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('Card with an anchor', () => {
  it('is a labelled section with that id, which the controls inside know', () => {
    render(<Page />);
    expect(sectionOf('Open invitations')).toHaveAttribute('id', 'invitations');
    expect(sectionOf('Open invitations')).toHaveAttribute('data-card', '');
    expect(sectionOf('Open invitations')).toHaveTextContent('Section: invitations');
    expect(sectionOf('Invite by email')).toHaveTextContent('Section: invite');
    // Without an anchor, a card is a plain section.
    expect(sectionOf('Name shown to users')).not.toHaveAttribute('id');
    expect(sectionOf('Name shown to users')).toHaveTextContent('Section: none');
  });

  it('lands on the card the URL names: in view, with focus on its heading', async () => {
    window.history.replaceState(null, '', '/admin/settings/staff?inv-page=2#invitations');
    render(<Page />);
    await nextFrames();

    expect(scrolled).toEqual([sectionOf('Open invitations')]);
    expect(screen.getByRole('heading', { name: 'Open invitations' })).toHaveFocus();
  });

  it.each(['', '#name', '#:~:text=Open', '#Invitations'])(
    'does nothing when the URL ends in %j',
    async (hash) => {
      window.history.replaceState(null, '', `/admin/settings/staff${hash}`);
      render(<Page />);
      await nextFrames();

      expect(scrolled).toEqual([]);
      expect(document.body).toHaveFocus();
    },
  );

  it('takes focus from a control that is no longer shown, like the page left behind', async () => {
    window.history.replaceState(null, '', '/admin/settings/staff#invitations');
    render(<Page />);
    const above = screen.getByRole('button', { name: 'Above' });
    above.focus();
    hidden.add(above);
    await nextFrames();

    expect(screen.getByRole('heading', { name: 'Open invitations' })).toHaveFocus();
  });

  it('never takes focus from a control the user is on', async () => {
    window.history.replaceState(null, '', '/admin/settings/staff#invitations');
    render(<Page />);
    const above = screen.getByRole('button', { name: 'Above' });
    above.focus();
    await nextFrames();

    expect(scrolled).toEqual([]);
    expect(above).toHaveFocus();
  });

  it('only scrolls when something inside the card has focus already', async () => {
    window.history.replaceState(null, '', '/admin/settings/staff#invitations');
    render(<Page />);
    const resend = screen.getByRole('button', { name: 'Resend' });
    resend.focus();
    await nextFrames();

    expect(scrolled).toEqual([sectionOf('Open invitations')]);
    expect(resend).toHaveFocus();
  });
});

/**
 * @file Tests for the list of people at "@": who it shows for what's typed,
 * what the keys do in it, how it waits for the people, and the popover that
 * shows it without taking the focus from the text.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MentionChoice } from './mentions';

// Unit tests don't load the editor's files (`vitest.setup.ts`); this file is about one of them.
const {
  default: MentionPopover,
  createMentionList,
  matchingChoices,
  mentionOptionId,
} = await vi.importActual<typeof import('./editor-mentions')>('./editor-mentions');

/**
 * Someone who can be mentioned.
 *
 * @param name - Their name.
 * @param label - The label after it, for the staff.
 * @returns The choice, with a key made from the name.
 */
const person = (name: string, label: string | null = null): MentionChoice => ({
  key: name.toLowerCase().replace(/\W/g, '-'),
  name,
  label,
});

/** The people of the examples, in the order the server lists them. */
const PEOPLE = [
  person('Anna de Boer'),
  person('Casey Client'),
  person('José Sanz'),
  person('Sam Support', 'Adiutor Tests'),
  person('Sanne Jansen'),
];

/**
 * What the editor's trigger tells the list.
 *
 * @param query - What's typed after the "@".
 * @returns The typed name, with spies for picking and closing.
 */
function typing(query: string) {
  return {
    query,
    /**
     * Where the name is typed.
     *
     * @returns A box on the screen.
     */
    rect: () => new DOMRect(40, 60, 30, 20),
    pick: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * Lets the answers that are waiting arrive.
 *
 * @returns When they have.
 */
const settled = () => act(() => Promise.resolve());

/**
 * A list whose people are there.
 *
 * @param query - What's typed after the "@".
 * @returns The list, and what the trigger told it.
 */
async function openList(query = '') {
  const list = createMentionList(() => Promise.resolve(PEOPLE));
  const typed = typing(query);
  list.show(typed);
  await settled();
  return { list, typed };
}

/**
 * The names the list shows.
 *
 * @param list - The list.
 * @returns The names, in order.
 */
const shown = (list: ReturnType<typeof createMentionList>) =>
  list.getSnapshot()?.choices.map((choice) => choice.name);

describe('matchingChoices', () => {
  it('shows everyone before a name is typed, in the order they were given', () => {
    expect(matchingChoices(PEOPLE, '').map((choice) => choice.name)).toEqual(
      PEOPLE.map((choice) => choice.name),
    );
  });

  it('puts a name that starts with what’s typed first, then a word that does, then the rest', () => {
    expect(matchingChoices(PEOPLE, 'sa').map((choice) => choice.name)).toEqual([
      // Start with it.
      'Sam Support',
      'Sanne Jansen',
      // A later word starts with it.
      'José Sanz',
    ]);
    // Anywhere in the name still counts.
    expect(matchingChoices(PEOPLE, 'lien').map((choice) => choice.name)).toEqual(['Casey Client']);
  });

  it('finds a name whatever its case and accents', () => {
    expect(matchingChoices(PEOPLE, 'JOSE').map((choice) => choice.name)).toEqual(['José Sanz']);
    expect(matchingChoices(PEOPLE, 'josé').map((choice) => choice.name)).toEqual(['José Sanz']);
  });

  it('shows at most eight people at a time', () => {
    const many = Array.from({ length: 30 }, (_, index) => person(`Person ${index}`));

    expect(matchingChoices(many, 'person')).toHaveLength(8);
  });

  it('shows nobody for a name nobody has', () => {
    expect(matchingChoices(PEOPLE, 'zz')).toEqual([]);
  });
});

describe('the list of people at "@"', () => {
  it('is closed until a name is typed, and says it waits for the people first', async () => {
    const list = createMentionList(() => Promise.resolve(PEOPLE));
    expect(list.getSnapshot()).toBeNull();

    list.show(typing(''));

    expect(list.getSnapshot()).toMatchObject({ status: 'loading', choices: [] });
    await settled();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', active: 0 });
    expect(shown(list)).toEqual(PEOPLE.map((choice) => choice.name));
  });

  it('asks for the people once, however much is typed', async () => {
    const load = vi.fn(() => Promise.resolve(PEOPLE));
    const list = createMentionList(load);

    list.show(typing(''));
    list.show(typing('s'));
    await settled();
    list.hide();
    list.show(typing('sa'));

    expect(load).toHaveBeenCalledTimes(1);
    expect(shown(list)).toEqual(['Sam Support', 'Sanne Jansen', 'José Sanz']);
  });

  it('follows what’s typed, with the first match as the one Enter picks', async () => {
    const { list } = await openList('s');
    list.keyDown({ key: 'ArrowDown', isComposing: false });
    expect(list.getSnapshot()?.active).toBe(1);

    list.show(typing('sa'));

    expect(list.getSnapshot()?.active).toBe(0);
  });

  it('moves through the people with the arrow keys, around at the ends', async () => {
    const { list } = await openList('sa');

    expect(list.keyDown({ key: 'ArrowDown', isComposing: false })).toBe(true);
    expect(list.keyDown({ key: 'ArrowDown', isComposing: false })).toBe(true);
    expect(list.getSnapshot()?.active).toBe(2);
    list.keyDown({ key: 'ArrowDown', isComposing: false });
    expect(list.getSnapshot()?.active).toBe(0);
    list.keyDown({ key: 'ArrowUp', isComposing: false });
    expect(list.getSnapshot()?.active).toBe(2);
  });

  it('mentions the one the keys are on with Enter', async () => {
    const { list, typed } = await openList('sa');
    list.keyDown({ key: 'ArrowDown', isComposing: false });

    expect(list.keyDown({ key: 'Enter', isComposing: false })).toBe(true);

    expect(typed.pick).toHaveBeenCalledWith(person('Sanne Jansen'));
  });

  it('leaves every other key to the text: Tab, Escape, a letter', async () => {
    const { list, typed } = await openList('sa');

    ['Tab', 'Escape', 'a', 'ArrowLeft', ' '].forEach((key) => {
      expect(list.keyDown({ key, isComposing: false }), key).toBe(false);
    });
    expect(typed.pick).not.toHaveBeenCalled();
  });

  it('leaves Enter and the arrows to the text when there’s nobody to pick', async () => {
    const { list, typed } = await openList('zz');

    expect(list.keyDown({ key: 'Enter', isComposing: false })).toBe(false);
    expect(list.keyDown({ key: 'ArrowDown', isComposing: false })).toBe(false);
    expect(typed.pick).not.toHaveBeenCalled();
    // And when it's closed.
    list.hide();
    expect(list.keyDown({ key: 'Enter', isComposing: false })).toBe(false);
  });

  it('leaves a key that belongs to a text being composed alone', async () => {
    const { list, typed } = await openList('sa');

    expect(list.keyDown({ key: 'Enter', isComposing: true })).toBe(false);
    expect(typed.pick).not.toHaveBeenCalled();
  });

  it('closes by itself once what’s typed has a space and is nobody’s name', async () => {
    const list = createMentionList(() => Promise.resolve(PEOPLE));
    // A name with a space in it stays open while it can still be someone's.
    const name = typing('sam s');
    list.show(name);
    await settled();
    expect(shown(list)).toEqual(['Sam Support']);
    expect(name.close).not.toHaveBeenCalled();

    // "@ 5 pm" was never a mention.
    const time = typing(' 5 pm');
    list.show(time);
    await settled();
    expect(time.close).toHaveBeenCalledTimes(1);

    // One word that's nobody's name says so instead, so a typo can be seen.
    const typo = typing('zz');
    list.show(typo);
    await settled();
    expect(typo.close).not.toHaveBeenCalled();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', choices: [] });
  });

  it('says so when the people couldn’t be loaded, and asks again the next time', async () => {
    const load = vi
      .fn<() => Promise<MentionChoice[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(PEOPLE);
    const list = createMentionList(load);

    list.show(typing(''));
    await settled();
    expect(list.getSnapshot()).toMatchObject({ status: 'failed', choices: [] });

    list.hide();
    list.show(typing(''));
    await settled();
    expect(list.getSnapshot()?.status).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets the people when another source takes the first one’s place', async () => {
    const { list } = await openList('');
    const others = [person('Olivia Other')];

    list.setLoader(() => Promise.resolve(others));

    // Open meanwhile: it waits for the new people.
    expect(list.getSnapshot()).toMatchObject({ status: 'loading', choices: [] });
    await settled();
    expect(shown(list)).toEqual(['Olivia Other']);
  });

  it('drops the answer of a source that was replaced while it was asked', async () => {
    let answerFirst: ((people: MentionChoice[]) => void) | undefined;
    const list = createMentionList(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    list.show(typing(''));

    list.setLoader(() => Promise.resolve([person('Olivia Other')]));
    await settled();
    answerFirst?.(PEOPLE);
    await settled();

    expect(shown(list)).toEqual(['Olivia Other']);
  });

  it('picks with the pointer too, and closes when asked', async () => {
    const { list, typed } = await openList('sa');

    list.activate(2);
    expect(list.getSnapshot()?.active).toBe(2);
    list.choose(1);
    expect(typed.pick).toHaveBeenCalledWith(person('Sanne Jansen'));

    list.dismiss();
    expect(typed.close).toHaveBeenCalledTimes(1);
    list.hide();
    expect(list.getSnapshot()).toBeNull();
  });

  it('tells whoever follows it about every change, until they stop', async () => {
    const list = createMentionList(() => Promise.resolve(PEOPLE));
    const listener = vi.fn();
    const stop = list.subscribe(listener);

    list.show(typing(''));
    await settled();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();
    listener.mockClear();
    list.hide();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('MentionPopover', () => {
  it('shows nothing while the list is closed', () => {
    const list = createMentionList(() => Promise.resolve(PEOPLE));

    render(<MentionPopover list={list} listId="people" />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('lists the people as options, with the staff’s label and the one Enter picks marked', async () => {
    const { list } = await openList('sa');
    render(<MentionPopover list={list} listId="people" />);

    const listbox = screen.getByRole('listbox', { name: 'People to mention' });
    expect(listbox).toHaveAttribute('id', 'people');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Sam SupportAdiutor Tests',
      'Sanne Jansen',
      'José Sanz',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    // What the text points at while the keys are on an option.
    expect(options[1]).toHaveAttribute('id', mentionOptionId('people', 1));

    act(() => {
      list.keyDown({ key: 'ArrowDown', isComposing: false });
    });
    expect(within(listbox).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('is a list the text controls, not a dialog', async () => {
    const { list } = await openList('');
    render(<MentionPopover list={list} listId="people" />);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says what it waits for, that nobody matches, and that the list couldn’t be loaded', async () => {
    const waiting = createMentionList(() => new Promise(() => {}));
    waiting.show(typing(''));
    const { unmount } = render(<MentionPopover list={waiting} listId="people" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    unmount();

    const { list } = await openList('zz');
    const nobody = render(<MentionPopover list={list} listId="people" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nobody by that name');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    nobody.unmount();

    const failing = createMentionList(() => Promise.reject(new Error('offline')));
    failing.show(typing(''));
    await settled();
    render(<MentionPopover list={failing} listId="people" />);
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load the list");
  });

  it('mentions whoever is clicked, without taking the focus from the text', async () => {
    const user = userEvent.setup();
    const { list, typed } = await openList('sa');
    render(
      <>
        <textarea aria-label="Your reply" />
        <MentionPopover list={list} listId="people" />
      </>,
    );
    const text = screen.getByRole('textbox', { name: 'Your reply' });
    text.focus();

    await user.click(screen.getByRole('option', { name: /Sanne Jansen/ }));

    expect(typed.pick).toHaveBeenCalledWith(person('Sanne Jansen'));
    expect(text).toHaveFocus();
  });

  it('closes with Escape, which asks the editor to stop following the name', async () => {
    const user = userEvent.setup();
    const { list, typed } = await openList('sa');
    render(<MentionPopover list={list} listId="people" />);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(typed.close).toHaveBeenCalledTimes(1));
  });
});

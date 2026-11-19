/**
 * @file Tests for what the editor knows of Markdown: what it reads and
 * writes back, and that it stays in step with how the server renders a text.
 */
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions, pasteMarkdown, readMarkdown, writeMarkdown } from './editor-extensions';

/** The editors made by a test, to take down after it. */
const editors: Editor[] = [];

/**
 * Makes an editor that holds a Markdown text.
 *
 * @param markdown - The text.
 * @returns The editor.
 */
function editorWith(markdown = ''): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions({
      /**
       * Labels an image.
       *
       * @param description - Its description.
       * @returns The label.
       */
      image: (description) => (description ? `${description} (image)` : 'Image'),
      /**
       * Names a task's checkbox.
       *
       * @param task - The task.
       * @param done - Whether it's ticked.
       * @returns The name.
       */
      task: (task, done) => `${done ? 'Done' : 'To do'}: ${task}`,
    }),
  });
  editors.push(editor);
  readMarkdown(editor, markdown);
  return editor;
}

/**
 * Reads a Markdown text into an editor and writes it back.
 *
 * @param markdown - The text.
 * @returns What the editor makes of it.
 */
const roundTrip = (markdown: string) => writeMarkdown(editorWith(markdown));

/**
 * Pastes text into an editor, as a browser does.
 *
 * @param editor - The editor.
 * @param data - What's on the clipboard, by type.
 * @returns Whether the editor's Markdown paste handled it.
 */
function paste(editor: Editor, data: Record<string, string>): boolean {
  const event = new Event('paste') as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      /**
       * Reads the clipboard.
       *
       * @param type - The type asked for.
       * @returns What's there in that type.
       */
      getData: (type: string) => data[type] ?? '',
    },
  });
  return pasteMarkdown(editor, event);
}

/**
 * Puts the cursor inside a word of an editor's text.
 *
 * @param editor - The editor.
 * @param word - A word in its text.
 */
function putCursorIn(editor: Editor, word: string) {
  let at: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (at === null && node.isText && node.text?.includes(word)) {
      at = position + node.text.indexOf(word) + 1;
    }
  });
  if (at === null) {
    throw new Error(`No "${word}" in the editor`);
  }
  editor.commands.setTextSelection(at);
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('reading and writing Markdown', () => {
  it.each([
    ['a heading', '# Title'],
    ['emphasis', 'Some **bold**, *italic*, ~~gone~~ and `code`.'],
    ['a list with a nested one', '- one\n- two\n  - nested'],
    ['a numbered list', '1. first\n2. second'],
    ['things to do', '- [x] done\n- [ ] todo'],
    ['a quotation', '> quoted'],
    ['a link', '[the docs](https://adiutor.dev/docs)'],
    ['a block of code with its language', '```ts\nconst a = 1;\n```'],
    ['two paragraphs', 'first\n\nsecond'],
  ])('keeps %s as it was written', (_what, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps a line break inside a paragraph', () => {
    const editor = editorWith('line one\nline two');

    expect(editor.getHTML()).toBe('<p>line one<br>line two</p>');
    expect(writeMarkdown(editor)).toBe('line one  \nline two');
  });

  it('keeps a table, with its columns’ alignment', () => {
    const markdown = roundTrip('| Day | Hours |\n| :-- | --: |\n| Monday | 9 to 5 |');

    expect(markdown).toMatch(/^\| Day +\| Hours +\|\n\| :-+ \| -+: \|\n\| Monday +\| 9 to 5 +\|$/);
  });

  it('starts from the text it was given: undoing doesn’t take it out', () => {
    const editor = editorWith('Text from before the editor was there.');

    expect(editor.can().undo()).toBe(false);
    editor.commands.insertContent(' More.');
    editor.commands.undo();
    expect(writeMarkdown(editor)).toBe('Text from before the editor was there.');
    expect(editor.can().undo()).toBe(false);
  });

  it('writes nothing for an editor without text', () => {
    expect(writeMarkdown(editorWith(''))).toBe('');
    expect(writeMarkdown(editorWith('   \n\n'))).toBe('');
  });

  it('gives the elements the classes they have where a text is read', () => {
    const editor = editorWith('- one\n\n> quoted\n\n[link](https://adiutor.dev)');
    const { dom } = editor.view;

    expect(dom.querySelector('ul')).toHaveClass('list-disc');
    expect(dom.querySelector('blockquote')).toHaveClass('border-l-2');
    expect(dom.querySelector('a')).toHaveClass('text-highlight', 'underline');
  });
});

describe('what the editor leaves as it was typed', () => {
  it.each([
    ['a tag', 'use the <b> tag'],
    ['bold written as HTML', 'this is <b>bold</b>'],
    ['a script', '<script>alert(1)</script>'],
    ['a comment', 'before <!-- a note --> after'],
    ['a comparison', 'a < b > c'],
  ])('shows %s as text, and sends it so that it’s read as text', (_what, markdown) => {
    const editor = editorWith(markdown);

    expect(editor.view.dom.querySelector('b, strong, script')).toBeNull();
    expect(editor.getText()).toBe(markdown);
    // Written with entities, which the server shows as the characters they stand for.
    const written = writeMarkdown(editor);
    expect(written).not.toMatch(/<[a-z!/]/i);
    expect(written.replaceAll('&lt;', '<').replaceAll('&gt;', '>')).toBe(markdown);
  });

  it('keeps HTML inside code as it is', () => {
    expect(roundTrip('`<b>` and\n\n```html\n<b>bold</b>\n```')).toBe(
      '`<b>` and\n\n```html\n<b>bold</b>\n```',
    );
  });

  it('keeps an image as it was written, and shows it by its description', () => {
    const markdown = 'See ![The plan](https://adiutor.dev/plan.png "Plan") here';
    const editor = editorWith(markdown);

    expect(editor.view.dom.querySelector('img')).toBeNull();
    expect(editor.view.dom.querySelector('[data-written-image]')?.textContent).toBe(
      'The plan (image)',
    );
    expect(writeMarkdown(editor)).toBe(markdown);
  });

  it('writes marks someone typed as text so that they stay text', () => {
    const editor = editorWith('');
    editor.commands.insertContent({
      type: 'paragraph',
      content: [{ type: 'text', text: '2 * 3 * 4 and _under_ [brackets]' }],
    });

    expect(writeMarkdown(editor)).toBe('2 \\* 3 \\* 4 and \\_under\\_ \\[brackets\\]');
  });
});

describe('links', () => {
  it('links whole web addresses, written out or behind a text', () => {
    const editor = editorWith('[the docs](https://adiutor.dev/docs) and https://adiutor.dev/x');

    const links = [...editor.view.dom.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://adiutor.dev/docs',
      'https://adiutor.dev/x',
    ]);
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it.each([
    ['a script address', '[click](javascript:alert(1))'],
    ['a page of Adiutor itself', '[click](/admin/staff)'],
    ['an email address behind a text', '[click](mailto:user@adiutor.dev)'],
    ['an email address', 'write to user@adiutor.dev'],
  ])('links nothing for %s, as the server doesn’t either', (_what, markdown) => {
    const editor = editorWith(markdown);

    expect(editor.view.dom.querySelector('a')).toBeNull();
    expect(editor.getText()).toContain(markdown.startsWith('[') ? 'click' : 'user@adiutor.dev');
  });
});

describe('the keyboard', () => {
  /**
   * Presses a key in an editor.
   *
   * @param editor - The editor.
   * @param key - The key.
   * @param shiftKey - Whether Shift is held.
   * @returns Whether the editor took the key (and the browser won't act on it).
   */
  const press = (editor: Editor, key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it.each([
    ['a list', '- one\n- two'],
    ['a list of things to do', '- [ ] one\n- [ ] two'],
    ['a table', '| one | b |\n| --- | --- |\n| two | 2 |'],
    ['a paragraph', 'one two'],
  ])('leaves Tab and Shift+Tab to the browser in %s, so they move focus on', (_what, markdown) => {
    const editor = editorWith(markdown);
    putCursorIn(editor, 'two');
    const before = writeMarkdown(editor);

    expect(press(editor, 'Tab')).toBe(false);
    expect(press(editor, 'Tab', true)).toBe(false);
    expect(writeMarkdown(editor)).toBe(before);
  });

  it('nests a list item and lifts it out again with its own shortcuts', () => {
    const editor = editorWith('- one\n- two');
    putCursorIn(editor, 'two');

    expect(press(editor, ']')).toBe(false);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(writeMarkdown(editor)).toBe('- one\n  - two');

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: '[', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(writeMarkdown(editor)).toBe('- one\n- two');
  });
});

describe('pasting', () => {
  it('formats plain text that is Markdown, joined to the line it lands in', () => {
    const editor = editorWith('Before ');
    editor.commands.focus('end');

    expect(paste(editor, { 'text/plain': '**bold** and `code`' })).toBe(true);

    expect(writeMarkdown(editor)).toBe('Before **bold** and `code`');
  });

  it('pastes several blocks as blocks', () => {
    const editor = editorWith('');
    editor.commands.focus('end');

    paste(editor, { 'text/plain': '# Title\n\n- one\n- two' });

    expect(writeMarkdown(editor)).toBe('# Title\n\n- one\n- two');
  });

  it('leaves text copied with its formatting to the editor', () => {
    const editor = editorWith('');

    expect(paste(editor, { 'text/plain': 'bold', 'text/html': '<b>bold</b>' })).toBe(false);
  });

  it('leaves what’s pasted into code as it is', () => {
    const editor = editorWith('```\ncode\n```');
    editor.commands.focus('start');

    expect(paste(editor, { 'text/plain': '**not bold**' })).toBe(false);
  });

  it('pastes a tag as text', () => {
    const editor = editorWith('');
    editor.commands.focus('end');

    paste(editor, { 'text/plain': 'use <b>this</b>' });

    expect(editor.getText()).toBe('use <b>this</b>');
    expect(editor.view.dom.querySelector('b, strong')).toBeNull();
  });
});

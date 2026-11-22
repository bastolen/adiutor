/**
 * @file Tests for what the editor knows of Markdown: what it reads and
 * writes back, and that it stays in step with how the server renders a text.
 */
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  editorExtensions,
  pasteMarkdown,
  readMarkdown,
  withoutOwnLooks,
  writeMarkdown,
} from './editor-extensions';

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
      code: 'Code',
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
 * Copies what's selected in an editor, as a browser does: the editor puts
 * it on the clipboard in its own HTML and as plain text.
 *
 * @param editor - The editor.
 * @returns What's on the clipboard, by type.
 */
function copyFrom(editor: Editor): Record<string, string> {
  const copied = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      /** Empties the clipboard. */
      clearData: () => {
        copied.clear();
      },
      /**
       * Puts something on the clipboard.
       *
       * @param type - Its type.
       * @param value - It.
       */
      setData: (type: string, value: string) => {
        copied.set(type, value);
      },
    },
  });
  editor.view.dom.dispatchEvent(event);
  return Object.fromEntries(copied);
}

/**
 * Pastes into an editor through the browser's paste event, so everything
 * that takes a paste has its turn, as in a browser.
 *
 * @param editor - The editor.
 * @param data - What's on the clipboard, by type.
 */
function pasteIn(editor: Editor, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: Object.keys(data),
      /**
       * Reads the clipboard.
       *
       * @param type - The type asked for.
       * @returns What's there in that type.
       */
      getData: (type: string) => data[type] ?? '',
    },
  });
  editor.view.dom.dispatchEvent(event);
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

describe('mentions', () => {
  /** The key of someone picked from the list. */
  const SAM = 'Sam0000000000000000000';

  it('reads the marker of a mention as the person’s name after an @, in one piece', () => {
    const editor = editorWith(`Ask [@Sam Support](mention:${SAM}) about it.`);

    const mention = editor.view.dom.querySelector('[data-mention]');
    expect(mention).toHaveTextContent('@Sam Support');
    // The look a mention has where a text is read.
    expect(mention).toHaveClass('border', 'font-medium');
    expect(editor.view.dom.querySelector('a')).toBeNull();
    expect(editor.getText()).toBe('Ask @Sam Support about it.');
    // One piece: it has no text of its own to put the cursor in.
    expect(editor.getJSON().content?.[0]?.content?.[1]).toEqual({
      type: 'writtenMention',
      attrs: { key: SAM, name: 'Sam Support' },
    });
  });

  it('writes a mention back as the marker the server takes for one', () => {
    expect(roundTrip(`Ask [@Sam Support](mention:${SAM}) about it.`)).toBe(
      `Ask [@Sam Support](mention:${SAM}) about it.`,
    );
  });

  it('keeps a name with brackets in it whole, both ways', () => {
    const marker = `[@Sam \\[on call\\]](mention:${SAM})`;
    const editor = editorWith(marker);

    expect(editor.getText()).toBe('@Sam [on call]');
    expect(writeMarkdown(editor)).toBe(marker);
  });

  it('writes a mention that was put in the text by the list', () => {
    const editor = editorWith('Ask ');

    editor
      .chain()
      .focus('end')
      .insertContent([
        { type: 'writtenMention', attrs: { key: SAM, name: 'Sam Support' } },
        { type: 'text', text: ' today' },
      ])
      .run();

    expect(writeMarkdown(editor)).toBe(`Ask [@Sam Support](mention:${SAM}) today`);
  });

  it('takes no other link for a mention: its text stays text, as where it’s read', () => {
    const texts = [
      // Stored already: the row's ID, which only the server writes.
      '[@](mention:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b)',
      // A key without the "@" of a mention.
      `[Sam Support](mention:${SAM})`,
      // Not a key.
      '[@Sam Support](mention:nobody)',
    ];
    texts.forEach((text) => {
      const editor = editorWith(text);

      expect(editor.view.dom.querySelector('[data-mention]'), text).toBeNull();
      expect(editor.view.dom.querySelector('a'), text).toBeNull();
    });
    expect(editorWith(texts[2]).getText()).toBe('@Sam Support');
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

describe('pasting with formatting', () => {
  /** The keys of two people who may be mentioned. */
  const SAM = 'Sam0000000000000000000';
  const CASEY = 'Casey00000000000000000';
  /** The address of a person's page, as a browser copies a link to it: whole. */
  const PERSON_PAGE = 'http://localhost:3000/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

  it('keeps the mentions and images of what was copied in an editor', () => {
    const markdown = `**Ask** [@Sam Support](mention:${SAM}) about ![The plan](https://adiutor.dev/plan.png "Plan").`;
    const from = editorWith(markdown);
    from.commands.selectAll();
    const copied = copyFrom(from);
    // The editor's own HTML carries what it reads them back from.
    expect(copied['text/html']).toContain(`data-mention-key="${SAM}"`);
    expect(copied['text/html']).toContain('data-markdown=');

    const to = editorWith('');
    pasteIn(to, copied);

    expect(writeMarkdown(to)).toBe(markdown);
    expect(to.view.dom.querySelector('img')).toBeNull();
  });

  it('reads a mention back from where a text is read, by the key a writer gets there', () => {
    const editor = editorWith('');

    pasteIn(editor, {
      'text/plain': 'Ask @Sam Support and @Casey Client.',
      // Someone at a company gets a span; the staff get a link to the person's page. A browser
      // copies each with the weight it's shown in, which isn't bold someone gave it.
      'text/html': `<p style="font-weight: 400">Ask <span data-mention="" data-mention-key="${SAM}" class="border" style="font-weight: 500">@Sam Support</span> and <a data-mention="" data-mention-key="${CASEY}" href="${PERSON_PAGE}" style="font-weight: 600">@Casey Client</a>.</p>`,
    });

    expect(writeMarkdown(editor)).toBe(
      `Ask [@Sam Support](mention:${SAM}) and [@Casey Client](mention:${CASEY}).`,
    );
    expect(editor.view.dom.querySelector('a, strong')).toBeNull();
  });

  it('takes the look off mentions and images only, also in cells without their table', () => {
    expect(withoutOwnLooks('<p style="color: red"><b>bold</b></p>')).toBe(
      '<p style="color: red"><b>bold</b></p>',
    );
    expect(
      withoutOwnLooks(
        '<td style="font-weight: 600"><span data-mention="" style="font-weight: 500">@Sam</span><span data-written-image="" style="color: blue">The plan</span></td>',
      ),
    ).toBe(
      '<td style="font-weight: 600"><span data-mention="">@Sam</span><span data-written-image="">The plan</span></td>',
    );
  });

  it('pastes a mention without a key as its text, never as a link to the person’s page', () => {
    const editor = editorWith('');

    pasteIn(editor, {
      'text/plain': 'Ask @Sam Support, @Casey Client, @Wim and Fenna.',
      'text/html': [
        '<p>Ask <span data-mention="">@Sam Support</span>, ',
        `<a data-mention="" href="${PERSON_PAGE}">@Casey Client</a>, `,
        '<span data-mention="" data-mention-key="not-a-key">@Wim</span> and ',
        `<span data-mention="" data-mention-key="${SAM}">Fenna</span>.</p>`,
      ].join(''),
    });

    expect(writeMarkdown(editor)).toBe('Ask @Sam Support, @Casey Client, @Wim and Fenna.');
    expect(editor.view.dom.querySelector('a, [data-mention]')).toBeNull();
  });

  it('links a pasted address only when it’s a whole http or https address', () => {
    const editor = editorWith('');

    pasteIn(editor, {
      'text/plain': 'the docs, a request and this',
      'text/html':
        '<p><a href="https://adiutor.dev/docs">the docs</a>, <a href="/requests/12">a request</a> and <a href="javascript:alert(1)">this</a></p>',
    });

    expect(writeMarkdown(editor)).toBe('[the docs](https://adiutor.dev/docs), a request and this');
  });

  it('takes an image only when its Markdown is one image, and never loads one', () => {
    const editor = editorWith('');

    pasteIn(editor, {
      'text/plain': 'bold two images a picture',
      'text/html': [
        '<p><span data-written-image="" data-markdown="**bold**">bold</span> ',
        '<span data-written-image="" data-markdown="![a](https://adiutor.dev/a.png) ![b](https://adiutor.dev/b.png)">two images</span> ',
        '<img src="https://adiutor.dev/picture.png" alt="a picture"></p>',
      ].join(''),
    });

    expect(writeMarkdown(editor)).toBe('bold two images');
    expect(editor.view.dom.querySelector('img, [data-written-image], strong')).toBeNull();
  });
});

describe('links to the staff’s pages', () => {
  /** The page's own address, which the editor of a text the company reads is given. */
  const APP = window.location.origin;
  /** A user's page for the staff, as a browser copies a link to it: whole, with the user's ID. */
  const USER_PAGE = `${APP}/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b`;

  /**
   * Makes an editor for a text, with the extensions its field gives it.
   *
   * @param appUrl - Adiutor's address, for a text the company reads; `null` for an internal note.
   * @param markdown - The text it starts with.
   * @returns The editor.
   */
  function fieldEditor(appUrl: string | null, markdown = ''): Editor {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions(
        {
          /**
           * Labels an image.
           *
           * @param description - Its description.
           * @returns The label.
           */
          image: (description) => description,
          /**
           * Names a task's checkbox.
           *
           * @param task - The task.
           * @returns The name.
           */
          task: (task) => task,
          code: 'Code',
        },
        null,
        appUrl,
      ),
    });
    editors.push(editor);
    readMarkdown(editor, markdown);
    return editor;
  }

  /** An entry's author line as the staff see it, copied from a request's activity. */
  const AUTHOR_LINE = {
    'text/plain': 'Sam Support Adiutor Tests 2 hours ago',
    'text/html': `<p class="flex flex-wrap"><a class="font-medium wrap-anywhere" href="${USER_PAGE}">Sam Support</a> <span>Adiutor Tests</span> <time datetime="2026-11-22T08:00:00Z">2 hours ago</time></p>`,
  };

  it('pastes an entry’s author line in a reply as its text', () => {
    const editor = fieldEditor(APP);

    pasteIn(editor, AUTHOR_LINE);

    expect(writeMarkdown(editor)).toBe('Sam Support Adiutor Tests 2 hours ago');
    expect(editor.view.dom.querySelector('a')).toBeNull();
  });

  it('pastes a row of the list of users as its text, and keeps an ordinary link', () => {
    const editor = fieldEditor(APP);

    pasteIn(editor, {
      'text/plain': 'Casey Client casey@adiutor.test Adiutor Tests the docs',
      'text/html': [
        `<p><a href="${USER_PAGE}">Casey Client</a> casey@adiutor.test `,
        `<a href="${APP}/admin/companies/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c">Adiutor Tests</a> `,
        '<a href="https://adiutor.dev/docs">the docs</a></p>',
      ].join(''),
    });

    expect(writeMarkdown(editor)).toBe(
      'Casey Client casey@adiutor.test Adiutor Tests [the docs](https://adiutor.dev/docs)',
    );
  });

  it('keeps a link to a request, which isn’t a page for the staff', () => {
    const editor = fieldEditor(APP);

    pasteIn(editor, {
      'text/plain': 'AD-142',
      'text/html': `<p><a href="${APP}/requests/AD-142">AD-142</a></p>`,
    });

    expect(writeMarkdown(editor)).toBe(`[AD-142](${APP}/requests/AD-142)`);
  });

  it('reads such a link as its text, from Markdown and from a paste of Markdown', () => {
    const editor = fieldEditor(APP, `Ask [Sam Support](${USER_PAGE}).`);
    editor.commands.focus('end');

    paste(editor, { 'text/plain': ` And [Casey](${USER_PAGE}).` });

    expect(writeMarkdown(editor)).toBe('Ask Sam Support. And Casey.');
    expect(editor.view.dom.querySelector('a')).toBeNull();
  });

  it('never links the address itself: pasted over a selection, or set as a link', () => {
    const editor = fieldEditor(APP, 'Ask Sam about it.');
    // "Sam", after the paragraph's start and "Ask ".
    editor.commands.setTextSelection({ from: 5, to: 8 });

    expect(editor.commands.setLink({ href: USER_PAGE })).toBe(false);
    pasteIn(editor, { 'text/plain': USER_PAGE });

    expect(editor.getText()).toBe(`Ask ${USER_PAGE} about it.`);
    expect(editor.view.dom.querySelector('a')).toBeNull();
  });

  it('keeps such a link in an internal note, which only the staff read', () => {
    const editor = fieldEditor(null);

    pasteIn(editor, AUTHOR_LINE);

    expect(writeMarkdown(editor)).toBe(`[Sam Support](${USER_PAGE}) Adiutor Tests 2 hours ago`);
  });

  it('reads an image of such a page as its description, as when the text is saved', () => {
    const markdown = `See ![Sam](${USER_PAGE}), ![](${USER_PAGE})and ![the plan](https://adiutor.dev/plan.png).`;
    const reply = fieldEditor(APP, markdown);
    const note = fieldEditor(null, markdown);

    expect(writeMarkdown(reply)).toBe('See Sam, and ![the plan](https://adiutor.dev/plan.png).');
    expect(reply.view.dom.querySelectorAll('[data-written-image]')).toHaveLength(1);
    expect(writeMarkdown(note)).toBe(markdown);
  });
});

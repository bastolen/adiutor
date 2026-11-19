/**
 * @file Tests for what the toolbar and the editor tell each other: what's on
 * at the cursor, and what each button does to the text.
 */
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions, readMarkdown, writeMarkdown } from './editor-extensions';
import { format, formattingOf } from './editor-formatting';

/** The editors made by a test, to take down after it. */
const editors: Editor[] = [];

/**
 * Makes an editor that holds a Markdown text, with the cursor in one of its words.
 *
 * @param markdown - The text.
 * @param word - The word to put the cursor in; the whole word is selected with `select`.
 * @param select - Whether to select the word instead of putting the cursor in it.
 * @returns The editor.
 */
function editorAt(markdown: string, word: string, select = false): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions({
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
    }),
  });
  editors.push(editor);
  readMarkdown(editor, markdown);
  let start: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (start === null && node.isText && node.text?.includes(word)) {
      start = position + node.text.indexOf(word);
    }
  });
  if (start === null) {
    throw new Error(`No "${word}" in the editor`);
  }
  editor.commands.setTextSelection(select ? { from: start, to: start + word.length } : start + 1);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('formattingOf', () => {
  it('finds nothing on in plain text', () => {
    const state = formattingOf(editorAt('plain text', 'plain'));

    expect(state).toEqual({
      bold: false,
      italic: false,
      strike: false,
      code: false,
      link: null,
      heading: 0,
      bulletList: false,
      orderedList: false,
      taskList: false,
      quote: false,
      codeBlock: false,
      canNest: false,
      canLift: false,
    });
  });

  it('finds the marks and the link the cursor is in', () => {
    expect(formattingOf(editorAt('some ***both*** here', 'both'))).toMatchObject({
      bold: true,
      italic: true,
    });
    expect(formattingOf(editorAt('[the docs](https://adiutor.dev/docs)', 'docs')).link).toBe(
      'https://adiutor.dev/docs',
    );
  });

  it('finds the kind of block the cursor is in', () => {
    expect(formattingOf(editorAt('## Title', 'Title')).heading).toBe(2);
    expect(formattingOf(editorAt('> quoted', 'quoted')).quote).toBe(true);
    expect(formattingOf(editorAt('```\ncode\n```', 'code')).codeBlock).toBe(true);
    expect(formattingOf(editorAt('1. first', 'first')).orderedList).toBe(true);
    expect(formattingOf(editorAt('- [ ] todo', 'todo')).taskList).toBe(true);
  });

  it('knows whether a list item can be nested or lifted', () => {
    expect(formattingOf(editorAt('- one\n- two', 'one'))).toMatchObject({
      bulletList: true,
      canNest: false,
      canLift: true,
    });
    expect(formattingOf(editorAt('- one\n- two', 'two')).canNest).toBe(true);
    expect(formattingOf(editorAt('- [ ] one\n- [ ] two', 'two')).canNest).toBe(true);
  });
});

describe('format', () => {
  it.each([
    ['bold', '**word**'],
    ['italic', '*word*'],
    ['strike', '~~word~~'],
    ['code', '`word`'],
  ] as const)('switches %s on for the selected text', (type, markdown) => {
    const editor = editorAt('a word here', 'word', true);

    format(editor, { type });

    expect(writeMarkdown(editor)).toBe(`a ${markdown} here`);
  });

  it('switches formatting off again', () => {
    const editor = editorAt('a **word** here', 'word', true);

    format(editor, { type: 'bold' });

    expect(writeMarkdown(editor)).toBe('a word here');
  });

  it.each([
    ['bulletList', '- text'],
    ['orderedList', '1. text'],
    ['taskList', '- [ ] text'],
    ['quote', '> text'],
    ['codeBlock', '```\ntext\n```'],
  ] as const)('makes the block at the cursor a %s', (type, markdown) => {
    const editor = editorAt('text', 'text');

    format(editor, { type });

    expect(writeMarkdown(editor)).toBe(markdown);
  });

  it('makes a block a heading, another heading, and normal text again', () => {
    const editor = editorAt('text', 'text');

    format(editor, { type: 'heading', level: 1 });
    expect(writeMarkdown(editor)).toBe('# text');
    format(editor, { type: 'heading', level: 3 });
    expect(writeMarkdown(editor)).toBe('### text');
    format(editor, { type: 'heading', level: 0 });
    expect(writeMarkdown(editor)).toBe('text');
  });

  it('nests a list item and lifts it out again', () => {
    const editor = editorAt('- one\n- two', 'two');

    format(editor, { type: 'nest' });
    expect(writeMarkdown(editor)).toBe('- one\n  - two');
    format(editor, { type: 'lift' });
    expect(writeMarkdown(editor)).toBe('- one\n- two');
  });

  it('nests a thing to do', () => {
    const editor = editorAt('- [ ] one\n- [ ] two', 'two');

    format(editor, { type: 'nest' });

    expect(writeMarkdown(editor)).toBe('- [ ] one\n  - [ ] two');
  });

  it('links the selected text', () => {
    const editor = editorAt('see the docs here', 'the docs', true);

    format(editor, { type: 'link', address: 'https://adiutor.dev/docs' });

    expect(writeMarkdown(editor)).toBe('see [the docs](https://adiutor.dev/docs) here');
  });

  it('adds the address itself as a link when nothing is selected', () => {
    const editor = editorAt('see  here', 'see');
    editor.commands.setTextSelection(5);

    format(editor, { type: 'link', address: 'https://adiutor.dev/docs' });

    expect(writeMarkdown(editor)).toBe(
      'see [https://adiutor.dev/docs](https://adiutor.dev/docs) here',
    );
  });

  it('changes and removes the whole link the cursor is in', () => {
    const editor = editorAt('see [the docs](https://adiutor.dev/old) here', 'docs');

    format(editor, { type: 'link', address: 'https://adiutor.dev/new' });
    expect(writeMarkdown(editor)).toBe('see [the docs](https://adiutor.dev/new) here');

    format(editor, { type: 'link', address: null });
    expect(writeMarkdown(editor)).toBe('see the docs here');
  });
});

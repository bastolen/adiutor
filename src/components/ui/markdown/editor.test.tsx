/**
 * @file Tests for the editor as a component: what it is to a screen reader,
 * what it shows of the Markdown it's given, and that only a real change is
 * passed on. Typing in it needs a real browser, which the end-to-end tests
 * have.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MarkdownEditorProps } from './editor';

// Unit tests don't load the editor (`vitest.setup.ts`); this file is about it.
const { default: MarkdownEditor } = await vi.importActual<typeof import('./editor')>('./editor');

/**
 * Renders the editor with a label and a description next to it.
 *
 * @param props - Props for the editor, next to the defaults.
 * @returns What was rendered, and the function the editor reports changes to.
 */
function renderEditor(props: Partial<MarkdownEditorProps> = {}) {
  const onChange = vi.fn();
  /**
   * The editor with its label and description.
   *
   * @param more - Props that replace the ones above.
   * @returns The elements.
   */
  const ui = (more: Partial<MarkdownEditorProps> = {}) => (
    <>
      <span id="label">Your reply</span>
      <span id="hint">Markdown works.</span>
      <MarkdownEditor
        markdown=""
        onChange={onChange}
        labelledBy="label"
        describedBy="hint"
        rows={4}
        disabled={false}
        required={false}
        focusOnStart={false}
        {...props}
        {...more}
      />
    </>
  );
  const view = render(ui());
  return { ...view, onChange, ui };
}

describe('MarkdownEditor', () => {
  it('is a text field of several lines, named and described by what’s around it', async () => {
    renderEditor({ required: true });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(editor).toHaveAttribute('aria-multiline', 'true');
    expect(editor).toHaveAttribute('aria-required', 'true');
    expect(editor).toHaveAccessibleDescription('Markdown works.');
  });

  it('is as high as its rows to start with, and its box can be dragged taller', async () => {
    renderEditor({ rows: 8 });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    const area = editor.closest('.resize-y');
    // Eight lines of 1.5rem and the padding: what a plain text field of eight rows is.
    expect(area?.getAttribute('style')).toBe('min-height: 13rem;');
    expect(area).toHaveClass('resize-y', 'overflow-y-auto');
    // The text fills the box, so a click anywhere in it lands in the text.
    expect(editor).toHaveClass('flex-1');
  });

  it('shows the Markdown it starts with, formatted', async () => {
    renderEditor({ markdown: '# Title\n\nSome **bold** text.\n\n- [ ] call back' });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    expect(editor.querySelector('h1')).toHaveTextContent('Title');
    expect(editor.querySelector('strong')).toHaveTextContent('bold');
    // A task's checkbox says what it's for.
    expect(screen.getByRole('checkbox', { name: 'To do: call back' })).not.toBeChecked();
  });

  it('shows an image by its description, without loading it', async () => {
    renderEditor({ markdown: '![The plan](https://adiutor.dev/plan.png)' });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    expect(editor).toHaveTextContent('The plan (image)');
    // (The editor's library puts an invisible marker of its own in the text, which is an image
    // without an address.)
    expect(editor.querySelector('img[src]')).not.toBeInTheDocument();
  });

  it('has its formatting toolbar before the text, ready once the editor is', async () => {
    renderEditor({ markdown: 'Some text.' });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(toolbar.compareDocumentPosition(editor)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' })).toBeEnabled());
  });

  it('shows a block of code under its language, coloured once the languages have loaded', async () => {
    renderEditor({ markdown: '```ts\nconst a = 1;\n```\n\n```\nconst b = 2;\n```' });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    // The languages are fetched because the text has code; then the block is coloured and named.
    await waitFor(() => expect(editor.querySelector('.hljs-keyword')).toHaveTextContent('const'));
    const captions = [...editor.querySelectorAll('figcaption')].map(
      (caption) => caption.textContent,
    );
    expect(captions).toEqual(['TypeScript', 'Code']);
    // A block that names no language is never coloured: no language is guessed.
    const [, plain] = [...editor.querySelectorAll('pre')];
    expect(plain).toHaveTextContent('const b = 2;');
    expect(plain?.querySelector('[class*="hljs-"]')).not.toBeInTheDocument();
  });

  it('doesn’t report being filled as a change', async () => {
    const { onChange } = renderEditor({ markdown: 'Text from before.' });

    await screen.findByText('Text from before.');

    // Passing that on would overwrite the text with what a still empty editor holds.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can be read but not changed while it’s switched off', async () => {
    const { rerender, ui } = renderEditor({ markdown: 'Read only.', disabled: true });

    const editor = await screen.findByRole('textbox', { name: 'Your reply' });
    expect(editor).toHaveAttribute('contenteditable', 'false');
    expect(editor).toHaveAttribute('aria-disabled', 'true');
    expect(editor).toHaveTextContent('Read only.');
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();

    rerender(ui({ disabled: false }));
    expect(editor).toHaveAttribute('contenteditable', 'true');
  });
});

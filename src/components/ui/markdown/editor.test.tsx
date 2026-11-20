/**
 * @file Tests for the editor as a component: what it is to a screen reader,
 * what it shows of the Markdown it's given, and that only a real change is
 * passed on. Typing in it needs a real browser, which the end-to-end tests
 * have.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { MarkdownEditorProps } from './editor';

// Unit tests don't load the editor (`vitest.setup.ts`); this file is about it.
const { default: MarkdownEditor } = await vi.importActual<typeof import('./editor')>('./editor');

/**
 * The rectangles of a range where nothing is laid out: none.
 *
 * @returns An empty list.
 */
function noRectangles(): DOMRectList {
  return [] as unknown as DOMRectList;
}

/**
 * The box of a range where nothing is laid out: one without a size.
 *
 * @returns The box.
 */
function noBox(): DOMRect {
  return new DOMRect();
}

beforeAll(() => {
  // The editor scrolls the cursor into view when it takes the focus, and asks where the cursor
  // is for that. Nothing is laid out here, and a range can't be asked at all.
  Range.prototype.getClientRects = noRectangles;
  Range.prototype.getBoundingClientRect = noBox;
});

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
        label="Your reply"
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

  it('opens large in a dialog named by the field’s label, with its toolbar and the same text', async () => {
    const user = userEvent.setup();
    renderEditor({ markdown: 'A **long** text.', below: <p role="status">Too long.</p> });
    const inField = await screen.findByRole('textbox', { name: 'Your reply' });
    expect(inField).toHaveTextContent('A long text.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // What the field says below itself isn't the editor's to show there.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Large view' }));

    const dialog = await screen.findByRole('dialog', { name: 'Your reply' });
    const large = within(dialog).getByRole('textbox', { name: 'Your reply' });
    // It's the editor itself that's shown there, formatted as it was.
    expect(large).toBe(inField);
    expect(large.querySelector('strong')).toHaveTextContent('long');
    expect(within(dialog).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Large view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Its text fills the dialog and scrolls there, without an edge to drag.
    expect(large.closest('.overflow-y-auto')).not.toHaveClass('resize-y');
    // What the field says about the text shows below it.
    expect(within(dialog).getByRole('status')).toHaveTextContent('Too long.');
  });

  it('comes back to the field from the large view, with the same button', async () => {
    const user = userEvent.setup();
    renderEditor({ markdown: 'Back again.' });
    const inField = await screen.findByRole('textbox', { name: 'Your reply' });
    await user.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your reply' });

    await user.click(within(dialog).getByRole('button', { name: 'Large view' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const back = screen.getByRole('textbox', { name: 'Your reply' });
    expect(back).toBe(inField);
    expect(back).toHaveTextContent('Back again.');
    expect(back.closest('.resize-y')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Large view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('leaves the large view with Escape and with the dialog’s close button', async () => {
    const user = userEvent.setup();
    renderEditor({ markdown: 'Still here.' });
    await screen.findByRole('textbox', { name: 'Your reply' });

    await user.click(screen.getByRole('button', { name: 'Large view' }));
    await screen.findByRole('dialog', { name: 'Your reply' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Large view' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Your reply' })).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Your reply' })).toHaveTextContent('Still here.');
  });

  it('keeps the field’s toolbar in its place, switched off, while the editor is open large', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();
    await screen.findByRole('textbox', { name: 'Your reply' });

    await user.click(screen.getByRole('button', { name: 'Large view' }));
    await screen.findByRole('dialog', { name: 'Your reply' });

    // The page behind a dialog is hidden from assistive technology, so it's found by its element.
    const kept = container.querySelector('[role="toolbar"]');
    expect(kept).not.toBeNull();
    kept?.querySelectorAll('button').forEach((button) => {
      expect(button).toBeDisabled();
    });
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

/**
 * @file Tests for the Markdown field: the plain text field it starts as, the
 * editor it becomes, and what the form gets from it. The editor itself is
 * stood in for here (it needs a real browser to be typed in); what it knows
 * of Markdown is tested in `editor-extensions.test.ts`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MarkdownEditorProps } from './editor';
import MarkdownField from './markdown-field';

vi.mock('./editor', () => ({
  /**
   * Stands in for the editor: it shows what it was given, and has a button
   * that "types" a text.
   *
   * @param props - The editor's props.
   * @returns The stand-in.
   */
  default: (props: MarkdownEditorProps) => (
    <div
      role="textbox"
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      aria-required={props.required}
      aria-disabled={props.disabled}
      data-rows={props.rows}
      data-focus={props.focusOnStart}
    >
      <span data-testid="started-with">{props.markdown}</span>
      <button type="button" onClick={() => props.onChange('**typed** in the editor')}>
        Type
      </button>
    </div>
  ),
}));

/**
 * Renders the field in a form.
 *
 * @param props - Props for the field, next to its label and name.
 * @returns The form.
 */
function renderField(props: Partial<Parameters<typeof MarkdownField>[0]> = {}) {
  const { container } = render(
    <form>
      <MarkdownField label="Your reply" name="body" description="Markdown works." {...props} />
    </form>,
  );
  return container.querySelector('form') as HTMLFormElement;
}

/**
 * Waits until the editor has taken the plain field's place.
 *
 * @returns The editor.
 */
async function findEditor(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: 'Your reply' }).tagName).toBe('DIV');
  });
  return screen.getByRole('textbox', { name: 'Your reply' });
}

/**
 * The Markdown the form would send.
 *
 * @param form - The form.
 * @returns The value under the field's name.
 */
const sent = (form: HTMLFormElement) => new FormData(form).get('body');

describe('MarkdownField, before the editor is there', () => {
  it('is a plain text field with its label, help text and limits', () => {
    renderField({ rows: 6, maxLength: 100, required: true });

    const field = screen.getByRole('textbox', { name: 'Your reply' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('name', 'body');
    expect(field).toHaveAttribute('rows', '6');
    expect(field).toHaveAttribute('maxlength', '100');
    expect(field).toBeRequired();
    expect(field).toHaveAccessibleDescription('Markdown works.');
  });

  it('has the formatting toolbar already, switched off until the editor is there', () => {
    renderField();

    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('sends what was typed in it', () => {
    const form = renderField();

    fireEvent.change(screen.getByRole('textbox', { name: 'Your reply' }), {
      target: { value: 'Typed at once.' },
    });

    expect(sent(form)).toBe('Typed at once.');
  });
});

describe('MarkdownField, once the editor has loaded', () => {
  it('becomes the editor, named and described like the field was', async () => {
    renderField({ rows: 6, required: true });

    const editor = await findEditor();
    expect(editor).toHaveAccessibleDescription('Markdown works.');
    expect(editor).toHaveAttribute('aria-required', 'true');
    expect(editor).toHaveAttribute('data-rows', '6');
    expect(document.querySelector('textarea')).not.toBeInTheDocument();
  });

  it('hands the editor what was typed before it was there, and the focus', async () => {
    const form = renderField();
    const plain = screen.getByRole('textbox', { name: 'Your reply' });
    plain.focus();
    fireEvent.change(plain, { target: { value: '# Typed early' } });

    const editor = await findEditor();

    expect(screen.getByTestId('started-with')).toHaveTextContent('# Typed early');
    expect(editor).toHaveAttribute('data-focus', 'true');
    // The form still sends it, now from the hidden field.
    expect(sent(form)).toBe('# Typed early');
  });

  it('doesn’t take the focus when the field didn’t have it', async () => {
    renderField();

    const editor = await findEditor();

    expect(editor).toHaveAttribute('data-focus', 'false');
  });

  it('sends the editor’s Markdown under the field’s name', async () => {
    const form = renderField();

    fireEvent.click(await screen.findByRole('button', { name: 'Type' }));

    expect(sent(form)).toBe('**typed** in the editor');
    expect(form.querySelector('input[type="hidden"]')).toHaveAttribute('name', 'body');
  });

  it('is empty again when the form is reset, as after a text was sent', async () => {
    const form = renderField();
    fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
    expect(sent(form)).toBe('**typed** in the editor');

    fireEvent.reset(form);

    expect(sent(form)).toBe('');
    expect(screen.getByTestId('started-with')).toBeEmptyDOMElement();
  });

  it('says when the Markdown is longer than the form takes', async () => {
    renderField({ maxLength: 10 });

    fireEvent.click(await screen.findByRole('button', { name: 'Type' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'This text is longer than 10 characters. Shorten it before you send it.',
    );
  });

  it('says nothing about the length of a text that fits', async () => {
    renderField({ maxLength: 100 });

    fireEvent.click(await screen.findByRole('button', { name: 'Type' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is switched off with the form, and then sends nothing', async () => {
    const form = renderField({ disabled: true });

    const editor = await findEditor();

    expect(editor).toHaveAttribute('aria-disabled', 'true');
    expect(sent(form)).toBeNull();
  });
});

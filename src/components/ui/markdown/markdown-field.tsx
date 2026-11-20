/**
 * @file A field for a text in Markdown. It starts as a plain text field, so
 * it works at once and without JavaScript, and becomes an editor that
 * formats while it's written as soon as the editor has loaded. Either way
 * the form gets the text as Markdown, under the field's name.
 */
'use client';

import { useTranslations } from 'next-intl';
import { type ComponentType, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { MarkdownEditorProps } from './editor';
import FormattingToolbar from './formatting-toolbar';
import { markdownStyles } from './styles';

/** What the toolbar's buttons do before the editor is there: nothing (they're disabled). */
function ignore() {}

/** Props for {@link MarkdownField}. */
interface MarkdownFieldProps {
  /** Visible label text. */
  label: string;
  /** The name the form sends the Markdown under. */
  name: string;
  /** Help text below the field, read out with it. */
  description?: string;
  /** How many lines the field is high at least. Defaults to 4. */
  rows?: number;
  /** The most characters the Markdown may have; the server checks it, the field says so. */
  maxLength?: number;
  /** Whether a text is required. */
  required?: boolean;
  /** Whether the field is switched off. */
  disabled?: boolean;
}

/**
 * A labelled field for Markdown.
 *
 * - **Before the editor is there** (and when it can't load) it's a plain
 *   text field under the formatting toolbar, whose buttons are switched off
 *   until the editor is there. What's typed there is read as Markdown when
 *   the editor takes over, with the cursor kept in the field.
 * - **The editor** shows the text as it will be read. Its Markdown goes to
 *   the form in a hidden field with the field's name, so the form's action
 *   gets the same thing either way.
 * - **When the form is reset** (after a text was sent) the editor is empty
 *   again; a refused submit keeps the text.
 * - **A page that's kept alive** while the user is elsewhere loses the
 *   editor's inner state; the Markdown is kept here, and the editor starts
 *   from it again.
 * - **The editor can be opened large** from its toolbar, in a dialog named
 *   by the label. What the field says about a text that's too long shows
 *   there as well.
 *
 * @param props - Field props.
 * @param props.label - Visible label text.
 * @param props.name - The name the form sends the Markdown under.
 * @param props.description - Help text.
 * @param props.rows - The least height, in lines.
 * @param props.maxLength - The most characters the Markdown may have.
 * @param props.required - Whether a text is required.
 * @param props.disabled - Whether the field is switched off.
 * @returns The field.
 */
export default function MarkdownField({
  label,
  name,
  description = '',
  rows = 4,
  maxLength = undefined,
  required = false,
  disabled = false,
}: MarkdownFieldProps) {
  const t = useTranslations('common.markdown');
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const [Editor, setEditor] = useState<ComponentType<MarkdownEditorProps> | null>(null);
  const [markdown, setMarkdown] = useState('');
  // Whether the plain field had focus when the editor took over: the editor takes it then.
  const [hadFocus, setHadFocus] = useState(false);
  // Raised when the form is reset, which starts the editor afresh, empty.
  const [resets, setResets] = useState(0);
  const plainField = useRef<HTMLTextAreaElement>(null);
  const sentField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    import('./editor').then(
      (loaded) => {
        const field = plainField.current;
        // Without the plain field the editor is there already (the page was kept alive).
        if (cancelled || !field) {
          return;
        }
        // At once: the plain field's text is read and the editor takes its place in one go. Left
        // to React's own timing, what's typed or pasted between the two would be lost with the
        // field.
        flushSync(() => {
          setMarkdown(field.value);
          setHadFocus(document.activeElement === field);
          setEditor(() => loaded.default);
        });
      },
      () => {
        // The editor couldn't be loaded: the plain field stays, and works.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const hasEditor = Editor !== null;
  useEffect(() => {
    const form = sentField.current?.form;
    if (!hasEditor || !form) {
      return undefined;
    }
    /** Empties the editor with the rest of the form. */
    const clear = () => {
      setMarkdown('');
      setHadFocus(false);
      setResets((count) => count + 1);
    };
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, [hasEditor]);

  if (!Editor) {
    // The same box and toolbar as the editor has, so nothing moves when it takes over. The
    // toolbar's buttons wait for the editor: they format what's selected in it.
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <div className={markdownStyles.editorFrame}>
          <FormattingToolbar state={null} onCommand={ignore} />
          <textarea
            ref={plainField}
            id={id}
            name={name}
            rows={rows}
            maxLength={maxLength}
            required={required}
            disabled={disabled}
            aria-describedby={description ? descriptionId : undefined}
            className={markdownStyles.plainField}
          />
        </div>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    );
  }

  // Said below the field, and below the text while the editor is open large.
  const tooLong = maxLength !== undefined && markdown.length > maxLength && (
    <p role="status" className="text-xs font-medium text-danger">
      {t('tooLong', { maximum: maxLength })}
    </p>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-foreground">
        {label}
      </span>
      <div className={markdownStyles.editorFrame}>
        <Editor
          key={resets}
          markdown={markdown}
          onChange={setMarkdown}
          label={label}
          labelledBy={labelId}
          describedBy={description ? descriptionId : undefined}
          rows={rows}
          disabled={disabled}
          required={required}
          focusOnStart={hadFocus}
          below={tooLong}
        />
      </div>
      <input ref={sentField} type="hidden" name={name} value={markdown} disabled={disabled} />
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {tooLong}
    </div>
  );
}

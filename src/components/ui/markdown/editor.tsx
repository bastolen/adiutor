/**
 * @file The editor of a Markdown field: the text as it will be read, which
 * formats itself while it's written, under a toolbar with the same
 * formatting as buttons. Typing Markdown (`**bold**`, `# `, `- `, three
 * backticks) turns into formatting, and so does pasting it.
 *
 * It's a lot of JavaScript, so nothing imports it with the page:
 * `MarkdownField` loads it with `import()` once the page is there, and shows
 * a plain text field until then.
 */
'use client';

import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { editorExtensions, readMarkdown, writeMarkdown } from './editor-extensions';
import { format, formattingOf, hasCode, highlightCode } from './editor-formatting';
import { knownCodeLanguages, subscribeToCodeLanguages } from './editor-highlighter';
import FormattingToolbar, { type FormattingState } from './formatting-toolbar';
import { markdownStyles } from './styles';

/**
 * The height of a line of text in the editor, in rem (`leading-6`). With the
 * 1rem of padding around the text, the editor is as high as the plain text
 * field of as many rows, so nothing moves when it takes that field's place.
 */
const LINE_HEIGHT = 1.5;

/** Props for {@link MarkdownEditor}. */
export interface MarkdownEditorProps {
  /** The Markdown the editor starts with. */
  markdown: string;
  /**
   * Called with the editor's Markdown whenever its content changes.
   *
   * @param markdown - The content as Markdown.
   */
  onChange: (markdown: string) => void;
  /** The ID of the element that labels the editor. */
  labelledBy: string;
  /** The ID of the element that describes it, if there is one. */
  describedBy?: string;
  /** How many lines of text the editor is high at least. */
  rows: number;
  /** Whether the editor is switched off: its text can be read, not changed. */
  disabled: boolean;
  /** Whether a text is required, for screen readers. */
  required: boolean;
  /** Whether to put the cursor at the end of the text once the editor is there. */
  focusOnStart: boolean;
}

/**
 * The toolbar and the editable text. The text is a text field to a screen
 * reader (`textbox`, of several lines), named and described by the elements
 * around it. Tab and Shift+Tab leave it; the toolbar comes before it. The
 * text's box grows with the text, and its bottom edge can be dragged to make
 * it taller, as a plain text field's can.
 *
 * @param props - Component props.
 * @param props.markdown - The Markdown to start with.
 * @param props.onChange - Called with the Markdown when the content changes.
 * @param props.labelledBy - The label's ID.
 * @param props.describedBy - The description's ID.
 * @param props.rows - The least height, in lines.
 * @param props.disabled - Whether the editor is switched off.
 * @param props.required - Whether a text is required.
 * @param props.focusOnStart - Whether to take focus once it's there.
 * @returns The editor.
 */
export default function MarkdownEditor({
  markdown,
  onChange,
  labelledBy,
  describedBy = undefined,
  rows,
  disabled,
  required,
  focusOnStart,
}: MarkdownEditorProps) {
  const t = useTranslations('common.markdown');
  const extensions = useMemo(
    () =>
      editorExtensions({
        /**
         * Labels an image by its description.
         *
         * @param description - The description, or nothing.
         * @returns The label.
         */
        image: (description) => (description ? t('imageNamed', { description }) : t('image')),
        /**
         * Names a task's checkbox.
         *
         * @param task - The task's text.
         * @param done - Whether it's ticked.
         * @returns The name.
         */
        task: (task, done) => t('taskCheckbox', { done: done ? 'yes' : 'no', task }),
        code: t('code'),
      }),
    [t],
  );
  // The editors that hold the text so far. A new editor reports a change while it's still empty
  // (when a page that was kept alive is shown again, the editor is made anew): that isn't
  // someone emptying the field, and passing it on would throw the text away.
  const filled = useRef(new WeakSet<Editor>());
  const editor = useEditor({
    extensions,
    // The page is rendered on the server first, where there's no editor.
    immediatelyRender: false,
    // Its styles are in `src/styles/editor.css`, not added by a script.
    injectCSS: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelledBy,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(required ? { 'aria-required': 'true' } : {}),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        class: markdownStyles.editor,
      },
    },
    /**
     * Fills the new editor with the text so far.
     *
     * @param created - What was created.
     * @param created.editor - The editor.
     */
    onCreate: ({ editor: created }) => {
      readMarkdown(created, markdown);
      filled.current.add(created);
      if (focusOnStart) {
        created.commands.focus('end');
      }
    },
    /**
     * Passes the content on as Markdown.
     *
     * @param updated - What changed.
     * @param updated.editor - The editor.
     */
    onUpdate: ({ editor: updated }) => {
      if (filled.current.has(updated)) {
        onChange(writeMarkdown(updated));
      }
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // What the toolbar's buttons show: it follows the cursor.
  const formatting = useEditorState({
    editor,
    /**
     * Reads what's on at the cursor.
     *
     * @param current - What the editor passes.
     * @param current.editor - The editor, once it's there.
     * @returns The formatting, or `null` while there's no editor.
     */
    selector: ({ editor: current }): FormattingState | null =>
      current ? formattingOf(current) : null,
  });

  // The languages of highlighted code are a download of their own, fetched once a text has a
  // block of code. The toolbar's language menu and the blocks' captions follow them.
  const languages = useSyncExternalStore(subscribeToCodeLanguages, knownCodeLanguages, () => null);
  const withCode = useEditorState({
    editor,
    /**
     * Looks for a block of code in the text.
     *
     * @param current - What the editor passes.
     * @param current.editor - The editor, once it's there.
     * @returns Whether the text has one.
     */
    selector: ({ editor: current }) => (current ? hasCode(current) : false),
  });
  useEffect(() => {
    if (editor && withCode) {
      // It never rejects: without the languages the code just stays uncoloured.
      highlightCode(editor).catch(() => undefined);
    }
  }, [editor, withCode]);

  return (
    <>
      <FormattingToolbar
        languages={languages?.choices ?? null}
        languageName={languages?.nameOf}
        state={disabled ? null : formatting}
        onCommand={(command) => {
          if (editor) {
            format(editor, command);
          }
        }}
      />
      {/* As high as its lines at least, taller with its text, and as tall as it's dragged. */}
      <div
        className={markdownStyles.editorArea}
        style={{ minHeight: `${rows * LINE_HEIGHT + 1}rem` }}
      >
        <EditorContent editor={editor} className="flex flex-1 flex-col" />
      </div>
    </>
  );
}

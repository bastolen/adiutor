/**
 * @file The editor of a Markdown field: the text as it will be read, which
 * formats itself while it's written. Typing Markdown (`**bold**`, `# `, `- `,
 * three backticks) turns into formatting, and so does pasting it.
 *
 * It's a lot of JavaScript, so nothing imports it with the page:
 * `MarkdownField` loads it with `import()` once the page is there, and shows
 * a plain text field until then.
 */
'use client';

import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';

import { editorExtensions, readMarkdown, writeMarkdown } from './editor-extensions';
import { markdownStyles } from './styles';

/** The height of a line of text in the editor, in rem (`leading-6`). */
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
 * The editable text. It's a text field to a screen reader (`textbox`, of
 * several lines), named and described by the elements around it. Tab and
 * Shift+Tab leave it.
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
        style: `min-height: ${rows * LINE_HEIGHT + 1}rem`,
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

  return <EditorContent editor={editor} />;
}

/**
 * @file The editor of a Markdown field: the text as it will be read, which
 * formats itself while it's written, under a toolbar with the same
 * formatting as buttons. Typing Markdown (`**bold**`, `# `, `- `, three
 * backticks) turns into formatting, and so does pasting it. The toolbar's
 * last button opens the editor large, in a dialog over the page.
 *
 * It's a lot of JavaScript, so nothing imports it with the page:
 * `MarkdownField` loads it with `import()` once the page is there, and shows
 * a plain text field until then.
 */
'use client';

import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import cn from '@/lib/cn';

import Modal from '../modal';
import { useTransientState } from '../use-transient-state';
import { editorExtensions, readMarkdown, writeMarkdown } from './editor-extensions';
import { format, formattingOf, hasCode, highlightCode } from './editor-formatting';
import { useCodeLanguages } from './editor-highlighter';
import MentionPopover, {
  createMentionList,
  type MentionListState,
  mentionOptionId,
} from './editor-mentions';
import FormattingToolbar, { type FormattingState, ignoreCommand } from './formatting-toolbar';
import type { MentionLoader } from './mentions';
import { markdownStyles } from './styles';

/**
 * The height of a line of text in the editor, in rem (`leading-6`). With the
 * 1rem of padding around the text, the editor is as high as the plain text
 * field of as many rows, so nothing moves when it takes that field's place.
 */
const LINE_HEIGHT = 1.5;

/**
 * Follows the list of people of an editor that has none: nothing ever changes.
 *
 * @returns Stops following, which is nothing to do.
 */
function followNothing() {
  return () => {};
}

/**
 * What the list of people shows for an editor that has none.
 *
 * @returns Nothing.
 */
function noMentionList(): MentionListState | null {
  return null;
}

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
  /** The field's label: the title of the dialog the editor opens large in. */
  label: string;
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
  /**
   * What stands below the text while the editor is open large: what the
   * field says about the text below itself, such as that it's too long.
   */
  below?: ReactNode;
  /**
   * Gives the people the text can mention; with it, typing "@" opens a list
   * of them. Whether the editor has the list is settled when it starts: a
   * loader that comes later is ignored, one that's replaced is followed.
   */
  mentions?: MentionLoader;
  /**
   * Whether only the staff read the text (an internal note): it may link to
   * the staff's pages. In any other text a link to one of them is kept as
   * its text, as the server does. Settled when the editor starts.
   */
  staffOnly?: boolean;
}

/**
 * The toolbar and the editable text. The text is a text field to a screen
 * reader (`textbox`, of several lines), named and described by the elements
 * around it. Tab and Shift+Tab leave it; the toolbar comes before it. The
 * text's box grows with the text, and its bottom edge can be dragged to make
 * it taller, as a plain text field's can.
 *
 * The toolbar's last button opens the editor large: a dialog over the page,
 * named by the field's label, with the toolbar and the text filling it. It's
 * this editor, shown there instead of in the field, so the text, the cursor
 * and what can be undone stay as they were, both ways. The text has the
 * focus when the dialog opens and when it closes (the button again, Escape,
 * the close button), like after the toolbar's menus. The field keeps its
 * place and height on the page meanwhile, with a toolbar that's switched
 * off, so nothing moves. A page that was kept alive comes back with the
 * editor in the field.
 *
 * With a loader of people (`mentions`), typing "@" opens a list of them at
 * the cursor (`MentionPopover`). The focus stays in the text, which says it
 * has a list and points at the option the arrow keys are on.
 *
 * @param props - Component props.
 * @param props.markdown - The Markdown to start with.
 * @param props.onChange - Called with the Markdown when the content changes.
 * @param props.label - The field's label.
 * @param props.labelledBy - The label's ID.
 * @param props.describedBy - The description's ID.
 * @param props.rows - The least height, in lines.
 * @param props.disabled - Whether the editor is switched off.
 * @param props.required - Whether a text is required.
 * @param props.focusOnStart - Whether to take focus once it's there.
 * @param props.below - What stands below the text while it's open large.
 * @param props.mentions - Gives the people the text can mention.
 * @param props.staffOnly - Whether only the staff read the text.
 * @returns The editor.
 */
export default function MarkdownEditor({
  markdown,
  onChange,
  label,
  labelledBy,
  describedBy = undefined,
  rows,
  disabled,
  required,
  focusOnStart,
  below = null,
  mentions = undefined,
  staffOnly = false,
}: MarkdownEditorProps) {
  const t = useTranslations('common.markdown');
  // Adiutor's own address, whose staff pages a text the company reads never links to: the page's,
  // which is what a browser makes a copied link's address from. The editor only runs in a browser.
  const [appUrl] = useState(() => (staffOnly ? null : window.location.origin));
  // The list of people at "@", for a text that can mention people. Made once: the editor's
  // extensions can't change after it started.
  const [mentionList] = useState(() => (mentions ? createMentionList(mentions) : null));
  const mentionListId = useId();
  const mentioning = useSyncExternalStore(
    mentionList?.subscribe ?? followNothing,
    mentionList?.getSnapshot ?? noMentionList,
    noMentionList,
  );
  useEffect(() => {
    if (mentionList && mentions) {
      mentionList.setLoader(mentions);
    }
  }, [mentionList, mentions]);
  // Whether the editor is open large. Closed again when the user comes back to a page that was kept.
  const [large, setLarge] = useTransientState(false);
  // The text's box in the field, and how high it was when the editor opened large: its place
  // in the field keeps that height, so the page doesn't move.
  const area = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState(0);
  const extensions = useMemo(
    () =>
      editorExtensions(
        {
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
        },
        mentionList,
        appUrl,
      ),
    [t, mentionList, appUrl],
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
        // A text that can mention people has a list, and points at the option the keys are on.
        ...(mentionList ? { 'aria-haspopup': 'listbox' } : {}),
        ...(mentioning && mentioning.choices.length > 0
          ? {
              'aria-controls': mentionListId,
              'aria-activedescendant': mentionOptionId(mentionListId, mentioning.active),
            }
          : {}),
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
  const languages = useCodeLanguages();
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

  /**
   * Gives the text the focus, with the cursor where it was. The dialog asks
   * for it a moment after it closed, when the page may have gone already.
   */
  const focusText = () => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus();
    }
  };

  // The toolbar and the text are shown in one place at a time: in the field, or in the dialog.
  const toolbar = (
    <FormattingToolbar
      languages={languages?.choices ?? null}
      languageName={languages?.nameOf}
      state={disabled ? null : formatting}
      appUrl={appUrl}
      onCommand={(command) => {
        if (editor) {
          format(editor, command);
        }
      }}
      large={large}
      onLarge={() => {
        if (!large) {
          setHeldHeight(area.current?.offsetHeight ?? 0);
        }
        setLarge(!large);
      }}
    />
  );
  const text = <EditorContent editor={editor} className="flex flex-1 flex-col" />;

  return (
    <>
      {large ? (
        <>
          {/* The editor's place in the field: as it looks before the editor is there. */}
          <FormattingToolbar state={null} onCommand={ignoreCommand} />
          <div aria-hidden="true" style={{ height: heldHeight }} />
        </>
      ) : (
        <>
          {toolbar}
          {/* As high as its lines at least, taller with its text, and as tall as it's dragged. */}
          <div
            ref={area}
            className={markdownStyles.editorArea}
            style={{ minHeight: `${rows * LINE_HEIGHT + 1}rem` }}
          >
            {text}
          </div>
        </>
      )}
      {mentionList && <MentionPopover list={mentionList} listId={mentionListId} />}
      {/* The dialog goes in the same step as the field takes the text back. Left to close by
          itself it would let go of the text a step later, after the field asked for it. */}
      {large && (
        <Modal
          open
          onOpenChange={setLarge}
          title={label}
          size="large"
          initialFocus={focusText}
          finalFocus={focusText}
        >
          <div className={cn(markdownStyles.editorFrame, markdownStyles.editorFrameLarge)}>
            {toolbar}
            <div className={markdownStyles.editorAreaLarge}>{text}</div>
          </div>
          {below}
        </Modal>
      )}
    </>
  );
}

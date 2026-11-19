/**
 * @file What the editor knows of Markdown: the formatting it offers, how a
 * Markdown text becomes its content and back, and the rules that keep what
 * the editor shows in step with what the server renders (`MarkdownText`).
 *
 * - HTML is never read: a tag stays the text it was typed as.
 * - Only whole `http` and `https` addresses are links.
 * - An image is kept as it was written and shown by its description; it's
 *   never loaded.
 * - Tab and Shift+Tab are never taken: they leave the editor, like any field.
 */
import { Link } from '@tiptap/extension-link';
import { ListItem, ListKeymap, TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import {
  type Editor,
  Extension,
  type Extensions,
  type KeyboardShortcutCommand,
  Node,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { linkTarget } from '@/lib/requests';

import { writtenLinkClasses } from '../external-link';
import editorCodeBlock from './editor-code-block';
import { markdownStyles } from './styles';

/** The texts the editor's content needs, in the reader's language. */
export interface EditorLabels {
  /**
   * What an image is shown as, from its description.
   *
   * @param description - The image's description, or nothing.
   * @returns The text to show in its place.
   */
  image: (description: string) => string;
  /**
   * The name of a task's checkbox.
   *
   * @param task - The task's text.
   * @param done - Whether it's ticked.
   * @returns The checkbox's accessible name.
   */
  task: (task: string, done: boolean) => string;
  /** The caption of a block of code that names no language ("Code"). */
  code: string;
}

/**
 * Takes Tab and Shift+Tab out of an extension's shortcuts. Lists and tables
 * use them to indent and to move between cells, which would keep someone on
 * the keyboard inside the editor; here they move focus on, like in any field.
 *
 * @param shortcuts - The extension's shortcuts.
 * @returns The same shortcuts without the two.
 */
function withoutTab(
  shortcuts: Record<string, KeyboardShortcutCommand>,
): Record<string, KeyboardShortcutCommand> {
  return Object.fromEntries(
    Object.entries(shortcuts).filter(([keys]) => keys !== 'Tab' && keys !== 'Shift-Tab'),
  );
}

/**
 * A list item. It nests and un-nests with Ctrl or Cmd and the square
 * brackets, since Tab is left to the browser.
 */
const EditorListItem = ListItem.extend({
  /**
   * The item's shortcuts.
   *
   * @returns The list item's own, without Tab, and the two for nesting.
   */
  addKeyboardShortcuts() {
    return {
      ...withoutTab(this.parent?.() ?? {}),
      /**
       * Nests the item under the one above it.
       *
       * @returns Whether it did.
       */
      'Mod-]': () => this.editor.commands.sinkListItem(this.name),
      /**
       * Lifts the item out of the list it's nested in.
       *
       * @returns Whether it did.
       */
      'Mod-[': () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/** A thing to do, with a checkbox. It nests like a list item. */
const EditorTaskItem = TaskItem.extend({
  /**
   * The task's shortcuts.
   *
   * @returns The task item's own, without Tab, and the two for nesting.
   */
  addKeyboardShortcuts() {
    return {
      ...withoutTab(this.parent?.() ?? {}),
      /**
       * Nests the task under the one above it.
       *
       * @returns Whether it did.
       */
      'Mod-]': () => this.editor.commands.sinkListItem(this.name),
      /**
       * Lifts the task out of the list it's nested in.
       *
       * @returns Whether it did.
       */
      'Mod-[': () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/** What Backspace and Delete do at the edges of a list item, without its Tab. */
const EditorListKeymap = ListKeymap.extend({
  /**
   * The keymap's shortcuts.
   *
   * @returns Its own, without Tab.
   */
  addKeyboardShortcuts() {
    return withoutTab(this.parent?.() ?? {});
  },
});

/** A table. The arrow keys move between its cells; Tab leaves the editor. */
const EditorTable = Table.extend({
  /**
   * The table's shortcuts.
   *
   * @returns The table's own, without Tab.
   */
  addKeyboardShortcuts() {
    return withoutTab(this.parent?.() ?? {});
  },
});

/**
 * A link. When Markdown is read, an address that isn't a whole `http` or
 * `https` address gives no link, only its text: what the server does too.
 */
const WrittenLink = Link.extend({
  /**
   * Reads a link from Markdown.
   *
   * @param token - The parser's link.
   * @param helpers - The Markdown reader's helpers.
   * @returns The link's text, linked when its address may be.
   */
  parseMarkdown: (token, helpers) => {
    const text = helpers.parseInline(token.tokens ?? []);
    return typeof token.href === 'string' && linkTarget(token.href) !== null
      ? helpers.applyMark('link', text, { href: token.href })
      : text;
  },
});

/**
 * An image someone wrote (`![description](address)`). The editor keeps the
 * Markdown as it was written and shows the image by its description, as a
 * word that can't be edited in place: it's never loaded, here or where the
 * text is read.
 */
const WrittenImage = Node.create<Pick<EditorLabels, 'image'>>({
  name: 'writtenImage',
  group: 'inline',
  inline: true,
  atom: true,
  /**
   * The node's options.
   *
   * @returns A label that shows the description as it is, until one is given.
   */
  addOptions() {
    return {
      /**
       * Shows an image by its description.
       *
       * @param description - The description.
       * @returns It.
       */
      image: (description: string) => description,
    };
  },
  /**
   * What the node remembers.
   *
   * @returns The Markdown it was written as, and its description.
   */
  addAttributes() {
    return { raw: { default: '' }, description: { default: '' } };
  },
  /**
   * How the node looks in the editor.
   *
   * @param props - What's rendered.
   * @param props.node - The image.
   * @returns A span with the image's label.
   */
  renderHTML({ node }) {
    return [
      'span',
      { class: writtenLinkClasses, 'data-written-image': '' },
      this.options.image(String(node.attrs.description)),
    ];
  },
  markdownTokenName: 'image',
  /**
   * Reads an image from Markdown.
   *
   * @param token - The parser's image.
   * @returns The node.
   */
  parseMarkdown: (token) => ({
    type: 'writtenImage',
    attrs: { raw: token.raw ?? '', description: token.text ?? '' },
  }),
  /**
   * Writes the image back as Markdown.
   *
   * @param node - The node.
   * @returns The Markdown it was written as.
   */
  renderMarkdown: (node) => String(node.attrs?.raw ?? ''),
});

/** Whether the Markdown reader was told to leave HTML alone (once is enough: all editors share it). */
let htmlIsOff = false;

/**
 * Stops the editor's Markdown reader from reading HTML, so a tag stays the
 * text it was typed as. Left on, it would turn `<b>` into bold and drop a
 * tag it doesn't know together with everything in it.
 *
 * @param editor - An editor with the Markdown extension.
 */
function turnHtmlOff(editor: Editor) {
  if (htmlIsOff || !editor.markdown) {
    return;
  }
  editor.markdown.instance.use({
    tokenizer: {
      /**
       * A block of HTML: never one.
       *
       * @returns Nothing, so the block is read as text.
       */
      html: () => undefined,
      /**
       * A tag inside a sentence: never one.
       *
       * @returns Nothing, so the tag is read as text.
       */
      tag: () => undefined,
    },
  });
  htmlIsOff = true;
}

/**
 * Puts a Markdown text in the editor, in place of what it holds. It's where
 * the editor starts from, not something its writer did: undoing never takes
 * it out again.
 *
 * @param editor - The editor.
 * @param markdown - The text.
 */
export function readMarkdown(editor: Editor, markdown: string) {
  turnHtmlOff(editor);
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(markdown, { contentType: 'markdown', emitUpdate: false })
    .run();
}

/**
 * The editor's content as Markdown.
 *
 * @param editor - The editor.
 * @returns The Markdown; nothing for an editor without text.
 */
export function writeMarkdown(editor: Editor): string {
  return editor.isEmpty ? '' : editor.getMarkdown().trim();
}

/**
 * Pastes plain text as the Markdown it is: formatted, at the cursor, joined
 * to the line it lands in. Text copied with its formatting, and anything
 * pasted into code, is left to the editor.
 *
 * @param editor - The editor.
 * @param event - The paste.
 * @returns Whether the paste was handled here.
 */
export function pasteMarkdown(editor: Editor, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const formatted = event.clipboardData?.getData('text/html') ?? '';
  if (!text || formatted || editor.isActive('codeBlock') || editor.isActive('code')) {
    return false;
  }
  if (!editor.markdown) {
    return false;
  }
  turnHtmlOff(editor);
  const pasted = editor.schema.nodeFromJSON(editor.markdown.parse(text));
  editor.view.dispatch(
    editor.state.tr.replaceSelection(Slice.maxOpen(pasted.content)).scrollIntoView(),
  );
  return true;
}

/** Pastes plain text as the Markdown it is ({@link pasteMarkdown}). */
const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  /**
   * The editor plugin that takes a paste.
   *
   * @returns The plugin.
   */
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          /**
           * Handles a paste.
           *
           * @param _view - The editor's view.
           * @param event - The paste.
           * @returns Whether it was handled here.
           */
          handlePaste: (_view, event) => pasteMarkdown(this.editor, event),
        },
      }),
    ];
  },
});

/**
 * Builds the editor's extensions: the formatting Markdown has (headings,
 * emphasis, lists, things to do, quotations, code that's highlighted, tables,
 * links), with the same classes as where a text is read, and Markdown as
 * what the content is read from and written to.
 *
 * @param labels - The texts the content needs.
 * @returns The extensions.
 */
export function editorExtensions(labels: EditorLabels): Extensions {
  return [
    StarterKit.configure({
      // These come in their own form below; Markdown has no underline.
      codeBlock: false,
      link: false,
      listItem: false,
      listKeymap: false,
      underline: false,
      heading: { HTMLAttributes: { class: markdownStyles.heading } },
      bulletList: { HTMLAttributes: { class: markdownStyles.bulletList } },
      orderedList: { HTMLAttributes: { class: markdownStyles.orderedList } },
      blockquote: { HTMLAttributes: { class: markdownStyles.quote } },
      code: { HTMLAttributes: { class: markdownStyles.inlineCode } },
      horizontalRule: { HTMLAttributes: { class: markdownStyles.rule } },
    }),
    editorCodeBlock(labels.code),
    EditorListItem.configure({ HTMLAttributes: { class: markdownStyles.listItem } }),
    EditorListKeymap,
    TaskList.configure({ HTMLAttributes: { class: markdownStyles.taskList } }),
    EditorTaskItem.configure({
      nested: true,
      HTMLAttributes: { class: markdownStyles.editorTaskItem },
      a11y: {
        /**
         * Names a task's checkbox.
         *
         * @param node - The task.
         * @param checked - Whether it's ticked.
         * @returns The checkbox's name.
         */
        checkboxLabel: (node, checked) => labels.task(node.textContent, checked),
      },
    }),
    TableKit.configure({ table: false }),
    EditorTable.configure({ HTMLAttributes: { class: markdownStyles.table } }),
    WrittenLink.configure({
      // A link in a text being written isn't followed; it's edited.
      openOnClick: false,
      autolink: true,
      /**
       * Whether an address may be a link.
       *
       * @param address - The address.
       * @returns Whether it's a whole `http` or `https` address.
       */
      isAllowedUri: (address) => linkTarget(address) !== null,
      /**
       * Whether an address that's typed becomes a link by itself.
       *
       * @param address - The address.
       * @returns Whether it's a whole `http` or `https` address.
       */
      shouldAutoLink: (address) => linkTarget(address) !== null,
      HTMLAttributes: { class: writtenLinkClasses, rel: 'noopener noreferrer nofollow' },
    }),
    WrittenImage.configure({ image: labels.image }),
    MarkdownPaste,
    // GitHub Flavored Markdown, with every line break kept: as the server reads it.
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

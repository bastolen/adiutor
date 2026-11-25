/**
 * @file What the editor knows of Markdown: the formatting it offers, how a
 * Markdown text becomes its content and back, and the rules that keep what
 * the editor shows in step with what the server renders (`MarkdownText`).
 *
 * - HTML is never read: a tag stays the text it was typed as.
 * - Only whole `http` and `https` addresses are links, and in a text the
 *   company reads never one of the staff's pages: such a link is its text.
 * - An image is kept as it was written and shown by its description; it's
 *   never loaded.
 * - A mention is the marker of someone picked from the list at "@": a link
 *   to their key, shown as their name. A marker of any other shape is the
 *   text of its link, as where a text is read.
 * - What's pasted with its formatting keeps its mentions and images: their
 *   elements carry what the editor reads them back from (a mention's key,
 *   an image's Markdown), in the editor and, for a mention, where a text is
 *   read. A mention's element is never a link, also when it links to the
 *   person's page.
 * - Tab and Shift+Tab are never taken: they leave the editor, like any field.
 */
import { Link, type LinkOptions } from '@tiptap/extension-link';
import { ListItem, ListKeymap, TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  type Editor,
  Extension,
  type Extensions,
  type KeyboardShortcutCommand,
  Node,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { exitSuggestion, Suggestion } from '@tiptap/suggestion';

import { defined } from '@/lib/defined';
import {
  isMentionKey,
  isStaffPage,
  linkTarget,
  textLinkTarget,
  writtenMentionKey,
  writtenMentionMarker,
} from '@/lib/requests';

import { writtenLinkClasses } from '../external-link';
import editorCodeBlock from './editor-code-block';
import type { MentionList } from './editor-mentions';
import type { MentionChoice } from './mentions';
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
 * The shortcuts of a list item or a thing to do: its own without Tab and
 * Shift+Tab, and nesting with Ctrl or Cmd and the square brackets instead,
 * since Tab is left to the browser.
 *
 * @param editor - The editor.
 * @param name - The item's node, e.g. `listItem`.
 * @param own - The item's own shortcuts.
 * @returns The shortcuts.
 */
function nestingShortcuts(
  editor: Editor,
  name: string,
  own: Record<string, KeyboardShortcutCommand>,
): Record<string, KeyboardShortcutCommand> {
  return {
    ...withoutTab(own),
    /**
     * Nests the item under the one above it.
     *
     * @returns Whether it did.
     */
    'Mod-]': () => editor.commands.sinkListItem(name),
    /**
     * Lifts the item out of the list it's nested in.
     *
     * @returns Whether it did.
     */
    'Mod-[': () => editor.commands.liftListItem(name),
  };
}

/** A list item, which nests with the square brackets ({@link nestingShortcuts}). */
const EditorListItem = ListItem.extend({
  /**
   * The item's shortcuts.
   *
   * @returns Its own without Tab, and the two for nesting.
   */
  addKeyboardShortcuts() {
    return nestingShortcuts(this.editor, this.name, this.parent?.() ?? {});
  },
});

/** A thing to do, with a checkbox. It nests like a list item. */
const EditorTaskItem = TaskItem.extend({
  /**
   * The task's shortcuts.
   *
   * @returns Its own without Tab, and the two for nesting.
   */
  addKeyboardShortcuts() {
    return nestingShortcuts(this.editor, this.name, this.parent?.() ?? {});
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

/** A part of a line as the Markdown reader hands it over: its text, and the parts inside it. */
interface InlineToken {
  /** The part's own text, with what was escaped as the character it stands for. */
  text?: string;
  /** The parts inside it, when it has any (emphasis, say). */
  tokens?: InlineToken[];
}

/**
 * The text of a link as it reads, without the formatting inside it.
 *
 * @param tokens - The link's parts.
 * @returns Their text.
 */
function plainText(tokens: readonly InlineToken[]): string {
  return tokens
    .map((token) => (token.tokens ? plainText(token.tokens) : (token.text ?? '')))
    .join('');
}

/** What a link in a text that's written may go to. */
interface WrittenLinkOptions extends LinkOptions {
  /**
   * Whether an address may be a link here.
   *
   * @param address - The address.
   * @returns Whether it may.
   */
  mayLink: (address: string) => boolean;
}

/**
 * A link. When Markdown is read or HTML is pasted, an address that may not
 * be a link here (`mayLink`: one that isn't a whole `http` or `https`
 * address, and in a text the company reads one of the staff's pages) gives
 * no link, only its text: what the server does too.
 * The marker of a mention is the exception: a link whose text starts with
 * "@" and whose address is someone's key becomes the mention of them
 * ({@link WrittenMention}).
 */
const WrittenLink = Link.extend<WrittenLinkOptions>({
  /**
   * The link's options.
   *
   * @returns The link's own, and links to whole `http` and `https` addresses, until told otherwise.
   */
  addOptions() {
    return {
      ...defined(this.parent, "the link's options")(),
      /**
       * Whether an address may be a link.
       *
       * @param address - The address.
       * @returns Whether it's a whole `http` or `https` address.
       */
      mayLink: (address: string) => linkTarget(address) !== null,
    };
  },
  /**
   * Which elements of pasted HTML are links: an `<a>` whose address may be
   * a link here, as when Markdown is read. A mention's element never is,
   * though for the staff it links to the person's page (which a browser
   * copies as a whole address): it's the mention ({@link WrittenMention}),
   * or else its text.
   *
   * @returns The rule.
   */
  parseHTML() {
    const { mayLink } = this.options;
    return [
      {
        tag: 'a[href]:not([data-mention])',
        /**
         * Takes the element when its address may be a link.
         *
         * @param element - The `<a>`.
         * @returns Nothing to add (the address is read by the link's attribute), or `false`.
         */
        getAttrs: (element) => (mayLink(element.getAttribute('href') ?? '') ? null : false),
      },
    ];
  },
  /**
   * Reads a link from Markdown.
   *
   * @param token - The parser's link.
   * @param helpers - The Markdown reader's helpers.
   * @returns A mention, or the link's text, linked when its address may be.
   */
  parseMarkdown(token, helpers) {
    const address = typeof token.href === 'string' ? token.href : '';
    const key = writtenMentionKey(address);
    const label = plainText(token.tokens ?? []);
    if (key !== null && label.startsWith('@')) {
      return { type: 'writtenMention', attrs: { key, name: label.slice(1) } };
    }
    const text = helpers.parseInline(token.tokens ?? []);
    return this.options.mayLink(address)
      ? helpers.applyMark('link', text, { href: address })
      : text;
  },
});

/**
 * Reads a mention from its element in pasted HTML: one this editor wrote,
 * or one where a text is read for someone who may write in the request
 * (`MarkdownMention`). Both carry the person's key (`data-mention-key`) and
 * show their name after an "@".
 *
 * @param element - The element.
 * @returns The mention's key and name, or `false` when the element isn't a
 *   mention (no key of the right shape, or no name after an "@").
 */
function pastedMention(element: HTMLElement): { key: string; name: string } | false {
  const key = element.getAttribute('data-mention-key') ?? '';
  const shown = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!isMentionKey(key) || !shown.startsWith('@') || shown.length < 2) {
    return false;
  }
  return { key, name: shown.slice(1) };
}

/**
 * A mention of someone, picked from the list at "@": their name after an
 * "@", as one piece that's deleted as a whole. In Markdown it's the marker
 * the server takes for a mention (`writtenMentionMarker`): the name, linked
 * to the key that stands for the person. It's read back from that marker by
 * {@link WrittenLink}, so a text that was kept still shows its mentions, and
 * from its element with the key when it's pasted ({@link pastedMention}).
 * Who the writer may mention is still settled when the text is sent.
 */
const WrittenMention = Node.create({
  name: 'writtenMention',
  group: 'inline',
  inline: true,
  atom: true,
  /**
   * What the node remembers.
   *
   * @returns The person's key, and their name as the list showed it.
   */
  addAttributes() {
    return { key: { default: '' }, name: { default: '' } };
  },
  /**
   * Which elements of pasted HTML are mentions.
   *
   * @returns The rule: an element marked as a mention, with a key.
   */
  parseHTML() {
    return [{ tag: '[data-mention][data-mention-key]', getAttrs: pastedMention }];
  },
  /**
   * How the node looks in the editor, and what's copied of it.
   *
   * @param props - What's rendered.
   * @param props.node - The mention.
   * @returns A span with the name after an "@", as where a text is read, and
   *   the person's key, which a paste reads the mention back from.
   */
  renderHTML({ node }) {
    return [
      'span',
      {
        class: markdownStyles.mention,
        'data-mention': '',
        'data-mention-key': String(node.attrs.key),
      },
      `@${String(node.attrs.name)}`,
    ];
  },
  /**
   * What the node is as plain text.
   *
   * @param props - What's rendered.
   * @param props.node - The mention.
   * @returns The name after an "@".
   */
  renderText({ node }) {
    return `@${String(node.attrs.name)}`;
  },
  /**
   * Writes the mention as Markdown.
   *
   * @param node - The node.
   * @returns Its marker.
   */
  renderMarkdown: (node) =>
    writtenMentionMarker(String(node.attrs?.name ?? ''), String(node.attrs?.key ?? '')),
});

/** The name of the plugin that follows what's typed after an "@". */
const MENTION_TRIGGER = new PluginKey('mentionTrigger');

/**
 * Opens the list of people while a name is typed after an "@" (at the start
 * of a line or after a space, so an email address opens nothing; the name
 * may have spaces), and puts
 * the mention of whoever is picked in its place, with a space after it. Not
 * in code, where an "@" is code. The list itself, and what the keys do in
 * it, is the {@link MentionList}'s; Escape and a click elsewhere close it.
 * Without a list the extension does nothing.
 */
const MentionTrigger = Extension.create<{ list: MentionList | null }>({
  name: 'mentionTrigger',
  /**
   * The extension's options.
   *
   * @returns No list, until one is given.
   */
  addOptions() {
    return { list: null };
  },
  /**
   * The plugin that follows what's typed.
   *
   * @returns The plugin, or none without a list.
   */
  addProseMirrorPlugins() {
    const { list } = this.options;
    if (list === null) {
      return [];
    }
    const { editor } = this;
    return [
      Suggestion<MentionChoice, MentionChoice>({
        editor,
        pluginKey: MENTION_TRIGGER,
        char: '@',
        // A name has spaces. The list closes itself once what's typed can't be a name any more.
        allowSpaces: true,
        /**
         * Whether a name can be typed here: not in code.
         *
         * @param props - Where the "@" is.
         * @param props.state - The editor's state.
         * @param props.range - The place of the "@" and what follows it.
         * @returns Whether the list may open.
         */
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const inCode = $from.marks().some((mark) => mark.type.spec.code);
          return !$from.parent.type.spec.code && !inCode;
        },
        /**
         * Puts the mention in place of what was typed.
         *
         * @param props - What was picked, and where.
         * @param props.range - The place of the "@" and what follows it.
         * @param props.props - Who was picked.
         */
        command: ({ range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'writtenMention', attrs: { key: props.key, name: props.name } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        /**
         * Passes what's typed on to the list.
         *
         * @returns What to do as the typing starts, goes on and ends, and with a key.
         */
        render: () => {
          /**
           * Tells the list what's typed now.
           *
           * @param props - The trigger's state.
           * @param props.query - What's typed after the "@".
           * @param props.clientRect - Measures where that is.
           * @param props.command - Puts a mention in its place.
           */
          const show = ({
            query,
            clientRect,
            command,
          }: {
            query: string;
            clientRect?: (() => DOMRect | null) | null;
            command: (choice: MentionChoice) => void;
          }) => {
            list.show({
              query,
              /**
               * Measures where the name is typed.
               *
               * @returns Its box, or `null` when it can't be measured.
               */
              rect: () => clientRect?.() ?? null,
              pick: command,
              /** Closes the list; what was typed stays text. */
              close: () => {
                exitSuggestion(editor.view, MENTION_TRIGGER);
              },
            });
          };
          return {
            onStart: show,
            onUpdate: show,
            /** The typing ended: with a mention, or because the cursor left. */
            onExit: () => {
              list.hide();
            },
            /**
             * Lets the list have a key first.
             *
             * @param props - The key press.
             * @param props.event - The key.
             * @returns Whether the list took it.
             */
            onKeyDown: ({ event }) => list.keyDown(event),
          };
        },
      }),
    ];
  },
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
 * Reads an image from its element in pasted HTML, which this editor wrote:
 * the Markdown it was written as (`data-markdown`), read as Markdown is. It
 * counts only when that's one image and nothing else, so a paste can't turn
 * into anything a writer couldn't have typed.
 *
 * @param editor - The editor, whose Markdown reader reads it; none while there's no editor.
 * @param element - The element.
 * @returns The image's Markdown and description, or `false` when it isn't one image.
 */
function pastedImage(
  editor: Editor | undefined,
  element: HTMLElement,
): { raw: string; description: string } | false {
  const written = element.getAttribute('data-markdown') ?? '';
  if (!editor?.markdown || !written || written.includes('\n')) {
    return false;
  }
  turnHtmlOff(editor);
  // A lone image is read as the text's only node, anything more inside a paragraph.
  const read = editor.markdown.parse(written).content ?? [];
  const [first] = read;
  const [image, ...rest] =
    read.length === 1 && first?.type === 'paragraph' ? (first.content ?? []) : read;
  if (image?.type !== 'writtenImage' || rest.length > 0) {
    return false;
  }
  return {
    raw: String(image.attrs?.raw ?? ''),
    description: String(image.attrs?.description ?? ''),
  };
}

/**
 * An image someone wrote (`![description](address)`). The editor keeps the
 * Markdown as it was written and shows the image by its description, as a
 * word that can't be edited in place: it's never loaded, here or where the
 * text is read. Copied and pasted, it's read back from that Markdown. An
 * image of one of the staff's pages, in a text the company reads
 * (`toStaffPage`), is its description as text, as when the text is saved.
 */
const WrittenImage = Node.create<
  Pick<EditorLabels, 'image'> & {
    /**
     * Whether an image's address is one of the staff's pages in a text the company reads.
     *
     * @param address - The image's address.
     * @returns Whether the image is to be its description instead.
     */
    toStaffPage: (address: string) => boolean;
  }
>({
  name: 'writtenImage',
  group: 'inline',
  inline: true,
  atom: true,
  /**
   * The node's options.
   *
   * @returns A label that shows the description as it is, and no address of a staff page, until
   *   they're given.
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
      /**
       * Whether an image's address is one of the staff's pages.
       *
       * @returns Never, until told.
       */
      toStaffPage: () => false,
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
   * Which elements of pasted HTML are images: one this editor wrote, with
   * the Markdown it was written as ({@link pastedImage}).
   *
   * @returns The rule.
   */
  parseHTML() {
    const { editor } = this;
    return [
      {
        tag: 'span[data-written-image][data-markdown]',
        /**
         * Reads the image back from its Markdown.
         *
         * @param element - The span.
         * @returns The image's attributes, or `false` when it isn't one image.
         */
        getAttrs: (element) => pastedImage(editor, element),
      },
    ];
  },
  /**
   * How the node looks in the editor, and what's copied of it.
   *
   * @param props - What's rendered.
   * @param props.node - The image.
   * @returns A span with the image's label, and the Markdown it was written
   *   as, which a paste reads the image back from.
   */
  renderHTML({ node }) {
    return [
      'span',
      {
        class: writtenLinkClasses,
        'data-written-image': '',
        'data-markdown': String(node.attrs.raw),
      },
      this.options.image(String(node.attrs.description)),
    ];
  },
  markdownTokenName: 'image',
  /**
   * Reads an image from Markdown.
   *
   * @param token - The parser's image.
   * @returns The node; for an image of a staff page, its description as text (nothing without one).
   */
  parseMarkdown(token) {
    const description = token.text ?? '';
    if (this.options.toStaffPage(typeof token.href === 'string' ? token.href : '')) {
      return description ? { type: 'text', text: description } : [];
    }
    return { type: 'writtenImage', attrs: { raw: token.raw ?? '', description } };
  },
  /**
   * Writes the image back as Markdown.
   *
   * @param node - The node.
   * @returns The Markdown it was written as.
   */
  renderMarkdown: (node) => String(node.attrs?.raw ?? ''),
});

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

/** The elements of a text whose look is their own, not formatting: mentions and images. */
const OWN_LOOKS = '[data-mention], [data-written-image]';

/** The elements a text is shown with in a weight of their own: headings and header cells. */
const OWN_WEIGHTS = 'h1, h2, h3, h4, h5, h6, th';

/**
 * A block of code as it's shown where a text is read: its caption and Copy
 * button around the code (`MarkdownCodeBlock` in `elements.tsx`).
 */
const CODE_FIGURE = 'figure[data-code-figure]';

/** Whether pasted HTML may hold anything {@link withoutOwnLooks} takes off. */
const MAY_HOLD_OWN_LOOKS = /data-mention|data-written-image|data-code-figure|<(?:h[1-6]|th)[\s>]/i;

/**
 * Takes off what the elements of pasted HTML look like by themselves, which
 * isn't formatting anyone gave the text. A browser copies every element with
 * the styles it was shown in, and the editor reads some styles as formatting
 * (a weight from 500 up as bold, which is how Google Docs copies bold):
 *
 * - a mention or an image loses its styles, or a mention copied from where a
 *   text is read would come in bold;
 * - a heading or a table's header cell loses its weight, or its text would
 *   come in bold (`### **Steps**`); its other styles stay, for the editor's
 *   rules to ignore;
 * - a block of code copied from where a text is read is its code alone, or
 *   its caption (the language's name) would paste as a paragraph above it.
 *   The code keeps its language, which the editor reads from its
 *   `language-*` class. Another site's figure keeps its caption, which is
 *   part of what it says.
 *
 * Bold someone gave the text (`<strong>`, `<b>`, or a weight on a `<span>`)
 * stays. Read in a template, where nothing runs or loads, and which keeps
 * table cells and rows that come without their table.
 *
 * @param html - The pasted HTML.
 * @returns The HTML, without those looks.
 */
export function withoutOwnLooks(html: string): string {
  if (!MAY_HOLD_OWN_LOOKS.test(html)) {
    return html;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const { content } = template;
  content.querySelectorAll(OWN_LOOKS).forEach((element) => {
    element.removeAttribute('style');
  });
  content.querySelectorAll<HTMLElement>(OWN_WEIGHTS).forEach((element) => {
    element.style.removeProperty('font-weight');
    if (element.style.length === 0) {
      element.removeAttribute('style');
    }
  });
  content.querySelectorAll(CODE_FIGURE).forEach((figure) => {
    // Its caption alone (a selection that ended before the code) isn't part of the text either.
    const code = figure.querySelector('pre');
    if (code) {
      figure.replaceWith(code);
    } else {
      figure.remove();
    }
  });
  return template.innerHTML;
}

/**
 * Pastes plain text as the Markdown it is ({@link pasteMarkdown}), and
 * takes what elements look like by themselves off pasted HTML ({@link withoutOwnLooks}).
 */
const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  transformPastedHTML: withoutOwnLooks,
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
 * In a text the company reads (`appUrl` given), a link to one of the
 * staff's pages is kept as its text, however it comes in: pasted with its
 * formatting or as Markdown, typed, or pasted over a selection; an image of
 * one is its description. Only a text the staff alone read (an internal
 * note) may link to them, as where the text is saved
 * (`withoutStaffPageLinks`) and shown (`textLinkTarget`).
 *
 * @param labels - The texts the content needs.
 * @param mentions - The list of people at "@", for a text that can mention people.
 * @param appUrl - Adiutor's own address (the page's), for a text the company reads; `null` for a
 *   text only the staff read.
 * @returns The extensions.
 */
export function editorExtensions(
  labels: EditorLabels,
  mentions: MentionList | null = null,
  appUrl: string | null = null,
): Extensions {
  /**
   * Whether an address may be a link in this text.
   *
   * @param address - The address.
   * @returns Whether it's a whole `http` or `https` address, and not a page for the staff in a
   *   text the company reads.
   */
  const mayLink = (address: string) => textLinkTarget(address, appUrl) !== null;
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
      // One rule for every way an address can become a link: a link that's set, what's pasted or
      // typed, and an address typed or pasted over a selection that becomes one by itself.
      mayLink,
      isAllowedUri: mayLink,
      shouldAutoLink: mayLink,
      HTMLAttributes: { class: writtenLinkClasses, rel: 'noopener noreferrer nofollow' },
    }),
    WrittenImage.configure({
      image: labels.image,
      /**
       * Whether an image's address is one of the staff's pages, in a text the company reads.
       *
       * @param address - The image's address.
       * @returns Whether the image is to be its description.
       */
      toStaffPage: (address) => appUrl !== null && isStaffPage(address, appUrl),
    }),
    WrittenMention,
    MentionTrigger.configure({ list: mentions }),
    MarkdownPaste,
    // GitHub Flavored Markdown, with every line break kept: as the server reads it.
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

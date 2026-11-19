/**
 * @file What the formatting toolbar and the editor tell each other: what's
 * on at the cursor ({@link formattingOf}), and what a pressed button does to
 * the text ({@link format}).
 */
import type { Editor } from '@tiptap/react';

import type { FormattingCommand, FormattingState } from './formatting-toolbar';

/** The kinds of list item: of a list, and of a list of things to do. */
const LIST_ITEMS = ['listItem', 'taskItem'];

/** The heading levels the toolbar can set. */
const HEADING_LEVELS = [1, 2, 3] as const;

/**
 * Reads what's on where the cursor is.
 *
 * @param editor - The editor.
 * @returns What the toolbar's buttons show.
 */
export function formattingOf(editor: Editor): FormattingState {
  const address: unknown = editor.getAttributes('link').href;
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    link: typeof address === 'string' ? address : null,
    heading: editor.isActive('heading') ? Number(editor.getAttributes('heading').level) : 0,
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    quote: editor.isActive('blockquote'),
    codeBlock: editor.isActive('codeBlock'),
    canNest: LIST_ITEMS.some((item) => editor.can().sinkListItem(item)),
    canLift: LIST_ITEMS.some((item) => editor.can().liftListItem(item)),
  };
}

/**
 * Links the selected text to an address. Without a selection the address
 * itself is added as a link; inside a link, the whole link gets the address.
 *
 * @param editor - The editor.
 * @param address - The address, or `null` to remove the link at the cursor.
 */
function link(editor: Editor, address: string | null) {
  const chain = editor.chain().focus();
  if (address === null) {
    chain.extendMarkRange('link').unsetLink().run();
  } else if (editor.state.selection.empty && !editor.isActive('link')) {
    chain
      .insertContent({
        type: 'text',
        text: address,
        marks: [{ type: 'link', attrs: { href: address } }],
      })
      .run();
  } else {
    chain.extendMarkRange('link').setLink({ href: address }).run();
  }
}

/**
 * Does to the text what a button of the toolbar asks, and gives the editor
 * the focus back, with the selection it had.
 *
 * @param editor - The editor.
 * @param command - What was asked.
 */
export function format(editor: Editor, command: FormattingCommand) {
  const chain = editor.chain().focus();
  switch (command.type) {
    case 'bold':
      chain.toggleBold().run();
      break;
    case 'italic':
      chain.toggleItalic().run();
      break;
    case 'strike':
      chain.toggleStrike().run();
      break;
    case 'code':
      chain.toggleCode().run();
      break;
    case 'bulletList':
      chain.toggleBulletList().run();
      break;
    case 'orderedList':
      chain.toggleOrderedList().run();
      break;
    case 'taskList':
      chain.toggleTaskList().run();
      break;
    case 'quote':
      chain.toggleBlockquote().run();
      break;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      break;
    case 'nest':
      LIST_ITEMS.some((item) => editor.chain().focus().sinkListItem(item).run());
      break;
    case 'lift':
      LIST_ITEMS.some((item) => editor.chain().focus().liftListItem(item).run());
      break;
    case 'heading': {
      const level = HEADING_LEVELS.find((offered) => offered === command.level);
      if (level) {
        chain.setHeading({ level }).run();
      } else {
        chain.setParagraph().run();
      }
      break;
    }
    default:
      link(editor, command.address);
  }
}

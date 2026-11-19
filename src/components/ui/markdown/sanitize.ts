/**
 * @file What a Markdown text may become: the elements, attributes and
 * addresses allowed in its tree. The parser never reads HTML (see
 * `tree.ts`), so everything in the tree already comes from Markdown itself;
 * this list is the second check, and it keeps a later change to the parser
 * or its plugins from letting something else through.
 */
import type { Options as Schema } from 'rehype-sanitize';

/** The headings a text can have. The footnotes' label is one of them. */
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * The allow-list for a Markdown text's tree.
 *
 * - **Elements:** what Markdown and GitHub Flavored Markdown produce, nothing else.
 * - **Attributes:** an address on a link and an image, the language of a code
 *   block, a list's start, a cell's alignment, the checkbox of a task, and
 *   what footnotes need to point at each other.
 * - **Addresses:** `http` and `https` only. One without a scheme passes here
 *   and is refused where links are rendered (`linkTarget`).
 * - **IDs** are left as they are (`clobber`): only footnotes have them, and
 *   each text gives its own a prefix.
 */
const SANITIZE_SCHEMA: Schema = {
  clobber: [],
  tagNames: [
    ...HEADINGS,
    'p',
    'br',
    'strong',
    'em',
    'del',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'code',
    'pre',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
    'input',
    'sup',
    'section',
  ],
  attributes: {
    a: [
      'href',
      'id',
      'ariaDescribedBy',
      'ariaLabel',
      'dataFootnoteRef',
      'dataFootnoteBackref',
      ['className', 'data-footnote-backref'],
    ],
    img: ['src', 'alt'],
    code: [['className', /^language-./]],
    ul: [['className', 'contains-task-list']],
    ol: ['start', ['className', 'contains-task-list']],
    li: ['id', ['className', 'task-list-item']],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    th: ['align'],
    td: ['align'],
    section: ['dataFootnotes', ['className', 'footnotes']],
    ...Object.fromEntries(HEADINGS.map((heading) => [heading, ['id', ['className', 'sr-only']]])),
  },
  protocols: { href: ['http', 'https'], src: ['http', 'https'] },
  required: { input: { disabled: true, type: 'checkbox' } },
};

export default SANITIZE_SCHEMA;

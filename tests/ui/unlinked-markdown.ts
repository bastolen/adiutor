/**
 * @file The Markdown that must never become a link, shared by the tests of
 * the server's renderer and of the editor, so both are held to the same
 * cases (the editor must stay in step with the server's rules).
 */

/** One text that links nothing: what it is, the Markdown and the words that stay visible. */
export type UnlinkedCase = readonly [what: string, markdown: string, shown: string];

/** Texts that make no link, with the words a reader still sees. */
const UNLINKED_CASES: readonly UnlinkedCase[] = [
  ['a script address', '[click](javascript:alert(1))', 'click'],
  ['a script address in capitals', '[click](JaVaScRiPt:alert(1))', 'click'],
  ['a script address written with an entity', '[click](&#106;avascript:alert(1))', 'click'],
  // eslint-disable-next-line no-script-url -- the text a reader still sees of a refused script address
  ['a script address between angle brackets', '<javascript:alert(1)>', 'javascript:alert(1)'],
  [
    'a script address defined below the text',
    '[click][later]\n\n[later]: javascript:alert(1)',
    'click',
  ],
  ['a data address', '[click](data:text/html,<script>alert(1)</script>)', 'click'],
  ['a vbscript address', '[click](vbscript:msgbox(1))', 'click'],
  ['a page of Adiutor itself', '[click](/admin/settings/staff)', 'click'],
  ['an address without a scheme', '[click](//adiutor.dev/docs)', 'click'],
  ['an email address behind a text', '[click](mailto:user@adiutor.dev)', 'click'],
  ['an email address', 'Write to user@adiutor.dev today', 'user@adiutor.dev'],
];

export default UNLINKED_CASES;

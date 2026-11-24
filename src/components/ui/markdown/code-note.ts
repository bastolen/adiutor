/**
 * @file The note above copied code: where a block of code came from, written
 * as a comment in the block's language, so the code can still be traced once
 * it sits in a file or a terminal. Code that can't hold a comment is copied
 * as it is: a note must never break what's pasted.
 */
import { codeLanguageId } from './languages';

/** How a language writes a comment on a line of its own. */
interface CommentSigns {
  /** What the comment starts with. */
  open: string;
  /** What ends it, for a language without comments that run to the end of the line. */
  close?: string;
  /** What a comment that's closed may not hold: it would end the comment early, or isn't allowed in it. */
  never?: string;
}

/** A comment from `#` to the end of the line. */
const HASH: CommentSigns = { open: '#' };

/** A comment from `//` to the end of the line. */
const SLASHES: CommentSigns = { open: '//' };

/** A comment from `--` to the end of the line. */
const DASHES: CommentSigns = { open: '--' };

/** A comment between a slash-star and a star-slash. */
const STARS: CommentSigns = { open: '/*', close: '*/', never: '*/' };

/** A comment in markup, which may not hold two dashes in a row. */
const MARKUP: CommentSigns = { open: '<!--', close: '-->', never: '--' };

/**
 * How each language writes a comment, by its key in `CODE_LANGUAGES`; `null`
 * for one that gets no note, because it has no comments (JSON, plain text,
 * an HTTP message, a diff), because a comment could end up shown or printed
 * (Markdown with front matter, PHP outside `<?php`), or because it's a
 * transcript, where `#` reads as a prompt (a shell or Python session). Every
 * language is listed, so a new one gets a choice (the tests check that).
 */
export const COMMENT_SIGNS: Record<string, CommentSigns | null> = {
  apache: HASH,
  arduino: SLASHES,
  bash: HASH,
  c: SLASHES,
  cpp: SLASHES,
  csharp: SLASHES,
  css: STARS,
  diff: null,
  dockerfile: HASH,
  go: SLASHES,
  graphql: HASH,
  http: null,
  ini: { open: ';' },
  java: SLASHES,
  javascript: SLASHES,
  json: null,
  kotlin: SLASHES,
  less: SLASHES,
  lua: DASHES,
  makefile: HASH,
  markdown: null,
  nginx: HASH,
  objectivec: SLASHES,
  perl: HASH,
  php: null,
  'php-template': null,
  plaintext: null,
  powershell: HASH,
  properties: HASH,
  python: HASH,
  'python-repl': null,
  r: HASH,
  ruby: HASH,
  rust: SLASHES,
  scss: SLASHES,
  shell: null,
  sql: DASHES,
  swift: SLASHES,
  typescript: SLASHES,
  vbnet: { open: "'" },
  wasm: { open: ';;' },
  xml: MARKUP,
  yaml: HASH,
};

/**
 * The names a block can be written with that differ from the language
 * they're highlighted as: TOML is highlighted as INI but comments with `#`,
 * JSON with comments has them, and a JSP page or a Ruby session isn't a file
 * of Java or Ruby.
 */
const WRITTEN_AS: Record<string, CommentSigns | null> = {
  toml: HASH,
  jsonc: SLASHES,
  json5: SLASHES,
  jsp: null,
  irb: null,
};

/**
 * A first line that has to stay the first: a `#!` line, an XML declaration,
 * a doctype, and the directives at the top of a Dockerfile. The note goes
 * below such lines.
 */
const STAYS_FIRST = /^(?:#!|<\?xml\b|<!doctype\b|#\s*(?:syntax|escape|check)\s*=)/i;

/** Every kind of line break, which would end a comment that runs to the end of its line. */
const LINE_BREAKS = /[\n\v\f\r\u0085\u2028\u2029]+/g;

/**
 * What a line of the note may never hold, whatever the language, because
 * some language reads it before or outside its comments, and what follows it
 * could then leave the comment:
 * - a backslash: Java turns `\u000a` and `\u000d` (also written `\uu000a`)
 *   into a line end before it reads anything else, and C, C++ and Makefiles
 *   join a line that ends in one to the next;
 * - `??/`, which C before C23 and C++ before C++17 read as a backslash (a
 *   trigraph);
 * - an encoding declaration (`coding:` or `coding=`), which Python and Ruby
 *   read from a comment on a file's first two lines, where the note goes: in
 *   UTF-7, `+AAo-` is a line break.
 */
const READ_OUTSIDE_COMMENTS = /\\|\?\?\/|coding[:=]/i;

/**
 * How a block's language writes a comment.
 *
 * @param language - The language as the block names it, or `null` for none.
 * @returns Its comment signs, or `null` when the block gets no note.
 */
function commentSigns(language: string | null): CommentSigns | null {
  if (language === null) {
    return null;
  }
  const written = language.toLowerCase();
  if (Object.hasOwn(WRITTEN_AS, written)) {
    return WRITTEN_AS[written] ?? null;
  }
  const id = codeLanguageId(written);
  return id !== null && Object.hasOwn(COMMENT_SIGNS, id) ? (COMMENT_SIGNS[id] ?? null) : null;
}

/**
 * Puts a note above a block's code, as a comment in the block's language:
 * one comment per line of the note. The code comes back as it is, without
 * the note, when its language has no comments or isn't one we know, when
 * there's nothing to say, and when a line of the note holds what would end
 * the comment it's in (a name with a star-slash in it, say): what someone typed as
 * their name must never become code in what a reader pastes. For the same
 * reason every line of the note stays one line, and a line that holds what a
 * language reads before or outside its comments ({@link READ_OUTSIDE_COMMENTS}:
 * a backslash, say) is left out, in every language. Lines that have to stay
 * first ({@link STAYS_FIRST}) keep their place, with the note below them.
 *
 * @param code - The code, as it was written.
 * @param language - The language the block names, or `null` for none.
 * @param note - The note's lines, e.g. where the code came from and who wrote it.
 * @returns The code to copy.
 */
export default function withCodeNote(
  code: string,
  language: string | null,
  note: readonly string[],
): string {
  const signs = commentSigns(language);
  const lines = note
    .map((line) => line.replace(LINE_BREAKS, ' ').trim())
    .filter((line) => line !== '' && !READ_OUTSIDE_COMMENTS.test(line));
  if (signs === null || lines.length === 0) {
    return code;
  }
  const { open, close, never } = signs;
  if (never !== undefined && lines.some((line) => line.includes(never))) {
    return code;
  }
  const comments = lines.map((line) =>
    close === undefined ? `${open} ${line}` : `${open} ${line} ${close}`,
  );
  const written = code.split('\n');
  let first = 0;
  while (first < written.length && STAYS_FIRST.test(written[first] ?? '')) {
    first += 1;
  }
  return [...written.slice(0, first), ...comments, ...written.slice(first)].join('\n');
}

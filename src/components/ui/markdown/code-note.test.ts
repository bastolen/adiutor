/**
 * @file Tests for the note above copied code: it's a comment in the block's
 * language, never breaks what's pasted, and nothing in it becomes code.
 */
import { describe, expect, it } from 'vitest';

import withCodeNote, { COMMENT_SIGNS } from './code-note';
import { CODE_LANGUAGES } from './languages';

/** A note as a request gives it: where the code is from, and who wrote it. */
const NOTE = ['Source: https://adiutor.test/requests/11', 'Written by Sam Support on Nov 18, 2026'];

describe('withCodeNote', () => {
  it.each([
    ['bash', '#'],
    ['python', '#'],
    ['yaml', '#'],
    ['dockerfile', '#'],
    ['nginx', '#'],
    ['powershell', '#'],
    ['typescript', '//'],
    ['go', '//'],
    ['csharp', '//'],
    ['scss', '//'],
    ['sql', '--'],
    ['lua', '--'],
    ['ini', ';'],
    ['vbnet', "'"],
    ['wasm', ';;'],
  ])('writes the note above %s code as lines that start with %s', (language, sign) => {
    expect(withCodeNote('the code', language, NOTE)).toBe(
      `${sign} Source: https://adiutor.test/requests/11\n${sign} Written by Sam Support on Nov 18, 2026\nthe code`,
    );
  });

  it('closes each line of the note where the language has no comment to the end of a line', () => {
    expect(withCodeNote('a { color: red; }', 'css', NOTE)).toBe(
      '/* Source: https://adiutor.test/requests/11 */\n/* Written by Sam Support on Nov 18, 2026 */\na { color: red; }',
    );
    expect(withCodeNote('<p>Hello</p>', 'html', NOTE)).toBe(
      '<!-- Source: https://adiutor.test/requests/11 -->\n<!-- Written by Sam Support on Nov 18, 2026 -->\n<p>Hello</p>',
    );
  });

  it.each([
    ['sh', '# '],
    ['ZSH', '# '],
    ['ts', '// '],
    ['yml', '# '],
    ['svg', '<!-- '],
    ['ps1', '# '],
  ])('knows %s by the language it stands for', (language, start) => {
    expect(withCodeNote('the code', language, NOTE).startsWith(`${start}Source: `)).toBe(true);
  });

  it('follows the name a block was written with where that says more than its language', () => {
    // TOML is coloured as INI, which comments with a semicolon TOML doesn't know.
    expect(withCodeNote('a = 1', 'toml', ['From a request'])).toBe('# From a request\na = 1');
    // JSON has no comments; JSON with comments does.
    expect(withCodeNote('{}', 'jsonc', ['From a request'])).toBe('// From a request\n{}');
    expect(withCodeNote('{}', 'json5', ['From a request'])).toBe('// From a request\n{}');
  });

  it.each([
    ['JSON', 'json'],
    ['plain text', 'plaintext'],
    ['plain text by its alias', 'txt'],
    ['Markdown', 'md'],
    ['a diff', 'diff'],
    ['an HTTP message', 'http'],
    ['PHP', 'php'],
    ['a shell session', 'console'],
    ['a Python session', 'pycon'],
    ['a Ruby session', 'irb'],
    ['a JSP page', 'jsp'],
    ['a language we don’t know', 'mermaid'],
    ['a name that is a property of every object', 'constructor'],
    ['no language', null],
  ])('copies %s without the note', (_what, language) => {
    expect(withCodeNote('the code', language, NOTE)).toBe('the code');
  });

  it('copies the code alone when there is nothing to say', () => {
    expect(withCodeNote('npm test', 'bash', [])).toBe('npm test');
    expect(withCodeNote('npm test', 'bash', ['', '  '])).toBe('npm test');
  });

  it.each([
    ['a #! line', 'bash', '#!/bin/sh\nset -e\nnpm test', '#!/bin/sh\n# Note\nset -e\nnpm test'],
    [
      'a #! line in a language that comments differently',
      'js',
      '#!/usr/bin/env node\nrun();',
      '#!/usr/bin/env node\n// Note\nrun();',
    ],
    [
      'an XML declaration',
      'xml',
      '<?xml version="1.0"?>\n<root/>',
      '<?xml version="1.0"?>\n<!-- Note -->\n<root/>',
    ],
    [
      'a doctype',
      'html',
      '<!DOCTYPE html>\n<html></html>',
      '<!DOCTYPE html>\n<!-- Note -->\n<html></html>',
    ],
    [
      'a Dockerfile’s directives',
      'dockerfile',
      '# syntax=docker/dockerfile:1\n# escape=`\nFROM node:24',
      '# syntax=docker/dockerfile:1\n# escape=`\n# Note\nFROM node:24',
    ],
    ['only such a line', 'bash', '#!/bin/sh', '#!/bin/sh\n# Note'],
  ])('leaves %s first, with the note below it', (_what, language, code, copied) => {
    expect(withCodeNote(code, language, ['Note'])).toBe(copied);
  });

  it('keeps the code as it was written, also its empty lines and the spaces at its start', () => {
    const code = '  indented:\n\n    - one\n';
    expect(withCodeNote(code, 'yaml', ['Note'])).toBe(`# Note\n${code}`);
  });

  it.each([
    ['a line break', 'Written by Sam\nrm -rf ~'],
    ['a Windows line break', 'Written by Sam\r\nrm -rf ~'],
    ['a line separator', 'Written by Sam\u2028rm -rf ~'],
    ['a paragraph separator', 'Written by Sam\u2029rm -rf ~'],
    ['a next-line character', 'Written by Sam\u0085rm -rf ~'],
    ['a form feed', 'Written by Sam\frm -rf ~'],
  ])('keeps a name with %s in it on its one line of comment', (_what, line) => {
    expect(withCodeNote('npm test', 'bash', [line])).toBe('# Written by Sam rm -rf ~\nnpm test');
  });

  it('copies the code alone when a name would end the comment it’s in', () => {
    expect(withCodeNote('a {}', 'css', ['Written by */ body { display: none } /*'])).toBe('a {}');
    expect(
      withCodeNote('<p>Hello</p>', 'html', ['Written by --><script>alert(1)</script><!--']),
    ).toBe('<p>Hello</p>');
    // Two dashes in a row aren't allowed in a comment in XML at all.
    expect(withCodeNote('<root/>', 'xml', ['Written by Sam -- Support'])).toBe('<root/>');
    // In a comment that runs to the end of its line, the same name is only text.
    expect(withCodeNote('a = 1', 'python', ['Written by */ and -->'])).toBe(
      '# Written by */ and -->\na = 1',
    );
  });

  it('has a choice for every language code is highlighted in', () => {
    expect(Object.keys(COMMENT_SIGNS).sort()).toEqual(Object.keys(CODE_LANGUAGES).sort());
  });
});

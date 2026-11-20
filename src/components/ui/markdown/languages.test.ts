/**
 * @file Tests for the languages code is highlighted in and what they're called.
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES, codeLanguageId, codeLanguageName } from './languages';

describe('codeLanguageName', () => {
  it.each([
    ['typescript', 'TypeScript'],
    ['ts', 'TypeScript'],
    ['TS', 'TypeScript'],
    ['js', 'JavaScript'],
    ['py', 'Python'],
    ['sh', 'Bash'],
    ['sql', 'SQL'],
    ['yml', 'YAML'],
    ['nginx', 'Nginx config'],
    ['ps1', 'PowerShell'],
  ])('calls %s %s', (language, name) => {
    expect(codeLanguageName(language)).toBe(name);
  });

  it('has no name for a language that isn’t highlighted', () => {
    expect(codeLanguageName('mermaid')).toBeNull();
    expect(codeLanguageName('')).toBeNull();
  });

  it('names every language in the list', () => {
    Object.keys(CODE_LANGUAGES).forEach((language) => {
      expect(codeLanguageName(language), language).toEqual(expect.any(String));
    });
  });
});

describe('codeLanguageId', () => {
  it.each([
    ['typescript', 'typescript'],
    ['ts', 'typescript'],
    ['TSX', 'typescript'],
    ['sh', 'bash'],
    ['yml', 'yaml'],
    ['html', 'xml'],
    ['toml', 'ini'],
    ['docker', 'dockerfile'],
  ])('finds the language %s stands for: %s', (language, id) => {
    expect(codeLanguageId(language)).toBe(id);
  });

  it('knows every language in the list by its own key', () => {
    Object.keys(CODE_LANGUAGES).forEach((language) => {
      expect(codeLanguageId(language), language).toBe(language);
    });
  });

  it('has none for a language that isn’t highlighted', () => {
    expect(codeLanguageId('mermaid')).toBeNull();
    expect(codeLanguageId('')).toBeNull();
    expect(codeLanguageId('constructor')).toBeNull();
  });
});

describe('the highlighter', () => {
  it('and the names come from one copy of highlight.js', () => {
    // `lowlight` brings its own highlight.js; ours must resolve to the same one, or the page
    // would load two, and grammars of one version would run on the other.
    const here = createRequire(import.meta.url);
    const fromLowlight = createRequire(here.resolve('lowlight'));

    expect(here.resolve('highlight.js/lib/core')).toBe(
      fromLowlight.resolve('highlight.js/lib/core'),
    );
  });
});

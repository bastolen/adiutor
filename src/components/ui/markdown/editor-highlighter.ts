/**
 * @file The highlighter of the editor's blocks of code. It starts without a
 * single language: the grammars (`languages.ts`) are a download of their own,
 * fetched the first time a text has a block of code, so someone who never
 * writes code never loads them. Once they're there, every editor on the page
 * colours its code with them, and can name the languages.
 */
import { createLowlight } from 'lowlight';

import type { CodeLanguageChoice } from './languages';

/** highlight.js, without languages until {@link loadCodeLanguages} has run. */
const lowlight = createLowlight();

/** What's known once the languages are there: the choices, and the name of a language. */
interface KnownLanguages {
  /** The languages to pick from, by name. */
  choices: CodeLanguageChoice[];
  /**
   * The name of a language as people know it.
   *
   * @param language - Its key or an alias.
   * @returns The name, or `null` for a language that isn't highlighted.
   */
  nameOf: (language: string) => string | null;
}

/** The languages, once loaded. */
let known: KnownLanguages | null = null;

/** The load that's under way or done, so the languages are fetched once. */
let loading: Promise<void> | null = null;

/** What to call when the languages have arrived. */
const listeners = new Set<() => void>();

/**
 * What the editor's code block extension highlights with. A block that names
 * a language we know is coloured; no language is ever guessed, as the server
 * doesn't guess one either (the extension would, left to itself).
 */
export const editorHighlighter = {
  /**
   * Colours code in a language.
   *
   * @param language - The language.
   * @param code - The code.
   * @returns The code's parts, with their classes.
   */
  highlight: (language: string, code: string) => lowlight.highlight(language, code),
  /**
   * Stands in for guessing a language: the code as it is, uncoloured.
   *
   * @param code - The code.
   * @returns The code as one part without a class.
   */
  highlightAuto: (code: string) => ({ type: 'root', children: [{ type: 'text', value: code }] }),
  /**
   * The languages that are loaded.
   *
   * @returns Their keys.
   */
  listLanguages: () => lowlight.listLanguages(),
  /**
   * Whether a language is loaded.
   *
   * @param language - Its key or an alias.
   * @returns Whether code in it can be coloured.
   */
  registered: (language: string) => lowlight.registered(language),
};

/**
 * Loads the languages, once for the page.
 *
 * @returns A promise that settles when code can be coloured and languages named.
 */
export function loadCodeLanguages(): Promise<void> {
  loading ??= import('./languages').then((languages) => {
    lowlight.register(languages.CODE_LANGUAGES);
    known = { choices: languages.CODE_LANGUAGE_CHOICES, nameOf: languages.codeLanguageName };
    listeners.forEach((listener) => listener());
  });
  return loading;
}

/**
 * Listens for the languages arriving (for React's `useSyncExternalStore`).
 *
 * @param listener - What to call then.
 * @returns A function that stops listening.
 */
export function subscribeToCodeLanguages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The languages as far as they're known.
 *
 * @returns The choices and the names, or `null` before they've loaded.
 */
export function knownCodeLanguages(): KnownLanguages | null {
  return known;
}

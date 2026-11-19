/**
 * @file The languages a block of code can be highlighted in, and their names
 * as people know them ("TypeScript" for `ts`). One list for the server, which
 * highlights the code people read, and for the editor.
 */
import hljs from 'highlight.js/lib/core';
import apache from 'highlight.js/lib/languages/apache';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import http from 'highlight.js/lib/languages/http';
import nginx from 'highlight.js/lib/languages/nginx';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import { common } from 'lowlight';

/**
 * The grammars by language: highlight.js's common ones (JavaScript, Python,
 * SQL, shell, JSON, YAML and some thirty more), and what a service desk sees
 * besides: server and container configuration, PowerShell, HTTP messages and
 * properties files. A block of code in any other language is shown without
 * colours.
 */
export const CODE_LANGUAGES = {
  ...common,
  apache,
  dockerfile,
  http,
  nginx,
  powershell,
  properties,
};

/**
 * A highlight.js of its own that knows the same languages, only to look up
 * what they're called: the one that highlights (inside `lowlight`) doesn't
 * say. Both come from one copy of highlight.js, which is why `package.json`
 * keeps `highlight.js` on the version `lowlight` uses.
 */
const NAMES = hljs.newInstance();
Object.entries(CODE_LANGUAGES).forEach(([language, grammar]) => {
  NAMES.registerLanguage(language, grammar);
});

/**
 * The name of a language as people know it.
 *
 * @param language - The language as a block of code names it: its key or an
 *   alias (`typescript` or `ts`), in any case.
 * @returns Its name ("TypeScript"), or `null` for a language that isn't highlighted.
 */
export function codeLanguageName(language: string): string | null {
  return NAMES.getLanguage(language)?.name ?? null;
}

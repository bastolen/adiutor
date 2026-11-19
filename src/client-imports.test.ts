/**
 * @file Keeps code out of the browser that a page doesn't need when it loads.
 * It follows the static imports of every `'use client'` file in `src/`
 * (`import type` is erased, and `import()` loads later, so neither is
 * followed; nor are the imports of a `'use server'` file, which the browser
 * only gets references to) and fails when one reaches a module that must not
 * be part of a page's own JavaScript, naming the chain of imports that got
 * there.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

/** The repository root, so paths in messages read like `src/app/...`. */
const ROOT = path.resolve(import.meta.dirname, '..');

/** A module that client components must not load with the page. */
interface ImportRule {
  /** A package name, or a file's path from the repository root. */
  module: string;
  /** What to do instead, shown when the rule is broken. */
  instead: string;
  /** Client files that may load it with the page (paths from the root start with these). */
  allowedFrom?: string[];
}

/**
 * The libraries that turn Markdown into what a page shows. They run on the
 * server only: a parser and a highlighter are far too much JavaScript to send
 * along with a page.
 */
const MARKDOWN_RENDERING = [
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-breaks',
  'remark-rehype',
  'rehype-sanitize',
  'rehype-highlight',
  'hast-util-to-jsx-runtime',
];

/**
 * The libraries of the Markdown editor, and the highlighter it shares with
 * the server. They're only for the editor's own files, which no page loads
 * with itself: `MarkdownField` loads the editor with `import()`.
 */
const MARKDOWN_EDITOR = [
  '@tiptap/react',
  '@tiptap/pm',
  '@tiptap/starter-kit',
  '@tiptap/markdown',
  '@tiptap/extension-code-block-lowlight',
  '@tiptap/extension-link',
  '@tiptap/extension-list',
  '@tiptap/extension-table',
  'lowlight',
  'highlight.js',
];

/** The modules client components must not load with the page, and why. */
const RULES: ImportRule[] = [
  {
    module: 'zod',
    instead: 'zod and the schemas stay on the server: take the limits from `@/lib/input-rules`.',
  },
  {
    module: 'qrcode',
    instead: 'load it with `import()` where the QR code is drawn.',
  },
  {
    module: 'src/lib/sign-in/auth-client.ts',
    instead: 'outside the sign-in pages, load it with `loadAuthClient()` when an action needs it.',
    allowedFrom: ['src/app/auth/'],
  },
  {
    module: 'next-intl/server',
    instead:
      'translate with `useTranslations` (the root provider or `ClientMessages` passes the messages).',
  },
  {
    module: 'src/messages',
    instead:
      'take messages from the root provider or `ClientMessages`, which pass only the namespaces the page needs.',
    // It has no provider to ask: the root layout is what failed.
    allowedFrom: ['src/app/global-error.tsx'],
  },
  {
    module: 'src/lib/i18n/messages.ts',
    instead: 'take messages from the root provider or `ClientMessages`.',
  },
  {
    module: 'src/lib/i18n/translator.ts',
    instead: 'translate with `useTranslations`.',
  },
  {
    module: 'src/lib/i18n/request.ts',
    instead: 'read the language with `useLocale()`.',
  },
  {
    module: 'src/lib/i18n/request-locale.ts',
    instead: 'read the language with `useLocale()`.',
  },
  {
    module: 'src/lib/i18n/default-locale.ts',
    instead: "read the language with `useLocale()`; Adiutor's default comes from the database.",
  },
  {
    module: 'src/lib/i18n/resolve-locale.ts',
    instead:
      'read the language with `useLocale()`; `isLocale` and `localeForLanguages` (`src/lib/i18n/locales.ts`) need no libraries.',
  },
  ...MARKDOWN_RENDERING.map((module) => ({
    module,
    instead:
      'Markdown is rendered on the server: render it in a Server Component and pass the result to the client component as `children`.',
  })),
  ...MARKDOWN_EDITOR.map((module) => ({
    module,
    instead:
      'the Markdown editor loads with `import()` from `MarkdownField`; only its own files import its libraries.',
    allowedFrom: ['src/components/ui/markdown/editor'],
  })),
  {
    module: 'src/components/ui/markdown/editor.tsx',
    instead: 'use `MarkdownField`, which loads the editor with `import()` once the page is there.',
    allowedFrom: ['src/components/ui/markdown/editor'],
  },
];

/**
 * Whether an import reaches a rule's module: the module itself, a file in
 * it when it's a folder (`src/messages`), or one of its subpaths when it's a
 * package (`zod/v4` for `zod`).
 *
 * @param target - The import, resolved (see {@link resolve}).
 * @param module - The rule's module.
 * @returns Whether it's that module.
 */
function reaches(target: string, module: string): boolean {
  return target === module || target.startsWith(`${module}/`);
}

/**
 * Lists the source files under a folder, tests left out.
 *
 * @param dir - The folder.
 * @returns Their absolute paths.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Whether a file starts with a directive (after its `@file` comment).
 *
 * @param source - The file's source.
 * @param directive - E.g. `use client`.
 * @returns Whether it does.
 */
function hasDirective(source: string, directive: string): boolean {
  return new RegExp(`^(?:\\s*/\\*[\\s\\S]*?\\*/)?\\s*['"]${directive}['"]`).test(source);
}

/** Static imports and re-exports that load a module (`import type` / `export type` don't). */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

/**
 * Resolves an import to a file in `src/`, or to a package specifier (with its subpath).
 *
 * @param from - The importing file.
 * @param specifier - What it imports.
 * @returns The file's path from the root, or the package specifier.
 */
function resolve(from: string, specifier: string): string {
  let base: string | null = null;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(from), specifier);
  }
  if (!base) {
    // The whole specifier, so a rule can name a package's subpath (`next-intl/server`).
    return specifier;
  }
  const candidates = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext);
  const found = candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  return path.relative(ROOT, found ?? base);
}

/**
 * The modules a file in `src/` loads directly. A server action's imports
 * stay on the server (the browser gets references to it), so they're left
 * out, as are packages and files outside `src/`.
 *
 * @param file - The file's path from the root.
 * @param start - The client file the walk started at (followed even if it's a server action).
 * @returns The modules it imports: paths from the root, or package names.
 */
function importsOf(file: string, start: string): string[] {
  const full = path.join(ROOT, file);
  if (!file.startsWith('src/') || !existsSync(full)) {
    return [];
  }
  const source = readFileSync(full, 'utf8');
  if (file !== start && hasDirective(source, 'use server')) {
    return [];
  }
  return [...source.matchAll(STATIC_IMPORT)].map(([, specifier]) =>
    resolve(full, defined(specifier, 'the imported module')),
  );
}

/**
 * Finds every module a file loads, directly or through other files in `src/`,
 * with the chain of imports that reaches each one.
 *
 * @param start - The file's path from the root.
 * @returns Each module reached, with the chain from `start` to it.
 */
function reachedFrom(start: string): Map<string, string[]> {
  const chains = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  while (queue.length > 0) {
    const file = defined(queue.shift(), 'the next file to visit');
    const chain = defined(chains.get(file), 'the chain to the file');
    importsOf(file, start)
      .filter((target) => !chains.has(target))
      .forEach((target) => {
        chains.set(target, [...chain, target]);
        queue.push(target);
      });
  }
  return chains;
}

/** Every `'use client'` file in `src/`, by path from the root. */
const clientFiles = sourceFiles(path.join(ROOT, 'src'))
  .filter((file) => hasDirective(readFileSync(file, 'utf8'), 'use client'))
  .map((file) => path.relative(ROOT, file));

describe('what client components load with the page', () => {
  it('finds the client components', () => {
    expect(clientFiles.length).toBeGreaterThan(40);
  });

  it.each(RULES)('never loads $module with the page', ({ module, instead, allowedFrom = [] }) => {
    const broken = clientFiles
      .filter((file) => !allowedFrom.some((prefix) => file.startsWith(prefix)))
      .map((file) => [...reachedFrom(file)].find(([target]) => reaches(target, module))?.[1])
      .filter((chain): chain is string[] => chain !== undefined)
      .map((chain) => chain.join(' → '));

    expect(broken, `Instead, ${instead}`).toEqual([]);
  });
});

/**
 * @file ESLint configuration for Adiutor.
 *
 * Applies the Airbnb style guide (with its TypeScript, React and Next.js
 * rules), requires JSDoc comments on all code, keeps imports in order and
 * `eslint-disable` comments explained, and runs Prettier as an ESLint rule so
 * `eslint --fix` also formats files.
 * @see https://eslint-airbnb-extended.nishargshah.dev
 */
import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import { defineConfig, globalIgnores } from 'eslint/config';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import { rules as prettierConfigRules } from 'eslint-config-prettier';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import jsdoc from 'eslint-plugin-jsdoc';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * Generated files and dependencies that should never be linted.
 */
const ignoreConfig = globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']);

/**
 * ESLint's recommended rules plus Airbnb's base JavaScript rules.
 */
const javascriptConfig = [
  { name: 'js/config', ...js.configs.recommended },
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,
];

/**
 * Airbnb's React, React Hooks, accessibility (jsx-a11y) and Next.js rules,
 * including Next.js' Core Web Vitals checks.
 */
const nextConfig = [
  plugins.react,
  plugins.reactHooks,
  plugins.reactA11y,
  plugins.next,
  ...configs.next.recommended,
];

/**
 * Airbnb's TypeScript rules, with type-aware linting through typescript-eslint.
 */
const typescriptConfig = [
  plugins.typescriptEslint,
  ...configs.base.typescript,
  ...configs.next.typescript,
];

/**
 * Tooling and test-setup files that Airbnb's allowlist doesn't cover, and
 * the shared helpers of a split module's tests (`test-helpers.ts` next to
 * them). They only run during development, so they may import
 * devDependencies.
 */
const devFilesConfig = [
  {
    name: 'adiutor/dev-files',
    files: [
      '*.config.{js,mjs,cjs,ts,mts,cts}',
      'vitest.setup.ts',
      '**/*.test.{ts,tsx}',
      '**/test-helpers.ts',
      'e2e/**',
    ],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
];

/**
 * Airbnb's `no-restricted-properties` entries (without the level), so a
 * stricter list for some files keeps them.
 */
const airbnbRestrictedProperties = configs.base.recommended
  .find((config) => config.rules?.['no-restricted-properties'])
  .rules['no-restricted-properties'].slice(1);

/**
 * Airbnb's `no-restricted-syntax` entries (without the level) except its ban
 * on `for…of`, which only mattered for old browsers and pushes code towards
 * `forEach` (where an `async` callback isn't awaited).
 */
const airbnbRestrictedSyntaxWithoutForOf = configs.base.recommended
  .find((config) => config.rules?.['no-restricted-syntax'])
  .rules['no-restricted-syntax'].slice(1)
  .filter((entry) => (typeof entry === 'string' ? entry : entry.selector) !== 'ForOfStatement');

/**
 * Project-specific adjustments to Airbnb's rules.
 */
const projectRulesConfig = [
  {
    name: 'adiutor/language',
    rules: {
      /** `for…of` is allowed; `for…in`, labels and `with` stay banned. */
      'no-restricted-syntax': ['error', ...airbnbRestrictedSyntaxWithoutForOf],
      /**
       * Default and named exports are both fine: a module with one export
       * shouldn't have to change how it's imported when it gets a second.
       */
      'import-x/prefer-default-export': 'off',
      /** No `any`: say what the value is, or use `unknown` and check it. */
      '@typescript-eslint/no-explicit-any': 'error',
      /** No `!`: check the value, or use `defined()` (`src/lib/defined.ts`). */
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    name: 'adiutor/promises',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      /**
       * Every promise is awaited or handled, so a failure can't vanish.
       * `void` marks a deliberate fire-and-forget, for a function that
       * reports its own errors. (Type-aware, so TypeScript files only.)
       */
      '@typescript-eslint/no-floating-promises': 'error',
      /** No promise where a condition or callback expects none (JSX event props may return one). */
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      'no-void': ['error', { allowAsStatement: true }],
    },
  },
  {
    name: 'adiutor/imports',
    rules: {
      /**
       * Imports in fixed groups (Node built-ins, packages, `@/…`, relative),
       * a blank line between groups and A to Z within each, so two people
       * adding imports don't reorder each other's. Side-effect imports such
       * as `import 'server-only'` stay where they are.
       */
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    name: 'adiutor/react',
    rules: {
      /**
       * React 19 deprecates `defaultProps` on function components; require
       * default parameter values for optional props instead.
       */
      'react/require-default-props': ['error', { functions: 'defaultArguments' }],
      /**
       * Raw HTML is the way scripts get injected; any use needs an explained
       * exception (the root layout's theme script), so a new one fails CI.
       */
      'react/no-danger': 'error',
    },
  },
  {
    name: 'adiutor/e2e',
    files: ['e2e/**'],
    rules: {
      /**
       * No fixed waits: they guess at timing, slow every run and still miss
       * what comes later. Airbnb's own restricted properties stay.
       */
      'no-restricted-properties': [
        'error',
        ...airbnbRestrictedProperties,
        {
          property: 'waitForTimeout',
          message:
            'Wait for what the test needs (`expect.poll`, `waitForNewEmail`, a locator) instead of a fixed time.',
        },
      ],
    },
  },
  {
    name: 'adiutor/scripts',
    files: ['scripts/**'],
    rules: {
      /** Command-line scripts report to the terminal. */
      'no-console': 'off',
      /** Scripts only run during development. */
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
];

/**
 * Enforces the project rule that all code is documented with JSDoc comments.
 */
const jsdocConfig = [
  /** TypeScript files: types come from TypeScript, not JSDoc tags. */
  {
    ...jsdoc.configs['flat/recommended-typescript-error'],
    files: ['**/*.{ts,tsx,mts,cts}'],
  },
  /** JavaScript files: JSDoc tags such as `@type` provide the types. */
  {
    ...jsdoc.configs['flat/recommended-typescript-flavor-error'],
    files: ['**/*.{js,jsx,mjs,cjs}'],
  },
  {
    name: 'adiutor/jsdoc',
    rules: {
      /** One blank line between a comment's description and its tags. */
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
      /** Every file starts with a `@file` block saying what it is for. */
      'jsdoc/require-file-overview': 'error',
      /** Allow Vitest's `@vitest-environment` pragma in a test file's `@file` block. */
      'jsdoc/check-tag-names': ['error', { definedTags: ['vitest-environment'] }],
      /** Functions, classes, methods and type declarations need a comment. */
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
          ],
        },
      ],
      /**
       * Every comment says something: a stub `lint:fix` inserted fails until
       * it's written, like a stub `@param` line does.
       */
      'jsdoc/require-description': 'error',
    },
  },
];

/**
 * Checks that Tailwind classes are valid. Class order is checked by Prettier
 * (see `prettierConfig`), so this plugin's stylistic rules stay off.
 */
const tailwindConfig = [
  {
    name: 'adiutor/tailwind',
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: {
      /** Stylesheet that loads Tailwind and the theme, so theme classes are known. */
      'better-tailwindcss': { entryPoint: 'src/app/globals.css' },
    },
    rules: {
      /** Unknown classes, conflicting classes and classes built by string concatenation. */
      ...betterTailwind.configs['correctness-error'].rules,
      /** The same class twice in one list. */
      'better-tailwindcss/no-duplicate-classes': 'error',
      /** Classes that Tailwind has deprecated. */
      'better-tailwindcss/no-deprecated-classes': 'error',
    },
  },
];

/**
 * Formats code with Prettier (settings in `prettier.config.mjs`) and turns off
 * the stylistic rules that would conflict with it. Because Prettier sorts
 * Tailwind classes, this also reports classes in the wrong order. Comes after
 * the others, except the braces rule it would turn off.
 */
const prettierConfig = [
  { name: 'prettier/plugin/config', plugins: { prettier: prettierPlugin } },
  { name: 'prettier/config', rules: { ...prettierConfigRules, 'prettier/prettier': 'error' } },
];

/**
 * `eslint-disable` comments: each gives its reason (`-- why`), none is a
 * blanket disable, block disables are closed, and ones that no longer
 * disable anything are errors (so `lint:fix` removes them).
 */
const disableCommentsConfig = [
  comments.recommended,
  {
    name: 'adiutor/eslint-comments',
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
    rules: {
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: ['eslint-enable'] },
      ],
      /** A block disable at the top of a file covers the whole file, without an `eslint-enable`. */
      '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: true }],
    },
  },
];

/**
 * Braces on every `if`, `else`, `for`, `while` and `do`, even around a single
 * statement. eslint-config-prettier turns `curly` off (one of its "special
 * rules"); the `'all'` option never conflicts with Prettier, so it's turned
 * back on after the Prettier config.
 */
const bracesConfig = [{ name: 'adiutor/braces', rules: { curly: ['error', 'all'] } }];

/**
 * Modules that outgrew one file and became a folder (under `src/`). Each
 * folder's `index.ts` is the module's public API; the files next to it are
 * its internals. Add a module here when it becomes a folder.
 */
const FOLDER_MODULES = [
  'lib/authz/mfa',
  'server/auth/auth-events',
  'server/auth/auth-guards',
  'server/people/invitations',
];

/**
 * Code outside a folder module imports the module itself (its `index.ts`),
 * never a file inside the folder, by `@/` path or a relative one. Files
 * inside import each other as `./file`, which this leaves alone.
 */
const moduleBoundariesConfig = [
  {
    name: 'adiutor/module-boundaries',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^(@/(${FOLDER_MODULES.join('|')})|(\\.{1,2}/)+(.*/)?(${FOLDER_MODULES.map(
                (module) => module.split('/').pop(),
              ).join('|')}))/.+`,
              message:
                'Import the module itself (its index.ts is the public API), not a file inside its folder.',
            },
          ],
        },
      ],
    },
  },
];

export default defineConfig([
  ignoreConfig,
  ...javascriptConfig,
  ...nextConfig,
  ...typescriptConfig,
  ...devFilesConfig,
  ...projectRulesConfig,
  ...jsdocConfig,
  ...tailwindConfig,
  ...disableCommentsConfig,
  ...prettierConfig,
  ...bracesConfig,
  ...moduleBoundariesConfig,
]);

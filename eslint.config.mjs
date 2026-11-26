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
 * Generated files, and other checkouts of the repository that Claude Code
 * keeps in `.claude/worktrees/` (each with its own files and dependencies),
 * which should never be linted from here.
 */
const ignoreConfig = globalIgnores([
  '.next/**',
  'out/**',
  'build/**',
  'next-env.d.ts',
  '.claude/worktrees/**',
]);

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
       * a blank line between groups and A to Z by path within each (so `../`
       * imports come before `./` ones), so two people adding imports don't
       * reorder each other's. Side-effect imports such as
       * `import 'server-only'` stay where they are.
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
      /**
       * Scripts may import devDependencies: most are development tools, and the few that
       * run on servers (`jobs:run`, `setup:platform`, `sessions:revoke-all`) run from the
       * image, which keeps its source and scripts (docs/deploying.md).
       */
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
      /**
       * A function whose one parameter is a destructured object with a named
       * type (a component's props) needs no `@param` lines: the type's own
       * comments describe each field, so the lines would only repeat them.
       * A function that has `@param` lines still gets them checked.
       */
      'jsdoc/require-param': ['error', { interfaceExemptsParamsCheck: true }],
    },
  },
  {
    name: 'adiutor/jsdoc-components',
    files: ['**/*.tsx'],
    rules: {
      /**
       * A component returns what its name and description say (the card, the
       * page), so it needs no `@returns` line that only repeats them. One
       * that says more is still welcome.
       */
      'jsdoc/require-returns': 'off',
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
  'lib/branding',
  'lib/requests',
  'server/auth/auth-events',
  'server/auth/auth-guards',
  'server/branding',
  'server/jobs',
  'server/people/invitations',
  'server/people/invite-links',
  'server/people/user-admin',
  'server/queue',
  'server/requests',
  'server/settings',
  'server/webhooks',
];

/**
 * Code outside a folder module imports the module itself (its `index.ts`),
 * never a file inside the folder, by `@/` path or a relative one. Files
 * inside import each other as `./file`, which this leaves alone.
 */
const folderModulePatterns = [
  {
    regex: `^(@/(${FOLDER_MODULES.join('|')})|(\\.{1,2}/)+(.*/)?(${FOLDER_MODULES.map((module) =>
      module.split('/').pop(),
    ).join('|')}))/.+`,
    message:
      'Import the module itself (its index.ts is the public API), not a file inside its folder.',
  },
];

/**
 * Forms use `useTransientActionState` (CLAUDE.md, "UI and accessibility"):
 * `useActionState` alone keeps an old result on screen when someone comes back
 * to a page that `<Activity>` kept alive.
 */
const useActionStatePath = {
  name: 'react',
  importNames: ['useActionState'],
  message:
    'Use `useTransientActionState` (src/components/ui/use-transient-state.ts), so a result is gone when someone comes back to the page.',
};

/**
 * Work the response doesn't wait for goes through `startInBackground`
 * (`src/server/background.ts`), not Next's `after()`: called while a page
 * renders, `after()` makes every later `cookies()` or `headers()` read in that
 * render fail once the response closes, and renders can outlive their
 * response. Route handlers may use it: Better Auth's endpoints
 * (`src/lib/auth.ts`) and the jobs' tick (`src/app/api/jobs/route.ts`).
 */
const nextAfterPath = {
  name: 'next/server',
  importNames: ['after'],
  message:
    'Use `startInBackground` (src/server/background.ts): `after()` called while rendering makes later cookie and header reads in that render fail once the response closes.',
};

/**
 * Specs import `test` and `expect` from `e2e/support/test.ts` (CLAUDE.md, "UI
 * and accessibility"), which fails a test on the CSP violations its pages
 * report. Types still come from `@playwright/test`.
 */
const playwrightTestPath = {
  name: '@playwright/test',
  importNames: ['test', 'expect'],
  message:
    'Import `test` and `expect` from `./support/test` (e2e/support/test.ts), which fails on CSP violations.',
};

/**
 * `no-restricted-imports`, built from the lists above. ESLint keeps only the
 * last setting of a rule for a file, so each block repeats every list that
 * applies to its files instead of adding to an earlier one.
 */
const restrictedImportsConfig = [
  {
    name: 'adiutor/restricted-imports',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: folderModulePatterns, paths: [useActionStatePath, nextAfterPath] },
      ],
    },
  },
  {
    name: 'adiutor/restricted-imports/emails',
    files: ['src/emails/**/*.{ts,tsx}', 'src/components/email/**/*.{ts,tsx}'],
    rules: {
      /**
       * Emails are bundled into server code (the jobs route, the
       * instrumentation), where React's server build has no hooks or context:
       * values reach the blocks as props (decision 0047).
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: folderModulePatterns,
          paths: [
            useActionStatePath,
            nextAfterPath,
            {
              name: 'react',
              importNames: [
                'createContext',
                'useContext',
                'useState',
                'useEffect',
                'useLayoutEffect',
                'useReducer',
                'useRef',
                'useMemo',
                'useCallback',
                'use',
              ],
              message:
                'Emails render in server code, where React has no hooks or context: pass values as props (decision 0047).',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'adiutor/restricted-imports/transient-state',
    files: ['src/components/ui/use-transient-state.ts'],
    rules: {
      /** The wrapper itself is built on `useActionState`. */
      'no-restricted-imports': [
        'error',
        { patterns: folderModulePatterns, paths: [nextAfterPath] },
      ],
    },
  },
  {
    name: 'adiutor/restricted-imports/auth',
    files: ['src/lib/auth.ts', 'src/app/api/jobs/route.ts'],
    rules: {
      /**
       * Route handlers, where `after()` may read the request: Better Auth's
       * endpoints, and the jobs' tick, whose continuation needs `after()` so
       * Vercel keeps the function running until it's done.
       */
      'no-restricted-imports': [
        'error',
        { patterns: folderModulePatterns, paths: [useActionStatePath] },
      ],
    },
  },
  {
    name: 'adiutor/restricted-imports/e2e-specs',
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: folderModulePatterns,
          paths: [useActionStatePath, nextAfterPath, playwrightTestPath],
        },
      ],
    },
  },
];

/** Unit, integration and component tests, and their shared helpers. */
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/test-helpers.ts'];

/**
 * Provider IDs are never compared inline (CLAUDE.md, "Authentication and
 * permissions"): `isMfaProvider`, the configured lists and `PROVIDER_LABELS`
 * say which providers exist. A string `'github'` or `'google'` outside the
 * files that declare the providers is such a comparison. Types (`'github'` in
 * a type) are left alone.
 */
const providerIdSyntax = {
  selector: ':not(TSLiteralType) > Literal[value=/^(github|google)$/]',
  message:
    'Use the provider lists and helpers in src/lib/sign-in/oauth-providers.ts (isMfaProvider, PROVIDER_LABELS, ...) instead of a provider ID.',
};

/**
 * Pages and components never compare roles inline (CLAUDE.md, "Authentication
 * and permissions"): permissions come from `src/lib/authz` and
 * `src/server/authz.ts`. Catches `role === 'admin'` and `x.platformRole !==
 * 'support'`, either way round; a check against `null` is left alone.
 */
const roleComparisonSyntax = [
  {
    selector:
      'BinaryExpression[operator=/^[!=]==$/]:matches([left.name=/[Rr]ole$/], [left.property.name=/[Rr]ole$/])[right.raw=/^[\'"`]/]',
    message: 'Check a permission (src/lib/authz, src/server/authz.ts) instead of comparing a role.',
  },
  {
    selector:
      'BinaryExpression[operator=/^[!=]==$/]:matches([right.name=/[Rr]ole$/], [right.property.name=/[Rr]ole$/])[left.raw=/^[\'"`]/]',
    message: 'Check a permission (src/lib/authz, src/server/authz.ts) instead of comparing a role.',
  },
];

/**
 * Translated text is never glued together (CLAUDE.md, "Languages"): each
 * message is a whole sentence whose named arguments a language may move, so
 * a translation call (`t(...)`, `t.rich(...)`, `tCommon(...)`) never sits in
 * a template literal or a `+`. See "Writing messages" in docs/i18n.md.
 */
const translationJoinSyntax = [
  'TemplateLiteral > CallExpression[callee.name=/^t([A-Z]\\w*)?$/]',
  'TemplateLiteral > CallExpression[callee.object.name=/^t([A-Z]\\w*)?$/]',
  "BinaryExpression[operator='+'] > CallExpression[callee.name=/^t([A-Z]\\w*)?$/]",
  "BinaryExpression[operator='+'] > CallExpression[callee.object.name=/^t([A-Z]\\w*)?$/]",
].map((selector) => ({
  selector,
  message:
    'Write the whole sentence as one message with named arguments, so each language can order it (docs/i18n.md, "Writing messages").',
}));

/**
 * Props that hold text people see or hear: names (`aria-label`,
 * `closeLabel`, ...), titles, placeholders, descriptions. Their text comes
 * from the catalogues, never a literal or a template literal.
 */
const TEXT_PROPS =
  '/^(aria-label|aria-description|alt|title|placeholder|label|description|heading|hint|[a-z]+Label)$/';

/**
 * The options of `react/jsx-no-literals` for the UI and the email templates:
 * no text in JSX (props are the job of `literalTextPropSyntax`), apart from
 * the punctuation and symbols that go between translated parts.
 */
const jsxNoLiteralsOptions = {
  noStrings: false,
  ignoreProps: true,
  allowedStrings: ['·', '–', '—', '…', '(', ')', ',', ':', '/', '%', '|'],
};

/**
 * Text written straight into a text prop instead of coming from the
 * catalogues (CLAUDE.md, "Languages").
 */
const literalTextPropSyntax = [
  `JSXAttribute[name.name=${TEXT_PROPS}] > Literal[value=/[A-Za-z]/]`,
  `JSXAttribute[name.name=${TEXT_PROPS}] > JSXExpressionContainer > Literal[value=/[A-Za-z]/]`,
  `JSXAttribute[name.name=${TEXT_PROPS}] > JSXExpressionContainer > TemplateLiteral`,
].map((selector) => ({
  selector,
  message:
    'Put the text in the catalogues (src/messages/, every language) and use t(...) (docs/i18n.md).',
}));

/**
 * The rules from CLAUDE.md that ESLint can check, each block saying which.
 * Like `no-restricted-imports`, `no-restricted-syntax` and
 * `no-restricted-properties` keep only their last setting per file, so the
 * blocks repeat Airbnb's own entries.
 */
const claudeRulesConfig = [
  {
    name: 'adiutor/claude-rules/provider-ids',
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      ...TEST_FILES,
      'src/lib/sign-in/oauth-providers.ts',
      'src/lib/sign-in/providers.ts',
      'src/server/auth/provider-mfa.ts',
      // Written by `pnpm auth:schema` from Better Auth's config, which spells out the enum of
      // `user.avatarSource` (`AVATAR_SOURCES`): the provider IDs as values, never a comparison.
      'src/db/schema/auth.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...airbnbRestrictedSyntaxWithoutForOf,
        providerIdSyntax,
        ...translationJoinSyntax,
      ],
    },
  },
  {
    name: 'adiutor/claude-rules/roles-in-ui',
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...airbnbRestrictedSyntaxWithoutForOf,
        providerIdSyntax,
        ...roleComparisonSyntax,
        ...translationJoinSyntax,
      ],
    },
  },
  {
    /**
     * Text people see comes from the catalogues (CLAUDE.md, "Languages"):
     * no text written straight into JSX or into a text prop. Punctuation and
     * symbols between translated parts are fine.
     */
    name: 'adiutor/claude-rules/ui-text',
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    ignores: TEST_FILES,
    rules: {
      'react/jsx-no-literals': ['error', jsxNoLiteralsOptions],
      'no-restricted-syntax': [
        'error',
        ...airbnbRestrictedSyntaxWithoutForOf,
        providerIdSyntax,
        ...roleComparisonSyntax,
        ...translationJoinSyntax,
        ...literalTextPropSyntax,
      ],
    },
  },
  {
    /**
     * Email templates speak the recipient's language (CLAUDE.md, "Email" and
     * "Languages"): their text comes from the `emails` catalogue, like the
     * UI's, never written straight into JSX or a text prop.
     */
    name: 'adiutor/claude-rules/email-text',
    files: ['src/emails/**/*.tsx'],
    ignores: TEST_FILES,
    rules: {
      'react/jsx-no-literals': ['error', jsxNoLiteralsOptions],
      'no-restricted-syntax': [
        'error',
        ...airbnbRestrictedSyntaxWithoutForOf,
        providerIdSyntax,
        ...translationJoinSyntax,
        ...literalTextPropSyntax,
      ],
    },
  },
  {
    /**
     * Configuration is read through `env` (src/lib/env.ts), validated once at
     * startup, never from `process.env` directly.
     */
    name: 'adiutor/claude-rules/env',
    files: ['src/**/*.{ts,tsx}'],
    ignores: [...TEST_FILES, 'src/lib/env.ts', 'src/lib/env-schema.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...airbnbRestrictedProperties,
        {
          object: 'process',
          property: 'env',
          message:
            'Import `env` from src/lib/env.ts, which validates the configuration once at startup.',
        },
      ],
    },
  },
  {
    /**
     * Semantic colours (CLAUDE.md, "UI and accessibility" and "Dark mode"):
     * never a fixed `white`, `black` or `ink`, and never text lightened with
     * opacity (`text-foreground/70`), which fails contrast in one of the modes.
     * A font size with a line height (`text-sm/6`) is fine.
     */
    name: 'adiutor/claude-rules/colours',
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern:
                '^(?:.*:)?(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|shadow|decoration|caret|accent|placeholder)-(?:white|black|ink)(?:\\/\\d+)?$',
              message:
                'Use a semantic colour (background, surface, foreground, highlight, ...) that works in light and dark mode.',
            },
            {
              pattern: '^(?:.*:)?text-(?!(?:xs|sm|base|lg|[0-9]*xl)\\/)[a-z]+(?:-[a-z]+)*\\/\\d+$',
              message:
                'Never lighten text with opacity; use `text-muted-foreground` or another semantic colour.',
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
  ...restrictedImportsConfig,
  ...claudeRulesConfig,
]);

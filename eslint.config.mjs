/**
 * @file ESLint configuration for Adiutor.
 *
 * Applies the Airbnb style guide (with its TypeScript, React and Next.js
 * rules), requires JSDoc comments on all code, and runs Prettier as an ESLint
 * rule so `eslint --fix` also formats files.
 * @see https://eslint-airbnb-extended.nishargshah.dev
 */
import js from '@eslint/js';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import { rules as prettierConfigRules } from 'eslint-config-prettier';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import jsdoc from 'eslint-plugin-jsdoc';
import prettierPlugin from 'eslint-plugin-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

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
 * Tooling and test-setup files that Airbnb's allowlist doesn't cover. They
 * only run during development, so they may import devDependencies.
 */
const devFilesConfig = [
  {
    name: 'adiutor/dev-files',
    files: ['*.config.{js,mjs,cjs,ts,mts,cts}', 'vitest.setup.ts'],
    rules: {
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
 * Tailwind classes, this also reports classes in the wrong order. Must come
 * last.
 */
const prettierConfig = [
  { name: 'prettier/plugin/config', plugins: { prettier: prettierPlugin } },
  { name: 'prettier/config', rules: { ...prettierConfigRules, 'prettier/prettier': 'error' } },
];

export default defineConfig([
  ignoreConfig,
  ...javascriptConfig,
  ...nextConfig,
  ...typescriptConfig,
  ...devFilesConfig,
  ...jsdocConfig,
  ...tailwindConfig,
  ...prettierConfig,
]);

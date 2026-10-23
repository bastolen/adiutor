/**
 * @file Stylelint configuration for Adiutor's CSS and SCSS.
 *
 * Applies the standard CSS and SCSS rules, allows Tailwind CSS's at-rules and
 * functions, requires JSDoc-style block comments, and runs Prettier as a
 * Stylelint rule so `stylelint --fix` also formats files.
 * @see https://stylelint.io/user-guide/configure
 */

/**
 * Tailwind CSS v4 at-rules that Stylelint does not know about.
 *
 * @see https://tailwindcss.com/docs/functions-and-directives
 */
const tailwindAtRules = [
  'theme',
  'utility',
  'variant',
  'custom-variant',
  'apply',
  'source',
  'plugin',
  'config',
  'reference',
];

/**
 * Stylelint options.
 *
 * @type {import('stylelint').Config}
 */
const config = {
  extends: ['stylelint-config-standard-scss', 'stylelint-prettier/recommended'],
  /** Generated output and dependencies that should never be linted. */
  ignoreFiles: ['.next/**', 'out/**', 'build/**', 'node_modules/**'],
  rules: {
    /** Allow Tailwind's at-rules (checked for both CSS and SCSS). */
    'scss/at-rule-no-unknown': [true, { ignoreAtRules: tailwindAtRules }],
    /** Allow Tailwind's `theme()` and `--spacing()` style functions. */
    'function-no-unknown': [true, { ignoreFunctions: ['theme', '--spacing', '--alpha'] }],
    /**
     * Comments must be JSDoc style (`/** ... *\/`), matching the rest of the
     * codebase. The comment text after `/*` must start with `*`, which also
     * rules out plain `/* *\/` comments and SCSS `//` comments.
     */
    'comment-pattern': [
      '^\\*',
      { message: 'Use JSDoc-style block comments: /** ... */ (comment-pattern)' },
    ],
    /** Tailwind theme tokens use names like `--text-xs--line-height`. */
    'custom-property-pattern': null,
  },
};

export default config;

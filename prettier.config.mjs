/**
 * @file Prettier configuration for Adiutor.
 *
 * Settings match the Airbnb style guide, so Prettier and the Airbnb ESLint
 * rules agree. ESLint runs Prettier on JavaScript and TypeScript; run
 * `pnpm format` to format every other file type (CSS, JSON, Markdown).
 * @see https://prettier.io/docs/options
 */

/**
 * Prettier options.
 *
 * @type {import('prettier').Config}
 */
const config = {
  /** Airbnb's maximum line length (`max-len`). */
  printWidth: 100,
  /** Two-space indentation (`indent`). */
  tabWidth: 2,
  useTabs: false,
  /** Always end statements with a semicolon (`semi`). */
  semi: true,
  /** Single quotes in JavaScript and TypeScript (`quotes`). */
  singleQuote: true,
  /** Double quotes in JSX attributes (`jsx-quotes`). */
  jsxSingleQuote: false,
  /** Only quote object keys when needed (`quote-props`). */
  quoteProps: 'as-needed',
  /** Trailing commas wherever valid on multi-line code (`comma-dangle`). */
  trailingComma: 'all',
  /** Spaces inside object braces (`object-curly-spacing`). */
  bracketSpacing: true,
  /** Put the `>` of a multi-line JSX element on its own line. */
  bracketSameLine: false,
  /** Always wrap arrow function parameters in parentheses (`arrow-parens`). */
  arrowParens: 'always',
  /** Unix line endings (`linebreak-style`). */
  endOfLine: 'lf',
  /** Sorts Tailwind classes in the recommended order. */
  plugins: ['prettier-plugin-tailwindcss'],
  /** Stylesheet that loads Tailwind and the theme, so custom classes sort too. */
  tailwindStylesheet: './src/app/globals.css',
  /** Also sort classes passed to these class-name helpers. */
  tailwindFunctions: ['clsx', 'cn', 'cva', 'tv', 'twMerge', 'twJoin'],
};

export default config;

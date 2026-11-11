/**
 * @file lint-staged configuration, run by the Husky pre-commit hook.
 *
 * Formats and lints only the files staged for commit. Partly staged files are
 * handled too: unstaged changes are set aside while the tasks run, so only
 * the staged changes are formatted and committed. Fixes are added to the
 * commit automatically; errors that can't be fixed stop the commit.
 * @see https://github.com/lint-staged/lint-staged
 */

/**
 * Checks the translation catalogues once, without the staged paths: the
 * check reads every catalogue and all of `src` (docs/i18n.md).
 *
 * @returns {string} The command.
 */
const checkMessages = () => 'pnpm lint:messages';

/**
 * Commands to run per file type. Each receives the staged file paths.
 *
 * @type {import('lint-staged').Configuration}
 */
const config = {
  /**
   * ESLint fixes and formats (Prettier runs inside it), then fails on errors it can't fix.
   * Vitest then runs the unit tests related to the staged files.
   */
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'vitest related --run --passWithNoTests --project unit',
    // Code can stop using a message, or start using one that doesn't exist.
    checkMessages,
  ],
  /** The translation catalogues: every language complete and matching English (docs/i18n.md). */
  'src/messages/**/*.json': checkMessages,
  /** Stylelint fixes and formats (Prettier runs inside it), then fails on errors it can't fix. */
  '*.css': 'stylelint --fix --allow-empty-input --max-warnings=0',
  /** Everything else Prettier understands: JSON, Markdown, YAML and so on. */
  '*.{json,jsonc,json5,md,yml,yaml}': 'prettier --write --ignore-unknown',
};

export default config;

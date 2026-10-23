/**
 * @file commitlint configuration, run by the Husky commit-msg hook.
 *
 * Commit messages must follow Conventional Commits, e.g.
 * `feat: add login page` or `fix(theme): correct accent colour`. release-please
 * uses these messages to pick version numbers and write the changelog.
 * @see https://www.conventionalcommits.org
 */

/**
 * commitlint options.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional'],
};

export default config;

/**
 * @file commitlint configuration, run by the Husky commit-msg hook and, for
 * pull request titles, by the PR title workflow.
 *
 * Commit messages must follow Conventional Commits, e.g.
 * `feat: add login page` or `fix(theme): correct accent colour`. release-please
 * uses these messages to pick version numbers and write the changelog.
 * @see https://www.conventionalcommits.org
 */

/**
 * The titles Dependabot writes for our action updates (`.github/dependabot.yml`:
 * prefix `ci`, scope included), e.g. "ci(deps): bump docker/login-action from
 * 4.7.0 to 4.8.0 in the github-actions group across 1 directory". Dependabot
 * doesn't let us choose them, and its group wording can run past the
 * 100-character header limit, so commitlint skips them. Their `ci` type keeps
 * them out of the release notes, so nothing depends on their length.
 */
const DEPENDABOT_BUMP = /^ci\(deps\): bump /;

/**
 * Whether a message is one of Dependabot's action update titles.
 *
 * @param {string} message - The commit message or pull request title.
 * @returns {boolean} Whether commitlint should skip it.
 */
function isDependabotBump(message) {
  return DEPENDABOT_BUMP.test(message);
}

/**
 * commitlint options.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  /** Messages left unchecked, next to commitlint's own (merges, reverts). */
  ignores: [isDependabotBump],
};

export default config;

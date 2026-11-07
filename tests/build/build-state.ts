/**
 * @file Works out whether the last production build is still current, so a
 * local end-to-end run can start it instead of building again
 * (`playwright.config.ts`). It is current when nothing `next build` reads
 * changed after it: Next writes `.next/BUILD_ID` once the app has compiled,
 * so a build that failed leaves the older one, older than the change that
 * broke it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** What `next build` reads, from the repository root. */
export const BUILD_INPUTS = [
  'src',
  'public',
  'next.config.ts',
  'tsconfig.json',
  'package.json',
  'pnpm-lock.yaml',
];

/** Unit test files, which the build doesn't use. */
const TEST_FILE = /\.test\.tsx?$/;

/**
 * The latest change to a file or folder: for a folder, to the folder itself
 * (a file added or removed) or anything in it, leaving out unit tests.
 *
 * @param target - The file or folder's full path.
 * @returns When it last changed, in milliseconds.
 */
function lastChange(target: string): number {
  const own = statSync(target);
  if (!own.isDirectory()) {
    return own.mtimeMs;
  }
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || !TEST_FILE.test(entry.name))
    .reduce(
      (latest, entry) => Math.max(latest, lastChange(path.join(target, entry.name))),
      own.mtimeMs,
    );
}

/**
 * Whether the last production build is still current: it exists and none of
 * {@link BUILD_INPUTS} changed after it. Inputs that don't exist are ignored.
 *
 * @param root - The repository root.
 * @returns Whether it can be started without building again.
 */
export function buildIsCurrent(root = process.cwd()): boolean {
  const buildId = path.join(root, '.next', 'BUILD_ID');
  if (!existsSync(buildId)) {
    return false;
  }
  const builtAt = statSync(buildId).mtimeMs;
  return BUILD_INPUTS.map((input) => path.join(root, input))
    .filter((input) => existsSync(input))
    .every((input) => lastChange(input) <= builtAt);
}

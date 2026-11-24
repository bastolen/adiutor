/**
 * @file Lists the source files under a folder, for the tests that read the
 * app's own source.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Lists the source files under a folder and its subfolders, tests left out.
 *
 * @param dir - The folder.
 * @param pattern - The file names to list (default: TypeScript and TSX).
 * @returns Their absolute paths.
 */
export default function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full, pattern);
    }
    return pattern.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

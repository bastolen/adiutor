/**
 * @file Tests for whether the last production build is still current: only
 * when nothing the build reads (files, or a folder's list of files) changed
 * after it, not counting unit tests.
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIsCurrent } from './build-state';

/** When the build in each test was made. */
const BUILT_AT = new Date('2026-11-03T12:00:00Z');

/** Before the build. */
const BEFORE = new Date('2026-11-03T11:00:00Z');

/** After the build. */
const AFTER = new Date('2026-11-03T13:00:00Z');

/** The temporary repository of the current test. */
let root: string;

/**
 * Writes a file in the temporary repository, with its folders, and sets its
 * time (and its folder's) to before the build.
 *
 * @param relative - The file's path in the repository.
 */
function write(relative: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  utimesSync(file, BEFORE, BEFORE);
  utimesSync(path.dirname(file), BEFORE, BEFORE);
}

/**
 * Sets a file or folder's time.
 *
 * @param relative - Its path in the repository.
 * @param at - The time.
 */
function touch(relative: string, at: Date): void {
  utimesSync(path.join(root, relative), at, at);
}

describe('buildIsCurrent', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'adiutor-build-'));
    ['src/app/page.tsx', 'src/app/page.test.tsx', 'next.config.ts', 'package.json'].forEach(write);
    ['pnpm-lock.yaml', 'tsconfig.json'].forEach(write);
    write('.next/BUILD_ID');
    touch('.next/BUILD_ID', BUILT_AT);
    // The folders above the files, as they were when the build ran.
    touch('src', BEFORE);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is false before the first build', () => {
    unlinkSync(path.join(root, '.next/BUILD_ID'));
    expect(buildIsCurrent(root)).toBe(false);
  });

  it('is true when nothing changed after the build, ignoring inputs that don’t exist', () => {
    // There's no public/ folder here.
    expect(buildIsCurrent(root)).toBe(true);
  });

  it('is false once a source file changed', () => {
    touch('src/app/page.tsx', AFTER);
    expect(buildIsCurrent(root)).toBe(false);
  });

  it('is false once a file was deleted (its folder changed)', () => {
    write('src/app/old.tsx');
    unlinkSync(path.join(root, 'src/app/old.tsx'));
    touch('src/app', AFTER);
    expect(buildIsCurrent(root)).toBe(false);
  });

  it('stays true when only a unit test changed', () => {
    touch('src/app/page.test.tsx', AFTER);
    expect(buildIsCurrent(root)).toBe(true);
  });

  it.each(['package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json'])(
    'is false once %s changed',
    (input) => {
      touch(input, AFTER);
      expect(buildIsCurrent(root)).toBe(false);
    },
  );
});

/**
 * @file Tests for the rule that decides whether a job is paused.
 */
import { describe, expect, it } from 'vitest';

import { isPaused } from './state';

describe('isPaused', () => {
  const pausedAt = new Date('2026-11-18T10:00:00Z');

  it('is paused when a pause is set and the job can be paused', () => {
    expect(isPaused({ pausedAt }, true)).toBe(true);
  });

  it('ignores a pause on a job that cannot be paused', () => {
    expect(isPaused({ pausedAt }, false)).toBe(false);
  });

  it('is not paused without a pause, or without a state', () => {
    expect(isPaused({ pausedAt: null }, true)).toBe(false);
    expect(isPaused(undefined, true)).toBe(false);
  });
});

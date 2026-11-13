/**
 * @file Tests for describing a recurring job: one whose name isn't
 * kebab-case or whose schedule can't be read stops the app from loading.
 */
import { describe, expect, it } from 'vitest';

import { defineRecurringJob } from './define';

describe('defineRecurringJob', () => {
  it('takes a kebab-case name and a valid schedule, and refuses anything else', () => {
    /**
     * Does nothing.
     *
     * @returns An empty summary.
     */
    const run = async () => ({ summary: {} });

    expect(defineRecurringJob({ name: 'adiutor-tests', schedule: '0 * * * *', run }).name).toBe(
      'adiutor-tests',
    );
    expect(() =>
      defineRecurringJob({ name: 'Adiutor_Tests', schedule: '0 * * * *', run }),
    ).toThrow();
    expect(() =>
      defineRecurringJob({ name: 'adiutor-tests', schedule: 'every hour', run }),
    ).toThrow();
  });
});

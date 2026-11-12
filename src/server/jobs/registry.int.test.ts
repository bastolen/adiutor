/**
 * @file Keeps the registry and the job names the Jobs page words
 * (`src/lib/job-names.ts`) the same: every recurring job and kind of queued
 * job has its description in the messages, in the order the tick runs them.
 */
import { describe, expect, it } from 'vitest';

import { QUEUED_JOB_NAMES, RECURRING_JOB_NAMES } from '@/lib/job-names';

import { QUEUED_JOBS, RECURRING_JOBS } from './registry';

describe('the registry', () => {
  it('lists exactly the jobs the Jobs page has words for, in the same order', () => {
    expect(RECURRING_JOBS.map((job) => job.name)).toEqual(RECURRING_JOB_NAMES);
    expect(QUEUED_JOBS.map((kind) => kind.name)).toEqual(QUEUED_JOB_NAMES);
  });
});

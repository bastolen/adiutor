/**
 * @file Tests for the Jobs page's actions: running a job that fails says so
 * as an error, with its reference when it has one. The rest is the services'
 * (`controls.int.test.ts`) and the Jobs page's (`e2e/jobs.spec.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { runJobFromPage } from '@/server/jobs';

import form from '../../../../../../tests/ui/form';
import { runJobAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/jobs', () => ({
  discardFailedJobs: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  retryFailedJobs: vi.fn(),
  runJobFromPage: vi.fn(),
}));

/** The acting staff Admin. */
const admin = { id: 'admin-1' } as Awaited<ReturnType<typeof getActor>>;

beforeEach(() => {
  vi.mocked(getActor).mockResolvedValue(admin);
});

describe('runJobAction', () => {
  it('shows a failed run as an error, with its reference when it has one', async () => {
    vi.mocked(runJobFromPage).mockResolvedValueOnce({
      job: 'invitation-reminders',
      status: 'failed',
      summary: { sent: 1, failed: 1 },
      runId: 'run-2',
      errorReference: '7KQ2-M9XD',
    });
    vi.mocked(runJobFromPage).mockResolvedValueOnce({
      job: 'invitation-reminders',
      status: 'failed',
      summary: {},
      runId: 'run-3',
      errorReference: null,
    });

    expect(await runJobAction(null, form({ job: 'invitation-reminders' }))).toEqual({
      ok: false,
      message: 'invitation-reminders ran, but failed. Error reference: 7KQ2-M9XD.',
    });
    expect(await runJobAction(null, form({ job: 'invitation-reminders' }))).toEqual({
      ok: false,
      message: 'invitation-reminders ran, but failed.',
    });
  });
});

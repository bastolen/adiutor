/**
 * @file Tests for the Jobs page's actions: running a job now says how it
 * went (a failed run as an error, with its reference), and retrying or
 * discarding acts on one job by ID or on every failed job of a kind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { discardFailedJobs, retryFailedJobs, runJobFromPage } from '@/server/jobs';

import { discardFailedJobsAction, retryFailedJobsAction, runJobAction } from './actions';

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

/** A failed job's ID. */
const JOB_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/**
 * Builds a form.
 *
 * @param fields - The fields.
 * @returns The form data.
 */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([name, value]) => data.set(name, value));
  return data;
}

beforeEach(() => {
  vi.mocked(getActor).mockResolvedValue(admin);
});

describe('runJobAction', () => {
  it('says the job ran', async () => {
    vi.mocked(runJobFromPage).mockResolvedValue({
      job: 'retention',
      status: 'succeeded',
      summary: {},
      runId: 'run-1',
      errorReference: null,
    });

    expect(await runJobAction(null, form({ job: 'retention' }))).toEqual({
      ok: true,
      message: 'retention ran.',
    });
    expect(runJobFromPage).toHaveBeenCalledWith({ name: 'app context' }, admin, 'retention');
  });

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

describe('retryFailedJobsAction and discardFailedJobsAction', () => {
  it('act on one job by its ID, or on every failed job of a kind', async () => {
    vi.mocked(retryFailedJobs).mockResolvedValue(1);
    vi.mocked(discardFailedJobs).mockResolvedValue(3);

    expect(await retryFailedJobsAction(null, form({ id: JOB_ID }))).toEqual({
      ok: true,
      message: '1 job is back in the queue for the next tick.',
    });
    expect(await discardFailedJobsAction(null, form({ kind: 'security-notice' }))).toEqual({
      ok: true,
      message: '3 jobs discarded.',
    });

    expect(retryFailedJobs).toHaveBeenCalledWith({ name: 'app context' }, admin, { id: JOB_ID });
    expect(discardFailedJobs).toHaveBeenCalledWith({ name: 'app context' }, admin, {
      kind: 'security-notice',
    });
  });
});

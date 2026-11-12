/**
 * @file Server actions for the Jobs page's controls, for staff Admins
 * (`jobs:manage`): run a scheduled job now, pause and resume a job or a kind
 * of queued job, and retry or discard failed queued jobs (one, or every one
 * of a kind). Each checks the session and lets the service check
 * permissions, then refreshes the page. Messages come from
 * `admin.jobs.actions`.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import {
  discardFailedJobs,
  type FailedJobsSelection,
  pauseJob,
  resumeJob,
  retryFailedJobs,
  runJobFromPage,
} from '@/server/jobs';

/**
 * Runs a scheduled job now. A run that fails still ran: it says so, with its
 * error's reference, as an error.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `job`, the job's name.
 * @returns How the run went, or why it couldn't start.
 */
export async function runJobAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const job = field(formData, 'job');
    const result = await runJobFromPage(appContext, actor, job);
    refresh();
    const t = await getTranslations('admin.jobs.actions');
    if (result.status === 'failed') {
      return {
        ok: false,
        message: result.errorReference
          ? t('ranFailedWithReference', { job, reference: result.errorReference })
          : t('ranFailed', { job }),
      };
    }
    return { ok: true, message: t('ran', { job }) };
  });
}

/**
 * Pauses a scheduled job or a kind of queued job.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `job`, the job's or kind's name.
 * @returns A confirmation, or why it failed.
 */
export async function pauseJobAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const job = field(formData, 'job');
    await pauseJob(appContext, actor, job);
    refresh();
    const t = await getTranslations('admin.jobs.actions');
    return { ok: true, message: t('paused', { job }) };
  });
}

/**
 * Resumes a paused scheduled job or kind of queued job.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `job`, the job's or kind's name.
 * @returns A confirmation, or why it failed.
 */
export async function resumeJobAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const job = field(formData, 'job');
    await resumeJob(appContext, actor, job);
    refresh();
    const t = await getTranslations('admin.jobs.actions');
    return { ok: true, message: t('resumed', { job }) };
  });
}

/**
 * Reads which failed jobs a form names: one by `id`, else every one of a
 * `kind`.
 *
 * @param formData - Fields `id` or `kind`.
 * @returns The selection; the service checks it.
 */
function selectionOf(formData: FormData): FailedJobsSelection {
  const id = formData.get('id');
  return typeof id === 'string' && id ? { id } : { kind: field(formData, 'kind') };
}

/**
 * Puts failed queued jobs back in the queue for the next tick.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `id` for one job, or `kind` for every failed job of a kind.
 * @returns How many were put back, or why it failed.
 */
export async function retryFailedJobsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const count = await retryFailedJobs(appContext, actor, selectionOf(formData));
    refresh();
    const t = await getTranslations('admin.jobs.actions');
    return { ok: true, message: t('retried', { count }) };
  });
}

/**
 * Discards failed queued jobs, so they never run.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `id` for one job, or `kind` for every failed job of a kind.
 * @returns How many were discarded, or why it failed.
 */
export async function discardFailedJobsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const count = await discardFailedJobs(appContext, actor, selectionOf(formData));
    refresh();
    const t = await getTranslations('admin.jobs.actions');
    return { ok: true, message: t('discarded', { count }) };
  });
}

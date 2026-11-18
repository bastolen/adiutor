/**
 * @file Tests for the action that changes a request's details: it passes on
 * what the form started from, and refreshes the page also when a colleague
 * changed the same detail meanwhile, so the dialog starts from the request
 * as it is when it's opened again. The services' own rules are in
 * `src/server/requests`.
 */
import { refresh } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { updateRequestDetails } from '@/server/requests';

import { updateDetailsAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({
  changeRequestStatus: vi.fn(),
  replyToRequest: vi.fn(),
  updateRequestDetails: vi.fn(),
}));

/** The staff member editing the details. */
const support = { id: 'support-1' } as Awaited<ReturnType<typeof getActor>>;

/**
 * Builds the dialog's form: a corrected title, the rest as it started.
 *
 * @returns The form data.
 */
function form(): FormData {
  const data = new FormData();
  Object.entries({
    request: '142',
    title: 'The printer is broken',
    type: 'bug',
    priority: 'normal',
    was_title: 'The printr is broken',
    was_type: 'bug',
    was_priority: 'normal',
  }).forEach(([name, value]) => data.set(name, value));
  return data;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(updateRequestDetails).mockReset();
  vi.mocked(getActor).mockResolvedValue(support);
});

describe('updateDetailsAction', () => {
  it('saves the details with what the form started from, and refreshes the page', async () => {
    vi.mocked(updateRequestDetails).mockResolvedValue({ changed: 1 });

    expect(await updateDetailsAction(null, form())).toEqual({
      ok: true,
      message: 'Details saved.',
    });

    expect(updateRequestDetails).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      title: 'The printer is broken',
      type: 'bug',
      priority: 'normal',
      was: { title: 'The printr is broken', type: 'bug', priority: 'normal' },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says so when nothing was changed', async () => {
    vi.mocked(updateRequestDetails).mockResolvedValue({ changed: 0 });

    expect(await updateDetailsAction(null, form())).toEqual({
      ok: true,
      message: 'Nothing changed.',
    });
  });

  it('shows the request as it is now when a colleague changed the same detail meanwhile', async () => {
    vi.mocked(updateRequestDetails).mockRejectedValue(
      new ServiceError('conflict', 'errors.requests.detailsChanged'),
    );

    expect(await updateDetailsAction(null, form())).toEqual({
      ok: false,
      message: 'This request’s details changed in the meantime. Check them and try again.',
    });

    // Or the dialog would start from the same details again, and be refused again.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('leaves the page as it is for any other refusal', async () => {
    vi.mocked(updateRequestDetails).mockRejectedValue(
      new ServiceError('forbidden', 'errors.forbidden'),
    );

    expect(await updateDetailsAction(null, form())).toMatchObject({ ok: false });

    expect(refresh).not.toHaveBeenCalled();
  });
});

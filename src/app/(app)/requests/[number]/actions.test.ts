/**
 * @file Tests for the actions that change a request's details and its
 * assignees. The details action passes on what the form started from, and
 * refreshes the page also when a colleague changed the same detail
 * meanwhile, so the dialog starts from the request as it is when it's opened
 * again. The assignees action adds and removes only what the dialog's
 * checkboxes changed. The services' own rules are in `src/server/requests`.
 */
import { refresh } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { changeAssignees, updateRequestDetails } from '@/server/requests';

import { changeAssigneesAction, updateDetailsAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({
  changeAssignees: vi.fn(),
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

describe('changeAssigneesAction', () => {
  /**
   * Builds a form from its fields, each sent once per value.
   *
   * @param fields - The fields and their values.
   * @returns The form data.
   */
  const assigneesForm = (fields: Record<string, string[]>) => {
    const data = new FormData();
    data.set('request', '142');
    Object.entries(fields).forEach(([name, values]) =>
      values.forEach((value) => data.append(name, value)),
    );
    return data;
  };

  beforeEach(() => {
    vi.mocked(changeAssignees).mockReset();
  });

  it('adds who was ticked and removes who was unticked, leaving the rest alone', async () => {
    vi.mocked(changeAssignees).mockResolvedValue({ added: 1, removed: 1 });

    expect(
      await changeAssigneesAction(
        null,
        assigneesForm({ assignee: ['kept', 'new'], was_assignee: ['kept', 'gone'] }),
      ),
    ).toEqual({ ok: true, message: 'Assignees saved.' });

    expect(changeAssignees).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      add: ['new'],
      remove: ['gone'],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('adds whoever "Assign to me" sends', async () => {
    vi.mocked(changeAssignees).mockResolvedValue({ added: 1, removed: 0 });

    await changeAssigneesAction(null, assigneesForm({ add: [support.id] }));

    expect(changeAssignees).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      add: [support.id],
      remove: [],
    });
  });

  it('says so when nothing changed', async () => {
    vi.mocked(changeAssignees).mockResolvedValue({ added: 0, removed: 0 });

    expect(await changeAssigneesAction(null, assigneesForm({}))).toEqual({
      ok: true,
      message: 'Nothing changed.',
    });
  });
});

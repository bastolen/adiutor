/**
 * @file Tests for the actions that change a request's details, its
 * assignees and its subscribers. The details action passes on what the form
 * started from, and refreshes the page also when a colleague changed the
 * same detail meanwhile, so the dialog starts from the request as it is when
 * it's opened again. The assignees and subscribers actions add and remove
 * only what their dialog's checkboxes changed. The activity view's action
 * passes the menus' choice on and refreshes the page. The services' own
 * rules are in `src/server/requests`.
 */
import { refresh } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import {
  changeAssignees,
  changeRequestStatus,
  changeSubscribers,
  setActivityView,
  subscribe,
  unsubscribe,
  updateRequestDetails,
} from '@/server/requests';

import {
  changeAssigneesAction,
  changeSubscribersAction,
  changeStatusAction,
  changeSubscriptionAction,
  saveActivityViewAction,
  updateDetailsAction,
} from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({
  changeAssignees: vi.fn(),
  changeRequestStatus: vi.fn(),
  changeSubscribers: vi.fn(),
  replyToRequest: vi.fn(),
  setActivityView: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
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

/**
 * Builds a form for request 142 from its fields, each sent once per value.
 *
 * @param fields - The fields and their values.
 * @returns The form data.
 */
function formOf(fields: Record<string, string[]>): FormData {
  const data = new FormData();
  data.set('request', '142');
  Object.entries(fields).forEach(([name, values]) =>
    values.forEach((value) => data.append(name, value)),
  );
  return data;
}

describe('changeSubscriptionAction', () => {
  beforeEach(() => {
    vi.mocked(subscribe).mockReset().mockResolvedValue({ subscribed: true });
    vi.mocked(unsubscribe).mockReset().mockResolvedValue({ unsubscribed: true });
  });

  it('subscribes whoever pressed Subscribe, and says so', async () => {
    expect(await changeSubscriptionAction(null, formOf({ subscribe: ['yes'] }))).toEqual({
      ok: true,
      message: 'You’re subscribed to this request.',
    });

    expect(subscribe).toHaveBeenCalledWith({ name: 'app context' }, support, { request: '142' });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('unsubscribes whoever pressed Unsubscribe, and says so', async () => {
    expect(await changeSubscriptionAction(null, formOf({ subscribe: ['no'] }))).toEqual({
      ok: true,
      message: 'You’re no longer subscribed to this request.',
    });

    expect(unsubscribe).toHaveBeenCalledWith({ name: 'app context' }, support, { request: '142' });
    expect(subscribe).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says why when it is refused, and leaves the page as it is', async () => {
    vi.mocked(subscribe).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(await changeSubscriptionAction(null, formOf({ subscribe: ['yes'] }))).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('changeSubscribersAction', () => {
  beforeEach(() => {
    vi.mocked(changeSubscribers).mockReset();
  });

  it('subscribes who was ticked and unsubscribes who was unticked, leaving the rest alone', async () => {
    vi.mocked(changeSubscribers).mockResolvedValue({ added: 1, removed: 1 });

    expect(
      await changeSubscribersAction(
        null,
        formOf({ subscriber: ['kept', 'new'], was_subscriber: ['kept', 'gone'] }),
      ),
    ).toEqual({ ok: true, message: 'Subscribers saved.' });

    expect(changeSubscribers).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      add: ['new'],
      remove: ['gone'],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says so when nothing changed', async () => {
    vi.mocked(changeSubscribers).mockResolvedValue({ added: 0, removed: 0 });

    expect(await changeSubscribersAction(null, formOf({}))).toEqual({
      ok: true,
      message: 'Nothing changed.',
    });
  });

  it('says who can’t be subscribed when the service refuses someone', async () => {
    vi.mocked(changeSubscribers).mockRejectedValue(
      new ServiceError('invalid', 'errors.requests.notSubscribable'),
    );

    expect(await changeSubscribersAction(null, formOf({ subscriber: ['gone'] }))).toEqual({
      ok: false,
      message:
        'Only active people who can read this request can be subscribed. Check who you chose and try again.',
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('saveActivityViewAction', () => {
  it('saves what the menus chose and refreshes the page, without a message', async () => {
    vi.mocked(setActivityView).mockResolvedValue({ order: 'newest', groups: ['replies'] });

    expect(await saveActivityViewAction({ order: 'newest', groups: ['replies'] })).toEqual({
      ok: true,
    });
    expect(setActivityView).toHaveBeenCalledWith({ name: 'app context' }, support, {
      order: 'newest',
      groups: ['replies'],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says why when the service refuses, and refreshes nothing', async () => {
    vi.mocked(setActivityView).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(await saveActivityViewAction({ order: 'newest' })).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('changeStatusAction', () => {
  /**
   * Builds the form of a status change.
   *
   * @returns The form data: done, from what the page showed.
   */
  function statusForm(): FormData {
    const data = new FormData();
    data.set('request', '142');
    data.set('status', 'done');
    data.set('from', 'in_progress');
    return data;
  }

  it('sends the status the page showed and refreshes the page', async () => {
    vi.mocked(changeRequestStatus).mockResolvedValue({
      changed: true,
      reopened: false,
      status: 'done',
    });

    expect(await changeStatusAction(null, statusForm())).toMatchObject({ ok: true });
    expect(changeRequestStatus).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      status: 'done',
      from: 'in_progress',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes the page and says why when a colleague changed the status first', async () => {
    vi.mocked(changeRequestStatus).mockRejectedValue(
      new ServiceError('conflict', 'errors.requests.statusChanged'),
    );

    expect(await changeStatusAction(null, statusForm())).toEqual({
      ok: false,
      message: 'This request’s status changed in the meantime. Check it and try again.',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes nothing when the service refuses for another reason', async () => {
    vi.mocked(changeRequestStatus).mockRejectedValue(
      new ServiceError('forbidden', 'errors.forbidden'),
    );

    expect(await changeStatusAction(null, statusForm())).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

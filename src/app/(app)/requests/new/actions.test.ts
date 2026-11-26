/**
 * @file Tests for the action that raises a request: it refreshes before it
 * redirects to the new request, so the pages Next kept alive (this form, the
 * list) are dropped; a refused request does neither. And for the action that
 * lists who the staff can raise one for.
 */
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { listRaisableFor, raiseRequest } from '@/server/requests';

import form from '../../../../../tests/ui/form';
import raiseRequestAction, { raiseForChoicesAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({ listRaisableFor: vi.fn(), raiseRequest: vi.fn() }));

/** The Client raising the request. */
const client = { id: 'client-1' } as Awaited<ReturnType<typeof getActor>>;

/** The fields of the form, as the page sends it. */
const FIELDS = {
  company: 'adiutor-tests',
  title: 'The printer is broken',
  type: 'bug',
  description: 'It prints blank pages.',
  priority: '',
  raised_for: 'casey-key',
};

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(raiseRequest).mockReset();
  vi.mocked(getActor).mockResolvedValue(client);
});

describe('raiseRequestAction', () => {
  it('refreshes, then goes to the new request, which confirms it', async () => {
    vi.mocked(raiseRequest).mockResolvedValue({ id: 'request-1', number: 142 });
    const sent = form(FIELDS);
    // The files uploaded for the description, by their IDs.
    sent.append('attachment', 'attachment-1');
    sent.append('attachment', 'attachment-2');

    await expect(raiseRequestAction(null, sent)).rejects.toThrow('NEXT_REDIRECT');

    expect(raiseRequest).toHaveBeenCalledWith({ name: 'app context' }, client, {
      companyId: 'adiutor-tests',
      title: 'The printer is broken',
      type: 'bug',
      description: 'It prints blank pages.',
      priority: '',
      attachments: ['attachment-1', 'attachment-2'],
      raisedFor: 'casey-key',
    });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/requests/142?raised=1');
    // A redirect alone would leave the form, still filled in, and the list as they were.
    expect(refresh).toHaveBeenCalledBefore(vi.mocked(redirect));
  });

  it('says why a request was refused, and stays on the form as it is', async () => {
    vi.mocked(raiseRequest).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(await raiseRequestAction(null, form(FIELDS))).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('raiseForChoicesAction', () => {
  beforeEach(() => {
    vi.mocked(listRaisableFor).mockReset();
  });

  it('lists who the viewer can raise a request in the company for', async () => {
    const people = [{ key: 'casey-key', name: 'Casey Client' }];
    vi.mocked(listRaisableFor).mockResolvedValue(people);

    expect(await raiseForChoicesAction('adiutor-tests')).toEqual(people);
    expect(listRaisableFor).toHaveBeenCalledWith({ name: 'app context' }, client, 'adiutor-tests');
  });

  it('lists nobody for anything but a company’s URL name, or a company the viewer may not use', async () => {
    expect(await raiseForChoicesAction({ company: 'adiutor-tests' })).toEqual([]);
    expect(await raiseForChoicesAction('')).toEqual([]);
    expect(listRaisableFor).not.toHaveBeenCalled();

    vi.mocked(listRaisableFor).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));
    expect(await raiseForChoicesAction('adiutor-tests')).toEqual([]);
  });
});

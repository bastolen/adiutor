/**
 * @file Tests for the action that raises a request: it refreshes before it
 * redirects to the new request, so the pages Next kept alive (this form, the
 * list) are dropped; a refused request does neither.
 */
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { raiseRequest } from '@/server/requests';

import raiseRequestAction from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({ raiseRequest: vi.fn() }));

/** The Client raising the request. */
const client = { id: 'client-1' } as Awaited<ReturnType<typeof getActor>>;

/**
 * Builds the form as the page sends it.
 *
 * @returns The form data.
 */
function form(): FormData {
  const data = new FormData();
  Object.entries({
    company: 'adiutor-tests',
    title: 'The printer is broken',
    type: 'bug',
    description: 'It prints blank pages.',
    priority: '',
  }).forEach(([name, value]) => data.set(name, value));
  return data;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(raiseRequest).mockReset();
  vi.mocked(getActor).mockResolvedValue(client);
});

describe('raiseRequestAction', () => {
  it('refreshes, then goes to the new request, which confirms it', async () => {
    vi.mocked(raiseRequest).mockResolvedValue({ id: 'request-1', number: 142 });

    await expect(raiseRequestAction(null, form())).rejects.toThrow('NEXT_REDIRECT');

    expect(raiseRequest).toHaveBeenCalledWith({ name: 'app context' }, client, {
      companyId: 'adiutor-tests',
      title: 'The printer is broken',
      type: 'bug',
      description: 'It prints blank pages.',
      priority: '',
    });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/requests/142?raised=1');
    // A redirect alone would leave the form, still filled in, and the list as they were.
    expect(refresh).toHaveBeenCalledBefore(vi.mocked(redirect));
  });

  it('says why a request was refused, and stays on the form as it is', async () => {
    vi.mocked(raiseRequest).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(await raiseRequestAction(null, form())).toMatchObject({ ok: false });

    expect(refresh).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

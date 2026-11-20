/**
 * @file Tests for the action behind the list of people at "@": what it
 * takes from the browser, what it gives back, and that a request or company
 * the viewer may not write in has nobody to mention. Who may be mentioned is
 * the service's (`src/server/requests/mentions.int.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { forbiddenError, notFoundError } from '@/server/errors';
import getStaffName from '@/server/people/staff-name';
import { listMentionable } from '@/server/requests';

import { mentionChoicesAction } from './mention-actions';

vi.mock('@/server/app-context', () => ({ default: { db: 'the database' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/people/staff-name', () => ({ default: vi.fn() }));
vi.mock('@/server/requests', () => ({ listMentionable: vi.fn() }));

/** Whoever is writing. */
const writer = { id: 'client-1' } as Awaited<ReturnType<typeof getActor>>;

beforeEach(() => {
  vi.mocked(listMentionable).mockReset();
  vi.mocked(getActor).mockResolvedValue(writer);
  vi.mocked(getStaffName).mockResolvedValue('Adiutor Tests');
});

describe('mentionChoicesAction', () => {
  it('gives the people who can be mentioned in a request, the staff with the staff’s name as their label', async () => {
    vi.mocked(listMentionable).mockResolvedValue([
      { key: 'key-of-casey', name: 'Casey Client', staff: false },
      { key: 'key-of-sam', name: 'Sam Support', staff: true },
    ]);

    expect(await mentionChoicesAction({ request: '142' })).toEqual([
      { key: 'key-of-casey', name: 'Casey Client', label: null },
      { key: 'key-of-sam', name: 'Sam Support', label: 'Adiutor Tests' },
    ]);
    expect(listMentionable).toHaveBeenCalledWith({ db: 'the database' }, writer, {
      request: '142',
    });
  });

  it('asks for a company’s people for a request that isn’t raised yet', async () => {
    vi.mocked(listMentionable).mockResolvedValue([]);

    expect(await mentionChoicesAction({ company: 'adiutor-tests-alpha' })).toEqual([]);

    expect(listMentionable).toHaveBeenCalledWith({ db: 'the database' }, writer, {
      company: 'adiutor-tests-alpha',
    });
  });

  it('passes on nothing but the request or the company it was asked about', async () => {
    vi.mocked(listMentionable).mockResolvedValue([]);

    await mentionChoicesAction({ request: '142', company: 'other', admin: true });

    expect(listMentionable).toHaveBeenCalledWith({ db: 'the database' }, writer, {
      request: '142',
    });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', '142'],
    ['a number for a request', { request: 142 }],
    ['a list for a company', { company: ['adiutor-tests-alpha'] }],
    ['neither a request nor a company', { user: 'sam' }],
  ])('gives nobody for %s, without asking', async (_what, where) => {
    expect(await mentionChoicesAction(where)).toEqual([]);

    expect(listMentionable).not.toHaveBeenCalled();
  });

  it('gives nobody for a request the viewer may not see, or may not write in', async () => {
    vi.mocked(listMentionable).mockRejectedValueOnce(notFoundError());
    expect(await mentionChoicesAction({ request: '999' })).toEqual([]);

    vi.mocked(listMentionable).mockRejectedValueOnce(forbiddenError());
    expect(await mentionChoicesAction({ request: '142' })).toEqual([]);
  });

  it('doesn’t hide an error that isn’t about what the viewer may do', async () => {
    vi.mocked(listMentionable).mockRejectedValue(new Error('the database is away'));

    await expect(mentionChoicesAction({ request: '142' })).rejects.toThrow('the database is away');
  });
});

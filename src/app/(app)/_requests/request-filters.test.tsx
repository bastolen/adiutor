/**
 * @file Tests for {@link parseRequestFilters}: what it reads from a page's
 * query parameters, what it drops for each kind of reader, and the order of
 * the parameters links are built from; and for {@link viewParams}, what the
 * list and the board share.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';
import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';

import { parseRequestFilters, viewParams } from './request-filters';

vi.mock('@/server/authz', () => ({ getStaffPermissionsInCompanies: vi.fn() }));

/** What a staff member who works on requests may do. */
const STAFF_WORK = new Set<Permission>([
  'requests:view',
  'requests:contribute',
  'requests:manage',
  'requests:view-internal',
]);

/** What a staff member who only reads requests (Finance, Support) may do: no assigning. */
const STAFF_READ = new Set<Permission>(['requests:view', 'requests:view-internal']);

/** The viewer; the mocked permissions decide what they are. */
const actor = { id: 'viewer-1' } as Actor;

/** Two companies, so the Company filter is offered. */
const companies = [{ slug: 'adiutor-tests' }, { slug: 'adiutor-tests-paging' }];

/** Request types, one of them archived: it can still be filtered by. */
const types = [{ key: 'question' }, { key: 'old-type' }];

/** Staff who can be assigned. */
const assignable = [{ id: 'staff-1' }];

/**
 * Parses with the usual inputs.
 *
 * @param searchParams - The query parameters.
 * @param company - The company whose page it is, if any.
 * @returns The filters.
 */
function parse(searchParams: Record<string, string | string[] | undefined>, company?: string) {
  return parseRequestFilters({ searchParams, actor, company, companies, types, assignable });
}

beforeEach(() => {
  vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set());
});

describe('parseRequestFilters', () => {
  it('starts on the requests still worked on, without a search or filter', () => {
    const filters = parse({});
    expect(filters).toMatchObject({
      internal: false,
      search: '',
      status: 'active',
      type: undefined,
      priority: undefined,
      assignee: undefined,
      company: undefined,
      narrowed: false,
    });
    expect(filters.requested).toEqual({ sort: 'activity', dir: 'desc', page: 1, size: 25 });
  });

  it('reads the search trimmed, and a valid status', () => {
    const filters = parse({ q: '  AD-14 ', status: 'closed' });
    expect(filters).toMatchObject({ search: 'AD-14', status: 'closed', narrowed: true });
  });

  it('falls back to active for a status it does not know', () => {
    expect(parse({ status: 'bogus' }).status).toBe('active');
  });

  it('keeps a type the menu offers, archived ones too, and drops any other', () => {
    expect(parse({ type: 'old-type' }).type).toBe('old-type');
    expect(parse({ type: 'nope' }).type).toBeUndefined();
  });

  it('keeps a company the viewer sees, and drops any other', () => {
    expect(parse({ company: 'adiutor-tests' }).company).toBe('adiutor-tests');
    expect(parse({ company: 'someone-elses' }).company).toBeUndefined();
  });

  it('offers the Company filter only across several companies', () => {
    expect(parse({}).showsCompany).toBe(true);
    expect(
      parseRequestFilters({
        searchParams: {},
        actor,
        companies: [{ slug: 'adiutor-tests' }],
        types,
        assignable,
      }).showsCompany,
    ).toBe(false);
  });

  it('ignores the company parameter on a company page, which has no Company filter', () => {
    const filters = parse({ company: 'adiutor-tests-paging' }, 'adiutor-tests');
    expect(filters.company).toBeUndefined();
    expect(filters.showsCompany).toBe(false);
    expect(filters.pageParams.company).toBeUndefined();
  });

  it('drops the priority and the assignee for someone at a company', () => {
    const filters = parse({ priority: 'high', assignee: 'none', sort: 'priority' });
    expect(filters.internal).toBe(false);
    expect(filters.priority).toBeUndefined();
    expect(filters.assignee).toBeUndefined();
    expect(filters.narrowed).toBe(false);
    // The company's table has no priority sort.
    expect(filters.requested.sort).toBe('activity');
  });

  it('keeps the priority, the sort by priority and the assignee for the staff', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    const filters = parse({ priority: 'high', assignee: 'staff-1', sort: 'priority' });
    expect(filters).toMatchObject({
      internal: true,
      canBeAssigned: true,
      priority: 'high',
      assignee: 'staff-1',
      narrowed: true,
    });
    expect(filters.requested.sort).toBe('priority');
  });

  it('drops a priority that is none of the priorities, and an assignee the menu does not offer', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    const filters = parse({ priority: 'urgent-ish', assignee: 'someone' });
    expect(filters.priority).toBeUndefined();
    expect(filters.assignee).toBeUndefined();
  });

  it('allows "me" and "none" as assignees for staff who can be assigned', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    expect(parse({ assignee: 'me' }).assignee).toBe('me');
    expect(parse({ assignee: 'none' }).assignee).toBe('none');
  });

  it('allows "me" only for staff who can be assigned', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_READ);
    const filters = parse({ assignee: 'me' });
    expect(filters.canBeAssigned).toBe(false);
    expect(filters.assignee).toBeUndefined();
    expect(parse({ assignee: 'none' }).assignee).toBe('none');
  });

  it('lists the page parameters in the order the search form submits them', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    const filters = parse({
      q: 'login',
      status: 'closed',
      company: 'adiutor-tests',
      type: 'question',
      priority: 'low',
      assignee: 'me',
    });
    expect(Object.keys(filters.pageParams)).toEqual([
      'status',
      'only',
      'company',
      'type',
      'priority',
      'assignee',
      'q',
    ]);
    expect(filters.pageParams).toEqual({
      status: 'closed',
      company: 'adiutor-tests',
      type: 'question',
      priority: 'low',
      assignee: 'me',
      q: 'login',
    });
  });

  it('leaves the default status out of the page parameters', () => {
    expect(parse({ status: 'active' }).pageParams.status).toBeUndefined();
  });

  it('reads one status instead of a group, which narrows the view and keeps its parameter', () => {
    const filters = parse({ status: 'closed', only: 'waiting' });
    expect(filters).toMatchObject({ only: 'waiting', narrowed: true });
    expect(filters.pageParams).toMatchObject({ status: undefined, only: 'waiting' });
    expect(parse({ only: 'bogus' }).only).toBeUndefined();
  });

  it('words a status for the viewer’s strongest part', () => {
    expect(parse({}).audience).toBe('follower');
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set(['requests:contribute']));
    expect(parse({}).audience).toBe('contributor');
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(
      new Set(['requests:contribute', 'requests:view-internal']),
    );
    expect(parse({}).audience).toBe('staff');
  });

  it('reads the table state from the parameters', () => {
    const filters = parse({ sort: 'raised', dir: 'asc', page: '3', size: '50' });
    expect(filters.requested).toEqual({ sort: 'raised', dir: 'asc', page: 3, size: 50 });
  });
});

describe('viewParams', () => {
  it('keeps what narrows the requests down, and drops what picks their statuses', () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    const filters = parse({
      q: 'printer',
      status: 'closed',
      only: 'done',
      company: 'adiutor-tests',
      type: 'question',
      priority: 'high',
      assignee: 'me',
    });

    expect(viewParams(filters)).toEqual({
      status: undefined,
      only: undefined,
      company: 'adiutor-tests',
      type: 'question',
      priority: 'high',
      assignee: 'me',
      q: 'printer',
    });
  });
});

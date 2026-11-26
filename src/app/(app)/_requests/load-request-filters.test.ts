/**
 * @file Tests for {@link loadRequestFilters}: it loads the staff who can be
 * assigned only for the staff, and reads the page's filters against what it
 * loaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';
import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  getRequestSettings,
  listAssignableStaff,
  listRequestCompanies,
  listRequestTypes,
} from '@/server/requests';

import loadRequestFilters from './load-request-filters';

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', async () => (await import('../../../../tests/authz-mock')).default());
vi.mock('@/server/requests', () => ({
  getRequestSettings: vi.fn(),
  listAssignableStaff: vi.fn(),
  listRequestCompanies: vi.fn(),
  listRequestTypes: vi.fn(),
}));

/** The viewer; the mocked permissions decide what they are. */
const viewer = { id: 'viewer-1' } as Actor;

/** What a staff member who works on requests may do. */
const STAFF_WORK = new Set<Permission>([
  'requests:view',
  'requests:contribute',
  'requests:manage',
  'requests:view-internal',
]);

beforeEach(() => {
  vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set());
  vi.mocked(listRequestCompanies).mockResolvedValue([
    { id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests', canRaise: true },
    { id: 'company-2', name: 'Adiutor Tests Paging', slug: 'adiutor-tests-paging', canRaise: true },
  ]);
  vi.mocked(getRequestSettings).mockResolvedValue({ prefix: 'AD', staffName: 'Adiutor Tests' });
  vi.mocked(listAssignableStaff).mockResolvedValue([{ id: 'staff-1', name: 'Sam Support' }]);
  vi.mocked(listRequestTypes).mockResolvedValue([
    { key: 'bug', name: 'Bug', description: '', startingPriority: null, archived: false },
  ]);
});

describe('loadRequestFilters', () => {
  it('loads no assignable staff for someone at a company, and drops their assignee filter', async () => {
    const loaded = await loadRequestFilters(
      viewer,
      { assignee: 'staff-1', company: 'adiutor-tests-paging', type: 'bug' },
      undefined,
    );

    expect(listAssignableStaff).not.toHaveBeenCalled();
    expect(loaded.assignable).toEqual([]);
    expect(loaded.settings).toEqual({ prefix: 'AD', staffName: 'Adiutor Tests' });
    expect(loaded.filters).toMatchObject({
      company: 'adiutor-tests-paging',
      type: 'bug',
      assignee: undefined,
    });
  });

  it('loads the assignable staff for the staff, who filter by them', async () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);

    const loaded = await loadRequestFilters(viewer, { assignee: 'staff-1' }, 'adiutor-tests');

    expect(listAssignableStaff).toHaveBeenCalledWith({ name: 'app context' }, viewer);
    expect(loaded.assignable).toHaveLength(1);
    // On a company's own page, the company comes from the page, not the query.
    expect(loaded.filters).toMatchObject({ assignee: 'staff-1', company: undefined });
  });
});

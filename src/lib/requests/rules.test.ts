/**
 * @file Tests for the rules of working on a request.
 */
import { describe, expect, it } from 'vitest';

import { getPermissions, type Permission } from '../authz/permissions';
import type { CompanyRole, PlatformRole } from '../authz/roles';
import {
  isReopening,
  mayBeAssigned,
  mayChangeStatus,
  maySetStatus,
  requestAudience,
  requestSide,
  statusAfterReply,
  statusChoices,
} from './rules';
import { REQUEST_STATUSES, type RequestStatus } from './values';

/**
 * The permissions of someone in an active company.
 *
 * @param platformRole - Their staff role, or `null`.
 * @param companyRole - Their role in the company, or `null` when they aren't a member.
 * @returns The permissions.
 */
function permissionsOf(
  platformRole: PlatformRole | null,
  companyRole: CompanyRole | null,
): Set<Permission> {
  return getPermissions({ platformRole, companyRole, company: { deactivated: false } });
}

/** A staff member who works on requests. */
const support = permissionsOf('support', null);

/** A staff member who only reads them. */
const finance = permissionsOf('finance', null);

/** Someone at the company who takes part. */
const client = permissionsOf(null, 'client');

/** Someone at the company who only follows. */
const watcher = permissionsOf(null, 'watcher');

describe('requestSide', () => {
  it('is the staff for those who work on requests, also in their own company', () => {
    expect(requestSide(support)).toBe('staff');
    expect(requestSide(permissionsOf('manager', 'client'))).toBe('staff');
    expect(requestSide(permissionsOf('platform_admin', null))).toBe('staff');
  });

  it('is the company for everyone else', () => {
    expect(requestSide(client)).toBe('company');
    expect(requestSide(permissionsOf(null, 'admin'))).toBe('company');
    // Finance only reads requests as staff; as a Client they take part for the company.
    expect(requestSide(permissionsOf('finance', 'client'))).toBe('company');
  });
});

describe('requestAudience', () => {
  it.each<[string, Set<Permission>, boolean, string]>([
    ['Support', support, false, 'staff'],
    ['Support who is also a Client', permissionsOf('support', 'client'), true, 'staff'],
    ['Finance', finance, false, 'staff'],
    ['Finance who is also a Client', permissionsOf('finance', 'client'), true, 'contributor'],
    ['Finance who is also a Watcher', permissionsOf('finance', 'watcher'), true, 'follower'],
    ['a company Admin', permissionsOf(null, 'admin'), true, 'contributor'],
    ['a Client', client, true, 'contributor'],
    ['a Watcher', watcher, true, 'follower'],
  ])('addresses %s as %s', (_who, permissions, isMember, audience) => {
    expect(requestAudience(permissions, isMember)).toBe(audience);
  });
});

describe('isReopening', () => {
  it('is any move from a closed status to one that is worked on', () => {
    expect(isReopening('done', 'open')).toBe(true);
    expect(isReopening('cancelled', 'in_progress')).toBe(true);
  });

  it('is nothing else', () => {
    expect(isReopening('open', 'todo')).toBe(false);
    expect(isReopening('waiting', 'done')).toBe(false);
    expect(isReopening('done', 'cancelled')).toBe(false);
  });
});

describe('mayChangeStatus', () => {
  it('lets the staff who work on requests set any other status', () => {
    REQUEST_STATUSES.forEach((from) => {
      REQUEST_STATUSES.forEach((to) => {
        expect(mayChangeStatus(support, from, to)).toBe(from !== to);
      });
    });
  });

  it('lets nobody set the status a request already has', () => {
    expect(mayChangeStatus(support, 'done', 'done')).toBe(false);
    expect(mayChangeStatus(client, 'cancelled', 'cancelled')).toBe(false);
  });

  it.each<[RequestStatus, RequestStatus[]]>([
    ['open', ['done', 'cancelled']],
    ['todo', ['done', 'cancelled']],
    ['in_progress', ['done', 'cancelled']],
    ['waiting', ['done', 'cancelled']],
    ['done', ['open']],
    ['cancelled', ['open']],
  ])('lets the company move a request that is %s to %j only', (from, allowed) => {
    expect(statusChoices(client, from)).toEqual(allowed);
    expect(statusChoices(permissionsOf(null, 'admin'), from)).toEqual(allowed);
  });

  it('lets those who only read change nothing', () => {
    REQUEST_STATUSES.forEach((from) => {
      expect(statusChoices(watcher, from)).toEqual([]);
      expect(statusChoices(finance, from)).toEqual([]);
    });
  });
});

describe('maySetStatus', () => {
  it('lets the staff who work on requests set every status', () => {
    REQUEST_STATUSES.forEach((to) => expect(maySetStatus(support, to)).toBe(true));
  });

  it('lets the company close and reopen only, whatever the request’s status', () => {
    expect(REQUEST_STATUSES.filter((to) => maySetStatus(client, to))).toEqual([
      'open',
      'done',
      'cancelled',
    ]);
  });

  it('lets those who only read set nothing', () => {
    REQUEST_STATUSES.forEach((to) => {
      expect(maySetStatus(watcher, to)).toBe(false);
      expect(maySetStatus(finance, to)).toBe(false);
    });
  });
});

describe('statusChoices', () => {
  it('lists every other status for the staff, in order', () => {
    expect(statusChoices(support, 'todo')).toEqual([
      'open',
      'in_progress',
      'waiting',
      'done',
      'cancelled',
    ]);
  });
});

describe('statusAfterReply', () => {
  it('puts a request back in progress when the company replies while it waits for them', () => {
    expect(statusAfterReply('company', 'waiting')).toBe('in_progress');
  });

  it('leaves the status alone otherwise, also on a closed request', () => {
    expect(statusAfterReply('staff', 'waiting')).toBe('waiting');
    expect(statusAfterReply('company', 'open')).toBe('open');
    expect(statusAfterReply('company', 'done')).toBe('done');
    expect(statusAfterReply('company', 'cancelled')).toBe('cancelled');
  });
});

describe('mayBeAssigned', () => {
  it('takes the staff who work on requests', () => {
    expect(mayBeAssigned(permissionsOf('platform_admin', null))).toBe(true);
    expect(mayBeAssigned(permissionsOf('manager', null))).toBe(true);
    expect(mayBeAssigned(support)).toBe(true);
  });

  it('refuses Finance, who only read requests, and the people of a company', () => {
    expect(mayBeAssigned(finance)).toBe(false);
    expect(mayBeAssigned(permissionsOf(null, 'admin'))).toBe(false);
    expect(mayBeAssigned(client)).toBe(false);
    expect(mayBeAssigned(watcher)).toBe(false);
  });
});

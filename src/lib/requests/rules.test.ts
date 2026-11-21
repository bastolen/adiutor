/**
 * @file Tests for the rules of working on a request.
 */
import { describe, expect, it } from 'vitest';

import { getPermissions, type Permission } from '../authz/permissions';
import type { CompanyRole, PlatformRole } from '../authz/roles';
import {
  isReopening,
  mayAnswerSolution,
  mayBeAssigned,
  mayChangeStatus,
  mayEditDescription,
  mayEditNote,
  mayEditReply,
  mayProposeSolution,
  maySetStatus,
  mayWriteNote,
  requestAudience,
  requestSide,
  statusAfterAnswer,
  statusAfterReply,
  statusChangeKind,
  statusChoices,
  subscriberScope,
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
  it('lets the staff who work on requests set any other status, but waiting for approval', () => {
    REQUEST_STATUSES.forEach((from) => {
      REQUEST_STATUSES.forEach((to) => {
        // Waiting for approval comes only with the reply that holds the solution.
        expect(mayChangeStatus(support, from, to)).toBe(from !== to && to !== 'proposed');
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

describe('mayEditDescription', () => {
  it('lets the staff who work on requests and the company’s people who take part edit it', () => {
    expect(mayEditDescription(support, 'open')).toBe(true);
    expect(mayEditDescription(client, 'waiting')).toBe(true);
    expect(mayEditDescription(permissionsOf(null, 'admin'), 'in_progress')).toBe(true);
  });

  it('refuses Watchers and Finance, who only read, and a closed request', () => {
    expect(mayEditDescription(watcher, 'open')).toBe(false);
    expect(mayEditDescription(finance, 'open')).toBe(false);
    expect(mayEditDescription(support, 'done')).toBe(false);
    expect(mayEditDescription(client, 'cancelled')).toBe(false);
  });
});

describe('mayEditReply', () => {
  it('lets only the one who wrote it edit it, while the request is open', () => {
    expect(mayEditReply(client, 'open', true)).toBe(true);
    expect(mayEditReply(support, 'todo', true)).toBe(true);
    expect(mayEditReply(support, 'open', false)).toBe(false);
    expect(mayEditReply(client, 'done', true)).toBe(false);
    // Someone who no longer takes part (now a Watcher) can't edit what they wrote.
    expect(mayEditReply(watcher, 'open', true)).toBe(false);
  });
});

describe('mayWriteNote', () => {
  it('lets only the staff who work on requests write internal notes', () => {
    expect(mayWriteNote(support)).toBe(true);
    expect(mayWriteNote(permissionsOf('platform_admin', null))).toBe(true);
    // Finance reads notes but doesn't write them; nobody at a company sees them.
    expect(mayWriteNote(finance)).toBe(false);
    expect(mayWriteNote(client)).toBe(false);
    expect(mayWriteNote(permissionsOf(null, 'admin'))).toBe(false);
    expect(mayWriteNote(watcher)).toBe(false);
  });
});

describe('mayEditNote', () => {
  it('lets only the one who wrote it edit it, while the request is open and they still work on it', () => {
    expect(mayEditNote(support, 'in_progress', true)).toBe(true);
    expect(mayEditNote(support, 'open', false)).toBe(false);
    expect(mayEditNote(support, 'done', true)).toBe(false);
    // A staff member who now only reads requests (Finance) can't edit what they wrote.
    expect(mayEditNote(finance, 'open', true)).toBe(false);
  });
});

describe('subscriberScope', () => {
  it('lets the staff who work on requests change anyone’s subscription', () => {
    expect(subscriberScope(permissionsOf('platform_admin', null))).toBe('everyone');
    expect(subscriberScope(permissionsOf('manager', null))).toBe('everyone');
    expect(subscriberScope(support)).toBe('everyone');
    // Also in a company they're a member of.
    expect(subscriberScope(permissionsOf('support', 'watcher'))).toBe('everyone');
  });

  it('lets a company’s Admins change their colleagues’', () => {
    expect(subscriberScope(permissionsOf(null, 'admin'))).toBe('colleagues');
    expect(subscriberScope(permissionsOf('finance', 'admin'))).toBe('colleagues');
  });

  it('leaves everyone else their own: Finance, Clients and Watchers', () => {
    expect(subscriberScope(finance)).toBe('self');
    expect(subscriberScope(client)).toBe('self');
    expect(subscriberScope(watcher)).toBe('self');
    expect(subscriberScope(permissionsOf('finance', 'client'))).toBe('self');
  });
});

describe('a solution the company approves', () => {
  it('is proposed by the staff who work on requests, with a reply, while the request is worked on', () => {
    expect(mayProposeSolution(support, 'in_progress')).toBe(true);
    expect(mayProposeSolution(support, 'waiting')).toBe(true);
    expect(mayProposeSolution(support, 'proposed')).toBe(false);
    expect(mayProposeSolution(support, 'done')).toBe(false);
    expect(mayProposeSolution(finance, 'in_progress')).toBe(false);
    expect(mayProposeSolution(client, 'in_progress')).toBe(false);
    // Never through an ordinary change of status.
    expect(statusChoices(support, 'in_progress')).not.toContain('proposed');
    expect(mayChangeStatus(support, 'in_progress', 'proposed')).toBe(false);
  });

  it('is answered by the company’s Admins and Clients, while it waits for them', () => {
    expect(mayAnswerSolution(client, 'proposed')).toBe(true);
    expect(mayAnswerSolution(permissionsOf(null, 'admin'), 'proposed')).toBe(true);
    expect(mayAnswerSolution(watcher, 'proposed')).toBe(false);
    expect(mayAnswerSolution(support, 'proposed')).toBe(false);
    expect(mayAnswerSolution(client, 'waiting')).toBe(false);
  });

  it('closes the request when approved and puts it back in progress when denied', () => {
    expect(statusAfterAnswer('approve')).toBe('done');
    expect(statusAfterAnswer('deny')).toBe('in_progress');
    // The company can still cancel, but approves rather than marks it as done.
    expect(statusChoices(client, 'proposed')).toEqual(['cancelled']);
    // A reply doesn't answer it.
    expect(statusAfterReply('company', 'proposed')).toBe('proposed');
  });

  it('names each change of status for the sentence that tells it', () => {
    expect(statusChangeKind('in_progress', 'proposed', 'staff')).toBe('proposed');
    expect(statusChangeKind('proposed', 'done', 'company')).toBe('approved');
    expect(statusChangeKind('proposed', 'in_progress', 'company')).toBe('denied');
    // The staff taking it back is an ordinary move.
    expect(statusChangeKind('proposed', 'in_progress', 'staff')).toBe('moved');
    expect(statusChangeKind('done', 'open', 'company')).toBe('reopened');
    expect(statusChangeKind('open', 'cancelled', 'company')).toBe('cancelled');
    expect(statusChangeKind('open', 'todo', 'staff')).toBe('moved');
  });
});

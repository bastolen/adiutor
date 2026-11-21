/**
 * @file Tests for how a request's activity is read: the groups each reader is
 * offered, how a choice is tidied and applied to a reader, ticking and
 * unticking groups in the menu, and the kinds of entry a choice shows.
 */
import { describe, expect, it } from 'vitest';

import { getPermissions, type Permission } from '../authz/permissions';
import type { CompanyRole, PlatformRole } from '../authz/roles';
import {
  ACTIVITY_GROUPS,
  activityKinds,
  effectiveActivityGroups,
  isActivityGroup,
  isActivityGroupShown,
  isActivityOrder,
  isIncludedActivityGroup,
  normalizeActivityGroups,
  offeredActivityGroups,
  withActivityGroup,
} from './activity';
import { REQUEST_ENTRY_KINDS } from './values';

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
/** A staff member who reads requests, notes included, but doesn't work on them. */
const finance = permissionsOf('finance', null);
/** Someone at the company who takes part. */
const client = permissionsOf(null, 'client');
/** Someone at the company who only follows. */
const watcher = permissionsOf(null, 'watcher');

describe('isActivityGroup and isActivityOrder', () => {
  it('know the groups and orders, and nothing else', () => {
    ACTIVITY_GROUPS.forEach((group) => {
      expect(isActivityGroup(group)).toBe(true);
    });
    expect(isActivityGroup('comment')).toBe(false);
    expect(isActivityGroup(undefined)).toBe(false);
    expect(isActivityOrder('oldest')).toBe(true);
    expect(isActivityOrder('newest')).toBe(true);
    expect(isActivityOrder('random')).toBe(false);
  });
});

describe('offeredActivityGroups', () => {
  it('offers the internal notes to every staff role that reads them', () => {
    expect(offeredActivityGroups(support)).toEqual(['replies', 'notes', 'status', 'changes']);
    expect(offeredActivityGroups(finance)).toEqual(['replies', 'notes', 'status', 'changes']);
  });

  it('never offers the internal notes to someone at the company', () => {
    expect(offeredActivityGroups(client)).toEqual(['replies', 'status', 'changes']);
    expect(offeredActivityGroups(watcher)).toEqual(['replies', 'status', 'changes']);
  });
});

describe('normalizeActivityGroups', () => {
  it('keeps the groups in the menu’s order, each once', () => {
    expect(normalizeActivityGroups(['changes', 'status', 'changes'])).toEqual([
      'status',
      'changes',
    ]);
  });

  it('leaves the notes out while Replies is chosen, which includes them', () => {
    expect(normalizeActivityGroups(['notes', 'replies'])).toEqual(['replies']);
    expect(normalizeActivityGroups(['notes', 'status'])).toEqual(['notes', 'status']);
  });

  it('turns nothing, or everything, into everything', () => {
    expect(normalizeActivityGroups([])).toBeNull();
    expect(normalizeActivityGroups(['replies', 'status', 'changes'])).toBeNull();
    expect(normalizeActivityGroups([...ACTIVITY_GROUPS])).toBeNull();
  });
});

describe('effectiveActivityGroups', () => {
  it('shows everything without a choice', () => {
    expect(effectiveActivityGroups(null, support)).toBeNull();
    expect(effectiveActivityGroups(null, client)).toBeNull();
  });

  it('drops the notes for someone at the company, and shows everything when nothing is left', () => {
    expect(effectiveActivityGroups(['notes', 'status'], client)).toEqual(['status']);
    expect(effectiveActivityGroups(['notes'], client)).toBeNull();
    expect(effectiveActivityGroups(['notes'], support)).toEqual(['notes']);
  });
});

describe('isIncludedActivityGroup and isActivityGroupShown', () => {
  it('counts the notes as shown while Replies is chosen', () => {
    expect(isIncludedActivityGroup('notes', ['replies'])).toBe(true);
    expect(isIncludedActivityGroup('notes', null)).toBe(true);
    expect(isIncludedActivityGroup('notes', ['status'])).toBe(false);
    expect(isIncludedActivityGroup('replies', ['replies'])).toBe(false);
    expect(isActivityGroupShown('notes', ['replies'])).toBe(true);
    expect(isActivityGroupShown('status', ['replies'])).toBe(false);
    expect(isActivityGroupShown('status', null)).toBe(true);
  });
});

describe('withActivityGroup', () => {
  /** What the staff are offered. */
  const staff = offeredActivityGroups(support);
  /** What someone at the company is offered. */
  const company = offeredActivityGroups(client);

  it('keeps every other group, the notes too, when Replies is unticked from everything', () => {
    expect(withActivityGroup(null, 'replies', false, staff)).toEqual([
      'notes',
      'status',
      'changes',
    ]);
    expect(withActivityGroup(null, 'replies', false, company)).toEqual(['status', 'changes']);
  });

  it('keeps the notes within Replies when another group is unticked', () => {
    expect(withActivityGroup(null, 'status', false, staff)).toEqual(['replies', 'changes']);
  });

  it('takes the notes into Replies when Replies is ticked again', () => {
    expect(withActivityGroup(['notes', 'status'], 'replies', true, staff)).toEqual([
      'replies',
      'status',
    ]);
  });

  it('shows everything once every group is ticked, or the last one unticked', () => {
    expect(withActivityGroup(['replies', 'changes'], 'status', true, staff)).toBeNull();
    expect(withActivityGroup(['status'], 'status', false, company)).toBeNull();
    expect(withActivityGroup(['notes'], 'notes', false, staff)).toBeNull();
  });
});

describe('activityKinds', () => {
  it('shows every kind of entry without a choice', () => {
    expect(activityKinds(null, support)).toBeNull();
    expect(activityKinds(null, client)).toBeNull();
  });

  it('puts every kind of entry in a group the staff can choose', () => {
    const shown = activityKinds(['replies', 'changes'], support) ?? [];
    const status = activityKinds(['status'], support) ?? [];
    expect([...shown, ...status].sort()).toEqual([...REQUEST_ENTRY_KINDS].sort());
  });

  it('brings the internal notes with Replies for the staff, and only the notes with Notes', () => {
    expect(activityKinds(['replies'], support)).toEqual(['comment', 'note']);
    expect(activityKinds(['notes'], support)).toEqual(['note']);
    expect(activityKinds(['status'], finance)).toEqual(['status']);
  });

  it('never gives someone at the company a kind only the staff see', () => {
    expect(activityKinds(['replies'], client)).toEqual(['comment']);
    expect(activityKinds(['changes'], client)).toEqual(['title', 'type', 'assignee']);
    expect(activityKinds(['changes'], support)).toEqual(['title', 'type', 'priority', 'assignee']);
    expect(activityKinds(['notes', 'status'], watcher)).toEqual(['status']);
  });
});

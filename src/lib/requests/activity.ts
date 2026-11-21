/**
 * @file How someone reads a request's activity on its page: which groups of
 * entries it shows and in which order. Everyone chooses it for themselves,
 * and it's saved with their account (`user.activity_groups`,
 * `user.activity_order`), so it holds on every request. The groups are
 * replies, internal notes (offered to the staff only), status changes and
 * every other change; for the staff, Replies includes the internal notes.
 * Pure functions of the choice and the reader's permissions, so the service
 * that loads a request (`getRequest`) and the page's menus apply the same
 * rules. The service still leaves out what only the staff see on its own
 * (`STAFF_ONLY_ENTRY_KINDS`): a choice never shows a company reader more.
 */
import type { Permission } from '../authz/permissions';
import { REQUEST_ENTRY_KINDS, type RequestEntryKind, STAFF_ONLY_ENTRY_KINDS } from './values';

/**
 * The groups of a request's activity, in the order the page offers them:
 * replies (`comment`; for the staff, internal notes too), internal notes
 * (`note`, the staff only), status changes, and every other change (who it's
 * assigned to, its title, type and priority).
 */
export const ACTIVITY_GROUPS = ['replies', 'notes', 'status', 'changes'] as const;

/** One group of a request's activity. */
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

/** The orders a request's activity is shown in: the oldest entry first, or the newest. */
export const ACTIVITY_ORDERS = ['oldest', 'newest'] as const;

/** An order of a request's activity. */
export type ActivityOrder = (typeof ACTIVITY_ORDERS)[number];

/** The order until someone chooses another: the oldest entry first, as a conversation reads. */
export const DEFAULT_ACTIVITY_ORDER: ActivityOrder = 'oldest';

/**
 * How someone reads a request's activity: its order, and the groups it
 * shows (`null`: everything, also the kinds of entry a later version adds).
 */
export interface ActivityView {
  /** The order. */
  order: ActivityOrder;
  /** The groups shown, in {@link ACTIVITY_GROUPS} order; `null` for everything. */
  groups: readonly ActivityGroup[] | null;
}

/** The view until someone chooses another: everything, oldest first. */
export const DEFAULT_ACTIVITY_VIEW: ActivityView = { order: DEFAULT_ACTIVITY_ORDER, groups: null };

/**
 * The group each kind of entry is in. A `Record`, so a new kind of entry
 * doesn't compile until it has a group.
 */
const ENTRY_KIND_GROUP: Record<RequestEntryKind, ActivityGroup> = {
  comment: 'replies',
  note: 'notes',
  status: 'status',
  title: 'changes',
  type: 'changes',
  priority: 'changes',
  assignee: 'changes',
};

/** The groups that, chosen together, show everything (for the staff, Replies holds the notes). */
const EVERYTHING: readonly ActivityGroup[] = ['replies', 'status', 'changes'];

/**
 * Whether a value is one of the {@link ACTIVITY_GROUPS}.
 *
 * @param value - The value to check.
 * @returns Whether it is.
 */
export function isActivityGroup(value: unknown): value is ActivityGroup {
  return (ACTIVITY_GROUPS as readonly unknown[]).includes(value);
}

/**
 * Whether a value is one of the {@link ACTIVITY_ORDERS}.
 *
 * @param value - The value to check.
 * @returns Whether it is.
 */
export function isActivityOrder(value: unknown): value is ActivityOrder {
  return (ACTIVITY_ORDERS as readonly unknown[]).includes(value);
}

/**
 * The groups a reader is offered: all of them for the staff
 * (`requests:view-internal`), and everything but the internal notes for
 * someone at a company, who never learns that notes exist.
 *
 * @param permissions - The reader's permissions in the request's company.
 * @returns The groups, in {@link ACTIVITY_GROUPS} order.
 */
export function offeredActivityGroups(permissions: ReadonlySet<Permission>): ActivityGroup[] {
  const internal = permissions.has('requests:view-internal');
  return ACTIVITY_GROUPS.filter((group) => internal || group !== 'notes');
}

/**
 * Tidies a choice of groups the one way it's saved: the internal notes are
 * left out while Replies is chosen (Replies includes them), and a choice of
 * nothing, or of everything, is `null` (everything).
 *
 * @param groups - The groups chosen, in any order, possibly twice.
 * @returns The groups in {@link ACTIVITY_GROUPS} order, or `null` for everything.
 */
export function normalizeActivityGroups(groups: readonly ActivityGroup[]): ActivityGroup[] | null {
  const chosen = new Set(groups);
  if (chosen.has('replies')) {
    chosen.delete('notes');
  }
  if (chosen.size === 0 || EVERYTHING.every((group) => chosen.has(group))) {
    return null;
  }
  return ACTIVITY_GROUPS.filter((group) => chosen.has(group));
}

/**
 * A choice of groups among the ones a reader is offered: the others left
 * out, then tidied.
 *
 * @param groups - The groups chosen; `null` for everything.
 * @param offered - The groups the reader is offered.
 * @returns The groups shown, or `null` for everything.
 */
function chosenAmong(
  groups: readonly ActivityGroup[] | null,
  offered: readonly ActivityGroup[],
): ActivityGroup[] | null {
  if (groups === null) {
    return null;
  }
  return normalizeActivityGroups(groups.filter((group) => offered.includes(group)));
}

/**
 * A saved choice as it applies to one reader: without the groups they aren't
 * offered (a staff member's notes, for someone who has left the staff), and
 * everything when nothing is left.
 *
 * @param saved - The groups saved; `null` for everything.
 * @param permissions - The reader's permissions in the request's company.
 * @returns The groups shown, or `null` for everything.
 */
export function effectiveActivityGroups(
  saved: readonly ActivityGroup[] | null,
  permissions: ReadonlySet<Permission>,
): ActivityGroup[] | null {
  return chosenAmong(saved, offeredActivityGroups(permissions));
}

/**
 * Whether a group is shown because another chosen group includes it: the
 * internal notes while Replies is chosen (only the staff are offered notes).
 *
 * @param group - The group.
 * @param groups - The groups chosen; `null` for everything.
 * @returns Whether it's included.
 */
export function isIncludedActivityGroup(
  group: ActivityGroup,
  groups: readonly ActivityGroup[] | null,
): boolean {
  return group === 'notes' && (groups === null || groups.includes('replies'));
}

/**
 * Whether a group's entries are shown: chosen, included in a chosen group,
 * or everything is shown.
 *
 * @param group - The group.
 * @param groups - The groups chosen; `null` for everything.
 * @returns Whether it's shown.
 */
export function isActivityGroupShown(
  group: ActivityGroup,
  groups: readonly ActivityGroup[] | null,
): boolean {
  return groups === null || groups.includes(group) || isIncludedActivityGroup(group, groups);
}

/**
 * The choice after a group is ticked or unticked in the page's menu. With
 * everything shown, unticking a group keeps every other one the reader is
 * offered (the staff's notes too, when they untick Replies). Unticking the
 * last group shows everything again.
 *
 * @param groups - The groups chosen now; `null` for everything.
 * @param group - The group ticked or unticked.
 * @param on - Whether it's ticked.
 * @param offered - The groups the reader is offered ({@link offeredActivityGroups}).
 * @returns The new choice, tidied, or `null` for everything.
 */
export function withActivityGroup(
  groups: readonly ActivityGroup[] | null,
  group: ActivityGroup,
  on: boolean,
  offered: readonly ActivityGroup[],
): ActivityGroup[] | null {
  const shown = offered.filter((each) => isActivityGroupShown(each, groups));
  const next = on ? [...shown, group] : shown.filter((each) => each !== group);
  return chosenAmong(next, offered);
}

/**
 * The kinds of entry a choice shows a reader: for the staff, Replies brings
 * the internal notes; someone at a company never gets a kind only the staff
 * see, whatever was chosen.
 *
 * @param groups - The groups chosen; `null` for everything.
 * @param permissions - The reader's permissions in the request's company.
 * @returns The kinds, or `null` when everything is shown.
 */
export function activityKinds(
  groups: readonly ActivityGroup[] | null,
  permissions: ReadonlySet<Permission>,
): RequestEntryKind[] | null {
  const effective = effectiveActivityGroups(groups, permissions);
  if (effective === null) {
    return null;
  }
  const internal = permissions.has('requests:view-internal');
  return REQUEST_ENTRY_KINDS.filter(
    (kind) =>
      isActivityGroupShown(ENTRY_KIND_GROUP[kind], effective) &&
      (internal || !(STAFF_ONLY_ENTRY_KINDS as readonly RequestEntryKind[]).includes(kind)),
  );
}

/**
 * @file Tests for the values a request can have.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_REQUEST_STATUSES,
  CLOSED_REQUEST_STATUSES,
  isClosedStatus,
  isRequestPriority,
  isRequestStatus,
  isRequestStatusFilter,
  isRequestType,
  REQUEST_STATUS_FILTERS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  startingPriority,
  statusesOfFilter,
} from './values';

describe('request statuses', () => {
  it('are either still worked on or closed, never both', () => {
    expect(ACTIVE_REQUEST_STATUSES).toEqual(['open', 'todo', 'in_progress', 'waiting']);
    expect(CLOSED_REQUEST_STATUSES).toEqual(['done', 'cancelled']);
    expect([...ACTIVE_REQUEST_STATUSES, ...CLOSED_REQUEST_STATUSES]).toEqual([...REQUEST_STATUSES]);
  });

  it('count done and cancelled as closed', () => {
    expect(isClosedStatus('done')).toBe(true);
    expect(isClosedStatus('cancelled')).toBe(true);
    expect(isClosedStatus('waiting')).toBe(false);
  });
});

describe('the priority a type starts with', () => {
  it.each([
    ['hotfix', 'high'],
    ['bug', 'normal'],
    ['support', 'normal'],
    ['new_feature', 'low'],
  ] as const)('%s starts %s', (type, priority) => {
    expect(startingPriority(type)).toBe(priority);
  });

  it('is set for every type', () => {
    REQUEST_TYPES.forEach((type) => expect(isRequestPriority(startingPriority(type))).toBe(true));
  });
});

describe('the status filters', () => {
  it('show what their name says', () => {
    expect(statusesOfFilter('active')).toEqual(ACTIVE_REQUEST_STATUSES);
    expect(statusesOfFilter('waiting')).toEqual(['waiting']);
    expect(statusesOfFilter('closed')).toEqual(['done', 'cancelled']);
    expect(statusesOfFilter('all')).toBeNull();
  });

  it('only show statuses that exist', () => {
    REQUEST_STATUS_FILTERS.forEach((filter) => {
      (statusesOfFilter(filter) ?? []).forEach((status) =>
        expect(isRequestStatus(status)).toBe(true),
      );
    });
  });
});

describe('the guards', () => {
  it('accept the values and refuse everything else', () => {
    expect(isRequestStatus('in_progress')).toBe(true);
    expect(isRequestStatus('closed')).toBe(false);
    expect(isRequestType('new_feature')).toBe(true);
    expect(isRequestType('question')).toBe(false);
    expect(isRequestPriority('high')).toBe(true);
    expect(isRequestPriority('urgent')).toBe(false);
    expect(isRequestStatusFilter('closed')).toBe(true);
    expect(isRequestStatusFilter('done')).toBe(false);
    expect(isRequestStatus(undefined)).toBe(false);
  });
});

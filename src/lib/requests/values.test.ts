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
  isRequestTypeKey,
  REQUEST_STATUS_FILTERS,
  REQUEST_STATUSES,
  requestTypeKeyFromName,
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

describe('the key a new request type gets from its name', () => {
  it.each([
    ['Printers', 'printers'],
    ['New feature', 'new_feature'],
    ['  Hardware & Repairs!  ', 'hardware_repairs'],
    ['Café opening hours', 'cafe_opening_hours'],
    ['Één ding', 'een_ding'],
    ['🖨️', 'type'],
    ['A name that goes on for much longer than a key may', 'a_name_that_goes_on_for_much_lon'],
  ])('makes %j into %s', (name, key) => {
    const made = requestTypeKeyFromName(name, () => false);
    expect(made).toBe(key);
    expect(isRequestTypeKey(made)).toBe(true);
  });

  it('adds a number when the key is taken, also by an archived type', () => {
    const taken = new Set(['printers', 'printers_2']);
    expect(requestTypeKeyFromName('Printers', (key) => taken.has(key))).toBe('printers_3');
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
    expect(isRequestTypeKey('new_feature')).toBe(true);
    expect(isRequestTypeKey('New feature')).toBe(false);
    expect(isRequestTypeKey('')).toBe(false);
    expect(isRequestTypeKey('a'.repeat(41))).toBe(false);
    expect(isRequestPriority('high')).toBe(true);
    expect(isRequestPriority('urgent')).toBe(false);
    expect(isRequestStatusFilter('closed')).toBe(true);
    expect(isRequestStatusFilter('done')).toBe(false);
    expect(isRequestStatus(undefined)).toBe(false);
  });
});

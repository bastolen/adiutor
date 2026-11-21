/**
 * @file Tests for the anchors of a request's page.
 */
import { describe, expect, it } from 'vitest';

import { isSectionId } from '../redirect';
import { DESCRIPTION_ANCHOR, entryAnchor, isEntryAnchor } from './anchors';

/** An entry's ID, as the database gives it. */
const ENTRY_ID = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

describe('anchors', () => {
  it('names an entry, and both anchors survive signing in as section IDs', () => {
    expect(entryAnchor(ENTRY_ID)).toBe(`entry-${ENTRY_ID}`);
    expect(isSectionId(entryAnchor(ENTRY_ID))).toBe(true);
    expect(isSectionId(DESCRIPTION_ANCHOR)).toBe(true);
  });

  it('tells an entry’s anchor from any other', () => {
    expect(isEntryAnchor(entryAnchor(ENTRY_ID))).toBe(true);
    expect(isEntryAnchor(DESCRIPTION_ANCHOR)).toBe(false);
    expect(isEntryAnchor('entry-1')).toBe(false);
    expect(isEntryAnchor('entry-')).toBe(false);
    expect(isEntryAnchor(null)).toBe(false);
  });
});

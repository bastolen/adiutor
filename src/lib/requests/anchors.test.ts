/**
 * @file Tests for the anchors of a request's page.
 */
import { describe, expect, it } from 'vitest';

import { isSectionId } from '../redirect';
import {
  DESCRIPTION_ANCHOR,
  entryAnchor,
  entryIdOf,
  isEntryAnchor,
  isEntryId,
  requestPathAt,
  requestPathWithEntry,
} from './anchors';

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

  it('opens a request at an entry, named in the query too, or at its description', () => {
    expect(requestPathAt(142, entryAnchor(ENTRY_ID))).toBe(
      `/requests/142?entry=${ENTRY_ID}#entry-${ENTRY_ID}`,
    );
    expect(requestPathAt(142, DESCRIPTION_ANCHOR)).toBe('/requests/142#request-description');
    expect(requestPathAt(142, null)).toBe('/requests/142');
  });

  it('reads the entry an anchor names, and names it in a request’s address', () => {
    expect(entryIdOf(entryAnchor(ENTRY_ID))).toBe(ENTRY_ID);
    expect(entryIdOf(DESCRIPTION_ANCHOR)).toBeNull();
    expect(entryIdOf(null)).toBeNull();
    expect(isEntryId(ENTRY_ID)).toBe(true);
    expect(isEntryId('//adiutor.dev')).toBe(false);
    expect(requestPathWithEntry(142, ENTRY_ID)).toBe(`/requests/142?entry=${ENTRY_ID}`);
    expect(requestPathWithEntry(142, 'junk')).toBe('/requests/142');
    expect(requestPathWithEntry(142, null)).toBe('/requests/142');
  });
});

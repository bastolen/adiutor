/**
 * @file Tests for conditional requests: a browser's copy is current only when
 * its `If-None-Match` names the response's tag, compared weakly.
 */
import { describe, expect, it } from 'vitest';

import { entityTag, matchesIfNoneMatch } from './conditional-get';

/** An attachment's ID, as a version. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** Its tag. */
const TAG = entityTag(ID);

describe('entityTag', () => {
  it('quotes the version, as a strong tag', () => {
    expect(TAG).toBe(`"${ID}"`);
  });
});

describe('matchesIfNoneMatch', () => {
  it('matches the same tag, weak or strong', () => {
    expect(matchesIfNoneMatch(TAG, TAG)).toBe(true);
    expect(matchesIfNoneMatch(`W/${TAG}`, TAG)).toBe(true);
    expect(matchesIfNoneMatch(TAG, `W/${TAG}`)).toBe(true);
  });

  it('matches a list that holds the tag, and `*`', () => {
    expect(matchesIfNoneMatch(`"other", W/${TAG} ,"more"`, TAG)).toBe(true);
    expect(matchesIfNoneMatch(' * ', TAG)).toBe(true);
  });

  it('matches nothing without the tag', () => {
    expect(matchesIfNoneMatch(null, TAG)).toBe(false);
    expect(matchesIfNoneMatch('', TAG)).toBe(false);
    expect(matchesIfNoneMatch('"0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3b"', TAG)).toBe(false);
    // Unquoted, or the ID inside another tag, isn't the tag.
    expect(matchesIfNoneMatch(ID, TAG)).toBe(false);
    expect(matchesIfNoneMatch(`"x${ID}"`, TAG)).toBe(false);
    expect(matchesIfNoneMatch(`*, ${TAG.slice(0, -1)}`, TAG)).toBe(false);
  });
});

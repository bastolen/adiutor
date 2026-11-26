/**
 * @file Tests for storage keys: made from IDs only, and nothing else gets
 * past a driver.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { assertStorageKey, attachmentKey, checkKey } from './keys';

/** An ID as the database makes one. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

describe('storage keys', () => {
  it('puts a file in one of 256 folders by the end of its ID', () => {
    expect(attachmentKey(ID)).toBe(`attachments/3a/${ID}`);
    expect(checkKey(ID)).toBe(`checks/3a/${ID}`);
  });

  it('refuses anything that isn’t an ID', () => {
    expect(() => attachmentKey('../../etc/passwd')).toThrow();
    expect(() => attachmentKey(ID.toUpperCase())).toThrow();
    expect(() => attachmentKey(`${ID}/x`)).toThrow();
  });

  it('lets only keys it made reach a driver', () => {
    expect(() => assertStorageKey(attachmentKey(ID))).not.toThrow();
    expect(() => assertStorageKey(`attachments/00/${ID}`)).toThrow();
    expect(() => assertStorageKey(`attachments/3a/../${ID}`)).toThrow();
    expect(() => assertStorageKey(`other/3a/${ID}`)).toThrow();
  });
});

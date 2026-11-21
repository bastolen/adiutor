/**
 * @file Tests for how a request's text marks a mention: the marker while a
 * text is written, the marker once it's stored, and what isn't one.
 */
import { describe, expect, it } from 'vitest';

import {
  editStoredMentions,
  isMentionKey,
  MENTION_KEY_LENGTH,
  nameStoredMentions,
  storedMentionId,
  storedMentionMarker,
  storeWrittenMentions,
  writtenMentionKey,
  writtenMentionKeys,
  writtenMentionMarker,
} from './mentions';

/** The key of someone who may be mentioned, and of someone else. */
const SAM = 'Sam0000000000000000000';
const CASEY = 'Casey00000000000000000';

/** The IDs of two mentions' rows. */
const FIRST = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const SECOND = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c';

describe('a mention in a text that’s being written', () => {
  it('is the person’s name after an @, linked to their key', () => {
    expect(SAM).toHaveLength(MENTION_KEY_LENGTH);
    expect(writtenMentionMarker('Sam Support', SAM)).toBe(`[@Sam Support](mention:${SAM})`);
  });

  it('keeps a name from ending the marker early, or from running over lines', () => {
    expect(writtenMentionMarker('Sam [on call] \\ nights', SAM)).toBe(
      `[@Sam \\[on call\\] \\\\ nights](mention:${SAM})`,
    );
    expect(writtenMentionMarker('Sam\n Support', SAM)).toBe(`[@Sam Support](mention:${SAM})`);
  });

  it('reads the key from a marker’s address, and nothing from any other address', () => {
    expect(writtenMentionKey(`mention:${SAM}`)).toBe(SAM);
    expect(writtenMentionKey(`mention:${SAM}0`)).toBeNull();
    expect(writtenMentionKey(`mention:${FIRST}`)).toBeNull();
    expect(writtenMentionKey('mention:')).toBeNull();
    expect(writtenMentionKey(`https://adiutor.test/mention:${SAM}`)).toBeNull();
    expect(writtenMentionKey(`MENTION:${SAM}`)).toBeNull();
  });

  it('finds the keys a text mentions, each once, in their order', () => {
    const text = [
      `Ask ${writtenMentionMarker('Casey Client', CASEY)}.`,
      `${writtenMentionMarker('Sam [on call]', SAM)} and ${writtenMentionMarker('Casey', CASEY)} know.`,
    ].join('\n');

    expect(writtenMentionKeys(text)).toEqual([CASEY, SAM]);
    expect(writtenMentionKeys('Nobody, and an address: sam@adiutor.test')).toEqual([]);
  });

  it('doesn’t take a link without an @, a link over two lines or a stored marker for one', () => {
    expect(writtenMentionKeys(`[Sam](mention:${SAM})`)).toEqual([]);
    expect(writtenMentionKeys(`[@Sam\nSupport](mention:${SAM})`)).toEqual([]);
    expect(writtenMentionKeys(storedMentionMarker(FIRST))).toEqual([]);
  });
});

describe('a person’s key on its own', () => {
  it('has the shape of a key the list gives', () => {
    expect(isMentionKey(SAM)).toBe(true);
    expect(isMentionKey('a-B_c'.padEnd(MENTION_KEY_LENGTH, '9'))).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['one character short', SAM.slice(1)],
    ['one character long', `${SAM}0`],
    ['a character a key never has', `${SAM.slice(1)}=`],
    ['a row’s ID', FIRST],
    ['a marker’s address', `mention:${SAM}`],
  ])('isn’t %s', (_what, value) => {
    expect(isMentionKey(value)).toBe(false);
  });
});

describe('storing a text’s mentions', () => {
  it('points each marker of someone who may be mentioned at the mention’s row, without their name', () => {
    const text = `Ask ${writtenMentionMarker('Casey Client', CASEY)} or ${writtenMentionMarker('Sam', SAM)}.`;

    expect(storeWrittenMentions(text, (key) => (key === CASEY ? FIRST : SECOND))).toBe(
      `Ask [@](mention:${FIRST}) or [@](mention:${SECOND}).`,
    );
  });

  it('leaves the marker of someone who may not be mentioned as it was written', () => {
    const text = `Ask ${writtenMentionMarker('Casey Client', CASEY)} or ${writtenMentionMarker('Sam', SAM)}.`;

    expect(storeWrittenMentions(text, (key) => (key === CASEY ? FIRST : null))).toBe(
      `Ask [@](mention:${FIRST}) or [@Sam](mention:${SAM}).`,
    );
  });

  it('leaves a marker someone typed with a row’s ID alone: only the server writes those', () => {
    const typed = `[@Sam](mention:${FIRST})`;

    expect(storeWrittenMentions(typed, () => SECOND)).toBe(typed);
  });
});

describe('a mention in a stored text', () => {
  it('names the mention’s row, and nobody by name', () => {
    expect(storedMentionMarker(FIRST)).toBe(`[@](mention:${FIRST})`);
    expect(storedMentionId(`mention:${FIRST}`)).toBe(FIRST);
  });

  it('is nothing else: another scheme, a key, more than an ID', () => {
    expect(storedMentionId(`mention:${SAM}`)).toBeNull();
    expect(storedMentionId(`mention:${FIRST}/x`)).toBeNull();
    expect(storedMentionId(`mention:${FIRST.toUpperCase()}`)).toBeNull();
    expect(storedMentionId(`https://adiutor.test/${FIRST}`)).toBeNull();
    expect(storedMentionId('')).toBeNull();
  });

  it('is named where the text is shown without formatting', () => {
    const text = `Ask ${storedMentionMarker(FIRST)} or ${storedMentionMarker(SECOND)}, not [@x](mention:${SAM}).`;

    expect(nameStoredMentions(text, (id) => (id === FIRST ? 'Casey Client' : null))).toBe(
      `Ask @Casey Client or [@](mention:${SECOND}), not [@x](mention:${SAM}).`,
    );
  });
});

describe('editing a stored text', () => {
  it('turns each mention back into one that’s being written, and a gone one into text', () => {
    const sam = '0198a8c0-0000-7000-8000-000000000001';
    const gone = '0198a8c0-0000-7000-8000-000000000002';
    const text = `Hi ${storedMentionMarker(sam)} and ${storedMentionMarker(gone)}.`;

    const edited = editStoredMentions(text, (id) =>
      id === sam ? writtenMentionMarker('Sam Support', 'k'.repeat(MENTION_KEY_LENGTH)) : '@Adiutor',
    );

    expect(edited).toBe(
      `Hi [@Sam Support](mention:${'k'.repeat(MENTION_KEY_LENGTH)}) and @Adiutor.`,
    );
  });

  it('leaves a marker that isn’t the text’s as it is', () => {
    const text = storedMentionMarker('0198a8c0-0000-7000-8000-000000000003');

    expect(editStoredMentions(text, () => null)).toBe(text);
  });
});

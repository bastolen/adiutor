/**
 * @file Tests for which picture a person shows: the default, a choice,
 * initials, and the accounts that don't count; and for the account that
 * stands for each provider, which the shown picture always agrees with.
 */
import { describe, expect, it } from 'vitest';

import {
  AVATAR_SOURCES,
  choiceAccounts,
  isAvatarSource,
  type PictureAccount,
  pictureAccount,
} from './pictures';

/** A GitHub account with a picture, connected first. */
const github: PictureAccount = {
  id: 'github-account',
  providerId: 'github',
  image: 'https://avatars.githubusercontent.com/u/1',
  confirmed: true,
};

/** A Google account with a picture, connected second. */
const google: PictureAccount = {
  id: 'google-account',
  providerId: 'google',
  image: 'https://lh3.googleusercontent.com/a/1',
  confirmed: true,
};

/** A GitHub account connected before pictures were kept, so without one yet. */
const olderGithub: PictureAccount = { ...github, id: 'older-github-account', image: null };

/** A second GitHub account with a picture. */
const newerGithub: PictureAccount = {
  ...github,
  id: 'newer-github-account',
  image: 'https://avatars.githubusercontent.com/u/2',
};

describe('pictureAccount', () => {
  it('shows the account connected first until someone chooses', () => {
    expect(pictureAccount(null, [github, google])).toBe(github);
    expect(pictureAccount(null, [google, github])).toBe(google);
  });

  it('shows the chosen provider’s account', () => {
    expect(pictureAccount('google', [github, google])).toBe(google);
  });

  it('shows nothing for someone who chose initials, or has no picture', () => {
    expect(pictureAccount('initials', [github, google])).toBeNull();
    expect(pictureAccount(null, [])).toBeNull();
    expect(pictureAccount(null, [{ ...github, image: null }])).toBeNull();
  });

  it('falls back to the default when the chosen account is gone or has no picture yet', () => {
    expect(pictureAccount('google', [github])).toBe(github);
    expect(pictureAccount('google', [github, { ...google, image: null }])).toBe(github);
  });

  it('never shows an account the user hasn’t confirmed', () => {
    expect(pictureAccount(null, [{ ...github, confirmed: false }, google])).toBe(google);
    expect(pictureAccount('github', [{ ...github, confirmed: false }])).toBeNull();
  });

  it('shows a provider’s later account while its first has no picture yet', () => {
    expect(pictureAccount(null, [olderGithub, newerGithub])).toBe(newerGithub);
    expect(pictureAccount('github', [olderGithub, google, newerGithub])).toBe(newerGithub);
    expect(pictureAccount(null, [olderGithub, google, newerGithub])).toBe(google);
  });

  it('always shows the picture of the account its provider’s choice offers', () => {
    const accountLists = [
      [github, google],
      [olderGithub, newerGithub],
      [olderGithub, google, newerGithub],
      [google, olderGithub],
      [newerGithub, github],
      [{ ...github, confirmed: false }, olderGithub, newerGithub],
    ];
    accountLists.forEach((accounts) => {
      const offered = choiceAccounts(accounts);
      [null, ...AVATAR_SOURCES].forEach((source) => {
        const shown = pictureAccount(source, accounts);
        const chosen = offered.find(({ providerId }) => providerId === source)?.account;
        if (shown) {
          expect(offered.map(({ account }) => account)).toContain(shown);
        }
        if (chosen?.image) {
          expect(shown).toBe(chosen);
        }
      });
    });
  });
});

describe('choiceAccounts', () => {
  it('offers each provider of a confirmed account once, in the order they were connected', () => {
    expect(choiceAccounts([google, github, { ...github, id: 'second-github' }])).toEqual([
      { providerId: 'google', account: google },
      { providerId: 'github', account: github },
    ]);
  });

  it('offers a provider’s first account with a picture, else its first', () => {
    expect(choiceAccounts([olderGithub, newerGithub])).toEqual([
      { providerId: 'github', account: newerGithub },
    ]);
    expect(choiceAccounts([olderGithub, { ...newerGithub, image: null }])).toEqual([
      { providerId: 'github', account: olderGithub },
    ]);
  });

  it('lists the providers in the order the accounts it offers were connected', () => {
    expect(choiceAccounts([olderGithub, google, newerGithub])).toEqual([
      { providerId: 'google', account: google },
      { providerId: 'github', account: newerGithub },
    ]);
  });

  it('leaves out accounts the user hasn’t confirmed, and other providers', () => {
    expect(choiceAccounts([{ ...github, confirmed: false }, google])).toEqual([
      { providerId: 'google', account: google },
    ]);
    expect(choiceAccounts([{ ...newerGithub, confirmed: false }, olderGithub])).toEqual([
      { providerId: 'github', account: olderGithub },
    ]);
    expect(choiceAccounts([{ ...github, providerId: 'gitlab' }])).toEqual([]);
  });
});

describe('isAvatarSource', () => {
  it('takes initials and the providers, nothing else', () => {
    expect(isAvatarSource('initials')).toBe(true);
    expect(isAvatarSource('github')).toBe(true);
    expect(isAvatarSource('gitlab')).toBe(false);
    expect(isAvatarSource(null)).toBe(false);
  });
});

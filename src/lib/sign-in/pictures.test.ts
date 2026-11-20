/**
 * @file Tests for which picture a person shows: the default, a choice,
 * initials, and the accounts that don't count.
 */
import { describe, expect, it } from 'vitest';

import { isAvatarSource, type PictureAccount, pictureAccount, pictureProviders } from './pictures';

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
});

describe('pictureProviders', () => {
  it('offers each provider of a confirmed account once, in the order they were connected', () => {
    expect(pictureProviders([google, github, { ...github, id: 'second-github' }])).toEqual([
      'google',
      'github',
    ]);
    expect(pictureProviders([{ ...github, confirmed: false }, google])).toEqual(['google']);
    expect(pictureProviders([{ ...github, providerId: 'gitlab' }])).toEqual([]);
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

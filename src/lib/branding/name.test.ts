/**
 * @file Tests for the name people see Adiutor by: when it's Adiutor's own,
 * when "Powered by Adiutor" shows, and how new authenticator entries and
 * passkeys are labelled.
 */
import { describe, expect, it } from 'vitest';

import { ADIUTOR_NAME, forTitleTemplate, isOwnName, poweredByShown, signInAppName } from './name';

describe('isOwnName', () => {
  it('takes Adiutor in any case, with spaces around it, as Adiutor’s own', () => {
    expect(isOwnName(ADIUTOR_NAME)).toBe(true);
    expect(isOwnName(' adiutor ')).toBe(true);
    expect(isOwnName('ADIUTOR')).toBe(true);
  });

  it('takes any other name, Adiutor’s with more to it too, as the staff’s own', () => {
    expect(isOwnName('Acme Support')).toBe(false);
    expect(isOwnName('Adiutor Support')).toBe(false);
  });
});

describe('poweredByShown', () => {
  it('shows only once the staff have a name of their own', () => {
    expect(poweredByShown('Adiutor')).toBe(false);
    expect(poweredByShown('Acme Support')).toBe(true);
  });
});

describe('signInAppName', () => {
  it('puts the staff’s name first, with Adiutor’s after it', () => {
    expect(signInAppName('Acme Support')).toBe('Acme Support (Adiutor)');
    expect(signInAppName('  Acme Support ')).toBe('Acme Support (Adiutor)');
  });

  it('is just Adiutor while that’s the staff’s name', () => {
    expect(signInAppName('adiutor')).toBe('Adiutor');
  });

  it('leaves out colons, which would cut an authenticator entry’s label in two', () => {
    expect(signInAppName('Acme: Help')).toBe('Acme Help (Adiutor)');
    expect(signInAppName('Acme:Help:')).toBe('Acme Help (Adiutor)');
  });
});

describe('forTitleTemplate', () => {
  it('keeps a name’s own %s from becoming the page’s title', () => {
    expect(forTitleTemplate('Acme %s Support')).toBe('Acme % s Support');
    expect(forTitleTemplate('Adiutor Tests')).toBe('Adiutor Tests');
  });
});

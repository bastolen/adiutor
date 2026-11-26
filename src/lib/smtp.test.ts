/**
 * @file Tests for a mail server's rules: what a page may show, the server
 * `SMTP_URL` names, what production refuses, a failure's kind, and the
 * sender as one line.
 */
import { describe, expect, it } from 'vitest';

import {
  type SmtpConfig,
  senderText,
  smtpFailureOf,
  smtpProblems,
  smtpUrlView,
  smtpView,
} from './smtp';

/** A mail server saved in Settings. */
const SAVED: SmtpConfig = {
  host: 'smtp.adiutor.test',
  port: 587,
  security: 'starttls',
  username: 'mailer@adiutor.test',
  password: 'secret-password',
  from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
};

describe('smtpView', () => {
  it('shows everything but the password, and whether there is one', () => {
    const view = smtpView(SAVED);

    expect(view).toEqual({
      host: 'smtp.adiutor.test',
      port: 587,
      security: 'starttls',
      username: 'mailer@adiutor.test',
      from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
      hasPassword: true,
    });
    expect(JSON.stringify(view)).not.toContain('secret-password');
    expect(smtpView({ ...SAVED, username: null, password: null }).hasPassword).toBe(false);
  });
});

describe('smtpUrlView', () => {
  it('reads TLS, STARTTLS and neither from the URL, never its password', () => {
    expect(smtpUrlView('smtps://mailer%40adiutor.test:secret@smtp.adiutor.test:465')).toEqual({
      host: 'smtp.adiutor.test',
      port: 465,
      security: 'tls',
      username: 'mailer@adiutor.test',
      hasPassword: true,
    });
    expect(smtpUrlView('smtp://smtp.adiutor.test:2525?requireTLS=true')).toMatchObject({
      port: 2525,
      security: 'starttls',
      username: null,
      hasPassword: false,
    });
    expect(smtpUrlView('smtp://localhost:1025')).toMatchObject({
      host: 'localhost',
      security: 'none',
    });
  });

  it('gives nodemailer’s default port when the URL has none', () => {
    expect(smtpUrlView('smtps://smtp.adiutor.test')?.port).toBe(465);
    expect(smtpUrlView('smtp://smtp.adiutor.test')?.port).toBe(587);
  });

  it('gives nothing for a URL it can’t read', () => {
    expect(smtpUrlView('not a url')).toBeNull();
  });
});

describe('smtpProblems', () => {
  it('asks production for a secured connection, except to a server on this computer', () => {
    const plain = { host: 'smtp.adiutor.test', security: 'none' } as const;

    expect(smtpProblems(plain, { production: true })).toEqual(['tlsRequired']);
    expect(smtpProblems({ ...plain, host: 'localhost' }, { production: true })).toEqual([]);
    expect(smtpProblems({ ...plain, security: 'tls' }, { production: true })).toEqual([]);
    expect(smtpProblems(plain, { production: false })).toEqual([]);
  });
});

describe('smtpFailureOf', () => {
  it.each([
    ['ECONNECTION', 'unreachable'],
    ['EDNS', 'unreachable'],
    ['ECONNREFUSED', 'unreachable'],
    ['ETIMEDOUT', 'timedOut'],
    ['ETLS', 'tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['EAUTH', 'loginRefused'],
    ['ENOAUTH', 'loginRefused'],
    ['EENVELOPE', 'addressRefused'],
    ['EMESSAGE', 'refused'],
    ['EPROTOCOL', 'refused'],
  ])('names %s %s', (code, kind) => {
    expect(smtpFailureOf(Object.assign(new Error('the server said something'), { code }))).toBe(
      kind,
    );
  });

  it('tells a certificate from another socket error, by the text alone and keeping none of it', () => {
    const certificate = Object.assign(new Error('self-signed certificate in chain'), {
      code: 'ESOCKET',
    });
    const reset = Object.assign(new Error('socket hang up'), { code: 'ESOCKET' });

    expect(smtpFailureOf(certificate)).toBe('tls');
    expect(smtpFailureOf(reset)).toBe('unreachable');
  });

  it('names nothing for an error that isn’t a mail server’s', () => {
    expect(smtpFailureOf(new TypeError('undefined is not a function'))).toBeNull();
    expect(smtpFailureOf(Object.assign(new Error('?'), { code: 'EWHATEVER' }))).toBeNull();
    expect(smtpFailureOf(null)).toBeNull();
  });
});

describe('senderText', () => {
  it('writes a sender the way mail apps show it', () => {
    expect(senderText({ name: 'Adiutor Tests', address: 'no-reply@adiutor.test' })).toBe(
      'Adiutor Tests <no-reply@adiutor.test>',
    );
    expect(senderText({ name: null, address: 'no-reply@adiutor.test' })).toBe(
      'no-reply@adiutor.test',
    );
  });
});

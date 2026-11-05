/**
 * @file Tests for telling whether a host name is this computer.
 */
import { describe, expect, it } from 'vitest';

import isLocalHostname from './local-host';

describe('isLocalHostname', () => {
  it('accepts the loopback names and addresses, in any case', () => {
    [
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      '::1',
      '[::1]',
      'adiutor.localhost',
      'a.b.localhost',
    ].forEach((host) => {
      expect(isLocalHostname(host), host).toBe(true);
    });
  });

  it('accepts hosts as URL gives them, also for smtp and postgresql URLs', () => {
    [
      'http://localhost:3100',
      'http://[::1]:3000',
      'smtp://LocalHost:1025',
      'smtp://[::1]:1025',
      'postgresql://adiutor:adiutor@127.0.0.1:5432/adiutor',
    ].forEach((url) => {
      expect(isLocalHostname(new URL(url).hostname), url).toBe(true);
    });
  });

  it('refuses everything else, erring on the side of another computer', () => {
    [
      '',
      'adiutor.dev',
      'localhost.adiutor.dev',
      'mylocalhost',
      '.localhost',
      'localhost.',
      '127.0.0.2',
      '0.0.0.0',
      '192.168.1.10',
      'db',
      '::2',
    ].forEach((host) => {
      expect(isLocalHostname(host), host).toBe(false);
    });
  });
});

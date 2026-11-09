/**
 * @file Tests for what happens when a message can't be shown: tests fail on
 * it, production logs it.
 */
import { IntlError, IntlErrorCode } from 'use-intl/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_ERROR_PREFIX, onMessageError } from './message-errors';

/** A missing message, as next-intl reports one. */
const missing = new IntlError(IntlErrorCode.MISSING_MESSAGE, 'common.nothing');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('onMessageError', () => {
  it('throws outside production, so tests fail on it', () => {
    expect(() => onMessageError(missing)).toThrow(missing);
  });

  it('logs in production with a prefix the end-to-end tests recognise', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    onMessageError(missing);

    expect(log).toHaveBeenCalledWith(`${MESSAGE_ERROR_PREFIX} MISSING_MESSAGE: common.nothing`);
  });
});

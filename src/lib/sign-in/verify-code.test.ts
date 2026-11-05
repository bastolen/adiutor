/**
 * @file Tests for checking a code with the endpoint for its kind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import verifyCode from './verify-code';

const { verifyTotp, verifyOtp, verifyBackupCode } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyOtp: vi.fn(),
  verifyBackupCode: vi.fn(),
}));

vi.mock('./auth-client', () => ({
  default: { twoFactor: { verifyTotp, verifyOtp, verifyBackupCode } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyCode', () => {
  it.each([
    ['totp', verifyTotp],
    ['otp', verifyOtp],
    ['backup', verifyBackupCode],
  ] as const)('checks a %s code with its endpoint, trimmed', async (kind, endpoint) => {
    await verifyCode(kind, { code: '  123456 ' });

    expect(endpoint).toHaveBeenCalledExactlyOnceWith({ code: '123456' });
    [verifyTotp, verifyOtp, verifyBackupCode]
      .filter((other) => other !== endpoint)
      .forEach((other) => expect(other).not.toHaveBeenCalled());
  });

  it('passes on whether to trust the browser only when it’s given', async () => {
    await verifyCode('otp', { code: '123456', trustDevice: false });
    await verifyCode('otp', { code: '123456' });

    expect(verifyOtp.mock.calls).toStrictEqual([
      [{ code: '123456', trustDevice: false }],
      [{ code: '123456' }],
    ]);
  });

  it('returns Better Auth’s result unchanged', async () => {
    const refused = { data: null, error: { status: 401, code: 'INVALID_CODE' } };
    verifyTotp.mockResolvedValue(refused);

    await expect(verifyCode('totp', { code: '000000' })).resolves.toBe(refused);
  });
});

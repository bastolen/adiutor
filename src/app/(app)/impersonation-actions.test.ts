/**
 * @file Tests for the banner's question whether a sign-in as a user still
 * lasts: when it ends while signed in as someone, and nothing otherwise
 * (an ordinary session, one that's over, or signed out).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { getOptionalActor } from '@/server/authz';

import { signedInAsEndsAtAction } from './impersonation-actions';

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn(), stopSigningInAs: vi.fn() }));

/** When the sign-in as the user ends. */
const ENDS_AT = new Date('2026-11-13T10:30:00.000Z');

beforeEach(() => {
  vi.mocked(getOptionalActor).mockReset();
});

describe('signedInAsEndsAtAction', () => {
  it('says when the sign-in as a user ends', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({
      id: 'user-1',
      signedInAs: { endsAt: ENDS_AT },
    } as Actor);

    await expect(signedInAsEndsAtAction()).resolves.toBe('2026-11-13T10:30:00.000Z');
  });

  it('says nothing for an ordinary session, also once a sign-in as a user is over', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({ id: 'staff-1', signedInAs: null } as Actor);

    await expect(signedInAsEndsAtAction()).resolves.toBeNull();
  });

  it('says nothing when signed out', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);

    await expect(signedInAsEndsAtAction()).resolves.toBeNull();
  });
});

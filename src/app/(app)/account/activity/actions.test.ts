/**
 * @file Tests for the account Activity tab's actions: signing out on the
 * other devices says how many, as a whole sentence in each language.
 */
import { describe, expect, it, vi } from 'vitest';

import { revokeOtherOwnSessions } from '@/server/auth/sessions';

import { testLocale } from '../../../../../tests/i18n/next-intl-mocks';
import { revokeOtherSessionsAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn(async () => ({ id: 'user-1' })) }));
vi.mock('@/server/auth/sessions', () => ({
  revokeOtherOwnSessions: vi.fn(),
  revokeOwnSession: vi.fn(),
}));

describe('revokeOtherSessionsAction', () => {
  it.each([
    ['en-US', 1, 'Signed out on 1 other device.'],
    ['en-US', 3, 'Signed out on 3 other devices.'],
    ['nl-NL', 1, 'Uitgelogd op 1 ander apparaat.'],
    ['nl-NL', 3, 'Uitgelogd op 3 andere apparaten.'],
    ['es-ES', 3, 'Sesión cerrada en 3 dispositivos más.'],
  ] as const)('counts the devices in %s (%i)', async (locale, count, message) => {
    testLocale.current = locale;
    vi.mocked(revokeOtherOwnSessions).mockResolvedValue(count);

    expect(await revokeOtherSessionsAction()).toEqual({ ok: true, message });
  });
});

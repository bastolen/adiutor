/**
 * @file Tests for the mode the page being rendered is kept in: the setting
 * as it's read, and each person's own choice when it can't be read.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import requestForcedTheme from './page-theme';
import { loadForcedTheme } from './theme-settings';

vi.mock('@/db', () => ({ db: { name: 'database' } }));
vi.mock('./theme-settings', () => ({ loadForcedTheme: vi.fn() }));

afterEach(() => {
  vi.mocked(loadForcedTheme).mockReset();
});

describe('requestForcedTheme', () => {
  it('gives the mode a staff Admin keeps every page in', async () => {
    vi.mocked(loadForcedTheme).mockResolvedValue('dark');

    expect(await requestForcedTheme()).toBe('dark');
    expect(loadForcedTheme).toHaveBeenCalledWith({ name: 'database' });
  });

  it('lets each person choose when the mode can’t be read, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadForcedTheme).mockRejectedValue(new Error('the database is down'));

    expect(await requestForcedTheme()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'The light or dark mode could not be read; each person’s own choice stands.',
    );
    warn.mockRestore();
  });
});

/**
 * @file Tests for the form that chooses Adiutor's default time zone.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { timeZoneOptions } from '@/lib/i18n/time-zones';

import renderInLocale from '../../../../../tests/i18n/render';
import { saveDefaultTimeZoneAction } from './actions';
import DefaultTimeZoneForm from './default-time-zone-form';

vi.mock('./actions', () => ({ saveDefaultTimeZoneAction: vi.fn() }));

/** The zones to pick from, as the page makes them. */
const OPTIONS = timeZoneOptions(new Date('2026-12-01T12:00:00Z'), 'UTC');

afterEach(() => {
  vi.mocked(saveDefaultTimeZoneAction).mockReset();
});

describe('DefaultTimeZoneForm', () => {
  it('saves the chosen zone, and says so', async () => {
    vi.mocked(saveDefaultTimeZoneAction).mockResolvedValue({
      ok: true,
      message: 'Default time zone saved.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <DefaultTimeZoneForm defaultTimeZone="UTC" options={OPTIONS} />);

    const select = screen.getByRole('combobox', { name: 'Default time zone' });
    expect(select).toHaveTextContent(/^UTC$/);
    await user.click(select);
    await user.keyboard('amsterdam{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save default time zone' }));

    await waitFor(() => expect(saveDefaultTimeZoneAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveDefaultTimeZoneAction).mock.calls[0], 'the call')[1];
    expect(formData.get('defaultTimeZone')).toBe('Europe/Amsterdam');
    expect(await screen.findByText('Default time zone saved.')).toBeInTheDocument();
    // It edits a saved setting: the select keeps the zone just saved.
    expect(select).toHaveTextContent('Amsterdam (UTC+01:00)');
  });
});

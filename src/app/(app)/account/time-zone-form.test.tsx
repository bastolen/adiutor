/**
 * @file Tests for the account's time zone form. How the page loads afresh is
 * `loadFresh`'s own concern (`load-fresh.test.ts`), so it's mocked here, and
 * so is the browser's zone.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import { timeZoneOptions } from '@/lib/i18n/time-zones';

import renderInLocale from '../../../../tests/i18n/render';
import { saveTimeZoneAction } from './actions';
import TimeZoneForm from './time-zone-form';

/** The full page load and the browser's zone, mocked. */
const { loadFresh, useBrowserTimeZone } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  useBrowserTimeZone: vi.fn<() => string | null>(() => null),
}));

vi.mock('./actions', () => ({ saveTimeZoneAction: vi.fn() }));
vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));
vi.mock('@/lib/i18n/use-browser-time-zone', () => ({ default: useBrowserTimeZone }));

/** Where the action sends the page once the zone is saved. */
const SAVED_PATH = '/account?timeZone=saved#time-zone';

/** The zones to pick from, as the page makes them. */
const OPTIONS = timeZoneOptions(new Date('2026-12-01T12:00:00Z'), 'Europe/Amsterdam');

afterEach(() => {
  loadFresh.mockClear();
  useBrowserTimeZone.mockReset().mockReturnValue(null);
  vi.mocked(saveTimeZoneAction).mockReset();
});

describe('TimeZoneForm', () => {
  it('starts on the account’s zone, each zone with its offset', () => {
    renderInLocale('en-US', <TimeZoneForm timeZone="Europe/Amsterdam" options={OPTIONS} />);

    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent(
      'Europe/Amsterdam (UTC+01:00)',
    );
  });

  it('saves the chosen zone and loads the page afresh where the action says', async () => {
    vi.mocked(saveTimeZoneAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const user = userEvent.setup();
    renderInLocale('en-US', <TimeZoneForm timeZone="Europe/Amsterdam" options={OPTIONS} />);

    await user.click(screen.getByRole('combobox', { name: 'Time zone' }));
    await user.click(screen.getByRole('option', { name: /^America\/New_York/ }));
    await user.click(screen.getByRole('button', { name: 'Save time zone' }));

    await waitFor(() => expect(loadFresh).toHaveBeenCalledExactlyOnceWith(SAVED_PATH));
    const formData = vi.mocked(saveTimeZoneAction).mock.calls[0]?.[1];
    expect(formData?.get('timeZone')).toBe('America/New_York');
  });

  it('offers the browser’s zone, and keeps the button where focus is once it’s chosen', async () => {
    useBrowserTimeZone.mockReturnValue('Asia/Tokyo');
    const user = userEvent.setup();
    renderInLocale('en-US', <TimeZoneForm timeZone="Europe/Amsterdam" options={OPTIONS} />);

    expect(screen.getByText('This browser is set to Asia/Tokyo.')).toBeInTheDocument();
    const useBrowser = screen.getByRole('button', { name: 'Use this browser’s zone' });
    await user.click(useBrowser);

    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('Asia/Tokyo');
    expect(useBrowser).toHaveFocus();
    expect(useBrowser).toHaveAttribute('aria-disabled', 'true');
  });

  it('adds the browser’s zone when the list names it otherwise', async () => {
    const options = OPTIONS.filter(({ value }) => value !== 'Asia/Kolkata');
    useBrowserTimeZone.mockReturnValue('Asia/Kolkata');
    const user = userEvent.setup();
    renderInLocale('en-US', <TimeZoneForm timeZone="Europe/Amsterdam" options={options} />);

    await user.click(screen.getByRole('button', { name: 'Use this browser’s zone' }));

    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent(
      'Asia/Kolkata (UTC+05:30)',
    );
  });

  it('shows why saving failed, and stays', async () => {
    vi.mocked(saveTimeZoneAction).mockResolvedValue({
      ok: false,
      message: 'Choose one of the time zones.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <TimeZoneForm timeZone="UTC" options={OPTIONS} />);

    await user.click(screen.getByRole('button', { name: 'Save time zone' }));

    expect(await screen.findByText('Choose one of the time zones.')).toBeInTheDocument();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('turns the select and the buttons off while a staff member is signed in as the user', () => {
    useBrowserTimeZone.mockReturnValue('Asia/Tokyo');
    renderInLocale(
      'nl-NL',
      <>
        <TimeZoneForm timeZone="UTC" options={OPTIONS} />
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'Tijdzone' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Tijdzone opslaan' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Zone van deze browser gebruiken' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

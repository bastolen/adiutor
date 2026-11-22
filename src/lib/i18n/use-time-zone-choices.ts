/**
 * @file The time zones as a select lists them: each under the heading of its
 * region, in the reader's language, for the Time zone cards (the account's
 * and the staff's default). See docs/i18n.md, "Time zones".
 */
'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { TimeZoneOption } from './time-zones';

/** A zone as a select's option: its name, its label and the heading it's listed under. */
export interface TimeZoneChoice {
  /** The zone's name, e.g. `Europe/Amsterdam`: what's saved. */
  value: string;
  /** What the list shows, e.g. "Amsterdam (UTC+01:00)". */
  label: string;
  /** Its region's heading, e.g. "Europe"; none for UTC, which comes first. */
  group?: string;
}

/**
 * Turns the zones (`timeZoneOptions`, in their order) into a select's
 * options, each with its region's heading (`common.timeZoneRegion`) as its
 * group.
 *
 * @param options - The zones, grouped by region.
 * @returns The options for the select.
 */
export default function useTimeZoneChoices(options: readonly TimeZoneOption[]): TimeZoneChoice[] {
  const t = useTranslations('common');
  return useMemo(
    () =>
      options.map(({ value, label, region }) =>
        region === null
          ? { value, label }
          : { value, label, group: t('timeZoneRegion', { region }) },
      ),
    [options, t],
  );
}

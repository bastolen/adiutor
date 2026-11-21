/**
 * @file The reader's time zone in a component, server or client: the zone
 * next-intl was given for the request (`requestTimeZone`, through the
 * providers), which formatting takes (`src/lib/format.ts`).
 */
import { useTimeZone } from 'next-intl';

import { DEFAULT_TIME_ZONE } from './time-zones';

/**
 * The time zone the reader sees times in.
 *
 * @returns The zone; UTC where no provider gives one (a test without one).
 */
export default function useReaderTimeZone(): string {
  return useTimeZone() ?? DEFAULT_TIME_ZONE;
}

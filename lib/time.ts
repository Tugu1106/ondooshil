import 'server-only';

import { env } from './env';

/**
 * Day-boundary logic for the station (spec §4, §6).
 *
 * The queue is a daily thing that resets at 00:00 Asia/Ulaanbaatar. That reset is
 * implemented as a date filter, never a deletion — no cron job, no 3am failure, and the
 * history stays available for debugging.
 *
 * Every `day` value in the database is produced here, at insert time, and every query
 * that filters by day compares against `todayInStationTz()`. Nothing computes a day
 * inline, and nothing uses the server's local time zone.
 *
 * The conversion goes through `Intl` with the IANA zone rather than a hardcoded +8, so
 * it stays correct if Mongolia ever reintroduces DST (it observed it as recently as
 * 2016). Nothing else in the app should need to know the offset.
 */

/** A calendar date in the station's time zone, formatted `YYYY-MM-DD`. */
export type StationDay = string;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      throw new Error(
        `TZ_OFFSET is not a valid IANA time zone name: "${timeZone}". Expected something like "Asia/Ulaanbaatar".`,
      );
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The station's configured time zone, e.g. `Asia/Ulaanbaatar`. */
export function stationTimeZone(): string {
  return env.stationTimeZone;
}

/**
 * The calendar day a given instant falls on, in the station's time zone.
 *
 * Assembled from `formatToParts` rather than a locale string so the result is
 * `YYYY-MM-DD` regardless of how any locale chooses to order or punctuate a date.
 */
export function dayOf(instant: Date, timeZone: string = stationTimeZone()): StationDay {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today in the station's time zone. The value written to `queue.day` and `reveals.day`. */
export function todayInStationTz(now: Date = new Date()): StationDay {
  return dayOf(now);
}

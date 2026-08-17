import 'server-only';

import type { Sky, SunPhase, WeatherCondition } from './types';
import { stationTimeZone } from './time';

/**
 * What it is doing outside, for the background.
 *
 * The whole office is in one room in Ulaanbaatar, so there is exactly one sky worth
 * drawing — the one they can see through the window. That is the same reason the station
 * has one queue and one playhead, so the coordinates are hardcoded rather than configured.
 * Multi-room is rejected by design (spec §15); this follows it.
 *
 * **Open-Meteo needs no API key and no account**, which is why it was chosen over the
 * alternatives: no sixth environment variable, no secret that could reach a client bundle,
 * nothing to rotate. Requests are unauthenticated and cached.
 *
 * Failure is never fatal. If the forecast cannot be reached the app gets a neutral sky and
 * carries on — the radio does not depend on the weather, and an outage must not look like
 * a bug in the station.
 */

/** Ulaanbaatar, Sükhbaatar Square. */
const LATITUDE = 47.9188;
const LONGITUDE = 106.9176;

/**
 * How long a reading is reused. Weather does not move in three seconds, and `/api/state`
 * is polled that often by every listener — so this is deliberately a separate, slow path
 * that never touches the hot one.
 *
 * Backed by Next's Data Cache, which on Vercel is shared across invocations. That matters:
 * module-level state would not survive there (spec §2), but this does.
 */
const CACHE_SECONDS = 900;

/** Minutes either side of sunrise and sunset that count as dawn and dusk. */
const TWILIGHT_MINUTES = 50;

/** Used when the forecast cannot be reached. Reads as an ordinary overcast day. */
const FALLBACK: Sky = {
  condition: 'overcast',
  phase: 'day',
  temperature: null,
  live: false,
};

type Forecast = {
  current?: { weather_code?: number; temperature_2m?: number; is_day?: number };
  daily?: { sunrise?: string[]; sunset?: string[] };
};

/**
 * WMO weather codes, collapsed to what is worth drawing differently.
 * See https://open-meteo.com/en/docs — the full table is finer than any background needs.
 */
function conditionOf(code: number | undefined): WeatherCondition {
  if (code === undefined) return 'overcast';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  // 71–77 snowfall and snow grains, 85–86 snow showers.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  // 51–67 drizzle and rain including freezing, 80–82 rain showers.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'overcast';
}

/** Minutes past midnight for an instant, in the station's time zone. */
function minutesOfDay(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: stationTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour12: false` yields 24 for midnight in some runtimes.
  return (get('hour') % 24) * 60 + get('minute');
}

/** `2026-08-17T05:42` — Open-Meteo returns these already in the requested zone. */
function localMinutes(isoLocal: string | undefined): number | null {
  if (!isoLocal) return null;
  const match = /T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Where the sun is. This drives the palette more than the weather does — an overcast night
 * and an overcast noon should not look remotely alike.
 */
function phaseOf(forecast: Forecast, now: Date): SunPhase {
  const sunrise = localMinutes(forecast.daily?.sunrise?.[0]);
  const sunset = localMinutes(forecast.daily?.sunset?.[0]);

  if (sunrise === null || sunset === null) {
    // No sun times: fall back to the API's own day flag rather than guessing.
    return forecast.current?.is_day === 0 ? 'night' : 'day';
  }

  const nowMinutes = minutesOfDay(now);
  if (Math.abs(nowMinutes - sunrise) <= TWILIGHT_MINUTES) return 'dawn';
  if (Math.abs(nowMinutes - sunset) <= TWILIGHT_MINUTES) return 'dusk';
  return nowMinutes > sunrise && nowMinutes < sunset ? 'day' : 'night';
}

/**
 * The current sky over the office. Cached for {@link CACHE_SECONDS}; never throws.
 */
export async function loadSky(now: Date = new Date()): Promise<Sky> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LATITUDE}&longitude=${LONGITUDE}` +
    '&current=weather_code,temperature_2m,is_day' +
    '&daily=sunrise,sunset&forecast_days=1' +
    `&timezone=${encodeURIComponent(stationTimeZone())}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return FALLBACK;

    const forecast = (await response.json()) as Forecast;
    const temperature = forecast.current?.temperature_2m;

    return {
      condition: conditionOf(forecast.current?.weather_code),
      phase: phaseOf(forecast, now),
      temperature: typeof temperature === 'number' ? Math.round(temperature) : null,
      live: true,
    };
  } catch {
    // Unreachable, slow, or malformed. The station does not care what it looks like outside.
    return FALLBACK;
  }
}

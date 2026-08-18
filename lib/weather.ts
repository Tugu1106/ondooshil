import 'server-only';

import type { Sky, SunPhase, WeatherCondition } from './types';
import { stationTimeZone } from './time';

/**
 * What it is doing outside, for the background and the readout.
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
  label: 'Weather unavailable',
  temperature: null,
  windKph: null,
  sunProgress: 0.5,
  live: false,
};

type Forecast = {
  current?: {
    weather_code?: number;
    temperature_2m?: number;
    is_day?: number;
    wind_speed_10m?: number;
  };
  daily?: { sunrise?: string[]; sunset?: string[] };
};

/**
 * The WMO code table, in the words a person would use.
 *
 * Kept separate from `conditionOf` on purpose: the art only needs seven states, but the
 * readout is worth being precise in. "Light drizzle" tells you something that "rain" does
 * not, and it is the difference between the background looking broken and looking correct
 * when you glance out of the window.
 */
const WMO_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Light snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
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
  // 71-77 snowfall and snow grains, 85-86 snow showers.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  // 51-67 drizzle and rain including freezing, 80-82 rain showers.
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
function phaseOf(
  sunrise: number | null,
  sunset: number | null,
  nowMinutes: number,
  isDay: number | undefined,
): SunPhase {
  if (sunrise === null || sunset === null) {
    // No sun times: fall back to the API's own day flag rather than guessing.
    return isDay === 0 ? 'night' : 'day';
  }

  if (Math.abs(nowMinutes - sunrise) <= TWILIGHT_MINUTES) return 'dawn';
  if (Math.abs(nowMinutes - sunset) <= TWILIGHT_MINUTES) return 'dusk';
  return nowMinutes > sunrise && nowMinutes < sunset ? 'day' : 'night';
}

/**
 * How far through daylight it is, so the client can place the sun on its arc without
 * needing a clock of its own — the same reason `/api/state` carries `serverTime`.
 */
function sunProgressOf(
  sunrise: number | null,
  sunset: number | null,
  nowMinutes: number,
): number | null {
  if (sunrise === null || sunset === null || sunset <= sunrise) return null;
  if (nowMinutes < sunrise || nowMinutes > sunset) return null;
  return (nowMinutes - sunrise) / (sunset - sunrise);
}

/** The current sky over the office. Cached for `CACHE_SECONDS`; never throws. */
export async function loadSky(now: Date = new Date()): Promise<Sky> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LATITUDE}&longitude=${LONGITUDE}` +
    '&current=weather_code,temperature_2m,is_day,wind_speed_10m' +
    '&daily=sunrise,sunset&forecast_days=1' +
    `&timezone=${encodeURIComponent(stationTimeZone())}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return FALLBACK;

    const forecast = (await response.json()) as Forecast;
    const code = forecast.current?.weather_code;
    const temperature = forecast.current?.temperature_2m;
    const wind = forecast.current?.wind_speed_10m;

    const sunrise = localMinutes(forecast.daily?.sunrise?.[0]);
    const sunset = localMinutes(forecast.daily?.sunset?.[0]);
    const nowMinutes = minutesOfDay(now);

    return {
      condition: conditionOf(code),
      phase: phaseOf(sunrise, sunset, nowMinutes, forecast.current?.is_day),
      label: (code !== undefined ? WMO_LABELS[code] : undefined) ?? 'Unknown',
      temperature: typeof temperature === 'number' ? Math.round(temperature) : null,
      windKph: typeof wind === 'number' ? Math.round(wind) : null,
      sunProgress: sunProgressOf(sunrise, sunset, nowMinutes),
      live: true,
    };
  } catch {
    // Unreachable, slow, or malformed. The station does not care what it looks like outside.
    return FALLBACK;
  }
}

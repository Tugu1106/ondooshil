import 'server-only';

import { env } from './env';

/**
 * URL parsing and YouTube Data API validation (spec §10).
 *
 * The rejections here are not fussiness — each one protects the timeline. The whole
 * schedule is arithmetic over durations, so a video without one (a live stream) would
 * freeze the station permanently, and a non-embeddable video would stall it mid-morning
 * looking exactly like a queue bug.
 */

/** Videos longer than this are refused (spec §10). */
export const MAX_DURATION_SEC = 10 * 60;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const WATCH_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]);

/**
 * Extracts the 11-character video id from any accepted URL form, or null.
 *
 * Accepts watch, youtu.be, shorts, embed and the mobile host (spec §10). Extra query
 * parameters are ignored by construction: only `v` is read, so a `&list=` playlist link
 * yields the single video and discards the playlist, exactly as required.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    // Tolerate a pasted "youtube.com/watch?v=..." with no scheme.
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID.test(id) ? id : null;
  }

  if (!WATCH_HOSTS.has(host)) return null;

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'watch') {
    const id = url.searchParams.get('v');
    return id && VIDEO_ID.test(id) ? id : null;
  }

  if (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') {
    const id = segments[1];
    return id && VIDEO_ID.test(id) ? id : null;
  }

  return null;
}

/**
 * ISO 8601 duration → seconds. Returns null if unparseable.
 *
 * Live broadcasts report `P0D`, which parses to 0 — the caller treats a non-positive
 * duration as "no duration" and rejects it.
 */
export function parseIso8601Duration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;

  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

export type VideoInfo = {
  videoId: string;
  title: string;
  durationSec: number;
};

export type LookupResult =
  | { ok: true; video: VideoInfo }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_embeddable' }
  | { ok: false; reason: 'live' }
  | { ok: false; reason: 'no_duration' }
  | { ok: false; reason: 'too_long'; durationSec: number }
  | { ok: false; reason: 'upstream'; detail: string };

type ApiResponse = {
  items?: Array<{
    snippet?: { title?: string; liveBroadcastContent?: string };
    contentDetails?: { duration?: string };
    status?: { embeddable?: boolean };
  }>;
};

/**
 * `videos.list` with the three parts the checks need. One unit of quota per call, out of
 * 10,000 a day — not a practical concern at six people.
 */
export async function lookupVideo(videoId: string): Promise<LookupResult> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails,status');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', env.youtubeApiKey);

  let payload: ApiResponse;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, reason: 'upstream', detail: `YouTube returned ${response.status}` };
    }
    payload = (await response.json()) as ApiResponse;
  } catch (cause) {
    return {
      ok: false,
      reason: 'upstream',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const item = payload.items?.[0];
  if (!item) return { ok: false, reason: 'not_found' };

  if (item.status?.embeddable !== true) return { ok: false, reason: 'not_embeddable' };

  // Covers both 'live' and 'upcoming'; only 'none' is a finished video with a duration.
  const broadcast = item.snippet?.liveBroadcastContent ?? 'none';
  if (broadcast !== 'none') return { ok: false, reason: 'live' };

  const rawDuration = item.contentDetails?.duration;
  const durationSec = rawDuration ? parseIso8601Duration(rawDuration) : null;
  if (durationSec === null || durationSec <= 0) return { ok: false, reason: 'no_duration' };

  if (durationSec > MAX_DURATION_SEC) return { ok: false, reason: 'too_long', durationSec };

  return {
    ok: true,
    video: {
      videoId,
      title: item.snippet?.title?.trim() || 'Untitled',
      durationSec,
    },
  };
}

import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError, readJson, readString } from '@/lib/http';
import { insertSong } from '@/lib/queue';
import { todayInStationTz } from '@/lib/time';
import { MAX_DURATION_SEC, lookupVideo, parseVideoId } from '@/lib/youtube';

/**
 * POST /api/queue — `{ url, showName }` (spec §10)
 *
 * Parse the id, validate against the Data API, insert. Every rejection gets its own
 * message so a person knows whether to fix the link or pick a different song.
 *
 * `added_by` comes from the session cookie and `day` from the server clock — neither is
 * ever accepted from the request body.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  const body = await readJson(request);
  const url = readString(body, 'url');
  const showName = body.showName === true;

  if (!url) {
    return apiError(400, 'bad_request', 'Paste a YouTube link.');
  }

  const videoId = parseVideoId(url);
  if (!videoId) {
    return apiError(
      400,
      'invalid_url',
      "That doesn't look like a YouTube link. Paste one from the address bar or the Share button.",
    );
  }

  const lookup = await lookupVideo(videoId);

  if (!lookup.ok) {
    switch (lookup.reason) {
      case 'not_found':
        return apiError(404, 'video_not_found', "That video doesn't exist, or it's private.");
      case 'not_embeddable':
        return apiError(
          422,
          'not_embeddable',
          "This video can't be embedded, so the radio can't play it. Try a different upload.",
        );
      case 'live':
        return apiError(
          422,
          'live_stream',
          "Live streams can't be queued — the station needs to know how long a song runs.",
        );
      case 'no_duration':
        return apiError(
          422,
          'live_stream',
          "That video has no fixed length, so the station can't schedule it.",
        );
      case 'too_long':
        return apiError(
          422,
          'too_long',
          `That's ${Math.round(lookup.durationSec / 60)} minutes. The limit is ${MAX_DURATION_SEC / 60}.`,
          { durationSec: lookup.durationSec, maxDurationSec: MAX_DURATION_SEC },
        );
      case 'upstream':
        return apiError(
          502,
          'youtube_unavailable',
          "Couldn't reach YouTube just now. Try again in a moment.",
        );
    }
  }

  const item = await insertSong({
    videoId: lookup.video.videoId,
    title: lookup.video.title,
    durationSec: lookup.video.durationSec,
    addedBy: user.id,
    showName,
    day: todayInStationTz(),
  });

  // Deliberately minimal: the caller re-polls /api/state, which applies the anonymity
  // rules. Nothing identity-bearing is echoed back here.
  return NextResponse.json({
    added: { id: item.id, title: item.title, durationSec: item.duration_sec },
  });
}

import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError, readJson, readString } from '@/lib/http';
import { markFailedAndAdvance } from '@/lib/playback';
import { todayInStationTz } from '@/lib/time';

/**
 * POST /api/queue/:id/failed — `{ videoId }`
 *
 * Not in spec §11's endpoint list, but spec §7 makes the behaviour mandatory: when the
 * IFrame player reports an error the item must be marked `failed` and the station must
 * advance immediately, or it silently dies on the first non-embeddable upload.
 *
 * Any signed-in listener may report a failure, because any listener's player is where the
 * error surfaces — this is a fact about the video, not an ownership action. The guards in
 * `markFailedAndAdvance` keep that narrow: only the currently playing item, only when the
 * reported video id matches it.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  const { id } = await params;
  const body = await readJson(request);
  const videoId = readString(body, 'videoId');

  if (!videoId) {
    return apiError(400, 'bad_request', 'Which video failed?');
  }

  const result = await markFailedAndAdvance(id, videoId, new Date(), todayInStationTz());

  // A stale report is not an error: another client got there first, which is the normal
  // outcome when several people have the station open.
  return NextResponse.json({ advanced: result.outcome === 'advanced' });
}

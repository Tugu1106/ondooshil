import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { skipCurrent } from '@/lib/playback';
import { todayInStationTz } from '@/lib/time';

/**
 * POST /api/queue/:id/skip — skip your own currently playing song (spec §8).
 *
 * The response says nothing about who did it, and neither does anything else. Only the
 * adder can skip, so "skipped by Bat" would reveal that Bat queued the anonymous song for
 * free, bypassing the whole reveal-ticket system. The station simply moves on.
 */

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  const { id } = await params;
  const result = await skipCurrent(id, user.id, new Date(), todayInStationTz());

  switch (result.outcome) {
    case 'skipped':
      return NextResponse.json({ skipped: true });
    case 'unknown':
      return apiError(404, 'unknown_user', 'That song is no longer in the queue.');
    case 'not_yours':
      return apiError(403, 'not_yours', 'You can only skip songs you added.');
    case 'not_playing':
      return apiError(409, 'not_playing', "That song isn't on air.");
  }
}

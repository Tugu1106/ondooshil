import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { spendReveal } from '@/lib/reveals';
import { todayInStationTz } from '@/lib/time';

/**
 * POST /api/reveal/:id — spend a ticket, learn who queued a song (spec §9).
 *
 * Three a day, resetting at midnight in the station's time zone. The purpose is social
 * accountability for deliberately unlistenable songs, at a cost, so it only happens when
 * somebody actually cares.
 *
 * A reveal is **private to the person who spent it**. Nothing is announced, nothing is
 * written that another viewer can see, and the response goes only to the spender.
 */

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  const { id } = await params;
  const result = await spendReveal(user.id, id, todayInStationTz());

  switch (result.outcome) {
    case 'revealed':
    case 'free':
      return NextResponse.json({ name: result.name, revealsRemaining: result.remaining });
    case 'unknown':
      return apiError(404, 'unknown_user', 'That song is no longer in the queue.');
    case 'exhausted':
      return apiError(
        429,
        'locked_out',
        "You've used all three reveals today. They come back tomorrow.",
      );
  }
}

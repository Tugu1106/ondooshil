import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { removePending } from '@/lib/playback';

/**
 * DELETE /api/queue/:id — remove your own pending song (spec §8).
 *
 * Ownership is checked here, on the server. The UI hides the button on other people's
 * rows, but hiding a button is not a permission — this is where the rule actually lives.
 */

export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  const { id } = await params;
  const result = await removePending(id, user.id);

  switch (result.outcome) {
    case 'removed':
      return NextResponse.json({ removed: true });
    case 'unknown':
      return apiError(404, 'unknown_user', 'That song is no longer in the queue.');
    case 'not_yours':
      return apiError(403, 'not_yours', 'You can only remove songs you added.');
    case 'not_pending':
      return apiError(409, 'not_pending', 'That song has already had its turn.');
    case 'on_air':
      return apiError(409, 'on_air', "That one's on air. Skip it instead.");
  }
}

import 'server-only';

import { listUsersForPicker, type PublicUser } from './auth';
import { listDay, orderRoundRobin } from './queue';
import { revealedTodayBy, revealsRemaining } from './reveals';
import { toNowPlaying, toQueueRow } from './serialize';
import { todayInStationTz } from './time';
import { resolveState } from './timeline';
import { supabaseTimelineRepo } from './timeline-repo';
import type { StateResponse } from './types';

/**
 * Builds the `/api/state` payload.
 *
 * Shared by the route handler and the page's server render, so the first paint already
 * has the station, and there is exactly one implementation of the anonymity rules rather
 * than two that could drift apart.
 *
 * Order matters: `resolveState()` runs first and may advance the broadcast, so the queue
 * has to be read afterwards or the payload would describe a song that has already ended.
 */
export async function buildState(viewer: PublicUser): Promise<StateResponse> {
  const now = new Date();
  const day = todayInStationTz(now);

  const resolved = await resolveState(supabaseTimelineRepo(), now, day);

  const [items, users, revealedItemIds] = await Promise.all([
    listDay(day),
    listUsersForPicker(),
    revealedTodayBy(viewer.id, day),
  ]);

  const context = {
    viewerId: viewer.id,
    namesById: new Map(users.map((user) => [user.id, user.name])),
    revealedItemIds,
  };

  // The playing song keeps `status = 'pending'` — which song is current is owned by
  // player_state, not by that column — so it is excluded from "up next" here rather than
  // by an extra write on every transition.
  const pending = items.filter(
    (item) => item.status === 'pending' && item.id !== resolved.current?.id,
  );

  // Everything no longer waiting: played, skipped or failed, newest first. Skips carry no
  // attribution — only the adder can skip, so naming them would give away authorship for
  // free and defeat the reveal system (spec §8).
  const finished = items
    .filter((item) => item.status !== 'pending')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    serverTime: now.toISOString(),
    me: {
      id: viewer.id,
      name: viewer.name,
      isOwner: viewer.isOwner,
      revealsRemaining: revealsRemaining(revealedItemIds.size),
    },
    playing:
      resolved.current && resolved.startedAt
        ? toNowPlaying(resolved.current, resolved.startedAt, context)
        : null,
    upNext: orderRoundRobin(pending).map((item) => toQueueRow(item, context)),
    playedToday: finished.map((item) => toQueueRow(item, context)),
  };
}

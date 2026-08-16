import 'server-only';

import { listUsersForPicker, type PublicUser } from './auth';
import { listDay, orderRoundRobin } from './queue';
import { revealedTodayBy, revealsRemaining } from './reveals';
import { toQueueRow } from './serialize';
import { todayInStationTz } from './time';
import type { StateResponse } from './types';

/**
 * Builds the `/api/state` payload.
 *
 * Shared by the route handler and the page's server render, so the first paint already
 * has data — no empty flash — and there is exactly one implementation of the anonymity
 * rules rather than two that could drift apart.
 *
 * Three queries: the day's queue, the user names, this viewer's reveals. This is the hot
 * path — every client calls it every 3 seconds — so keep the count down.
 */
export async function buildState(viewer: PublicUser): Promise<StateResponse> {
  const day = todayInStationTz();

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

  const pending = items.filter((item) => item.status === 'pending');

  // Everything no longer waiting: played, skipped or failed, newest first. Skips carry no
  // attribution — only the adder can skip, so naming them would give away authorship for
  // free and defeat the reveal system (spec §8).
  const finished = items
    .filter((item) => item.status !== 'pending')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    serverTime: new Date().toISOString(),
    me: {
      id: viewer.id,
      name: viewer.name,
      isOwner: viewer.isOwner,
      revealsRemaining: revealsRemaining(revealedItemIds.size),
    },
    // Phase 3 replaces this with resolveState(). Silence is the correct empty state —
    // there is no fallback playlist by design.
    playing: null,
    upNext: orderRoundRobin(pending).map((item) => toQueueRow(item, context)),
    playedToday: finished.map((item) => toQueueRow(item, context)),
  };
}

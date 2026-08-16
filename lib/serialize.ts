import 'server-only';

import type { QueueItemRow } from './queue';
import type { NowPlaying, QueueRow } from './types';

/**
 * The single choke point for the anonymity rule (spec §9).
 *
 * `added_by` is stored on every song, anonymous ones included — round-robin ordering,
 * adder-only skip and remove, and reveals all need it. Anonymity is a *display* concern,
 * enforced right here, on the way out.
 *
 * Two properties this file must never lose:
 *
 * 1. The returned object is built field by field. It is never spread from the database
 *    row, so a column added to `queue` later cannot leak by accident. A hidden field in a
 *    JSON payload is not hidden — the browser receives the whole payload.
 *
 * 2. `addedByName` is the ONLY field that can carry identity. `isMine`, `canRemove` and
 *    `revealed` describe the viewer's own relationship to the row and are false for
 *    everyone else's songs, so they disclose nothing.
 */

export type SerializeContext = {
  /** Always from the session cookie, never from a request body. */
  viewerId: string;
  namesById: Map<string, string>;
  /** Queue items this viewer has spent a reveal ticket on today. */
  revealedItemIds: Set<string>;
};

/** A viewer sees a name if the adder opted in, if it is their own song, or if they paid. */
function nameFor(item: QueueItemRow, context: SerializeContext, isMine: boolean): string | null {
  const entitled = item.show_name || isMine || context.revealedItemIds.has(item.id);
  if (!entitled) return null;
  return context.namesById.get(item.added_by) ?? null;
}

export function toQueueRow(item: QueueItemRow, context: SerializeContext): QueueRow {
  const isMine = item.added_by === context.viewerId;

  return {
    id: item.id,
    videoId: item.video_id,
    title: item.title,
    durationSec: item.duration_sec,
    status: item.status,
    addedByName: nameFor(item, context, isMine),
    isMine,
    canRemove: isMine && item.status === 'pending',
    revealed: context.revealedItemIds.has(item.id),
  };
}

/**
 * The currently playing song. Same identity rule as `toQueueRow`, same field-by-field
 * construction — the two must never diverge, because a leak in either is a leak.
 *
 * `canSkip` is simply "is this mine": only the adder may skip their own song (spec §8).
 * The skip itself is silent; nothing anywhere names who did it.
 */
export function toNowPlaying(
  item: QueueItemRow,
  startedAt: Date,
  context: SerializeContext,
): NowPlaying {
  const isMine = item.added_by === context.viewerId;

  return {
    queueItemId: item.id,
    videoId: item.video_id,
    title: item.title,
    durationSec: item.duration_sec,
    startedAt: startedAt.toISOString(),
    addedByName: nameFor(item, context, isMine),
    canSkip: isMine,
  };
}

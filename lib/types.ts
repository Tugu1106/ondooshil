/**
 * The `/api/state` contract (BUILD-PLAN §Contracts).
 *
 * Shapes are stable from here on. Later phases fill in fields — `playing` in Phase 3,
 * `revealed` becoming spendable in Phase 7 — but nothing is renamed or restructured.
 *
 * Deliberately NOT `server-only`: client components import these types. It contains types
 * exclusively, so nothing ships to the browser at runtime.
 *
 * The identity rule (spec §9) is expressed in the types themselves: the only field that
 * can carry a person's identity is `addedByName`, and it is nullable. There is no
 * `addedById`, no hash, nothing else derivable. A hidden field in a JSON payload is not
 * hidden.
 */

export type QueueStatus = 'pending' | 'playing' | 'played' | 'skipped' | 'failed';

export type QueueRow = {
  id: string;
  videoId: string;
  title: string;
  durationSec: number;
  status: QueueStatus;
  /** Null when the song is anonymous and this viewer is not entitled to the name. */
  addedByName: string | null;
  /** Only ever true for the viewer's own songs, so it reveals nothing about anyone else. */
  isMine: boolean;
  canRemove: boolean;
  /** Whether this viewer has already spent a reveal ticket on this row. */
  revealed: boolean;
};

export type NowPlaying = {
  queueItemId: string;
  videoId: string;
  title: string;
  durationSec: number;
  /** ISO 8601. The client derives its playhead from this plus the server clock offset. */
  startedAt: string;
  addedByName: string | null;
  /** True only if this viewer added it — only the adder may skip (spec §8). */
  canSkip: boolean;
};

export type Viewer = {
  id: string;
  name: string;
  isOwner: boolean;
  revealsRemaining: number;
};

export type StateResponse = {
  /** ISO 8601. Clients compute their clock offset from this once, never from Date.now(). */
  serverTime: string;
  me: Viewer;
  /** Null means silence. There is no fallback playlist by design. */
  playing: NowPlaying | null;
  /** Round-robin ordered, today only. */
  upNext: QueueRow[];
  /** Today's history — played, skipped and failed — newest first. */
  playedToday: QueueRow[];
};

export type ApiError = {
  error: { code: string; message: string; [key: string]: unknown };
};

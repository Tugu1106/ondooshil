import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { buildState } from '@/lib/state';

/**
 * GET /api/state — the hot path. Every client hits this every 3 seconds.
 *
 * Phase 2 returns the full contract shape with `playing` fixed at null. Phase 3 wires in
 * `resolveState()` and fills that field; no other field changes shape.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const viewer = await currentUser();
  if (!viewer) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }

  return NextResponse.json(await buildState(viewer), {
    headers: { 'cache-control': 'no-store' },
  });
}

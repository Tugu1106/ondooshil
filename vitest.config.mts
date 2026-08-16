import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests only, for pure logic: the timeline engine, round-robin ordering, and the
 * YouTube URL/duration parsers. Nothing here touches Supabase or a browser — the timeline
 * takes its clock and its storage as parameters precisely so it can be tested this way.
 *
 * End-to-end behaviour is checked by the per-phase scripts against the running app.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
      // See tests/stubs/server-only.ts — the real package throws without Next's
      // `react-server` resolution condition.
      'server-only': resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
});

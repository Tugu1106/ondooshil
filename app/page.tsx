/**
 * Placeholder. The real single-page UI — auth gate, now playing, add box, up next,
 * played today — arrives across Phases 1, 2, 4 and 5. Phase 0 only proves the app boots
 * and can reach the database, which `/api/health` reports.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Office Radio</h1>
      <p style={{ color: 'var(--text-muted)' }}>
        One queue, one speaker, one continuous broadcast.
      </p>
      <p style={{ color: 'var(--text-muted)' }}>
        Setting up — check <a href="/api/health">/api/health</a> for configuration status.
      </p>
    </main>
  );
}

import 'server-only';

/**
 * Environment access for Office Radio.
 *
 * Every secret in this app is server-only (spec §13): no `NEXT_PUBLIC_` prefixes, ever.
 * The `server-only` import above turns an accidental client import into a build error
 * rather than a leaked service role key.
 *
 * Values are read lazily through getters instead of validated once at module load. A
 * missing key therefore fails loudly at the point of use — with a message naming the
 * variable — while still letting the app boot, `next build` run, and `/api/health`
 * report what is missing. Validating at import time would mean the whole app refuses to
 * start because, say, the YouTube key isn't set yet.
 */

export const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'YOUTUBE_API_KEY',
  'SESSION_SECRET',
  'TZ_OFFSET',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

export class MissingEnvError extends Error {
  constructor(key: EnvKey, detail: string) {
    super(`Environment variable ${key} ${detail}. See .env.example.`);
    this.name = 'MissingEnvError';
  }
}

type Rule = {
  /** Optional vars fall back to a default instead of throwing. */
  fallback?: string;
  /** Returns an error fragment when the value is present but unusable. */
  check?: (value: string) => string | null;
};

const RULES: Record<EnvKey, Rule> = {
  SUPABASE_URL: {
    check: (v) => (v.startsWith('https://') ? null : 'must be an https:// URL'),
  },
  SUPABASE_SERVICE_ROLE_KEY: {},
  YOUTUBE_API_KEY: {},
  SESSION_SECRET: {
    // iron-session requires at least 32 characters.
    check: (v) => (v.length >= 32 ? null : 'must be at least 32 characters'),
  },
  // Named TZ_OFFSET by spec §13, but it holds an IANA time zone name, not an offset.
  // Kept under the spec's name so deployment config matches the document.
  TZ_OFFSET: { fallback: 'Asia/Ulaanbaatar' },
};

function read(key: EnvKey): string {
  const rule = RULES[key];
  const raw = process.env[key]?.trim();

  if (!raw) {
    if (rule.fallback !== undefined) return rule.fallback;
    throw new MissingEnvError(key, 'is not set');
  }

  const problem = rule.check?.(raw);
  if (problem) throw new MissingEnvError(key, problem);

  return raw;
}

export const env = {
  get supabaseUrl() {
    return read('SUPABASE_URL');
  },
  get supabaseServiceRoleKey() {
    return read('SUPABASE_SERVICE_ROLE_KEY');
  },
  get youtubeApiKey() {
    return read('YOUTUBE_API_KEY');
  },
  get sessionSecret() {
    return read('SESSION_SECRET');
  },
  get stationTimeZone() {
    return read('TZ_OFFSET');
  },
};

export type EnvStatus = 'ok' | 'missing' | 'invalid' | 'default';

/**
 * Non-throwing report of which variables are usable. Used by `/api/health` so setup
 * problems are visible without reading server logs. Never returns any secret's value.
 */
export function envStatus(): Record<EnvKey, EnvStatus> {
  const out = {} as Record<EnvKey, EnvStatus>;

  for (const key of ENV_KEYS) {
    const raw = process.env[key]?.trim();
    if (!raw) {
      out[key] = RULES[key].fallback !== undefined ? 'default' : 'missing';
      continue;
    }
    out[key] = RULES[key].check?.(raw) ? 'invalid' : 'ok';
  }

  return out;
}

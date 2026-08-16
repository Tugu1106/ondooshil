import { NextResponse } from 'next/server';

/**
 * The error shape used by every API route: `{ error: { code, message } }` with a real
 * HTTP status. `message` is written to be shown to a user verbatim.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_pin_format'
  | 'unknown_user'
  | 'wrong_pin'
  | 'locked_out'
  | 'pin_already_set'
  | 'pin_not_set'
  | 'no_device'
  | 'not_authenticated'
  | 'not_owner'
  | 'server_error';

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message, ...details } }, { status });
}

/** Parses a JSON body, tolerating an absent or malformed one by returning `{}`. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

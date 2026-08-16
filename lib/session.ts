import 'server-only';

import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';

import { env } from './env';

/**
 * The two cookies (spec §5).
 *
 * | cookie   | lifetime | job                                                        |
 * |----------|----------|------------------------------------------------------------|
 * | `device` | 10 years | remembers who last used this machine                       |
 * | `session`| 30 days  | the only thing that authorizes an action                   |
 *
 * Two cookies exist so that re-identifying as *yourself* is frictionless while claiming
 * *someone else's* name costs a PIN. With one cookie, every expiry would dump the whole
 * room back to a name picker.
 *
 * BOTH are encrypted iron-sessions, not just `session`. The spec calls `device` "not
 * proof of identity", which is true of authorizing actions — but `device` is what lets
 * someone mint a session with no PIN, and the name picker necessarily ships every user's
 * id to the browser. A plain-text `device` cookie would therefore be a one-line
 * impersonation of anyone in the office. Signing it costs nothing and closes that.
 *
 * Cookie *reads* work anywhere. Cookie *writes* only work in route handlers and server
 * functions, which is why every mutation below lives behind an API route.
 */

const THIRTY_DAYS_SEC = 60 * 60 * 24 * 30;
const TEN_YEARS_SEC = 60 * 60 * 24 * 365 * 10;

export const SESSION_COOKIE = 'office_radio_session';
export const DEVICE_COOKIE = 'office_radio_device';

/** Both cookies carry only a user id. Everything else is looked up server-side. */
export type SessionData = { userId?: string };

function optionsFor(cookieName: string, ttl: number) {
  return {
    cookieName,
    password: env.sessionSecret,
    ttl,
    cookieOptions: {
      httpOnly: true,
      // Dev runs over plain http; forcing secure there would silently drop the cookie.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), optionsFor(SESSION_COOKIE, THIRTY_DAYS_SEC));
}

export async function getDevice(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), optionsFor(DEVICE_COOKIE, TEN_YEARS_SEC));
}

/**
 * Establish identity after a successful PIN check or device continue.
 *
 * Always writes both cookies (spec §5): the session authorizes, and the device cookie is
 * refreshed so this machine keeps offering the frictionless path for another ten years.
 */
export async function signIn(userId: string): Promise<void> {
  const session = await getSession();
  session.userId = userId;
  await session.save();

  const device = await getDevice();
  device.userId = userId;
  await device.save();
}

/** Clears `session` only. `device` survives, so the next visit offers "Continue". */
export async function signOut(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

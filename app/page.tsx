import AuthGate from '@/components/AuthGate';
import SignedIn from '@/components/SignedIn';
import { currentUser, deviceUser, listUsersForPicker } from '@/lib/auth';

/**
 * The whole app lives at `/` (spec §11). There is no admin page, because there is no
 * admin.
 *
 * This is a server component, so the identity decision happens on the server and the
 * browser is only ever handed what it is entitled to: names, ids, and whether each name
 * is claimed. `pin_hash` is reduced to a boolean before it leaves `lib/auth`.
 *
 * Reading cookies makes the route dynamic; `force-dynamic` states that rather than
 * leaving it to be inferred.
 */

export const dynamic = 'force-dynamic';

export default async function Home() {
  const viewer = await currentUser();
  const users = await listUsersForPicker();

  if (viewer) {
    return <SignedIn user={viewer} users={users} />;
  }

  return <AuthGate deviceUser={await deviceUser()} users={users} />;
}

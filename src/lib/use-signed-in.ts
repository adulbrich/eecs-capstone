import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";

/**
 * Whether the viewer is signed in, as the server would have answered: false
 * until the client has mounted, so the first client render matches the
 * signed-out markup the server produced. See `useHasMounted` for why the
 * session's own `isPending` is not enough.
 *
 * For components on public routes that render a signed-in-only control.
 * A component that also needs the user's fields reads the session itself.
 */
export function useSignedIn(): boolean {
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  return hasMounted && !!session?.user;
}

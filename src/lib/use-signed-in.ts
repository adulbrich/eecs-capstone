import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";

/**
 * The signed-in viewer's user id, as the server would have answered:
 * undefined until the client has mounted, so the first client render matches
 * the signed-out markup the server produced. See `useHasMounted` for why the
 * session's own `isPending` is not enough.
 *
 * For a TanStack Query key over the viewer's own data, which carries this id
 * so one viewer's cached rows never show to the next in the same tab (see
 * docs/QUIRKS.md, "A TanStack Query key for the viewer's own data carries
 * their user id"). A component that needs other fields of the user reads the
 * session itself.
 */
export function useSignedInUserId(): string | undefined {
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  return hasMounted ? session?.user?.id : undefined;
}

/**
 * Whether the viewer is signed in, on the same mount gate as
 * `useSignedInUserId`. For components on public routes that render a
 * signed-in-only control.
 */
export function useSignedIn(): boolean {
  return useSignedInUserId() !== undefined;
}

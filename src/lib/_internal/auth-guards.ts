import { redirect } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "#/lib/auth";

export function readSession() {
  const req = getRequest();
  return auth.api.getSession({ headers: req.headers });
}

/**
 * What the `getSession` server function sends: the user, not the session row,
 * which carries the raw token, the IP address and the user agent.
 * `authClient.useSession()` still receives the row from Better Auth; see the
 * QUIRKS entry "The raw session token reaches page JavaScript".
 */
export async function readClientSession() {
  const session = await readSession();
  return session ? { user: session.user } : null;
}

export async function requireUser() {
  const session = await readSession();
  if (!session?.user) {
    throw redirect({ to: "/sign-in" });
  }
  return session.user;
}

export async function requireRole(roles: string[]) {
  const session = await readSession();
  if (!session?.user) {
    throw redirect({ to: "/sign-in" });
  }
  if (!roles.includes(session.user.role ?? "")) {
    throw redirect({ to: "/" });
  }
  return session.user;
}

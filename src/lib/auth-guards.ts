import { redirect } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "#/lib/auth";

export async function getSession() {
  const req = getRequest();
  return auth.api.getSession({ headers: req.headers });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    throw redirect({ to: "/sign-in" });
  }
  return session.user;
}

export async function requireRole(roles: string[]) {
  const session = await getSession();
  if (!session?.user) {
    throw redirect({ to: "/sign-in" });
  }
  if (!roles.includes(session.user.role ?? "")) {
    throw redirect({ to: "/" });
  }
  return session.user;
}

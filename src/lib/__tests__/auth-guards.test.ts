import { describe, expect, it, vi } from "vitest";

vi.mock("#/lib/auth", () => ({
  auth: {
    api: { getSession: vi.fn() },
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("http://localhost/", { headers: { cookie: "x=1" } }),
}));

import { auth } from "#/lib/auth";
import { requireRole, requireUser } from "../auth-guards.server";

describe("requireUser", () => {
  it("returns the user when a session exists", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "u1", email: "a@b.com", role: "user" },
      session: { id: "s1" },
    });

    const user = await requireUser();
    expect(user.id).toBe("u1");
  });

  it("throws a redirect when no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);

    await expect(requireUser()).rejects.toMatchObject({
      options: { to: "/sign-in" },
    });
  });
});

describe("requireRole", () => {
  it("returns the user when the role matches", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "u1", email: "a@b.com", role: "admin" },
      session: { id: "s1" },
    });

    const user = await requireRole(["admin", "instructor"]);
    expect(user.role).toBe("admin");
  });

  it("throws a redirect when the role does not match", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "u1", email: "a@b.com", role: "user" },
      session: { id: "s1" },
    });

    await expect(requireRole(["admin"])).rejects.toMatchObject({
      options: { to: "/" },
    });
  });

  it("throws a sign-in redirect when no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);

    await expect(requireRole(["admin"])).rejects.toMatchObject({
      options: { to: "/sign-in" },
    });
  });
});

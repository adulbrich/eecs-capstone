// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both buttons go through `signIn.social`: since Better Auth 1.7 ONID is a
// social provider like GitHub (#278).
const { social } = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock("#/lib/auth-client", () => ({
  authClient: { signIn: { social } },
}));

import { OAuthSignInButtons } from "#/components/oauth-sign-in-buttons";
import { searchSchema } from "#/routes/(auth)/sign-in";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// #579: a refusal has to come back to `/sign-in` naming the provider, or the
// banner cannot say what to do about it. GitHub had no error URL at all.
describe("OAuthSignInButtons", () => {
  it("sends a refused GitHub sign-in back to /sign-in, naming GitHub", () => {
    render(<OAuthSignInButtons redirectTo="/projects" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" })
    );
    expect(social).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/projects",
      errorCallbackURL: "/sign-in?provider=github",
    });
  });

  it("sends a refused ONID sign-in back to /sign-in, naming ONID", () => {
    render(<OAuthSignInButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ONID" }));
    expect(social).toHaveBeenCalledWith({
      provider: "onid",
      callbackURL: "/",
      errorCallbackURL: "/sign-in?provider=onid",
    });
  });
});

// #702: the buttons pass `redirectTo` straight to Better Auth as the
// callbackURL, so the route schema is what keeps it on this site. The param
// goes through the real schema here; a test that rendered with no prop would
// prove only the `?? "/"` fallback.
describe("the sign-in route's ?redirect= on its way to the buttons", () => {
  it.each(["https://evil.example/x", "//evil.example/x", "/\\evil.example/x"])(
    "sends %s to Better Auth as /",
    (redirect) => {
      const { redirect: redirectTo } = searchSchema.parse({ redirect });
      render(<OAuthSignInButtons redirectTo={redirectTo} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with ONID" })
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with GitHub" })
      );
      expect(social).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "onid", callbackURL: "/" })
      );
      expect(social).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "github", callbackURL: "/" })
      );
    }
  );

  it("keeps a path on this site", () => {
    const { redirect: redirectTo } = searchSchema.parse({
      redirect: "/projects?page=2",
    });
    render(<OAuthSignInButtons redirectTo={redirectTo} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ONID" }));
    expect(social).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "onid",
        callbackURL: "/projects?page=2",
      })
    );
  });
});

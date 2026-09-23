// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { oauth2, social } = vi.hoisted(() => ({
  oauth2: vi.fn(),
  social: vi.fn(),
}));
vi.mock("#/lib/auth-client", () => ({
  authClient: { signIn: { oauth2, social } },
}));

import { OAuthSignInButtons } from "#/components/oauth-sign-in-buttons";

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
    expect(oauth2).toHaveBeenCalledWith({
      providerId: "onid",
      callbackURL: "/",
      errorCallbackURL: "/sign-in?provider=onid",
    });
  });
});

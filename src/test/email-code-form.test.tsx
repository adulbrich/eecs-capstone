// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkVerificationOtp,
  clearCache,
  navigate,
  sendVerificationOtp,
  signInEmailOtp,
} = vi.hoisted(() => ({
  checkVerificationOtp: vi.fn(),
  clearCache: vi.fn(),
  navigate: vi.fn(),
  sendVerificationOtp: vi.fn(),
  signInEmailOtp: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({ clearCache }),
}));
vi.mock("#/lib/auth-client", () => ({
  authClient: {
    emailOtp: { checkVerificationOtp, sendVerificationOtp },
    signIn: { emailOtp: signInEmailOtp },
  },
}));
// The slots are drawing over one real input; a plain one is enough to type a
// code into.
vi.mock("#/components/ui/input-otp", () => ({
  InputOTP: ({
    id,
    onChange,
    value,
  }: {
    id: string;
    onChange: (next: string) => void;
    value: string;
  }) => (
    <input id={id} onChange={(e) => onChange(e.target.value)} value={value} />
  ),
  InputOTPGroup: () => null,
  InputOTPSlot: () => null,
}));

import { EmailCodeForm } from "#/components/email-code-form";

afterEach(cleanup);
beforeEach(() => {
  for (const mock of [
    checkVerificationOtp,
    clearCache,
    navigate,
    sendVerificationOtp,
    signInEmailOtp,
  ]) {
    mock.mockReset();
  }
  sendVerificationOtp.mockResolvedValue({ error: null });
  checkVerificationOtp.mockResolvedValue({ error: null });
});

async function enterCode() {
  render(<EmailCodeForm redirectTo="/projects" />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "staff@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  fireEvent.change(await screen.findByLabelText("Code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm code" }));
}

// Every cached match was loaded signed out, and the project pages keep a
// preload for five minutes (#762); this sign-in navigates on the client.
describe("a code sign-in", () => {
  it("drops every cached match before navigating", async () => {
    signInEmailOtp.mockResolvedValue({ error: null });
    await enterCode();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/projects" })
    );
    expect(clearCache).toHaveBeenCalledWith();
    expect(clearCache.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );
  });

  it("keeps the cache when the sign-in is refused", async () => {
    signInEmailOtp.mockResolvedValue({
      error: { message: "Invalid code" },
    });
    await enterCode();

    expect(await screen.findByText(/Invalid code/)).toBeTruthy();
    expect(clearCache).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

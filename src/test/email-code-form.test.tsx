// @vitest-environment jsdom
import {
  act,
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
// code into. `ref` and `disabled` pass through, so focus and the lock during a
// request reach the input a test reads.
vi.mock("#/components/ui/input-otp", () => ({
  InputOTP: ({
    disabled,
    id,
    onChange,
    ref,
    value,
  }: {
    disabled?: boolean;
    id: string;
    onChange: (next: string) => void;
    ref?: React.Ref<HTMLInputElement>;
    value: string;
  }) => (
    <input
      disabled={disabled}
      id={id}
      onChange={(e) => onChange(e.target.value)}
      ref={ref}
      value={value}
    />
  ),
  InputOTPGroup: () => null,
  InputOTPSlot: () => null,
}));

import { fc, test } from "@fast-check/vitest";
import {
  EmailCodeForm,
  minutesAndSeconds,
  RESEND_AFTER_SECONDS,
  resendWaitLeft,
} from "#/components/email-code-form";
import { doubleClickInOneTick } from "#/test/shared/double-click";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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

    expect(await screen.findByText(/Invalid code/u)).toBeTruthy();
    expect(clearCache).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * Runs the faked clock forward and lets every promise it releases settle.
 * `findBy` and `waitFor` poll on the timers these tests fake, so a failure
 * under them would hang rather than fail.
 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The code step for staff@example.com, reached on a faked clock. */
async function codeStep() {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  render(<EmailCodeForm redirectTo="/projects" />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "staff@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  await advance(0);
  return screen.getByLabelText("Code") as HTMLInputElement;
}

const WAIT_MS = RESEND_AFTER_SECONDS * 1000;

function resendButton() {
  return screen.queryByRole("button", { name: "Send a new code" });
}

function countdown() {
  return screen.queryByText(/You can ask for a new code in/u);
}

/**
 * A code that never arrives (#893): the send failed, a stranger rotated it
 * first, or the inbox is slow. The wait outlasts a normal delivery, because a
 * new code kills the one before it.
 */
describe("asking for a new code on the code step", () => {
  it("offers no new code until the wait ends, and counts it down", async () => {
    await codeStep();

    expect(resendButton()).toBeNull();
    expect(countdown()?.textContent).toBe(
      "Didn't get it? Check your spam folder. You can ask for a new code in 1:00."
    );

    await advance(15_000);
    expect(countdown()?.textContent).toContain("in 0:45.");

    await advance(WAIT_MS - 15_000 - 1);
    expect(resendButton()).toBeNull();

    await advance(1);
    expect(resendButton()).not.toBeNull();
    expect(countdown()).toBeNull();
  });

  it("sends to the same address, empties the slots and waits again", async () => {
    const field = await codeStep();
    await advance(WAIT_MS);
    fireEvent.change(field, { target: { value: "12" } });

    fireEvent.click(resendButton() as HTMLElement);
    await advance(0);

    expect(sendVerificationOtp).toHaveBeenCalledTimes(2);
    expect(sendVerificationOtp).toHaveBeenLastCalledWith({
      email: "staff@example.com",
      type: "sign-in",
    });
    expect(field.value).toBe("");
    expect(screen.getByRole("status").textContent).toBe(
      "We asked for a new code for staff@example.com. Use the newest code that arrives: each one replaces the one before."
    );
    // The button that had focus is gone; the field is where the new code goes.
    expect(document.activeElement).toBe(field);
    expect(resendButton()).toBeNull();
    expect(countdown()?.textContent).toContain("in 1:00.");

    await advance(WAIT_MS - 1);
    expect(resendButton()).toBeNull();
    await advance(1);
    expect(resendButton()).not.toBeNull();
  });

  it("shows a refusal and keeps the offer open", async () => {
    const field = await codeStep();
    await advance(WAIT_MS);
    fireEvent.change(field, { target: { value: "12" } });
    sendVerificationOtp.mockResolvedValueOnce({
      error: { message: "Too many requests. Try again later." },
    });

    fireEvent.click(resendButton() as HTMLElement);
    await advance(0);

    expect(screen.getByRole("alert").textContent).toBe(
      "Too many requests. Try again later."
    );
    // The earlier code was never replaced, so what was typed still counts,
    // and the code field is neither blamed nor handed the focus.
    expect(field.value).toBe("12");
    expect(document.activeElement).not.toBe(field);
    expect(screen.queryByRole("status")).toBeNull();
    expect(resendButton()).not.toBeNull();
    expect(countdown()).toBeNull();
  });

  it("locks the step while the new code is on its way", async () => {
    await codeStep();
    await advance(WAIT_MS);
    let answer: (value: { error: null }) => void = () => undefined;
    sendVerificationOtp.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );

    fireEvent.click(resendButton() as HTMLElement);
    await advance(0);

    expect(screen.getByRole("button", { name: "Sending..." })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "Confirm code" })).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole("button", { name: "Use a different address" })
    ).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Code")).toHaveProperty("disabled", true);

    answer({ error: null });
    await advance(0);
    expect(screen.getByRole("status")).not.toBeNull();
  });

  it("sends once for a double click inside one tick", async () => {
    await codeStep();
    await advance(WAIT_MS);

    await act(async () => {
      doubleClickInOneTick(resendButton() as HTMLElement);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sendVerificationOtp).toHaveBeenCalledTimes(2);
  });

  it("keeps the wait to one wait when the clock steps backward", async () => {
    await codeStep();
    await advance(10_000);

    vi.setSystemTime(Date.now() - 3_600_000);
    await advance(1000);

    expect(countdown()?.textContent).toContain("in 1:00.");
    await advance(WAIT_MS);
    expect(resendButton()).not.toBeNull();
  });

  it("empties a dead code's draft when the cookie check fails after a resend", async () => {
    const field = await codeStep();
    await advance(WAIT_MS);
    fireEvent.change(field, { target: { value: "12" } });
    const cookie = vi
      .spyOn(Document.prototype, "cookie", "get")
      .mockReturnValue("");

    fireEvent.click(resendButton() as HTMLElement);
    await advance(0);
    cookie.mockRestore();

    expect(screen.getByRole("alert").textContent).toContain(
      "not keeping cookies"
    );
    expect(field.value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(countdown()?.textContent).toContain("in 1:00.");
    // The button went with the restarted wait, so focus cannot stay on it,
    // and the message is about the browser, not the code under it.
    expect(document.activeElement).toBe(field);
    expect(document.getElementById("code-otp-error")).toBeNull();
  });

  it("counts down without announcing every second", async () => {
    await codeStep();

    const line = countdown() as HTMLElement;
    expect(line.closest("[aria-live], [role]")).toBeNull();
    // Nor read out with the field's description every time it takes focus.
    const described = (
      screen.getByLabelText("Code").getAttribute("aria-describedby") ?? ""
    )
      .split(" ")
      .map((id) => document.getElementById(id));
    expect(described.some((element) => element?.contains(line))).toBe(false);
  });
});

const BOUND_MS = RESEND_AFTER_SECONDS * 1000;
const seconds = fc.oneof(
  fc.constantFrom(0, 1, 9, 10, 59, 60, 61, 599, 600, 3599, 3600),
  fc.integer({ min: 0, max: 3600 })
);
const sentAt = fc.integer({ min: 1_500_000_000_000, max: 2_500_000_000_000 });
const elapsed = fc.oneof(
  fc.constantFrom(0, 1, 999, 1000, 1001, BOUND_MS - 1, BOUND_MS, BOUND_MS + 1),
  fc.integer({ min: 0, max: 10 * BOUND_MS })
);

describe("minutesAndSeconds", () => {
  test.prop([seconds])("is m:ss and round-trips to its input", (s) => {
    const shown = minutesAndSeconds(s);
    expect(shown).toMatch(/^\d+:[0-5]\d$/u);
    const [m, ss] = shown.split(":").map(Number);
    expect(m * 60 + ss).toBe(s);
  });
});

describe("resendWaitLeft", () => {
  test.prop([sentAt])("is the full wait at elapsed 0", (t) => {
    expect(resendWaitLeft(t, t)).toBe(RESEND_AFTER_SECONDS);
  });

  test.prop([sentAt, elapsed])(
    "is 0 at and after the bound, positive before it",
    (t, e) => {
      const left = resendWaitLeft(t, t + e);
      if (e >= BOUND_MS) {
        expect(left).toBe(0);
      } else {
        expect(left).toBeGreaterThan(0);
      }
    }
  );

  test.prop([sentAt, elapsed, elapsed])(
    "never rises as the clock moves on",
    (t, a, b) => {
      const [early, late] = a <= b ? [a, b] : [b, a];
      expect(resendWaitLeft(t, t + late)).toBeLessThanOrEqual(
        resendWaitLeft(t, t + early)
      );
    }
  );

  test.prop([sentAt, fc.integer({ min: 1, max: 24 * 3600 * 1000 })])(
    "never exceeds the wait for a clock that steps back",
    (t, back) => {
      expect(resendWaitLeft(t, t - back)).toBe(RESEND_AFTER_SECONDS);
    }
  );
});

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

/**
 * Sign in, or create an account, with a code mailed to the address (#576).
 *
 * Three steps rather than two, and the third is the interesting one.
 *
 * 1. **Address.** Asking for a code always answers the same way whether or not
 *    the address has an account, which is what stops the form being an account
 *    enumerator. Nothing on screen may contradict that, so the copy after this
 *    step never says "welcome back" or "we will create your account".
 * 2. **Code.** Checked with `checkVerificationOtp`, which does NOT spend it: a
 *    correct code leaves the verification record alone, and only a wrong one
 *    increments the attempt count. That is what makes step 3 possible.
 * 3. **Name, only when the address is new.** `signInEmailOTP` writes
 *    `name: name || ""` on a first sign-in, and `requireUserName` in
 *    `src/lib/auth.ts` throws BAD_REQUEST on a blank one. Sending a new address
 *    straight to sign-in would therefore fail AFTER consuming the code, leaving
 *    the person holding a code that no longer works and no account. The check
 *    call reports `USER_NOT_FOUND` for an address with no row, which is safe to
 *    act on precisely because it is only ever reached by somebody who already
 *    holds the code, and Better Auth's own comment on that branch says so.
 *
 * Both the sign-in and the sign-up page render this same component with the
 * same behaviour. Differing would reintroduce the enumeration by the back door:
 * two pages that answered one address differently would together say whether it
 * has an account.
 */

type Step = "address" | "code" | "name";

const CODE_LENGTH = 6;

export function EmailCodeForm({ redirectTo }: { redirectTo?: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("address");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const address = String(new FormData(e.currentTarget).get("email") ?? "");
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: "sign-in",
    });
    setLoading(false);
    if (sendError) {
      // The endpoint answers the same for a known and an unknown address, so
      // anything that reaches here is a real failure (a malformed address, a
      // rate limit) rather than "no such account".
      setError(sendError.message ?? "Could not send a code. Try again.");
      return;
    }
    setEmail(address);
    setStep("code");
  }

  async function checkCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const entered = String(new FormData(e.currentTarget).get("code") ?? "");
    const { error: checkError } =
      await authClient.emailOtp.checkVerificationOtp({
        email,
        otp: entered,
        type: "sign-in",
      });
    if (checkError) {
      setLoading(false);
      if (checkError.code === "USER_NOT_FOUND") {
        // The code is right and the address has no account, so this is a new
        // person. The code is still unspent; step 3 redeems it.
        setCode(entered);
        setStep("name");
        return;
      }
      setError(checkError.message ?? "That code did not work.");
      return;
    }
    await redeem(entered, undefined);
  }

  async function submitName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    await redeem(code, String(new FormData(e.currentTarget).get("name") ?? ""));
  }

  async function redeem(otp: string, name: string | undefined) {
    const { error: signInError } = await authClient.signIn.emailOtp({
      email,
      otp,
      ...(name === undefined ? {} : { name }),
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? "Sign-in failed");
      return;
    }
    navigate({ to: redirectTo ?? "/" });
  }

  if (step === "address") {
    return (
      <form className="mt-6 space-y-4" onSubmit={sendCode}>
        <div className="space-y-1.5">
          <Label htmlFor="code-email">Email</Label>
          <Input
            autoComplete="email"
            id="code-email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </div>
        <FieldError message={error} />
        <Button className="w-full" disabled={loading} type="submit">
          {loading ? "Sending..." : "Email me a code"}
        </Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form className="mt-6 space-y-4" onSubmit={checkCode}>
        <div className="space-y-1.5">
          <Label htmlFor="code-otp">Code</Label>
          <Input
            // `one-time-code` is what lets a phone offer the code from the
            // message rather than making the person retype it.
            autoComplete="one-time-code"
            id="code-otp"
            inputMode="numeric"
            maxLength={CODE_LENGTH}
            name="code"
            placeholder="123456"
            required
            type="text"
          />
          <p className="text-muted-foreground text-sm">
            We sent a code to {email}. It expires in five minutes.
          </p>
        </div>
        <FieldError message={error} />
        <Button className="w-full" disabled={loading} type="submit">
          {loading ? "Checking..." : "Confirm code"}
        </Button>
        <Button
          className="w-full"
          onClick={() => {
            setError(null);
            setStep("address");
          }}
          type="button"
          variant="outline"
        >
          Use a different address
        </Button>
      </form>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submitName}>
      <div className="space-y-1.5">
        <Label htmlFor="code-name">Your name</Label>
        <Input
          autoComplete="name"
          id="code-name"
          name="name"
          placeholder="Beaver Benny"
          required
          type="text"
        />
        <p className="text-muted-foreground text-sm">
          This is a new account. Your name is what staff and mentors see beside
          anything you propose.
        </p>
      </div>
      <FieldError message={error} />
      <Button className="w-full" disabled={loading} type="submit">
        {loading ? "Creating..." : "Create account"}
      </Button>
    </form>
  );
}

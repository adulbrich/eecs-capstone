import { Link, useNavigate } from "@tanstack/react-router";
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
 * It renders on one page, `/sign-in`, which is also where accounts are created
 * (#586). A second page would have had to answer every address exactly as this
 * one does, or the pair would together say whether an address has an account;
 * a page that must behave identically is the same page twice. The name step is
 * therefore the one moment a code creates an account, and it carries the
 * privacy notice for that reason.
 */

type Step = "address" | "code" | "name";

/**
 * Each step's form carries a `key`, and it is load-bearing rather than the
 * usual list-rendering habit.
 *
 * The three branches return the same shape in the same position, so React
 * reconciles them as one element and REUSES the `<input>` DOM node. These
 * inputs are uncontrolled, so the node keeps whatever was typed into it: the
 * code step arrived pre-filled with the address from the step before, under a
 * label reading "Code". A distinct key forces a remount and an empty field.
 * Nothing but looking at the rendered page showed it, because `fill()` in a
 * test overwrites the value either way.
 */

const CODE_LENGTH = 6;

/** Written and read back to find out whether this browser keeps cookies. */
const COOKIE_PROBE = "capstone_cookie_probe";

/** Trailing full stops on a message this form is about to extend. */
const TRAILING_STOPS = /\.+$/;

/**
 * Better Auth's refusal, plus the way out of it.
 *
 * Its messages are accurate and say nothing about what to do, and on this form
 * there is exactly one answer to all of them: ask for another code. That covers
 * a mistyped digit, a code that expired, a budget of guesses spent by somebody
 * else, and a browser that lost its claim, which reach here as three different
 * sentences and one action. The refusals are deliberately indistinguishable to
 * the server (see `otp-claim.ts`), so the copy cannot be more specific than
 * this without guessing.
 *
 * The trailing stop is stripped from the incoming message rather than repaired
 * afterwards. `.replace("..", ".")` on the joined string did the same job and
 * was wrong twice over: `String.replace` with a string pattern rewrites only
 * the first match, and CodeQL reads that shape as an incomplete sanitizer
 * whatever it is actually doing. Deciding once, on the one value that varies,
 * needs no repair.
 */
function withRecovery(message: string): string {
  return `${message.replace(TRAILING_STOPS, "")}. Ask for a new code and try again.`;
}

/** One named field out of a submitted form, as a string rather than a FormDataEntryValue. */
function formValue(e: React.FormEvent<HTMLFormElement>, field: string): string {
  return String(new FormData(e.currentTarget).get(field) ?? "");
}

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
    const address = formValue(e, "email");
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
    if (!browserKeepsCookies()) {
      // Stopping here rather than sending them to their inbox for a code
      // that cannot work. The server cannot say this: a browser that
      // dropped the claim and a stranger who never had one look identical
      // to it, and both have to get the same answer.
      setError(
        "Your browser is not keeping cookies for this site, and signing in with a code needs one. Allow cookies for this site and try again, or sign in with ONID."
      );
      return;
    }
    setEmail(address);
    setStep("code");
  }

  /**
   * Whether this browser keeps cookies for this site at all.
   *
   * A self-test rather than a look for a cookie the server sent, and the
   * difference matters. The claim is `HttpOnly`, so it is invisible here, and a
   * readable companion cannot stand in for it: the send answers `{success:
   * true}` without setting anything whenever it declines to act, so its absence
   * would also be reported for somebody whose per-recipient budget a stranger
   * had already spent. That is the wrong cause and the wrong advice.
   *
   * Writing one and reading it back asks the only question worth asking, and
   * asks it of the browser rather than of the server. Fails OPEN on a document
   * that will not answer, because refusing a browser this cannot measure would
   * be worse than the refusal it exists to prevent.
   */
  function browserKeepsCookies(): boolean {
    try {
      // The rule wants the CookieStore API, which is the right default for
      // reading and writing real cookies. This writes one only to see whether
      // it comes back, and CookieStore is asynchronous and unavailable in
      // Safari, so it cannot answer this question here.
      // biome-ignore lint/suspicious/noDocumentCookie: see above
      document.cookie = `${COOKIE_PROBE}=1; path=/; max-age=60; samesite=lax`;
      const kept = document.cookie.includes(`${COOKIE_PROBE}=`);
      // biome-ignore lint/suspicious/noDocumentCookie: see above
      document.cookie = `${COOKIE_PROBE}=; path=/; max-age=0; samesite=lax`;
      return kept;
    } catch {
      return true;
    }
  }

  async function checkCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const entered = formValue(e, "code");
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
      setError(withRecovery(checkError.message ?? "That code did not work."));
      return;
    }
    await redeem(entered, undefined);
  }

  async function submitName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    await redeem(code, formValue(e, "name"));
  }

  async function redeem(otp: string, name: string | undefined) {
    const { error: signInError } = await authClient.signIn.emailOtp({
      email,
      otp,
      ...(name === undefined ? {} : { name }),
    });
    setLoading(false);
    if (signInError) {
      setError(withRecovery(signInError.message ?? "Sign-in failed."));
      return;
    }
    navigate({ to: redirectTo ?? "/" });
  }

  if (step === "address") {
    return (
      <form className="mt-6 space-y-4" key="address" onSubmit={sendCode}>
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
      <form className="mt-6 space-y-4" key="code" onSubmit={checkCode}>
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
    <form className="mt-6 space-y-4" key="name" onSubmit={submitName}>
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
          {/* Staff only: a mentor sees the public project page, which carries
              no proposer name (CONTEXT.md, Mentor), and no other user sees
              it either. */}
          This is a new account. Staff see this name beside the projects you
          propose and the items you borrow.
        </p>
      </div>
      {/* Ahead of the button, so it is read before the action it describes.
          A notice, not a checkbox: nothing is recorded (PRD section 2). A new
          tab, because leaving this one unmounts the form and loses the checked
          code; asking for another spends the address's mail budget
          (ADR-0046). */}
      <p className="text-muted-foreground text-sm">
        By creating an account, you agree to the{" "}
        <Link
          className="text-brand-dark underline"
          rel="noopener noreferrer"
          target="_blank"
          to="/privacy"
        >
          privacy policy
        </Link>
        .
      </p>
      <FieldError message={error} />
      <Button className="w-full" disabled={loading} type="submit">
        {loading ? "Creating..." : "Create account"}
      </Button>
    </form>
  );
}

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { FieldError, SavedNote } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "#/components/ui/input-otp";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { useAction } from "#/lib/use-action";

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
 * The code step also offers a new code for the same address once
 * `RESEND_AFTER_SECONDS` have passed since the last send (#893), for a code
 * that never arrives: the send failed, a stranger rotated it first, or the
 * inbox is slow. Before that it only counts down.
 *
 * It renders on one page, `/sign-in`, which is also where accounts are created
 * (#586). A second page would have had to answer every address exactly as this
 * one does, or the pair would together say whether an address has an account;
 * a page that must behave identically is the same page twice. The name step is
 * therefore the one moment a code creates an account, and it carries the
 * privacy notice for that reason.
 */

export type Step = "address" | "code" | "name";

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

/** One slot per digit, as indexes for `InputOTPSlot`. */
const SLOTS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

const NON_DIGITS = /\D/gu;

/** What the code input's `aria-describedby` names, and the elements it names. */
const CODE_HINT_ID = "code-otp-hint";
const CODE_ERROR_ID = "code-otp-error";
const CODE_EXPIRY_ID = "code-otp-expiry";

/**
 * A pasted `482 193` or `482-193`, as `482193`.
 *
 * Without this the digits-only pattern rejects the whole paste and enters
 * nothing, and before #600 a plain `maxLength` input kept `482 19` and spent a
 * guess on it.
 */
function digitsOnly(pasted: string): string {
  return pasted.replace(NON_DIGITS, "");
}

/**
 * How long the code step waits after a send before it offers another.
 *
 * `resendStrategy` is `rotate` (the `emailOTP` options in `src/lib/auth.ts`),
 * so a new code kills the one before it. A code that was only slow then
 * arrives dead, and the person types a code that cannot work. The wait has to
 * outlast a normal delivery, campus mail filtering included, which can take
 * tens of seconds: under 30 kills slow codes, and over about 90 leaves
 * somebody whose send failed waiting with no reason given.
 *
 * It costs little. The per-recipient cap is 5 sends an hour
 * (`SIGN_IN_CODE_LIMIT`, ADR-0046), so a minute between sends spends nobody a
 * send they could have used, and a code lives five minutes, so one minute
 * leaves four for the new one. A convenience, not a control: the server
 * bounds sends on its own, and a reload skips it by landing on the address
 * step.
 */
export const RESEND_AFTER_SECONDS = 60;

/**
 * Whole seconds until a new code may be asked for, given when the last send
 * succeeded and the latest tick, both in epoch milliseconds.
 *
 * Capped at the full wait, so the countdown never reads more than `1:00`
 * whatever the two clocks say. A wall clock that steps backward (an NTP
 * correction, a hand-set clock) is handled by the tick, which pulls `sentAt`
 * back to it; the cap alone would hold the button back until the clock
 * caught up.
 */
export function resendWaitLeft(sentAt: number, lastTick: number): number {
  return Math.min(
    RESEND_AFTER_SECONDS,
    Math.max(
      0,
      Math.ceil((sentAt + RESEND_AFTER_SECONDS * 1000 - lastTick) / 1000)
    )
  );
}

/** `0:45` for 45 seconds, `1:00` for 60. */
export function minutesAndSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** When a send was refused with no message of its own. */
const SEND_FAILED = "Could not send a code. Try again.";

/**
 * What asking for a code came to. A refusal with nothing sent stops the form
 * where it is; one after a send (the cookie check) still restarted the wait.
 */
type CodeRequest =
  | { sent: false; refusal: string }
  | { sent: true; refusal: string | null };

/** Written and read back to find out whether this browser keeps cookies. */
const COOKIE_PROBE = "capstone_cookie_probe";

/** Trailing full stops on a message this form is about to extend. */
const TRAILING_STOPS = /\.+$/u;

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

/** The part of an auth client answer this form reads. */
interface AuthAnswer {
  error: { code?: string; message?: string } | null;
}

/** What `reach` answers with when the call threw rather than answering. */
const UNREACHABLE = {
  message: "Could not reach the server. Check your connection and try again.",
};

/**
 * An auth client call, answered as a refusal when it throws.
 *
 * The client returns a refusal as `{ error }`, but `fetch` rejects on a
 * network failure and better-fetch passes that rejection through. Thrown, it
 * would skip `setLoading(false)` and leave the step locked for good, because
 * the code step disables its field and its way back while a request is in
 * flight. The catch also takes the rarer throw after a real answer, such as a
 * body that will not parse; the message is then about the connection when it
 * was not, and a retry either works or meets the usual refusal.
 */
async function reach(call: Promise<AuthAnswer>): Promise<AuthAnswer> {
  try {
    return await call;
  } catch {
    return { error: UNREACHABLE };
  }
}

/** One named field out of a submitted form, as a string rather than a FormDataEntryValue. */
function formValue(e: React.FormEvent<HTMLFormElement>, field: string): string {
  return String(new FormData(e.currentTarget).get(field) ?? "");
}

export function EmailCodeForm({
  redirectTo,
  onStepChange,
}: {
  redirectTo?: string;
  /**
   * Called on every move between steps, so the page can hide the other
   * sign-in methods once a code is out (#611). The form starts on `address`
   * and does not call this for it.
   */
  onStepChange?: (step: Step) => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [step, setStep] = useState<Step>("address");
  // In the handler rather than an effect on `step`, so the page hides its
  // buttons in the same render the form changes step, not one render later.
  function goToStep(next: Step) {
    setStep(next);
    onStepChange?.(next);
  }
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Controlled, unlike the other two fields, so a refusal can empty it.
  const [draft, setDraft] = useState("");
  const codeField = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "We asked for a new code", after a resend, through `SavedNote`: a result
  // the reader asked for, announced politely rather than as an alert.
  const [notice, setNotice] = useState<string | null>(null);
  // Its refusals, the cookie check's included, render under its button
  // through `resend.error`, not in `error`, which would mark the code field
  // invalid when nothing is wrong with the code.
  const resend = useAction({ fallback: SEND_FAILED });
  // Either request locks the step: an answer about this address must not land
  // on the next one's, and a new code must not wipe a draft typed meanwhile.
  const busy = loading || resend.busy;

  // When this browser's last send succeeded, and the clock as of the last tick
  // of the wait. Remaining time comes from the two, not from counting ticks,
  // because a phone that switches to its mail app suspends the timer.
  const [sentAt, setSentAt] = useState(0);
  const [lastTick, setLastTick] = useState(0);
  const waitLeft = resendWaitLeft(sentAt, lastTick);
  const waiting = waitLeft > 0;
  function startWait() {
    const sent = Date.now();
    setSentAt(sent);
    setLastTick(sent);
  }
  useEffect(() => {
    if (step !== "code" || !waiting) {
      return;
    }
    const timer = setInterval(() => {
      const tick = Date.now();
      setLastTick(tick);
      // A clock that stepped backward restarts the wait from now, so it
      // costs at most one more wait rather than the size of the step.
      setSentAt((sent) => Math.min(sent, tick));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, waiting]);

  // Focus after the render that re-enables the field, not inside `refuse`:
  // the field is disabled while its check is in flight, and a disabled input
  // takes no focus. On any other step the ref is empty and this does nothing.
  // A notice moves it too: the resend button that had it is gone.
  useEffect(() => {
    if (error !== null || notice !== null) {
      codeField.current?.focus();
    }
  }, [error, notice]);
  // A resend refused after it went out (the cookie check) restarted the wait,
  // so the button that had focus is gone too. A refusal before a send leaves
  // the wait over and the button, and focus, where they were.
  const refusedAfterSend = resend.error !== null && waiting;
  useEffect(() => {
    if (refusedAfterSend) {
      codeField.current?.focus();
    }
  }, [refusedAfterSend]);

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const address = formValue(e, "email");
    const { refusal } = await requestCode(address);
    setLoading(false);
    if (refusal) {
      setError(refusal);
      return;
    }
    setEmail(address);
    setDraft("");
    setNotice(null);
    resend.setError(null);
    goToStep("code");
  }

  /**
   * A new code to the address already on the code step (#893).
   *
   * A refusal (a rate limit) leaves the wait where it was and keeps the
   * draft: the server refuses before it replaces the code, so the old one
   * still works. A send that never answered may have replaced it, and this
   * cannot tell; Confirm then says so and the button is still there. A send
   * that went out empties the draft and restarts the wait even when the
   * cookie check then fails, because the earlier code is dead.
   */
  function resendCode() {
    // `run` holds the ref guard, so a second click in the same tick returns
    // before it reaches the server.
    return resend.run(async () => {
      setError(null);
      setNotice(null);
      const request = await requestCode(email);
      if (request.sent) {
        setDraft("");
      }
      if (request.refusal) {
        throw new Error(request.refusal);
      }
      // Hedged, because a send past the hourly cap (ADR-0046) answers
      // success without sending or replacing anything, so that the answer
      // never says what state an address is in. "We sent a new code" would be
      // false then, and the earlier code would still be the one that works.
      setNotice(
        `We asked for a new code for ${email}. Use the newest code that arrives: each one replaces the one before.`
      );
    });
  }

  /**
   * Asks for a code: whether one went out, and why not if this form should
   * stop. Restarts the wait for a send that went out, whatever the cookie
   * check then says.
   */
  async function requestCode(address: string): Promise<CodeRequest> {
    const { error: sendError } = await reach(
      authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      })
    );
    if (sendError) {
      // The endpoint answers the same for a known and an unknown address, so
      // anything that reaches here is a real failure (a malformed address, a
      // rate limit) rather than "no such account".
      return {
        sent: false,
        refusal: sendError.message || SEND_FAILED,
      };
    }
    startWait();
    if (!browserKeepsCookies()) {
      // Stopping here rather than sending them to their inbox for a code
      // that cannot work. The server cannot say this: a browser that
      // dropped the claim and a stranger who never had one look identical
      // to it, and both have to get the same answer.
      return {
        sent: true,
        refusal:
          "Your browser is not keeping cookies for this site, and signing in with a code needs one. Allow cookies for this site and try again, or sign in with ONID.",
      };
    }
    return { sent: true, refusal: null };
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
    setNotice(null);
    resend.setError(null);
    setLoading(true);
    const entered = draft;
    const { error: checkError } = await reach(
      authClient.emailOtp.checkVerificationOtp({
        email,
        otp: entered,
        type: "sign-in",
      })
    );
    if (checkError) {
      setLoading(false);
      if (checkError.code === "USER_NOT_FOUND") {
        // The code is right and the address has no account, so this is a new
        // person. The code is still unspent; step 3 redeems it.
        setCode(entered);
        goToStep("name");
        return;
      }
      refuse(checkError, "That code did not work.");
      return;
    }
    await redeem(entered, undefined);
  }

  /**
   * Says why, empties the code field and puts the cursor back in it.
   *
   * Emptied rather than kept for a one-digit fix (#600). With all six slots
   * full, input-otp pastes at the caret, which sits on the last slot: pasting
   * the right code over a wrong `000000` gave `000004`, and phone autofill
   * lands in the same place. An empty field takes either whole.
   *
   * Nothing typed is lost by it: the field is disabled from the submit until
   * the answer arrives, so the draft this empties is the one that was sent.
   *
   * Emptied when no answer arrived, too. Kept, the six digits put the caret
   * on the last slot once the field is focused again, and pasting the same
   * code back gave `123451`, which then spent a guess. The advice differs: the
   * request may never have reached the server and the code may still be good,
   * so "ask for a new code" is not the first thing to say.
   */
  function refuse(
    refusal: { code?: string; message?: string },
    fallback: string
  ) {
    setError(
      // By identity, not by a code string the server could one day send too.
      refusal === UNREACHABLE
        ? UNREACHABLE.message
        : // `||`, not `??`: an empty message would read ". Ask for a new code".
          withRecovery(refusal.message || fallback)
    );
    setDraft("");
  }

  async function submitName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    await redeem(code, formValue(e, "name"));
  }

  async function redeem(otp: string, name: string | undefined) {
    const { error: signInError } = await reach(
      authClient.signIn.emailOtp({
        email,
        otp,
        ...(name === undefined ? {} : { name }),
      })
    );
    setLoading(false);
    if (signInError) {
      refuse(signInError, "Sign-in failed.");
      return;
    }
    // Every cached match was loaded signed out, and `getProject` answers per
    // viewer. The project pages keep a preload for five minutes (#762), and
    // this sign-in navigates on the client, so without this staff could land
    // on a page without their panel. It prunes only cached and preloaded
    // matches, never this page's own.
    router.clearCache();
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
    const invalid = error !== null;
    const describedBy = invalid
      ? `${CODE_HINT_ID} ${CODE_ERROR_ID} ${CODE_EXPIRY_ID}`
      : `${CODE_HINT_ID} ${CODE_EXPIRY_ID}`;
    // Centered, with the address above the slots (#600): the address is what
    // to check when no code arrives, so it sits where the eye lands, and the
    // error sits under the slots it is about. The sentence is the visible
    // instruction; "Code" stays as the field's name for a screen reader.
    return (
      <form className="mt-6 space-y-4" key="code" onSubmit={checkCode}>
        <div className="space-y-3 text-center">
          <p className="text-muted-foreground text-sm" id={CODE_HINT_ID}>
            Enter the code we sent to
            <span className="text-foreground block font-medium wrap-anywhere">
              {email}
            </span>
          </p>
          <Label className="sr-only" htmlFor="code-otp">
            Code
          </Label>
          {/* No `onComplete` submit: that would spend a guess on a typo
              nobody saw, and changes context on input (WCAG 3.2.2). */}
          <InputOTP
            aria-describedby={describedBy}
            aria-invalid={invalid}
            // `one-time-code` is what lets a phone offer the code from the
            // message rather than making the person retype it.
            autoComplete="one-time-code"
            containerClassName="justify-center"
            disabled={busy}
            id="code-otp"
            inputMode="numeric"
            maxLength={CODE_LENGTH}
            name="code"
            onChange={setDraft}
            pasteTransformer={digitsOnly}
            pattern={REGEXP_ONLY_DIGITS}
            ref={codeField}
            required
            value={draft}
          >
            <InputOTPGroup>
              {SLOTS.map((index) => (
                <InputOTPSlot
                  aria-invalid={invalid}
                  className="h-10 w-10 text-base"
                  index={index}
                  key={index}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <FieldError id={CODE_ERROR_ID} message={error} />
          <SavedNote message={notice} />
          <p className="text-muted-foreground text-sm" id={CODE_EXPIRY_ID}>
            It expires in five minutes.
          </p>
          {/* No `aria-live` and outside `aria-describedby`: a screen reader
              would read it out every second. The button below appearing is
              the news, and this line already said when it comes. */}
          <p className="text-muted-foreground text-sm">
            {waiting
              ? `Didn't get it? Check your spam folder. You can ask for a new code in ${minutesAndSeconds(waitLeft)}.`
              : "Didn't get it? Check your spam folder, or ask for a new code."}
          </p>
        </div>
        <Button className="w-full" disabled={busy} type="submit">
          {loading ? "Checking..." : "Confirm code"}
        </Button>
        {/* Hidden rather than disabled through the wait: a disabled button
            whose label ticked every second would be noise for a screen
            reader, and the line above says when it comes. */}
        {!waiting && (
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void resendCode()}
            type="button"
            variant="outline"
          >
            {resend.busy ? "Sending..." : "Send a new code"}
          </Button>
        )}
        <FieldError message={resend.error} />
        {/* Disabled mid-check as well, so an answer about this address cannot
            land on the next one's step. */}
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => {
            setError(null);
            setNotice(null);
            resend.setError(null);
            goToStep("address");
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
      {/* Only after a refusal (#611). The code was checked but not spent, so
          it can expire or lose its guesses before this redeem, and the
          refusal says to ask for a new code; with the other sign-in methods
          hidden past the address step, this is the control that does. It
          shows after a redeem that never answered too, where retrying is
          the better advice but leaving is not wrong. No `disabled`: a submit
          clears the error, so this is gone before the request goes out. */}
      {error !== null && (
        <Button
          className="w-full"
          onClick={() => {
            setError(null);
            goToStep("address");
          }}
          type="button"
          variant="outline"
        >
          Use a different address
        </Button>
      )}
    </form>
  );
}

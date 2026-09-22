/**
 * Console-email capture shared by the auth integration suite and the
 * claim-projects one. Both drive Better Auth through the console transport and
 * need the link out of what it printed, so these live here rather than being
 * copied per suite.
 */

/** The link arrives inside the rendered body as "<call to action>: <url>". */
const CONSOLE_EMAIL_URL = /^\s*\S[^\n]*?: (https?:\/\/\S+)$/m;

/** Runs `fn` and returns everything it wrote to stderr. */
export async function captureStderr(
  fn: () => Promise<unknown>
): Promise<string> {
  let captured = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
}

/** The sign-in code arrives inside the sentence, not as a link. */
const CONSOLE_EMAIL_CODE = /Your sign-in code is (\d{6})\./;

/**
 * Runs `fn` and pulls the sign-in code out of what the console transport
 * printed (#576).
 *
 * Separate from `captureConsoleEmail` because this message deliberately carries
 * no link: a link in it would be a magic link, which is the thing ADR-0047
 * chose not to build. So the link regex above finds nothing here and the
 * failure would read as "the mail did not send".
 */
export async function captureConsoleCode(
  fn: () => Promise<unknown>
): Promise<string> {
  const captured = await captureStderr(fn);
  const match = captured.match(CONSOLE_EMAIL_CODE);
  if (!match) {
    throw new Error(`No sign-in code in what was printed. Got:\n${captured}`);
  }
  return match[1];
}

/**
 * Runs `fn` and pulls the link out of whatever the console transport printed.
 *
 * Matches on the rendered subject rather than a bracketed label: content moved
 * into `src/lib/email/templates.ts`, so the transport now prints the real
 * subject and body instead of a per-message tag and a `url:` field.
 */
export async function captureConsoleEmail(
  subject: string,
  fn: () => Promise<unknown>
): Promise<string> {
  const captured = await captureStderr(fn);
  if (!captured.includes(`subject: ${subject}`)) {
    throw new Error(
      `No console email with subject "${subject}". Got:\n${captured}`
    );
  }
  const match = captured.match(CONSOLE_EMAIL_URL);
  if (!match) {
    throw new Error(
      `Console email "${subject}" carried no link. Got:\n${captured}`
    );
  }
  return match[1];
}

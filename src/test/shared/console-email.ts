/**
 * Console-email capture for the integration suite, which drives Better Auth
 * through the console transport and needs the sign-in code out of what it
 * printed.
 */

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
 * printed (#576). The message deliberately carries no link: a link in it would
 * be a magic link, which is the thing ADR-0047 chose not to build.
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

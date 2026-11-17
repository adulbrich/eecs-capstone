/**
 * Turns a thrown value into something safe to write to a log group.
 *
 * Drizzle's `DrizzleQueryError` carries the bound parameters of the failed
 * query, and the parameters of a Better Auth session lookup are the session
 * token: a live credential that signs its bearer in until it expires. A burst that
 * exhausts the connection pool makes the session lookup time out on acquire,
 * which is how a query error reaches a logger at all. Addresses travel the same
 * path.
 *
 * The trap, and the reason this returns a string rather than a tidied error:
 * `DrizzleQueryError`'s constructor interpolates the parameters into
 * `error.message` as well as storing them on `error.params`. So the habit
 * `db-pool.ts` established for pool errors, logging `error.message` and
 * nothing else, is not enough here and would have looked like a fix. All three
 * of `error.message`, `String(error)` and `util.inspect(error)` carry the
 * secret, which is measured in `redact-query-error.test.ts` rather than
 * asserted. A string with no error object behind it is the only shape a
 * console method cannot walk back into.
 *
 * What survives: the failing query's SQL, which is schema rather than user
 * data and is in this repository already, and the cause chain's messages,
 * which is where "Connection terminated due to connection timeout" lives and
 * is the whole diagnostic value of the line. Less any email address in them,
 * since an error message can name one outside a query too
 * (`redactAddresses`).
 */

/** How much of the failing SQL to keep. Enough to identify the query. */
const QUERY_LIMIT = 200;

/** How far down a `cause` chain to walk before giving up on a cycle. */
const MAX_CAUSE_DEPTH = 5;

interface QueryErrorShape {
  params: unknown;
  query: string;
}

/**
 * Structural rather than `instanceof DrizzleQueryError`. A bundle can hold two
 * copies of drizzle, a driver can wrap the error, and either defeats the
 * prototype check while leaving the hazard in place. The shape is the hazard.
 */
function isQueryError(value: unknown): value is QueryErrorShape {
  return (
    value instanceof Error &&
    typeof (value as Partial<QueryErrorShape>).query === "string" &&
    "params" in value
  );
}

/**
 * The two shapes a parameter tail arrives in, as one pattern.
 *
 * The first is `DrizzleQueryError`'s own message template, which writes
 * exactly `\nparams:`. Any single whitespace character matches in place of
 * that newline (#608): a space, an indent, a tab and U+2028 all left the
 * parameters whole under the old literal, and a wrapper that reflows or
 * indents the message would produce them. The cost is that prose containing
 * " params:" after a space is truncated there too; a string that starts with
 * "params:" is not, since nothing precedes it. An escaped `\n`, `\r` or `\t`
 * counts as whitespace too, which is the same message after a wrapper put it
 * through `JSON.stringify`. The second is what
 * `JSON.stringify` of that error produces, because it sets `query` and
 * `params` as own enumerable properties, so a serialized copy carries the
 * parameters with no newline in front of them. Nothing here serializes a
 * caught value today, and `handleAuthRequest` answers with an empty body, so
 * the second marker covers a shape this codebase does not currently produce.
 * It is here because a structured logger is the obvious next change to a
 * service that writes to a log group, and that change would otherwise reopen
 * this silently.
 */
const PARAM_MARKER = /(?:\s|\\[nrt])params:|"params":/u;

/**
 * Strips the parameter tail off a message that already carries one.
 *
 * `DrizzleQueryError` builds its message as ``Failed query: ${query}\nparams:
 * ${params}``, and that string travels on its own: Better Auth logs
 * `error.message` rather than the error in one branch, and any `catch` that
 * reaches for `.message` produces the same thing. So a string arriving here is
 * not automatically safe just because it is a string, which is the mistake the
 * first version of this file made.
 */
function scrubQueryText(text: string): string {
  // Keyed on the separator alone rather than also requiring the string to
  // start with "Failed query:". Anything that wraps the message in a prefix,
  // `new Error(`Adapter: ${error.message}`)`, would otherwise pass through
  // whole. Nothing in this codebase or in Better Auth does that today, but the
  // cost of covering it is one dropped condition, and the failure mode of the
  // looser test is a truncated log line rather than a leaked one.
  // `search` returns the earliest match of either alternative, which is the
  // one to cut at: everything after it is a parameter tail.
  const marker = text.search(PARAM_MARKER);
  if (marker === -1) {
    return text;
  }
  // `trimEnd` because the match is the one character before `params:`, so an
  // indent or a `\r\n` would leave the rest of its run behind, and a raw
  // newline starts a new awslogs event for the callers that do not collapse.
  return `${text.slice(0, marker).trimEnd()} [params redacted]`;
}

/**
 * An email address anywhere in a message, which #559 keeps out of the log
 * group whoever wrote the message.
 *
 * Not only a query's parameters carry one. SES puts the recipient in its own
 * error text (a sandboxed account's `MessageRejected` ends "The following
 * identities failed the check in region US-WEST-2: <address>"), and every
 * email notifier logs that error after its line (#892), where on the sign-in
 * path the address is whatever a stranger typed.
 *
 * The local part takes exactly the characters `z.email()` admits, and every
 * address the app sends to has passed it (the sign-in form, a mentor, an
 * inventory holder), so no prefix of one survives. Not the wider RFC 5322
 * set: with `/`, `=` and `?` in it, `https://site.edu/x?r=a@b.co` lost its
 * host and path to the match, which let a stranger blank the target out of a
 * logged callbackURL. The domain
 * needs a dot between its labels and ends, as `z.email()` requires, in a
 * label of two or more letters. That keeps a package intact, as a scoped path
 * (`node_modules/@aws-sdk/client-sesv2`, whose label meets a `/` first) and
 * with a numeric version (`@aws-sdk/client-sesv2@3.700.0`, `react@18.x`). A
 * version that ends in a word, `1.0.0-alpha.beta`, reads as a domain and is
 * redacted, as is a dotted word straight after an address: without a list of
 * top-level domains there is no telling them apart, and more redaction is the
 * safe way to be wrong.
 *
 * Scans rather than one regex, because this runs on text a stranger chooses
 * (Better Auth logs a rejected callbackURL word for word) and both regex
 * shapes failed. Unanchored, a long run of local-part characters with no `@`
 * was rescanned from every position: 40,000 characters held the event loop
 * for a second. Anchored with a lookbehind, a match could not start where the
 * previous one ended, so the second of `a@x.edu+b@y.edu` survived.
 */
const LOCAL_CHAR = /[A-Za-z0-9_'+.-]/u;
const DOMAIN = /(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/uy;
const ADDRESS_MARK = "[address redacted]";

/**
 * What ends a URL's authority: the WHATWG parser's own `/`, `?`, `#` and `\`,
 * and also whitespace, a quote and angle brackets, which the parser would
 * delete (a tab or a newline) or percent-encode inside userinfo instead. Ending there keeps prose and JSON
 * around a URL from being read as its userinfo (`fetch https://api.x.edu
 * failed for bob@x.edu` would otherwise lose the URL), at the cost that a URL
 * with one of them inside its userinfo can still have its host taken with an
 * address. Not RFC 3986's narrower set: the parser percent-encodes `{`, `|`
 * and `^` and still reads the host after them.
 */
const AUTHORITY_END = /[\s/?#\\"<>]/gu;

/**
 * A URL's userinfo, everything between `//` and the authority's last `@`,
 * becomes the mark and the host stays. The host is where the URL points, and a
 * stranger's reason to put an address in a callbackURL is to hide it:
 * `https://a@b.co@evil.com`, `https://@x@evil.com` and `https://a{b@evil.com`
 * all point at evil.com. A pass of its own, before the address scan, because
 * guessing from inside that scan which `@` was the last missed one shape per
 * review round. Linear: each authority is read once and they do not overlap.
 */
function redactUserinfo(text: string): string {
  let out = "";
  let kept = 0;
  for (
    let slashes = text.indexOf("//");
    slashes !== -1;
    slashes = text.indexOf("//", kept)
  ) {
    const from = slashes + 2;
    AUTHORITY_END.lastIndex = from;
    const end = AUTHORITY_END.exec(text)?.index ?? text.length;
    // Searched inside the authority only: `indexOf` from here could run to
    // the end of the text for every `//` in it.
    const inside = text.slice(from, end).lastIndexOf("@");
    const lastAt = inside === -1 ? -1 : from + inside;
    // `//@host` has no userinfo to take.
    if (lastAt > from) {
      out += `${text.slice(kept, from)}${ADDRESS_MARK}`;
      kept = lastAt;
    } else {
      out += text.slice(kept, from);
      kept = from;
    }
  }
  return out + text.slice(kept);
}

/**
 * Each `@` walks left only as far as the previous `@` or the end of the
 * previous match, and right only to the end of its domain, so every character
 * is visited a bounded number of times.
 */
function redactBareAddresses(text: string): string {
  let out = "";
  let kept = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (at < kept) {
      continue;
    }
    let start = at;
    while (start > kept && LOCAL_CHAR.test(text.charAt(start - 1))) {
      start -= 1;
    }
    // An empty local part is an address only where the previous match took
    // its local part: `a@x.edu.b@y.edu` reads the first domain as `x.edu.b`.
    const glued = start === at && at === kept && out !== "";
    if (start === at && !glued) {
      continue;
    }
    DOMAIN.lastIndex = at + 1;
    const domain = DOMAIN.exec(text);
    if (!domain) {
      continue;
    }
    out += `${text.slice(kept, start)}${glued ? "" : ADDRESS_MARK}`;
    kept = DOMAIN.lastIndex;
  }
  return out + text.slice(kept);
}

function redactAddresses(text: string): string {
  return redactBareAddresses(redactUserinfo(text));
}

function truncate(sql: string): string {
  const collapsed = sql.replace(/\s+/gu, " ").trim();
  return collapsed.length > QUERY_LIMIT
    ? `${collapsed.slice(0, QUERY_LIMIT)}...`
    : collapsed;
}

/**
 * One error's own description, with the parameters taken out. Not recursive:
 * `redactQueryError` walks the chain, so that a wrapped query error deeper
 * down is redacted too rather than only the outermost one.
 */
function describe(value: unknown): string {
  if (isQueryError(value)) {
    // Rebuilt rather than edited. `error.message` already has the parameters
    // interpolated into it, so anything derived from it starts out unsafe.
    return `query failed [params redacted]: ${truncate(value.query)}`;
  }
  if (value instanceof Error) {
    // `String` because a thrown Error's `message` is whatever was assigned to
    // it, and a number here threw inside the caller's own `catch`.
    return `${value.name}: ${redactAddresses(scrubQueryText(String(value.message)))}`;
  }
  if (typeof value === "string") {
    return redactAddresses(scrubQueryText(value));
  }
  return Object.prototype.toString.call(value);
}

/**
 * A single log-safe line for a thrown value, including the messages of
 * whatever it was caused by. Pass the result to the logger, never the error.
 */
export function redactQueryError(value: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === undefined || current === null || seen.has(current)) {
      break;
    }
    seen.add(current);
    parts.push(describe(current));
    current =
      current instanceof Error
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return parts.join(" <- ");
}

/**
 * The `log` half of Better Auth's `logger` option, which is one of the two
 * ways a query error reaches a console method from the auth stack.
 *
 * The message is redacted as well as the arguments, because Better Auth's own
 * endpoints call `ctx.logger.error(...)` directly and are free to put anything
 * in that slot, including a message they took off an error. The message of a
 * query error is the one with the parameters interpolated into it, so the
 * message slot is untrusted here on the same footing as the arguments.
 *
 * Better Auth's router has a second branch that would put a whole query
 * message there, when the text contains "column", "relation", "table" or
 * "does not exist" (`better-auth/dist/api/index.mjs`), and it matches inside a
 * word, so an address like `alice.consTABLEe@` reaches it. On this
 * configuration `onAPIError: { throw: true }` makes that branch unreachable.
 * It is recorded because it is what the substring test costs if the throw is
 * ever removed, not as the reason this redaction exists.
 *
 * Do not add `level` to the `logger` option beside this. Better Auth reads
 * `options.logger.level` to decide whether to also hand the message to its own
 * global logger, which is not this one, and setting it routes a copy around
 * the redaction. Leaving it unset keeps every line going through here.
 */
export function redactingAuthLogger(
  write: (message: string) => void = console.error
) {
  return (level: string, message: string, ...args: unknown[]): void => {
    const extra = args.map((arg) => redactQueryError(arg));
    const safeMessage = redactQueryError(message);
    const line = `[Better Auth] ${level}: ${safeMessage}${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`;
    // One line, and only after redaction, which finds parameters by the
    // whitespace in front of them. awslogs makes each line its own event, and
    // Better Auth logs a rejected callbackURL word for word, so a newline in
    // one would start an event a stranger wrote, which the `ai_write_failures`
    // metric filter in `infra/alarms.tf` would count.
    write(line.replace(/[\r\n]+/gu, " "));
  };
}

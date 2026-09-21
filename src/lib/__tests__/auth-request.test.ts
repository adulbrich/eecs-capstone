import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { handleAuthRequest } from "../_internal/auth-request";

const SECRET = "qwWFNB6KRoIbxasS3zDrfREsB7dGx4Hw";

function sessionLookupFailure(): DrizzleQueryError {
  return new DrizzleQueryError(
    'select "id", "token" from "session" where "session"."token" = $1',
    [SECRET],
    new Error("Connection terminated due to connection timeout")
  );
}

const REQUEST = new Request("https://example.test/api/auth/get-session");

describe("handleAuthRequest", () => {
  it("passes a successful response straight through", async () => {
    const ok = new Response("fine", { status: 200 });
    const response = await handleAuthRequest(REQUEST, () =>
      Promise.resolve(ok)
    );
    expect(response).toBe(ok);
  });

  it("keeps the session token out of the log when the lookup fails", async () => {
    // The shape that matters: the pool times out acquiring a connection for a
    // session lookup, and that query's parameter is the token itself.
    const logged: string[] = [];
    await handleAuthRequest(
      REQUEST,
      () => Promise.reject(sessionLookupFailure()),
      (line) => logged.push(line)
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(SECRET);
    expect(logged[0]).toContain(
      "Connection terminated due to connection timeout"
    );
  });

  it("answers the same 500 the router would have", async () => {
    const response = await handleAuthRequest(
      REQUEST,
      () => Promise.reject(sessionLookupFailure()),
      () => {
        // silenced
      }
    );
    expect(response.status).toBe(500);
  });

  it("does not rethrow, which would be an uncaught rejection in the route", async () => {
    await expect(
      handleAuthRequest(
        REQUEST,
        () => Promise.reject(new Error("boom")),
        () => {
          // silenced
        }
      )
    ).resolves.toBeInstanceOf(Response);
  });
});

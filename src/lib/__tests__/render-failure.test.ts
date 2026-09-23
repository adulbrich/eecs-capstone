import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { renderFailureLines } from "../_internal/render-failure";

/** Stands in for a bound parameter: a search term, a token, an address. */
const SECRET = "robotics-3f9a1c";

function failedSearch(): DrizzleQueryError {
  return new DrizzleQueryError(
    'select "id" from "projects" where "title" ilike $1',
    [SECRET],
    new Error("Connection terminated due to connection timeout")
  );
}

describe("renderFailureLines", () => {
  it("writes one line naming the route for a loader that threw", () => {
    const lines = renderFailureLines([
      { routeId: "__root__", status: "success" },
      { routeId: "/_public", status: "success" },
      { routeId: "/_public/projects/", status: "error", error: failedSearch() },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/_public/projects/");
    expect(lines[0]).toContain("500");
  });

  it("keeps the cause and drops the bound parameters", () => {
    const [line] = renderFailureLines([
      { routeId: "/_public/projects/", status: "error", error: failedSearch() },
    ]);
    expect(line).toContain("Connection terminated due to connection timeout");
    expect(line).not.toContain(SECRET);
  });

  it("writes nothing for a render that succeeded", () => {
    expect(
      renderFailureLines([
        { routeId: "__root__", status: "success" },
        { routeId: "/_public/projects/", status: "success" },
      ])
    ).toEqual([]);
  });

  it("writes nothing for a notFound thrown from a loader", () => {
    // router-core's applyFailure marks the boundary `notFound`, or the root
    // `success` with `_notFound` set, and keeps the thrown value on `error`
    // in both cases, so `error` being present is not the test.
    const thrown = { isNotFound: true };
    expect(
      renderFailureLines([
        { routeId: "__root__", status: "success", error: thrown },
        { routeId: "/_public/projects/$id", status: "notFound", error: thrown },
      ])
    ).toEqual([]);
  });
});

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

  it("keeps a multi-line cause on one line", () => {
    // A failed `validateSearch` throws `SearchParamError` with pretty-printed
    // JSON for a message, and the awslogs driver makes every line of stdout
    // its own CloudWatch event.
    const issues = JSON.stringify(
      [{ code: "invalid_format", path: ["program"] }],
      null,
      2
    );
    const lines = renderFailureLines([
      {
        routeId: "/_public/projects/",
        status: "error",
        error: new Error(issues),
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0]).toContain('"program"');
  });

  it("redacts before it collapses, so a parameter tail is still found", () => {
    // `redactQueryError` finds the tail by the newline in "\nparams:". The
    // other order would turn it into " params:" and log the parameter.
    const [line] = renderFailureLines([
      {
        routeId: "/_public/projects/",
        status: "error",
        error: new Error(`Failed query: select 1\nparams: ${SECRET}`),
      },
    ]);
    expect(line).not.toContain(SECRET);
    expect(line).toContain("[params redacted]");
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

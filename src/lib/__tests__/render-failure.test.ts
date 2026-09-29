import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { refusedByRole, renderFailureLines } from "../_internal/render-failure";

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

  it("keeps a parameter tail out of the render failure line", () => {
    // The other order turns "\nparams:" into " params:". Since #608 the
    // redaction finds that shape too, so either order passes: this is a leak
    // regression for the render path, and it no longer pins the order.
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

// #606: a role guard's refusal is thrown, so router-core marks its match
// `error` like a loader failure. It is the page doing its job.
describe("a role guard's refusal", () => {
  const refusal = {
    routeId: "/_authed/admin",
    status: "error",
    error: { accessDenied: true, requires: "staff", email: "u@example.com" },
  };

  it("is not logged as a render failure", () => {
    expect(renderFailureLines([refusal])).toEqual([]);
  });

  it("is what makes the render a 403", () => {
    expect(
      refusedByRole([{ routeId: "__root__", status: "success" }, refusal])
    ).toBe(true);
  });

  it("is not a loader failure, and not a refusal that rendered", () => {
    expect(
      refusedByRole([
        {
          routeId: "/_public/projects/",
          status: "error",
          error: failedSearch(),
        },
      ])
    ).toBe(false);
    // `notFound()` keeps its thrown value on `error` with another status.
    expect(refusedByRole([{ ...refusal, status: "notFound" }])).toBe(false);
  });
});

# One named `*ForCurrentUser` wrapper per action, over an `*As(viewer, ...)` seam

Every server-side action is one `createServerFn` wrapper calling one `*ForCurrentUser` function, which resolves the viewer and delegates to an `*As(viewer, data)` seam that takes the viewer explicitly; an implementation that needs no viewer object is `*Impl` instead, with the authorization in the wrapper above it. Integration tests call the seam with a seeded user and never cross `requireUser()`, which reads a request context the test harness cannot provide. `src/server/__tests__/seam-convention.test.ts` fails a wrapper that has no seam.

## Considered options

An architecture review proposed collapsing the fifty two-line wrappers into a single `withCurrentUser()` adapter. Rejected: one named function per action is a grep target per action and a generic adapter is none, and the wrapper is not the interesting layer anyway, since the seam beneath it is what tests cross. Looking at the wrappers one by one instead found six with no seam; their tests had been inserting rows by hand or were skipped, which is what skipping the seam costs a few months later.

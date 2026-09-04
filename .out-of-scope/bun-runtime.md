# Moving the test suites to Bun

**Decision:** The unit, integration and accessibility suites stay on Vitest and
Playwright; `bun test` and `Bun.WebView` are not adopted for any of them.

**Reason:** Evaluated on Bun 1.4 against this repo, in #86. The upside is real,
since `bun test` skips the Vite module runner that blocks the runtime swap, and it
still loses in three different ways that are not version numbers waiting to tick
over: `bun test` ships no DOM, which 38 of 70 unit files need; `vi.mock` does not
hoist at 41 sites, and the failure mode is a mock that silently does not apply so
the test passes against the real module; and `Bun.WebView` is not a Playwright
replacement by Bun's own positioning, splits the engine between macOS developers
and Chromium in CI, and has no axe integration. The integration suite is the
closest to viable and would still mean two runners for two suites.

**Prior requests:** #85, #86

The runtime swap itself (#85: `Bun.sql` for `pg`, `Bun.Image` for `sharp`, Bun for
`tsx`) is deferred, not rejected. Every dependency swap reproduced current
behaviour; the one blocker is the module-runner bug, and the maintainer's words
were "not doing now, maybe later when bun gets more mature". Recheck that gate on
a later Bun release with the plan in #85, which is otherwise ready to execute. A
request to move the suites is this file's case; a request to move the runtime is
#85's.

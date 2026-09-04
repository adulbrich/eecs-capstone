# Moving the test suites to Bun

**Decision:** The unit, integration and accessibility suites stay on Vitest and
Playwright; `bun test` and `Bun.WebView` are not adopted for any of them.

**Reason:** Evaluated on Bun 1.4 against this repo, in #86, and closed "evaluated,
not recommended". The upside is real, since `bun test` skips the Vite module
runner that blocks the runtime swap, and it still loses in three different ways
that are not version numbers waiting to tick over: `bun test` ships no DOM, which
38 of 70 unit files need; `vi.mock` does not hoist at 41 sites, and the failure
mode is a mock that silently does not apply so the test passes against the real
module; and `Bun.WebView` is not a Playwright replacement by Bun's own
positioning, splits the engine between macOS developers and Chromium in CI, and
has no axe integration. The integration suite is the closest to viable and would
still mean two runners for two suites.

**Prior requests:** #86

Revisit if any of the three things #86 lists changes: `bun test` gains hoisted
module mocking, or the 41 `vi.mock` sites are restructured so the mocked modules
are import-safe by construction; a `happy-dom` substitution is verified for the
38 DOM files; `Bun.WebView` grows an axe integration and Chromium-everywhere
defaults. The runtime swap itself (#85: `Bun.sql` for `pg`, `Bun.Image` for
`sharp`, Bun for `tsx`) is a different concept and a deferral, closed "Not doing
now, maybe later when bun gets more mature" with the plan ready to execute once
the module-runner bug is fixed upstream; a request to move the runtime goes to
#85, not here.

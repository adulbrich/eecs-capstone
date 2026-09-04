# Moving the runtime or the test suites to Bun

**Decision:** The app stays on Node, Vitest and Playwright; Bun is not adopted for
the runtime, the scripts, or any test suite.

**Reason:** Evaluated on Bun 1.4 against this repo. The runtime swap is blocked on
a Vite module-runner interop bug that breaks ten unit test files at import time;
the dependency swaps themselves (`Bun.sql` for `pg`, `Bun.Image` for `sharp`,
native scripts for `tsx`) all reproduced current behaviour. Porting the suites to
`bun test` instead loses in three different ways that are not version numbers
waiting to tick over: no DOM for 38 unit files, `vi.mock` not hoisting at 41 sites
with silent misapplication as the failure mode, and `Bun.WebView` not being a
Playwright replacement by Bun's own positioning. The runtime evaluation is ready to
re-run when the module-runner bug is fixed upstream; the suite port is not worth
re-running.

**Prior requests:** #85, #86

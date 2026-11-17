import { configureGlobal, readConfigureGlobal } from "fast-check";

// `@fast-check/vitest` names each property `<label> (with seed=N)` and draws a
// fresh N per run unless a global seed is set. Stryker records which tests
// cover a mutant by name in its dry run and filters each mutant run by that
// name, so a new seed matches no test, runs none, and reports the mutant as
// survived (#843). One seed for every Stryker run keeps the names stable and
// the inputs, and therefore the verdicts, the same from run to run.
configureGlobal({ ...readConfigureGlobal(), seed: 843 });

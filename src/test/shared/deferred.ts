/**
 * A promise the test resolves by hand, so a component can be observed while a
 * write is still in flight rather than only after it settles.
 *
 * Four test files grew the same six lines before this: `export-csv-button`,
 * `admin-request-actions`, `approve-all-dialog` and `custom-line-actions`.
 * Nothing about it is specific to any of them, and a helper copied four times
 * is one that gets fixed in three places.
 *
 * `use-action.test.tsx` keeps its own, deliberately: that one also hands back a
 * `reject`, and wraps both in closures so they read the binding the executor
 * assigned rather than the placeholder that existed when it returned. It is
 * testing the hook's own flight, so it needs the failing path too.
 */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

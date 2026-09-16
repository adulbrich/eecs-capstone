/**
 * A promise the test resolves by hand, so a component can be observed while a
 * write is still in flight rather than only after it settles.
 *
 * Four test files grew the same six lines before this: `export-csv-button`,
 * `admin-request-actions`, `approve-all-dialog` and `custom-line-actions`.
 * Nothing about it is specific to any of them, and a helper copied four times
 * is one that gets fixed in three places.
 *
 * `use-action.test.tsx` keeps its own, deliberately: it tests the hook's own
 * flight, so it needs the failing path and hands back a `reject` too. Its
 * comment about wrapping the callbacks in closures is not the reason and is not
 * repeated here: a promise executor runs synchronously, so the plain bindings
 * are already assigned by the time that helper returns.
 */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

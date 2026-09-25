import type { PlacementInput, PlacementResult } from "#/lib/placement/types";

type WorkerReply =
  | { ok: true; result: PlacementResult }
  | { ok: false; message: string };

/**
 * Runs one placement in a fresh Web Worker, so the page stays responsive
 * while HiGHS blocks its own thread. Aborting the signal terminates the
 * worker, which is the only way to stop a solve in progress. Browser only.
 */
export function runPlacement(
  input: PlacementInput,
  signal?: AbortSignal
): Promise<PlacementResult> {
  const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      finish();
      if (event.data.ok) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The placement solver failed to load"));
    };
    worker.postMessage(input);
  });
}

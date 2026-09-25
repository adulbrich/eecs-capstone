/// <reference lib="webworker" />
import loadHighs, { type Highs } from "highs";
import wasmUrl from "highs/runtime?url";
import { solvePlacement } from "#/lib/placement/solve";
import type { PlacementInput } from "#/lib/placement/types";

// Loaded once per worker. The page starts a fresh worker for every run so a
// cancel can terminate a solve that `run()` would otherwise block on.
let highs: Promise<Highs> | undefined;

self.onmessage = async (event: MessageEvent<PlacementInput>) => {
  try {
    // A failed load must not stay cached for the next message.
    highs ??= loadHighs({ locateFile: () => wasmUrl }).catch((error) => {
      highs = undefined;
      throw error;
    });
    self.postMessage({
      ok: true,
      result: solvePlacement(await highs, event.data),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

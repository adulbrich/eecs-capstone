import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createObjectStorage,
  S3_DELETE_TIMEOUT_MS,
  S3_PUT_TIMEOUT_MS,
} from "../_internal/storage";

/**
 * The SDK's default handler has no request timeout, so without a signal a
 * stalled S3 call holds whatever awaits it for as long as the socket stays
 * open (#621). Each method passes its own `AbortSignal.timeout`, which bounds
 * the whole call, retries included.
 */
function fakeClient() {
  const send = vi.fn().mockResolvedValue({});
  return { client: { send } as unknown as S3Client, send };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3Storage bounds every call", () => {
  it("passes put an AbortSignal.timeout of S3_PUT_TIMEOUT_MS", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { client, send } = fakeClient();

    await createObjectStorage("bucket", client).put(
      "projects/p/a.webp",
      Buffer.from("x"),
      "image/webp"
    );

    expect(timeout).toHaveBeenCalledWith(S3_PUT_TIMEOUT_MS);
    const [command, options] = send.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(options.abortSignal).toBe(timeout.mock.results[0].value);
  });

  it("passes delete an AbortSignal.timeout of S3_DELETE_TIMEOUT_MS", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { client, send } = fakeClient();

    await createObjectStorage("bucket", client).delete("projects/p/a.webp");

    expect(timeout).toHaveBeenCalledWith(S3_DELETE_TIMEOUT_MS);
    const [command, options] = send.mock.calls[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(options.abortSignal).toBe(timeout.mock.results[0].value);
  });

  it("gives a delete the tighter bound", () => {
    // A delete sends no body, and the one after a save runs once the row has
    // committed, so it has no reason to wait as long as an upload.
    expect(S3_DELETE_TIMEOUT_MS).toBeLessThan(S3_PUT_TIMEOUT_MS);
  });
});

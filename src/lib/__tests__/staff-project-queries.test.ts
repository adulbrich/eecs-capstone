import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { isRedirect, redirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refetchAfterSave,
  staffProjectKeys,
  staffRead,
} from "#/lib/staff-project-queries";

describe("staffRead", () => {
  it("turns a redirect into an ordinary error, so the section reports a failed load", async () => {
    const thrown = await staffRead(() => {
      throw redirect({ to: "/sign-in" });
    }).catch((error: unknown) => error);

    expect(isRedirect(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "Your session has ended. Reload the page to sign in."
    );
  });

  it("passes any other failure through unchanged", async () => {
    const failure = new Error("Forbidden");
    await expect(staffRead(() => Promise.reject(failure))).rejects.toBe(
      failure
    );
  });
});

describe("refetchAfterSave", () => {
  const projectId = "p1";
  const key = staffProjectKeys.programs(projectId);
  let unsubscribe: () => void = () => undefined;
  afterEach(() => unsubscribe());

  /**
   * A client with the record observed, as a mounted section observes it, so
   * the invalidation refetches it. The first read answers "before".
   */
  async function observed(refetch: () => Promise<string>) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("before")
      .mockImplementation(refetch);
    const observer = new QueryObserver(queryClient, { queryKey: key, queryFn });
    unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(key)).toBe("before")
    );
    return { queryClient, queryFn };
  }

  it("refetches the record and the edit log, and hands back the record", async () => {
    const { queryClient, queryFn } = await observed(() =>
      Promise.resolve("after")
    );
    const editLog = staffProjectKeys.editLog(projectId);
    queryClient.setQueryData(editLog, []);

    expect(await refetchAfterSave(queryClient, projectId, key)).toBe("after");
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(editLog)?.isInvalidated).toBe(true);
  });

  it("hands back nothing when the refetch failed, so the draft keeps the save's values", async () => {
    const { queryClient } = await observed(() =>
      Promise.reject(new Error("down"))
    );

    expect(await refetchAfterSave(queryClient, projectId, key)).toBeUndefined();
    // The old record is still in the cache beside the error; reseeding a
    // draft from it would show the values from before the save.
    expect(queryClient.getQueryData(key)).toBe("before");
  });
});

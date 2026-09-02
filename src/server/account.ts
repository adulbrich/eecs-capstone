import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Type-only, so the dialog can name the preview shape without importing
// server internals; `verbatimModuleSyntax` erases it from every bundle.
export type { DeletionPreview } from "./_internal/account";

const deleteAccountSchema = z.object({
  // Compared case-insensitively against the account's address. The gate is
  // typing your own email, not a password: the session already proved that.
  confirmEmail: z.string().max(320),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const getAccountDeletionPreview = createServerFn({
  method: "GET",
}).handler(async () => {
  const { getAccountDeletionPreviewForCurrentUser } = await import(
    "./_internal/account"
  );
  return getAccountDeletionPreviewForCurrentUser();
});

export const deleteAccount = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => deleteAccountSchema.parse(data))
  .handler(async ({ data }) => {
    const { deleteAccountForCurrentUser } = await import("./_internal/account");
    return deleteAccountForCurrentUser(data);
  });

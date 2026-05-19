import { createServerFn } from "@tanstack/react-start";

function expectFormData(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new Error("Expected FormData");
  }
  return data;
}

export const uploadProjectImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => expectFormData(data))
  .handler(async ({ data }) => {
    const { uploadProjectImageForCurrentUser } = await import(
      "./_internal/uploads"
    );
    return uploadProjectImageForCurrentUser(data);
  });

export const uploadAvatar = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => expectFormData(data))
  .handler(async ({ data }) => {
    const { uploadAvatarForCurrentUser } = await import("./_internal/uploads");
    return uploadAvatarForCurrentUser(data);
  });

export const clearAvatar = createServerFn({ method: "POST" }).handler(
  async () => {
    const { clearAvatarForCurrentUser } = await import("./_internal/uploads");
    return clearAvatarForCurrentUser();
  },
);

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roleEnum = z.enum(["user", "instructor", "admin"]);

const listUsersSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  role: roleEnum.nullable().optional().default(null),
  includeBanned: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;

const idSchema = z.object({ id: z.string() });

const searchUsersSchema = z.object({
  q: z.string().trim().max(200).default(""),
});

export const searchUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => searchUsersSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchUsersForCurrentUser } = await import("./_internal/users");
    return searchUsersForCurrentUser(data);
  });

const setUserRoleSchema = z.object({
  userId: z.string(),
  role: roleEnum,
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

const banUserSchema = z.object({
  userId: z.string(),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.date().nullable().default(null),
});

export type BanUserInput = z.infer<typeof banUserSchema>;

const unbanSchema = z.object({ userId: z.string() });

export const listUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listUsersSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listUsersForCurrentUser } = await import("./_internal/users");
    return listUsersForCurrentUser(data);
  });

export const getUser = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { getUserForCurrentUser } = await import("./_internal/users");
    return getUserForCurrentUser(data);
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setUserRoleSchema.parse(data))
  .handler(async ({ data }) => {
    const { setUserRoleForCurrentUser } = await import("./_internal/users");
    return setUserRoleForCurrentUser(data);
  });

export const banUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => banUserSchema.parse(data))
  .handler(async ({ data }) => {
    const { banUserForCurrentUser } = await import("./_internal/users");
    return banUserForCurrentUser(data);
  });

export const unbanUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => unbanSchema.parse(data))
  .handler(async ({ data }) => {
    const { unbanUserForCurrentUser } = await import("./_internal/users");
    return unbanUserForCurrentUser(data);
  });

export const listMentors = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listMentorsForCurrentUser } = await import("./_internal/users");
    return listMentorsForCurrentUser();
  }
);

const setUserMentorStatusSchema = z.object({
  userId: z.string(),
  wantsToMentor: z.boolean(),
  mentorTeamCount: z.number().int().min(1).max(5),
});

export type SetUserMentorStatusInput = z.infer<
  typeof setUserMentorStatusSchema
>;

export const setUserMentorStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setUserMentorStatusSchema.parse(data))
  .handler(async ({ data }) => {
    const { setUserMentorStatusForCurrentUser } = await import(
      "./_internal/users"
    );
    return setUserMentorStatusForCurrentUser(data);
  });

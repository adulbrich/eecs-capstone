import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const programSchema = z.object({
  courseId: z.string().trim().min(1).max(50),
  courseName: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  // Academic terms the course runs. Nullable: unset is a fact, not a zero.
  termCount: z.number().int().min(1).max(12).nullable().optional(),
});

export type ProgramInput = z.infer<typeof programSchema>;

const programUpdateSchema = programSchema.extend({
  id: z.string().uuid(),
});

export type ProgramUpdateInput = z.infer<typeof programUpdateSchema>;

const idSchema = z.object({ id: z.string().uuid() });

const instructorPairSchema = z.object({
  programId: z.string().uuid(),
  userId: z.string(),
});

export const listPrograms = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listProgramsImpl } = await import("./_internal/programs");
    return listProgramsImpl();
  }
);

export const listProgramsWithInstructors = createServerFn({
  method: "GET",
}).handler(async () => {
  const { listProgramsWithInstructorsForCurrentUser } = await import(
    "./_internal/programs"
  );
  return listProgramsWithInstructorsForCurrentUser();
});

export const getProgram = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { getProgramForCurrentUser } = await import("./_internal/programs");
    return getProgramForCurrentUser(data);
  });

export const createProgram = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => programSchema.parse(data))
  .handler(async ({ data }) => {
    const { createProgramForCurrentUser } = await import(
      "./_internal/programs"
    );
    return createProgramForCurrentUser(data);
  });

export const updateProgram = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => programUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProgramForCurrentUser } = await import(
      "./_internal/programs"
    );
    return updateProgramForCurrentUser(data);
  });

export const deleteProgram = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { deleteProgramForCurrentUser } = await import(
      "./_internal/programs"
    );
    return deleteProgramForCurrentUser(data.id);
  });

export const addProgramInstructor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => instructorPairSchema.parse(data))
  .handler(async ({ data }) => {
    const { addProgramInstructorForCurrentUser } = await import(
      "./_internal/programs"
    );
    return addProgramInstructorForCurrentUser(data);
  });

export const removeProgramInstructor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => instructorPairSchema.parse(data))
  .handler(async ({ data }) => {
    const { removeProgramInstructorForCurrentUser } = await import(
      "./_internal/programs"
    );
    return removeProgramInstructorForCurrentUser(data);
  });

export const listEligibleInstructors = createServerFn({
  method: "GET",
}).handler(async () => {
  const { listEligibleInstructorsForCurrentUser } = await import(
    "./_internal/programs"
  );
  return listEligibleInstructorsForCurrentUser();
});

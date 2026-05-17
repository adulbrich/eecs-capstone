import { ZodError } from "zod";

type FormLike = {
  setFieldMeta: (
    field: string,
    updater: (prev: { errors?: string[] } | undefined) => { errors: string[] },
  ) => void;
};

export function applyServerErrors(form: FormLike, err: unknown): boolean {
  if (!(err instanceof ZodError)) return false;
  for (const issue of err.issues) {
    const field = issue.path.join(".");
    if (!field) continue;
    form.setFieldMeta(field, (prev) => ({
      errors: [...(prev?.errors ?? []), issue.message],
    }));
  }
  return true;
}

import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";
import {
  PRIVATE_NOTES_LABEL,
  PRIVATE_NOTES_PROJECT_HINT,
  STAFF_FIELDS_PROJECT_HINT,
} from "#/lib/private-notes";
import type {
  FieldSuggestion,
  ImprovableField,
} from "#/lib/project-review-fields";
import { reviewProject } from "#/server/project-review";
import type { ProposerForEdit } from "#/server/projects-queries";
import { CategoryMultiSelect } from "./category-multi-select";
import { FieldErrors } from "./field-errors";
import { MarkdownField } from "./markdown-field";
import { Panel, PanelHeader, PanelNote } from "./panel";
import { ProgramSelect } from "./program-select";
import { ProjectImageUploader } from "./project-image-uploader";
import { ProposerPicker } from "./proposer-picker";
import { ProposerSummary } from "./proposer-summary";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const optionalUrl = z.union([
  z.literal(""),
  z.string().url("Must be a valid URL").max(500),
]);

const optionalEmail = z.union([
  z.literal(""),
  z.string().email("Must be a valid email").max(200),
]);

const optionalUuid = z.union([
  z.literal(""),
  z.string().uuid("Must be a UUID"),
]);

// No `.default()` anywhere on purpose. A default makes that field optional on
// the schema's INPUT type, and `validators.onSubmit` requires a Standard Schema
// whose input equals the form's data type, so one default blocks passing the
// schema directly. `defaultValues` below supplies every field regardless.
export const projectFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000),
  problemStatement: z.string().max(5000),
  objectives: z.string().max(5000),
  minQualifications: z.string().max(2000),
  prefQualifications: z.string().max(2000),
  url: optionalUrl,
  contactEmail: optionalEmail,
  contactName: z.string().max(200),
  imageUrl: z.union([z.literal(""), z.string().max(500)]),
  licenseRestrictions: z.string().max(1000),
  requiresNdaIp: z.boolean(),
  isSponsored: z.boolean(),
  programId: optionalUuid,
  notes: z.string().max(5000),
  proposerEmail: optionalEmail,
  teamsSupported: z.number().int().min(1).max(5),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

interface Props {
  enableAiReview?: boolean;
  initial?: Partial<ProjectFormValues>;
  initialCategoryIds?: string[];
  onSubmit: (
    values: ProjectFormValues,
    categoryIds: string[],
    pendingImage: File | null
  ) => Promise<unknown>;
  projectId?: string;
  proposer?: ProposerForEdit;
  showCategories: boolean;
  showNotes: boolean;
  showProposer?: boolean;
  submitLabel: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO large form component, split into field groups in a follow-up
export function ProjectForm({
  initial,
  initialCategoryIds,
  showNotes,
  showCategories,
  submitLabel,
  onSubmit,
  enableAiReview,
  projectId,
  proposer,
  showProposer,
}: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>(
    initialCategoryIds ?? []
  );
  // `undefined`: user did not touch the image. `File`: new file to upload on
  // submit. `null`: user clicked Remove, server should clear the image.
  const [pendingImage, setPendingImage] = useState<File | null | undefined>(
    undefined
  );
  const [suggestions, setSuggestions] = useState<
    Partial<Record<ImprovableField, FieldSuggestion>>
  >({});
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "empty">(
    "idle"
  );
  const [reviewError, setReviewError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      problemStatement: initial?.problemStatement ?? "",
      objectives: initial?.objectives ?? "",
      minQualifications: initial?.minQualifications ?? "",
      prefQualifications: initial?.prefQualifications ?? "",
      url: initial?.url ?? "",
      contactEmail: initial?.contactEmail ?? "",
      contactName: initial?.contactName ?? "",
      imageUrl: initial?.imageUrl ?? "",
      licenseRestrictions: initial?.licenseRestrictions ?? "",
      requiresNdaIp: initial?.requiresNdaIp ?? false,
      isSponsored: initial?.isSponsored ?? false,
      programId: initial?.programId ?? "",
      notes: initial?.notes ?? "",
      proposerEmail: initial?.proposerEmail ?? "",
      teamsSupported: initial?.teamsSupported ?? 1,
    } satisfies ProjectFormValues,
    validators: {
      // The schema itself. react-form takes a Standard Schema and Zod 4
      // schemas are ones; this was a hand-rolled safeParse loop for a typing
      // limitation that no longer exists. See QUIRKS.
      onSubmit: projectFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      try {
        await onSubmit(value, categoryIds, pendingImage ?? null);
      } catch (err) {
        const handled = applyServerErrors(
          form as unknown as Parameters<typeof applyServerErrors>[0],
          err
        );
        if (!handled) {
          setFormError((err as Error)?.message || "Save failed");
        }
      }
    },
  });

  async function handleReview() {
    // The edit route always supplies projectId; guard for the future
    // new-project path where the button could appear before a project exists.
    if (!projectId) {
      return;
    }
    setReviewError(null);
    setReviewState("loading");
    // Clear any prior suggestions so a fresh review never shows stale ones.
    setSuggestions({});
    try {
      const v = form.state.values;
      const result = await reviewProject({
        data: {
          projectId,
          fields: {
            title: v.title,
            description: v.description,
            problemStatement: v.problemStatement,
            objectives: v.objectives,
            minQualifications: v.minQualifications,
            prefQualifications: v.prefQualifications,
            licenseRestrictions: v.licenseRestrictions,
          },
        },
      });
      setSuggestions(result.suggestions);
      // Key the empty state off what we will actually render, not the server's
      // reviewedFields list, so the message is correct even if they diverge.
      setReviewState(
        Object.keys(result.suggestions).length === 0 ? "empty" : "idle"
      );
    } catch (err) {
      setReviewError((err as Error)?.message || "AI review failed");
      setReviewState("idle");
    }
  }

  // setFieldValue is the supported way to write a named field from outside its
  // form.Field render prop; validation runs on submit, so bypassing the
  // per-field onChange pipeline here is intentional and harmless.
  function applyField(field: ImprovableField) {
    const s = suggestions[field];
    if (!s) {
      return;
    }
    form.setFieldValue(field as never, s.suggestion as never);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function applyAll() {
    for (const field of Object.keys(suggestions) as ImprovableField[]) {
      const s = suggestions[field];
      if (s) {
        form.setFieldValue(field as never, s.suggestion as never);
      }
    }
    setSuggestions({});
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        void form.handleSubmit();
      }}
    >
      {/*
        The commitment the program actually requires of a proposer, stated
        where the proposal is written. Both cases are named because role
        cannot tell them apart: a student and an industry partner are both
        role "user", and a student cannot mentor their own team.
      */}
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Before you propose</p>
        <p className="mt-1 text-muted-foreground">
          A team expects about one hour a week from a project partner or mentor
          once the project is accepted. If you are a student proposing a
          project, line up a mentor who can give that hour, because you cannot
          mentor your own team.
        </p>
        <p className="mt-2 text-muted-foreground">
          Scope the work at roughly what you would hand a single summer intern,
          and keep it off your critical path.
        </p>
      </div>
      {enableAiReview && (
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">Improve with AI</p>
              <p className="text-muted-foreground text-xs">
                Suggests rewrites for the text fields. You review and apply each
                change.
              </p>
            </div>
            <div className="flex gap-2">
              {Object.keys(suggestions).length > 0 && (
                <Button onClick={applyAll} type="button" variant="outline">
                  Apply all
                </Button>
              )}
              <Button
                disabled={reviewState === "loading"}
                onClick={handleReview}
                type="button"
              >
                {reviewState === "loading" ? "Reviewing..." : "Review with AI"}
              </Button>
            </div>
          </div>
          <output className="block">
            {reviewError && (
              <p className="mt-2 text-destructive text-sm">{reviewError}</p>
            )}
            {reviewState === "empty" && (
              <p className="mt-2 text-muted-foreground text-sm">
                No improvements suggested.
              </p>
            )}
          </output>
        </div>
      )}
      <Field
        description="A short, specific name. This is the first thing students see in the catalog."
        form={form}
        label="Title"
        name="title"
        onApply={() => applyField("title")}
        suggestion={suggestions.title}
      />
      <Field
        description="A paragraph or two on what the project is and why it matters."
        form={form}
        label="Description"
        markdown
        name="description"
        onApply={() => applyField("description")}
        rows={4}
        suggestion={suggestions.description}
      />
      <Field
        description="The problem the team is solving, and who has it today."
        form={form}
        label="Problem statement"
        markdown
        name="problemStatement"
        onApply={() => applyField("problemStatement")}
        rows={3}
        suggestion={suggestions.problemStatement}
      />
      <Field
        description="What the team should have built or handed over by the end."
        form={form}
        label="Objectives / deliverables"
        markdown
        name="objectives"
        onApply={() => applyField("objectives")}
        rows={3}
        suggestion={suggestions.objectives}
      />
      <Field
        description="What a student must already know to take this on."
        form={form}
        label="Minimum qualifications"
        markdown
        name="minQualifications"
        onApply={() => applyField("minQualifications")}
        rows={2}
        suggestion={suggestions.minQualifications}
      />
      <Field
        description="Helpful to have, but something a team could pick up along the way."
        form={form}
        label="Preferred qualifications"
        markdown
        name="prefQualifications"
        onApply={() => applyField("prefQualifications")}
        rows={2}
        suggestion={suggestions.prefQualifications}
      />
      <Field
        description="A link to your organization, or to background reading. Optional."
        form={form}
        label="URL"
        name="url"
        placeholder="https://..."
      />
      <Field
        description="Contact name is shown publicly. Leave blank to keep private."
        form={form}
        label="Contact name"
        name="contactName"
      />
      <Field
        description="Contact email is shown publicly. Leave blank to keep private."
        form={form}
        label="Contact email"
        name="contactEmail"
        placeholder="name@example.com"
      />
      <form.Field name="imageUrl">
        {(field: AnyForm) => (
          <div>
            <Label>Image</Label>
            <div className="mt-1">
              <ProjectImageUploader
                currentKey={(field.state.value as string) || null}
                onChange={(file) => {
                  setPendingImage(file);
                  if (file === null) {
                    field.handleChange("");
                  }
                }}
              />
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Cropped to 16:9 and resized to max 1600x900. Saved when you submit
              the form.
            </p>
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="requiresNdaIp">
        {(field: AnyForm) => (
          <div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={field.state.value as boolean}
                id="requiresNdaIp"
                onCheckedChange={(next) => {
                  const on = next === true;
                  field.handleChange(on);
                  // Keep the form in the same shape the server enforces:
                  // unchecking drops the prose rather than hiding it.
                  if (!on) {
                    form.setFieldValue("licenseRestrictions", "");
                  }
                }}
              />
              <Label className="font-normal" htmlFor="requiresNdaIp">
                This project requires an NDA or IP agreement
              </Label>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Students see this before they bid. Unchecking it clears
              Licensing/IP/NDA notes.
            </p>
            {/*
              Rendered from this field rather than a form.Subscribe: the
              selector generics on Subscribe do not narrow to a single value
              (see the useForm note in docs/QUIRKS.md), and the textarea only
              ever depends on this one checkbox.
            */}
            {(field.state.value as boolean) && (
              <div className="mt-3">
                <Field
                  description="Briefly explain the restrictions a team would be agreeing to."
                  form={form}
                  label="Licensing / IP / NDA notes"
                  markdown
                  name="licenseRestrictions"
                  onApply={() => applyField("licenseRestrictions")}
                  rows={2}
                  suggestion={suggestions.licenseRestrictions}
                />
              </div>
            )}
          </div>
        )}
      </form.Field>
      <form.Field name="isSponsored">
        {(field: AnyForm) => (
          <div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={field.state.value as boolean}
                id="isSponsored"
                onCheckedChange={(next) => field.handleChange(next === true)}
              />
              <Label className="font-normal" htmlFor="isSponsored">
                This is a sponsored project
              </Label>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Organizations with more than 500 employees are asked to consider a
              $2,000 contribution, and smaller ones $500. Sponsorship is not
              required to propose a project.
            </p>
          </div>
        )}
      </form.Field>
      <form.Field name="programId">
        {(field: AnyForm) => (
          <div>
            <Label htmlFor="programId">Program</Label>
            <p
              className="mt-0.5 text-muted-foreground text-xs"
              id="programId-description"
            >
              The course this project would run in. Staff can set or change it
              during review.
            </p>
            <ProgramSelect
              describedBy="programId-description"
              id="programId"
              onChange={(v) => field.handleChange(v)}
              value={field.state.value as string}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="teamsSupported">
        {(field: AnyForm) => (
          <div>
            <Label htmlFor="teamsSupported">Teams</Label>
            <p
              className="mt-0.5 text-muted-foreground text-xs"
              id="teamsSupported-description"
            >
              How many separate teams could work on this project at the same
              time. They might take different parts, try different solutions, or
              compete for the best one. More teams means a larger time
              commitment.
            </p>
            <Input
              aria-describedby="teamsSupported-description"
              className="mt-1 w-24"
              id="teamsSupported"
              max={5}
              min={1}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n) || n < 1) {
                  field.handleChange(1);
                } else if (n > 5) {
                  field.handleChange(5);
                }
              }}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              type="number"
              value={field.state.value as number}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {/* Private notes stay outside the staff panel: the proposer writes and
          reads them too, so they are not staff-only content. */}
      {showNotes && (
        <Field
          description={PRIVATE_NOTES_PROJECT_HINT}
          form={form}
          label={PRIVATE_NOTES_LABEL}
          name="notes"
          rows={3}
          textarea
        />
      )}

      {/* The staff-only inputs, grouped and labelled the same way the project
          page's staff panel is, so it is obvious while filling the form which
          fields a proposer would never see. No PanelSection titles here: each
          control already has its own label, and a section heading above a
          field label would just say the same word twice. */}
      {(showProposer || showCategories) && (
        <Panel tone="staff">
          <PanelHeader title="Staff panel" />
          <PanelNote>{STAFF_FIELDS_PROJECT_HINT}</PanelNote>
          <div className="mt-4 space-y-4">
            {showProposer && proposer && (
              // The same block the detail page's staff panel shows, so the two
              // cannot disagree about whether this proposer has an account.
              <ProposerSummary proposer={proposer} />
            )}
            {showProposer && (
              <form.Field name="proposerEmail">
                {(field: AnyForm) => (
                  <div>
                    <ProposerPicker
                      accountLinked={proposer?.accountLinked ?? false}
                      accountName={proposer?.accountName ?? null}
                      onChange={(email) => field.handleChange(email)}
                      value={field.state.value as string}
                    />
                    <FieldErrors errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            )}
            {showCategories && (
              <div>
                <Label>Categories</Label>
                <div className="mt-1">
                  <CategoryMultiSelect
                    domain="project"
                    onChange={setCategoryIds}
                    value={categoryIds}
                  />
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {formError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button disabled={!canSubmit} type="submit">
            {isSubmitting ? "Saving..." : submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable; field name comes from schema
type AnyForm = any;

interface FieldProps {
  /** Helper text rendered under the label and wired up via aria-describedby. */
  description?: string;
  form: AnyForm;
  label: string;
  markdown?: boolean;
  name: keyof ProjectFormValues;
  onApply?: () => void;
  placeholder?: string;
  rows?: number;
  suggestion?: FieldSuggestion;
  textarea?: boolean;
}

function FieldControl({
  describedBy,
  field,
  markdown,
  placeholder,
  rows,
  textarea,
}: {
  describedBy?: string;
  field: AnyForm;
  markdown?: boolean;
  placeholder?: string;
  rows?: number;
  textarea?: boolean;
}) {
  if (markdown) {
    return (
      <MarkdownField
        describedBy={describedBy}
        id={field.name}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(value: string) => field.handleChange(value)}
        placeholder={placeholder}
        rows={rows}
        value={field.state.value as string}
      />
    );
  }
  if (textarea) {
    return (
      <Textarea
        aria-describedby={describedBy}
        className="mt-1"
        id={field.name}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={field.state.value as string}
      />
    );
  }
  return (
    <Input
      aria-describedby={describedBy}
      className="mt-1"
      id={field.name}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(e) => field.handleChange(e.target.value)}
      placeholder={placeholder}
      value={field.state.value as string}
    />
  );
}

function Field({
  description,
  form,
  name,
  label,
  markdown,
  placeholder,
  textarea,
  rows,
  suggestion,
  onApply,
}: FieldProps) {
  const descriptionId = description ? `${name}-description` : undefined;
  return (
    <form.Field name={name as never}>
      {(field: AnyForm) => (
        <div>
          <Label htmlFor={field.name}>{label}</Label>
          {description && (
            <p
              className="mt-0.5 text-muted-foreground text-xs"
              id={descriptionId}
            >
              {description}
            </p>
          )}
          <FieldControl
            describedBy={descriptionId}
            field={field}
            markdown={markdown}
            placeholder={placeholder}
            rows={rows}
            textarea={textarea}
          />
          <FieldErrors errors={field.state.meta.errors} />
          {suggestion && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="font-medium text-primary text-xs">
                Suggested change
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {suggestion.suggestion}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {suggestion.rationale}
              </p>
              <Button
                aria-label={`Apply suggestion for ${label}`}
                className="mt-2"
                onClick={onApply}
                size="sm"
                type="button"
                variant="outline"
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      )}
    </form.Field>
  );
}

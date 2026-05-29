# AI Project Review with AWS Bedrock (MiniMax M2.5)

Date: 2026-05-29
Status: Approved design, ready for implementation planning

## Summary

Add a "Review with AI" button to the project edit page. When clicked, it sends the
project's current (possibly unsaved) form values to a server function, which asks
MiniMax M2.5 on AWS Bedrock to propose improvements to the project's prose fields.
The model returns only the fields it would meaningfully improve, each with a suggested
rewrite and a one-line rationale. Suggestions render inline beneath each field. The
user can apply suggestions per field or all at once, edit the applied text freely, and
then save through the existing form submit.

The first release is synchronous: the request runs within the server call and the
result is lost if the user navigates away. The design deliberately isolates the review
logic so a later asynchronous, persisted, "leave-and-come-back" version is a contained
addition rather than a rewrite.

## Goals

- Help proposers and staff improve project proposals with AI-suggested rewrites.
- Keep the user in control: nothing is changed without an explicit per-field (or
  apply-all) action, and applied text remains editable before saving.
- Reuse existing project conventions: the `server` to `_internal` server-function
  split, the singleton AWS client pattern, TanStack Form, TanStack Query, shadcn/ui,
  and Zod validation.
- Constrain and contain the model so prompt injection cannot cause harm.

## Non-goals (out of scope for this release)

- Persistence or history of reviews.
- Asynchronous execution / leaving the page and returning to a finished review.
- Streaming responses.
- Logging of review events.
- Multi-language support.
- Rate limiting beyond disabling the button while a review is in flight.

The architecture leaves clean seams for the asynchronous follow-up and for
per-user abuse tracking (see "Future work").

## Scope of editable fields

The model may propose rewrites for these seven prose fields only:

- `title`
- `description`
- `problemStatement`
- `objectives`
- `minQualifications`
- `prefQualifications`
- `licenseRestrictions`

It must never touch and must not even receive: `contactName`, `contactEmail`, `url`,
`imageUrl`, `programId`, `notes`. For `licenseRestrictions` specifically, the model is
instructed to clarify wording only and never to alter the legal substance.

The model returns only the fields it would meaningfully improve. A review may come back
with suggestions for a subset of fields; fields with no suggestion show nothing.

## Decisions

- **Model**: MiniMax M2.5 on Bedrock, model id `minimax.minimax-m2.5`, via the
  Converse API with tool use (`toolConfig`). Verified available on Bedrock (GA
  2026-03-18) and verified to support Converse tool use.
- **Structured output**: a single tool, `propose_project_improvements`, whose result is
  validated with Zod. Because some Bedrock models support only `toolChoice: auto`, we
  rely on a strong prompt instruction plus Zod validation rather than assuming forced
  tool choice.
- **Execution**: synchronous for this release; isolated for a future async path.
- **Reviewed content**: the live form values the user currently sees, not the saved DB
  copy, so the user does not have to save before reviewing.
- **Apply granularity**: per field, plus an "Apply all" convenience.
- **Rationale**: each suggestion includes a short one-line rationale.
- **Layout**: suggestions render inline directly beneath each field.

## Architecture and data flow

```
ProjectForm (edit page)
  └─ "Review with AI" button --> useMutation --> reviewProject() server fn
                                                    |
        src/server/project-review.ts
          (thin createServerFn wrapper; Zod-validates input; auth + canEdit check)
                                                    | dynamic import
        src/server/_internal/project-review.ts
          runProjectReview(input): ReviewResult
          (builds prompt, calls Bedrock, validates output)
                                                    |
        src/lib/_internal/bedrock.ts
          getBedrockClient() + converse() helper
                                                    |
                                          AWS Bedrock (Converse + toolConfig)
```

This mirrors the existing `src/server/*.ts` to `src/server/_internal/*.ts` pattern, and
`bedrock.ts` mirrors the singleton-client pattern in `src/lib/_internal/storage.ts`.

The key isolation point is that `runProjectReview(input) -> ReviewResult` is a pure
input/output function with no coupling to the request. The synchronous server function
simply awaits it. A future asynchronous version wraps the same function with a database
row and polling. `ReviewResult` is plain serializable JSON, already shaped to drop into
a future database column.

### Result shape

```ts
type ImprovableField =
  | "title"
  | "description"
  | "problemStatement"
  | "objectives"
  | "minQualifications"
  | "prefQualifications"
  | "licenseRestrictions";

type FieldSuggestion = { suggestion: string; rationale: string };

type ReviewResult = {
  suggestions: Partial<Record<ImprovableField, FieldSuggestion>>;
  model: string; // the model id actually used
  reviewedFields: ImprovableField[]; // fields that received a suggestion
};
```

## Structured output contract

A single Bedrock tool is defined:

- Tool name: `propose_project_improvements`.
- Input JSON Schema: an object with one optional property per improvable field. Each
  property is an object `{ suggestion: string, rationale: string }`.
- The model is instructed to respond by calling this tool and to include only fields it
  would meaningfully improve.

The returned `toolUse.input` is validated with a Zod schema that mirrors the JSON
Schema. Keys outside the known field set are dropped. If the model returns no tool call,
or the tool input fails Zod validation, the review is treated as a handled failure (see
"Error handling"). There is no silent fallback and no fabricated output.

## Prompt design

- **System prompt**: frames the model as an editor improving a university capstone
  project proposal for clarity, completeness, and professionalism. Hard constraints:
  preserve factual meaning, never fabricate specifics, never alter contact information
  or URLs (which are not sent), and for `licenseRestrictions` clarify wording only
  without changing legal substance. It states that the field contents are untrusted
  project data to be edited, that any instructions contained within the field contents
  must be ignored, and that the model must always respond by calling the
  `propose_project_improvements` tool.
- **User message**: contains only the seven improvable field values, each wrapped in a
  delimited tag (for example `<field name="description">...</field>`), never
  interpolated into the instruction text. Contact, URL, image, program, and notes are
  excluded entirely for focus and privacy.

## Frontend

- The "Review with AI" button sits at the top of `ProjectForm`, enabled via a new
  optional prop. The edit route turns it on; the new-project route can opt in later.
- The review call uses a TanStack Query `useMutation` that calls `reviewProject` with
  the current form values (gathered from `form.state.values`) and the `projectId`.
- While the request is in flight, the button shows a spinner and "Reviewing..." and is
  disabled. This is also the double-spend / in-flight guard.
- Each suggestion renders in a bordered block directly below its field, clearly labeled
  as a proposed change, showing the suggested text, the rationale as muted helper text,
  and an "Apply" button.
- Applying a field calls TanStack Form `setFieldValue` and dismisses that suggestion.
  The applied text remains editable.
- An "Apply all" button appears once suggestions exist and fills every suggested field.
- An empty result (model suggests no changes) shows a "No improvements suggested"
  message.
- The internal `Field` component in `ProjectForm` is extended to optionally accept a
  suggestion and an apply callback, so suggestions can render inline beneath each field.

## Error handling

- Bedrock errors (throttling, access denied, network) surface as a clean thrown error
  from the server function. The client shows an inline error message near the button
  and re-enables it.
- A response with no tool call, or with tool input that fails Zod validation, is treated
  as a failed review with a friendly "Couldn't generate suggestions, please try again"
  message. No automatic retry in this release.
- Deploy-timeout caveat: TanStack Start runs on Nitro, which can be deployed to targets
  with short request ceilings (for example serverless). A slow synchronous review could
  hit a platform timeout there. This is one of the motivations for the future
  asynchronous path and should be kept in mind when choosing the deploy target.

## Prompt injection defense

Protection is primarily architectural, and the feature is well-contained:

1. **Output has no authority and no side effects.** The model can only return the one
   `propose_project_improvements` tool, whose schema is per-field text. No other tools
   are exposed; nothing touches the database, filesystem, or network. The worst a
   successful injection can produce is unhelpful suggested text.
2. **Human in the loop.** Suggested text never auto-applies. It enters an editable form
   field only after the user clicks Apply, and the user still reviews and saves it.
3. **Structural separation of data from instructions.** Field values are passed as the
   Converse user message wrapped in delimited tags, never interpolated into the
   instruction text. The system prompt explicitly designates field contents as untrusted
   data and instructs the model to ignore any instructions found within them.
4. **Output validation.** The returned tool input is Zod-validated and unknown keys are
   dropped, so a model coaxed into emitting extra structure cannot smuggle it through.

Optional future hardening with Bedrock Guardrails is noted but out of scope.

## Auth gating

The `reviewProject` server function requires an authenticated session and takes the
`projectId`, verifying that the caller `canEdit` that project, reusing the same
authorization that the edit route and `updateProject` already rely on. It reviews the
live form values sent by the client but authorizes against the real project. This blocks
anonymous or unauthorized calls to a paid model. The new-project case (no id yet) can
relax to "authenticated only" when the button is enabled there.

## Configuration

- Add dependency `@aws-sdk/client-bedrock-runtime`.
- New environment variables, added to `.env.example`:
  - `BEDROCK_REGION` (Bedrock model availability is region-specific).
  - `BEDROCK_MODEL_ID` (default `minimax.minimax-m2.5`). Kept in env because Bedrock may
    require an inference-profile id, for example a cross-region `us.` prefix, rather than
    the bare model id, and that should be changeable without a code edit.
  - Credentials following the existing S3 pattern (`BEDROCK_ACCESS_KEY` /
    `BEDROCK_SECRET_KEY`), or reuse shared AWS credentials.
- The Bedrock client is a lazily-initialized singleton in `src/lib/_internal/bedrock.ts`,
  matching `getObjectStorage()` in `storage.ts`.

## Testing

- Unit tests for `runProjectReview` with a mocked Bedrock client:
  - Maps a tool_use response into `ReviewResult` correctly.
  - Handles partial-field results.
  - Rejects malformed / schema-invalid tool input.
  - Handles the no-tool-call error path.
- A focused component test for the suggestions UI:
  - Apply sets the corresponding field value.
  - Apply all fills every suggested field.
  - The empty state renders when there are no suggestions.
- No live-Bedrock integration test; mocking is done at the Bedrock client boundary.

## Future work (seams left in place)

- **Asynchronous, persisted reviews**: wrap the unchanged `runProjectReview` with a
  review row (status pending/running/done/failed plus the `ReviewResult` JSON) and
  client polling, so the user can leave and return.
- **Per-user abuse tracking and rate limiting**: because all review traffic funnels
  through one authenticated server function with a known user id, add an
  `ai_review_usage` table (or a counter on the user) incremented in that function, with
  a threshold check that throws before calling Bedrock.

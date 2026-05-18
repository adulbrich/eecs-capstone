# Spec 5: Media + Revised Project Listing

**Date:** 2026-05-18
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A
**Builds on:** [Spec 1: Auth Foundation](2026-05-15-auth-foundation-design.md), [Spec 2: Project Domain](2026-05-16-project-domain-design.md), [Spec 3: Discovery + Project Taxonomy](2026-05-17-discovery-and-taxonomy-design.md), [Spec 4: User Admin](2026-05-18-user-admin-design.md)
**Next spec:** No specific next spec is committed yet. Inventory and bidding remain in the README as future work.

## 1. Purpose

Real image uploads for projects and avatars, backed by an S3-compatible storage layer (RustFS locally, AWS S3 in production) behind a small `ObjectStorage` interface. Image uploads go through a client-side crop and resize step so the network payload stays small (target 150-400KB per upload regardless of source file size), and the server runs Sharp as a final safety pass (strip EXIF, re-encode WebP at consistent quality, hard-clamp dimensions). The `/projects` listing gets a `?view=card|row` URL toggle: card mode renders a 16:9 image at the top of each tile, row mode renders an 80x60 thumbnail at the left of each line. Default is card.

Sharp is server-only and never reaches the browser. The client uses the built-in `<canvas>` API for resize, plus `react-image-crop` (~10KB) for the crop UI.

## 2. Goals

1. **`ObjectStorage` interface** in `src/lib/_internal/storage.ts` with an `S3Storage` impl using `@aws-sdk/client-s3`. Config from env vars, works against RustFS locally and AWS S3 in prod via `forcePathStyle` toggle.
2. **Project image upload**: replace the free-text Image URL field on the project form with an `<ImageUploader>` widget that picks → crops (16:9 default, free aspect) → client-resizes to max 1600x900 → uploads as ~WebP. Server validates + Sharp-normalizes + writes to `projects/$projectId/*.webp` + updates `projects.imageUrl` to the new key.
3. **Avatar upload**: `<AvatarUploader>` on `/profile` with a 1:1 locked crop, max 512x512 final size. Updates `user.image` to the new key. Deferred from Spec 1.
4. **Crop UI** via `react-image-crop`. Free aspect for projects (16:9 hint), 1:1 lock for avatars.
5. **Storage keys, not URLs** in DB columns (`projects.imageUrl`, `user.image`). A small client-safe `getPublicUrl(key)` helper constructs the rendered URL. Existing rows with full URLs survive via a `startsWith("http")` passthrough.
6. **Revised `/projects` listing**: URL-driven `view` param (`"card"` default | `"row"`). Card grid 1/2/3 cols responsive, row list single column with thumbnail. Toggle on the filter bar.
7. **Storage init script**: `npm run storage:init` creates the bucket on RustFS once (idempotent). Wired into the dev flow.
8. **Tests**: pure tests for `getPublicUrl` and `processImage`, integration test for upload writing to a real RustFS bucket via docker.
9. **No regressions**: existing 52 unit + 34 integration tests stay green.

## 3. Non-Goals (deferred)

- Multiple images per project (no schema change for now; a single image is plenty for capstone).
- Video uploads.
- CDN in front of the bucket.
- Server-side image variants (thumbnail + full). Single resized output per upload.
- Drag-and-drop upload.
- Public link sharing for non-image assets.
- Signed-URL access (we use a public bucket; flagged as a risk).
- Background cleanup of orphaned bucket objects.
- Migration of legacy text URLs into the bucket (they keep working via passthrough).

## 4. Architecture

### 4.1 Server modules

| Path | Responsibility |
| --- | --- |
| `src/lib/_internal/storage.ts` | Server-only. `ObjectStorage` interface + `S3Storage` impl using `@aws-sdk/client-s3`. `getObjectStorage()` singleton built from env. `forcePathStyle: true` when `S3_ENDPOINT` is set (RustFS); virtual-host style otherwise. Bucket name from `S3_BUCKET`. |
| `src/lib/_internal/image-processing.ts` | Server-only. `processImage(input: Buffer, opts: { maxWidth, maxHeight })` returns `{ buffer, contentType: "image/webp", width, height }`. Uses Sharp. Auto-rotates by EXIF, fits within bounds (preserves aspect), strips metadata, re-encodes WebP quality 85. |
| `src/server/uploads.ts` + `src/server/_internal/uploads.ts` | Two server fns: `uploadProjectImage` and `uploadAvatar`. Wrappers do the standard one-dynamic-import-per-handler pattern. Impls validate type + size, run Sharp, write to bucket, update the row, return the new key. |
| `scripts/storage-init.ts` | One-shot bootstrap. Reads env, calls `CreateBucketCommand`. Idempotent (catches `BucketAlreadyOwnedByYou` and `BucketAlreadyExists`). New npm script `storage:init`. |

### 4.2 Client modules

| Path | Responsibility |
| --- | --- |
| `src/lib/storage.ts` | Client-safe. Exports `STORAGE_PUBLIC_BASE` (from `import.meta.env.VITE_STORAGE_PUBLIC_BASE`) and `getPublicUrl(key: string \| null \| undefined): string \| null`. Passthrough for legacy `http://...` strings. |
| `src/components/image-uploader.tsx` | Self-contained widget. Props: `currentKey: string \| null`, `aspect?: number`, `maxWidth: number`, `maxHeight: number`, `onUploaded(key: string): void`, `onClear(): void`, `upload: (file: File) => Promise<{ key: string }>`. Internal flow: open file picker, react-image-crop modal, confirm, resize crop canvas, toBlob, call `upload`. Renders the current image preview via `getPublicUrl(currentKey)`. |
| `src/components/avatar-uploader.tsx` | Thin specialization: aspect 1, max 512x512, calls `uploadAvatar` via TanStack Start's server fn. |
| `src/components/project-image-uploader.tsx` | Thin specialization: aspect 16/9 (hint, free crop allowed), max 1600x900, calls `uploadProjectImage`. Takes `projectId` as prop. |
| `src/components/project-row.tsx` | Row variant for `/projects` listing. 80x60 thumbnail left, status badge + 1-line description. |
| `src/components/project-list-item.tsx` | Tiny dispatcher: `<ProjectListItem project={p} mode={"card" \| "row"} />` renders either `<ProjectCard>` or `<ProjectRow>`. |
| `src/components/view-toggle.tsx` | Pair of icon buttons (heroicons `Squares2X2Icon` / `Bars3Icon`). Driven by URL `view` param via TanStack Router navigate. |

### 4.3 Existing files changed

- `src/components/project-card.tsx`: render the image (when present) at top, 16:9, with a muted gradient fallback. Use `getPublicUrl(project.imageUrl)`.
- `src/components/project-form.tsx`: replace the `imageUrl` text Field with `<ProjectImageUploader projectId={projectId} currentKey={values.imageUrl} onUploaded={(key) => form.setFieldValue("imageUrl", key)} />`. The form takes a `projectId` prop; the new-project route generates one with `crypto.randomUUID()` and passes it; the edit route passes the row's existing id. The upload widget needs no special "save first" hint because the project id exists from the moment the form mounts. See Section 6.5.
- `src/server/projects.ts`: extend `projectInputSchema` to accept an optional `id` field (`z.string().uuid().optional()`); the impl uses it when present, otherwise falls back to `defaultRandom()` via Drizzle. `updateProjectSchema` already has `id`; no change there. The server validates the id is a v4 UUID and that no row already exists with that id (race-condition guard).
- `src/routes/_authed/profile.tsx`: mount `<AvatarUploader currentKey={user.image} ... />` near the top, between the heading and the form.
- `src/routes/projects/index.tsx`: add `view: z.enum(["card","row"]).default("card")` to the search schema. Render `<ProjectListItem mode={view} ... />` per row.
- `src/routes/projects/$projectId.tsx`: render the image (when present) using `getPublicUrl`.
- `src/components/projects-filter-bar.tsx`: add `<ViewToggle />` aligned right.
- `src/integrations/better-auth/header-user.tsx`: render avatar with `getPublicUrl(session.user.image)`; identicon fallback unchanged.
- `src/components/site-header.tsx`: same `getPublicUrl` treatment if it renders the user's image.

### 4.4 Why these boundaries

- **`storage.ts` (client) vs `_internal/storage.ts` (server)** keeps the AWS SDK out of the browser bundle. Same convention as auth-guards and the server modules.
- **`image-processing.ts` separate from `uploads.ts`** so the Sharp dependency is loaded only when actually needed. Both project and avatar uploads import it.
- **`ImageUploader` as a generic widget with two thin specializations** (avatar, project) so the crop/resize logic lives once. The two server fns differ in storage path and target column; everything else is shared.
- **`ProjectListItem` dispatcher** keeps the route file from branching on `view`. Adding a future "compact" mode means one more component, no route surgery.

## 5. Storage abstraction

### 5.1 Interface

```ts
// src/lib/_internal/storage.ts
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class S3Storage implements ObjectStorage {
  constructor(private bucket: string, private client: S3Client) {}
  async put(key, body, contentType) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
  async delete(key) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

let _instance: ObjectStorage | null = null;
export function getObjectStorage(): ObjectStorage {
  if (_instance) return _instance;
  const endpoint = process.env.S3_ENDPOINT;
  const client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });
  _instance = new S3Storage(process.env.S3_BUCKET ?? "cs-capstone", client);
  return _instance;
}
```

### 5.2 Client-safe URL builder

```ts
// src/lib/storage.ts (client-safe)
export const STORAGE_PUBLIC_BASE =
  import.meta.env.VITE_STORAGE_PUBLIC_BASE ?? "/storage";

export function getPublicUrl(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  return `${STORAGE_PUBLIC_BASE}/${key}`;
}
```

### 5.3 Env contract (added to `.env.example`)

```bash
# Object storage (RustFS locally, AWS S3 in prod)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=cs-capstone
S3_ACCESS_KEY=rustfsadmin
S3_SECRET_KEY=rustfsadmin

# Client-facing base URL for storage keys.
# Local: http://localhost:9000/<bucket>
# Prod (AWS): https://<bucket>.s3.<region>.amazonaws.com
VITE_STORAGE_PUBLIC_BASE=http://localhost:9000/cs-capstone
```

Empty / missing `S3_ENDPOINT` means "use AWS S3 default" (virtual-host style, region-aware endpoint).

### 5.4 Bucket bootstrap

`scripts/storage-init.ts`:

```ts
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
const client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint,
  forcePathStyle: !!endpoint,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});

const bucket = process.env.S3_BUCKET ?? "cs-capstone";
try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Created bucket ${bucket}`);
} catch (err) {
  const name = (err as { name?: string })?.name ?? "";
  if (
    name === "BucketAlreadyOwnedByYou" ||
    name === "BucketAlreadyExists"
  ) {
    console.log(`Bucket ${bucket} already exists`);
  } else {
    throw err;
  }
}
```

npm script: `"storage:init": "tsx --env-file=.env.local scripts/storage-init.ts"`.

## 6. Upload flow

### 6.1 Client side (the small bit)

Inside `<ImageUploader>` after the user confirms the crop:

```ts
// crop canvas comes from react-image-crop's getCroppedCanvas / draw helper.
const cropCanvas: HTMLCanvasElement = drawCrop(sourceImg, cropRegion);

// Resize step: draw the crop onto a max-bounded canvas.
const aspect = cropCanvas.width / cropCanvas.height;
const targetWidth = Math.min(cropCanvas.width, maxWidth);
const targetHeight = Math.round(targetWidth / aspect);
const out = document.createElement("canvas");
out.width = targetWidth;
out.height = Math.min(targetHeight, maxHeight);
const ctx = out.getContext("2d")!;
ctx.imageSmoothingQuality = "high";
ctx.drawImage(cropCanvas, 0, 0, out.width, out.height);

const blob: Blob = await new Promise((resolve, reject) =>
  out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", 0.85),
);

const file = new File([blob], "upload.webp", { type: "image/webp" });
const { key } = await props.upload(file);  // calls the server fn
props.onUploaded(key);
```

The browser's native `<canvas>` + `toBlob` handles encoding. WebP is supported in every current browser. No client image library beyond `react-image-crop` for the crop UI itself.

### 6.2 Server-fn shapes (with FormData)

TanStack Start's `createServerFn(...).inputValidator(...)` accepts FormData when the validator returns the data passed in. The wrapper looks like:

```ts
// src/server/uploads.ts
export const uploadProjectImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Expected FormData");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { uploadProjectImageForCurrentUser } = await import(
      "./_internal/uploads"
    );
    return uploadProjectImageForCurrentUser(data);
  });
```

The impl reads `data.get("projectId") as string` and `data.get("file") as File`. Falls back to the API-route approach (see Risk #1) if FormData support is flaky.

### 6.3 Server impl outline

```ts
// src/server/_internal/uploads.ts (simplified)
import { randomUUID } from "node:crypto";

export async function uploadProjectImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");

  // Validate MIME + size
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Unsupported image type");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB pre-resize)");
  }

  // Permission: viewer must be able to edit this project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (!canEditProject(project, { id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }

  // Process: re-encode WebP, fit within bounds, strip metadata
  const buffer = Buffer.from(await file.arrayBuffer());
  const { processImage } = await import("#/lib/_internal/image-processing");
  const { buffer: out, contentType } = await processImage(buffer, {
    maxWidth: 1600,
    maxHeight: 900,
  });

  // Write to bucket
  const key = `projects/${projectId}/${randomUUID()}.webp`;
  const { getObjectStorage } = await import("#/lib/_internal/storage");
  await getObjectStorage().put(key, out, contentType);

  // Update row
  const previousKey = project.imageUrl;
  await db.update(projects).set({ imageUrl: key, updatedAt: new Date() }).where(eq(projects.id, projectId));

  // Best-effort cleanup of old key (only if it's a key, not a legacy URL)
  if (previousKey && !previousKey.startsWith("http")) {
    getObjectStorage().delete(previousKey).catch((e) => console.warn("orphan delete", previousKey, e));
  }

  return { key };
}
```

`uploadAvatarForCurrentUser` is similar but writes to `avatars/$userId/$uuid.webp` and updates `user.image`. No permission check beyond `requireUser`.

### 6.4 Image processing

```ts
// src/lib/_internal/image-processing.ts
import sharp from "sharp";

export async function processImage(
  input: Buffer,
  opts: { maxWidth: number; maxHeight: number },
) {
  const pipeline = sharp(input)
    .rotate()  // auto-orient by EXIF
    .resize({
      width: opts.maxWidth,
      height: opts.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .withMetadata({});  // strip EXIF / orientation tag

  const buffer = await pipeline.toBuffer();
  const { width, height } = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp" as const,
    width: width ?? 0,
    height: height ?? 0,
  };
}
```

## 7. Schema

**No new columns.** Existing `projects.imageUrl` (text) and `user.image` (text) now hold storage keys. Inventory's `inventoryItems.imageUrl` (also text) is out of scope.

**Legacy passthrough:** `getPublicUrl(key)` returns `key` unchanged if it starts with `http://` or `https://`. Old rows seeded with full URLs (e.g., GitHub OAuth user images, DiceBear identicons) still render correctly without migration.

**Default avatar fallback:** when `user.image` is `NULL`, the header / profile renders a DiceBear identicon URL constructed from the user id (Spec 1 convention). Upload writes a key; clearing the avatar nulls the column.

## 8. Project listing: card vs row

### 8.1 URL state

Search schema for `/projects` gains:

```ts
view: z.enum(["card", "row"]).default("card"),
```

Filter changes still reset `page` to 1; toggle changes leave page alone (different filter dimension).

### 8.2 Card mode

- Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`.
- Card: `<Link>` wrapping the whole tile. Image at top (`aspect-[16/9] object-cover`) or a gradient placeholder. Title + status badge row. 2-line truncated description (`line-clamp-2`). "Published [date]" small.

### 8.3 Row mode

- Single column, `space-y-2`.
- Row: `<Link>` flex row. 80x60 thumbnail (`w-20 h-15 object-cover`) at left or gradient placeholder. Right side: title + status badge on first line, 1-line truncated description on second.

### 8.4 Toggle UI

`<ViewToggle>` lives at the top-right of the filter bar. Two icon-only buttons (heroicons `Squares2X2Icon`, `Bars3Icon`) with `aria-label`. Active button has a darker bg.

## 9. Routes touched

| Path | Change |
| --- | --- |
| `/projects` | Add `view` to search schema; render via `<ProjectListItem mode={view}>`; mount `<ViewToggle>` in filter bar. |
| `/projects/$projectId` | Render `getPublicUrl(project.imageUrl)` as a 16:9 hero image when present. |
| `/projects/$projectId/edit` | Replace `<ProjectImageUploader projectId={...} />` (the form's existing imageUrl key is preloaded). |
| `/projects/new` | Generates `projectId = crypto.randomUUID()` on mount, passes it to both `<ProjectImageUploader>` and (on submit) to `createProject({ data: { id: projectId, ... } })`. Image upload works immediately; user can upload before filling any other field. |
| `/profile` | Mount `<AvatarUploader currentKey={user.image} ...>` near the top. |

## 10. Testing

| Layer | Coverage | Tooling |
| --- | --- | --- |
| Unit (pure) | `getPublicUrl(null)` returns null; `getPublicUrl("https://x")` passthrough; `getPublicUrl("foo.webp")` returns base + key. | Vitest. |
| Unit (pure, runs Sharp) | `processImage(fixtureBuffer, { maxWidth: 100, maxHeight: 100 })` returns a WebP buffer no wider/taller than 100. Auto-rotate test: source has EXIF orientation 6, output has equivalent rotated content (assert via output dimensions matching the EXIF-rotated source). | Vitest + tiny fixture JPEG and EXIF-tagged JPEG in `src/lib/__tests__/fixtures/`. |
| Integration | `uploadProjectImageForCurrentUser`: writes a real object to the docker RustFS bucket. Reads it back via the S3 client (HEAD) to verify Content-Type and non-zero size. Updates `projects.imageUrl` to the new key. Refuses when viewer is not allowed to edit. | Vitest + docker RustFS (already in `docker compose`). Requires the bucket to exist; the test setup calls `storage-init` once before the suite via a `globalSetup` hook in `vitest.integration.config.ts`. |
| Integration | `uploadAvatarForCurrentUser`: writes a real object. Updates `user.image`. | Same harness. |

No new browser/E2E tests. Manual smoke at Section 13.

## 11. Risks

1. **TanStack Start FormData handling.** Server functions accept JSON by default. The `inputValidator` returning the FormData object as-is is the documented pattern, but the framework version is fresh and behavior may differ. **Fallback:** a plain server route `/api/upload/project` and `/api/upload/avatar` reading multipart directly via the request's `formData()`. The client calls them via `fetch`. We start with the server-fn approach and switch if it fights us; documented in QUIRKS either way.
2. **`react-image-crop` SSR.** The library has client-only DOM dependencies. Mount the crop dialog inside a `useEffect` or use `useState`-driven conditional rendering so it never tries to render during SSR. Same pattern Spec 1's auth-client already uses.
3. **Sharp install size.** Sharp is ~30MB on disk on the server (native binding per platform). Acceptable. Lazy-import inside the impl handler so it doesn't load during cold start of unrelated routes. **Sharp is NEVER in the client bundle**; bundlers exclude native modules automatically and the package is server-only.
4. **Public bucket policy.** We treat the bucket as public-read. On RustFS, the default is open. On AWS, the user configures a bucket policy + disables "Block Public Access" at deploy time. Documented as an operational note. If you ever need private images, switch to signed URLs at render (Spec 5b, not now).
5. **Legacy text URLs.** Old rows holding full URLs (GitHub OAuth, DiceBear) keep working via the `startsWith("http")` passthrough in `getPublicUrl`. The column mixes keys and URLs forever; either is renderable. No data migration. Accept the small cognitive cost.
6. **Orphan keys on update.** The impl best-effort-deletes the previous key after a successful new upload. If the delete fails (bucket eventual consistency, network hiccup), the orphan stays. Acceptable; rare; can be cleaned by a one-shot script later.
7. **CORS on RustFS.** Direct browser GETs to `http://localhost:9000/cs-capstone/foo.webp` need the bucket to allow CORS from `http://localhost:3000`. RustFS defaults to open access in dev; documented in README + QUIRKS. AWS S3 prod requires an explicit `cors` config.
8. **Optimistic projectId orphans.** `/projects/new` generates a client-side UUID and passes it to both the image upload and the `createProject` call. If the user uploads an image and then abandons the form (closes the tab, navigates away), the blob in the bucket has no owning row. This is an accepted trade-off for the much better UX of uploading immediately. Two protections: (a) `createProject` validates the id is a v4 UUID and refuses if a row already exists with that id; (b) a future one-shot script can sweep `projects/<id>/` keys whose `<id>` has no matching `projects.id` row. Not in scope for this spec.
9. **`VITE_*` env var split.** Client and server use different sets (`S3_*` server, `VITE_STORAGE_PUBLIC_BASE` client). Vite only exposes `VITE_`-prefixed vars to the browser. Documented in `.env.example`.

## 12. Open questions

None at design time. User confirmed: client-side crop + canvas resize (no big client lib), server-side Sharp normalization, single resized output per upload, public bucket, react-image-crop for the crop UI, card and row both shipped in this spec, default to card.

## 13. Manual smoke checklist

1. **Bucket init.** `npm run storage:init` once. RustFS container UI at <http://localhost:9001> shows the `cs-capstone` bucket.
2. **Avatar upload.** Sign in as `user@example.com`. Visit `/profile`. Avatar widget shows DiceBear identicon (current state). Click "Upload"; pick a large image; crop 1:1; confirm. The header avatar updates within a refresh. Network panel: the uploaded blob is well under 500KB.
3. **Project image upload on new.** As admin, visit `/projects/new`. Without typing anything else, upload an image, crop 16:9, confirm. Network panel shows the upload completing to `projects/<uuid>/<uuid>.webp`. Fill in Title + Description. Save. Land on `/projects/<that-same-uuid>` with the hero image visible. The project row id matches the storage path uuid.
4. **Project image replace on edit.** Open the same project's `/projects/$id/edit`. Upload a different image. Save. Detail page shows the new image. The old key in the bucket is best-effort-deleted (verify via RustFS console).
5. **Card vs row.** Visit `/projects` (signed out). See card grid with images. Click the row icon. See the row list with thumbnails. URL shows `?view=row`. Refresh, state persists.
6. **Storage key vs URL.** In `db:studio`, change a `projects.imageUrl` to `https://placekitten.com/600/400`. Refresh the detail page. The kitten image renders. Legacy passthrough works.
7. **Permission gate.** As a non-admin proposer, try to upload an image on another user's project (via devtools fetch). Server returns Forbidden.
8. **Type / size validation.** Try uploading a `.pdf` file. The picker filters most, but if you bypass via devtools, the server rejects with "Unsupported image type". Try a 50MB image; client resize brings it under 1MB before upload, so the server's 10MB pre-resize limit is rarely hit.
9. **Abandoned-upload orphan.** As admin, visit `/projects/new`. Upload an image. Close the tab without saving. The blob persists in the bucket (RustFS console shows it under `projects/<uuid>/`); no row in `projects` references it. Acceptable per Risk #8.

## 14. Approval

Awaiting user review. Once approved, the next step is `superpowers:writing-plans` to produce the implementation plan.

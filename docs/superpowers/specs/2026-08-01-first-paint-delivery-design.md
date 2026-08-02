# First-paint delivery (asset compression, logo sizing, header reflow): design

Date: 2026-08-01

On a cold production load the app paints unstyled content before the stylesheet
applies, most visibly as a full-size institution logo. This design fixes the two
things that produce that: a delivery path that ships the render-blocking
stylesheet uncompressed and uncached, and markup that cannot reserve space for an
asset before it arrives.

The governing principle, which every decision below follows from:

> **Nothing render-blocking crosses the origin boundary uncompressed. Nothing
> that occupies layout space arrives without declaring its size.**

The first clause governs Feature A. The second governs Features B and C, and it
is what connects two problems that look unrelated: the oversized logo and the
header's post-hydration reflow are the same defect, which is that the browser
cannot reserve correct space before the payload lands. Feature D sits outside the
principle on purpose; it was never a cause, only an aggravator, which is why it
is gated on measurement rather than scheduled.

---

## Current behavior

Measured on 2026-08-01 against a real `npm run build` and the production Nitro
server (`node .output/server/index.mjs`), with
`curl -H 'Accept-Encoding: gzip, br'`.

| Asset | Bytes on the wire | gzip -9 | brotli -q11 |
| --- | ---: | ---: | ---: |
| `/assets/styles-<hash>.css` | 98,008 | 16,651 | 14,200 |
| `/logo-institution.svg` | 35,440 | 11,814 | not measured |
| 24 `modulepreload` JS chunks in `<head>` | 634,413 | 196,382 | 165,672 |
| **Critical-path total** | **767,861** | ~225 KB | **~190 KB** |

All figures are measured. The JS row is the concatenation of the 24 chunks the
SSR HTML actually links from `<head>`, not the whole 79-file `assets/` directory.

### What is already correct, and why one hypothesis is ruled out

The originating suspicion was that mixed Tailwind usage and hand-written shared
styles were causing the flash. They are not, and rewriting `.nav-link` or
`.island-shell` as utilities would change nothing:

1. There is exactly one stylesheet source, `src/styles.css`, compiled to one
   hashed bundle. No second CSS entry exists anywhere in `src/`.
2. The hand-written rules compile into that same bundle through Tailwind v4's
   `@import 'tailwindcss'` pipeline. They cost one extra request of zero and one
   extra cache entry of zero, and they do not change blocking semantics.
3. The SSR head order is correct. In the served HTML the stylesheet link sits at
   byte 190 and `<body>` begins near byte 1750, so React 19 hoists it ahead of
   the body and it is a genuine render-blocking stylesheet.

The problem is not what CSS is written. It is how slowly it arrives, and what the
HTML looks like in the window where it has not.

### What is wrong

**The origin does not compress.** The CSS response carries
`content-length: 98008` and no `content-encoding`, despite the request
advertising `gzip, br`. There are no `.gz` or `.br` files in `.output/public`;
`.output/nitro.json` records `"config": {}`, so `compressPublicAssets` is off.
The `vary: Accept-Encoding` header is present but there is nothing to negotiate.

**CloudFront cannot compensate, and `compress = true` alone would not help.**
`infra/cloudfront.tf:69` gives the app distribution a single
`default_cache_behavior` using `Managed-CachingDisabled` (`:74`) with no
`compress` attribute, which the Terraform AWS provider defaults to `false`. Per
the AWS documentation, compression requires both `Compress` on the behavior and
`EnableAcceptEncodingGzip` / `EnableAcceptEncodingBrotli` on the cache policy,
and `Managed-CachingDisabled` is documented as
"Cache compressed objects setting: Disabled". Setting `compress` on the current
behavior is therefore a no-op until the cache policy changes.

**Nothing is cached at the edge.** The app already sets
`cache-control: public, max-age=31536000, immutable` on the hashed CSS and
`CachingDisabled` discards it. Every cold viewer pulls the full 768 KB from the
single Fargate task, through the ALB, through the VPC origin.

### Why this produces an unstyled paint

A render-blocking stylesheet normally prevents unstyled paint outright; browsers
wait. The delivery numbers above put the request into the regime where they stop
waiting: Firefox has an explicit FOUC timeout, and any engine will paint if the
response stalls or errors mid-flight. The precise trigger could not be pinned
down from the investigation environment, and this design does not depend on
pinning it. The delivery figures are sufficient to produce the window and are
worth fixing on their own merits, and Feature B removes the part that makes the
window conspicuous regardless of what opens it.

---

## Feature A: asset delivery

Compression happens at the origin first and the edge second. That ordering is
load-bearing, not stylistic. Once the origin returns `Content-Encoding`,
CloudFront never makes a compression decision at all: the docs specify that when
the origin returns a compressed object, CloudFront forwards it, caches it, and
skips its own compression. That matters because CloudFront compresses on a
best-effort basis and "in rare cases skips compressing an object when CloudFront
experiences high traffic load", and when it skips it caches the uncompressed
object and keeps serving it until expiry or invalidation. With a 24-hour default
TTL, one unlucky miss would pin 98 KB of raw CSS at that edge for a day. Origin
compression is the deterministic path; edge compression becomes a fallback that
should never fire.

### A1: origin compression (`vite.config.ts:14`)

The `nitro()` plugin accepts a full `NitroConfig`, so the flag goes in the
existing call:

```ts
nitro({ compressPublicAssets: true, rollupConfig: { external: [/^@sentry\//] } }),
```

Verified against the pinned `nitro-nightly`: `compressPublicAssets` is typed as
`boolean | CompressOptions` and supports gzip, brotli, and zstd. Nitro emits the
compressed variants beside each public asset and its static handler negotiates on
`Accept-Encoding`. Files below 1 KB and `.map` files are excluded, which is fine.

Expected effect, from the measurements above: CSS 98,008 to 14,200, critical-path
JS 634,413 to 165,672.

**This step opens with a gate.** After `npm run build`,
`find .output/public/assets -name '*.br'` must return results. `compressPublicAssets`
covers Nitro's public assets, and `/assets/` is Vite's client build output rather
than the `public/` directory; both land in `.output/public/`, so it should be
covered, but the build-order interaction with TanStack Start's asset handling
makes this an assumption worth testing rather than trusting. If the gate fails,
the fallback is a Vite-side compression plugin and nothing downstream should be
built until it passes.

### A2: edge caching (`infra/cloudfront.tf`)

A new `ordered_cache_behavior` on the app distribution:

```hcl
ordered_cache_behavior {
  path_pattern           = "/assets/*"
  target_origin_id       = "alb"
  viewer_protocol_policy = "redirect-to-https"
  allowed_methods        = ["GET", "HEAD"]
  cached_methods         = ["GET", "HEAD"]
  cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  compress               = true
}
```

The `caching_optimized` data source already exists at `infra/cloudfront.tf:44`
for the assets distribution and is reused rather than redeclared.

Two constraints are recorded here as prose because neither is visible from the
diff:

**No `origin_request_policy_id`, deliberately.** CloudFront then forwards the
minimum and rewrites `Host` to the origin domain. That is safe here because the
ALB listener (`infra/ecs.tf:30`) forwards unconditionally to a single target
group with no host-header conditions, and Nitro's static handler never reads
`Host`. It must specifically not copy `Managed-AllViewer` from the default
behavior: forwarding every viewer header and cookie on a behavior whose entire
purpose is to stop reaching the origin is pure overhead.

**This behavior must never widen beyond `/assets/*`.** `CachingOptimized`
carries a one-second minimum TTL, and AWS documents that a minimum TTL above zero
caches for at least that long *even when the origin sends `no-cache`, `no-store`,
or `private`*. That is harmless for content-hashed immutable files and becomes a
signed-in-response leak the moment the pattern matches an auth-dependent path.

---

## Feature B: logo asset pipeline

The header logo is an `<img>` with no intrinsic dimensions
(`src/components/institution-logo.tsx:15`), pointing at 35,440 bytes of raw
Inkscape output that sits in `public/` and comes back with no `cache-control`
header at all.

Two distinct failure modes follow from the missing dimensions. Before CSS
applies, the image lays out at its intrinsic 581.88 x 184.46667, and
`src/components/site-header.tsx` renders the logo twice (desktop `md:flex`,
mobile `md:hidden`) with only CSS separating them, so an unstyled paint shows two
582px logos stacked. After CSS applies but before the SVG loads,
`height: 2rem; width: auto` resolves to width 0, so the nav shifts when the image
lands. The second mode is ordinary CLS and survives every fix in Feature A.

### B1: declare the intrinsic size

`width={101} height={32}` on the `<img>` at `institution-logo.tsx:15`, and on the
`logoUrlLight` variant at `:24`, which needs identical treatment.

Derivation, recorded so it is not "corrected" later: the viewBox is
`581.88 x 184.46667`, a ratio of `3.1544`; at height 32 that gives `100.94`,
rounded to **101**.

This fixes both modes. Pre-CSS the image lays out at 101 x 32 instead of
582 x 184. Post-CSS the browser derives an aspect ratio from the attributes, so
`w-auto` resolves to 101px before the image loads instead of collapsing to zero.
The `h-8 w-auto` classes still win once CSS applies, which is correct.

### B2: minify

SVGO over `public/logo-institution.svg`, expecting 3 KB to 5 KB from 35,440.
Two preservation constraints: `viewBox` must survive, because B1's derivation
depends on it, and path structure must not change in a way that breaks the
`dark:brightness-0 dark:invert` filter at `institution-logo.tsx:18`.

### B3: move into the hashed pipeline

`src/lib/brand.ts:5` holds `logoUrl: "/logo-institution.svg"` as a literal. It
becomes a `?url` import so the file lands in `/assets/` hashed and inherits A2's
cache behavior instead of sitting in `public/` with no `cache-control`.

Verified safe: `brand.logoUrl` is consumed only by `institution-logo.tsx`, with
no references from the email templates, `public/manifest.json`, or any script.
The `as const satisfies Brand` on `brand.ts` still holds, since `Brand` declares
`logoUrl: string` rather than a literal type. `logoUrlLight` stays
`undefined as string | undefined` (`brand.ts:9`) and the light-variant branch is
untouched.

Inlining the SVG as a React component was considered and rejected. It would
remove the request from the critical path entirely and allow `currentColor`
instead of the filter hack, but it hardcodes the OSU mark and makes
`brand.logoUrl`, `logoUrlLight`, and `logoAlt` dead configuration that
`institution-logo.tsx` branches on specifically to support a swapped institution.

---

## Feature C: header session state

`src/components/site-header.tsx:21` calls `authClient.useSession()`, which is
`isPending` during SSR. The server therefore ships

```html
<div class="h-8 w-24 animate-pulse rounded-md bg-[var(--surface-sunken)]"></div>
```

at `site-header.tsx:56` (desktop) and `:163` (mobile), which the client replaces
with wider content after hydration. Confirmed present in the served HTML. This is
independent of Features A and B and will still be there once the CSS is fast.

**The fix reserves space; it does not remove the skeleton.**

Server-rendering the signed-out state, mirroring the `useHasMounted` pattern in
`src/routes/index.tsx`, was considered and rejected. That pattern is right on the
index route, where the swapping element is a CTA button whose label changes below
the fold. In the header it is the first thing anyone sees, and server-rendering
signed-out means every returning signed-in user is shown "Sign in / Sign up"
before it corrects. That trades a neutral wrong state (the pulse, which honestly
reports "not yet known") for a confidently wrong one.

The actual goal is no reflow, not no skeleton. The session slot gets a
`min-width` sized to the wider of the two resolved states (signed-out, which is
a "Sign in" link plus a "Sign up" button; and signed-in, which is the
notification bell, cart button, and user menu). The pending skeleton is sized to
that same width, so all three states occupy identical space, nothing around them
moves, and the pulse keeps telling the truth. Both the desktop branch (`:56`) and
the mobile branch (`:163`) receive it.

The two resolved widths are measured in a browser during implementation rather
than guessed; this design deliberately does not assert pixel values it did not
measure.

---

## Feature D: paint cost, gated on measurement

`src/styles.css:254` gives `body` four stacked gradient layers, plus two fixed
full-viewport pseudo-element layers: `body::before` (`:269`, three radial
gradients) and `body::after` (`:282`, a 28px grid behind a `mask-image`). The
header adds `backdrop-filter: blur(8px)` as an inline style, and `.rise-in`
(`:416`) is a 700ms entrance animation. Dark mode re-tunes the same layers at
`:168`, `:176`, and `:185`.

None of this causes the flash. It makes first paint expensive once it happens.

**No change ships from this section unless a measurement demands it.** After A
and B land, profile initial load in DevTools with 4x CPU throttling and read
Paint plus Composite Layers time. **Threshold: 16ms**, one frame at 60fps. Under
it, close the item and leave the design alone.

Over it, trim in this order, re-measuring after each and stopping at the first
result under threshold:

1. `body::after`, the fixed 28px grid at 0.14 opacity in light and 0.05 in dark.
   Least visible layer, most compositing work.
2. `body::before`.
3. The header's `backdrop-filter`.

The gradients themselves are the last thing to touch, and only after the three
above have been tried.

---

## Non-goals

**Compressing the SSR HTML** (roughly 13 KB to 4 KB). `compressPublicAssets` does
not reach it, because it is a dynamic response rather than a public asset.
Obtaining it would mean either origin middleware or replacing
`Managed-CachingDisabled` on the default cache behavior with a custom TTL-0
policy that has the encoding flags enabled. That default behavior carries every
authenticated request in the application, and risking it for 9 KB is a bad trade.
If this is wanted later, the origin-middleware route is the safe one; the custom
cache policy is the one to avoid.

**Other `public/` assets** (`favicon.ico`, `project-placeholder.webp`,
`manifest.json`, `robots.txt`). They are unhashed, so a one-year edge TTL would
be wrong for them, and they are small enough not to matter. Only the logo moves,
and it moves because B3 gives it a hash.

**Reducing the 24-chunk critical path.** Route-level code splitting and chunk
consolidation would cut the 634 KB further, but that is a bundling redesign with
its own risk surface. Compression takes it to 166 KB, which is enough.

**The `.rise-in` entrance animation.** Noted under Feature D as context, not
scheduled for change.

---

## Testing

| What | Where | Guards |
| --- | --- | --- |
| Logo `<img>` carries `width`/`height` matching the SVG viewBox ratio | `src/test/institution-logo.test.tsx` (new) | B1 being dropped in a later refactor |
| Header session slot reserves the same width in pending, signed-out, and signed-in states | `src/test/site-header.test.tsx` (new) | C regressing |
| Build emits `.br` variants for `/assets/*` | `scripts/` check, run after build in CI | **A1 regressing on a dependency bump** |

The third row carries the most weight. A1 is a build-configuration flag with no
runtime signature: if a `nitro-nightly` bump changes the option's behavior,
nothing fails, nothing looks different in local development, and production
quietly returns to shipping 98 KB of raw CSS. An assertion on the build output is
the only thing that catches it, and it is the difference between fixing this once
and fixing it again in six months.

Both new component tests follow the existing convention in `src/test/`:
`// @vitest-environment jsdom` on line 1, Testing Library, assertions inside
`it()`. There are no existing logo or header tests to extend.

The Playwright axe suite needs no new cases; `alt` text and heading structure are
unchanged by this work.

---

## Verification checklist (manual, post-deploy)

1. `curl -sI -H 'Accept-Encoding: br' https://<domain>/assets/styles-<hash>.css`
   returns `content-encoding: br`.
2. The same call repeated returns `x-cache: Hit from cloudfront`.
3. `curl -sI https://<domain>/assets/<logo-hash>.svg` returns a `cache-control`
   header, confirming B3.
4. DevTools with cache disabled and network throttled to Slow 4G, hard reload: no
   paint lands before `styles-<hash>.css` completes.
5. Lighthouse CLS on a cold load, compared against a pre-change baseline captured
   before Feature B.

---

## Risks

**A1's gate fails.** Covered in Feature A: the fallback is a Vite-side
compression plugin. Cheap to detect, detected before anything depends on it.

**A2 breaks asset routing.** The reasoning that omitting
`origin_request_policy_id` is safe rests on reading `infra/ecs.tf:30` and Nitro's
static handler, not on observing the deployed stack. Confirm against the real
distribution before rollout. The blast radius is limited to `/assets/*`, and
reverting is a single behavior removal.

**B2 changes the mark's appearance.** SVGO is not always lossless on
Inkscape-authored paths. Compare rendered output before and after, in both light
and dark mode, since the dark path goes through a `brightness(0) invert(1)`
filter that can expose fill-rule changes the light path hides.

**B3 breaks SSR.** `brand.ts` is imported by `__root.tsx`, which runs on both
server and client. A `?url` import resolves in both environments under Vite, but
this is worth confirming in a production build rather than only in dev.

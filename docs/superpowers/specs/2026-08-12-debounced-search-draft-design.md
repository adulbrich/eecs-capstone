# One owner for the debounced search draft: design

Date: 2026-08-12

Seventh and last candidate from the architecture review of the inventory and
projects hot spots. The review counted six copies of a debounce effect and
proposed extracting it. Auditing the six found that the copies are not the
problem: the piece one of them is **missing** is.

The governing principle:

> **Extract the whole rule, not the visible half of it. The half left behind is
> where the bug was.**

---

## The pattern is three pieces, and one site has two of them

Every search box mirrors a URL value into a local draft so typing feels
immediate, then writes the draft back after 300ms. That takes three things:

1. `useState(q)`, the draft
2. `useEffect(() => setDraft(q), [q])`, syncing the draft back when the URL
   changes underneath, which is what browser Back does
3. the debounced effect that commits the draft

Five of the six sites have all three. `src/components/inventory-filter-bar.tsx`
has one and three.

**So Back is broken on that filter bar.** Press it, the URL's `?q=` changes,
`localQ` still holds the old draft, and the next debounce tick sees
`localQ !== props.q` and writes the old value straight back into the URL. The
user's Back press is undone roughly 300ms after they make it.

It is the only site whose `q` arrives as a prop rather than from
`Route.useSearch()`, which is why it was written differently and why nobody
noticed.

## The same file re-arms its timer on every render

```ts
}, [localQ, props]);
```

`props` is a fresh object identity on every parent render, so the effect tears
down and re-arms its timer whenever the parent re-renders, not when a key is
pressed. The other five depend on primitives plus a stable `navigate`.

## What is not a bug

`page: 1` appears in only two of the six, and that is correct: it appears
exactly where a `page` search param exists (`admin/users`, and the public
projects route through `projects-filter-bar`; the public inventory route resets
it in the parent). The three admin routes that omit it have no pagination at
all. No change.

## Design

`src/lib/use-debounced-draft.ts`:

```ts
export function useDebouncedDraft(
  value: string,
  commit: (next: string) => void,
  delayMs = 300
): [string, (next: string) => void];
```

It owns all three pieces. A caller holds no draft state and writes no effect:

```ts
const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);
```

Router-agnostic, taking a value and a callback rather than reaching for
`useNavigate`, which is what `table-state.ts:220-231` already says and for the
same reason: it keeps the hook unit-testable.

**Callers must pass a referentially stable `commit`.** That is the same contract
`useAdminTableState` already places on `setSearch` and `replaceSearch`, and it
goes in the JSDoc. Each of the five route call sites gains one `useCallback`;
`inventory-filter-bar` takes its callback from props and the parent stabilises
it.

Adopting it at all six sites fixes both bugs by construction: the sync-back is
no longer something a caller can forget, and the dependency array is the hook's
business rather than the caller's.

### Why the hook owns the draft

A debounce-only helper would have left pieces 1 and 2 at each call site, which
is precisely the shape that produced the bug. The value here is not the eleven
lines saved; it is that "draft has diverged from its source and nobody is
watching" stops being expressible.

## A separate race, fixed separately

`src/components/proposer-picker.tsx:40-55` debounces an account lookup and has
no cancellation guard, so a late response from a superseded query still calls
`setMatches`. `src/components/holder-field.tsx` does the same thing twice and
guards both with a `cancelled` closure flag checked after the await.

Three lines, mirroring the sibling file, in its own commit so a reviewer can see
it is a behaviour change rather than part of the extraction.

## Deliberately not in scope

- **A shared hook for the account-lookup debounces.** `holder-field` twice and
  `proposer-picker` once share a `setTimeout` skeleton and nothing else: no
  draft, no external value to mirror, an async result lifecycle with
  cancellation, and `holder-field` additionally resets `account` and `status`
  synchronously before arming the timer. A hook over that would be a wide
  interface across a thin implementation.
- **The duplicated `SEARCH_DEBOUNCE_MS` constant** declared in both of those
  files. Worth one shared constant eventually; not worth a change of its own
  here.
- **The wider admin-listing pipeline.** Recorded during the original review:
  across six `useAdminTableState` callers only two things actually vary, and
  everything downstream genuinely differs per route. A generic listing module
  would get the same answer the `withCurrentUser()` proposal already got.
- **`page: 1`.** Coherent as it stands, see above.

## Tests

Only one test in the repo exercises debounce timing today
(`inventory-filter-bar.test.tsx:29`), and `vi.useFakeTimers()` appears in two
files repo-wide.

Unit tests on the hook, with fake timers:

- commits after the delay and not before
- rapid changes coalesce into a single commit
- an external change to `value` resets the draft
- **the regression**: change `value` underneath, advance the timers, and assert
  `commit` was never called. This is the Back bug, and it fails against today's
  `inventory-filter-bar` behaviour.

The existing filter-bar test stays as the wiring proof.

## Constraints

- **No behaviour change at the five correct sites.** Same 300ms, same committed
  values, same `page: 1` where it already appears.
- **Two deliberate behaviour changes**, both fixes, both called out: Back works
  on the inventory filter bar, and the proposer picker stops applying stale
  lookup results.
- **No wire-format change, no migration, no new dependency.**
- **Stage files by name. Never commit to `main`.** Branch
  `fix/debounced-search-draft`.

## What this buys

- **A broken Back button gets fixed**, on a public page, in a way that cannot
  regress at a new call site.
- **A timer that re-armed on render** now re-arms on input.
- **A race in the proposer lookup closes.**
- **The first real test coverage** for debounce behaviour: four route files and
  one filter bar have no tests at all today.
- Six copies become six call sites of one hook, which is the smallest part of
  the win.

# Persisting the in-progress submission form in the browser

**Decision:** The proposal form does not save its draft to browser storage.

**Reason:** The failure it would cover, a long proposal lost to a dropped submit,
is infrequent, and doing it right needs decisions that are not obvious: whether
local storage is even the right layer next to the server-side draft, whether NDA
and private-notes text may sit on disk on a shared lab machine, that the pending
image cannot be serialized, when to write, whether to restore silently, expiry,
multi-tab keying, and SSR hydration. The maintainer closed it with "won't do
this now, as it is something not frequent and which requires quite some thought
to make right"; the second clause is what this file records.

**Prior requests:** #56

Revisit only with a spec that answers the questions #56 lists. A bare "add
localStorage" request is this file's case again.

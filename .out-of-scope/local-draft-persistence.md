# Persisting the in-progress submission form in the browser

**Decision:** The proposal form does not save its draft to browser storage.

**Reason:** The failure it would cover, a long proposal lost to a dropped submit,
is infrequent, and doing it right needs decisions that are not obvious: whether
local storage is even the right layer next to the server-side draft, whether NDA
and private-notes text may sit on disk on a shared lab machine, that the pending
image cannot be serialized, when to write, whether to restore silently, expiry,
multi-tab keying, and SSR hydration. The maintainer declined to spend that thought
now. A spec answering those questions is what would reopen it; a bare "add
localStorage" request does not.

**Prior requests:** #56

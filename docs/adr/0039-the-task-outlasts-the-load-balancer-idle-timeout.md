# The task outlasts the load balancer's idle timeout, and a wrapper is how

`src/lib/_internal/keep-alive-timeout.ts` sets the Node HTTP server's
`keepAliveTimeout` to 65 seconds, above the ALB's `idle_timeout`, which
`infra/ecs.tf` now writes down as 60 rather than leaving at the AWS default;
`headersTimeout` is deliberately left alone, for a reason that file measures
rather than argues. Node defaults the keep-alive to 5 seconds and the FIN
measures a second later still, so production dropped pooled connections after
about 6 seconds while the balancer went on reusing them for 60, and every
request dispatched into that gap reached a connection already gone: no
response, no target status code, 502 for the student (#545). The four access
log lines the load test retrieved say that and only that, once the fields are
read against AWS's definitions rather than inferred, because
`target_status_code` is recorded "only if a connection was established to the
target and the target sent a response" and `response_processing_time` is -1
when "the target closes the connection before the idle timeout"; #545 read the
same lines as a streaming SSR response breaking after its shell had flushed,
which those two fields rule out, since a broken stream must have sent headers
first and would have logged `target_status_code 200` with a truncated body; the
same two fields rule out the acquire timeout on the pool that #545 called its
most likely candidate, and a rejection swallowed inside the stream, because a
loader that rejects is awaited before the shell flushes and renders a 500,
which would have been a `target_status_code` and a `HTTPCode_Target_5XX_Count`,
and both were absent. The third field is the one worth reconciling rather than
citing around: `target_processing_time` read 0.141 to 0.251 and not -1, and AWS
sets it to -1 only when the balancer cannot dispatch, so the connection was
still open when the request went onto it and the reading above is too coarse.
What fits all three is the sharper version of the same mismatch: the balancer
dispatched onto a socket Node had already scheduled to close, the saturated
loop took a couple of hundred milliseconds to get to it, and the keep-alive
timer destroyed it first. That is also why it surfaced at 42 requests per
second and not at 10, and it is why the fix is the timeout rather than
anything about the loop: a task that never closes a connection inside the
balancer's reuse window has no such window to lose. The direction
is forced rather than chosen, because `idle_timeout` also bounds the wait for a
target's first byte and the load test measured a p50 of 4.12 s under
saturation, so lowering the ALB to meet Node would trade 502s for 504s. The
delivery is the part with a real alternative: the timeout is not reachable
through configuration, since Nitro's `node-server` entry calls srvx's `serve()`
with a fixed options object and never passes the `node` key that reaches
`http.createServer`, srvx's plugin list belongs to Nitro, and the four Nitro
runtime hooks never see the server, so a Nitro plugin wraps `http.createServer`
at boot in the same pre-listener slot `config-check.ts` uses, in preference to
a project copy of Nitro's entry through the supported `entry` option, which
would fork about forty lines of framework internals, import virtual modules
`tsc --noEmit` cannot resolve, and go stale silently on the next nightly. A ten
line wrapper that goes stale loudly is the better trade, and the right end
state is Nitro exposing the option upstream. Decided 2026-09-21.

## Consequences

`src/lib/__tests__/keep-alive-timeout.test.ts` reads `idle_timeout` out of
`infra/ecs.tf` and holds `keepAliveTimeout` above it, so raising one side alone
fails rather than silently reopening the defect, the same way `db-pool.test.ts`
holds `CONNECTION_BUDGET` to `app_max_tasks`. The wrapper marks itself with a
symbol rather than a function name, because a bundler may rename a function it
deconflicts and a name check would then fail open without saying so.
`scripts/loadtest/pooled-connection-reuse.mjs` reproduces the defect against a
local build in about thirty seconds, which answers the question #545 left open:
a local reproduction is possible, and it needs neither load nor a constrained
pool. It cannot be written with an `http.Agent`, because Node's agent evicts a
socket the moment the server closes it while a load balancer has no such
coupling, so the script drives a raw socket and is the thing to reach for the
next time a transport-level failure is suspected. The task's own CloudWatch Logs, which #545
asked for, corroborate this from the server side and are worth recording
because the silence is the evidence: `/ecs/eecs-capstone` holds 830 lines
across 13:30 to 14:00 UTC and **none at all** in 13:35 to 13:42, the window
holding all four retrieved 502s. The task is demonstrably willing to log this
family of failure, since 46 `Error: aborted` objects with `ECONNRESET` at
`abortIncoming` sit in a single half second at 13:33:17, which is k6 dropping
its own in-flight iterations when the first burst aborted and is already
accounted for as the 460s in the load test write-up. So when a client
disappears mid-request the task says so, and at the four 502s it said nothing,
which is what a socket destroyed before the application ever saw a request
looks like and is not what a rejected loader or a broken stream looks like. The
honest limit that remains is that the fix itself is verified against a local
build and not against the ALB: the check that closes #545 is
`HTTPCode_ELB_5XX_Count` staying at zero through a re-run of the load test's
phase 1c after this deploys, which is the site owner's call rather than
something a branch can prove. `docs/load-tests/2026-09-20-term-start.md`
carried the same misreading of the access log fields and is corrected in place.

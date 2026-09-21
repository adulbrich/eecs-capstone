# The task outlasts the load balancer's idle timeout, and a wrapper is how

`src/lib/_internal/keep-alive-timeouts.ts` sets the Node HTTP server's
`keepAliveTimeout` to 65 seconds and `headersTimeout` to 66, above the ALB's
`idle_timeout`, which `infra/ecs.tf` now writes down as 60 rather than leaving
at the AWS default. Node defaults the first to 5 seconds, so production shipped
with the task closing pooled connections twelve times sooner than the load
balancer stopped reusing them, and every request the ALB dispatched into that
gap reached a connection that was already gone: no response, no target status
code, and a 502 for the student (#545). The four access log lines the load test
retrieved say exactly that and nothing else, once the fields are read against
AWS's definitions rather than inferred: `target_status_code` is recorded "only
if a connection was established to the target and the target sent a response",
and `response_processing_time` is -1 when "the target closes the connection
before the idle timeout". #545 read the same lines as a streaming SSR response
breaking after its shell had flushed, which those two fields rule out, because
a broken stream had to have sent headers first and would have logged
`target_status_code 200` with a truncated body. Saturation is why it appeared
under load and not at 10 requests per second, but it was never the cause: the
ALB opens many more connections to two tasks at 42 requests per second than at
10, and a busy loop is slower to answer, so the same standing mismatch gets
sampled more often. The direction is fixed rather than chosen: lowering the ALB
side instead would work on paper, but `idle_timeout` also bounds the wait for a
target's first byte, and the load test measured a p50 of 4.12 s under
saturation, so a short one trades 502s for 504s. Decided 2026-09-21.

The delivery mechanism is the part worth recording. Neither timeout is
reachable through configuration: Nitro's `node-server` entry calls srvx's
`serve()` with a fixed set of options and never passes the `node` key that
would reach `http.createServer`, srvx's plugin list belongs to Nitro, and the
four Nitro runtime hooks (`close`, `error`, `request`, `response`) never see
the server. Nitro v3 has no setting for either, which was checked against its
documentation rather than recalled. So a Nitro plugin wraps `http.createServer`
at boot, before the entry calls `serve()`, the same "runs once before the
listener binds" slot `config-check.ts` already uses. The alternative was a
project copy of Nitro's entry through the `entry` config option, which is
supported and was rejected: it forks about forty lines of framework internals,
imports virtual modules `tsc --noEmit` cannot resolve, and would go stale
silently the next time the entry gains a line, which on a nightly build is
often. A ten line wrapper that goes stale loudly is the better trade, and the
right end state is Nitro exposing the option upstream.

## Consequences

`src/lib/__tests__/keep-alive-timeouts.test.ts` reads `idle_timeout` out of
`infra/ecs.tf` and holds `keepAliveTimeout` above it, so raising one side alone
fails rather than silently reopening the defect, the same way
`db-pool.test.ts` holds `CONNECTION_BUDGET` to `app_max_tasks`. `headersTimeout`
has to stay above `keepAliveTimeout` because Node applies the shorter of the two
to an idle connection, and Node's 60 second default is below the new keep-alive,
so it could not be left alone. `scripts/loadtest/pooled-connection-reuse.mjs`
reproduces the defect against a local build in about thirty seconds, which
answers the question #545 left open about whether a local reproduction was
possible: it is, and it needs neither load nor a constrained pool. It cannot be
written with an `http.Agent`, because Node's agent evicts a socket the moment
the server closes it and an ALB has no such coupling, so the script drives a
raw socket. The honest limit on all of this is that the fix is verified against
a local build and not against the ALB: the check that closes #545 is
`HTTPCode_ELB_5XX_Count` staying at zero through a re-run of the load test's
phase 1c after this deploys, and that is a decision for whoever owns the site
rather than something the branch can prove. `docs/load-tests/2026-09-20-term-start.md`
carried the same misreading of the access log fields and is corrected in place.

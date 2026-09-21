/**
 * Reproduces the 502 of #545 locally, against a build rather than production.
 *
 * #545 asked whether a local reproduction could be made to work. It can, and
 * it needs neither load nor a constrained pool, because saturation was never
 * the cause: it only widened the window. What breaks is that Node closes an
 * idle keep-alive connection long before the load balancer stops reusing it.
 *
 *   npm run build
 *   DATABASE_URL=... node scripts/loadtest/pooled-connection-reuse.mjs
 *
 * The script holds one connection the way an ALB holds one in its pool, which
 * is the part an HTTP client will not do for you: it sends a request, reads
 * the response, then stops reading the socket entirely for `REPRO_IDLE_MS` ms before
 * sending the next request on it. Node's `http.Agent` cannot reproduce this,
 * because it watches its idle sockets and evicts one the moment the server
 * closes it, so every request it makes is on a connection it knows is live.
 * An ALB has no such coupling, which is the whole defect.
 *
 * Exit code 1 means it reproduced. Environment:
 *
 *   REPRO_IDLE_MS  ms to hold the connection idle. Default 10000: longer than
 *                  Node's unfixed 5 s keep-alive, far inside the ALB's 60 s
 *                  idle_timeout.
 *   REPRO_PORT     where to start the built server. Default 3111, to stay off
 *                  the 3000 that `npm run dev` and BETTER_AUTH_URL want.
 *   REPRO_PATH     route to request. Default `/api/healthz`, which touches no
 *                  database on purpose, so this measures the transport and
 *                  nothing above it.
 *   REPRO_ROUNDS   connections to try. Default 3.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const REPRO_PORT = Number(process.env.REPRO_PORT || 3111);
const REPRO_PATH = process.env.REPRO_PATH || "/api/healthz";
const REPRO_IDLE_MS = Number(process.env.REPRO_IDLE_MS || 10_000);
const REPRO_ROUNDS = Number(process.env.REPRO_ROUNDS || 3);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path) =>
  `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`;

function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(REPRO_PORT, "127.0.0.1");
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      (await connect()).destroy();
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

/** One pooled connection, used twice with a long unread gap between. */
async function reusePooledConnection() {
  const socket = await connect();
  socket.setNoDelay(true);
  socket.write(request(REPRO_PATH));
  await new Promise((resolve) => socket.once("data", resolve));

  // The load balancer's idle pool. Nothing reads the socket, so a FIN from
  // the task sits unprocessed until the next request is dispatched onto it.
  socket.pause();
  await sleep(REPRO_IDLE_MS);

  let outcome = "no response";
  socket.resume();
  await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      outcome = value;
      resolve();
    };
    socket.on("data", (chunk) => {
      const status = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString());
      settle(status ? `HTTP ${status[1]}` : "unparseable response");
    });
    socket.on("error", (error) => settle(error.code));
    socket.on("close", () => settle(outcome));
    socket.write(request(REPRO_PATH), (error) => error && settle(error.code));
    setTimeout(() => settle("timed out"), 5000);
  });
  socket.destroy();
  return outcome;
}

const server = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, PORT: String(REPRO_PORT) },
  stdio: ["ignore", "ignore", "inherit"],
});

try {
  if (!(await waitForServer())) {
    throw new Error(
      `No server on port ${REPRO_PORT}. Run \`npm run build\` first, and check the stderr above.`
    );
  }

  const outcomes = [];
  for (let round = 0; round < REPRO_ROUNDS; round++) {
    outcomes.push(await reusePooledConnection());
  }
  const broken = outcomes.filter((o) => !o.startsWith("HTTP 2")).length;

  console.log(`idle ${REPRO_IDLE_MS} ms, ${REPRO_ROUNDS} connections: ${outcomes.join(", ")}`);
  if (broken > 0) {
    console.log(
      `\nReproduced: ${broken} of ${REPRO_ROUNDS} reused connections carried no response.\n` +
        "Each one is an ALB 502 with target_status_code - and\n" +
        "response_processing_time -1, which is what #545 recorded in production.\n" +
        "See src/lib/_internal/keep-alive-timeouts.ts and ADR-0039."
    );
  } else {
    console.log(
      `\nNot reproduced: every reused connection answered after ${REPRO_IDLE_MS} ms idle.`
    );
  }
  process.exitCode = broken > 0 ? 1 : 0;
} finally {
  server.kill("SIGKILL");
}

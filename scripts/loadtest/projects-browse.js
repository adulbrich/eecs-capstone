/**
 * Load test for the public projects listing. Issue #524.
 *
 * Reads only, on public routes, against whatever `BASE` points at. The
 * default is production, which is live, so read the "Read this before
 * running anything" section of #524 before you start it.
 *
 *   RPS=10 DURATION=3m IDS=/path/to/ids.txt k6 run scripts/loadtest/projects-browse.js
 *
 * `RPS` is requests per second, not sessions per second. One iteration is a
 * four request session, so the executor holds `RPS` iterations per four
 * seconds to put `RPS` requests per second on the origin. Check
 * `dropped_iterations` in the summary: k6 lowers the rate silently when it
 * runs out of VUs, and a run that dropped iterations measured less load
 * than it claims.
 */
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import http from "k6/http";

const BASE = __ENV.BASE || "https://capstone.eecs.oregonstate.edu";
const RPS = Number(__ENV.RPS || 4);
const IDS = __ENV.IDS || "./ids.txt";

/**
 * The latency that aborts the run, in milliseconds. #524 sets 3000 and that is
 * the default, but 3000 stops a saturating phase within seconds of the first
 * slow request, which reports that the phase degraded and nothing about how.
 * Raise it for a deliberately short run when the failure shape is the point,
 * which is what phases 1d, 1e and 2 exist for. The error threshold below is
 * not adjustable on purpose: a 5XX aborts at any setting.
 */
const P99_ABORT_MS = Number(__ENV.P99_ABORT_MS || 3000);

const ids = new SharedArray("ids", () =>
  open(IDS).split("\n").filter(Boolean)
);

/**
 * The listing route normalizes its search params with a 307 to the fully
 * spelled out query string. k6 follows redirects, so requesting the short
 * form would cost two origin requests per step and split each step's
 * duration across two samples. These are the canonical values, which the
 * route serves directly.
 */
const FILTERS =
  "categories=%5B%5D&program=null&archivedOnly=false&acceptingOnly=true&studentProposedOnly=false&requiresNdaOnly=false";

// Varied on purpose. One repeated term would sit in Postgres's plan and
// buffer cache and report a speed the real workload never sees.
const TERMS = [
  "machine learning",
  "robotics",
  "web",
  "embedded",
  "database",
  "security",
  "mobile app",
  "sensor",
  "game",
  "accessibility",
  "data visualization",
  "cloud",
  "compiler",
  "network",
  "hardware",
];

export const options = {
  // Separates the test from real traffic in the ALB access logs and in the
  // site traffic table.
  userAgent: "k6-loadtest-524",
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      rate: RPS,
      timeUnit: "4s",
      duration: __ENV.DURATION || "3m",
      // An iteration is five seconds of sleep plus its requests, so it needs
      // about 1.5 VUs per request per second. Twice that preallocated, four
      // times it as the ceiling.
      preAllocatedVUs: Math.max(20, RPS * 2),
      maxVUs: Math.max(50, RPS * 4),
    },
  },
  thresholds: {
    // These abort the run. They are #524's abort criteria, enforced.
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true }],
    http_req_duration: [
      { threshold: `p(99)<${P99_ABORT_MS}`, abortOnFail: true },
    ],
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

function step(url, name) {
  const r = http.get(url, { tags: { name } });
  check(r, {
    [`${name} 200`]: (x) => x.status === 200,
    // A Hit would mean the CDN answered and the task never saw the request,
    // which would make the whole run measure CloudFront instead.
    [`${name} origin miss`]: (x) =>
      String(x.headers["X-Cache"] || "").includes("Miss"),
  });
  return r;
}

export default function () {
  // A student session in miniature: land, search, filter, read something.
  const term = encodeURIComponent(pick(TERMS));

  step(`${BASE}/projects?q=&${FILTERS}&page=1`, "listing");
  sleep(1);

  step(`${BASE}/projects?q=${term}&${FILTERS}&page=1`, "search");
  sleep(1);

  step(`${BASE}/projects?q=${term}&${FILTERS}&page=2`, "page2");
  sleep(1);

  step(`${BASE}/projects/${pick(ids)}`, "detail");
  sleep(2);
}

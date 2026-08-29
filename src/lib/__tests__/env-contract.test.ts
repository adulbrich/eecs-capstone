import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The answer to "what does this app need to run", derived rather than listed.
 *
 * #105 exists because that answer lives in three hand-maintained places, the
 * source, `.env.example` and `infra/ecs.tf`, with nothing checking they agree.
 * A manifest here would be a fourth. So this scans the source instead: it
 * cannot drift, because it reads what the code does.
 *
 * The two checks that matter run in opposite directions. A variable read but
 * undocumented cannot be set by an operator who was never told about it. A
 * variable read but absent from the task definition silently takes its default
 * in production, which is the failure that looks like working software.
 */

/**
 * The app is `src`. `scripts` is tooling, and it does run inside the task:
 * `.github/workflows/deploy.yml` invokes `scripts/migrate.mjs` through
 * `containerOverrides`. What separates them is not where they run but what
 * they read. A script's own variables are arguments supplied per invocation by
 * whoever starts it, not standing configuration the task definition carries,
 * which is the distinction `.env.example` already draws for itself: "Seed
 * (used by scripts/seed-admin.ts, not by the app)".
 */
const APP_ROOT = "src";
const SOURCE_ROOTS = [APP_ROOT, "scripts"];
const SOURCE_FILE = /\.(?:tsx?|mjs)$/;
const ENV_READ = /(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g;
const ENV_EXAMPLE_KEY = /^([A-Z][A-Z0-9_]*)=/;
const TASK_DEFINITION_KEY = /name\s*=\s*"([A-Z][A-Z0-9_]*)"/g;

/**
 * Supplied by the runtime or an SDK, so not this app's configuration and not
 * `.env.example`'s business.
 */
const PLATFORM_VARS = new Map([
  [
    "NODE_ENV",
    "set by the task definition, the Dockerfile, vitest and vite dev",
  ],
  [
    "AWS_REGION",
    "the AWS SDK's own variable, present on ECS regardless. Read only as a fallback for SES_REGION, which is documented",
  ],
]);

/**
 * Command-line arguments for one-off scripts, every one written
 * `process.env.X ?? process.argv[2]`. They parameterise an invocation rather
 * than configure the app, which is why they are not in `.env.example`.
 */
const SCRIPT_ARGUMENTS = new Set([
  "ADMIN_EMAIL",
  "ALLOW_ADMIN",
  "CONFIRM",
  "TARGET_EMAIL",
]);

/** Documented, but never read by this codebase, each for a stated reason. */
const NOT_READ_HERE = new Map([
  ["BETTER_AUTH_SECRET", "read by Better Auth internally, never by this code"],
  [
    "VITE_STORAGE_PUBLIC_BASE",
    "client-side, reached through import.meta.env at build time (src/lib/storage.ts)",
  ],
]);

/**
 * Read by the app and deliberately absent from the task definition. All but
 * the last are the task-role rule: production sets no static credentials and
 * no custom endpoint, so the SDK's default chain resolves the role. Setting
 * any of them in ECS would defeat that, which is why their absence is the
 * design and not an oversight. See `buildS3Config` and `buildBedrockConfig`.
 *
 * `AWS_REGION` is not here despite fitting the description, because
 * `PLATFORM_VARS` drops it before check 3 ever sees it, so the entry would
 * excuse nothing there. The pairwise-disjointness check below is what keeps
 * that from being a comment somebody has to remember.
 */
const UNSET_IN_PRODUCTION = new Map([
  ["S3_ENDPOINT", "task role, see buildS3Config"],
  ["S3_ACCESS_KEY", "task role, see buildS3Config"],
  ["S3_SECRET_KEY", "task role, see buildS3Config"],
  ["BEDROCK_ACCESS_KEY", "task role, see buildBedrockConfig"],
  ["BEDROCK_SECRET_KEY", "task role, see buildBedrockConfig"],
  [
    "BEDROCK_EMBEDDINGS_ENABLED",
    "deliberately not plumbed, so turning embeddings off in production is a terraform change rather than a variable flip. See the Bedrock section of docs/QUIRKS.md",
  ],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE_FILE.test(entry) ? [path] : [];
  });
}

/** Every variable the given roots read, mapped to the files that read it. */
function readsIn(roots: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      // Tests set variables to exercise a builder, so counting them would
      // report requirements nothing in production has.
      if (file.includes("__tests__") || file.includes("src/test/")) {
        continue;
      }
      const isScript = file.startsWith("scripts/");
      for (const [, name] of readFileSync(file, "utf8").matchAll(ENV_READ)) {
        // SCRIPT_ARGUMENTS is scoped to scripts on purpose. Suppressing those
        // names everywhere would hide a genuine `src` read of one, and they
        // are ordinary enough words to end up there.
        if (
          !name ||
          PLATFORM_VARS.has(name) ||
          (isScript && SCRIPT_ARGUMENTS.has(name))
        ) {
          continue;
        }
        found.set(name, [...(found.get(name) ?? []), file]);
      }
    }
  }
  return found;
}

const readsInSource = () => readsIn(SOURCE_ROOTS);
const readsInApp = () => readsIn([APP_ROOT]);

/**
 * Every name the code reads, with no exemption applied. The lists below are
 * checked against this rather than against each other, so an entry that
 * outlives the code it excuses shows up as dead rather than as nothing.
 */
function rawReads(roots: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      if (file.includes("__tests__") || file.includes("src/test/")) {
        continue;
      }
      for (const [, name] of readFileSync(file, "utf8").matchAll(ENV_READ)) {
        if (name) {
          found.add(name);
        }
      }
    }
  }
  return found;
}

function documentedKeys(): Set<string> {
  return new Set(
    readFileSync(".env.example", "utf8")
      .split("\n")
      .map((line) => ENV_EXAMPLE_KEY.exec(line)?.[1])
      .filter((key): key is string => Boolean(key))
  );
}

function taskDefinitionKeys(): Set<string> {
  const text = readFileSync("infra/ecs.tf", "utf8");
  return new Set(
    [...text.matchAll(TASK_DEFINITION_KEY)].map(([, name]) => name as string)
  );
}

describe("the environment contract", () => {
  it("documents every variable the code reads", () => {
    const documented = documentedKeys();
    const undocumented = [...readsInSource().entries()]
      .filter(([name]) => !documented.has(name))
      .map(([name, files]) => `${name} (read in ${files.join(", ")})`);

    // An operator cannot set what nothing tells them about, and .env.example
    // is where a new variable gets its explanation.
    expect(undocumented).toEqual([]);
  });

  it("reads every variable it documents, or says why it does not", () => {
    const read = readsInSource();
    const unread = [...documentedKeys()].filter(
      (name) => !(read.has(name) || NOT_READ_HERE.has(name))
    );

    // Catches a variable that outlived the code that read it. Deleting one is
    // cheap; discovering later that production sets something nothing consumes
    // is not.
    expect(unread).toEqual([]);
  });

  it("gives production every variable the code reads, or says why not", () => {
    const inTaskDefinition = taskDefinitionKeys();
    const missing = [...readsInApp().keys()].filter(
      (name) => !(inTaskDefinition.has(name) || UNSET_IN_PRODUCTION.has(name))
    );

    // The check #105 asked for. A variable added to the code and to
    // .env.example but forgotten in infra/ecs.tf does not fail: it silently
    // takes its default in production, which is worse than failing.
    //
    // Scoped to the app, not the scripts: SEED_ADMIN_EMAIL and its password
    // are read only by scripts/seed-admin.ts, which is run from a shell and
    // never from the task, so their absence there is correct.
    expect(missing).toEqual([]);
  });

  it("keeps every exemption list honest", () => {
    const read = readsInSource();
    const documented = documentedKeys();

    // An exemption that stops being true silently re-hides the thing it was
    // excusing, so each is cheap to re-verify and therefore re-verified.
    for (const [name] of NOT_READ_HERE) {
      expect([name, read.has(name)]).toEqual([name, false]);
      expect([name, documented.has(name)]).toEqual([name, true]);
    }
    for (const [name] of UNSET_IN_PRODUCTION) {
      expect([name, taskDefinitionKeys().has(name)]).toEqual([name, false]);
    }
    // PLATFORM_VARS and SCRIPT_ARGUMENTS suppress a read before it is counted,
    // so their claim is that .env.example does not document them either.
    for (const name of [...PLATFORM_VARS.keys(), ...SCRIPT_ARGUMENTS]) {
      expect([name, documented.has(name)]).toEqual([name, false]);
    }
  });

  it("names no variable on two exemption lists at once", () => {
    // Any overlap is inert and invisible, in both directions. PLATFORM_VARS
    // and SCRIPT_ARGUMENTS drop a read before anything counts it, so an entry
    // elsewhere for the same name excuses nothing, while the dead-exemption
    // check below still sees the raw read and calls it alive. The remaining
    // pairs are outright contradictions: NOT_READ_HERE asserts a name is
    // documented, the other three assert it is not.
    //
    // Asserted over every pair rather than the one that bit. AWS_REGION was
    // on PLATFORM_VARS and UNSET_IN_PRODUCTION, and closing only that pair
    // left CONFIRM free to sit on PLATFORM_VARS and SCRIPT_ARGUMENTS with the
    // same effect and the same silence.
    // Arrays, not `Map.keys()`. That returns a one-shot iterator, so the
    // first pair to consume one leaves every later pair reading an empty
    // sequence. Written that way this checked one pair of the six and passed.
    const lists: [string, string[]][] = [
      ["PLATFORM_VARS", [...PLATFORM_VARS.keys()]],
      ["SCRIPT_ARGUMENTS", [...SCRIPT_ARGUMENTS]],
      ["NOT_READ_HERE", [...NOT_READ_HERE.keys()]],
      ["UNSET_IN_PRODUCTION", [...UNSET_IN_PRODUCTION.keys()]],
    ];
    const overlaps: string[] = [];
    for (const [aName, a] of lists) {
      for (const [bName, b] of lists) {
        if (aName >= bName) {
          continue;
        }
        const shared = new Set(b);
        for (const name of a) {
          if (shared.has(name)) {
            overlaps.push(`${name} (${aName} and ${bName})`);
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("carries no exemption for a variable nothing reads any more", () => {
    // The half that was missing. Every list above was checked for "still
    // absent from .env.example" and none for "still read by something", so an
    // exemption could outlive its code silently. PORT was already in that
    // state when this was written: nothing read it, so the entry excused
    // nothing and no test could tell.
    const everywhere = rawReads(SOURCE_ROOTS);
    const inApp = rawReads([APP_ROOT]);
    const dead: string[] = [];
    for (const name of [...PLATFORM_VARS.keys()]) {
      if (!everywhere.has(name)) {
        dead.push(`${name} (PLATFORM_VARS)`);
      }
    }
    for (const name of SCRIPT_ARGUMENTS) {
      if (!rawReads(["scripts"]).has(name)) {
        dead.push(`${name} (SCRIPT_ARGUMENTS)`);
      }
    }
    for (const [name] of UNSET_IN_PRODUCTION) {
      if (!inApp.has(name)) {
        dead.push(`${name} (UNSET_IN_PRODUCTION)`);
      }
    }
    expect(dead).toEqual([]);
  });
});

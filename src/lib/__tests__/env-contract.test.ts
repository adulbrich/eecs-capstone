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
 * The app is `src`. `scripts` is developer and operator tooling that runs from
 * a shell, never inside the ECS task, which is why `.env.example` documents
 * both while the task definition needs only the first. See its "Seed (used by
 * scripts/seed-admin.ts, not by the app)" comment.
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
  ["PORT", "set by the task definition; locally `vite dev --port` decides it"],
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
 */
const UNSET_IN_PRODUCTION = new Map([
  ["S3_ENDPOINT", "task role, see buildS3Config"],
  ["S3_ACCESS_KEY", "task role, see buildS3Config"],
  ["S3_SECRET_KEY", "task role, see buildS3Config"],
  ["BEDROCK_ACCESS_KEY", "task role, see buildBedrockConfig"],
  ["BEDROCK_SECRET_KEY", "task role, see buildBedrockConfig"],
  ["AWS_REGION", "supplied by the SDK on ECS"],
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
      if (file.includes("__tests__") || file.includes(`src${"/"}test/`)) {
        continue;
      }
      for (const [, name] of readFileSync(file, "utf8").matchAll(ENV_READ)) {
        if (!name || PLATFORM_VARS.has(name) || SCRIPT_ARGUMENTS.has(name)) {
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
});

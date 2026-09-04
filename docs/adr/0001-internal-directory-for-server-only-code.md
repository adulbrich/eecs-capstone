# Server-only code lives in `_internal/` directories, not `*.server.*` files

TanStack Start's import-protection plugin denies any import on a client chain whose resolved path matches `**/*.server.*`, by name, and does not exempt an import that sits inside a stripped `createServerFn` handler. So the split is a directory: `src/server/x.ts` is the client-importable wrapper, holding only `createServerFn`, the Zod schema and types, and each handler does one dynamic import of `./_internal/x`; `src/server/_internal/x.ts` is the server-only impl and may statically import the database, the schema and the auth helpers. `src/lib/_internal/` holds the server-only helpers the same way.

## Consequences

An impl imports its input types back from its wrapper as `import type`, never the schema value: `verbatimModuleSyntax` erases the type and a value import would pull `createServerFn` into a server-only module. A schema an impl needs as a value belongs in a client-safe module under `src/lib/`.

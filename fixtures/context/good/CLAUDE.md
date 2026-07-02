# CLAUDE.md

Guidance for AI agents working in the acme-api repository.

## Project overview

acme-api is a TypeScript REST service that manages customer accounts and
billing events. It targets Node 20, stores data in Postgres, and ships as a
single container image. HTTP routing is assembled in
[src/server.ts](src/server.ts); each resource gets one router module under
`src/routes/`.

## Commands

Run everything from the repository root:

```bash
npm run build      # compile TypeScript to dist
npm run test       # vitest unit suite
npm run lint       # eslint over source and tests
npm run typecheck  # tsc with noEmit
npm run dev        # start the API with live reload on port 4000
```

CI runs build, test, lint, and typecheck on every pull request. Keep all four
green before pushing; a red typecheck blocks the merge queue.

## Architecture

- [src/server.ts](src/server.ts) — app assembly: middleware order, router
  mounting, and the terminal error handler. New middleware goes here, in
  order, with a one-line comment saying why it is positioned where it is.
- [src/routes/users.ts](src/routes/users.ts) — account CRUD. Validation
  schemas sit next to the handler that uses them, not in a shared module.
- [src/db/client.ts](src/db/client.ts) — the only module allowed to talk to
  Postgres. Query helpers return typed rows; raw SQL strings stay in this
  file.
- [docs/architecture.md](docs/architecture.md) — request lifecycle diagram
  and the service boundary rules in full.

Route handlers must not import the database driver directly — go through
`src/db/client.ts` so connection pooling and tracing stay in one place.

## Conventions

- Strict TypeScript; the build fails on any implicit any.
- Handlers return a typed `Result` object; the response middleware maps it to
  an HTTP status. Do not call the response object inside a handler.
- Errors that reach the terminal handler are logged once, with the request id.
  Do not add per-handler catch blocks that swallow and re-log.
- Table names are singular; migration files are timestamped and immutable
  once merged.

## Testing

- Unit tests live beside the code they cover and run with `npm run test`.
- Route tests stub the database client — no test may open a real connection.
- A bug fix lands with a regression test in the same commit.

## Gotchas

- Port 4000 is hardcoded in the dev script; the deployed service reads PORT
  from the environment instead.
- The billing webhook handler is idempotent by design — replayed events are
  expected in staging and are not a bug.
